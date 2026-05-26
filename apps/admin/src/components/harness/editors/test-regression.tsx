"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import type {
  EvalRunRecord,
  EvalRunWithProbes,
  EvalSweepRecord,
  PassRatePoint,
} from "@odyssey/db";
import type { HarnessCharacter } from "../harness-types";
import {
  PromptSkeleton,
  RunDetailSkeleton,
  RunsContentSkeleton,
  SuiteDetailSkeleton,
  SuitesContentSkeleton,
  SweepDetailSkeleton,
  SweepsContentSkeleton,
} from "../harness-skeletons";
import { SuiteEditor } from "./suite-editor";

/**
 * The Evals & Test History page (test-regression layer).
 *
 * Renders the runs list with KPI strip + per-run drilldown (artboard 1)
 * AND the sweeps list with Pareto chart + ranked configs (artboard 2),
 * tab-switched. Reads from `/api/characters/:id/evals/...` — all
 * read-only for v1; launching new evals happens via the CLI for now.
 *
 * URL state:
 *   ?layer=test-regression&tab=runs           → list of runs
 *   ?layer=test-regression&tab=runs&run=<id>  → run expanded inline
 *   ?layer=test-regression&tab=sweeps         → list of sweeps
 *   ?layer=test-regression&tab=sweeps&sweep=<id> → sweep detail
 */

const T = {
  fontHeading: "'Space Grotesk', sans-serif",
  fontBody: "'Inter', sans-serif",
  fontMono: "var(--font-mono, 'JetBrains Mono', monospace)",
};

const COLORS = {
  mint: "#5BD08A",
  mintDim: "rgba(91,208,138,0.5)",
  mintBg: "#0E1A12",
  mintBorder: "#1F4D2F",
  rose: "#D08A8A",
  amber: "#C77F5C",
  amberBg: "#1A1310",
  amberBorder: "#3D2419",
  blue: "#7A9BD0",
  textMuted: "var(--text-tertiary, #7C868D)",
  textFaint: "var(--text-quaternary, #5A6066)",
};

type Tab = "runs" | "sweeps" | "suites" | "history";

type RunsResponse = { runs: EvalRunRecord[]; trend: PassRatePoint[] };
type RunDetailResponse = { run: EvalRunWithProbes };
type SweepsResponse = { sweeps: EvalSweepRecord[] };
type SweepDetailResponse = { sweep: EvalSweepRecord; runs: EvalRunRecord[] };

type SuiteFull = {
  id: string;
  characterId: string;
  slug: string;
  version: string;
  probes: ProbeDef[];
  notes: string | null;
  releaseNotes: string | null;
  publishedAt: string | null;
  forkedFromId: string | null;
  createdAt: string;
  createdBy: string | null;
};
type SuiteDetailResponse = { suite: SuiteFull };

type ProbeDef = {
  id: string;
  category: string;
  input: string;
  rubric: string;
  expectations?: {
    mustContain?: string[];
    mustNotContain?: string[];
    maxOutputTokens?: number;
    voiceCheck?: string;
    scopeCheck?: string;
    frameCheck?: string;
  };
  passThreshold?: number;
};

type ProbeTraceResponse = {
  runId: string;
  probeId: string;
  probeCategory: string;
  characterRequest: {
    system: { cached: string; perTurn: string | null; perTurnNote?: string };
    userMessage: string;
    modelConfig: {
      model: string;
      maxTokens: number;
      cacheControl: boolean;
      temperature: number | null;
      topP: number | null;
    };
  };
  characterResponse: string;
  judgeRequest: {
    systemPrompt: string;
    userPrompt: string;
    judgeModel: string;
  } | null;
  judgeResponse: {
    scores: unknown;
    overall: number;
    pass: boolean;
    rationale: string;
  };
  mechanicalFailures: string[];
  errors: string[];
  timing: { latencyMs: number; tokens: unknown };
};

type Props = {
  character: HarnessCharacter;
};

export function TestRegression({ character }: Props) {
  const router = useRouter();
  const params = useSearchParams();
  const tab = (params.get("tab") as Tab) ?? "runs";
  const runId = params.get("run");
  const sweepId = params.get("sweep");
  const suiteId = params.get("suite");
  const editingDraft = params.get("edit") === "1";

  const navigate = useCallback(
    (next: Partial<Record<"tab" | "run" | "sweep" | "suite" | "edit", string | null>>) => {
      const p = new URLSearchParams(Array.from(params.entries()));
      for (const [k, v] of Object.entries(next)) {
        if (v === null) p.delete(k);
        else p.set(k, v);
      }
      router.replace(`?${p.toString()}`, { scroll: false });
    },
    [params, router],
  );

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        flex: 1,
        minWidth: 0,
        background: "var(--background)",
      }}
    >
      <TabBar tab={tab} onChange={(t) => navigate({ tab: t, run: null, sweep: null, suite: null })} />
      <div style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: "24px 32px 32px" }}>
        {tab === "runs" ? (
          <RunsView
            characterId={character.id}
            characterSlug={character.slug}
            runId={runId}
            onSelectRun={(id) => navigate({ run: id })}
          />
        ) : tab === "sweeps" ? (
          <SweepsView
            characterId={character.id}
            sweepId={sweepId}
            onSelectSweep={(id) => navigate({ sweep: id })}
          />
        ) : tab === "suites" ? (
          <SuitesView
            characterId={character.id}
            suiteId={suiteId}
            editing={editingDraft}
            onSelectSuite={(id) => navigate({ suite: id, edit: null })}
            onStartEditing={(id) => navigate({ suite: id, edit: "1" })}
            onStopEditing={() => navigate({ edit: null })}
          />
        ) : (
          <ComingSoon label="Full history & diff view — wire-in pending." />
        )}
      </div>
    </div>
  );
}

/* ── Tab bar ────────────────────────────────────────────────────── */

function TabBar({ tab, onChange }: { tab: Tab; onChange: (t: Tab) => void }) {
  const TABS: Array<{ key: Tab; label: string }> = [
    { key: "runs", label: "runs" },
    { key: "sweeps", label: "sweeps" },
    { key: "suites", label: "suites" },
    { key: "history", label: "history" },
  ];
  return (
    <nav
      style={{
        display: "flex",
        gap: "var(--space-4)",
        padding: "12px 32px 0",
        borderBottom: "1px solid var(--border)",
      }}
    >
      {TABS.map(({ key, label }) => {
        const active = tab === key;
        return (
          <button
            key={key}
            type="button"
            onClick={() => onChange(key)}
            style={{
              padding: "9px 16px",
              fontFamily: T.fontMono,
              fontSize: "var(--font-size-sm)",
              letterSpacing: "0.08em",
              textTransform: "uppercase",
              color: active ? "var(--foreground)" : COLORS.textMuted,
              background: "transparent",
              border: "none",
              borderBottom: `2px solid ${active ? COLORS.mint : "transparent"}`,
              cursor: "pointer",
              marginBottom: -1,
            }}
          >
            {label}
          </button>
        );
      })}
    </nav>
  );
}

/* ── Runs view ──────────────────────────────────────────────────── */

