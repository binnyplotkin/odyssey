"use client";

import { useMemo, useState } from "react";
import { MODEL_REGISTRY, type ModelOption, type ProviderId, type QualityTier, type LatencyTier } from "@/lib/model-registry";

/**
 * Multi-provider model browser. Inline component used by L04 — but
 * structured so it could be lifted to a standalone route
 * (`/harness/models`) without changing the implementation.
 *
 * Three surfaces:
 *   - Filter strip       — provider / quality tier / latency tier toggles
 *   - Sortable table     — click any column header to sort
 *   - Compare drawer     — pick 2-3 models, see them side-by-side
 *
 * The "selected" model from L04 flows in via `currentModel`; clicking
 * "Adopt" in any row calls `onAdopt(id)` so the L04 picker syncs.
 *
 * No data fetching — everything reads from the static `MODEL_REGISTRY`.
 */

const T = {
  fontHeading: "'Space Grotesk', sans-serif",
  fontBody: "'Inter', sans-serif",
  fontMono: "var(--font-mono, 'JetBrains Mono', monospace)",
};

type SortKey = "label" | "provider" | "input" | "output" | "context" | "latency" | "quality";
type SortDir = "asc" | "desc";

const ALL_PROVIDERS: ProviderId[] = ["anthropic", "openai", "cerebras", "groq"];
const ALL_QUALITY_TIERS: QualityTier[] = ["frontier", "production", "budget"];
const ALL_LATENCY_TIERS: LatencyTier[] = ["frontier", "balanced", "fast", "instant"];

type Props = {
  /** Currently-active model in L04 — highlighted with "in use" badge. */
  currentModel: string;
  /** Click handler for the "Adopt" button. Wired to L04's setModel(). */
  onAdopt: (id: string) => void;
};

export function ModelBrowser({ currentModel, onAdopt }: Props) {
  const [providers, setProviders] = useState<Set<ProviderId>>(new Set(ALL_PROVIDERS));
  const [quality, setQuality] = useState<Set<QualityTier>>(new Set(ALL_QUALITY_TIERS));
  const [latency, setLatency] = useState<Set<LatencyTier>>(new Set(ALL_LATENCY_TIERS));
  const [chatOnly, setChatOnly] = useState(true);
  const [sortKey, setSortKey] = useState<SortKey>("input");
  const [sortDir, setSortDir] = useState<SortDir>("asc");
  const [comparing, setComparing] = useState<string[]>([]);

  const filtered = useMemo(() => {
    return MODEL_REGISTRY.filter((m) => {
      if (chatOnly && !m.modes.includes("chat")) return false;
      if (!providers.has(m.provider)) return false;
      if (!quality.has(m.qualityTier)) return false;
      if (!latency.has(m.latencyTier)) return false;
      return true;
    }).sort((a, b) => compareModels(a, b, sortKey, sortDir));
  }, [providers, quality, latency, chatOnly, sortKey, sortDir]);

  const toggleSet = <T,>(set: Set<T>, value: T, setter: (s: Set<T>) => void) => {
    const next = new Set(set);
    if (next.has(value)) next.delete(value);
    else next.add(value);
    setter(next);
  };

  const toggleCompare = (id: string) => {
    setComparing((prev) => {
      if (prev.includes(id)) return prev.filter((p) => p !== id);
      if (prev.length >= 3) return [prev[1], prev[2], id]; // cap at 3 (rolling)
      return [...prev, id];
    });
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-14)" }}>
      <FilterStrip
        providers={providers}
        toggleProvider={(p) => toggleSet(providers, p, setProviders)}
        quality={quality}
        toggleQuality={(q) => toggleSet(quality, q, setQuality)}
        latency={latency}
        toggleLatency={(l) => toggleSet(latency, l, setLatency)}
        chatOnly={chatOnly}
        setChatOnly={setChatOnly}
        resultCount={filtered.length}
      />

      <ModelTable
        rows={filtered}
        currentModel={currentModel}
        comparing={comparing}
        sortKey={sortKey}
        sortDir={sortDir}
        onSort={(key) => {
          if (key === sortKey) setSortDir(sortDir === "asc" ? "desc" : "asc");
          else {
            setSortKey(key);
            // Default direction per column — price/context should sort meaningfully on first click.
            setSortDir(key === "label" || key === "provider" ? "asc" : "asc");
          }
        }}
        onAdopt={onAdopt}
        onToggleCompare={toggleCompare}
      />

      {comparing.length > 0 && (
        <ComparePanel
          ids={comparing}
          onRemove={(id) => setComparing((prev) => prev.filter((p) => p !== id))}
          onClear={() => setComparing([])}
          currentModel={currentModel}
          onAdopt={onAdopt}
        />
      )}
    </div>
  );
}

