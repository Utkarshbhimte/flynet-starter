#!/usr/bin/env node
// Session daemon — the long-lived owner of local Claude Code sessions for the
// dev drawer's "Sessions" view.
//
// Why a separate process (and not just an /api/dev route)? `next dev` restarts
// constantly — every compile error, every HMR hiccup, every time the *agent
// itself* edits a file that fails to compile. If sessions were children of the
// Next server they'd die on every restart and there'd be nothing left to
// reconnect to. This daemon runs independently, so when the preview breaks the
// sessions keep running and keep writing transcripts; the drawer just
// reconnects and replays from a cursor. See lib/dev-sessions.ts for how Next
// finds and (auto-)spawns this process.
//
// Transport: a tiny HTTP server bound to 127.0.0.1 only, guarded by a shared
// token written to .flynet/sessions/daemon.json. It is NEVER tunneled (ngrok
// forwards :3000, not this port) and refuses non-local connections outright.
//
// Source of truth is the disk: every session has
//   .flynet/sessions/<id>/meta.json        — title, status, cwd, claude id
//   .flynet/sessions/<id>/transcript.jsonl — append-only normalized events
// The live `claude` subprocess is just an accelerator on top of that log.

import http from "node:http";
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import {
  mkdirSync,
  writeFileSync,
  readFileSync,
  appendFileSync,
  existsSync,
  readdirSync,
} from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
const SESSIONS_DIR = join(ROOT, ".flynet", "sessions");
const DAEMON_FILE = join(SESSIONS_DIR, "daemon.json");
const HOST = "127.0.0.1";

// In-memory registry: id -> { meta, proc, events:[], subscribers:Set<res>,
// stdoutBuf:string }. `events` is lazily hydrated from transcript.jsonl so a
// session created before a daemon restart can still be listed and replayed.
const sessions = new Map();

const TOKEN = randomBytes(24).toString("hex");

// ── persistence helpers ──────────────────────────────────────────────────────

function sessionDir(id) {
  return join(SESSIONS_DIR, id);
}

function readMeta(id) {
  try {
    return JSON.parse(readFileSync(join(sessionDir(id), "meta.json"), "utf8"));
  } catch {
    return null;
  }
}

function writeMeta(meta) {
  meta.updatedAt = new Date().toISOString();
  writeFileSync(
    join(sessionDir(meta.id), "meta.json"),
    JSON.stringify(meta, null, 2),
  );
}

// Lazily load a session's record (meta + persisted events) into memory.
function getSession(id) {
  let s = sessions.get(id);
  if (s) return s;
  const meta = readMeta(id);
  if (!meta) return null;
  const events = [];
  try {
    const raw = readFileSync(join(sessionDir(id), "transcript.jsonl"), "utf8");
    for (const line of raw.split("\n")) {
      if (!line.trim()) continue;
      try {
        events.push(JSON.parse(line));
      } catch {
        // Skip a torn line (daemon killed mid-append); the rest is fine.
      }
    }
  } catch {
    // No transcript yet.
  }
  s = { meta, proc: null, events, subscribers: new Set(), stdoutBuf: "" };
  sessions.set(id, s);
  return s;
}

// Append a normalized event: assign a monotonic seq (the reconnection cursor),
// persist to the transcript, and fan out to live SSE subscribers.
function emit(s, event) {
  const seq = s.events.length;
  const full = { seq, ts: new Date().toISOString(), ...event };
  s.events.push(full);
  try {
    appendFileSync(
      join(sessionDir(s.meta.id), "transcript.jsonl"),
      JSON.stringify(full) + "\n",
    );
  } catch {
    // Best-effort persistence; live subscribers still get it below.
  }
  const payload = `data: ${JSON.stringify(full)}\n\n`;
  for (const res of s.subscribers) {
    try {
      res.write(payload);
    } catch {
      s.subscribers.delete(res);
    }
  }
  return full;
}

function setStatus(s, status, note) {
  s.meta.status = status;
  writeMeta(s.meta);
  emit(s, { type: "status", status, ...(note ? { note } : {}) });
}

// ── claude subprocess wiring ─────────────────────────────────────────────────

