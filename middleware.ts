import { type NextRequest, NextResponse } from "next/server";
import {
  ACCESS_COOKIE,
  REFRESH_COOKIE,
  REFRESH_MAX_AGE,
  appUrl,
  cookieOptions,
  makeOAuth,
} from "./lib/auth";

// Silent session refresh (OAuth step 4). When the 60-minute access token has
// aged out of its cookie but a refresh token remains, rotate it at /oauth/token
// and re-set both cookies, so a returning member stays signed in without
// re-running the consent flow.
export async function middleware(req: NextRequest) {
  const refreshToken = req.cookies.get(REFRESH_COOKIE)?.value;
  if (req.cookies.get(ACCESS_COOKIE) || !refreshToken) {
    return NextResponse.next();
  }

  const oauth = makeOAuth();
  if (!oauth) return NextResponse.next();

  try {
    const tokens = await oauth.refresh({ refreshToken });
    const res = NextResponse.redirect(
      appUrl(req.nextUrl.pathname + req.nextUrl.search, req.nextUrl),
    );
    res.cookies.set(ACCESS_COOKIE, tokens.access_token, {
      ...cookieOptions,
      maxAge: tokens.expires_in,
    });
    if (tokens.refresh_token) {
      // Refresh tokens are single-use and rotate on every refresh.
      res.cookies.set(REFRESH_COOKIE, tokens.refresh_token, {
        ...cookieOptions,
        maxAge: REFRESH_MAX_AGE,
      });
    }
    return res;
  } catch {
    // Expired or already-used refresh token — clear it and fall back to the
    // signed-out state; the page will offer the sign-in flow.
    const res = NextResponse.next();
    res.cookies.delete(REFRESH_COOKIE);
    return res;
  }
}

export const config = { matcher: ["/"] };