/* ── Filter strip ─────────────────────────────────────────── */

function FilterStrip({
  providers, toggleProvider,
  quality, toggleQuality,
  latency, toggleLatency,
  chatOnly, setChatOnly,
  resultCount,
}: {
  providers: Set<ProviderId>;
  toggleProvider: (p: ProviderId) => void;
  quality: Set<QualityTier>;
  toggleQuality: (q: QualityTier) => void;
  latency: Set<LatencyTier>;
  toggleLatency: (l: LatencyTier) => void;
  chatOnly: boolean;
  setChatOnly: (b: boolean) => void;
  resultCount: number;
}) {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: "var(--space-10)",
        padding: "var(--space-14)",
        background: "var(--control-bg)",
        border: "1px solid var(--control-border)",
        borderRadius: "var(--radius-sm)",
      }}
    >
      <FilterRow label="provider">
        {ALL_PROVIDERS.map((p) => (
          <FilterChip key={p} label={p} active={providers.has(p)} onClick={() => toggleProvider(p)} />
        ))}
      </FilterRow>
      <FilterRow label="quality tier">
        {ALL_QUALITY_TIERS.map((q) => (
          <FilterChip key={q} label={q} active={quality.has(q)} onClick={() => toggleQuality(q)} />
        ))}
      </FilterRow>
      <FilterRow label="latency tier">
        {ALL_LATENCY_TIERS.map((l) => (
          <FilterChip key={l} label={l} active={latency.has(l)} onClick={() => toggleLatency(l)} />
        ))}
      </FilterRow>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", paddingTop: "var(--space-4)", borderTop: "1px solid var(--border-subtle)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "var(--space-14)" }}>
          <FilterChip
            label="chat-only"
            active={chatOnly}
            onClick={() => setChatOnly(!chatOnly)}
          />
        </div>
        <span style={{ fontFamily: T.fontMono, fontSize: "var(--font-size-sm)", color: "var(--text-tertiary)" }}>
          {resultCount} model{resultCount === 1 ? "" : "s"} match
        </span>
      </div>
    </div>
  );
}

function FilterRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: "var(--space-12)", flexWrap: "wrap" }}>
      <span style={{ fontFamily: T.fontMono, fontSize: "var(--font-size-xs)", letterSpacing: "0.12em", color: "var(--text-quaternary)", textTransform: "uppercase", minWidth: 80 }}>
        {label}
      </span>
      <div style={{ display: "flex", gap: "var(--space-6)", flexWrap: "wrap" }}>
        {children}
      </div>
    </div>
  );
}

function FilterChip({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        padding: "3px 10px",
        fontFamily: T.fontMono,
        fontSize: 10.5,
        letterSpacing: "0.06em",
        textTransform: "uppercase",
        background: active ? "rgba(140,231,210,0.10)" : "transparent",
        color: active ? "var(--accent-strong)" : "var(--text-tertiary)",
        border: `1px solid ${active ? "rgba(140,231,210,0.35)" : "var(--control-border)"}`,
        borderRadius: "var(--radius-xs)",
        cursor: "pointer",
      }}
    >
      {label}
    </button>
  );
}

/* ── Table ────────────────────────────────────────────────── */

