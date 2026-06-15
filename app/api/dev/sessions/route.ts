import { NextResponse } from "next/server";
import { blockInProduction, blockNonLocal } from "../../../../lib/dev-only";
import { daemonFetch } from "../../../../lib/dev-sessions";

// Backend for the dev drawer's Sessions view: list running/past local Claude
// Code sessions, and start a new one. Thin proxy to the session daemon — the
// daemon owns the actual `claude` processes so they survive `next dev`
// restarts. Dev-only and local-only — see lib/dev-only.ts.

export async function GET(req: Request) {
  const blocked = blockInProduction() ?? blockNonLocal(req);
  if (blocked) return blocked;

  try {
    const res = await daemonFetch("/sessions");
    return NextResponse.json(await res.json(), { status: res.status });
  } catch {
    // Daemon couldn't be reached/started — report empty so the UI shows the
    // "no sessions" state rather than erroring.
    return NextResponse.json({ sessions: [], daemonDown: true });
  }
}

export async function POST(req: Request) {
  const blocked = blockInProduction() ?? blockNonLocal(req);
  if (blocked) return blocked;

  const body = await req.json().catch(() => ({}));
  // Tell the daemon where the dev server lives so it can health-check the
  // preview after each turn. blockNonLocal() guarantees this origin is local.
  body.devUrl = new URL(req.url).origin;
  try {
    const res = await daemonFetch("/sessions", {
      method: "POST",
      body: JSON.stringify(body),
    });
    return NextResponse.json(await res.json(), { status: res.status });
  } catch {
    return NextResponse.json(
      { error: "Could not start the session daemon." },
      { status: 503 },
    );
  }
}
