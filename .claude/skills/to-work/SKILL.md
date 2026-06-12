---
name: to-work
description: Build a planned feature by spawning one subagent per vertical slice. Each subagent builds its slice test-first, commits at task level, and reports status to a shared .flynet/progress.json that the dev drawer's Progress view polls live. Use after /to-plan, when the user wants to "work it", build the slices, or run the agents.
---

# To Work

Take the task files `/to-plan` produced under `.scratch/<feature-slug>/issues/` and build them by **spawning one subagent per slice**. Each subagent owns its slice end-to-end: builds it, commits it, and reports status into a shared JSON the UI watches.

This is the fourth step of the hackathon dev journey. It assumes `/to-plan` has already written the PRD and task files.

## Journey tracking

Mandatory, tracked step:

- **At the start:** `node scripts/journey.mjs start to-work`
- **When all AFK slices are built (or the run is otherwise complete):** `node scripts/journey.mjs done to-work`

If `scripts/journey.mjs` is missing, skip these silently.

## The shared progress file

`scripts/progress.mjs` maintains `.flynet/progress.json` — the single source of truth for slice status, shared between every subagent and the dev drawer's Progress view (which polls `/api/dev/progress`). Always update status through the script, never by hand-editing the JSON — the script takes a lock and writes atomically so parallel agents don't corrupt it.

Status values: `pending` · `in_progress` · `done` · `blocked` · `failed`.

## Process

### 1. Identify the feature and seed the tracker

Find the `<feature-slug>` (ask, or infer from the most recent `.scratch/*/issues/` directory). Then seed the shared file from the task files:

```
node scripts/progress.mjs seed --feature <feature-slug>
```

This creates one `pending` task per `NN-slug.md` file. Confirm with `node scripts/progress.mjs list`.

### 2. Plan the wave

Read each task file. Build a dependency graph from the **Blocked by** fields. Only **AFK** slices with no unmet blockers are eligible to run now. HITL slices, and slices blocked by unfinished work, wait.

Tell the user which slices you're about to dispatch in this wave, and which are held back (and why). Get a quick go-ahead.

### 3. Dispatch one subagent per eligible slice

Spawn the eligible slices **in parallel** using the Agent tool (one agent per slice). Give each subagent this brief, filled in for its slice:

<subagent-brief>
You are building ONE vertical slice of <feature-slug>: task <NN> — "<title>".

Read the full task at `.scratch/<feature-slug>/issues/<NN>-<slug>.md`. Read `CONTEXT.md` and any relevant `docs/adr/` for domain vocabulary and prior decisions.

Lifecycle — report status through the shared tracker as you go:
1. On start: `node scripts/progress.mjs set --id <NN> --status in_progress --agent "slice-<NN>"`
2. Build the slice test-first (red → green → refactor; see the tdd skill). Stay strictly within this slice's acceptance criteria — do not touch other slices.
3. When the acceptance criteria pass, COMMIT just this slice's changes:
   `git add -A && git commit -m "<NN>: <title>"`
   Capture the commit sha.
4. On success: `node scripts/progress.mjs set --id <NN> --status done --commit <sha>`
   If you cannot finish: `node scripts/progress.mjs set --id <NN> --status blocked --note "<one-line reason>"` (or `failed` for a hard error), then stop.

Constraints:
- One commit per task (this task). Don't bundle other work.
- Don't edit files outside your slice. If you discover you need another slice's work, mark yourself `blocked` with the reason rather than reaching into it.
- Keep the working tree releasable — never commit something that doesn't build.

Return a one-line summary: task id, final status, commit sha (if any).
</subagent-brief>

Run agents in a git worktree per slice (isolation) if your tooling supports it and slices would otherwise collide on the same files; otherwise dispatch them directly and let the per-task commits serialize naturally.

### 4. Reconcile and run the next wave

When a wave finishes, run `node scripts/progress.mjs list`. Any slice that just went `done` may unblock others. Recompute eligibility and dispatch the next wave. Repeat until no eligible AFK slices remain.

Surface HITL slices and anything `blocked`/`failed` to the user — those need a human. Don't silently leave them; report them plainly with the recorded reason.

### 5. Finish

When the AFK slices are done (or the remainder genuinely needs a human), summarize:

- which slices landed, with commit shas
- which are blocked/failed and why
- which HITL slices remain

Then mark the journey step done (step 0). The user can watch the whole thing live in the dev drawer's **Progress** view throughout.
