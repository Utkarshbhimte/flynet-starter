"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";

// Developer onboarding drawer. Renders only in dev (layout.tsx gates it on
// NODE_ENV), and its backend routes 404 in production too. It has three views,
// switched by the `view` state and a back affordance in the header:
//   • setup    — get the starter running (Blackbird credentials, ngrok tunnel).
//   • prompts  — the curated hackathon dev journey (slash commands to run, in
//                order; optional steps are badged). Pure UI, copies to clipboard.
//   • progress — live task status for a `/to-work` run, polled from
//                /api/dev/progress (which reads .flynet/progress.json).
//   • deploy   — "I'm ready to deploy": how to ship to Vercel and which env
//                vars to set there. Pure UI, copies to clipboard.
// Everything talks to /api/dev/* — nothing here touches real secrets directly.

type FieldStatus = { isSet: boolean; masked: string | null };
type NgrokStatus = { running: boolean; url: string | null };

type View = "setup" | "prompts" | "progress" | "deploy" | "sessions";

// The Blackbird credentials the setup step manages, in display order. `name`
// matches the .env.local key the backend writes; `validates` notes how the
// server checks it so the UI can explain what "Save & verify" actually does.
type CredField =
  | "FLYNET_API_KEY"
  | "FLYNET_CLIENT_ID"
  | "FLYNET_CLIENT_SECRET"
  | "REDIRECT_URI";

const CREDENTIALS: {
  name: CredField;
  label: string;
  help: string;
  // Secrets render as password fields and are masked once set; the redirect URI
  // is a plain URL, so it's shown in full to make it easy to confirm.
  secret: boolean;
  placeholder?: string;
}[] = [
  {
    name: "FLYNET_API_KEY",
    label: "Discovery API key",
    help: "Sent as X-API-Key for restaurant data. Server-side only.",
    secret: true,
  },
  {
    name: "FLYNET_CLIENT_ID",
    label: "OAuth client ID",
    help: "Powers “Sign in with Blackbird”.",
    secret: true,
  },
  {
    name: "FLYNET_CLIENT_SECRET",
    label: "OAuth client secret",
    help: "Backend-only — never reaches the browser.",
    secret: true,
  },
  {
    name: "REDIRECT_URI",
    label: "Redirect URI",
    help: "Your ngrok (or deployed) https URL + /callback. Whitelist it at bb-apis.vercel.app/redirect (sign in with your Slack email).",
    secret: false,
    placeholder: "https://<subdomain>.ngrok.app/callback",
  },
];

type CredStatus = Record<CredField, FieldStatus>;

// The curated hackathon dev journey. Not every installed skill is here — these
// are the steps that move a hackathon idea from "vague" to "shipped".
//
// `id` matches the key the skill writes into .flynet/journey.json, so the UI can
// show each mandatory step's status (not started / in progress / done). Clicking
// a card copies `prompt` — a short natural-language nudge that triggers Claude to
// use that skill.
type JourneyStep = {
  id: string;
  title: string;
  subtitle: string;
  command: string;
  prompt: string;
};

// Mandatory, linear, and completion-tracked via .flynet/journey.json.
//
// This mirrors Matt Pocock's recommended journey (grill → PRD → issues →
// implement). The upstream flow keeps PRD and issues as two steps; locally
// they're one `to-plan` run that writes both artifacts to the filesystem, so
// the "Plan it out" card covers both.
const STEPS: JourneyStep[] = [
  {
    id: "grill-with-docs",
    title: "Grill your idea",
    subtitle: "Pressure-test and scope your idea",
    command: "/grill-with-docs",
    prompt:
      "Use the grill-with-docs skill to pressure-test and scope down my hackathon idea so it's shippable in the time I have.",
  },
  {
    id: "to-plan",
    title: "Plan it out",
    subtitle: "PRD with user stories, then sliced into tickets",
    command: "/to-plan",
    prompt:
      "Use the to-plan skill to turn my scoped idea into a PRD with user stories, then slice it into thin, local tickets with blocking relationships.",
  },
  {
    id: "to-work",
    title: "Implement",
    subtitle: "Loop a coding agent over every ticket",
    command: "/to-work",
    prompt:
      "Use the to-work skill to spawn a subagent per ticket and build them in a loop, committing per task and tracking progress.",
  },
];

// Optional and supporting steps from the journey — no clear "done", so they
// live in their own section and aren't completion-tracked. Reach for them when
// they help: Research and Prototype slot in after grilling, Review comes after
// implementing. Listed in journey order.
const OTHERS: JourneyStep[] = [
  {
    id: "zoom-out",
    title: "Research",
    subtitle: "Cache the hard explore phases",
    command: "/zoom-out",
    prompt:
      "Use the zoom-out skill to research the difficult 'explore' parts of this and cache what you learn as a research.md asset I can reuse during implementation.",
  },
  {
    id: "prototype",
    title: "Prototype",
    subtitle: "Hash out ideas in code for early feedback",
    command: "/prototype",
    prompt:
      "Use the prototype skill to hash out the riskiest ideas in throwaway code for early feedback, leaving assets I can reuse in the real implementation.",
  },
  {
    id: "improve-codebase-architecture",
    title: "Review",
    subtitle: "QA plan + architecture review of the finished work",
    command: "/improve-codebase-architecture",
    prompt:
      "Use the improve-codebase-architecture skill to review the completed work — surface architectural friction and produce a QA plan a human can run against it.",
  },
  {
    id: "diagnose",
    title: "Diagnose",
    subtitle: "Disciplined loop for hard bugs",
    command: "/diagnose",
    prompt:
      "Use the diagnose skill to debug this systematically — build a fast repro, hypothesize, instrument, fix.",
  },
];

// Other components (e.g. the page's "get started" callout when env is missing)
// open the drawer by dispatching this event, so they don't need a shared store.
export const OPEN_DEV_SETUP_EVENT = "flynet:open-dev-setup";