function ModelTable({
  rows,
  currentModel,
  comparing,
  sortKey,
  sortDir,
  onSort,
  onAdopt,
  onToggleCompare,
}: {
  rows: ModelOption[];
  currentModel: string;
  comparing: string[];
  sortKey: SortKey;
  sortDir: SortDir;
  onSort: (key: SortKey) => void;
  onAdopt: (id: string) => void;
  onToggleCompare: (id: string) => void;
}) {
  return (
    <div
      style={{
        border: "1px solid var(--control-border)",
        borderRadius: "var(--radius-sm)",
        background: "var(--material-card)",
        overflow: "hidden",
      }}
    >
      <div
        style={{
          display: "grid",
          // Column widths tuned for the data: model (flex), provider (narrow),
          // context (narrow), $/M in + out (narrow numeric), tiers (narrow),
          // adopt + compare actions (small buttons).
          gridTemplateColumns: "minmax(220px, 1fr) 110px 90px 90px 90px 110px 140px",
          alignItems: "center",
          gap: "var(--space-12)",
          padding: "10px 14px",
          background: "var(--control-bg)",
          fontFamily: T.fontMono,
          fontSize: "var(--font-size-xs)",
          letterSpacing: "0.1em",
          color: "var(--text-quaternary)",
          textTransform: "uppercase",
          borderBottom: "1px solid var(--control-border)",
        }}
      >
        <SortHeader label="model" k="label" sortKey={sortKey} sortDir={sortDir} onSort={onSort} />
        <SortHeader label="provider" k="provider" sortKey={sortKey} sortDir={sortDir} onSort={onSort} />
        <SortHeader label="context" k="context" sortKey={sortKey} sortDir={sortDir} onSort={onSort} align="right" />
        <SortHeader label="$/M in" k="input" sortKey={sortKey} sortDir={sortDir} onSort={onSort} align="right" />
        <SortHeader label="$/M out" k="output" sortKey={sortKey} sortDir={sortDir} onSort={onSort} align="right" />
        <SortHeader label="latency" k="latency" sortKey={sortKey} sortDir={sortDir} onSort={onSort} />
        <span style={{ textAlign: "right" }}>actions</span>
      </div>
      {rows.length === 0 ? (
        <div style={{ padding: "var(--space-24)", fontFamily: T.fontBody, fontSize: "var(--font-size-base)", color: "var(--text-tertiary)", textAlign: "center", fontStyle: "italic" }}>
          no models match these filters
        </div>
      ) : (
        rows.map((m, i) => (
          <ModelRow
            key={m.id}
            model={m}
            isCurrent={m.id === currentModel}
            isComparing={comparing.includes(m.id)}
            zebra={i % 2 === 1}
            onAdopt={() => onAdopt(m.id)}
            onToggleCompare={() => onToggleCompare(m.id)}
          />
        ))
      )}
    </div>
  );
}

function SortHeader({
  label, k, sortKey, sortDir, onSort, align,
}: {
  label: string;
  k: SortKey;
  sortKey: SortKey;
  sortDir: SortDir;
  onSort: (k: SortKey) => void;
  align?: "right";
}) {
  const active = k === sortKey;
  return (
    <button
      type="button"
      onClick={() => onSort(k)}
      style={{
        padding: 0,
        textAlign: align ?? "left",
        background: "transparent",
        border: "none",
        cursor: "pointer",
        color: active ? "var(--accent-strong)" : "var(--text-quaternary)",
        fontFamily: T.fontMono,
        fontSize: "var(--font-size-xs)",
        letterSpacing: "0.1em",
        textTransform: "uppercase",
      }}
    >
      {label}
      {active && (sortDir === "asc" ? " ↑" : " ↓")}
    </button>
  );
}

