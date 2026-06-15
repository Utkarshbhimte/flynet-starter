import { blockInProduction, blockNonLocal } from "../../../../../../lib/dev-only";
import { daemonTarget } from "../../../../../../lib/dev-sessions";

// SSE stream of a session's events, proxied from the daemon. The client passes
// ?cursor=<last seq it saw>; the daemon replays everything after that, then
// tails live. So a dropped connection — page reload, next dev restart, network
// blip — reconnects with its last cursor and misses nothing. Dev/local only.
export const dynamic = "force-dynamic";

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const blocked = blockInProduction() ?? blockNonLocal(req);
  if (blocked) return blocked;

  const { id } = await params;
  const cursor = new URL(req.url).searchParams.get("cursor") ?? "-1";

  let target;
  try {
    target = await daemonTarget();
  } catch {
    return new Response("daemon unreachable", { status: 503 });
  }

  // Open the upstream SSE and pass its body straight through. Forward the
  // client's abort so closing the tab tears down the daemon subscription too.
  const upstream = await fetch(
    `${target.base}/sessions/${encodeURIComponent(id)}/stream?cursor=${cursor}`,
    {
      headers: { "x-daemon-token": target.token },
      signal: req.signal,
    },
  );

  if (!upstream.ok || !upstream.body) {
    return new Response("stream unavailable", { status: upstream.status || 502 });
  }

  return new Response(upstream.body, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
