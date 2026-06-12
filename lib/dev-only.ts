import { NextResponse } from "next/server";

// Guard for developer-tooling API routes (the onboarding drawer's backend).
// These routes read and write .env.local and shell out to local scripts — they
// must never be reachable in a production build. Call this at the top of each
// handler and return its result when non-null.
export function blockInProduction(): NextResponse | null {
  if (process.env.NODE_ENV === "production") {
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  }
  return null;
}