function ModelRow({
  model, isCurrent, isComparing, zebra, onAdopt, onToggleCompare,
}: {
  model: ModelOption;
  isCurrent: boolean;
  isComparing: boolean;
  zebra: boolean;
  onAdopt: () => void;
  onToggleCompare: () => void;
}) {
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "minmax(220px, 1fr) 110px 90px 90px 90px 110px 140px",
        alignItems: "center",
        gap: "var(--space-12)",
        padding: "10px 14px",
        background: zebra ? "rgba(255,255,255,0.015)" : "transparent",
        borderBottom: "1px solid var(--border-subtle)",
      }}
    >
      <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-2)", minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: "var(--space-6)", flexWrap: "wrap" }}>
          <span style={{ fontFamily: T.fontHeading, fontSize: "var(--font-size-md)", fontWeight: 600, color: "var(--foreground)" }}>
            {model.label}
          </span>
          {isCurrent && (
            <span style={{ fontFamily: T.fontMono, fontSize: "var(--font-size-2xs)", padding: "1px 6px", borderRadius: "var(--radius-xs)", background: "rgba(140,231,210,0.10)", border: "1px solid rgba(140,231,210,0.35)", color: "var(--accent-strong)", letterSpacing: "0.08em", textTransform: "uppercase" }}>
              in use
            </span>
          )}
          {model.preview && (
            <span style={{ fontFamily: T.fontMono, fontSize: "var(--font-size-2xs)", padding: "1px 6px", borderRadius: "var(--radius-xs)", background: "rgba(255,184,112,0.08)", border: "1px solid rgba(255,184,112,0.25)", color: "rgba(255,184,112,0.95)", letterSpacing: "0.06em", textTransform: "uppercase" }}>
              preview
            </span>
          )}
        </div>
        <span style={{ fontFamily: T.fontMono, fontSize: "var(--font-size-xs)", color: "var(--text-quaternary)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
          {model.id}
        </span>
      </div>
      <span style={{ fontFamily: T.fontMono, fontSize: "var(--font-size-sm)", color: "var(--text-secondary)" }}>
        {model.provider}
      </span>
      <span style={{ fontFamily: T.fontMono, fontSize: "var(--font-size-sm)", color: "var(--text-secondary)", textAlign: "right" }}>
        {(model.contextWindow / 1000).toFixed(0)}k
      </span>
      <span style={{ fontFamily: T.fontMono, fontSize: "var(--font-size-sm)", color: "var(--foreground)", textAlign: "right" }}>
        ${model.pricing.input}
      </span>
      <span style={{ fontFamily: T.fontMono, fontSize: "var(--font-size-sm)", color: "var(--foreground)", textAlign: "right" }}>
        ${model.pricing.output}
      </span>
      <span style={{ fontFamily: T.fontMono, fontSize: "var(--font-size-xs)", color: "var(--text-tertiary)", textTransform: "uppercase", letterSpacing: "0.06em" }}>
        {model.latencyTier}
      </span>
      <div style={{ display: "flex", gap: "var(--space-6)", justifyContent: "flex-end" }}>
        <RowButton
          label={isComparing ? "✓ comparing" : "compare"}
          active={isComparing}
          onClick={onToggleCompare}
        />
        <RowButton
          label="adopt"
          active={false}
          onClick={onAdopt}
          disabled={isCurrent}
          primary
        />
      </div>
    </div>
  );
}

function RowButton({
  label, active, onClick, disabled, primary,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
  disabled?: boolean;
  primary?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      style={{
        padding: "4px 10px",
        fontFamily: T.fontMono,
        fontSize: "var(--font-size-xs)",
        letterSpacing: "0.06em",
        textTransform: "uppercase",
        background:
          disabled ? "transparent" :
          active ? "rgba(140,231,210,0.12)" :
          primary ? "rgba(140,231,210,0.06)" : "transparent",
        color:
          disabled ? "var(--text-quaternary)" :
          active || primary ? "var(--accent-strong)" : "var(--text-secondary)",
        border: `1px solid ${
          disabled ? "var(--control-border)" :
          active || primary ? "rgba(140,231,210,0.30)" : "var(--control-border)"
        }`,
        borderRadius: "var(--radius-xs)",
        cursor: disabled ? "default" : "pointer",
        whiteSpace: "nowrap",
      }}
    >
      {label}
    </button>
  );
}

/* ── Compare panel ────────────────────────────────────────── */

