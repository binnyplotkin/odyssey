"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { EvalRunRecord } from "@odyssey/db";
import type { HarnessCharacter } from "./harness-types";
import { ActivityListSkeleton, LaunchSummarySkeleton } from "./harness-skeletons";

/**
 * Right rail for the `test-regression` layer.
 *
 * Two cards (top to bottom):
 *   1. "Launch new eval" — suite picker + config + CLI snippet for the
 *      author to copy into a terminal. POST-driven launch is deferred to
 *      a follow-up (needs backgrounding + status polling); the CLI is the
 *      fast path today and works perfectly well.
 *   2. "Live activity" — polls `/api/characters/:id/evals/runs` every 5s,
 *      shows the most recent N runs with relative timestamps. The page
 *      it lives next to (`test-regression` editor) also reads the same
 *      endpoint, but the rail re-fetches independently so it stays fresh
 *      even when the page is on a different tab.
 *
 * Designed to mirror Paper artboard 1's right rail; see
 * `Admin — Character Harness · Evals` in the harness file.
 */

const T = {
  fontHeading: "'Space Grotesk', sans-serif",
  fontBody: "'Inter', sans-serif",
  fontMono: "var(--font-mono, 'JetBrains Mono', monospace)",
};

const COLORS = {
  mint: "#5BD08A",
  mintBg: "#0E1A12",
  mintBorder: "#1F4D2F",
  rose: "#D08A8A",
  amber: "#C77F5C",
  amberBorder: "#3D2419",
  blue: "#7A9BD0",
  textMuted: "var(--text-tertiary, #7C868D)",
  textFaint: "var(--text-quaternary, #5A6066)",
};

type SuiteListResponse = {
  suites: Array<{
    id: string;
    slug: string;
    version: string;
    probeCount: number;
    notes: string | null;
    createdAt: string;
  }>;
};

type RunsResponse = { runs: EvalRunRecord[]; trend: unknown };

type Props = {
  character: HarnessCharacter;
};

export function HarnessEvalRail({ character }: Props) {
  const [suites, setSuites] = useState<SuiteListResponse["suites"] | null>(null);
  const [suitesError, setSuitesError] = useState<string | null>(null);

  // Fetch suites once on mount.
  useEffect(() => {
    let cancelled = false;
    fetch(`/api/characters/${character.id}/evals/suites`)
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json() as Promise<SuiteListResponse>;
      })
      .then((json) => !cancelled && setSuites(json.suites))
      .catch((err) => !cancelled && setSuitesError(err instanceof Error ? err.message : String(err)));
    return () => {
      cancelled = true;
    };
  }, [character.id]);

  const primarySuite = suites?.[0] ?? null;

  return (
    <aside
      style={{
        // Owns its own dimensions — the shell clips via an outer wrapper
        // when collapsed, but doesn't dictate sizing.
        width: 480,
        height: "100%",
        flexShrink: 0,
        background: "var(--sidebar-glass)",
        borderLeft: "1px solid var(--border)",
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
      }}
    >
      <RailHeader />
      <div
        style={{
          flex: 1,
          minHeight: 0,
          overflowY: "auto",
          padding: "var(--space-20)",
          display: "flex",
          flexDirection: "column",
          gap: "var(--space-18)",
        }}
      >
        <LaunchPanel
          character={character}
          suite={primarySuite}
          suitesError={suitesError}
          suitesLoading={suites === null && !suitesError}
        />
        <LiveActivityPanel characterId={character.id} />
      </div>
    </aside>
  );
}

/* ── Header ─────────────────────────────────────────────────────── */

function RailHeader() {
  return (
    <div
      style={{
        padding: "18px 20px",
        borderBottom: "1px solid var(--border)",
        display: "flex",
        alignItems: "center",
        gap: "var(--space-12)",
        flexShrink: 0,
      }}
    >
      <span
        style={{
          fontFamily: T.fontMono,
          fontSize: "var(--font-size-xs)",
          letterSpacing: "0.14em",
          color: "var(--text-secondary)",
          textTransform: "uppercase",
        }}
      >
        ▸ launch + monitor
      </span>
    </div>
  );
}

/* ── Launch panel ───────────────────────────────────────────────── */