export function DevDrawer() {
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<View>("setup");

  const close = useCallback(() => setOpen(false), []);

  // Let anything on the page open the drawer (always on the setup view).
  useEffect(() => {
    const onOpen = () => {
      setView("setup");
      setOpen(true);
    };
    window.addEventListener(OPEN_DEV_SETUP_EVENT, onOpen);
    return () => window.removeEventListener(OPEN_DEV_SETUP_EVENT, onOpen);
  }, []);

  // Escape steps back to the setup view first, then closes — so it never
  // surprises you by dismissing the whole drawer when you only meant to leave a
  // sub-view.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      setView((v) => {
        if (v !== "setup") return "setup";
        setOpen(false);
        return v;
      });
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  // Always reopen on the setup view, regardless of where we left off.
  useEffect(() => {
    if (!open) setView("setup");
  }, [open]);

  // Per-view header copy.
  const HEADER: Record<View, { eyebrow: string; title: string }> = {
    setup: { eyebrow: "Developer Setup", title: "Get this starter running" },
    prompts: { eyebrow: "Prompts", title: "Your hackathon dev journey" },
    progress: { eyebrow: "Progress", title: "Live task status" },
    deploy: { eyebrow: "Deploy", title: "Ship it to Vercel" },
    sessions: { eyebrow: "Sessions", title: "Local Claude Code" },
  };

  return (
    <>
      {/* Floating launcher — bottom-right, out of the app's way. */}
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="fixed bottom-5 right-5 z-40 inline-flex h-11 items-center gap-2 rounded-full border border-strong bg-surface px-4 text-sm font-semibold text-foreground shadow-lg transition duration-150 ease-standard hover:bg-surface-high"
        aria-label="Open developer setup"
      >
        <span className="text-base leading-none">⚙</span>
        Dev Setup
      </button>

      {/* Scrim + panel mount/unmount together, animated by framer-motion. */}
      <AnimatePresence>
        {open ? (
          <>
            <motion.div
              key="scrim"
              onClick={close}
              aria-hidden
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.2 }}
              className="fixed inset-0 z-40 bg-black/60"
            />

            <motion.aside
              key="panel"
              role="dialog"
              aria-modal="true"
              aria-label="Developer setup"
              initial={{ x: "100%" }}
              animate={{ x: 0 }}
              exit={{ x: "100%" }}
              transition={{ type: "spring", damping: 32, stiffness: 320 }}
              className="fixed inset-y-0 right-0 z-50 flex w-full max-w-md flex-col border-l border-strong bg-background-darker"
            >
              <header className="flex items-start justify-between gap-4 border-b border-strong p-6">
                <div className="flex items-start gap-3">
                  {/* Back to setup from a sub-view. */}
                  <AnimatePresence initial={false}>
                    {view !== "setup" ? (
                      <motion.button
                        key="back"
                        type="button"
                        onClick={() => setView("setup")}
                        initial={{ opacity: 0, width: 0 }}
                        animate={{ opacity: 1, width: "auto" }}
                        exit={{ opacity: 0, width: 0 }}
                        transition={{ duration: 0.15 }}
                        className="-ml-2 mt-0.5 overflow-hidden rounded-full p-2 text-muted transition hover:bg-surface hover:text-foreground"
                        aria-label="Back to setup"
                      >
                        ←
                      </motion.button>
                    ) : null}
                  </AnimatePresence>
                  {/* Header copy crossfades as the view changes. */}
                  <AnimatePresence mode="wait" initial={false}>
                    <motion.div
                      key={view}
                      initial={{ opacity: 0, y: 4 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -4 }}
                      transition={{ duration: 0.15 }}
                    >
                      <p className="text-xs uppercase tracking-[0.2em] text-primary-bright">
                        {HEADER[view].eyebrow}
                      </p>
                      <h2 className="mt-1 text-lg font-semibold tracking-tight">
                        {HEADER[view].title}
                      </h2>
                    </motion.div>
                  </AnimatePresence>
                </div>
                <button
                  type="button"
                  onClick={close}
                  className="-mr-2 -mt-1 rounded-full p-2 text-muted transition hover:bg-surface hover:text-foreground"
                  aria-label="Close"
                >
                  ✕
                </button>
              </header>

              <div className="flex-1 overflow-y-auto p-6">
                {/* Each view slides + fades in. Sub-views enter from the right
                    (drill in); setup enters from the left (back out). Keying on
                    `view` lets AnimatePresence run the exit→enter handoff. */}
                <AnimatePresence mode="wait" initial={false}>
                  <motion.div
                    key={view}
                    initial={{ opacity: 0, x: view === "setup" ? -20 : 20 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: view === "setup" ? 20 : -20 }}
                    transition={{ duration: 0.18, ease: "easeOut" }}
                    className="space-y-6"
                  >
                    {view === "setup" ? <SetupView setView={setView} /> : null}
                    {view === "prompts" ? <PromptsView /> : null}
                    {view === "progress" ? <ProgressView /> : null}
                    {view === "deploy" ? <DeployView /> : null}
                    {view === "sessions" ? <SessionsView /> : null}
                  </motion.div>
                </AnimatePresence>
              </div>

              <footer className="border-t border-strong p-4 text-center text-[11px] text-subtle">
                Dev-only panel · hidden in production builds
              </footer>
            </motion.aside>
          </>
        ) : null}
      </AnimatePresence>
    </>
  );
}

// A button that opens the dev drawer from anywhere on the page (used by the
// page's "get started" callout when the app has no credentials yet). It just
// fires OPEN_DEV_SETUP_EVENT; DevDrawer listens. Safe to render in a Server
// Component tree since it's a Client Component itself.
export function OpenDevSetupButton({
  className,
  children,
}: {
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={() => window.dispatchEvent(new Event(OPEN_DEV_SETUP_EVENT))}
      className={className}
    >
      {children}
    </button>
  );
}

// ── Setup view ───────────────────────────────────────────────────────────────
// Holds the two setup steps plus the nav cards. It owns a `credReloadToken` so
// the ngrok step can poke the credentials step to refetch its status — used
// when "Use as Redirect URI" writes REDIRECT_URI, so it flips to ✓ Configured
// without the developer reopening the drawer.
function SetupView({ setView }: { setView: (v: View) => void }) {
  const [credReloadToken, setCredReloadToken] = useState(0);
  return (
    <>
      <CredentialsStep reloadToken={credReloadToken} />
      <NgrokStep onRedirectUriSaved={() => setCredReloadToken((t) => t + 1)} />
      <NavCard
        title="Prompts"
        hint="The hackathon dev journey — which slash command to run, in order."
        onClick={() => setView("prompts")}
      />
      <NavCard
        title="Sessions"
        hint="Chat with Claude Code running on this machine — start and switch between sessions."
        onClick={() => setView("sessions")}
      />
      <NavCard
        title="Build progress"
        hint="Live task status for a /to-work run, polled from progress.json."
        onClick={() => setView("progress")}
      />
      <NavCard
        title="I'm ready to deploy"
        hint="Ship to Vercel — push, import, and set your env vars there."
        onClick={() => setView("deploy")}
      />
    </>
  );
}

