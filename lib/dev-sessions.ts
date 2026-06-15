import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

// Next-side bridge to the session daemon (scripts/session-daemon.mjs). The
// dev-drawer's Sessions view talks to /api/dev/sessions/*, those routes call
// in here to reach the daemon. The daemon is a SEPARATE process on purpose:
// it owns the long-lived `claude` sessions so they survive `next dev`
// restarting (compile errors, HMR, the agent breaking its own preview). See
// the daemon file header for the full rationale.

const DAEMON_FILE = join(process.cwd(), ".flynet", "sessions", "daemon.json");
const DAEMON_SCRIPT = join(process.cwd(), "scripts", "session-daemon.mjs");

type DaemonInfo = { pid: number; port: number; token: string; host: string };

async function readInfo(): Promise<DaemonInfo | null> {
  try {
    return JSON.parse(await readFile(DAEMON_FILE, "utf8")) as DaemonInfo;
  } catch {
    return null;
  }
}

async function isHealthy(info: DaemonInfo): Promise<boolean> {
  try {
    const res = await fetch(`http://${info.host}:${info.port}/health`, {
      signal: AbortSignal.timeout(800),
    });
    return res.ok;
  } catch {
    return false;
  }
}

// Spawn the daemon DETACHED so it's reparented to launchd and outlives the Next
// dev server. stdio is ignored (its own console.log goes nowhere visible, which
// is fine — all session output flows through the transcript files). unref() lets
// the Next process exit/restart without waiting on it.
function spawnDaemon(): void {
  const child = spawn(process.execPath, [DAEMON_SCRIPT], {
    cwd: process.cwd(),
    env: process.env,
    detached: true,
    stdio: "ignore",
  });
  child.unref();
}

// Returns a healthy daemon's connection info, starting it if needed. Polls
// briefly for the freshly-written daemon.json after a cold spawn.
export async function ensureDaemon(): Promise<DaemonInfo> {
  let info = await readInfo();
  if (info && (await isHealthy(info))) return info;

  spawnDaemon();
  for (let i = 0; i < 25; i++) {
    await new Promise((r) => setTimeout(r, 120));
    info = await readInfo();
    if (info && (await isHealthy(info))) return info;
  }
  throw new Error("session daemon did not come up");
}

// Proxy a JSON request to the daemon, injecting the shared token. Used by the
// list/create/message/stop/resume routes.
export async function daemonFetch(
  path: string,
  init?: RequestInit,
): Promise<Response> {
  const info = await ensureDaemon();
  return fetch(`http://${info.host}:${info.port}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      "x-daemon-token": info.token,
      ...(init?.headers ?? {}),
    },
  });
}

// The daemon's base URL + token, for routes that need to stream (SSE) rather
// than buffer a JSON response.
export async function daemonTarget(): Promise<{ base: string; token: string }> {
  const info = await ensureDaemon();
  return { base: `http://${info.host}:${info.port}`, token: info.token };
}
