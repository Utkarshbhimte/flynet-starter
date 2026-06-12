#!/usr/bin/env node
// Shared task-progress tracker for the `/to-work` skill.
//
// Multiple subagents — one per vertical slice — update a single common JSON
// file (.flynet/progress.json) as they pick up, work, and finish their slice.
// The dev drawer's Progress view polls /api/dev/progress, which reads this same
// file, so the JSON is the single source of truth shared between the agents and
// the UI. The file lives in the committed .flynet/ dotfolder (the lockdir and
// temp files alongside it are gitignored).
//
// Concurrency: parallel agents would corrupt the file with naive
// read-modify-write. Every mutation here takes an exclusive lock (an atomic
// `mkdir` on a lockdir — the classic POSIX lock primitive), reads, modifies,
// then writes via a temp file + atomic rename. Writers that can't get the lock
// retry with backoff. This keeps a handful of concurrent agents safe.
//
// Usage:
//   node scripts/progress.mjs init   [--feature <slug>]
//   node scripts/progress.mjs seed    --feature <slug>          # scan .scratch/<slug>/issues/*.md
//   node scripts/progress.mjs add     --id <id> --title <t> [--issue <path>]
//   node scripts/progress.mjs set     --id <id> --status <pending|in_progress|done|blocked|failed>
//                                      [--commit <sha>] [--agent <label>] [--note <text>]
//   node scripts/progress.mjs list
//
// Status values: pending | in_progress | done | blocked | failed

import {
  mkdirSync,
  rmSync,
  existsSync,
  readFileSync,
  writeFileSync,
  renameSync,
  readdirSync,
} from "node:fs";
import { join, dirname } from "node:path";

const ROOT = process.cwd();
const FLYNET = join(ROOT, ".flynet");
const PROGRESS_PATH = join(FLYNET, "progress.json");
const LOCK_PATH = join(FLYNET, "progress.json.lock");
const TMP_PATH = join(FLYNET, `progress.json.tmp.${process.pid}`);
// Issues (the local "issue tracker") still live under .scratch/<feature>/.
const SCRATCH = join(ROOT, ".scratch");

const STATUSES = ["pending", "in_progress", "done", "blocked", "failed"];

// ── tiny arg parser ──────────────────────────────────────────────────────────
function parseArgs(argv) {
  const [command, ...rest] = argv;
  const flags = {};
  for (let i = 0; i < rest.length; i++) {
    const token = rest[i];
    if (token.startsWith("--")) {
      const key = token.slice(2);
      const next = rest[i + 1];
      if (next === undefined || next.startsWith("--")) {
        flags[key] = true;
      } else {
        flags[key] = next;
        i++;
      }
    }
  }
  return { command, flags };
}

function nowIso() {
  return new Date().toISOString();
}

function fail(message) {
  console.error(`progress: ${message}`);
  process.exit(1);
}

// ── lock + atomic read/modify/write ──────────────────────────────────────────
function acquireLock() {
  mkdirSync(FLYNET, { recursive: true });
  const deadline = Date.now() + 10_000; // give up after 10s
  for (;;) {
    try {
      mkdirSync(LOCK_PATH); // atomic: fails if the lockdir already exists
      return;
    } catch (err) {
      if (err.code !== "EEXIST") throw err;
      if (Date.now() > deadline) {
        // Assume a crashed writer left a stale lock; reclaim it.
        try {
          rmSync(LOCK_PATH, { recursive: true, force: true });
        } catch {
          /* ignore — next mkdir attempt will report the real problem */
        }
      }
      // Busy-wait briefly. Node has no sleep; spin on a short deadline.
      const until = Date.now() + 25 + Math.floor(Math.random() * 50);
      while (Date.now() < until) {
        /* backoff */
      }
    }
  }
}