// One user turn, as a stream-json input line for `claude --input-format
// stream-json`. The same shape is used for the first prompt and every follow-up.
function userLine(text) {
  return (
    JSON.stringify({
      type: "user",
      message: { role: "user", content: [{ type: "text", text }] },
    }) + "\n"
  );
}

const MAX_TOOL_RESULT = 4000;
function clip(str) {
  if (typeof str !== "string") str = JSON.stringify(str);
  return str.length > MAX_TOOL_RESULT
    ? str.slice(0, MAX_TOOL_RESULT) + `\n… [+${str.length - MAX_TOOL_RESULT} chars]`
    : str;
}

// Turn one stream-json line from claude into zero or more UI-facing events.
function normalize(s, obj) {
  if (!obj || typeof obj !== "object") return;
  switch (obj.type) {
    case "system":
      // The init event carries the claude session id we persist for --resume.
      if (obj.subtype === "init" && obj.session_id) {
        s.meta.claudeSessionId = obj.session_id;
        writeMeta(s.meta);
      }
      return;
    case "assistant": {
      const content = obj.message?.content ?? [];
      for (const block of content) {
        if (block.type === "text" && block.text) {
          emit(s, { type: "assistant", text: block.text });
        } else if (block.type === "tool_use") {
          emit(s, {
            type: "tool_use",
            id: block.id,
            name: block.name,
            input: block.input,
          });
        }
      }
      return;
    }
    case "user": {
      // Tool results come back wrapped as a user message.
      const content = obj.message?.content ?? [];
      for (const block of content) {
        if (block.type === "tool_result") {
          const text = Array.isArray(block.content)
            ? block.content.map((c) => c.text ?? "").join("")
            : block.content;
          emit(s, {
            type: "tool_result",
            toolUseId: block.tool_use_id,
            isError: Boolean(block.is_error),
            content: clip(text),
          });
        }
      }
      return;
    }
    case "result":
      emit(s, {
        type: "result",
        subtype: obj.subtype,
        isError: Boolean(obj.is_error),
        durationMs: obj.duration_ms,
        costUsd: obj.total_cost_usd,
        result: typeof obj.result === "string" ? obj.result : undefined,
      });
      // The model finished a turn; it stays alive for the next stdin message.
      setStatus(s, "idle");
      // Verify the change didn't break the dev server; fix it if it did.
      void maybeAutoFix(s);
      return;
    default:
      return;
  }
}

function handleStdout(s, chunk) {
  s.stdoutBuf += chunk;
  let nl;
  while ((nl = s.stdoutBuf.indexOf("\n")) !== -1) {
    const line = s.stdoutBuf.slice(0, nl).trim();
    s.stdoutBuf = s.stdoutBuf.slice(nl + 1);
    if (!line) continue;
    try {
      normalize(s, JSON.parse(line));
    } catch {
      // Non-JSON noise (rare with stream-json) — surface it as a log line.
      emit(s, { type: "log", text: line });
    }
  }
}

// Sessions always run with full access — these are local, dev-only, on the
// developer's own machine, and the point is unattended end-to-end work (e.g.
// /to-work). Permission prompts can't be answered in headless mode anyway, so
// anything less just stalls the agent.
const SKIP_PERMS = ["--dangerously-skip-permissions"];

const delay = (ms) => new Promise((r) => setTimeout(r, ms));

