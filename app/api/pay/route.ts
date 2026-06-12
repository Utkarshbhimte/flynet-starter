import { NextResponse } from "next/server";
import {
  FlynetError,
  FlynetMemberClient,
  getAuthenticatedUserId,
} from "@flynetdev/core";
import { resolveAccessToken } from "../../../lib/session";

// Blackbird Pay, server-side: create a Payment Intent and immediately confirm
// it for the signed-in member. Runs on the server because the merchant id and
// the intent lifecycle belong on the backend; the browser only says "pay".
// The member token comes from resolveAccessToken (ACCESS_TOKEN env var or the
// OAuth session cookie) and needs the write:payment_intent scope.
export async function POST(req: Request) {
  const accessToken = await resolveAccessToken();
  if (!accessToken) {
    return NextResponse.json(
      { error: "Not signed in — no member token." },
      { status: 401 },
    );
  }

  const merchantId = process.env.FLYNET_MERCHANT_ID;
  if (!merchantId) {
    return NextResponse.json(
      { error: "FLYNET_MERCHANT_ID is not set in .env.local." },
      { status: 500 },
    );
  }

  let body: { amountFlyWei?: string; description?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }
  // Wei is a stringified integer (18 decimals) — never a JS number.
  if (!body.amountFlyWei || !/^[1-9][0-9]*$/.test(body.amountFlyWei)) {
    return NextResponse.json(
      { error: "amountFlyWei must be a positive integer string (FLY wei)." },
      { status: 400 },
    );
  }

  // API_BASE_URL switches environments; unset means production.
  const member = new FlynetMemberClient({
    accessToken,
    serverURL: process.env.API_BASE_URL || "https://api.blackbird.xyz/flynet/v1",
  });
  const userId = getAuthenticatedUserId(accessToken);

  try {
    const intent = await member.createPaymentIntent({
      flynetMerchantId: merchantId,
      customerUserId: userId,
      amount: { value: body.amountFlyWei, currency: "FLY" },
      description: body.description ?? "Flynet starter demo payment",
      // Demo: every click is a new order. In a real app, pass your order id so
      // retries dedupe onto the same intent instead of double-charging.
      idempotencyKey: crypto.randomUUID(),
    });

    const paid = await member.confirmPaymentIntent({
      id: intent.id,
      body: { userId },
    });

    return NextResponse.json({
      id: paid.id,
      status: paid.status,
      paidAt: paid.paidAt,
      amount: paid.amount,
    });
  } catch (error) {
    if (error instanceof FlynetError) {
      return NextResponse.json(
        { error: error.message, kind: error.kind, code: error.code },
        { status: error.status ?? 502 },
      );
    }
    return NextResponse.json(
      { error: "Unexpected error creating the payment." },
      { status: 500 },
    );
  }
}
