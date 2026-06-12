#!/usr/bin/env node
// Journey step tracker for the hackathon dev-journey skills.
//
// Distinct from progress.mjs (which tracks per-slice build tasks for /to-work),
// this tracks the high-level *journey* — the mandatory steps the user walks
// through in order. Each mandatory skill calls this when it starts and when the
// user confirms the step is finished:
//
//   grill-with-docs → to-plan → to-work
//
// The dev drawer's Prompts view polls /api/dev/journey, which reads this file,
// and renders each mandatory step as not-started / in-progress / done.
//
// Optional helpers (prototype, diagnose) have no clear "done", so they are NOT
// tracked here — they live in the drawer's "Others" section instead.
//
// Lives in the committed .flynet/ dotfolder (lockdir + temp are gitignored).
//
// Usage:
//   node scripts/journey.mjs start <step>   # mark in_progress (records startedAt)
//   node scripts/journey.mjs done  <step>   # mark done        (records completedAt)
//   node scripts/journey.mjs reset <step>   # back to not_started
//   node scripts/journey.mjs status         # print all steps
//
// <step> is one of: grill-with-docs | to-plan | to-work

import {
  mkdirSync,
  rmSync,
  existsSync,
  readFileSync,
  writeFileSync,
  renameSync,
} from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
const FLYNET = join(ROOT, ".flynet");
const JOURNEY_PATH = join(FLYNET, "journey.json");
const LOCK_PATH = join(FLYNET, "journey.json.lock");
const TMP_PATH = join(FLYNET, `journey.json.tmp.${process.pid}`);

// The mandatory, ordered steps. Keys must match the `id`s in the drawer's
// STEPS array (components/dev-drawer.tsx) so the UI can line them up.
const STEPS = ["grill-with-docs", "to-plan", "to-work"];

function nowIso() {
  return new Date().toISOString();
}

function fail(message) {
  console.error(`journey: ${message}`);
  process.exit(1);
}

// ── lock (atomic mkdir) + atomic write, same pattern as progress.mjs ─────────
function acquireLock() {
  mkdirSync(FLYNET, { recursive: true });
  const deadline = Date.now() + 10_000;
  for (;;) {
    try {
      mkdirSync(LOCK_PATH);
      return;
    } catch (err) {
      if (err.code !== "EEXIST") throw err;
      if (Date.now() > deadline) {
        try {
          rmSync(LOCK_PATH, { recursive: true, force: true });
        } catch {
          /* ignore */
        }
      }
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
  if (!existsSync(JOURNEY_PATH)) return null;
  try {
    return JSON.parse(readFileSync(JOURNEY_PATH, "utf8"));
  } catch {
    return null;
  }
}

function writeState(state) {
  state.updatedAt = nowIso();
  mkdirSync(FLYNET, { recursive: true });
  writeFileSync(TMP_PATH, `${JSON.stringify(state, null, 2)}\n`, "utf8");
  renameSync(TMP_PATH, JOURNEY_PATH);
}

function emptyState() {
  const steps = {};
  for (const id of STEPS) steps[id] = { status: "not_started" };
  return { updatedAt: nowIso(), steps };
}

function withLock(fn) {
  acquireLock();
  try {
    const next = fn(readState() ?? emptyState());
    if (next) writeState(next);
    return next;
  } finally {
    releaseLock();
  }
}

// ── commands ─────────────────────────────────────────────────────────────────
function transition(step, status) {
  if (!STEPS.includes(step)) {
    fail(`unknown step "${step}" (expected one of: ${STEPS.join(", ")})`);
  }
  withLock((state) => {
    const entry = state.steps[step] ?? { status: "not_started" };
    if (status === "in_progress") {
      // Don't downgrade a finished step; just refresh the start timestamp.
      if (entry.status !== "done") entry.status = "in_progress";
      entry.startedAt = entry.startedAt ?? nowIso();
    } else if (status === "done") {
      entry.status = "done";
      entry.startedAt = entry.startedAt ?? nowIso();
      entry.completedAt = nowIso();
    } else if (status === "not_started") {
      delete entry.startedAt;
      delete entry.completedAt;
      entry.status = "not_started";
    }
    state.steps[step] = entry;
    return state;
  });
  console.log(`journey: ${step} → ${status}`);
}

function cmdStatus() {
  const state = readState();
  if (!state) {
    console.log("journey: not started");
    for (const id of STEPS) console.log(`  [not_started] ${id}`);
    return;
  }
  console.log(`journey · updated ${state.updatedAt}`);
  for (const id of STEPS) {
    const s = state.steps?.[id]?.status ?? "not_started";
    console.log(`  [${s.padEnd(11)}] ${id}`);
  }
}

const [command, step] = process.argv.slice(2);
switch (command) {
  case "start":
    if (!step) fail("start requires a step");
    transition(step, "in_progress");
    break;
  case "done":
    if (!step) fail("done requires a step");
    transition(step, "done");
    break;
  case "reset":
    if (!step) fail("reset requires a step");
    transition(step, "not_started");
    break;
  case "status":
    cmdStatus();
    break;
  default:
    console.log(
      [
        "Usage:",
        "  node scripts/journey.mjs start <step>   # grill-with-docs | to-plan | to-work",
        "  node scripts/journey.mjs done  <step>",
        "  node scripts/journey.mjs reset <step>",
        "  node scripts/journey.mjs status",
      ].join("\n"),
    );
    if (command) fail(`unknown command "${command}"`);
}