export function RunsView({
  characterId,
  characterSlug,
  runId,
  onSelectRun,
}: {
  characterId: string;
  characterSlug: string;
  runId: string | null;
  onSelectRun: (id: string | null) => void;
}) {
  const [data, setData] = useState<{ characterId: string; value: RunsResponse } | null>(null);
  const [error, setError] = useState<{ characterId: string; message: string } | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/characters/${characterId}/evals/runs?limit=30`)
      .then(async (r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const json = (await r.json()) as RunsResponse;
        if (!cancelled) {
          setData({ characterId, value: json });
          setError(null);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setError({ characterId, message: err instanceof Error ? err.message : String(err) });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [characterId]);

  const activeData = data?.characterId === characterId ? data.value : null;
  const activeError = error?.characterId === characterId ? error.message : null;

  if (activeError) return <ErrorBanner message={activeError} />;
  if (!activeData) return <RunsContentSkeleton />;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-24)" }}>
      <KpiStrip runs={activeData.runs} trend={activeData.trend} />

      {/* Selected run (if any) expanded above the list */}
      {runId ? (
        <SelectedRunCard
          characterId={characterId}
          characterSlug={characterSlug}
          runId={runId}
          onCollapse={() => onSelectRun(null)}
        />
      ) : null}

      <RunsListSection runs={activeData.runs} selectedRunId={runId} onSelect={onSelectRun} />
    </div>
  );
}

function KpiStrip({ runs, trend }: { runs: EvalRunRecord[]; trend: PassRatePoint[] }) {
  const latest = runs[0];
  const passRatePct = latest ? Math.round((latest.summary.passed / latest.summary.total) * 100) : 0;
  const prevPassRate =
    runs.length > 1 && runs[1].summary.total > 0
      ? Math.round((runs[1].summary.passed / runs[1].summary.total) * 100)
      : null;
  const passDelta = prevPassRate !== null ? passRatePct - prevPassRate : null;

  const avgOverall = latest ? latest.summary.avgOverall.toFixed(2) : "—";
  const avgLatency = latest ? `${(latest.summary.avgLatencyMs / 1000).toFixed(1)}s` : "—";
  const cost = latest ? `$${latest.summary.estimatedCostUsd.toFixed(2)}` : "—";

  const sparkValues = trend.map((p) => p.passRate);

  return (
    <section
      style={{
        display: "flex",
        border: "1px solid var(--card-border)",
        borderRadius: "var(--radius-lg)",
        background: "var(--card)",
        overflow: "hidden",
      }}
    >
      <KpiCell
        label="pass rate · last 14d"
        value={`${passRatePct}%`}
        valueColor={passRatePct === 100 ? COLORS.mint : "var(--foreground)"}
        annotation={
          passDelta === null
            ? "—"
            : passDelta > 0
            ? `↑ from ${prevPassRate}%`
            : passDelta < 0
            ? `↓ from ${prevPassRate}%`
            : `= ${prevPassRate}%`
        }
        annotationColor={
          passDelta && passDelta > 0 ? COLORS.mint : passDelta && passDelta < 0 ? COLORS.rose : COLORS.textMuted
        }
      />
      <KpiCell label="avg overall" value={avgOverall} annotation="/ 5.0" />
      <KpiCell label="avg latency" value={avgLatency} annotation="last run" />
      <KpiCell label="cost / run" value={cost} annotation="char + judge" />
      <KpiCellSpark label="trend · pass rate" values={sparkValues} />
    </section>
  );
}

function KpiCell({
  label,
  value,
  valueColor,
  annotation,
  annotationColor,
}: {
  label: string;
  value: string;
  valueColor?: string;
  annotation?: string;
  annotationColor?: string;
}) {
  return (
    <div
      style={{
        flex: 1,
        padding: "18px 20px",
        display: "flex",
        flexDirection: "column",
        gap: "var(--space-4)",
        borderRight: "1px solid var(--card-border)",
        minWidth: 0,
      }}
    >
      <span style={mutedLabel}>{label}</span>
      <span
        style={{
          fontFamily: T.fontHeading,
          fontSize: 26,
          fontWeight: 500,
          letterSpacing: "-0.02em",
          color: valueColor ?? "var(--foreground)",
        }}
      >
        {value}
      </span>
      {annotation ? (
        <span
          style={{
            fontFamily: T.fontMono,
            fontSize: "var(--font-size-sm)",
            color: annotationColor ?? COLORS.textMuted,
          }}
        >
          {annotation}
        </span>
      ) : null}
    </div>
  );
}

function KpiCellSpark({ label, values }: { label: string; values: number[] }) {
  // Pad up to 14 bars so the strip looks consistent even with few runs.
  const bars = values.length === 0 ? [] : values;
  return (
    <div style={{ flex: 1.2, padding: "18px 20px", display: "flex", flexDirection: "column", gap: "var(--space-8)" }}>
      <span style={mutedLabel}>{label}</span>
      {bars.length === 0 ? (
        <span style={{ fontFamily: T.fontMono, fontSize: "var(--font-size-sm)", color: COLORS.textFaint }}>
          no runs yet
        </span>
      ) : (
        <div style={{ display: "flex", alignItems: "flex-end", gap: "var(--space-3)", height: 40 }}>
          {bars.map((v, i) => {
            // Map [0,1] pass rate to ~10–100% bar height so even 0% shows a stub.
            const h = Math.max(10, Math.round(v * 100));
            const color =
              v >= 0.95 ? COLORS.mint : v >= 0.85 ? COLORS.blue : v >= 0.5 ? COLORS.textMuted : COLORS.amber;
            return (
              <div
                key={i}
                style={{
                  width: 8,
                  height: `${h}%`,
                  background: color,
                  borderRadius: "2px 2px 0 0",
                  opacity: i === bars.length - 1 ? 1 : 0.85,
                }}
              />
            );
          })}
        </div>
      )}
    </div>
  );
}

function RunsListSection({
  runs,
  selectedRunId,
  onSelect,
}: {
  runs: EvalRunRecord[];
  selectedRunId: string | null;
  onSelect: (id: string | null) => void;
}) {
  if (runs.length === 0) {
    return (
      <EmptyState
        title="No eval runs yet"
        body="Run the CLI to populate this page:"
        cli="npx tsx scripts/eval.ts abraham"
      />
    );
  }
  return (
    <section style={{ display: "flex", flexDirection: "column", gap: "var(--space-12)" }}>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between" }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: "var(--space-10)" }}>
          <h2
            style={{
              margin: 0,
              fontFamily: T.fontHeading,
              fontSize: "var(--font-size-xl)",
              fontWeight: 500,
              letterSpacing: "-0.01em",
              color: "var(--foreground)",
            }}
          >
            Run history
          </h2>
          <span style={{ fontFamily: T.fontMono, fontSize: "var(--font-size-sm)", color: COLORS.textFaint }}>
            {runs.length} runs
          </span>
        </div>
      </div>

      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "var(--space-14)",
          padding: "8px 14px",
          fontFamily: T.fontMono,
          fontSize: "var(--font-size-2xs)",
          color: COLORS.textFaint,
          letterSpacing: "0.1em",
          textTransform: "uppercase",
          borderBottom: "1px solid var(--border)",
        }}
      >
        <span style={{ width: 140, flexShrink: 0 }}>when</span>
        <span style={{ flex: 1 }}>config</span>
        <span style={{ width: 64, flexShrink: 0, textAlign: "right" }}>passed</span>
        <span style={{ width: 54, flexShrink: 0, textAlign: "right" }}>avg</span>
        <span style={{ width: 64, flexShrink: 0, textAlign: "right" }}>latency</span>
        <span style={{ width: 64, flexShrink: 0, textAlign: "right" }}>cost</span>
        <span style={{ width: 14, flexShrink: 0 }} />
      </div>

      {runs.map((run) => (
        <RunRow key={run.id} run={run} selected={run.id === selectedRunId} onSelect={() => onSelect(run.id)} />
      ))}
    </section>
  );
}

function RunRow({
  run,
  selected,
  onSelect,
}: {
  run: EvalRunRecord;
  selected: boolean;
  onSelect: () => void;
}) {
  const cfg = run.effectiveModelConfig as { model?: string; temperature?: number };
  const configLabel = cfg.model
    ? `${cfg.model.replace(/^claude-/, "")}${typeof cfg.temperature === "number" ? ` · t=${cfg.temperature}` : ""}`
    : "—";
  const passColor = run.summary.errored > 0 ? COLORS.rose : COLORS.mint;
  const passText = run.summary.errored > 0 ? `${run.summary.passed}/${run.summary.total}` : `${run.summary.passed}/${run.summary.total}`;

  const date = new Date(run.startedAt);
  const dateStr = date.toISOString().slice(0, 10);
  const timeStr = date.toISOString().slice(11, 16);

  return (
    <button
      type="button"
      onClick={onSelect}
      style={{
        display: "flex",
        alignItems: "center",
        gap: "var(--space-14)",
        padding: "13px 14px",
        borderRadius: "var(--radius-sm)",
        background: selected ? COLORS.mintBg : "var(--card)",
        border: `1px solid ${selected ? COLORS.mintBorder : "var(--card-border)"}`,
        fontFamily: T.fontMono,
        fontSize: "var(--font-size-base)",
        cursor: "pointer",
        textAlign: "left",
        color: "inherit",
        width: "100%",
      }}
    >
      <div style={{ width: 140, flexShrink: 0, display: "flex", flexDirection: "column", gap: "var(--space-2)" }}>
        <span style={{ color: "var(--foreground)", opacity: 0.85 }}>{dateStr}</span>
        <span style={{ color: COLORS.textFaint, fontSize: "var(--font-size-xs)" }}>{timeStr}</span>
      </div>
      <div style={{ flex: 1, display: "flex", alignItems: "center", gap: "var(--space-10)", minWidth: 0 }}>
        <span style={{ color: "var(--foreground)" }}>{configLabel}</span>
        {run.source === "sweep" ? (
          <span
            style={{
              padding: "2px 7px",
              border: "1px solid var(--card-border)",
              borderRadius: "var(--radius-xs)",
              fontSize: "var(--font-size-2xs)",
              color: COLORS.textMuted,
              letterSpacing: "0.08em",
              textTransform: "uppercase",
            }}
          >
            sweep
          </span>
        ) : null}
        {run.summary.errored > 0 ? (
          <span
            style={{
              padding: "2px 7px",
              border: `1px solid ${COLORS.amberBorder}`,
              borderRadius: "var(--radius-xs)",
              fontSize: "var(--font-size-2xs)",
              color: COLORS.rose,
              letterSpacing: "0.08em",
              textTransform: "uppercase",
            }}
          >
            ⚠ {run.summary.errored} errored
          </span>
        ) : null}
      </div>
      <span style={{ width: 64, flexShrink: 0, textAlign: "right", color: passColor }}>{passText}</span>
      <span style={{ width: 54, flexShrink: 0, textAlign: "right", color: "var(--foreground)" }}>
        {run.summary.avgOverall.toFixed(2)}
      </span>
      <span style={{ width: 64, flexShrink: 0, textAlign: "right", color: COLORS.textMuted }}>
        {`${(run.summary.avgLatencyMs / 1000).toFixed(1)}s`}
      </span>
      <span style={{ width: 64, flexShrink: 0, textAlign: "right", color: COLORS.textMuted }}>
        ${run.summary.estimatedCostUsd.toFixed(2)}
      </span>
      <span style={{ width: 14, flexShrink: 0, textAlign: "center", color: COLORS.textFaint }}>→</span>
    </button>
  );
}

/* ── Selected run card (full drilldown) ──────────────────────────── */

export function SelectedRunCard({
  characterId,
  characterSlug,
  runId,
  onCollapse,
}: {
  characterId: string;
  characterSlug: string;
  runId: string;
  onCollapse: () => void;
}) {
  const requestKey = `${characterId}:${runId}`;
  const [data, setData] = useState<{ key: string; value: RunDetailResponse } | null>(null);
  const [error, setError] = useState<{ key: string; message: string } | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/characters/${characterId}/evals/runs/${runId}`)
      .then(async (r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const json = (await r.json()) as RunDetailResponse;
        if (!cancelled) {
          setData({ key: requestKey, value: json });
          setError(null);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setError({ key: requestKey, message: err instanceof Error ? err.message : String(err) });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [characterId, runId, requestKey]);

  const activeData = data?.key === requestKey ? data.value : null;
  const activeError = error?.key === requestKey ? error.message : null;

  if (activeError) return <ErrorBanner message={`Run ${runId.slice(0, 8)}: ${activeError}`} />;
  if (!activeData) return <RunDetailSkeleton />;

  const { run } = activeData;
  const cfg = run.effectiveModelConfig as { model?: string; temperature?: number };
  const configLabel = cfg.model
    ? `${cfg.model.replace(/^claude-/, "")}${typeof cfg.temperature === "number" ? ` · t=${cfg.temperature}` : ""}`
    : "—";

  return (
    <section
      style={{
        display: "flex",
        flexDirection: "column",
        border: `1px solid ${COLORS.mintBorder}`,
        borderRadius: "var(--radius-lg)",
        background: "#0E1411",
        overflow: "hidden",
      }}
    >
      <header
        style={{
          display: "flex",
          alignItems: "flex-start",
          justifyContent: "space-between",
          padding: "20px 22px",
          gap: "var(--space-24)",
          borderBottom: "1px solid #1A2A20",
        }}
      >
        <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-8)", minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: "var(--space-10)", flexWrap: "wrap" }}>
            <span style={{ display: "flex", alignItems: "center", gap: "var(--space-6)", color: COLORS.mint, fontFamily: T.fontMono, fontSize: "var(--font-size-xs)", letterSpacing: "0.08em", textTransform: "uppercase" }}>
              <span style={{ width: 6, height: 6, borderRadius: 50, background: COLORS.mint }} />
              selected
            </span>
            <span style={{ color: COLORS.textFaint, fontFamily: T.fontMono, fontSize: "var(--font-size-xs)" }}>·</span>
            <span style={{ color: COLORS.textMuted, fontFamily: T.fontMono, fontSize: "var(--font-size-xs)" }}>
              {new Date(run.startedAt).toISOString().replace("T", " · ").slice(0, 19)}
            </span>
          </div>
          <div style={{ display: "flex", alignItems: "baseline", gap: "var(--space-12)", flexWrap: "wrap" }}>
            <span style={{ fontFamily: T.fontHeading, fontSize: 20, fontWeight: 500, color: "var(--foreground)" }}>
              {configLabel}
            </span>
            <span style={{ fontFamily: T.fontMono, fontSize: "var(--font-size-xs)", color: COLORS.textFaint }}>
              config-hash {run.configHash} · judge {run.judgeModel}
            </span>
          </div>
        </div>
        <button
          type="button"
          onClick={onCollapse}
          style={{
            padding: "7px 12px",
            border: "1px solid var(--card-border)",
            borderRadius: "var(--radius-sm)",
            background: "transparent",
            fontFamily: T.fontMono,
            fontSize: "var(--font-size-sm)",
            color: COLORS.textMuted,
            letterSpacing: "0.06em",
            textTransform: "uppercase",
            cursor: "pointer",
            flexShrink: 0,
          }}
        >
          collapse
        </button>
      </header>

      <RunSummaryStrip run={run} />
      <CategoryBreakdown probes={run.probes} />
      <ProbeList
        probes={run.probes}
        characterId={characterId}
        characterSlug={characterSlug}
        runId={run.id}
      />
    </section>
  );
}

