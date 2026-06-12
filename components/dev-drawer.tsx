"use client";

import { useCallback, useEffect, useState } from "react";

// Developer onboarding drawer. Renders only in dev (layout.tsx gates it on
// NODE_ENV), and its backend routes 404 in production too. It has three views,
// switched by the `view` state and a back affordance in the header:
//   • setup    — get the starter running (Blackbird API key, ngrok tunnel).
//   • prompts  — the curated hackathon dev journey (slash commands to run, in
//                order; optional steps are badged). Pure UI, copies to clipboard.
//   • progress — live task status for a `/to-work` run, polled from
//                /api/dev/progress (which reads .scratch/progress.json).
// Everything talks to /api/dev/* — nothing here touches real secrets directly.

type EnvStatus = { isSet: boolean; masked: string | null };
type NgrokStatus = { running: boolean; url: string | null };

type View = "setup" | "prompts" | "progress";

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
    subtitle: "PRD plus sliced, local tasks",
    command: "/to-plan",
    prompt:
      "Use the to-plan skill to turn my scoped idea into a PRD and slice it into thin, local end-to-end tasks.",
  },
  {
    id: "to-work",
    title: "Work it",
    subtitle: "Agents build each slice, committing",
    command: "/to-work",
    prompt:
      "Use the to-work skill to spawn a subagent per slice and build them, committing per task and tracking progress.",
  },
];

