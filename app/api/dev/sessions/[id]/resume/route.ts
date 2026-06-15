import { NextResponse } from "next/server";
import { blockInProduction, blockNonLocal } from "../../../../../../lib/dev-only";
import { daemonFetch } from "../../../../../../lib/dev-sessions";

// Re-spawn a session's claude process from persisted context (claude --resume).
// Used to recover a session whose process died — e.g. the daemon was killed or
// the machine slept. Dev/local only — see lib/dev-only.ts.

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const blocked = blockInProduction() ?? blockNonLocal(req);
  if (blocked) return blocked;

  const { id } = await params;
  try {
    const res = await daemonFetch(`/sessions/${encodeURIComponent(id)}/resume`, {
      method: "POST",
    });
    return NextResponse.json(await res.json(), { status: res.status });
  } catch {
    return NextResponse.json({ error: "Daemon unreachable." }, { status: 503 });
  }
}
