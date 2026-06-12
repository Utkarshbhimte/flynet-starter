import type { ReactNode } from "react";
import { cookies } from "next/headers";
import { FlynetDiscoveryClient, FlynetError } from "@flynetdev/core";
import type { Restaurant } from "@flynetdev/react";
import { LoginButton, LogoutButton, RestaurantCard } from "../components";
import { ACCESS_COOKIE } from "../lib/auth";
import { listRestaurantLocations } from "../lib/locations";
import { MemberPanel } from "./member-panel";

// The whole starter in one screen:
//   1. Read restaurants from Flynet Discovery (server-side, with your API key).
//   2. The member section: an ACCESS_TOKEN env var wins if set; otherwise the
//      OAuth session cookie (set by the sign-in flow); otherwise a sign-in button.
//
// Discovery runs HERE, on the server. The API key is read from the environment
// and never reaches the browser — that is the one security rule that matters.
export default async function Home({
  searchParams,
}: {
  searchParams: Promise<{ auth_error?: string }>;
}) {
  const apiKey = process.env.FLYNET_API_KEY;
  const { auth_error: authError } = await searchParams;
  const cookieToken = (await cookies()).get(ACCESS_COOKIE)?.value;
  const accessToken = process.env.ACCESS_TOKEN || cookieToken;
  const signedInViaOAuth = !process.env.ACCESS_TOKEN && Boolean(cookieToken);

  return (
    <main className="mx-auto max-w-2xl space-y-10 p-10">
      <header>
        <p className="text-xs uppercase tracking-[0.2em] text-primary">
          Flynet Starter
        </p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight">
          Build on Blackbird
        </h1>
        <p className="mt-2 text-muted">
          Real restaurant data from the Flynet API, rendered with the SDK.
        </p>
      </header>

      {await renderRestaurants(apiKey)}

      {authError ? <AuthErrorNotice error={authError} /> : null}

      {accessToken ? (
        <>
          <MemberPanel accessToken={accessToken} />
          {signedInViaOAuth ? <LogoutButton href="/api/auth/logout" /> : null}
        </>
      ) : (
        <SignInNotice />
      )}

      {/* 👉 Your code goes here.
          The branded building blocks live in ./components — RestaurantCard,
          UserCard, Tag, BBPayButton, LoginButton. The SDK's own catalog and
          hooks live in @flynetdev/react. */}
    </main>
  );
}

async function renderRestaurants(apiKey: string | undefined): Promise<ReactNode> {
  if (!apiKey) return <SetupNotice />;
  try {
    // API_BASE_URL switches environments; unset means production.
    const discovery = new FlynetDiscoveryClient({
      apiKey,
      serverURL: process.env.API_BASE_URL || "https://api.blackbird.xyz/flynet/v1",
    });
    // The list includes unpublished records with blank names (production has
    // many, and blank names sort first) — over-fetch and keep the first 8
    // that are actually presentable.
    const listed = await discovery.restaurants.listRestaurants({
      pageSize: 50,
    });
    const restaurants = listed.restaurants
      .filter((restaurant) => restaurant.name)
      .slice(0, 8);
    // Locations are a separate Discovery resource — fetch them in parallel,
    // one call per listed restaurant (raw fetch, see lib/locations.ts). A
    // failed lookup just hides the location line on that card.
    const locations = await Promise.all(
      restaurants.map((restaurant) =>
        listRestaurantLocations(apiKey, restaurant.id).catch(() => []),
      ),
    );
    return (
      <Section title="Restaurants">
        <div className="grid gap-4 sm:grid-cols-2">
          {(restaurants as Restaurant[]).map((restaurant, i) => (
            <RestaurantCard
              key={restaurant.id}
              restaurant={restaurant}
              locations={locations[i]}
            />
          ))}
        </div>
      </Section>
    );
  } catch (error) {
    const message =
      error instanceof FlynetError
        ? `${error.kind}: ${error.message}`
        : "Unexpected error.";
    return (
      <Notice tone="error" title="Couldn't load restaurants">
        {message} Check that <Code>FLYNET_API_KEY</Code> in <Code>.env.local</Code> is a
        valid Flynet key.
      </Notice>
    );
  }
}

function SetupNotice() {
  return (
    <Notice title="Add your API key to start">
      Copy <Code>.env.example</Code> to <Code>.env.local</Code> and set{" "}
      <Code>FLYNET_API_KEY</Code> to your Flynet Discovery key, then reload. You&apos;ll
      see real Blackbird restaurants here.
    </Notice>
  );
}

function SignInNotice() {
  return (
    <Notice title="Your Blackbird account">
      <span className="block">
        Sign in with Blackbird to see your wallet and passport. The OAuth flow
        runs server-side with your <Code>FLYNET_CLIENT_ID</Code> /{" "}
        <Code>FLYNET_CLIENT_SECRET</Code> and keeps the tokens in HttpOnly cookies.
        Setting <Code>ACCESS_TOKEN</Code> in <Code>.env.local</Code> skips the
        flow entirely.
      </span>
      <span className="mt-4 block">
        <LoginButton href="/api/auth/login" />
      </span>
    </Notice>
  );
}

function AuthErrorNotice({ error }: { error: string }) {
  return (
    <Notice tone="error" title="Sign-in didn't complete">
      The OAuth flow failed (<Code>{error}</Code>). Check <Code>FLYNET_CLIENT_ID</Code>,{" "}
      <Code>FLYNET_CLIENT_SECRET</Code>, and <Code>REDIRECT_URI</Code> in{" "}
      <Code>.env.local</Code>, then try again.
    </Notice>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-3">
      <h2 className="text-xs uppercase tracking-[0.16em] text-muted">
        {title}
      </h2>
      {children}
    </section>
  );
}

function Notice({
  title,
  tone = "info",
  children,
}: {
  title: string;
  tone?: "info" | "error";
  children: ReactNode;
}) {
  return (
    <div
      className={`rounded-2xl border p-5 text-sm leading-relaxed ${
        tone === "error"
          ? "border-failure/40 text-failure"
          : "border-white/10 text-muted"
      }`}
    >
      <p className="font-medium text-foreground">{title}</p>
      <p className="mt-1">{children}</p>
    </div>
  );
}

function Code({ children }: { children: ReactNode }) {
  return (
    <code className="rounded bg-white/10 px-1 py-0.5 text-foreground">
      {children}
    </code>
  );
}