// Strip tags so a Next dev error page reads as text when handed to the fixer.
function stripHtml(html) {
  return String(html)
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// Is the dev server compiling and serving? A <500 response (even a 404) means
// it's alive; a 5xx means a compile/runtime error the agent likely just caused;
// a refused connection means it isn't running (don't auto-fix — it may be
// intentionally stopped). Retries briefly so a mid-HMR recompile isn't flagged.
async function checkDevHealth(devUrl) {
  let last = { ok: false, unreachable: true };
  for (let i = 0; i < 3; i++) {
    try {
      const res = await fetch(devUrl, { signal: AbortSignal.timeout(4000) });
      if (res.status < 500) return { ok: true, status: res.status };
      const body = await res.text().catch(() => "");
      last = { ok: false, status: res.status, snippet: clip(stripHtml(body)) };
    } catch {
      last = { ok: false, unreachable: true };
    }
    await delay(1000);
  }
  return last;
}

const MAX_AUTOFIX = 2;

function fixerPrompt(devUrl, snippet) {
  return (
    `The Next.js dev server at ${devUrl} is failing after a recent change — it ` +
    `won't compile or render cleanly. Diagnose the root cause and fix it with ` +
    `minimal, focused edits: run \`npm run typecheck\`, read the offending ` +
    `files, and fix the error. Then confirm the server returns a non-5xx ` +
    `response again. Don't add features — just restore the build.\n\n` +
    `What the page returned:\n${snippet || "(a 5xx with no readable body)"}`
  );
}

// One-shot debugging agent, spawned when a turn leaves the dev server broken.
// Its assistant text is surfaced inline in the originating session so the dev
// can watch the repair. Re-checks health when done (bounded by MAX_AUTOFIX).
async function runFixer(s, snippet) {
  s.fixing = true;
  emit(s, { type: "fixer", phase: "start", text: "Investigating the broken dev server…" });
  const proc = spawn(
    "claude",
    [
      "-p",
      fixerPrompt(s.meta.devUrl, snippet),
      "--output-format",
      "stream-json",
      "--verbose",
      ...SKIP_PERMS,
    ],
    { cwd: s.meta.cwd || ROOT, env: process.env },
  );
  let buf = "";
  await new Promise((resolve) => {
    proc.stdout.setEncoding("utf8");
    proc.stdout.on("data", (c) => {
      buf += c;
      let nl;
      while ((nl = buf.indexOf("\n")) !== -1) {
        const line = buf.slice(0, nl).trim();
        buf = buf.slice(nl + 1);
        if (!line) continue;
        try {
          const o = JSON.parse(line);
          if (o.type === "assistant") {
            for (const b of o.message?.content ?? []) {
              if (b.type === "text" && b.text) emit(s, { type: "fixer", text: b.text });
            }
          } else if (o.type === "result") {
            emit(s, {
              type: "fixer",
              phase: "done",
              text: o.is_error
                ? "Auto-fixer ended with an error."
                : "Auto-fixer finished.",
            });
          }
        } catch {
          /* ignore non-JSON noise */
        }
      }
    });
    proc.on("error", (e) => {
      emit(s, { type: "fixer", text: `Auto-fixer couldn't start: ${e.message}` });
      resolve(undefined);
    });
    proc.on("exit", () => resolve(undefined));
  });
  s.fixing = false;
  // Verify the repair; loop if still broken, up to the cap.
  await maybeAutoFix(s);
}

// After a turn, confirm the dev server still works; if the change broke it, kick
// off the fixer. No-op when there's no dev URL or a fix is already running.
async function maybeAutoFix(s) {
  if (s.fixing || !s.meta.devUrl) return;
  await delay(1500); // let HMR finish recompiling after the agent's edits
  const health = await checkDevHealth(s.meta.devUrl);
  if (health.ok) {
    if (s.autoFixCount) {
      emit(s, { type: "health", ok: true, note: "Dev server is healthy again." });
      s.autoFixCount = 0;
    }
    return;
  }
  if (health.unreachable) {
    emit(s, {
      type: "health",
      ok: false,
      note: "Dev server isn't reachable (it may be stopped).",
    });
    return;
  }
  if ((s.autoFixCount ?? 0) >= MAX_AUTOFIX) {
    emit(s, {
      type: "health",
      ok: false,
      note: `Dev server still broken after ${s.autoFixCount} auto-fix attempts — needs a human.`,
    });
    return;
  }
  s.autoFixCount = (s.autoFixCount ?? 0) + 1;
  emit(s, {
    type: "health",
    ok: false,
    note: `Dev server is broken (HTTP ${health.status}). Auto-fix attempt ${s.autoFixCount}/${MAX_AUTOFIX}…`,
  });
  await runFixer(s, health.snippet);
}

// Appended to every message sent to claude (but NOT to the user bubble shown in
// the transcript), so the agent self-verifies even before the programmatic
// health check runs. Belt and suspenders with maybeAutoFix().
const SELF_CHECK_SUFFIX =
  "\n\n---\n(System reminder) Before ending your turn: if you changed any " +
  "code, make sure the Next.js dev server still compiles and serves. Run " +
  "`npm run typecheck` and fix anything you broke.";

// Spawn (or re-spawn, via --resume) the claude process for a session and wire
// its stdout into the normalized event stream.
function spawnClaude(s, { resume } = {}) {
  const args = [
    "-p",
    "--input-format",
    "stream-json",
    "--output-format",
    "stream-json",
    "--verbose",
    ...SKIP_PERMS,
  ];
  if (resume && s.meta.claudeSessionId) {
    args.push("--resume", s.meta.claudeSessionId);
  }

  const proc = spawn("claude", args, {
    cwd: s.meta.cwd || ROOT,
    env: process.env,
    stdio: ["pipe", "pipe", "pipe"],
  });
  s.proc = proc;
  s.stdoutBuf = "";

  proc.stdout.setEncoding("utf8");
  proc.stdout.on("data", (c) => handleStdout(s, c));
  proc.stderr.setEncoding("utf8");
  proc.stderr.on("data", (c) => {
    const t = String(c).trim();
    if (t) emit(s, { type: "log", text: t });
  });
  proc.on("error", (err) => {
    emit(s, { type: "error", message: `Failed to launch claude: ${err.message}` });
    setStatus(s, "error");
    s.proc = null;
  });
  proc.on("exit", (code, signal) => {
    s.proc = null;
    // A clean turn already set status to "idle" via the result event; only flag
    // an unexpected exit (crash, kill) so the UI can offer Resume.
    if (s.meta.status === "working") {
      setStatus(
        s,
        signal ? "error" : code === 0 ? "idle" : "error",
        signal ? `claude exited on ${signal}` : `claude exited (code ${code})`,
      );
    }
  });
  return proc;
}

function sendMessage(s, text) {
  if (!s.proc) {
    // Process is gone (daemon or session died) — resume from persisted context.
    spawnClaude(s, { resume: true });
  }
  // A fresh user turn resets the auto-fix budget.
  s.autoFixCount = 0;
  emit(s, { type: "user", text });
  setStatus(s, "working");
  try {
    s.proc.stdin.write(userLine(text + SELF_CHECK_SUFFIX));
  } catch (err) {
    emit(s, { type: "error", message: `Could not send message: ${err.message}` });
    setStatus(s, "error");
  }
}

function createSession({ prompt, title, cwd, devUrl }) {
  const id = `sess_${Date.now().toString(36)}_${randomBytes(3).toString("hex")}`;
  mkdirSync(sessionDir(id), { recursive: true });
  const meta = {
    id,
    title: title || prompt.slice(0, 60) || "Untitled session",
    cwd: cwd || ROOT,
    // The dev server origin (e.g. http://localhost:3000) the Next proxy passed
    // in, used to health-check the preview after each turn.
    devUrl: devUrl || null,
    status: "working",
    claudeSessionId: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  writeMeta(meta);
  const s = { meta, proc: null, events: [], subscribers: new Set(), stdoutBuf: "" };
  sessions.set(id, s);

  spawnClaude(s, { resume: false });
  emit(s, { type: "user", text: prompt });
  try {
    s.proc.stdin.write(userLine(prompt + SELF_CHECK_SUFFIX));
  } catch (err) {
    emit(s, { type: "error", message: `Could not start: ${err.message}` });
    setStatus(s, "error");
  }
  return meta;
}

function listSessions() {
  // Merge live records with any on-disk sessions from before a daemon restart.
  const ids = new Set(sessions.keys());
  if (existsSync(SESSIONS_DIR)) {
    for (const name of readdirSync(SESSIONS_DIR)) {
      if (name.startsWith("sess_")) ids.add(name);
    }
  }
  const metas = [];
  for (const id of ids) {
    const s = getSession(id);
    if (!s) continue;
    // A session marked "working" with no live process is a stale crash victim.
    const live = Boolean(s.proc);
    metas.push({ ...s.meta, live, events: s.events.length });
  }
  metas.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  return metas;
}

// ── HTTP server ──────────────────────────────────────────────────────────────

function send(res, status, body) {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
}

function readBody(req) {
  return new Promise((resolve) => {
    let data = "";
    req.on("data", (c) => (data += c));
    req.on("end", () => {
      try {
        resolve(data ? JSON.parse(data) : {});
      } catch {
        resolve({});
      }
    });
  });
}

const server = http.createServer(async (req, res) => {
  // Local-only: reject anything not on the loopback interface, regardless of
  // headers. The Next proxy is the only intended caller.
  const remote = req.socket.remoteAddress || "";
  if (!remote.includes("127.0.0.1") && remote !== "::1" && !remote.endsWith(":127.0.0.1")) {
    return send(res, 403, { error: "forbidden" });
  }

  const url = new URL(req.url, `http://${HOST}`);
  const parts = url.pathname.split("/").filter(Boolean);

  if (parts[0] === "health") return send(res, 200, { ok: true, pid: process.pid });

  // Every other route requires the shared token.
  if (req.headers["x-daemon-token"] !== TOKEN) {
    return send(res, 401, { error: "unauthorized" });
  }

  try {
    // /sessions
    if (parts[0] === "sessions" && parts.length === 1) {
      if (req.method === "GET") return send(res, 200, { sessions: listSessions() });
      if (req.method === "POST") {
        const body = await readBody(req);
        if (!body.prompt || typeof body.prompt !== "string") {
          return send(res, 400, { error: "prompt is required" });
        }
        return send(res, 200, createSession(body));
      }
    }

    // /sessions/:id/...
    if (parts[0] === "sessions" && parts.length >= 2) {
      const id = parts[1];
      const s = getSession(id);
      if (!s) return send(res, 404, { error: "no such session" });
      const action = parts[2];

      if (!action && req.method === "GET") {
        return send(res, 200, { ...s.meta, live: Boolean(s.proc) });
      }
      if (action === "message" && req.method === "POST") {
        const body = await readBody(req);
        if (!body.text) return send(res, 400, { error: "text is required" });
        sendMessage(s, body.text);
        return send(res, 200, { ok: true });
      }
      if (action === "stop" && req.method === "POST") {
        if (s.proc) s.proc.kill("SIGTERM");
        setStatus(s, "idle", "stopped by user");
        return send(res, 200, { ok: true });
      }
      if (action === "resume" && req.method === "POST") {
        if (!s.proc) spawnClaude(s, { resume: true });
        setStatus(s, "idle", "resumed");
        return send(res, 200, { ok: true });
      }
      if (action === "stream" && req.method === "GET") {
        res.writeHead(200, {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache, no-transform",
          Connection: "keep-alive",
        });
        // Replay everything after the client's cursor, then stream live. A
        // reconnect (page reload, Next restart, dropped SSE) passes its last
        // seq and misses nothing in between.
        const cursor = Number(url.searchParams.get("cursor") ?? -1);
        for (const e of s.events) {
          if (e.seq > cursor) res.write(`data: ${JSON.stringify(e)}\n\n`);
        }
        s.subscribers.add(res);
        const ping = setInterval(() => {
          try {
            res.write(": ping\n\n");
          } catch {
            /* dropped */
          }
        }, 15000);
        req.on("close", () => {
          clearInterval(ping);
          s.subscribers.delete(res);
        });
        return;
      }
    }

    return send(res, 404, { error: "not found" });
  } catch (err) {
    return send(res, 500, { error: String(err?.message || err) });
  }
});

server.listen(0, HOST, () => {
  const { port } = server.address();
  mkdirSync(SESSIONS_DIR, { recursive: true });
  // Advertise where we are + the token so the Next proxy can reach us.
  writeFileSync(
    DAEMON_FILE,
    JSON.stringify({ pid: process.pid, port, token: TOKEN, host: HOST }, null, 2),
  );
  // Re-hydrate any prior sessions so they show up in the list immediately.
  for (const m of listSessions()) void m;
  console.log(`[session-daemon] listening on ${HOST}:${port} (pid ${process.pid})`);
});

// Keep the event loop alive and exit cleanly on signals.
process.on("SIGTERM", () => process.exit(0));
process.on("SIGINT", () => process.exit(0));
