import { type NextRequest, NextResponse } from "next/server";
import {
  ACCESS_COOKIE,
  HANDSHAKE_COOKIE,
  REFRESH_COOKIE,
  REFRESH_MAX_AGE,
  appUrl,
  cookieOptions,
  makeOAuth,
} from "../../lib/auth";

// OAuth callback (the registered redirect URI, /callback). Verifies the CSRF
// state set by /api/auth/login, exchanges the single-use authorization code
// server-side (with CLIENT_SECRET + the PKCE verifier), and stores the tokens
// in HttpOnly cookies before bouncing back to the homepage.
export async function GET(req: NextRequest) {
  const home = (error?: string) =>
    NextResponse.redirect(
      appUrl(error ? `/?auth_error=${error}` : "/", req.url),
    );

  const code = req.nextUrl.searchParams.get("code");
  const state = req.nextUrl.searchParams.get("state");
  const pendingRaw = req.cookies.get(HANDSHAKE_COOKIE)?.value;
  if (!code || !state || !pendingRaw) return home("missing_code_or_state");

  let pending: { state: string; codeVerifier: string };
  try {
    pending = JSON.parse(pendingRaw);
  } catch {
    return home("bad_handshake");
  }
  if (pending.state !== state) return home("state_mismatch");

  const oauth = makeOAuth();
  if (!oauth) return home("missing_client_config");

  try {
    const tokens = await oauth.exchangeCode({
      code,
      codeVerifier: pending.codeVerifier,
    });

    const res = home();
    res.cookies.delete(HANDSHAKE_COOKIE);
    res.cookies.set(ACCESS_COOKIE, tokens.access_token, {
      ...cookieOptions,
      maxAge: tokens.expires_in,
    });
    if (tokens.refresh_token) {
      res.cookies.set(REFRESH_COOKIE, tokens.refresh_token, {
        ...cookieOptions,
        maxAge: REFRESH_MAX_AGE,
      });
    }
    return res;
  } catch {
    return home("exchange_failed");
  }
}
