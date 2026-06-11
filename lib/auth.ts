import { FlynetOAuth } from "@flynetdev/core";

// Server-only OAuth wiring (Token-Mediating Backend, per the Flynet docs):
// the backend holds CLIENT_SECRET and the refresh token; the browser only ever
// sees the short-lived access token. Never import this from a Client Component.

/** Short-lived member access token (60 min, mirrors the token's expires_in). */
export const ACCESS_COOKIE = "bb_access";
/** Rotating refresh token (up to 30 days, single-use — rotated on every refresh). */
export const REFRESH_COOKIE = "bb_refresh";
/** PKCE state + verifier parked between the authorize redirect and the callback. */
export const HANDSHAKE_COOKIE = "bb_oauth_pending";

export const REFRESH_MAX_AGE = 30 * 24 * 60 * 60;

// Everything the member routes + components need, including the pay button
// (payment intents are scope-gated). Scope names are exact-match
// ("read:profiles" is rejected) and routes outside these return 403.
export const SCOPES = [
  "read:profile",
  "read:wallets",
  "read:checkins",
  "read:payment_intent",
  "write:payment_intent",
];

export const cookieOptions = {
  httpOnly: true,
  sameSite: "lax",
  secure: process.env.NODE_ENV === "production",
  path: "/",
} as const;

/**
 * Where browser-facing auth redirects land. Behind a tunnel (ngrok) the
 * request URL the server sees carries the local host, not the public one — so
 * derive the public origin from REDIRECT_URI (the OAuth session's cookies live
 * on that host by definition) and fall back to the request URL without it.
 */
export function appUrl(path: string, requestUrl: string | URL): URL {
  return new URL(path, process.env.REDIRECT_URI || requestUrl);
}

/** Build the SDK's OAuth helper from env, or null when the app isn't configured. */
export function makeOAuth(): FlynetOAuth | null {
  const clientId = process.env.CLIENT_ID;
  const clientSecret = process.env.CLIENT_SECRET;
  if (!clientId || !clientSecret) return null;
  return new FlynetOAuth({
    clientId,
    clientSecret,
    redirectUri: process.env.REDIRECT_URI ?? "http://localhost:3000/callback",
    scopes: SCOPES,
    // Unset means the SDK's staging default. For production set AUTH_BASE_URL
    // (e.g. https://api.blackbird.xyz/oauth) — there's no named "production"
    // environment in the SDK yet.
    authBaseUrl: process.env.AUTH_BASE_URL || undefined,
    // The audience the token is minted for — the staging API gateway. Note the
    // hyphen (api-staging): that's the auth tenant form used in token claims.
    audience: process.env.AUTH_AUDIENCE || "https://api-staging.blackbird.xyz/flynet",
  });
}