function LaunchPanel({
  character,
  suite,
  suitesError,
  suitesLoading,
}: {
  character: HarnessCharacter;
  suite: SuiteListResponse["suites"][number] | null;
  suitesError: string | null;
  suitesLoading: boolean;
}) {
  const cfg = character.brainModel ?? {};
  const model = cfg.model ?? "claude-sonnet-4-5";
  const temperature = typeof cfg.temperature === "number" ? cfg.temperature : null;

  // Launch state — one of run/sweep can be in-flight at a time per panel.
  // The actual eval keeps running in the background even when this state
  // resets; the activity feed polls and shows in-progress evals there.
  const [launching, setLaunching] = useState<null | "run" | "sweep">(null);
  const [launchError, setLaunchError] = useState<string | null>(null);
  const [lastLaunched, setLastLaunched] = useState<null | { kind: "run" | "sweep"; id: string }>(null);

  const launchRun = useCallback(async () => {
    if (!suite) return;
    setLaunching("run");
    setLaunchError(null);
    try {
      const overrideConfig: Record<string, unknown> = { model };
      if (temperature !== null) overrideConfig.temperature = temperature;
      const r = await fetch(`/api/characters/${character.id}/evals/runs`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ suiteSlug: suite.slug, overrideConfig }),
      });
      if (!r.ok) throw new Error(`${r.status}: ${(await r.text()).slice(0, 240)}`);
      const json = (await r.json()) as { runId: string; status: string };
      setLastLaunched({ kind: "run", id: json.runId });
    } catch (err) {
      setLaunchError(err instanceof Error ? err.message : String(err));
    } finally {
      setLaunching(null);
    }
  }, [character.id, suite, model, temperature]);

  const launchSweep = useCallback(async () => {
    if (!suite) return;
    setLaunching("sweep");
    setLaunchError(null);
    try {
      const r = await fetch(`/api/characters/${character.id}/evals/sweeps`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          suiteSlug: suite.slug,
          spec: {
            model: ["claude-sonnet-4-5", "claude-haiku-4-5"],
            temperature: [0.3, 0.7, 1.0],
          },
        }),
      });
      if (!r.ok) throw new Error(`${r.status}: ${(await r.text()).slice(0, 240)}`);
      const json = (await r.json()) as { sweepId: string; status: string };
      setLastLaunched({ kind: "sweep", id: json.sweepId });
    } catch (err) {
      setLaunchError(err instanceof Error ? err.message : String(err));
    } finally {
      setLaunching(null);
    }
  }, [character.id, suite]);

  // For terminal-friendly users (CTRL-F "copy command"), we keep a CLI
  // snippet as a collapsible escape hatch. The buttons above are the
  // primary path; the CLI is for power users who want to tail logs.
  const cliCommand = useMemo(() => {
    const slug = character.slug;
    const configJson = JSON.stringify({
      model,
      ...(temperature !== null ? { temperature } : {}),
    });
    return `npx tsx scripts/eval.ts ${slug} --config '${configJson}'`;
  }, [character.slug, model, temperature]);

  return (
    <section
      style={{
        display: "flex",
        flexDirection: "column",
        gap: "var(--space-14)",
        padding: "var(--space-16)",
        border: "1px solid var(--card-border)",
        borderRadius: "var(--radius-lg)",
        background: "var(--card)",
      }}
    >
      <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-6)" }}>
        <span style={mutedLabel}>▾ launch a new eval</span>
        <p
          style={{
            margin: 0,
            fontFamily: T.fontBody,
            fontSize: "var(--font-size-base)",
            color: COLORS.textMuted,
            lineHeight: 1.5,
          }}
        >
          Kicks off in the background — the activity feed below shows
          progress and the result lands in the runs list when done.
        </p>
      </div>

      {/* Suite + config snapshot — read-only summary of what would run. */}
      <div
        style={{
          padding: "var(--space-12)",
          border: "1px solid var(--border)",
          borderRadius: "var(--radius-sm)",
          background: "var(--background)",
          display: "flex",
          flexDirection: "column",
          gap: "var(--space-10)",
        }}
      >
        {suitesLoading ? (
          <LaunchSummarySkeleton />
        ) : (
          <>
            <Field label="suite">
              {suite ? (
                <span>
                  {suite.slug} · v{suite.version}{" "}
                  <span style={{ color: COLORS.textFaint }}>
                    ({suite.probeCount} probes)
                  </span>
                </span>
              ) : suitesError ? (
                <span style={{ color: COLORS.rose }}>⚠ {suitesError}</span>
              ) : (
                <span style={{ color: COLORS.textFaint }}>none published — run seed script</span>
              )}
            </Field>
            <Field label="model">
              <span style={{ color: COLORS.mint }}>{shortenModel(model)}</span>
              {character.brainModel?.model ? null : (
                <span style={{ color: COLORS.textFaint, marginLeft: "var(--space-6)" }}>(default)</span>
              )}
            </Field>
            <Field label="temperature">
              {temperature !== null ? (
                <span style={{ color: COLORS.mint }}>{temperature}</span>
              ) : (
                <span style={{ color: COLORS.textFaint }}>default</span>
              )}
            </Field>
          </>
        )}
      </div>

      {/* Launch buttons — the primary action. Disabled while a sibling
          launch is in flight to avoid double-clicks creating duplicate rows. */}
      <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-8)" }}>
        <LaunchButton
          label="▸ Run suite against production preset"
          sublabel={suite ? `${suite.probeCount} probes · ~${Math.round(suite.probeCount * 4)}s` : ""}
          disabled={suitesLoading || !suite || launching !== null}
          loading={launching === "run"}
          onClick={launchRun}
          primary
        />
        <LaunchButton
          label="▸ Run 3×3 Pareto sweep"
          sublabel="2 models × 3 temperatures · ~10 min"
          disabled={suitesLoading || !suite || launching !== null}
          loading={launching === "sweep"}
          onClick={launchSweep}
        />
      </div>

      {launchError ? (
        <div
          style={{
            padding: "8px 12px",
            border: `1px solid #3D1E1A`,
            borderRadius: "var(--radius-sm)",
            background: "#130E11",
            fontFamily: T.fontMono,
            fontSize: "var(--font-size-sm)",
            color: COLORS.rose,
          }}
        >
          ⚠ {launchError}
        </div>
      ) : null}

      {lastLaunched ? (
        <div
          style={{
            padding: "8px 12px",
            border: `1px solid ${COLORS.mintBorder}`,
            borderRadius: "var(--radius-sm)",
            background: COLORS.mintBg,
            fontFamily: T.fontMono,
            fontSize: "var(--font-size-sm)",
            color: COLORS.mint,
          }}
        >
          ✓ {lastLaunched.kind} launched · id {lastLaunched.id.slice(0, 8)}…{" "}
          <span style={{ color: COLORS.textMuted }}>
            — watch the activity feed below
          </span>
        </div>
      ) : null}

      <details>
        <summary
          style={{
            cursor: "pointer",
            fontFamily: T.fontMono,
            fontSize: "var(--font-size-xs)",
            color: COLORS.textFaint,
            letterSpacing: "0.1em",
            textTransform: "uppercase",
            listStyle: "none",
          }}
        >
          ▸ cli equivalent (for log tailing)
        </summary>
        <div style={{ marginTop: "var(--space-8)" }}>
          <CommandBox label="" command={cliCommand} />
        </div>
      </details>
    </section>
  );
}