function releaseLock() {
  try {
    rmSync(LOCK_PATH, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
}

function readState() {
  if (!existsSync(PROGRESS_PATH)) return null;
  try {
    return JSON.parse(readFileSync(PROGRESS_PATH, "utf8"));
  } catch {
    return null;
  }
}

function writeState(state) {
  state.updatedAt = nowIso();
  mkdirSync(dirname(PROGRESS_PATH), { recursive: true });
  writeFileSync(TMP_PATH, `${JSON.stringify(state, null, 2)}\n`, "utf8");
  renameSync(TMP_PATH, PROGRESS_PATH); // atomic on the same filesystem
}

// Run `fn(state)` under the lock. `fn` returns the new state to persist, or
// null to leave the file untouched.
function withLock(fn) {
  acquireLock();
  try {
    const next = fn(readState());
    if (next) writeState(next);
    return next;
  } finally {
    releaseLock();
  }
}

function emptyState(feature) {
  const ts = nowIso();
  return {
    feature: feature ?? null,
    createdAt: ts,
    updatedAt: ts,
    tasks: [],
  };
}

function upsertTask(state, id, patch) {
  const existing = state.tasks.find((t) => t.id === id);
  if (existing) {
    Object.assign(existing, patch, { updatedAt: nowIso() });
    return existing;
  }
  const task = {
    id,
    title: patch.title ?? id,
    issue: patch.issue ?? null,
    status: patch.status ?? "pending",
    agent: patch.agent ?? null,
    commit: patch.commit ?? null,
    note: patch.note ?? null,
    updatedAt: nowIso(),
  };
  state.tasks.push(task);
  return task;
}

// Pull a human title out of an issue markdown file (first `# heading`).
function titleFromIssue(path) {
  try {
    const text = readFileSync(join(ROOT, path), "utf8");
    const match = text.match(/^#\s+(.+)$/m);
    if (match) return match[1].trim();
  } catch {
    /* fall through */
  }
  return null;
}

// ── commands ─────────────────────────────────────────────────────────────────
function cmdInit(flags) {
  withLock((state) => {
    if (state) {
      // Keep existing tasks; just refresh the feature label if provided.
      if (flags.feature) state.feature = flags.feature;
      return state;
    }
    return emptyState(typeof flags.feature === "string" ? flags.feature : null);
  });
  console.log(`progress: initialised ${PROGRESS_PATH}`);
}

function cmdSeed(flags) {
  const feature = flags.feature;
  if (!feature || feature === true) fail("seed requires --feature <slug>");
  const issuesDir = join(SCRATCH, feature, "issues");
  if (!existsSync(issuesDir)) {
    fail(`no issues directory at .scratch/${feature}/issues`);
  }
  const files = readdirSync(issuesDir)
    .filter((f) => f.endsWith(".md"))
    .sort();
  if (files.length === 0) fail(`no .md issues found in .scratch/${feature}/issues`);

  withLock((state) => {
    const next = state ?? emptyState(feature);
    next.feature = feature;
    for (const file of files) {
      // Expect NN-slug.md → id is the leading number.
      const id = (file.match(/^(\d+)/)?.[1] ?? file.replace(/\.md$/, "")).trim();
      const relIssue = join(".scratch", feature, "issues", file);
      upsertTask(next, id, {
        title: titleFromIssue(relIssue) ?? file.replace(/\.md$/, ""),
        issue: relIssue,
        // Don't clobber a status an agent may have already set.
        status: next.tasks.find((t) => t.id === id)?.status ?? "pending",
      });
    }
    return next;
  });
  console.log(`progress: seeded ${files.length} task(s) from .scratch/${feature}/issues`);
}

function cmdAdd(flags) {
  const id = flags.id;
  if (!id || id === true) fail("add requires --id <id>");
  withLock((state) => {
    const next = state ?? emptyState(null);
    upsertTask(next, String(id), {
      title: typeof flags.title === "string" ? flags.title : String(id),
      issue: typeof flags.issue === "string" ? flags.issue : null,
      status: "pending",
    });
    return next;
  });
  console.log(`progress: added task ${id}`);
}

function cmdSet(flags) {
  const id = flags.id;
  if (!id || id === true) fail("set requires --id <id>");
  const status = flags.status;
  if (status && status !== true && !STATUSES.includes(status)) {
    fail(`invalid --status "${status}" (expected one of: ${STATUSES.join(", ")})`);
  }
  withLock((state) => {
    if (!state) fail("no progress.json yet — run `init` or `seed` first");
    const patch = {};
    if (typeof status === "string") patch.status = status;
    if (typeof flags.commit === "string") patch.commit = flags.commit;
    if (typeof flags.agent === "string") patch.agent = flags.agent;
    if (typeof flags.note === "string") patch.note = flags.note;
    if (typeof flags.title === "string") patch.title = flags.title;
    if (typeof flags.issue === "string") patch.issue = flags.issue;
    upsertTask(state, String(id), patch);
    return state;
  });
  console.log(`progress: task ${id}${status && status !== true ? ` → ${status}` : ""}`);
}

function cmdList() {
  const state = readState();
  if (!state) {
    console.log("progress: no progress.json yet");
    return;
  }
  console.log(`feature: ${state.feature ?? "(unnamed)"}  ·  updated ${state.updatedAt}`);
  for (const t of state.tasks) {
    const commit = t.commit ? ` (${t.commit.slice(0, 7)})` : "";
    console.log(`  [${t.status.padEnd(11)}] ${t.id}  ${t.title}${commit}`);
  }
}

// ── dispatch ───────────────────────────────────────────────────────────────
const { command, flags } = parseArgs(process.argv.slice(2));
switch (command) {
  case "init":
    cmdInit(flags);
    break;
  case "seed":
    cmdSeed(flags);
    break;
  case "add":
    cmdAdd(flags);
    break;
  case "set":
    cmdSet(flags);
    break;
  case "list":
    cmdList();
    break;
  default:
    console.log(
      [
        "Usage:",
        "  node scripts/progress.mjs init   [--feature <slug>]",
        "  node scripts/progress.mjs seed    --feature <slug>",
        "  node scripts/progress.mjs add     --id <id> --title <t> [--issue <path>]",
        "  node scripts/progress.mjs set     --id <id> --status <pending|in_progress|done|blocked|failed> [--commit <sha>] [--agent <label>] [--note <text>]",
        "  node scripts/progress.mjs list",
      ].join("\n"),
    );
    if (command) fail(`unknown command "${command}"`);
}