function RunSummaryStrip({ run }: { run: EvalRunWithProbes }) {
  return (
    <div style={{ display: "flex", borderBottom: "1px solid #1A2A20" }}>
      <SummaryCell label="passed" value={`${run.summary.passed} / ${run.summary.total}`} color={COLORS.mint} />
      <SummaryCell label="avg overall" value={run.summary.avgOverall.toFixed(2)} />
      <SummaryCell label="latency" value={`${(run.summary.avgLatencyMs / 1000).toFixed(1)}s`} />
      <SummaryCell label="tokens" value={`${Math.round(run.summary.totalTokens / 1000)}k`} />
      <SummaryCell label="cost" value={`$${run.summary.estimatedCostUsd.toFixed(2)}`} last />
    </div>
  );
}

function SummaryCell({
  label,
  value,
  color,
  last,
}: {
  label: string;
  value: string;
  color?: string;
  last?: boolean;
}) {
  return (
    <div
      style={{
        flex: 1,
        padding: "14px 22px",
        display: "flex",
        flexDirection: "column",
        gap: "var(--space-4)",
        borderRight: last ? "none" : "1px solid #1A2A20",
      }}
    >
      <span style={mutedLabel}>{label}</span>
      <span
        style={{
          fontFamily: T.fontHeading,
          fontSize: "var(--font-size-2xl)",
          fontWeight: 500,
          color: color ?? "var(--foreground)",
        }}
      >
        {value}
      </span>
    </div>
  );
}

/* ── Category breakdown + probe list ────────────────────────────── */

type CategoryStats = { category: string; passed: number; total: number; avg: number };

function categoryStats(probes: EvalRunWithProbes["probes"]): CategoryStats[] {
  const grouped: Record<string, EvalRunWithProbes["probes"]> = {};
  for (const p of probes) {
    if (!grouped[p.probeCategory]) grouped[p.probeCategory] = [];
    grouped[p.probeCategory].push(p);
  }
  return Object.entries(grouped).map(([category, ps]) => ({
    category,
    passed: ps.filter((p) => p.pass).length,
    total: ps.length,
    avg: ps.reduce((a, p) => a + p.overall, 0) / ps.length,
  }));
}

