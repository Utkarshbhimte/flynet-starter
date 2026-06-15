import { NextResponse } from "next/server";
import { env } from "./env";

// Guard for developer-tooling API routes (the onboarding drawer's backend).
// These routes read and write .env.local and shell out to local scripts — they
// must never be reachable in a production build. Call this at the top of each
// handler and return its result when non-null.
export function blockInProduction(): NextResponse | null {
  if (env.NODE_ENV === "production") {
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  }
  return null;
}

// Loopback hosts the dev tooling is allowed to be reached on. `localhost` and
// the IPv4/IPv6 loopback literals cover every way a local browser addresses the
// dev server.
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);

// Reject requests that didn't originate from the local machine. The dev routes
// are only NODE_ENV-gated, but this app actively encourages `next dev` behind an
// ngrok tunnel (the ngrok step in the drawer) — and ngrok forwards :3000, so
// without this guard a public tunnel URL could write .env.local or, far worse,
// drive Claude Code on the developer's machine via the Sessions routes. ngrok
// sends its own hostname in Host/X-Forwarded-Host by default, so checking the
// host is a reliable, dependency-free way to tell local from tunneled traffic.
//
// Call alongside blockInProduction() at the top of every dev route.
export function blockNonLocal(req: Request): NextResponse | null {
  // A forwarded host means a proxy (ngrok, a deploy) sits in front of us.
  const forwarded = req.headers.get("x-forwarded-host");
  if (forwarded) {
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  }
  const host = (req.headers.get("host") ?? "").split(":")[0];
  if (!LOCAL_HOSTS.has(host)) {
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  }
  return null;
}
