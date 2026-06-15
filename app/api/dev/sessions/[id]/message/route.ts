import { NextResponse } from "next/server";
import { blockInProduction, blockNonLocal } from "../../../../../../lib/dev-only";
import { daemonFetch } from "../../../../../../lib/dev-sessions";

// Send a follow-up user message to a running session. If the underlying claude
// process has since died (daemon restart, crash), the daemon transparently
// resumes it from persisted context before delivering the message. Dev/local
// only — see lib/dev-only.ts.

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const blocked = blockInProduction() ?? blockNonLocal(req);
  if (blocked) return blocked;

  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  try {
    const res = await daemonFetch(
      `/sessions/${encodeURIComponent(id)}/message`,
      { method: "POST", body: JSON.stringify(body) },
    );
    return NextResponse.json(await res.json(), { status: res.status });
  } catch {
    return NextResponse.json({ error: "Daemon unreachable." }, { status: 503 });
  }
}
