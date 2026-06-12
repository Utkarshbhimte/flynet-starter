import { NextResponse } from "next/server";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { blockInProduction } from "../../../../lib/dev-only";

// Backend for the dev onboarding drawer's first step: report whether
// BLACKBIRD_API_KEY is configured, and let the developer write it into
// .env.local from the UI. Dev-only — see lib/dev-only.ts.
const ENV_PATH = join(process.cwd(), ".env.local");
const KEY = "BLACKBIRD_API_KEY";

// Show enough of the key to recognise it without leaking the whole secret.
function mask(value: string): string {
  if (value.length <= 4) return "••••";
  return `${"•".repeat(Math.min(value.length - 4, 12))}${value.slice(-4)}`;
}

// GET → is the key set, and a masked preview if so.
export async function GET() {
  const blocked = blockInProduction();
  if (blocked) return blocked;

  const value = process.env[KEY]?.trim() ?? "";
  return NextResponse.json({
    isSet: Boolean(value),
    masked: value ? mask(value) : null,
  });
}

// POST { apiKey } → persist the key into .env.local (creating it if needed) and
// reflect it in the running process so a follow-up GET shows it set even before
// Next's dev server picks up the file change.
export async function POST(req: Request) {
  const blocked = blockInProduction();
  if (blocked) return blocked;

  let body: { apiKey?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const apiKey = body.apiKey?.trim();
  if (!apiKey) {
    return NextResponse.json({ error: "apiKey is required." }, { status: 400 });
  }

  // Read the existing file — it may not exist yet on a fresh checkout.
  let contents = "";
  try {
    contents = await readFile(ENV_PATH, "utf8");
  } catch {
    contents = "";
  }

  const line = `${KEY}="${apiKey}"`;
  const keyPattern = new RegExp(`^${KEY}=.*$`, "m");
  if (keyPattern.test(contents)) {
    // Replace whatever value (blank or stale) is already on that line.
    contents = contents.replace(keyPattern, line);
  } else {
    // Append on its own line, keeping the file newline-terminated.
    const sep = contents.length && !contents.endsWith("\n") ? "\n" : "";
    contents = `${contents}${sep}${line}\n`;
  }

  await writeFile(ENV_PATH, contents, "utf8");
  process.env[KEY] = apiKey;

  return NextResponse.json({ isSet: true, masked: mask(apiKey) });
}
