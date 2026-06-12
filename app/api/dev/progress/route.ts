import { NextResponse } from "next/server";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { blockInProduction } from "../../../../lib/dev-only";

// Backend for the dev drawer's Progress view. The `/to-work` skill spawns one
// subagent per vertical slice; each agent records its status into a shared
// .flynet/progress.json via scripts/progress.mjs. This route just reads that
// file so the UI can poll it. Dev-only — see lib/dev-only.ts.
const PROGRESS_PATH = join(process.cwd(), ".flynet", "progress.json");

type Task = {
  id: string;
  title: string;
  issue: string | null;
  status: "pending" | "in_progress" | "done" | "blocked" | "failed";
  agent: string | null;
  commit: string | null;
  note: string | null;
  updatedAt: string;
};

type Progress = {
  feature: string | null;
  createdAt: string;
  updatedAt: string;
  tasks: Task[];
};

export async function GET() {
  const blocked = blockInProduction();
  if (blocked) return blocked;

  let raw: string;
  try {
    raw = await readFile(PROGRESS_PATH, "utf8");
  } catch {
    // No run in flight yet — the file only exists once `/to-work` starts.
    return NextResponse.json({ exists: false });
  }

  try {
    const data = JSON.parse(raw) as Progress;
    return NextResponse.json({ exists: true, ...data });
  } catch {
    // A writer may be mid-rename; report a soft error so the UI keeps polling.
    return NextResponse.json({ exists: true, parseError: true });
  }
}