// ── Step 1: Blackbird credentials ────────────────────────────────────────────
// API key + OAuth client id/secret + redirect URI. Saving runs the secrets
// through the live API (Discovery for the key, the OAuth token endpoint for the
// client pair) and shape-checks the redirect URI before any of them are written
// to .env.local — so a typo is caught here, not at runtime.
function CredentialsStep({ reloadToken }: { reloadToken?: number }) {
  const [status, setStatus] = useState<CredStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [values, setValues] = useState<Partial<Record<CredField, string>>>({});
  const [editing, setEditing] = useState<Partial<Record<CredField, boolean>>>({});
  const [fieldErrors, setFieldErrors] = useState<
    Partial<Record<CredField, string>>
  >({});
  const [topError, setTopError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/dev/env");
      setStatus((await res.json()) as CredStatus);
    } catch {
      setStatus(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // Refetch when a sibling step changes the env (e.g. ngrok writing
  // REDIRECT_URI). Skip the initial 0 — the mount effect above already loaded.
  useEffect(() => {
    if (reloadToken) load();
  }, [reloadToken, load]);

  const isShown = (f: CredField) => !status?.[f]?.isSet || editing[f];
  // Anything the developer has typed into a visible field.
  const pending = CREDENTIALS.filter((c) => isShown(c.name)).reduce(
    (acc, c) => {
      const v = values[c.name]?.trim();
      if (v) acc[c.name] = v;
      return acc;
    },
    {} as Partial<Record<CredField, string>>,
  );

  async function save() {
    if (Object.keys(pending).length === 0) return;
    setSaving(true);
    setTopError(null);
    setFieldErrors({});
    setSaved(false);
    try {
      const res = await fetch("/api/dev/env", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ values: pending }),
      });
      const data = await res.json();
      if (!res.ok) {
        if (data.fieldErrors) setFieldErrors(data.fieldErrors);
        throw new Error(data.error ?? "Could not save the credentials.");
      }
      setStatus(data as CredStatus);
      // Clear only the fields we just saved.
      setValues((v) => {
        const next = { ...v };
        for (const k of Object.keys(pending)) delete next[k as CredField];
        return next;
      });
      setEditing((e) => {
        const next = { ...e };
        for (const k of Object.keys(pending)) delete next[k as CredField];
        return next;
      });
      setSaved(true);
    } catch (e) {
      setTopError(e instanceof Error ? e.message : "Could not save.");
    } finally {
      setSaving(false);
    }
  }

  const allSet =
    status != null && CREDENTIALS.every((c) => status[c.name].isSet);

  return (
    <Section
      index={1}
      title="Blackbird credentials"
      done={allSet}
      hint="API key, OAuth client id/secret, and redirect URI. Verified, then written to .env.local."
    >
      {loading ? (
        <Skeleton />
      ) : (
        <div className="space-y-4">
          {CREDENTIALS.map((cred) => {
            const set = status?.[cred.name]?.isSet ?? false;
            const shown = isShown(cred.name);
            const err = fieldErrors[cred.name];
            return (
              <div key={cred.name} className="space-y-1.5">
                <div className="flex items-baseline gap-2">
                  <span className="text-sm font-medium text-foreground">
                    {cred.label}
                  </span>
                  <code className="font-mono text-[11px] text-subtle">
                    {cred.name}
                  </code>
                  {set && !editing[cred.name] ? (
                    <button
                      type="button"
                      onClick={() =>
                        setEditing((e) => ({ ...e, [cred.name]: true }))
                      }
                      className="ml-auto text-xs text-primary-bright underline-offset-2 hover:underline"
                    >
                      Replace
                    </button>
                  ) : null}
                </div>

                {set && !editing[cred.name] ? (
                  <div className="flex items-center gap-2 text-sm">
                    <span className="shrink-0 text-success">✓ Configured</span>
                    {/* A masked secret is struck through to read as "stored,
                        replaceable"; the plain redirect URL is shown as-is. */}
                    <code
                      className={`truncate font-mono text-muted ${
                        cred.secret ? "line-through" : ""
                      }`}
                    >
                      {status?.[cred.name]?.masked}
                    </code>
                  </div>
                ) : (
                  <p className="text-[11px] leading-relaxed text-subtle">
                    {cred.help}
                  </p>
                )}

                {shown ? (
                  <input
                    type={cred.secret ? "password" : "text"}
                    value={values[cred.name] ?? ""}
                    onChange={(e) =>
                      setValues((v) => ({ ...v, [cred.name]: e.target.value }))
                    }
                    onKeyDown={(e) => {
                      if (e.key === "Enter") save();
                    }}
                    placeholder={cred.placeholder ?? `Paste your ${cred.name}`}
                    className={`w-full rounded-xl border bg-surface-low px-3 py-2 text-sm text-foreground placeholder:text-subtle focus:outline-none ${
                      err
                        ? "border-failure focus:border-failure"
                        : "border-strong focus:border-primary"
                    }`}
                    autoComplete="off"
                    spellCheck={false}
                  />
                ) : null}

                {err ? <p className="text-xs text-failure">{err}</p> : null}
              </div>
            );
          })}

          <div className="flex items-center gap-3 pt-1">
            <button
              type="button"
              onClick={save}
              disabled={saving || Object.keys(pending).length === 0}
              className="inline-flex h-9 items-center justify-center rounded-full bg-primary px-4 text-sm font-semibold text-primary-foreground transition hover:opacity-90 active:bg-primary-dim disabled:cursor-not-allowed disabled:opacity-40"
            >
              {saving ? "Verifying…" : "Save & verify"}
            </button>
            {saved && !saving ? (
              <span className="text-xs text-success">Saved & verified ✓</span>
            ) : null}
            {topError && !saving ? (
              <span className="text-xs text-failure">{topError}</span>
            ) : null}
          </div>
        </div>
      )}
    </Section>
  );
}

// ── Step 2: ngrok ────────────────────────────────────────────────────────────
// Hand this to the agent so it does the tunnel setup — adds the authtoken and
// starts the tunnel — without the dev juggling a second terminal. The agent
// stops at reporting the URL: it never writes .env.local (the dev sets
// REDIRECT_URI with the "Use as Redirect URI" button here). The dev pastes
// their token where marked before sending it.
const AGENT_TUNNEL_PROMPT =
  "My ngrok authtoken is: <paste it here>. Add it with " +
  "`ngrok config add-authtoken`, start a tunnel to port 3000 " +
  "(`ngrok http 3000`), and tell me the public https URL. Don't touch " +
  ".env.local — I'll set REDIRECT_URI from the dev setup drawer.";

