"use client";

import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { FlynetMemberClient } from "@flynetdev/core";
import {
  FlynetProvider,
  WalletBadge,
  profileQueryKey,
  useFlynetMember,
  walletsQueryKey,
} from "@flynetdev/react";
import { BBPayButton, UserCard } from "../components";

// Member components run in the browser and read from the FlynetProvider. The
// member client holds the OAuth token and fetches client-side, so this is a
// Client Component. The token is passed down from the server (page.tsx).
export function MemberPanel({ accessToken }: { accessToken: string }) {
  const member = useMemo(
    () =>
      new FlynetMemberClient({
        accessToken,
        // The Blackbird edge blocks cross-origin browser requests (CORS), so
        // route them through the same-origin proxy defined in next.config.mjs.
        // The SDK requires an absolute URL; window is always defined by fetch
        // time.
        ...(typeof window !== "undefined"
          ? { serverURL: `${window.location.origin}/flynet-proxy` }
          : {}),
      }),
    [accessToken],
  );

  return (
    <FlynetProvider member={member}>
      <section className="space-y-3">
        <h2 className="text-xs uppercase tracking-[0.16em] text-muted">
          Your Blackbird account
        </h2>
        <MemberProfile />
        <WalletBadge display="fly-and-usd" />
        <PaySection />
      </section>
    </FlynetProvider>
  );
}

// Demo charge: 1 FLY (wei is a stringified integer, 18 decimals). The USD
// label is display-only — the v1 API is FLY-denominated, with ~1 FLY ≈ $1.
const DEMO_AMOUNT_FLY_WEI = "1000000000000000000";
const DEMO_AMOUNT_USD_CENTS = 100;

// Blackbird Pay, wired for real: POST /api/pay creates and confirms a Payment
// Intent server-side with whichever token the app is running on (ACCESS_TOKEN
// env var or the OAuth session cookie). Lives inside the provider so a
// successful payment can invalidate the wallet query and refresh the balance.
function PaySection() {
  const queryClient = useQueryClient();
  const [pay, setPay] = useState<{
    phase: "idle" | "paying" | "paid" | "error";
    message?: string;
  }>({ phase: "idle" });

  async function handlePay() {
    setPay({ phase: "paying" });
    try {
      const res = await fetch("/api/pay", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          amountFlyWei: DEMO_AMOUNT_FLY_WEI,
          description: "Flynet starter demo payment",
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error ?? `Payment failed (HTTP ${res.status}).`);
      }
      setPay({ phase: "paid", message: `Paid — intent ${data.id}` });
      // The balance changed upstream; refetch the wallet badge.
      queryClient.invalidateQueries({ queryKey: walletsQueryKey });
    } catch (error) {
      setPay({
        phase: "error",
        message:
          error instanceof Error ? error.message : "Payment failed.",
      });
    }
  }

  return (
    <div className="space-y-2 pt-2">
      <BBPayButton
        amountUsdCents={DEMO_AMOUNT_USD_CENTS}
        onPay={handlePay}
        disabled={pay.phase === "paying"}
      />
      {pay.phase === "paying" ? (
        <p className="text-xs text-subtle">Paying…</p>
      ) : null}
      {pay.phase === "paid" ? (
        <p className="text-xs text-success">{pay.message}</p>
      ) : null}
      {pay.phase === "error" ? (
        <p className="text-xs text-failure">{pay.message}</p>
      ) : null}
      {pay.phase === "idle" ? (
        <p className="text-xs text-subtle">
          Demo payment — 1 FLY to the starter merchant, created and confirmed
          server-side.
        </p>
      ) : null}
    </div>
  );
}

// Lives inside the provider so the hook can reach the member client. Fetches
// only the profile (`GET /users/me`) — the SDK's usePassport also fetches
// /users/me/status and fails the whole card when either call fails, and the
// card only renders profile fields anyway.
function MemberProfile() {
  const member = useFlynetMember();
  const { data, isPending, error } = useQuery({
    queryKey: profileQueryKey,
    queryFn: () => member.getProfile(),
  });

  if (isPending) {
    return (
      <div className="h-20 animate-pulse rounded-2xl bg-surface-low" aria-hidden />
    );
  }
  if (error || !data) {
    return (
      <p className="rounded-2xl border border-failure/40 p-4 text-sm text-failure">
        We couldn&apos;t load your profile.
      </p>
    );
  }
  return <UserCard user={data} />;
}
