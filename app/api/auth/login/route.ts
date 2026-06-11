import { type NextRequest, NextResponse } from "next/server";
import {
  HANDSHAKE_COOKIE,
  appUrl,
  cookieOptions,
  makeOAuth,
} from "../../../../lib/auth";

// Start the OAuth authorization-code + PKCE flow: generate the PKCE pair and
// CSRF state, park them in a short-lived HttpOnly cookie, and send the member
// to Blackbird's consent screen. The callback route picks the flow back up.
export async function GET(req: NextRequest) {
  const oauth = makeOAuth();
  if (!oauth) {
    return NextResponse.redirect(
      appUrl("/?auth_error=missing_client_config", req.url),
    );
  }

  const { url, state, codeVerifier } = await oauth.getAuthorizeUrl();

  const res = NextResponse.redirect(url);
  res.cookies.set(HANDSHAKE_COOKIE, JSON.stringify({ state, codeVerifier }), {
    ...cookieOptions,
    maxAge: 10 * 60, // the flow must complete within 10 minutes
  });
  return res;
}