function NgrokStep({
  onRedirectUriSaved,
}: {
  onRedirectUriSaved?: () => void;
}) {
  const [status, setStatus] = useState<NgrokStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState(false);
  const [settingRedirect, setSettingRedirect] = useState(false);
  const [redirectMsg, setRedirectMsg] = useState<{
    ok: boolean;
    text: string;
  } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/dev/ngrok");
      setStatus((await res.json()) as NgrokStatus);
    } catch {
      setStatus({ running: false, url: null });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function copy() {
    if (!status?.url) return;
    try {
      await navigator.clipboard.writeText(status.url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard can be blocked; the URL is visible regardless.
    }
  }

  // Save the tunnel URL (+ /callback) straight into REDIRECT_URI via the same
  // endpoint the credentials step uses, then tell that step to refresh so it
  // shows the redirect URI as configured. The server validates the shape.
  async function useAsRedirect() {
    if (!status?.url) return;
    const redirectUri = `${status.url.replace(/\/+$/, "")}/callback`;
    setSettingRedirect(true);
    setRedirectMsg(null);
    try {
      const res = await fetch("/api/dev/env", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ values: { REDIRECT_URI: redirectUri } }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(
          data.fieldErrors?.REDIRECT_URI ??
            data.error ??
            "Couldn't set the redirect URI.",
        );
      }
      setRedirectMsg({ ok: true, text: "Saved ✓ — now whitelist it below ↓" });
      onRedirectUriSaved?.();
    } catch (e) {
      setRedirectMsg({
        ok: false,
        text: e instanceof Error ? e.message : "Couldn't set it.",
      });
    } finally {
      setSettingRedirect(false);
    }
  }

  const running = status?.running ?? false;

  return (
    <Section
      index={2}
      title="ngrok tunnel"
      done={running}
      hint="Public URL for local sign-in — Blackbird blocks localhost."
      action={
        <button
          type="button"
          onClick={load}
          disabled={loading}
          className="text-xs text-primary-bright underline-offset-2 hover:underline disabled:opacity-40"
        >
          {loading ? "Checking…" : "Re-check"}
        </button>
      }
    >
      {loading ? (
        <Skeleton />
      ) : running ? (
        <div className="space-y-2">
          <div className="flex items-center gap-2 text-sm text-success">
            <span className="inline-block h-2 w-2 rounded-full bg-success" />
            ngrok is running
          </div>
          <button
            type="button"
            onClick={copy}
            title="Copy URL"
            className="flex w-full items-center gap-2 rounded-xl border border-strong bg-surface-low px-3 py-2 text-left font-mono text-xs text-foreground transition hover:bg-surface"
          >
            <span className="truncate">{status?.url}</span>
            <span className="ml-auto shrink-0 text-[11px] text-muted">
              {copied ? "Copied!" : "Copy"}
            </span>
          </button>

          {/* One-click: write <tunnel>/callback into REDIRECT_URI so the dev
              doesn't have to copy, append /callback, and paste it up top. */}
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={useAsRedirect}
              disabled={settingRedirect}
              className="inline-flex h-9 items-center justify-center rounded-full bg-primary px-4 text-sm font-semibold text-primary-foreground transition hover:opacity-90 active:bg-primary-dim disabled:cursor-not-allowed disabled:opacity-40"
            >
              {settingRedirect ? "Setting…" : "Use as Redirect URI →"}
            </button>
            {redirectMsg ? (
              <span
                className={`text-xs ${redirectMsg.ok ? "text-success" : "text-failure"}`}
              >
                {redirectMsg.text}
              </span>
            ) : null}
          </div>

          {/* The tunnel URL only works for OAuth once its /callback is
              whitelisted on the Blackbird side — point the dev at the self-serve
              portal so they can add it themselves. */}
          <p className="rounded-lg border border-brand-yellow/30 bg-brand-yellow/10 px-3 py-2 text-xs leading-relaxed text-brand-yellow">
            Whitelist{" "}
            <code className="font-mono">{status?.url}/callback</code> for the
            Blackbird API: sign in with your Slack email at{" "}
            <a
              href="https://bb-apis.vercel.app/redirect"
              target="_blank"
              rel="noreferrer"
              className="underline underline-offset-2"
            >
              bb-apis.vercel.app/redirect
            </a>{" "}
            and add it there.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          <div className="flex items-center gap-2 text-sm text-muted">
            <span className="inline-block h-2 w-2 rounded-full bg-failure" />
            ngrok is not running
          </div>

          {/* First run only: ngrok refuses to tunnel without an authtoken, and
              a bare `ngrok http 3000` fails with an opaque error if you skip it.
              Point first-timers at the free signup before they hit that wall. */}
          <p className="rounded-lg border border-brand-yellow/30 bg-brand-yellow/10 px-3 py-2 text-xs leading-relaxed text-brand-yellow">
            First time with ngrok? Grab a free authtoken at{" "}
            <a
              href="https://dashboard.ngrok.com/get-started/your-authtoken"
              target="_blank"
              rel="noreferrer"
              className="underline underline-offset-2"
            >
              ngrok.com
            </a>{" "}
            — then either run{" "}
            <code className="font-mono">ngrok config add-authtoken &lt;token&gt;</code>{" "}
            yourself, or paste the token into the prompt below and let your agent
            set it up.
          </p>

          {/* Easiest path: hand the agent the token; it does the whole setup. */}
          <p className="text-xs text-subtle">
            Ask your agent (paste your authtoken in first):
          </p>
          <div className="flex items-start gap-2 rounded-xl border border-strong bg-surface-low px-3 py-2">
            <code className="flex-1 font-mono text-xs leading-relaxed text-foreground">
              {AGENT_TUNNEL_PROMPT}
            </code>
            <CopyIconButton text={AGENT_TUNNEL_PROMPT} label="Copy prompt" />
          </div>

          {/* Or do it by hand. Once it's up, Re-check and the "Use as Redirect
              URI" button appears to set REDIRECT_URI for you. */}
          <p className="text-xs text-subtle">
            Or run it yourself, then Re-check above:
          </p>
          <div className="flex items-center gap-2 rounded-xl border border-strong bg-surface-low px-3 py-2">
            <code className="flex-1 font-mono text-xs text-foreground">
              ngrok http 3000
            </code>
            <CopyIconButton text="ngrok http 3000" label="Copy command" />
          </div>
        </div>
      )}
    </Section>
  );
}

// ── Prompts view: the hackathon dev journey ─────────────────────────────────
type StepStatus = "not_started" | "in_progress" | "done";
type JourneyState = {
  exists: boolean;
  steps?: Record<string, { status?: StepStatus }>;
};

function PromptsView() {
  // Poll the journey tracker so mandatory-step status stays fresh while the
  // agent works in another pane. .flynet/journey.json is written by the skills.
  const [journey, setJourney] = useState<JourneyState | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/dev/journey");
      setJourney((await res.json()) as JourneyState);
    } catch {
      setJourney({ exists: false });
    }
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(load, 4000);
    return () => clearInterval(t);
  }, [load]);

  const statusOf = (id: string): StepStatus =>
    journey?.steps?.[id]?.status ?? "not_started";

  return (
    <div className="space-y-6">
      <p className="text-xs leading-relaxed text-subtle">
        Grill → plan → implement, in order. Tap a card to copy a prompt, then
        paste it to Claude. Optional steps live below — Research and Prototype
        slot in after grilling, Review comes after implementing.
      </p>

      {/* Mandatory, linear, completion-tracked. */}
      <div className="space-y-3">
        <h3 className="text-xs font-semibold uppercase tracking-[0.18em] text-muted">
          Steps
        </h3>
        {STEPS.map((step, i) => (
          <StepCard
            key={step.id}
            index={i + 1}
            step={step}
            status={statusOf(step.id)}
          />
        ))}
      </div>

      {/* Optional, untracked. */}
      <div className="space-y-3">
        <h3 className="text-xs font-semibold uppercase tracking-[0.18em] text-muted">
          Others
        </h3>
        {OTHERS.map((step) => (
          <StepCard key={step.id} step={step} />
        ))}
      </div>
    </div>
  );
}