function CategoryBreakdown({ probes }: { probes: EvalRunWithProbes["probes"] }) {
  const stats = useMemo(() => categoryStats(probes), [probes]);
  if (stats.length === 0) return null;
  return (
    <div style={{ padding: "18px 22px", borderBottom: "1px solid #1A2A20", display: "flex", flexDirection: "column", gap: "var(--space-14)" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <span style={{ ...mutedLabel, color: COLORS.textMuted }}>by category · {stats.length} groups</span>
      </div>
      <div style={{ display: "flex", gap: "var(--space-10)", flexWrap: "wrap" }}>
        {stats.map((s) => (
          <div
            key={s.category}
            style={{
              flex: "1 1 120px",
              display: "flex",
              flexDirection: "column",
              gap: "var(--space-6)",
              padding: "var(--space-10)",
              border: "1px solid #1A2A20",
              borderRadius: "var(--radius-sm)",
              background: "#0B130F",
              minWidth: 100,
            }}
          >
            <span style={mutedLabel}>{s.category}</span>
            <div style={{ display: "flex", alignItems: "baseline", gap: "var(--space-4)" }}>
              <span style={{ fontFamily: T.fontHeading, fontSize: "var(--font-size-xl)", fontWeight: 500 }}>{s.passed}</span>
              <span style={{ fontFamily: T.fontMono, fontSize: "var(--font-size-xs)", color: COLORS.textFaint }}>/{s.total}</span>
            </div>
            <div style={{ height: 3, background: "#1A2A20", borderRadius: "var(--radius-2xs)", overflow: "hidden" }}>
              <div style={{ height: "100%", width: `${(s.avg / 5) * 100}%`, background: COLORS.mint }} />
            </div>
            <span style={{ fontFamily: T.fontMono, fontSize: "var(--font-size-2xs)", color: COLORS.textFaint }}>avg {s.avg.toFixed(2)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function ProbeList({
  probes,
  characterId,
  characterSlug,
  runId,
}: {
  probes: EvalRunWithProbes["probes"];
  characterId: string;
  characterSlug: string;
  runId: string;
}) {
  const [expandedId, setExpandedId] = useState<string | null>(null);
  return (
    <div style={{ padding: "18px 22px", display: "flex", flexDirection: "column", gap: "var(--space-8)" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <span style={mutedLabel}>per-probe results · {probes.length}</span>
        <span style={{ fontFamily: T.fontMono, fontSize: "var(--font-size-xs)", color: COLORS.textFaint }}>
          click any row to expand judge detail
        </span>
      </div>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "var(--space-14)",
          padding: "6px 14px",
          fontFamily: T.fontMono,
          fontSize: "var(--font-size-2xs)",
          color: COLORS.textFaint,
          letterSpacing: "0.1em",
          textTransform: "uppercase",
          borderBottom: "1px solid #1A1F22",
        }}
      >
        <span style={{ width: 14, flexShrink: 0 }} />
        <span style={{ width: 88, flexShrink: 0 }}>category</span>
        <span style={{ flex: 1 }}>probe</span>
        <span style={{ width: 64, flexShrink: 0, textAlign: "right" }}>overall</span>
        <span style={{ width: 96, flexShrink: 0, textAlign: "right" }}>v · s · f · b · f</span>
        <span style={{ width: 64, flexShrink: 0, textAlign: "right" }}>latency</span>
      </div>
      {probes.map((p) => (
        <ProbeRow
          key={p.id}
          probe={p}
          characterId={characterId}
          characterSlug={characterSlug}
          runId={runId}
          expanded={p.id === expandedId}
          onToggle={() => setExpandedId(expandedId === p.id ? null : p.id)}
        />
      ))}
    </div>
  );
}

const CATEGORY_COLORS: Record<string, { fg: string; border: string }> = {
  identity: { fg: COLORS.mint, border: "#1A2A20" },
  trait: { fg: COLORS.blue, border: "#1A2533" },
  scope: { fg: COLORS.mint, border: "#1A2A20" },
  deflect: { fg: COLORS.mint, border: "#1A2A20" },
  frame: { fg: COLORS.mint, border: "#1A2A20" },
  jailbreak: { fg: COLORS.rose, border: "#2A1A1F" },
  edge: { fg: COLORS.amber, border: COLORS.amberBorder },
};

function ProbeRow({
  probe,
  characterId,
  characterSlug,
  runId,
  expanded,
  onToggle,
}: {
  probe: EvalRunWithProbes["probes"][number];
  characterId: string;
  characterSlug: string;
  runId: string;
  expanded: boolean;
  onToggle: () => void;
}) {
  const cat = CATEGORY_COLORS[probe.probeCategory] ?? { fg: COLORS.textMuted, border: "var(--card-border)" };
  const dimsText = (() => {
    const scores = probe.scores as Record<string, { score: number }>;
    return ["voice", "scope", "frame", "brevity", "factual"]
      .map((d) => scores?.[d]?.score ?? "—")
      .join("·");
  })();
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        border: expanded ? `1px solid ${COLORS.textFaint}` : "1px solid transparent",
        borderRadius: "var(--radius-md)",
        background: expanded ? "var(--card)" : "transparent",
        overflow: "hidden",
      }}
    >
      <button
        type="button"
        onClick={onToggle}
        style={{
          display: "flex",
          alignItems: "center",
          gap: "var(--space-14)",
          padding: "11px 14px",
          fontFamily: T.fontMono,
          fontSize: "var(--font-size-base)",
          background: "transparent",
          border: "none",
          cursor: "pointer",
          textAlign: "left",
          color: "inherit",
          width: "100%",
        }}
      >
        <span
          style={{
            width: 14,
            height: 14,
            borderRadius: 50,
            background: probe.pass ? COLORS.mintBg : "#2A1A1F",
            border: `1px solid ${probe.pass ? COLORS.mintBorder : "#3D1E1A"}`,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            flexShrink: 0,
          }}
        >
          <span
            style={{
              width: 5,
              height: 5,
              borderRadius: 50,
              background: probe.pass ? COLORS.mint : COLORS.rose,
            }}
          />
        </span>
        <span
          style={{
            width: 88,
            flexShrink: 0,
            padding: "2px 8px",
            border: `1px solid ${cat.border}`,
            borderRadius: "var(--radius-xs)",
            fontSize: "var(--font-size-2xs)",
            color: cat.fg,
            letterSpacing: "0.08em",
            textTransform: "uppercase",
            textAlign: "center",
          }}
        >
          {probe.probeCategory}
        </span>
        <span style={{ flex: 1, color: "var(--foreground)", minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {probe.probeId} <span style={{ color: COLORS.textFaint }}>— &ldquo;{probe.input}&rdquo;</span>
        </span>
        <span style={{ width: 64, flexShrink: 0, textAlign: "right" }}>
          {probe.overall.toFixed(1)} / 5
        </span>
        <span style={{ width: 96, flexShrink: 0, textAlign: "right", color: COLORS.textMuted }}>
          {dimsText}
        </span>
        <span style={{ width: 64, flexShrink: 0, textAlign: "right", color: COLORS.textMuted }}>
          {(probe.latencyMs / 1000).toFixed(1)}s
        </span>
      </button>
      {expanded ? (
        <ProbeDetail
          probe={probe}
          characterId={characterId}
          characterSlug={characterSlug}
          runId={runId}
        />
      ) : null}
    </div>
  );
}

function ProbeDetail({
  probe,
  characterId,
  characterSlug,
  runId,
}: {
  probe: EvalRunWithProbes["probes"][number];
  characterId: string;
  characterSlug: string;
  runId: string;
}) {
  const scores = probe.scores as Record<string, { score: number; rationale: string }>;
  const DIMS = ["voice", "scope", "frame", "brevity", "factual"];
  const tokens = probe.tokens as { input: number; output: number; cacheRead: number };
  return (
    <div style={{ display: "flex", flexDirection: "column", borderTop: "1px solid #1A1F22" }}>
      <div style={{ display: "flex", borderBottom: "1px solid #1A1F22" }}>
        <div style={{ flex: 1.4, padding: "16px 20px", borderRight: "1px solid #1A1F22", display: "flex", flexDirection: "column", gap: "var(--space-10)", minWidth: 0 }}>
          <span style={mutedLabel}>
            character response · {tokens.output} tok{tokens.cacheRead > 0 ? " · cache hit" : ""}
          </span>
          <p
            style={{
              margin: 0,
              fontFamily: T.fontBody,
              fontStyle: "italic",
              fontSize: "var(--font-size-lg)",
              lineHeight: 1.6,
              color: "var(--foreground)",
              whiteSpace: "pre-wrap",
            }}
          >
            &ldquo;{probe.response || "(no response)"}&rdquo;
          </p>
          {probe.mechanicalFailures.length > 0 ? (
            <div style={{ display: "flex", alignItems: "center", gap: "var(--space-8)", paddingTop: "var(--space-6)", borderTop: "1px solid #1A1F22" }}>
              <span style={mutedLabel}>mechanical checks:</span>
              {probe.mechanicalFailures.map((m, i) => (
                <span key={i} style={{ fontFamily: T.fontMono, fontSize: "var(--font-size-xs)", color: COLORS.rose }}>
                  ✗ {m}
                </span>
              ))}
            </div>
          ) : null}
          {probe.errors.length > 0 ? (
            <div style={{ paddingTop: "var(--space-6)", borderTop: "1px solid #1A1F22" }}>
              <span style={mutedLabel}>errors:</span>
              {probe.errors.map((e, i) => (
                <div key={i} style={{ fontFamily: T.fontMono, fontSize: "var(--font-size-xs)", color: COLORS.rose, marginTop: "var(--space-4)" }}>
                  {e}
                </div>
              ))}
            </div>
          ) : null}
        </div>
        <div style={{ flex: 1, padding: "16px 20px", display: "flex", flexDirection: "column", gap: "var(--space-10)" }}>
          <span style={mutedLabel}>judge dimensions</span>
          <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
            {DIMS.map((d) => {
              const s = scores?.[d];
              const score = s?.score ?? 3;
              const color = score >= 4 ? COLORS.mint : score >= 3 ? COLORS.amber : COLORS.rose;
              return (
                <div key={d} style={{ display: "flex", alignItems: "center", gap: "var(--space-10)" }}>
                  <span style={{ width: 54, fontFamily: T.fontMono, fontSize: "var(--font-size-sm)", color: COLORS.textMuted, letterSpacing: "0.06em" }}>
                    {d}
                  </span>
                  <div style={{ flex: 1, height: 5, background: "#1A1F22", borderRadius: "var(--radius-xs)", overflow: "hidden" }}>
                    <div style={{ height: "100%", width: `${(score / 5) * 100}%`, background: color }} />
                  </div>
                  <span style={{ width: 24, fontFamily: T.fontMono, fontSize: "var(--font-size-sm)", textAlign: "right", color: "var(--foreground)" }}>
                    {score}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      </div>
      <div style={{ padding: "14px 20px", display: "flex", flexDirection: "column", gap: "var(--space-6)" }}>
        <span style={mutedLabel}>judge rationale</span>
        <p
          style={{
            margin: 0,
            fontFamily: T.fontBody,
            fontSize: "var(--font-size-md)",
            lineHeight: 1.55,
            color: COLORS.textMuted,
          }}
        >
          {probe.rationale || "(no rationale)"}
        </p>
      </div>
      <ProbeTraceSection characterId={characterId} runId={runId} probeId={probe.probeId} />
      <ProbeActions characterId={characterId} characterSlug={characterSlug} probeId={probe.probeId} />
    </div>
  );
}

/**
 * Collapsible "full trace" section under each probe — lazy-loads the trace
 * endpoint when expanded. Shows the exact system blocks sent to the model,
 * the user message, the judge transcript, and the model config that ran.
 *
 * Heavy data; we only fetch on demand to keep the run-detail page snappy
 * even with 20 expandable probes.
 */
function ProbeTraceSection({
  characterId,
  runId,
  probeId,
}: {
  characterId: string;
  runId: string;
  probeId: string;
}) {
  const [open, setOpen] = useState(false);
  const [trace, setTrace] = useState<ProbeTraceResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open || trace) return;
    let cancelled = false;
    fetch(`/api/characters/${characterId}/evals/runs/${runId}/probes/${probeId}/trace`)
      .then(async (r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        if (!cancelled) setTrace((await r.json()) as ProbeTraceResponse);
      })
      .catch((err) => !cancelled && setError(err instanceof Error ? err.message : String(err)));
    return () => {
      cancelled = true;
    };
  }, [open, trace, characterId, runId, probeId]);

  return (
    <div style={{ borderTop: "1px solid #1A1F22" }}>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        style={{
          display: "flex",
          alignItems: "center",
          gap: "var(--space-8)",
          padding: "12px 20px",
          width: "100%",
          background: "transparent",
          border: "none",
          fontFamily: T.fontMono,
          fontSize: "var(--font-size-xs)",
          color: COLORS.textMuted,
          letterSpacing: "0.1em",
          textTransform: "uppercase",
          cursor: "pointer",
          textAlign: "left",
        }}
      >
        {open ? "▾" : "▸"} full trace · request + judge transcript
      </button>
      {open ? (
        error ? (
          <div style={{ padding: "0 20px 14px" }}>
            <ErrorBanner message={error} />
          </div>
        ) : !trace ? (
          <div style={{ padding: "0 20px 14px" }}>
            <PromptSkeleton />
          </div>
        ) : (
          <div style={{ padding: "0 20px 18px", display: "flex", flexDirection: "column", gap: "var(--space-16)" }}>
            <TraceBlock
              label="model config"
              kind="meta"
              body={JSON.stringify(trace.characterRequest.modelConfig, null, 2)}
            />
            <TraceBlock
              label="system · cached envelope (L01–L04)"
              kind="prompt"
              body={trace.characterRequest.system.cached}
            />
            {trace.characterRequest.system.perTurn ? (
              <TraceBlock
                label="system · per-turn (curator)"
                kind="prompt"
                body={trace.characterRequest.system.perTurn}
              />
            ) : (
              <NoteBlock>
                <strong>per-turn curator chunk:</strong>{" "}
                {trace.characterRequest.system.perTurnNote ?? "not stored"}
              </NoteBlock>
            )}
            <TraceBlock label="user · probe input" kind="prompt" body={trace.characterRequest.userMessage} />
            <TraceBlock label="character response" kind="response" body={trace.characterResponse} />
            {trace.judgeRequest ? (
              <>
                <TraceBlock
                  label={`judge · system prompt (${trace.judgeRequest.judgeModel})`}
                  kind="prompt"
                  body={trace.judgeRequest.systemPrompt}
                />
                <TraceBlock
                  label="judge · user prompt (probe-specific)"
                  kind="prompt"
                  body={trace.judgeRequest.userPrompt}
                />
              </>
            ) : (
              <NoteBlock>
                <strong>judge transcript:</strong> not reconstructable — the suite version this run pointed at
                isn&apos;t in the DB anymore.
              </NoteBlock>
            )}
            <TraceBlock
              label="judge · response (tool-use)"
              kind="meta"
              body={JSON.stringify(trace.judgeResponse, null, 2)}
            />
            <TraceBlock label="timing + tokens" kind="meta" body={JSON.stringify(trace.timing, null, 2)} />
          </div>
        )
      ) : null}
    </div>
  );
}

function TraceBlock({
  label,
  body,
  kind,
}: {
  label: string;
  body: string;
  kind: "prompt" | "response" | "meta";
}) {
  // Different background tints help eyeballs separate the prompt from
  // the response from the JSON meta — useful when a probe trace is long.
  const bg =
    kind === "response"
      ? "rgba(91,208,138,0.04)"
      : kind === "meta"
      ? "rgba(255,255,255,0.02)"
      : "var(--background)";
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-6)" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <span style={mutedLabel}>{label}</span>
        <span style={{ fontFamily: T.fontMono, fontSize: "var(--font-size-2xs)", color: COLORS.textFaint }}>
          {body.length.toLocaleString()} chars
        </span>
      </div>
      <pre
        style={{
          margin: 0,
          padding: "var(--space-12)",
          background: bg,
          border: "1px solid var(--border)",
          borderRadius: "var(--radius-sm)",
          fontFamily: T.fontMono,
          fontSize: "var(--font-size-sm)",
          lineHeight: 1.55,
          color: "var(--foreground)",
          whiteSpace: "pre-wrap",
          wordBreak: "break-word",
          maxHeight: 320,
          overflowY: "auto",
        }}
      >
        {body}
      </pre>
    </div>
  );
}

function NoteBlock({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        padding: "10px 12px",
        background: "rgba(199,127,92,0.06)",
        border: `1px solid ${COLORS.amberBorder}`,
        borderRadius: "var(--radius-sm)",
        fontFamily: T.fontBody,
        fontSize: "var(--font-size-base)",
        color: COLORS.textMuted,
        lineHeight: 1.55,
      }}
    >
      {children}
    </div>
  );
}

/**
 * Per-probe action bar — for now just "re-run this probe" against the
 * current production preset. Fires the same fire-and-forget POST as the
 * launch panel; the new run lands in the activity feed.
 */
function ProbeActions({
  characterId,
  characterSlug,
  probeId,
}: {
  characterId: string;
  characterSlug: string;
  probeId: string;
}) {
  const [launching, setLaunching] = useState(false);
  const [result, setResult] = useState<null | { ok: true; runId: string } | { ok: false; error: string }>(null);

  const onReRun = useCallback(async () => {
    setLaunching(true);
    setResult(null);
    try {
      const r = await fetch(`/api/characters/${characterId}/evals/runs`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // Convention: suite slug == character slug (set by the seed script).
        body: JSON.stringify({ suiteSlug: characterSlug, probeIds: [probeId] }),
      });
      if (!r.ok) throw new Error(`${r.status}: ${(await r.text()).slice(0, 240)}`);
      const json = (await r.json()) as { runId: string };
      setResult({ ok: true, runId: json.runId });
    } catch (err) {
      setResult({ ok: false, error: err instanceof Error ? err.message : String(err) });
    } finally {
      setLaunching(false);
    }
  }, [characterId, characterSlug, probeId]);

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: "var(--space-12)",
        padding: "12px 20px",
        borderTop: "1px solid #1A1F22",
      }}
    >
      <button
        type="button"
        onClick={onReRun}
        disabled={launching}
        style={{
          padding: "7px 12px",
          border: `1px solid ${COLORS.mintBorder}`,
          borderRadius: "var(--radius-sm)",
          background: COLORS.mintBg,
          fontFamily: T.fontMono,
          fontSize: "var(--font-size-sm)",
          color: COLORS.mint,
          letterSpacing: "0.06em",
          textTransform: "uppercase",
          cursor: launching ? "wait" : "pointer",
          opacity: launching ? 0.6 : 1,
        }}
      >
        {launching ? "launching…" : "▸ re-run this probe"}
      </button>
      {result && result.ok ? (
        <span style={{ fontFamily: T.fontMono, fontSize: "var(--font-size-sm)", color: COLORS.mint }}>
          ✓ launched · {result.runId.slice(0, 8)}…
        </span>
      ) : result && !result.ok ? (
        <span style={{ fontFamily: T.fontMono, fontSize: "var(--font-size-sm)", color: COLORS.rose }}>
          ⚠ {result.error}
        </span>
      ) : null}
    </div>
  );
}