function LaunchButton({
  label,
  sublabel,
  disabled,
  loading,
  onClick,
  primary,
}: {
  label: string;
  sublabel?: string;
  disabled?: boolean;
  loading?: boolean;
  onClick: () => void;
  primary?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled || loading}
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: "var(--space-12)",
        padding: "11px 14px",
        border: `1px solid ${primary ? COLORS.mintBorder : "var(--card-border)"}`,
        borderRadius: "var(--radius-sm)",
        background: primary ? COLORS.mintBg : "var(--background)",
        fontFamily: T.fontMono,
        fontSize: "var(--font-size-base)",
        color: primary ? COLORS.mint : "var(--foreground)",
        cursor: disabled || loading ? "not-allowed" : "pointer",
        opacity: disabled && !loading ? 0.5 : 1,
        textAlign: "left",
      }}
    >
      <span>{loading ? "▸ launching…" : label}</span>
      {sublabel && !loading ? (
        <span style={{ color: COLORS.textFaint, fontSize: "var(--font-size-xs)" }}>{sublabel}</span>
      ) : null}
    </button>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "var(--space-8)" }}>
      <span style={mutedLabel}>{label}</span>
      <span style={{ fontFamily: T.fontMono, fontSize: "var(--font-size-sm)", color: "var(--foreground)" }}>{children}</span>
    </div>
  );
}