// A single journey card. `index`/`status` are only passed for tracked steps;
// optional helpers render without a number or status pip. Tapping copies the
// step's trigger prompt.
function StepCard({
  step,
  index,
  status,
}: {
  step: JourneyStep;
  index?: number;
  status?: StepStatus;
}) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(step.prompt);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard can be blocked on non-secure origins; the command is visible.
    }
  }

  const tracked = typeof index === "number";
  const done = status === "done";
  const active = status === "in_progress";

  return (
    <button
      type="button"
      onClick={copy}
      className={`w-full rounded-2xl border bg-surface-low/40 p-4 text-left transition hover:bg-surface-low ${
        active ? "border-primary" : "border-strong"
      }`}
    >
      <div className="flex items-center gap-3">
        {tracked ? (
          <span
            className={`inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold ${
              done
                ? "bg-success/15 text-success"
                : active
                  ? "bg-primary/15 text-primary-bright"
                  : "bg-surface text-muted"
            }`}
          >
            {done ? "✓" : index}
          </span>
        ) : null}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h4 className="truncate text-sm font-semibold text-foreground">
              {step.title}
            </h4>
            {active ? (
              <span className="shrink-0 rounded-full bg-primary/15 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-primary-bright">
                In progress
              </span>
            ) : null}
            {done ? (
              <span className="shrink-0 rounded-full bg-success/15 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-success">
                Done
              </span>
            ) : null}
          </div>
          <p className="truncate text-xs text-subtle">{step.subtitle}</p>
        </div>
        <span className="ml-auto shrink-0 text-[11px] text-muted">
          {copied ? "Copied!" : "Copy"}
        </span>
      </div>
      <code className="mt-3 block font-mono text-[11px] text-primary-bright">
        {step.command}
      </code>
    </button>
  );
}

// ── Progress view: live task status from a /to-work run ──────────────────────
type Task = {
  id: string;
  title: string;
  issue: string | null;
  status: "pending" | "in_progress" | "done" | "blocked" | "failed";
  agent: string | null;
  commit: string | null;
  note: string | null;
};
type ProgressState = {
  exists: boolean;
  parseError?: boolean;
  feature?: string | null;
  tasks?: Task[];
  updatedAt?: string;
};

const TASK_STYLE: Record<Task["status"], { dot: string; label: string }> = {
  pending: { dot: "bg-subtle", label: "text-muted" },
  in_progress: { dot: "bg-primary-bright", label: "text-primary-bright" },
  done: { dot: "bg-success", label: "text-success" },
  blocked: { dot: "bg-brand-yellow", label: "text-brand-yellow" },
  failed: { dot: "bg-failure", label: "text-failure" },
};