/* ── Sweeps view ────────────────────────────────────────────────── */

export function SweepsView({
  characterId,
  sweepId,
  onSelectSweep,
}: {
  characterId: string;
  sweepId: string | null;
  onSelectSweep: (id: string | null) => void;
}) {
  const [data, setData] = useState<{ characterId: string; value: SweepsResponse } | null>(null);
  const [error, setError] = useState<{ characterId: string; message: string } | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/characters/${characterId}/evals/sweeps`)
      .then(async (r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const json = (await r.json()) as SweepsResponse;
        if (!cancelled) {
          setData({ characterId, value: json });
          setError(null);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setError({ characterId, message: err instanceof Error ? err.message : String(err) });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [characterId]);

  const activeData = data?.characterId === characterId ? data.value : null;
  const activeError = error?.characterId === characterId ? error.message : null;

  if (activeError) return <ErrorBanner message={activeError} />;
  if (!activeData) return <SweepsContentSkeleton selected={Boolean(sweepId)} />;

  if (sweepId) {
    return <SweepDetail characterId={characterId} sweepId={sweepId} onClose={() => onSelectSweep(null)} />;
  }

  if (activeData.sweeps.length === 0) {
    return (
      <EmptyState
        title="No sweeps yet"
        body="Sweeps grid-search over model + temperature configs to find the Pareto-optimal preset."
        cli={`npx tsx scripts/eval.ts abraham --sweep '{"model":["claude-sonnet-4-5","claude-haiku-4-5"],"temperature":[0.3,0.7,1]}'`}
      />
    );
  }

  return (
    <section style={{ display: "flex", flexDirection: "column", gap: "var(--space-12)" }}>
      <h2
        style={{
          margin: 0,
          fontFamily: T.fontHeading,
          fontSize: "var(--font-size-2xl)",
          fontWeight: 500,
          color: "var(--foreground)",
        }}
      >
        Parameter sweeps
      </h2>
      <p style={{ margin: 0, fontFamily: T.fontBody, fontSize: "var(--font-size-md)", color: COLORS.textMuted, maxWidth: 600 }}>
        Each sweep is a grid search. Click in to see the Pareto frontier, ranked configs, and per-config drilldown.
      </p>
      <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-8)", marginTop: "var(--space-12)" }}>
        {activeData.sweeps.map((s) => (
          <SweepRow key={s.id} sweep={s} onSelect={() => onSelectSweep(s.id)} />
        ))}
      </div>
    </section>
  );
}

function SweepRow({ sweep, onSelect }: { sweep: EvalSweepRecord; onSelect: () => void }) {
  const top = (sweep.rankings as Array<{ configId: string; passed: number; total: number; avgOverall: number }>)?.[0];
  const date = new Date(sweep.startedAt);
  return (
    <button
      type="button"
      onClick={onSelect}
      style={{
        display: "flex",
        alignItems: "center",
        gap: "var(--space-18)",
        padding: "16px 18px",
        borderRadius: "var(--radius-md)",
        background: "var(--card)",
        border: "1px solid var(--card-border)",
        fontFamily: T.fontMono,
        fontSize: "var(--font-size-base)",
        cursor: "pointer",
        textAlign: "left",
        color: "inherit",
        width: "100%",
      }}
    >
      <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: "var(--space-4)", minWidth: 0 }}>
        <span style={{ color: "var(--foreground)" }}>
          {date.toISOString().slice(0, 16).replace("T", " · ")}
        </span>
        <span style={{ color: COLORS.textFaint, fontSize: "var(--font-size-xs)" }}>
          {sweep.configs.length} configs · {sweep.pareto.length} on Pareto · judge {sweep.judgeModel}
        </span>
      </div>
      {top ? (
        <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-4)", alignItems: "flex-end" }}>
          <span style={{ color: COLORS.mint }}>winner: {top.configId}</span>
          <span style={{ color: COLORS.textFaint, fontSize: "var(--font-size-xs)" }}>
            {top.passed}/{top.total} · avg {top.avgOverall.toFixed(2)}
          </span>
        </div>
      ) : null}
      <span style={{ color: COLORS.textFaint }}>→</span>
    </button>
  );
}

function SweepDetail({
  characterId,
  sweepId,
  onClose,
}: {
  characterId: string;
  sweepId: string;
  onClose: () => void;
}) {
  const requestKey = `${characterId}:${sweepId}`;
  const [data, setData] = useState<{ key: string; value: SweepDetailResponse } | null>(null);
  const [error, setError] = useState<{ key: string; message: string } | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/characters/${characterId}/evals/sweeps/${sweepId}`)
      .then(async (r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const json = (await r.json()) as SweepDetailResponse;
        if (!cancelled) {
          setData({ key: requestKey, value: json });
          setError(null);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setError({ key: requestKey, message: err instanceof Error ? err.message : String(err) });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [characterId, sweepId, requestKey]);

  const activeData = data?.key === requestKey ? data.value : null;
  const activeError = error?.key === requestKey ? error.message : null;

  if (activeError) return <ErrorBanner message={activeError} />;
  if (!activeData) return <SweepDetailSkeleton />;

  const { sweep } = activeData;
  const rankings = sweep.rankings as Array<{
    configId: string;
    passed: number;
    total: number;
    errored: number;
    avgOverall: number;
    avgLatencyMs: number;
    estimatedCostUsd: number;
  }>;
  const paretoIds = new Set((sweep.pareto as Array<{ configId: string }>).map((p) => p.configId));

  return (
    <section style={{ display: "flex", flexDirection: "column", gap: "var(--space-24)" }}>
      <header style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: "var(--space-24)" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-6)" }}>
          <span style={{ ...mutedLabel, color: COLORS.mint }}>
            sweep · {sweep.configs.length} configs · judge {sweep.judgeModel}
          </span>
          <h2 style={{ margin: 0, fontFamily: T.fontHeading, fontSize: "var(--font-size-4xl)", fontWeight: 500, color: "var(--foreground)" }}>
            {new Date(sweep.startedAt).toISOString().slice(0, 16).replace("T", " · ")}
          </h2>
          <span style={{ fontFamily: T.fontMono, fontSize: "var(--font-size-sm)", color: COLORS.textFaint }}>
            {sweep.completedAt
              ? `wall ${Math.round((+new Date(sweep.completedAt) - +new Date(sweep.startedAt)) / 60000)} min`
              : "still running"}{" "}
            · sweep id {sweep.id.slice(0, 8)}…
          </span>
        </div>
        <button
          type="button"
          onClick={onClose}
          style={{
            padding: "7px 12px",
            border: "1px solid var(--card-border)",
            borderRadius: "var(--radius-sm)",
            background: "transparent",
            fontFamily: T.fontMono,
            fontSize: "var(--font-size-sm)",
            color: COLORS.textMuted,
            letterSpacing: "0.06em",
            textTransform: "uppercase",
            cursor: "pointer",
            flexShrink: 0,
          }}
        >
          ← all sweeps
        </button>
      </header>

      <ParetoChart rankings={rankings} paretoIds={paretoIds} />

      <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-12)" }}>
        <h3 style={{ margin: 0, fontFamily: T.fontHeading, fontSize: "var(--font-size-xl)", fontWeight: 500, color: "var(--foreground)" }}>
          Ranked configs
        </h3>
        <div style={{ border: "1px solid var(--card-border)", borderRadius: "var(--radius-md)", background: "var(--card)", overflow: "hidden" }}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: "var(--space-14)",
              padding: "10px 16px",
              fontFamily: T.fontMono,
              fontSize: "var(--font-size-2xs)",
              color: COLORS.textFaint,
              letterSpacing: "0.1em",
              textTransform: "uppercase",
              background: "var(--background)",
              borderBottom: "1px solid var(--border)",
            }}
          >
            <span style={{ width: 22, flexShrink: 0, textAlign: "center" }}>#</span>
            <span style={{ flex: 1 }}>config</span>
            <span style={{ width: 64, flexShrink: 0, textAlign: "right" }}>passed</span>
            <span style={{ width: 54, flexShrink: 0, textAlign: "right" }}>avg</span>
            <span style={{ width: 64, flexShrink: 0, textAlign: "right" }}>latency</span>
            <span style={{ width: 64, flexShrink: 0, textAlign: "right" }}>cost</span>
            <span style={{ width: 60, flexShrink: 0, textAlign: "right" }}>pareto</span>
          </div>
          {rankings.map((r, i) => {
            const onPareto = paretoIds.has(r.configId);
            return (
              <div
                key={r.configId}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "var(--space-14)",
                  padding: "13px 16px",
                  fontFamily: T.fontMono,
                  fontSize: "var(--font-size-base)",
                  borderBottom: "1px solid var(--border)",
                  background: i === 0 ? COLORS.mintBg : "transparent",
                  borderLeft: i === 0 ? `2px solid ${COLORS.mint}` : "2px solid transparent",
                  paddingLeft: i === 0 ? 14 : 16,
                }}
              >
                <span style={{ width: 22, flexShrink: 0, textAlign: "center", color: i === 0 ? COLORS.mint : COLORS.textMuted }}>
                  {i + 1}
                </span>
                <div style={{ flex: 1, display: "flex", alignItems: "center", gap: "var(--space-10)", color: "var(--foreground)" }}>
                  <span>{r.configId}</span>
                  {i === 0 ? (
                    <span style={{ padding: "2px 7px", border: `1px solid ${COLORS.mintBorder}`, borderRadius: "var(--radius-xs)", fontSize: "var(--font-size-2xs)", color: COLORS.mint, letterSpacing: "0.08em", textTransform: "uppercase" }}>
                      winner
                    </span>
                  ) : null}
                  {r.errored > 0 ? (
                    <span style={{ padding: "2px 7px", border: `1px solid ${COLORS.amberBorder}`, borderRadius: "var(--radius-xs)", fontSize: "var(--font-size-2xs)", color: COLORS.rose, letterSpacing: "0.08em", textTransform: "uppercase" }}>
                      ⚠ {r.errored} err
                    </span>
                  ) : null}
                </div>
                <span style={{ width: 64, flexShrink: 0, textAlign: "right", color: r.passed === r.total ? COLORS.mint : "var(--foreground)" }}>
                  {r.passed}/{r.total}
                </span>
                <span style={{ width: 54, flexShrink: 0, textAlign: "right", color: "var(--foreground)" }}>
                  {r.avgOverall.toFixed(2)}
                </span>
                <span style={{ width: 64, flexShrink: 0, textAlign: "right", color: COLORS.textMuted }}>
                  {(r.avgLatencyMs / 1000).toFixed(1)}s
                </span>
                <span
                  style={{
                    width: 64,
                    flexShrink: 0,
                    textAlign: "right",
                    color: r.estimatedCostUsd > 1 ? COLORS.amber : r.estimatedCostUsd < 0.2 ? COLORS.mint : "var(--foreground)",
                  }}
                >
                  ${r.estimatedCostUsd.toFixed(2)}
                </span>
                <span style={{ width: 60, flexShrink: 0, textAlign: "right", color: onPareto ? COLORS.mint : COLORS.textFaint }}>
                  {onPareto ? "✓" : "—"}
                </span>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}

/**
 * Pareto chart — cost on the x-axis (log), avg overall on the y-axis,
 * dots colored mint if Pareto-optimal, gray if dominated. Renders as inline
 * SVG, no chart library.
 */
function ParetoChart({
  rankings,
  paretoIds,
}: {
  rankings: Array<{ configId: string; avgOverall: number; estimatedCostUsd: number; avgLatencyMs: number; errored: number; total: number }>;
  paretoIds: Set<string>;
}) {
  const live = rankings.filter((r) => r.errored < r.total);
  if (live.length === 0) {
    return (
      <EmptyState title="No usable configs" body="Every config in this sweep errored out. Re-run when the API stabilizes." />
    );
  }

  const W = 920;
  const H = 320;
  const PAD = { l: 60, r: 30, t: 30, b: 50 };

  const costs = live.map((r) => Math.max(0.001, r.estimatedCostUsd));
  const overalls = live.map((r) => r.avgOverall);

  const logMin = Math.log10(Math.min(...costs) * 0.7);
  const logMax = Math.log10(Math.max(...costs) * 1.3);
  const yMin = Math.min(...overalls) - 0.1;
  const yMax = Math.max(...overalls) + 0.1;

  const xScale = (cost: number) => {
    const v = (Math.log10(cost) - logMin) / (logMax - logMin);
    return PAD.l + v * (W - PAD.l - PAD.r);
  };
  const yScale = (overall: number) => {
    const v = 1 - (overall - yMin) / (yMax - yMin);
    return PAD.t + v * (H - PAD.t - PAD.b);
  };

  const xTicks = [0.1, 0.3, 1.0, 2.5].filter((t) => Math.log10(t) >= logMin && Math.log10(t) <= logMax);
  const yTicks = [4.2, 4.4, 4.6, 4.8].filter((t) => t >= yMin && t <= yMax);

  const winner = live[0];

  return (
    <section
      style={{
        border: "1px solid var(--card-border)",
        borderRadius: "var(--radius-lg)",
        background: "var(--card)",
        overflow: "hidden",
      }}
    >
      <div
        style={{
          padding: "18px 22px",
          borderBottom: "1px solid var(--border)",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
        }}
      >
        <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-4)" }}>
          <span style={{ ...mutedLabel, color: COLORS.mint }}>pareto frontier · quality × cost</span>
          <span style={{ fontFamily: T.fontBody, fontSize: "var(--font-size-md)", color: COLORS.textMuted }}>
            {paretoIds.size} of {rankings.length} configs on the frontier.{" "}
            {live.length < rankings.length ? `${rankings.length - live.length} excluded (all errored).` : ""}
          </span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: "var(--space-14)", fontFamily: T.fontMono, fontSize: "var(--font-size-xs)", letterSpacing: "0.06em" }}>
          <span style={{ display: "flex", alignItems: "center", gap: "var(--space-6)", color: COLORS.mint }}>
            <span style={{ width: 8, height: 8, borderRadius: 50, background: COLORS.mint }} />
            pareto-optimal · {paretoIds.size}
          </span>
          <span style={{ display: "flex", alignItems: "center", gap: "var(--space-6)", color: COLORS.textFaint }}>
            <span style={{ width: 8, height: 8, borderRadius: 50, background: "#3A4146" }} />
            dominated · {live.length - paretoIds.size}
          </span>
        </div>
      </div>
      <div style={{ background: "var(--background)", padding: "var(--space-16)" }}>
        <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", height: "auto" }}>
          {/* Grid lines */}
          {yTicks.map((t) => (
            <line
              key={t}
              x1={PAD.l}
              x2={W - PAD.r}
              y1={yScale(t)}
              y2={yScale(t)}
              stroke="var(--border)"
              strokeWidth={1}
            />
          ))}
          {/* Y-axis labels */}
          {yTicks.map((t) => (
            <text
              key={t}
              x={PAD.l - 8}
              y={yScale(t) + 4}
              textAnchor="end"
              style={{ fontFamily: "JetBrains Mono, monospace", fontSize: "var(--font-size-xs)", fill: COLORS.textFaint }}
            >
              {t.toFixed(2)}
            </text>
          ))}
          {/* X-axis labels */}
          {xTicks.map((t) => (
            <text
              key={t}
              x={xScale(t)}
              y={H - PAD.b + 18}
              textAnchor="middle"
              style={{ fontFamily: "JetBrains Mono, monospace", fontSize: "var(--font-size-xs)", fill: COLORS.textFaint }}
            >
              ${t.toFixed(2)}
            </text>
          ))}
          {/* Axis labels */}
          <text
            x={W / 2}
            y={H - 8}
            textAnchor="middle"
            style={{ fontFamily: "JetBrains Mono, monospace", fontSize: "var(--font-size-xs)", fill: COLORS.textMuted, letterSpacing: "0.1em" }}
          >
            COST PER RUN (LOG SCALE) →
          </text>
          <text
            x={-H / 2}
            y={14}
            transform={`rotate(-90)`}
            textAnchor="middle"
            style={{ fontFamily: "JetBrains Mono, monospace", fontSize: "var(--font-size-xs)", fill: COLORS.textMuted, letterSpacing: "0.1em" }}
          >
            AVG OVERALL →
          </text>
          {/* Dots */}
          {live.map((r) => {
            const x = xScale(Math.max(0.001, r.estimatedCostUsd));
            const y = yScale(r.avgOverall);
            // Dot radius scales with latency (slower = bigger).
            const radius = 8 + Math.min(8, r.avgLatencyMs / 3000);
            const isPareto = paretoIds.has(r.configId);
            const isWinner = r.configId === winner.configId;
            return (
              <g key={r.configId}>
                <circle
                  cx={x}
                  cy={y}
                  r={radius}
                  fill={isPareto ? COLORS.mint : "#3A4146"}
                  fillOpacity={isWinner ? 1 : isPareto ? 0.75 : 1}
                  stroke={isWinner ? COLORS.mint : "none"}
                  strokeWidth={isWinner ? 2 : 0}
                  strokeOpacity={isWinner ? 0.4 : 0}
                />
                <text
                  x={x + radius + 6}
                  y={y + 4}
                  style={{
                    fontFamily: "JetBrains Mono, monospace",
                    fontSize: "var(--font-size-xs)",
                    fill: isPareto ? "var(--foreground)" : COLORS.textFaint,
                  }}
                >
                  {r.configId}
                  {isWinner ? " ← winner" : ""}
                </text>
              </g>
            );
          })}
        </svg>
      </div>
    </section>
  );
}

