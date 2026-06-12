import { type NextRequest, NextResponse } from "next/server";

// Same-origin proxy for the browser-side member components. The Blackbird edge
// rejects any request carrying a localhost Origin header (403 "Invalid CORS request"),
// so a next.config rewrite — which forwards headers verbatim — doesn't work.
// This handler forwards only what the upstream needs.
// API_BASE_URL switches environments (unset = production).
const UPSTREAM =
  process.env.API_BASE_URL || "https://api.blackbird.xyz/flynet/v1";

async function proxy(
  req: NextRequest,
  { params }: { params: Promise<{ path: string[] }> },
) {
  const { path } = await params;
  const url = `${UPSTREAM}/${path.join("/")}${req.nextUrl.search}`;

  const headers = new Headers({ accept: "application/json" });
  const auth = req.headers.get("authorization");
  if (auth) headers.set("authorization", auth);
  const contentType = req.headers.get("content-type");
  if (contentType) headers.set("content-type", contentType);

  const upstream = await fetch(url, {
    method: req.method,
    headers,
    body:
      req.method === "GET" || req.method === "HEAD"
        ? undefined
        : await req.arrayBuffer(),
    cache: "no-store",
  });

  return new NextResponse(upstream.body, {
    status: upstream.status,
    headers: {
      "content-type":
        upstream.headers.get("content-type") ?? "application/json",
    },
  });
}

export {
  proxy as GET,
  proxy as POST,
  proxy as PUT,
  proxy as PATCH,
  proxy as DELETE,
};