// Optional helpers — no clear "done", so they live in their own section and
// aren't completion-tracked. Reach for them whenever they help.
const OTHERS: JourneyStep[] = [
  {
    id: "prototype",
    title: "Prototype",
    subtitle: "Spike the riskiest piece fast",
    command: "/prototype",
    prompt:
      "Use the prototype skill to spike the riskiest part of this with throwaway code before I commit.",
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

export function DevDrawer() {
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<View>("setup");

  const close = useCallback(() => setOpen(false), []);

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

      {/* Scrim */}
      <div
        onClick={() => setOpen(false)}
        aria-hidden
        className={`fixed inset-0 z-40 bg-black/60 transition-opacity duration-200 ease-standard ${
          open ? "opacity-100" : "pointer-events-none opacity-0"
        }`}
      />

      {/* Panel */}
      <aside
        role="dialog"
        aria-modal="true"
        aria-label="Developer setup"
        className={`fixed inset-y-0 right-0 z-50 flex w-full max-w-md flex-col border-l border-strong bg-background-darker transition-transform duration-200 ease-standard ${
          open ? "translate-x-0" : "translate-x-full"
        }`}
      >
        <header className="flex items-start justify-between gap-4 border-b border-strong p-6">
          <div className="flex items-start gap-3">
            {/* Back to setup from a sub-view. */}
            {view !== "setup" ? (
              <button
                type="button"
                onClick={() => setView("setup")}
                className="-ml-2 mt-0.5 rounded-full p-2 text-muted transition hover:bg-surface hover:text-foreground"
                aria-label="Back to setup"
              >
                ←
              </button>
            ) : null}
            <div>
              <p className="text-xs uppercase tracking-[0.2em] text-primary-bright">
                {HEADER[view].eyebrow}
              </p>
              <h2 className="mt-1 text-lg font-semibold tracking-tight">
                {HEADER[view].title}
              </h2>
            </div>
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

        <div className="flex-1 space-y-6 overflow-y-auto p-6">
          {/* Only mount each view's contents while open so they fetch fresh
              status each time the drawer is opened. */}
          {open && view === "setup" ? (
            <>
              <ApiKeyStep />
              <NgrokStep />
              <NavCard
                title="Prompts"
                hint="The hackathon dev journey — which slash command to run, in order."
                onClick={() => setView("prompts")}
              />
              <NavCard
                title="Build progress"
                hint="Live task status for a /to-work run, polled from progress.json."
                onClick={() => setView("progress")}
              />
            </>
          ) : null}

          {open && view === "prompts" ? <PromptsView /> : null}
          {open && view === "progress" ? <ProgressView /> : null}
        </div>

        <footer className="border-t border-strong p-4 text-center text-[11px] text-subtle">
          Dev-only panel · hidden in production builds
        </footer>
      </aside>
    </>
  );
}

// ── Step 1: Blackbird API key ────────────────────────────────────────────────
function ApiKeyStep() {
  const [status, setStatus] = useState<EnvStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [value, setValue] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/dev/env");
      const data = (await res.json()) as EnvStatus;
      setStatus(data);
    } catch {
      setStatus(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function save() {
    const apiKey = value.trim();
    if (!apiKey) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/dev/env", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ apiKey }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Could not save the key.");
      setStatus(data as EnvStatus);
      setValue("");
      setEditing(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save the key.");
    } finally {
      setSaving(false);
    }
  }

  const isSet = status?.isSet ?? false;
  const showInput = !isSet || editing;

  return (
    <Section
      index={1}
      title="Blackbird API key"
      done={isSet}
      hint="The Discovery API key (BLACKBIRD_API_KEY). Saved to .env.local — server-side only."
    >
      {loading ? (
        <Skeleton />
      ) : (
        <div className="space-y-3">
          {isSet ? (
            <div className="flex items-center gap-2 text-sm">
              <span className="text-success">✓ Configured</span>
              {/* Already present → show it struck out, per the brief. */}
              <code className="font-mono text-muted line-through">
                {status?.masked}
              </code>
              {!editing ? (
                <button
                  type="button"
                  onClick={() => setEditing(true)}
                  className="ml-auto text-xs text-primary-bright underline-offset-2 hover:underline"
                >
                  Replace
                </button>
              ) : null}
            </div>
          ) : null}

          {showInput ? (
            <div className="space-y-2">
              <input
                type="password"
                value={value}
                onChange={(e) => setValue(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") save();
                }}
                placeholder="Paste your BLACKBIRD_API_KEY"
                className="w-full rounded-xl border border-strong bg-surface-low px-3 py-2 text-sm text-foreground placeholder:text-subtle focus:border-primary focus:outline-none"
                autoComplete="off"
                spellCheck={false}
              />
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={save}
                  disabled={saving || !value.trim()}
                  className="inline-flex h-9 items-center justify-center rounded-full bg-primary px-4 text-sm font-semibold text-primary-foreground transition hover:opacity-90 active:bg-primary-dim disabled:cursor-not-allowed disabled:opacity-40"
                >
                  {saving ? "Saving…" : "Save to .env.local"}
                </button>
                {editing ? (
                  <button
                    type="button"
                    onClick={() => {
                      setEditing(false);
                      setValue("");
                      setError(null);
                    }}
                    className="text-xs text-muted hover:text-foreground"
                  >
                    Cancel
                  </button>
                ) : null}
              </div>
              {error ? <p className="text-xs text-failure">{error}</p> : null}
            </div>
          ) : null}
        </div>
      )}
    </Section>
  );
}

// ── Step 2: ngrok ────────────────────────────────────────────────────────────
function NgrokStep() {
  const [status, setStatus] = useState<NgrokStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState(false);

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

  const running = status?.running ?? false;

  return (
    <Section
      index={2}
      title="ngrok tunnel"
      done={running}
      hint="Local OAuth sign-in needs a public URL — staging blocks localhost redirects."
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
        </div>
      ) : (
        <div className="space-y-2">
          <div className="flex items-center gap-2 text-sm text-muted">
            <span className="inline-block h-2 w-2 rounded-full bg-failure" />
            ngrok is not running
          </div>
          <p className="text-xs text-subtle">
            Start it, then point REDIRECT_URI at the tunnel:
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
        Run these in order. Tap a card to copy a prompt, then paste it to Claude.
        Optional helpers live below — reach for them whenever they help.
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