/* ── Suites view ────────────────────────────────────────────────── */

type SuiteListItem = {
  id: string;
  slug: string;
  version: string;
  probeCount: number;
  notes: string | null;
  releaseNotes: string | null;
  publishedAt: string | null;
  forkedFromId: string | null;
  createdAt: string;
};

export function SuitesView({
  characterId,
  suiteId,
  editing,
  onSelectSuite,
  onStartEditing,
  onStopEditing,
}: {
  characterId: string;
  suiteId: string | null;
  editing: boolean;
  onSelectSuite: (id: string | null) => void;
  onStartEditing: (id: string) => void;
  onStopEditing: () => void;
}) {
  const [data, setData] = useState<{ suites: SuiteListItem[] } | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  useEffect(() => {
    let cancelled = false;
    fetch(`/api/characters/${characterId}/evals/suites`)
      .then(async (r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        if (!cancelled) setData(await r.json());
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [characterId, reloadKey]);

  if (!data) return <SuitesContentSkeleton mode={editing && suiteId ? "editor" : suiteId ? "detail" : "list"} />;

  // If editing a draft, render the editor.
  if (editing && suiteId) {
    // Find the baseline (the suite this draft was forked from) for diffing.
    const draft = data.suites.find((s) => s.id === suiteId) ?? null;
    const baselineId = draft?.forkedFromId ?? null;
    return (
      <SuiteEditor
        characterId={characterId}
        draftId={suiteId}
        baselineId={baselineId}
        onDiscarded={() => {
          setReloadKey((k) => k + 1);
          onSelectSuite(null);
          onStopEditing();
        }}
        onPublished={(publishedId) => {
          setReloadKey((k) => k + 1);
          onSelectSuite(publishedId);
          onStopEditing();
        }}
        onClose={() => onStopEditing()}
      />
    );
  }

  // If a suite is selected (read-only mode), show its full explorer.
  if (suiteId) {
    return (
      <SuiteExplorer
        characterId={characterId}
        suiteId={suiteId}
        suites={data.suites}
        onClose={() => onSelectSuite(null)}
        onStartEditing={onStartEditing}
        onSelectSuite={onSelectSuite}
        reloadList={() => setReloadKey((k) => k + 1)}
      />
    );
  }

  if (data.suites.length === 0) {
    return <EmptyState title="No published suites yet" body="Suites are authored in TS and published via the seed script." />;
  }
  // Split drafts from published so they render in their own group at top.
  const drafts = data.suites.filter((s) => s.publishedAt === null);
  const published = data.suites.filter((s) => s.publishedAt !== null);

  return (
    <section style={{ display: "flex", flexDirection: "column", gap: "var(--space-18)" }}>
      <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-6)" }}>
        <h2 style={{ margin: 0, fontFamily: T.fontHeading, fontSize: "var(--font-size-2xl)", fontWeight: 500, color: "var(--foreground)" }}>
          Suites
        </h2>
        <p style={{ margin: 0, fontFamily: T.fontBody, fontSize: "var(--font-size-md)", color: COLORS.textMuted, maxWidth: 600 }}>
          Published versions are immutable — past runs stay pointing at them. Click into one to read probes; fork it to start a draft.
        </p>
      </div>

      {drafts.length > 0 ? (
        <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-8)" }}>
          <span style={{ ...mutedLabel, color: COLORS.amber }}>● drafts in progress · {drafts.length}</span>
          {drafts.map((s) => (
            <SuiteRow key={s.id} suite={s} onClick={() => onSelectSuite(s.id)} />
          ))}
        </div>
      ) : null}

      <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-8)" }}>
        <span style={mutedLabel}>published · {published.length}</span>
        {published.map((s) => (
          <SuiteRow key={s.id} suite={s} onClick={() => onSelectSuite(s.id)} />
        ))}
      </div>
    </section>
  );
}