function CommandBox({ label, command }: { label: string; command: string }) {
  const [copied, setCopied] = useState(false);
  const onCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(command);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard can be blocked in iframes / non-secure contexts; quietly
      // skip the success state in that case.
    }
  }, [command]);

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: "var(--space-8)",
        padding: "var(--space-12)",
        border: "1px solid var(--border)",
        borderRadius: "var(--radius-sm)",
        background: "#08090A",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <span style={mutedLabel}>{label}</span>
        <button
          type="button"
          onClick={onCopy}
          style={{
            padding: "3px 9px",
            border: `1px solid ${copied ? COLORS.mintBorder : "var(--card-border)"}`,
            borderRadius: "var(--radius-xs)",
            background: copied ? COLORS.mintBg : "transparent",
            fontFamily: T.fontMono,
            fontSize: 9.5,
            letterSpacing: "0.08em",
            textTransform: "uppercase",
            color: copied ? COLORS.mint : COLORS.textMuted,
            cursor: "pointer",
          }}
          title={copied ? "Copied!" : "Copy to clipboard"}
        >
          {copied ? "✓ copied" : "copy"}
        </button>
      </div>
      <pre
        style={{
          margin: 0,
          fontFamily: T.fontMono,
          fontSize: 10.5,
          lineHeight: 1.55,
          color: "var(--text-secondary, #A9B0B6)",
          whiteSpace: "pre-wrap",
          wordBreak: "break-word",
        }}
      >
        ${" "}{command}
      </pre>
    </div>
  );
}

/* ── Live activity panel ────────────────────────────────────────── */

const POLL_INTERVAL_MS = 5000;

