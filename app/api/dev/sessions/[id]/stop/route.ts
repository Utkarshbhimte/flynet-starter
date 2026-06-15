import { NextResponse } from "next/server";
import { blockInProduction, blockNonLocal } from "../../../../../../lib/dev-only";
import { daemonFetch } from "../../../../../../lib/dev-sessions";

// Stop (SIGTERM) a session's running claude process. The transcript is kept, so
// the session can be resumed later. Dev/local only — see lib/dev-only.ts.

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const blocked = blockInProduction() ?? blockNonLocal(req);
  if (blocked) return blocked;

  const { id } = await params;
  try {
    const res = await daemonFetch(`/sessions/${encodeURIComponent(id)}/stop`, {
      method: "POST",
    });
    return NextResponse.json(await res.json(), { status: res.status });
  } catch {
    return NextResponse.json({ error: "Daemon unreachable." }, { status: 503 });
  }
}
