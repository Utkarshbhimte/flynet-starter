import { NextResponse } from "next/server";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { join } from "node:path";
import { blockInProduction } from "../../../../lib/dev-only";

// Backend for the dev onboarding drawer's second step: run a bash script that
// probes ngrok's local inspection API and report whether a tunnel is up (and on
// what URL). Dev-only — see lib/dev-only.ts.
const exec = promisify(execFile);
const SCRIPT = join(process.cwd(), "scripts", "check-ngrok.sh");

type NgrokStatus = { running: boolean; url: string | null };

export async function GET() {
  const blocked = blockInProduction();
  if (blocked) return blocked;

  try {
    // The script always prints JSON and exits 0; a 5s timeout guards against a
    // wedged curl. `bash <script>` avoids depending on the file's +x bit.
    const { stdout } = await exec("bash", [SCRIPT], { timeout: 5000 });
    const result = JSON.parse(stdout.trim()) as NgrokStatus;
    return NextResponse.json(result);
  } catch {
    // Script missing, bash absent, or unparseable output — treat as "not up".
    return NextResponse.json({ running: false, url: null } satisfies NgrokStatus);
  }
}