function ProgressView() {
  const [state, setState] = useState<ProgressState | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/dev/progress");
      setState((await res.json()) as ProgressState);
    } catch {
      setState({ exists: false });
    } finally {
      setLoading(false);
    }
  }, []);

  // Poll while the view is mounted — agents update progress.json as they go.
  useEffect(() => {
    load();
    const t = setInterval(load, 2500);
    return () => clearInterval(t);
  }, [load]);

  if (loading && !state) return <Skeleton />;

  if (!state?.exists) {
    return (
      <div className="rounded-2xl border border-strong bg-surface-low/40 p-6 text-center">
        <p className="text-sm font-semibold text-foreground">No run in flight</p>
        <p className="mt-1 text-xs text-subtle">
          Start the <code className="font-mono text-primary-bright">/to-work</code>{" "}
          step and task status will appear here, updating live.
        </p>
      </div>
    );
  }

  const tasks = state.tasks ?? [];
  const done = tasks.filter((t) => t.status === "done").length;
  const pct = tasks.length ? Math.round((done / tasks.length) * 100) : 0;

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <div className="flex items-center justify-between text-sm">
          <span className="font-semibold text-foreground">
            {state.feature ?? "Tasks"}
          </span>
          <span className="text-xs text-muted">
            {done}/{tasks.length} done
          </span>
        </div>
        <div className="h-2 overflow-hidden rounded-full bg-surface-low">
          <div
            className="h-full rounded-full bg-success transition-all duration-300 ease-standard"
            style={{ width: `${pct}%` }}
          />
        </div>
      </div>

      {tasks.length === 0 ? (
        <p className="text-xs text-subtle">
          No tasks recorded yet — they appear as the run is seeded.
        </p>
      ) : (
        <ul className="space-y-2">
          {tasks.map((t) => {
            const style = TASK_STYLE[t.status];
            return (
              <li
                key={t.id}
                className="rounded-xl border border-strong bg-surface-low/40 p-3"
              >
                <div className="flex items-center gap-2">
                  <span
                    className={`inline-block h-2 w-2 shrink-0 rounded-full ${style.dot} ${
                      t.status === "in_progress" ? "animate-pulse" : ""
                    }`}
                  />
                  <span className="truncate text-sm text-foreground">
                    {t.title}
                  </span>
                  <span
                    className={`ml-auto shrink-0 text-[11px] font-medium ${style.label}`}
                  >
                    {t.status.replace("_", " ")}
                  </span>
                </div>
                {(t.agent || t.commit || t.note) && (
                  <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 pl-4 text-[11px] text-muted">
                    {t.agent ? <span>· {t.agent}</span> : null}
                    {t.commit ? (
                      <code className="font-mono">{t.commit.slice(0, 7)}</code>
                    ) : null}
                    {t.note ? <span className="italic">{t.note}</span> : null}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {state.updatedAt ? (
        <p className="text-center text-[11px] text-subtle">
          updated {new Date(state.updatedAt).toLocaleTimeString()}
        </p>
      ) : null}
    </div>
  );
}

// A tappable card in the setup view that navigates to another drawer view.
// ── Deploy view: ship to Vercel ──────────────────────────────────────────────
// Hand this to the agent to do the whole deploy — push, create the project, set
// the secrets, and report back the callback URL to whitelist.
const DEPLOY_AGENT_PROMPT =
  "Deploy this Next.js app to Vercel. If it isn't on GitHub yet, push it, then " +
  "create a Vercel project from the repo. Set these environment variables in " +
  "Vercel from my .env.local: FLYNET_API_KEY, FLYNET_CLIENT_ID, " +
  "FLYNET_CLIENT_SECRET. After the first deploy, set REDIRECT_URI to " +
  "https://<the-deployed-domain>/callback, redeploy, and tell me that callback " +
  "URL so I can get it whitelisted for my OAuth app.";

// The .env.local keys that have to follow the app to Vercel. The API_BASE_URL /
// AUTH_* vars are intentionally absent — the app already defaults to production
// Blackbird, so they're only needed to *override* back to staging.
const DEPLOY_ENV_KEYS = [
  "FLYNET_API_KEY",
  "FLYNET_CLIENT_ID",
  "FLYNET_CLIENT_SECRET",
  "REDIRECT_URI",
];

function DeployView() {
  return (
    <div className="space-y-6">
      <p className="text-xs leading-relaxed text-subtle">
        This starter is a standard Next.js app, so Vercel deploys it with zero
        build config. The work is moving your secrets across and pointing OAuth
        at the live domain.
      </p>

      {/* Easy path: let the agent drive the whole deploy. */}
      <div className="space-y-2">
        <h3 className="text-xs font-semibold uppercase tracking-[0.18em] text-muted">
          Let your agent do it
        </h3>
        <div className="flex items-start gap-2 rounded-xl border border-strong bg-surface-low px-3 py-2">
          <code className="flex-1 font-mono text-[11px] leading-relaxed text-foreground">
            {DEPLOY_AGENT_PROMPT}
          </code>
          <CopyIconButton text={DEPLOY_AGENT_PROMPT} label="Copy prompt" />
        </div>
      </div>

      {/* Manual path. */}
      <div className="space-y-3">
        <h3 className="text-xs font-semibold uppercase tracking-[0.18em] text-muted">
          Or do it by hand
        </h3>
        <ol className="space-y-3 text-xs leading-relaxed text-subtle">
          <li className="flex gap-3">
            <span className="font-mono text-primary-bright">1.</span>
            <span>
              Push the repo to GitHub (or run{" "}
              <code className="font-mono text-foreground">vercel</code> to deploy
              straight from the CLI).
            </span>
          </li>
          <li className="flex gap-3">
            <span className="font-mono text-primary-bright">2.</span>
            <span>
              Import it at{" "}
              <a
                href="https://vercel.com/new"
                target="_blank"
                rel="noreferrer"
                className="text-primary-bright underline underline-offset-2"
              >
                vercel.com/new
              </a>
              . Next.js is auto-detected — no build settings to change.
            </span>
          </li>
          <li className="flex gap-3">
            <span className="font-mono text-primary-bright">3.</span>
            <span>
              In Project Settings → Environment Variables, add the keys below
              with the values from your{" "}
              <code className="font-mono text-foreground">.env.local</code>.
            </span>
          </li>
          <li className="flex gap-3">
            <span className="font-mono text-primary-bright">4.</span>
            <span>
              After the first deploy, set{" "}
              <code className="font-mono text-foreground">REDIRECT_URI</code> to{" "}
              <code className="font-mono text-foreground">
                https://&lt;your-app&gt;.vercel.app/callback
              </code>
              , redeploy, and whitelist that{" "}
              <code className="font-mono text-foreground">/callback</code> URL at{" "}
              <a
                href="https://bb-apis.vercel.app/redirect"
                target="_blank"
                rel="noreferrer"
                className="text-primary-bright underline underline-offset-2"
              >
                bb-apis.vercel.app/redirect
              </a>{" "}
              (sign in with your Slack email).
            </span>
          </li>
        </ol>
      </div>

      {/* The env keys to recreate in Vercel. */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <h3 className="text-xs font-semibold uppercase tracking-[0.18em] text-muted">
            Env vars to set
          </h3>
          <CopyIconButton
            text={DEPLOY_ENV_KEYS.join("\n")}
            label="Copy env keys"
          />
        </div>
        <div className="rounded-xl border border-strong bg-surface-low px-3 py-2 font-mono text-[11px] leading-relaxed text-foreground">
          {DEPLOY_ENV_KEYS.map((k) => (
            <div key={k}>{k}</div>
          ))}
        </div>
        <p className="text-[11px] leading-relaxed text-subtle">
          <code className="font-mono">ACCESS_TOKEN</code> is optional (pins a
          member token). You don&apos;t need{" "}
          <code className="font-mono">API_BASE_URL</code> /{" "}
          <code className="font-mono">AUTH_BASE_URL</code> /{" "}
          <code className="font-mono">AUTH_AUDIENCE</code> — the app already
          targets production Blackbird; set them only to point back at staging.
        </p>
      </div>

      {/* The one thing people forget — the redirect URI must match the live host
          and be whitelisted, or sign-in breaks in prod exactly like it would on
          localhost. */}
      <p className="rounded-lg border border-brand-yellow/30 bg-brand-yellow/10 px-3 py-2 text-xs leading-relaxed text-brand-yellow">
        Heads up: your local{" "}
        <code className="font-mono">REDIRECT_URI</code> (the ngrok URL) won&apos;t
        work in production. It has to be your Vercel domain plus{" "}
        <code className="font-mono">/callback</code>, and that exact URL must be
        whitelisted at{" "}
        <a
          href="https://bb-apis.vercel.app/redirect"
          target="_blank"
          rel="noreferrer"
          className="underline underline-offset-2"
        >
          bb-apis.vercel.app/redirect
        </a>{" "}
        or sign-in will fail.
      </p>
    </div>
  );
}

// ── Sessions view: chat with local Claude Code ───────────────────────────────
// Drives the session daemon through /api/dev/sessions/*. The daemon owns the
// `claude` processes out-of-process, so sessions keep running (and keep writing
// transcripts) even when next dev restarts — this view just reconnects and
// replays from a cursor, so a broken preview never loses the conversation.
// Two modes: a session list, and an open session's chat.
type SessionStatus = "idle" | "working" | "error";
type SessionMeta = {
  id: string;
  title: string;
  status: SessionStatus;
  cwd: string;
  live: boolean;
  events: number;
  createdAt: string;
  updatedAt: string;
};

type SessionEvent = {
  seq: number;
  ts: string;
  type:
    | "user"
    | "assistant"
    | "tool_use"
    | "tool_result"
    | "status"
    | "result"
    | "error"
    | "log"
    | "health"
    | "fixer";
  text?: string;
  name?: string;
  input?: unknown;
  content?: string;
  isError?: boolean;
  status?: SessionStatus;
  note?: string;
  result?: string;
  subtype?: string;
  costUsd?: number;
  durationMs?: number;
  ok?: boolean;
  phase?: string;
};

const SESSION_STYLE: Record<SessionStatus, { dot: string; label: string }> = {
  idle: { dot: "bg-subtle", label: "text-muted" },
  working: { dot: "bg-primary-bright", label: "text-primary-bright" },
  error: { dot: "bg-failure", label: "text-failure" },
};

function SessionsView() {
  const [activeId, setActiveId] = useState<string | null>(null);
  return activeId ? (
    <SessionDetail id={activeId} onBack={() => setActiveId(null)} />
  ) : (
    <SessionList onOpen={setActiveId} />
  );
}

function SessionList({ onOpen }: { onOpen: (id: string) => void }) {
  const [sessions, setSessions] = useState<SessionMeta[] | null>(null);
  const [prompt, setPrompt] = useState("");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/dev/sessions");
      const data = await res.json();
      setSessions(data.sessions ?? []);
    } catch {
      setSessions([]);
    }
  }, []);

  // Poll so a session's status pip stays fresh while it works in the background.
  useEffect(() => {
    load();
    const t = setInterval(load, 3000);
    return () => clearInterval(t);
  }, [load]);

  async function start() {
    const text = prompt.trim();
    if (!text) return;
    setCreating(true);
    setError(null);
    try {
      const res = await fetch("/api/dev/sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: text }),
      });
      const data = await res.json();
      if (!res.ok || !data.id)
        throw new Error(data.error ?? "Could not start the session.");
      setPrompt("");
      onOpen(data.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not start.");
    } finally {
      setCreating(false);
    }
  }

  return (
    <div className="space-y-6">
      {/* New session. */}
      <section className="space-y-3 rounded-2xl border border-strong bg-surface-low/40 p-4">
        <h3 className="text-sm font-semibold text-foreground">New session</h3>
        <textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) start();
          }}
          rows={3}
          placeholder="What should Claude Code do? (⌘↵ to start)"
          className="w-full resize-none rounded-xl border border-strong bg-surface-low px-3 py-2 text-sm text-foreground placeholder:text-subtle focus:border-primary focus:outline-none"
          spellCheck={false}
        />
        <p className="text-[11px] leading-relaxed text-subtle">
          Runs with full access (no permission prompts). When each turn
          finishes, the dev server is checked — if a change broke it, a fixer
          agent kicks in automatically.
        </p>
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={start}
            disabled={creating || !prompt.trim()}
            className="inline-flex h-9 items-center justify-center rounded-full bg-primary px-4 text-sm font-semibold text-primary-foreground transition hover:opacity-90 active:bg-primary-dim disabled:cursor-not-allowed disabled:opacity-40"
          >
            {creating ? "Starting…" : "Start session"}
          </button>
          {error ? <span className="text-xs text-failure">{error}</span> : null}
        </div>
      </section>

      {/* Existing sessions. */}
      <div className="space-y-3">
        <h3 className="text-xs font-semibold uppercase tracking-[0.18em] text-muted">
          Sessions
        </h3>
        {sessions == null ? (
          <Skeleton />
        ) : sessions.length === 0 ? (
          <p className="text-xs text-subtle">
            No sessions yet — start one above and it&apos;ll keep running here,
            even across dev-server restarts.
          </p>
        ) : (
          <ul className="space-y-2">
            {sessions.map((s) => {
              const style = SESSION_STYLE[s.status] ?? SESSION_STYLE.idle;
              return (
                <li key={s.id}>
                  <button
                    type="button"
                    onClick={() => onOpen(s.id)}
                    className="flex w-full items-center gap-2 rounded-xl border border-strong bg-surface-low/40 p-3 text-left transition hover:bg-surface-low"
                  >
                    <span
                      className={`inline-block h-2 w-2 shrink-0 rounded-full ${style.dot} ${
                        s.status === "working" ? "animate-pulse" : ""
                      }`}
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm text-foreground">
                        {s.title}
                      </span>
                      <span className="block text-[11px] text-muted">
                        {s.status}
                        {!s.live && s.status !== "working" ? " · resumable" : ""}
                      </span>
                    </span>
                    <span className="shrink-0 text-muted">→</span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}

function SessionDetail({ id, onBack }: { id: string; onBack: () => void }) {
  const [events, setEvents] = useState<Map<number, SessionEvent>>(new Map());
  const [meta, setMeta] = useState<SessionMeta | null>(null);
  const [connected, setConnected] = useState(false);
  const [input, setInput] = useState("");
  const cursorRef = useRef(-1);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  // Load meta once for the title/status header.
  useEffect(() => {
    fetch(`/api/dev/sessions/${id}`)
      .then((r) => r.json())
      .then(setMeta)
      .catch(() => {});
  }, [id]);

  // Live event stream with cursor-advancing auto-reconnect. On any drop (next
  // dev restart, network blip) we close and reopen with the last seq we saw, so
  // the daemon replays only what we missed. Events are keyed by seq, so the
  // small overlap on reconnect dedupes itself.
  useEffect(() => {
    let stopped = false;
    let retry: ReturnType<typeof setTimeout>;

    function connect() {
      if (stopped) return;
      const es = new EventSource(
        `/api/dev/sessions/${id}/stream?cursor=${cursorRef.current}`,
      );
      es.onopen = () => setConnected(true);
      es.onmessage = (e) => {
        let ev: SessionEvent;
        try {
          ev = JSON.parse(e.data) as SessionEvent;
        } catch {
          return;
        }
        cursorRef.current = Math.max(cursorRef.current, ev.seq);
        setEvents((prev) => {
          const next = new Map(prev);
          next.set(ev.seq, ev);
          return next;
        });
        if (ev.type === "status" && ev.status) {
          setMeta((m) => (m ? { ...m, status: ev.status! } : m));
        }
      };
      es.onerror = () => {
        es.close();
        setConnected(false);
        if (!stopped) retry = setTimeout(connect, 1200);
      };
    }
    connect();
    return () => {
      stopped = true;
      clearTimeout(retry);
    };
  }, [id]);

  const ordered = Array.from(events.values()).sort((a, b) => a.seq - b.seq);

  // Pin to the latest message as events stream in.
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [ordered.length]);

  async function send() {
    const text = input.trim();
    if (!text) return;
    setInput("");
    setMeta((m) => (m ? { ...m, status: "working" } : m));
    await fetch(`/api/dev/sessions/${id}/message`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
    }).catch(() => {});
  }

  const working = meta?.status === "working";
  const style = meta ? SESSION_STYLE[meta.status] ?? SESSION_STYLE.idle : null;

  return (
    <div className="flex flex-col gap-3">
      {/* Session header: back, title, status, controls. */}
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={onBack}
          className="-ml-1 rounded-full p-1.5 text-muted transition hover:bg-surface hover:text-foreground"
          aria-label="Back to sessions"
        >
          ←
        </button>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-foreground">
            {meta?.title ?? "Session"}
          </p>
          {meta ? (
            <span className={`flex items-center gap-1.5 text-[11px] ${style?.label}`}>
              <span
                className={`inline-block h-1.5 w-1.5 rounded-full ${style?.dot} ${working ? "animate-pulse" : ""}`}
              />
              {meta.status}
              {!connected ? " · reconnecting…" : ""}
            </span>
          ) : null}
        </div>
        {working ? (
          <button
            type="button"
            onClick={() => fetch(`/api/dev/sessions/${id}/stop`, { method: "POST" })}
            className="rounded-full border border-strong px-3 py-1 text-xs text-muted transition hover:text-foreground"
          >
            Stop
          </button>
        ) : (
          <button
            type="button"
            onClick={() => fetch(`/api/dev/sessions/${id}/resume`, { method: "POST" })}
            className="rounded-full border border-strong px-3 py-1 text-xs text-muted transition hover:text-foreground"
          >
            Resume
          </button>
        )}
      </div>

      {!connected ? (
        <p className="rounded-lg border border-brand-yellow/30 bg-brand-yellow/10 px-3 py-1.5 text-[11px] text-brand-yellow">
          Lost the stream (dev server may be restarting). Reconnecting — the
          session keeps running and nothing is lost.
        </p>
      ) : null}

      {/* Transcript. Own scroll region so the input stays put. */}
      <div
        ref={scrollRef}
        className="max-h-[52vh] space-y-2 overflow-y-auto rounded-2xl border border-strong bg-surface-low/30 p-3"
      >
        {ordered.length === 0 ? (
          <p className="py-6 text-center text-xs text-subtle">
            Waiting for output…
          </p>
        ) : (
          ordered.map((ev) => <EventRow key={ev.seq} ev={ev} />)
        )}
      </div>

      {/* Reply box. */}
      <div className="flex items-end gap-2">
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              send();
            }
          }}
          rows={2}
          placeholder="Reply… (↵ to send, ⇧↵ for newline)"
          className="flex-1 resize-none rounded-xl border border-strong bg-surface-low px-3 py-2 text-sm text-foreground placeholder:text-subtle focus:border-primary focus:outline-none"
          spellCheck={false}
        />
        <button
          type="button"
          onClick={send}
          disabled={!input.trim()}
          className="inline-flex h-9 shrink-0 items-center justify-center rounded-full bg-primary px-4 text-sm font-semibold text-primary-foreground transition hover:opacity-90 active:bg-primary-dim disabled:cursor-not-allowed disabled:opacity-40"
        >
          Send
        </button>
      </div>
    </div>
  );
}

// Render one transcript event. User turns are right-aligned bubbles; assistant
// text reads as prose; tool calls/results and status lines are compact and
// muted so the conversation stays readable in a narrow drawer.
function EventRow({ ev }: { ev: SessionEvent }) {
  if (ev.type === "user") {
    return (
      <div className="flex justify-end">
        <div className="max-w-[85%] whitespace-pre-wrap rounded-2xl rounded-br-sm bg-primary/15 px-3 py-2 text-sm text-foreground">
          {ev.text}
        </div>
      </div>
    );
  }
  if (ev.type === "assistant") {
    return (
      <div className="whitespace-pre-wrap text-sm leading-relaxed text-foreground">
        {ev.text}
      </div>
    );
  }
  if (ev.type === "tool_use") {
    return (
      <details className="rounded-lg border border-strong bg-surface-low/50 px-2.5 py-1.5 text-[11px]">
        <summary className="cursor-pointer text-muted">
          <span className="text-primary-bright">⚙ {ev.name}</span>
        </summary>
        <pre className="mt-1.5 overflow-x-auto whitespace-pre-wrap font-mono text-[10px] text-subtle">
          {JSON.stringify(ev.input, null, 2)}
        </pre>
      </details>
    );
  }
  if (ev.type === "tool_result") {
    return (
      <details className="rounded-lg border border-strong bg-surface-low/30 px-2.5 py-1.5 text-[11px]">
        <summary
          className={`cursor-pointer ${ev.isError ? "text-failure" : "text-muted"}`}
        >
          {ev.isError ? "⚠ tool result" : "↳ tool result"}
        </summary>
        <pre className="mt-1.5 overflow-x-auto whitespace-pre-wrap font-mono text-[10px] text-subtle">
          {ev.content}
        </pre>
      </details>
    );
  }
  if (ev.type === "result") {
    return (
      <p className="border-t border-strong pt-2 text-center text-[11px] text-subtle">
        {ev.isError ? "turn ended with an error" : "turn complete"}
        {typeof ev.costUsd === "number"
          ? ` · $${ev.costUsd.toFixed(4)}`
          : ""}
      </p>
    );
  }
  if (ev.type === "error") {
    return <p className="text-xs text-failure">{ev.text ?? ev.note ?? "error"}</p>;
  }
  if (ev.type === "health") {
    return (
      <p
        className={`text-center text-[11px] ${ev.ok ? "text-success" : "text-brand-yellow"}`}
      >
        {ev.ok ? "✓ " : "⚠ "}
        {ev.note}
      </p>
    );
  }
  if (ev.type === "fixer") {
    return (
      <div className="rounded-lg border border-brand-yellow/30 bg-brand-yellow/10 px-2.5 py-1.5 text-xs leading-relaxed text-brand-yellow">
        <span className="mr-1">🔧</span>
        <span className="whitespace-pre-wrap">{ev.text}</span>
      </div>
    );
  }
  if (ev.type === "status") {
    return (
      <p className="text-center text-[11px] text-subtle">
        {ev.note ?? ev.status}
      </p>
    );
  }
  // log
  return (
    <p className="whitespace-pre-wrap font-mono text-[10px] text-subtle">
      {ev.text}
    </p>
  );
}

function NavCard({
  title,
  hint,
  onClick,
}: {
  title: string;
  hint: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-center gap-3 rounded-2xl border border-strong bg-surface-low/40 p-4 text-left transition hover:bg-surface-low"
    >
      <div className="min-w-0 flex-1">
        <h3 className="text-sm font-semibold text-foreground">{title}</h3>
        <p className="mt-0.5 text-xs leading-relaxed text-subtle">{hint}</p>
      </div>
      <span className="shrink-0 text-muted">→</span>
    </button>
  );
}

// ── Shared bits ──────────────────────────────────────────────────────────────
function Section({
  index,
  title,
  hint,
  done,
  action,
  children,
}: {
  index: number;
  title: string;
  hint: string;
  done?: boolean;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-2xl border border-strong bg-surface-low/40 p-4">
      <div className="mb-3 flex items-center gap-3">
        <span
          className={`inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold ${
            done
              ? "bg-success/15 text-success"
              : "bg-primary/15 text-primary-bright"
          }`}
        >
          {done ? "✓" : index}
        </span>
        <h3 className="text-sm font-semibold text-foreground">{title}</h3>
        {action ? <span className="ml-auto">{action}</span> : null}
      </div>
      <p className="mb-3 text-xs leading-relaxed text-subtle">{hint}</p>
      {children}
    </section>
  );
}

function Skeleton() {
  return (
    <div className="h-10 animate-pulse rounded-xl bg-surface-low" aria-hidden />
  );
}

// Compact icon-only copy button — swaps to a check for a beat after copying.
function CopyIconButton({ text, label }: { text: string; label: string }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard can be blocked (e.g. non-secure origin); text stays visible.
    }
  }

  return (
    <button
      type="button"
      onClick={copy}
      title={label}
      aria-label={label}
      className="shrink-0 rounded-md p-1 text-muted transition hover:bg-surface hover:text-foreground"
    >
      {copied ? (
        <CheckIcon className="h-4 w-4 text-success" />
      ) : (
        <CopyIcon className="h-4 w-4" />
      )}
    </button>
  );
}

function CopyIcon({ className = "" }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
    </svg>
  );
}

function CheckIcon({ className = "" }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M20 6 9 17l-5-5" />
    </svg>
  );
}