function ComparePanel({
  ids, onRemove, onClear, currentModel, onAdopt,
}: {
  ids: string[];
  onRemove: (id: string) => void;
  onClear: () => void;
  currentModel: string;
  onAdopt: (id: string) => void;
}) {
  const models = ids
    .map((id) => MODEL_REGISTRY.find((m) => m.id === id))
    .filter((m): m is ModelOption => Boolean(m));

  return (
    <div
      style={{
        border: "1px solid rgba(140,231,210,0.25)",
        borderRadius: "var(--radius-sm)",
        background: "rgba(140,231,210,0.03)",
        padding: "var(--space-16)",
        display: "flex",
        flexDirection: "column",
        gap: "var(--space-12)",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <span style={{ fontFamily: T.fontMono, fontSize: "var(--font-size-xs)", letterSpacing: "0.14em", color: "var(--accent-strong)", textTransform: "uppercase" }}>
          comparing {models.length} model{models.length === 1 ? "" : "s"} · pick up to 3
        </span>
        <button
          type="button"
          onClick={onClear}
          style={{ background: "transparent", border: "none", color: "var(--text-tertiary)", fontFamily: T.fontMono, fontSize: "var(--font-size-xs)", cursor: "pointer", letterSpacing: "0.08em", textTransform: "uppercase" }}
        >
          clear
        </button>
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: `200px repeat(${models.length}, minmax(0, 1fr))`,
          gap: "var(--space-1)",
          background: "var(--control-border)",
          border: "1px solid var(--control-border)",
          borderRadius: "var(--radius-xs)",
          overflow: "hidden",
        }}
      >
        {/* Header row */}
        <CompareCell label="" header />
        {models.map((m) => (
          <CompareCell key={m.id} label="" header>
            <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-4)" }}>
              <span style={{ fontFamily: T.fontHeading, fontSize: "var(--font-size-md)", fontWeight: 600, color: "var(--foreground)" }}>
                {m.label}
              </span>
              <span style={{ fontFamily: T.fontMono, fontSize: "var(--font-size-2xs)", color: "var(--text-quaternary)" }}>
                {m.provider}
              </span>
              <div style={{ display: "flex", gap: "var(--space-6)", marginTop: "var(--space-4)" }}>
                <button
                  type="button"
                  onClick={() => onAdopt(m.id)}
                  disabled={m.id === currentModel}
                  style={{
                    padding: "3px 8px",
                    fontFamily: T.fontMono,
                    fontSize: "var(--font-size-2xs)",
                    letterSpacing: "0.08em",
                    textTransform: "uppercase",
                    background: m.id === currentModel ? "transparent" : "rgba(140,231,210,0.10)",
                    color: m.id === currentModel ? "var(--text-quaternary)" : "var(--accent-strong)",
                    border: `1px solid ${m.id === currentModel ? "var(--control-border)" : "rgba(140,231,210,0.30)"}`,
                    borderRadius: "var(--radius-xs)",
                    cursor: m.id === currentModel ? "default" : "pointer",
                  }}
                >
                  {m.id === currentModel ? "in use" : "adopt"}
                </button>
                <button
                  type="button"
                  onClick={() => onRemove(m.id)}
                  style={{ padding: "3px 8px", fontFamily: T.fontMono, fontSize: "var(--font-size-2xs)", background: "transparent", border: "1px solid var(--control-border)", borderRadius: "var(--radius-xs)", color: "var(--text-tertiary)", cursor: "pointer", letterSpacing: "0.08em", textTransform: "uppercase" }}
                >
                  ✕
                </button>
              </div>
            </div>
          </CompareCell>
        ))}

        {/* Spec rows */}
        <SpecRow label="context window">{models.map((m) => `${(m.contextWindow / 1000).toFixed(0)}k tokens`)}</SpecRow>
        <SpecRow label="max output">{models.map((m) => `${m.maxOutputTokens.toLocaleString()} tokens`)}</SpecRow>
        <SpecRow label="$/M input">{models.map((m) => `$${m.pricing.input}`)}</SpecRow>
        <SpecRow label="$/M output">{models.map((m) => `$${m.pricing.output}`)}</SpecRow>
        <SpecRow label="$/M cache read">{models.map((m) => m.pricing.cacheRead != null ? `$${m.pricing.cacheRead}` : "—")}</SpecRow>
        <SpecRow label="$/M cache write">{models.map((m) => m.pricing.cacheWrite != null ? `$${m.pricing.cacheWrite}` : "—")}</SpecRow>
        <SpecRow label="latency tier">{models.map((m) => m.latencyTier)}</SpecRow>
        <SpecRow label="quality tier">{models.map((m) => m.qualityTier)}</SpecRow>
        <SpecRow label="prompt cache">{models.map((m) => m.capabilities.promptCache ? "✓" : "—")}</SpecRow>
        <SpecRow label="tools">{models.map((m) => m.capabilities.tools ? "✓" : "—")}</SpecRow>
        <SpecRow label="vision">{models.map((m) => m.capabilities.vision ? "✓" : "—")}</SpecRow>
        <SpecRow label="structured output">{models.map((m) => m.capabilities.structuredOutput ? "✓" : "—")}</SpecRow>
        <SpecRow label="temperature knob">{models.map((m) => m.capabilities.temperature ? "✓" : "locked")}</SpecRow>
        <SpecRow label="top_p knob">{models.map((m) => m.capabilities.topP ? "✓" : "locked")}</SpecRow>
        <SpecRow label="description">{models.map((m) => m.description ?? "—")}</SpecRow>
      </div>
    </div>
  );
}

