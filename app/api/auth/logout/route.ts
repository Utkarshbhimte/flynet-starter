import { type NextRequest, NextResponse } from "next/server";
import {
  ACCESS_COOKIE,
  HANDSHAKE_COOKIE,
  REFRESH_COOKIE,
  appUrl,
} from "../../../../lib/auth";

// Drop the session cookies. Tokens aren't revoked upstream — the access token
// simply ages out (60 min) and the orphaned refresh token is never used again.
export async function GET(req: NextRequest) {
  const res = NextResponse.redirect(appUrl("/", req.url));
  res.cookies.delete(ACCESS_COOKIE);
  res.cookies.delete(REFRESH_COOKIE);
  res.cookies.delete(HANDSHAKE_COOKIE);
  return res;
}