function SuiteRow({ suite, onClick }: { suite: SuiteListItem; onClick: () => void }) {
  const isDraft = suite.publishedAt === null;
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        display: "flex",
        alignItems: "center",
        gap: "var(--space-14)",
        padding: "14px 16px",
        border: isDraft ? `1px solid ${COLORS.amberBorder}` : "1px solid var(--card-border)",
        borderRadius: "var(--radius-md)",
        background: isDraft ? "#13100E" : "var(--card)",
        fontFamily: T.fontMono,
        fontSize: "var(--font-size-base)",
        cursor: "pointer",
        textAlign: "left",
        color: "inherit",
        width: "100%",
      }}
    >
      <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: "var(--space-4)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "var(--space-8)" }}>
          <span style={{ color: "var(--foreground)" }}>
            {suite.slug} <span style={{ color: COLORS.textMuted }}>· v{suite.version}</span>
          </span>
          {isDraft ? (
            <span
              style={{
                padding: "2px 7px",
                border: `1px solid ${COLORS.amberBorder}`,
                borderRadius: "var(--radius-xs)",
                fontSize: "var(--font-size-2xs)",
                color: COLORS.amber,
                letterSpacing: "0.08em",
                textTransform: "uppercase",
              }}
            >
              draft
            </span>
          ) : null}
        </div>
        {suite.releaseNotes || suite.notes ? (
          <span style={{ color: COLORS.textFaint, fontSize: "var(--font-size-sm)" }}>{suite.releaseNotes ?? suite.notes}</span>
        ) : null}
      </div>
      <span style={{ color: COLORS.textMuted }}>{suite.probeCount} probes</span>
      <span style={{ color: COLORS.textFaint }}>
        {new Date(suite.publishedAt ?? suite.createdAt).toISOString().slice(0, 10)}
      </span>
      <span style={{ color: COLORS.textFaint }}>→</span>
    </button>
  );
}


/**
 * Per-suite drilldown — full probe list with input, rubric, expectations,
 * passThreshold. Read-only; edits happen in the TS suite file and get
 * published via the seed script (one new version per publish).
 */
