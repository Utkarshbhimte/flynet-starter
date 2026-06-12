---
name: to-plan
description: Turn a scoped idea into a PRD and slice it into thin, independently-buildable tasks — all written to the local filesystem under .scratch/. Use when the user wants to plan a feature, write a spec, or break work into tasks. Merges the old to-prd and to-issues into one local-first step.
---

# To Plan

One step that produces two artifacts on the **local filesystem** — no GitHub, no Linear:

1. A **PRD** at `.scratch/<feature-slug>/PRD.md`
2. A set of **task files** at `.scratch/<feature-slug>/issues/NN-slug.md`, numbered from `01`

This is the third step of the hackathon dev journey (after `grill-with-docs`, optionally `prototype`). It is the merge of the older `to-prd` and `to-issues` skills.

## Journey tracking

This is a mandatory, tracked step. Run these so the dev drawer's Prompts view reflects reality:

- **At the start:** `node scripts/journey.mjs start to-plan`
- **When the user approves the plan and the files are written:** `node scripts/journey.mjs done to-plan`

If `scripts/journey.mjs` doesn't exist, skip these silently — the tracker is optional tooling.

## Hackathon posture

This is a hackathon. The plan's job is to get to building fast, not to be exhaustive.

- **Cut hard.** If the grilling step already scoped the idea, hold that line — don't let the PRD re-expand it. Push anything non-essential into **Out of Scope**.
- **Prefer fewer, thinner slices.** A slice you can build and demo in well under an hour beats a "proper" one that takes three.
- **Skip ceremony.** A short PRD is fine. The user stories list can be modest if the feature is small. Don't pad it.
- If the idea is tiny enough to hold in your head, say so and offer to skip straight to slicing — the PRD can be a few lines.

## Process

### 1. Gather context

Work from what's already in the conversation (the grilling session, any prototype). Read `CONTEXT.md` and `docs/adr/` at the repo root if they exist, so the PRD and task titles use the project's domain vocabulary and respect prior decisions. If those files don't exist, proceed silently — `grill-with-docs` creates them lazily.

If you haven't explored the codebase yet, do a quick pass to ground the plan in the real current state.

### 2. Pick the feature slug and seams

Choose a short kebab-case `<feature-slug>`. Sketch the **seams** where the feature will be tested — prefer existing seams, use the highest one possible. Check with the user that the seams match their expectations.

### 3. Write the PRD

Write `.scratch/<feature-slug>/PRD.md` using the template below. Do NOT interview the user from scratch — synthesize what you already know from the journey so far.

<prd-template>

## Problem Statement

The problem the user is facing, from the user's perspective.

## Solution

The solution to the problem, from the user's perspective.

## User Stories

A numbered list of user stories, format: `As an <actor>, I want a <feature>, so that <benefit>`. Keep it proportional to the feature — extensive for a real feature, modest for a small one.

## Implementation Decisions

Modules to build/modify, their interfaces, technical clarifications, architectural decisions, schema changes, API contracts. No specific file paths or code snippets — they go stale. Exception: a prototype-derived snippet that encodes a decision more precisely than prose (state machine, reducer, schema, type shape) — inline the decision-rich bits and note it came from a prototype.

## Testing Decisions

What makes a good test here (test external behavior, not implementation), which modules get tested, and prior art for those tests in the codebase.

## Out of Scope

What is explicitly NOT being built. For a hackathon, this section earns its keep — be generous.

## Further Notes

Anything else.

</prd-template>

### 4. Draft vertical slices

Break the PRD into **tracer-bullet** tasks. Each task is a thin vertical slice that cuts through ALL layers end-to-end (schema, API, UI, tests) — NOT a horizontal slice of one layer.

<vertical-slice-rules>
- Each slice delivers a narrow but COMPLETE path through every layer
- A completed slice is demoable or verifiable on its own
- Prefer many thin slices over few thick ones
- Mark each slice AFK (an agent can build it unattended) or HITL (needs a human decision/review). Prefer AFK — the `to-work` step builds AFK slices in parallel.
</vertical-slice-rules>

### 5. Quiz the user

Present the breakdown as a numbered list. For each slice show: **Title**, **Type** (AFK/HITL), **Blocked by** (which slices must finish first), **User stories covered**. Ask:

- Does the granularity feel right? (too coarse / too fine)
- Are the dependencies correct?
- Should any slices merge or split?
- Are AFK/HITL marked correctly?

Iterate until the user approves.

### 6. Write the task files

For each approved slice, write `.scratch/<feature-slug>/issues/NN-slug.md`, numbered from `01` in dependency order (blockers first). Use the template below. The numbering matters: `to-work` and `scripts/progress.mjs seed` key tasks off the `NN` prefix.

<task-template>
# <Short descriptive title>

**Type:** AFK | HITL
**Status:** ready
**Blocked by:** <NN of blocking task, or "None — can start immediately">

## What to build

A concise description of this vertical slice — the end-to-end behavior, not layer-by-layer implementation. Avoid file paths and code snippets (they go stale) unless a prototype produced a decision-encoding snippet worth inlining.

## Acceptance criteria

- [ ] Criterion 1
- [ ] Criterion 2

## Comments

<!-- conversation/history appended here over time -->
</task-template>

### 7. Hand off

Tell the user the PRD and N task files are written under `.scratch/<feature-slug>/`, mark the journey step done (step 0 above), and point them at the next step: run `/to-work` to build the AFK slices in parallel.