function CompareCell({
  label, children, header,
}: {
  label?: string;
  children?: React.ReactNode;
  header?: boolean;
}) {
  return (
    <div
      style={{
        padding: header ? "12px 14px" : "8px 14px",
        background: header ? "var(--control-bg)" : "var(--material-card)",
        fontFamily: T.fontMono,
        fontSize: header ? 13 : 11,
        color: "var(--text-secondary)",
      }}
    >
      {children ?? label}
    </div>
  );
}

function SpecRow({ label, children }: { label: string; children: (string | number)[] }) {
  return (
    <>
      <div style={{ padding: "8px 14px", background: "var(--control-bg)", fontFamily: T.fontMono, fontSize: "var(--font-size-xs)", letterSpacing: "0.08em", color: "var(--text-quaternary)", textTransform: "uppercase" }}>
        {label}
      </div>
      {children.map((value, i) => (
        <div key={i} style={{ padding: "8px 14px", background: "var(--material-card)", fontFamily: T.fontMono, fontSize: "var(--font-size-sm)", color: "var(--text-secondary)", overflow: "hidden", textOverflow: "ellipsis" }}>
          {value}
        </div>
      ))}
    </>
  );
}

/* ── Sort comparator ──────────────────────────────────────── */

function compareModels(a: ModelOption, b: ModelOption, key: SortKey, dir: SortDir): number {
  const sign = dir === "asc" ? 1 : -1;
  // Tier ordering — frontier > production > budget for quality; instant > fast > balanced > frontier for latency.
  const QUALITY_RANK: Record<QualityTier, number> = { frontier: 3, production: 2, budget: 1 };
  const LATENCY_RANK: Record<LatencyTier, number> = { instant: 1, fast: 2, balanced: 3, frontier: 4 };

  switch (key) {
    case "label":    return sign * a.label.localeCompare(b.label);
    case "provider": return sign * a.provider.localeCompare(b.provider);
    case "input":    return sign * (a.pricing.input - b.pricing.input);
    case "output":   return sign * (a.pricing.output - b.pricing.output);
    case "context":  return sign * (a.contextWindow - b.contextWindow);
    case "latency":  return sign * (LATENCY_RANK[a.latencyTier] - LATENCY_RANK[b.latencyTier]);
    case "quality":  return sign * (QUALITY_RANK[a.qualityTier] - QUALITY_RANK[b.qualityTier]);
  }
}
