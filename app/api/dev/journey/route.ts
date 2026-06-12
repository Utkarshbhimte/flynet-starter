import { NextResponse } from "next/server";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { blockInProduction } from "../../../../lib/dev-only";

// Backend for the dev drawer's Prompts view. The mandatory journey skills
// (grill-with-docs → to-plan → to-work) record their step status into
// .flynet/journey.json via scripts/journey.mjs as they're triggered and
// completed. This route reads that file so the UI can show each step's status.
// Dev-only — see lib/dev-only.ts.
const JOURNEY_PATH = join(process.cwd(), ".flynet", "journey.json");

type StepState = {
  status: "not_started" | "in_progress" | "done";
  startedAt?: string;
  completedAt?: string;
};

type Journey = {
  updatedAt: string;
  steps: Record<string, StepState>;
};

export async function GET() {
  const blocked = blockInProduction();
  if (blocked) return blocked;

  let raw: string;
  try {
    raw = await readFile(JOURNEY_PATH, "utf8");
  } catch {
    // No journey started yet — nothing has been triggered.
    return NextResponse.json({ exists: false });
  }

  try {
    const data = JSON.parse(raw) as Journey;
    return NextResponse.json({ exists: true, ...data });
  } catch {
    return NextResponse.json({ exists: true, parseError: true });
  }
}