function SuiteExplorer({
  characterId,
  suiteId,
  suites,
  onClose,
  onStartEditing,
  onSelectSuite,
  reloadList,
}: {
  characterId: string;
  suiteId: string;
  suites: SuiteListItem[];
  onClose: () => void;
  onStartEditing: (id: string) => void;
  onSelectSuite: (id: string) => void;
  reloadList: () => void;
}) {
  const [data, setData] = useState<SuiteDetailResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [forking, setForking] = useState(false);
  const [forkError, setForkError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setData(null);
    setError(null);
    fetch(`/api/characters/${characterId}/evals/suites/${suiteId}`)
      .then(async (r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        if (!cancelled) setData(await r.json());
      })
      .catch((err) => !cancelled && setError(err instanceof Error ? err.message : String(err)));
    return () => {
      cancelled = true;
    };
  }, [characterId, suiteId]);

  // Existing draft for this slug — if one exists, prefer "open existing draft"
  // over offering to fork a new one (the partial unique index blocks two anyway).
  const existingDraft = useMemo(() => {
    const current = suites.find((s) => s.id === suiteId);
    if (!current) return null;
    return suites.find((s) => s.slug === current.slug && s.publishedAt === null) ?? null;
  }, [suites, suiteId]);

  const onFork = useCallback(async () => {
    setForking(true);
    setForkError(null);
    try {
      const r = await fetch(`/api/characters/${characterId}/evals/suites/${suiteId}/fork`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      if (!r.ok) throw new Error(`${r.status}: ${(await r.text()).slice(0, 240)}`);
      const json = (await r.json()) as { draft: { id: string } };
      reloadList();
      onStartEditing(json.draft.id);
    } catch (err) {
      setForkError(err instanceof Error ? err.message : String(err));
    } finally {
      setForking(false);
    }
  }, [characterId, suiteId, reloadList, onStartEditing]);

  if (error) return <ErrorBanner message={error} />;
  if (!data) return <SuiteDetailSkeleton />;

  const suite = data.suite;
  const probes = suite.probes;
  const isDraft = suite.publishedAt === null;

  // Group probes by category so the explorer matches the run-detail breakdown.
  const grouped: Record<string, ProbeDef[]> = {};
  for (const p of probes) {
    if (!grouped[p.category]) grouped[p.category] = [];
    grouped[p.category].push(p);
  }

  return (
    <section style={{ display: "flex", flexDirection: "column", gap: "var(--space-20)" }}>
      <header style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: "var(--space-24)" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-6)" }}>
          <span style={{ ...mutedLabel, color: isDraft ? COLORS.amber : COLORS.mint }}>
            {isDraft ? "draft" : "published"} · v{suite.version} · {probes.length} probes
          </span>
          <h2 style={{ margin: 0, fontFamily: T.fontHeading, fontSize: "var(--font-size-4xl)", fontWeight: 500, color: "var(--foreground)" }}>
            {suite.slug}
          </h2>
          {suite.releaseNotes || suite.notes ? (
            <p style={{ margin: 0, fontFamily: T.fontBody, fontSize: "var(--font-size-md)", color: COLORS.textMuted, maxWidth: 620 }}>
              {suite.releaseNotes ?? suite.notes}
            </p>
          ) : null}
        </div>
        <div style={{ display: "flex", gap: "var(--space-8)" }}>
          <button
            type="button"
            onClick={onClose}
            style={{
              padding: "7px 12px",
              border: "1px solid var(--card-border)",
              borderRadius: "var(--radius-sm)",
              background: "transparent",
              fontFamily: T.fontMono,
              fontSize: "var(--font-size-sm)",
              color: COLORS.textMuted,
              letterSpacing: "0.06em",
              textTransform: "uppercase",
              cursor: "pointer",
              flexShrink: 0,
            }}
          >
            ← all suites
          </button>
          {isDraft ? (
            <button
              type="button"
              onClick={() => onStartEditing(suiteId)}
              style={{
                padding: "7px 14px",
                border: `1px solid ${COLORS.amberBorder}`,
                borderRadius: "var(--radius-sm)",
                background: COLORS.amberBg,
                fontFamily: T.fontMono,
                fontSize: "var(--font-size-sm)",
                color: COLORS.amber,
                letterSpacing: "0.06em",
                textTransform: "uppercase",
                cursor: "pointer",
                flexShrink: 0,
              }}
            >
              ✎ resume editing
            </button>
          ) : existingDraft ? (
            <button
              type="button"
              onClick={() => onSelectSuite(existingDraft.id)}
              style={{
                padding: "7px 14px",
                border: `1px solid ${COLORS.amberBorder}`,
                borderRadius: "var(--radius-sm)",
                background: COLORS.amberBg,
                fontFamily: T.fontMono,
                fontSize: "var(--font-size-sm)",
                color: COLORS.amber,
                letterSpacing: "0.06em",
                textTransform: "uppercase",
                cursor: "pointer",
                flexShrink: 0,
              }}
            >
              → open draft v{existingDraft.version}
            </button>
          ) : (
            <button
              type="button"
              onClick={onFork}
              disabled={forking}
              style={{
                padding: "7px 14px",
                border: `1px solid ${COLORS.mintBorder}`,
                borderRadius: "var(--radius-sm)",
                background: COLORS.mintBg,
                fontFamily: T.fontMono,
                fontSize: "var(--font-size-sm)",
                color: COLORS.mint,
                letterSpacing: "0.06em",
                textTransform: "uppercase",
                cursor: forking ? "wait" : "pointer",
                flexShrink: 0,
                opacity: forking ? 0.6 : 1,
              }}
            >
              {forking ? "forking…" : "⑂ fork to draft"}
            </button>
          )}
        </div>
      </header>

      {forkError ? <ErrorBanner message={forkError} /> : null}

      <div
        style={{
          padding: "14px 16px",
          border: "1px solid var(--card-border)",
          borderRadius: "var(--radius-md)",
          background: "var(--card)",
          fontFamily: T.fontBody,
          fontSize: "var(--font-size-md)",
          color: COLORS.textMuted,
          lineHeight: 1.55,
        }}
      >
        {isDraft ? (
          <>
            <strong style={{ color: COLORS.amber }}>Draft</strong> — mutable until published. Past runs are pinned to the version they were judged against; new runs land on the latest <em>published</em> version (drafts don&apos;t shadow it).
          </>
        ) : (
          <>
            <strong>Published</strong> and immutable. Fork to draft to make changes; the new draft starts from this row&apos;s probes and goes through the same publish flow.
          </>
        )}
      </div>

      {Object.entries(grouped).map(([category, ps]) => (
        <div key={category} style={{ display: "flex", flexDirection: "column", gap: "var(--space-10)" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <span style={{ ...mutedLabel, color: COLORS.textMuted }}>{category} · {ps.length}</span>
          </div>
          {ps.map((probe) => (
            <ProbeDefCard key={probe.id} probe={probe} />
          ))}
        </div>
      ))}
    </section>
  );
}

function ProbeDefCard({ probe }: { probe: ProbeDef }) {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: "var(--space-12)",
        padding: "var(--space-16)",
        border: "1px solid var(--card-border)",
        borderRadius: "var(--radius-md)",
        background: "var(--card)",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: "var(--space-10)" }}>
        <span style={{ fontFamily: T.fontMono, fontSize: "var(--font-size-base)", color: "var(--foreground)" }}>{probe.id}</span>
        {typeof probe.passThreshold === "number" ? (
          <span
            style={{
              padding: "2px 7px",
              border: "1px solid var(--card-border)",
              borderRadius: "var(--radius-xs)",
              fontFamily: T.fontMono,
              fontSize: "var(--font-size-2xs)",
              color: COLORS.textMuted,
              letterSpacing: "0.08em",
              textTransform: "uppercase",
            }}
          >
            pass ≥ {probe.passThreshold}
          </span>
        ) : null}
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-6)" }}>
        <span style={mutedLabel}>input</span>
        <p
          style={{
            margin: 0,
            fontFamily: T.fontBody,
            fontStyle: "italic",
            fontSize: "var(--font-size-md)",
            lineHeight: 1.55,
            color: "var(--foreground)",
            padding: "8px 12px",
            background: "var(--background)",
            borderRadius: "var(--radius-sm)",
            border: "1px solid var(--border)",
          }}
        >
          &ldquo;{probe.input}&rdquo;
        </p>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-6)" }}>
        <span style={mutedLabel}>rubric</span>
        <p
          style={{
            margin: 0,
            fontFamily: T.fontBody,
            fontSize: "var(--font-size-md)",
            lineHeight: 1.6,
            color: COLORS.textMuted,
            whiteSpace: "pre-wrap",
          }}
        >
          {probe.rubric.trim()}
        </p>
      </div>

      {probe.expectations &&
      (probe.expectations.mustContain?.length ||
        probe.expectations.mustNotContain?.length ||
        probe.expectations.maxOutputTokens ||
        probe.expectations.voiceCheck ||
        probe.expectations.scopeCheck ||
        probe.expectations.frameCheck) ? (
        <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-8)" }}>
          <span style={mutedLabel}>expectations</span>
          <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-6)", fontFamily: T.fontMono, fontSize: "var(--font-size-sm)" }}>
            {probe.expectations.mustContain?.map((s) => (
              <span key={`mc-${s}`} style={{ color: COLORS.mint }}>
                ✓ must contain: <span style={{ color: "var(--foreground)" }}>&ldquo;{s}&rdquo;</span>
              </span>
            ))}
            {probe.expectations.mustNotContain?.map((s) => (
              <span key={`mnc-${s}`} style={{ color: COLORS.rose }}>
                ✗ must NOT contain: <span style={{ color: "var(--foreground)" }}>&ldquo;{s}&rdquo;</span>
              </span>
            ))}
            {typeof probe.expectations.maxOutputTokens === "number" ? (
              <span style={{ color: COLORS.amber }}>
                ⚡ brevity ceiling: <span style={{ color: "var(--foreground)" }}>{probe.expectations.maxOutputTokens} tokens</span>
              </span>
            ) : null}
            {probe.expectations.voiceCheck ? (
              <span style={{ color: COLORS.textMuted }}>
                voice: <span style={{ color: "var(--foreground)" }}>{probe.expectations.voiceCheck}</span>
              </span>
            ) : null}
            {probe.expectations.scopeCheck ? (
              <span style={{ color: COLORS.textMuted }}>
                scope: <span style={{ color: "var(--foreground)" }}>{probe.expectations.scopeCheck}</span>
              </span>
            ) : null}
            {probe.expectations.frameCheck ? (
              <span style={{ color: COLORS.textMuted }}>
                frame: <span style={{ color: "var(--foreground)" }}>{probe.expectations.frameCheck}</span>
              </span>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}

/* ── Shared atoms ───────────────────────────────────────────────── */

const mutedLabel: React.CSSProperties = {
  fontFamily: T.fontMono,
  fontSize: "var(--font-size-xs)",
  color: COLORS.textFaint,
  letterSpacing: "0.1em",
  textTransform: "uppercase",
};

function ErrorBanner({ message }: { message: string }) {
  return (
    <div
      style={{
        padding: "14px 16px",
        border: "1px solid #3D1E1A",
        borderRadius: "var(--radius-sm)",
        background: "#130E11",
        fontFamily: T.fontMono,
        fontSize: "var(--font-size-base)",
        color: COLORS.rose,
      }}
    >
      ⚠ {message}
    </div>
  );
}

function EmptyState({ title, body, cli }: { title: string; body: string; cli?: string }) {
  return (
    <div
      style={{
        padding: "var(--space-32)",
        border: "1px dashed var(--card-border)",
        borderRadius: "var(--radius-lg)",
        background: "var(--card)",
        display: "flex",
        flexDirection: "column",
        gap: "var(--space-14)",
        alignItems: "flex-start",
      }}
    >
      <h3 style={{ margin: 0, fontFamily: T.fontHeading, fontSize: "var(--font-size-2xl)", fontWeight: 500, color: "var(--foreground)" }}>
        {title}
      </h3>
      <p style={{ margin: 0, fontFamily: T.fontBody, fontSize: "var(--font-size-md)", color: COLORS.textMuted, maxWidth: 540 }}>
        {body}
      </p>
      {cli ? (
        <pre
          style={{
            margin: 0,
            padding: "10px 14px",
            background: "var(--background)",
            border: "1px solid var(--border)",
            borderRadius: "var(--radius-sm)",
            fontFamily: T.fontMono,
            fontSize: "var(--font-size-sm)",
            color: COLORS.textMuted,
            overflowX: "auto",
            maxWidth: "100%",
          }}
        >
          {cli}
        </pre>
      ) : null}
    </div>
  );
}

function ComingSoon({ label }: { label: string }) {
  return (
    <div style={{ padding: "var(--space-32)", fontFamily: T.fontMono, fontSize: "var(--font-size-sm)", color: COLORS.textMuted }}>
      {label}
    </div>
  );
}