function LiveActivityPanel({ characterId }: { characterId: string }) {
  const [runs, setRuns] = useState<EvalRunRecord[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [lastFetchedAt, setLastFetchedAt] = useState<number | null>(null);
  // Force a re-render every 30s so the "Xm ago" relative timestamps tick
  // forward without us also re-polling (the polling cadence is independent
  // of the display refresh cadence).
  const [, setNow] = useState(Date.now());

  useEffect(() => {
    let cancelled = false;

    const tick = async () => {
      try {
        const r = await fetch(`/api/characters/${characterId}/evals/runs?limit=6`);
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const json = (await r.json()) as RunsResponse;
        if (!cancelled) {
          setRuns(json.runs);
          setLastFetchedAt(Date.now());
          setError(null);
        }
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      }
    };

    void tick();
    const interval = setInterval(tick, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [characterId]);

  // Tick the "now" clock for relative timestamps.
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);

  return (
    <section
      style={{
        display: "flex",
        flexDirection: "column",
        gap: "var(--space-12)",
        padding: "var(--space-16)",
        border: "1px solid var(--card-border)",
        borderRadius: "var(--radius-lg)",
        background: "var(--card)",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <span style={mutedLabel}>▸ live activity</span>
        <PollStatus lastFetchedAt={lastFetchedAt} error={error} />
      </div>

      {runs === null ? (
        <ActivityListSkeleton />
      ) : runs.length === 0 ? (
        <p
          style={{
            margin: 0,
            fontFamily: T.fontBody,
            fontStyle: "italic",
            fontSize: "var(--font-size-base)",
            color: COLORS.textFaint,
          }}
        >
          no runs yet — copy a command above to kick one off.
        </p>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-8)" }}>
          {runs.map((run) => (
            <ActivityRow key={run.id} run={run} />
          ))}
        </div>
      )}
    </section>
  );
}

function PollStatus({
  lastFetchedAt,
  error,
}: {
  lastFetchedAt: number | null;
  error: string | null;
}) {
  if (error) {
    return (
      <span
        style={{
          fontFamily: T.fontMono,
          fontSize: 9.5,
          color: COLORS.rose,
          letterSpacing: "0.06em",
          textTransform: "uppercase",
        }}
        title={`Last poll failed: ${error}`}
      >
        <span style={{ width: 6, height: 6, borderRadius: 50, background: COLORS.rose, display: "inline-block", marginRight: "var(--space-6)" }} />
        offline
      </span>
    );
  }
  return (
    <span
      style={{
        display: "flex",
        alignItems: "center",
        gap: "var(--space-6)",
        fontFamily: T.fontMono,
        fontSize: 9.5,
        color: COLORS.mint,
        letterSpacing: "0.06em",
        textTransform: "uppercase",
      }}
      title={lastFetchedAt ? `Last polled ${new Date(lastFetchedAt).toISOString()}` : "Polling…"}
    >
      <span
        style={{
          width: 6,
          height: 6,
          borderRadius: 50,
          background: COLORS.mint,
          // Subtle pulse so the user knows the poll is active. Animation lives
          // in a global stylesheet — fallback to plain dot if unavailable.
          animation: "harness-pulse 2s ease-in-out infinite",
        }}
      />
      live · 5s
    </span>
  );
}

function ActivityRow({ run }: { run: EvalRunRecord }) {
  const cfg = run.effectiveModelConfig as { model?: string; temperature?: number };
  const cfgLabel = cfg.model
    ? `${shortenModel(cfg.model)}${typeof cfg.temperature === "number" ? ` · t=${cfg.temperature}` : ""}`
    : "—";

  // Lifecycle-aware summary text + dot color. Pending/running rows haven't
  // populated their summary fields yet, so we render a different shape.
  const isInFlight = run.status === "pending" || run.status === "running";
  const summary = isInFlight
    ? run.status === "pending"
      ? "queued · waiting to start"
      : `running… ${run.summary.total ? `0 / ${run.summary.total}` : "snapshot capturing"}`
    : run.status === "errored"
    ? `⚠ ${run.errorMessage ?? "errored"}`
    : run.summary.errored > 0
    ? `⚠ ${run.summary.errored} errored`
    : `${run.summary.passed}/${run.summary.total} · avg ${run.summary.avgOverall.toFixed(2)}`;

  const dotColor = isInFlight
    ? COLORS.blue
    : run.status === "errored"
    ? COLORS.rose
    : run.summary.errored > 0
    ? COLORS.rose
    : run.summary.passed === run.summary.total
    ? COLORS.mint
    : COLORS.amber;

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: "var(--space-10)",
        padding: "var(--space-10)",
        borderRadius: "var(--radius-sm)",
        background: "var(--background)",
        borderLeft: isInFlight ? `2px solid ${COLORS.blue}` : undefined,
      }}
    >
      <span
        style={{
          width: 6,
          height: 6,
          borderRadius: 50,
          background: dotColor,
          flexShrink: 0,
          animation: isInFlight ? "harness-pulse 1.6s ease-in-out infinite" : undefined,
        }}
      />
      <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: "var(--space-2)", minWidth: 0 }}>
        <span
          style={{
            fontFamily: T.fontMono,
            fontSize: "var(--font-size-sm)",
            color: "var(--foreground)",
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
          }}
        >
          {cfgLabel}
          {run.source === "sweep" ? (
            <span style={{ color: COLORS.textFaint, marginLeft: "var(--space-6)" }}>· sweep</span>
          ) : null}
          {isInFlight ? (
            <span
              style={{
                color: COLORS.blue,
                marginLeft: "var(--space-6)",
                fontSize: "var(--font-size-2xs)",
                letterSpacing: "0.08em",
                textTransform: "uppercase",
              }}
            >
              · {run.status}
            </span>
          ) : null}
        </span>
        <span style={{ fontFamily: T.fontMono, fontSize: "var(--font-size-xs)", color: COLORS.textFaint }}>
          {summary} · {relativeTime(run.completedAt ?? run.startedAt)}
        </span>
      </div>
    </div>
  );
}

/* ── Helpers ────────────────────────────────────────────────────── */

const mutedLabel: React.CSSProperties = {
  fontFamily: T.fontMono,
  fontSize: "var(--font-size-xs)",
  color: COLORS.textFaint,
  letterSpacing: "0.1em",
  textTransform: "uppercase",
};

function shortenModel(model: string): string {
  return model.replace(/^claude-/, "").replace(/-\d{8}$/, "");
}

function relativeTime(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 60_000) return "just now";
  const min = Math.floor(ms / 60_000);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const d = Math.floor(hr / 24);
  return `${d}d ago`;
}
