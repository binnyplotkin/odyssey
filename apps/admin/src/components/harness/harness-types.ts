/**
 * Shared types + the layer registry that drives the harness sidebar nav and the
 * editor-pane router. Adding a new layer = add a row here + a corresponding
 * editor component under ./editors/.
 *
 * Status tiers (`status` field) match the Paper design:
 *   "configured" = ●  fully authored
 *   "partial"    = ◐  some content but missing pieces
 *   "empty"      = ○  not configured yet
 *   "n/a"        = —  substrate / cross-cutting, not character-authored
 */

export type LayerStatus = "configured" | "partial" | "empty" | "n/a";

export type LayerTier = "t1" | "t2" | "sm" | "test";

export type LayerKey =
  // Tier 1 — system envelope (cached)
  | "l01"
  | "l02"
  | "l03"
  | "l04"
  // Tier 2 — per-turn (live)
  | "l05"
  | "l06"
  | "l07"
  | "l08"
  | "l09"
  // Stage Manager (world-scope)
  | "sm-refusals"
  | "sm-runtime"
  | "sm-sound"
  // Test & eval — each maps to a nested route now (was a single
  // catch-all "test-regression" with internal tab state).
  | "test-chat"
  | "test-adversarial"
  | "test-runs"
  | "test-sweeps"
  | "test-suites"
  | "test-history";

export type LayerDef = {
  key: LayerKey;
  tier: LayerTier;
  /** Short label shown in the sidebar (e.g. "Identity"). */
  label: string;
  /** Layer number badge ("L01", "L02"). For SM/test, omitted. */
  badge?: string;
  /** One-line description shown in the editor header. */
  description: string;
  /** Tier-eyebrow text shown above the editor title (e.g. "tier 1 · layer 02"). */
  eyebrow: string;
  /** Token cost shown in the sidebar — backend-derived in production, hardcoded
   * for now until each layer's schema lands. */
  tokens?: string;
  /** Status badge shown in the sidebar (●/◐/○/—). */
  status: LayerStatus;
  /** Which tabs the editor shows. The first is the default. */
  tabs: string[];
  /**
   * Path segment under `/characters/<slug>/harness/` this entry navigates to.
   * Most layer rows nest under `layers/<key>`; the test-eval rows route to
   * peer paths like `runs`, `sweeps`, `suites`. Used by the sidebar both for
   * navigation and for pathname-based active-state detection.
   */
  href: string;
};

/**
 * The canonical layer registry. The sidebar reads this top-to-bottom to render
 * the nav; the editor pane reads it to pick the right editor component for the
 * active key. Keep ordering aligned with the Paper artboards.
 */
export const LAYERS: ReadonlyArray<LayerDef> = [
  // ── Tier 1 — system (cached) ────────────────────────────────
  {
    key: "l01",
    tier: "t1",
    label: "Identity",
    badge: "L01",
    eyebrow: "tier 1 · layer 01",
    description: "Name, one-sentence essence, and the two defining traits.",
    tokens: "42",
    status: "configured",
    tabs: ["configure", "history"],
    href: "layers/l01",
  },
  {
    key: "l02",
    tier: "t1",
    label: "Directive",
    badge: "L02",
    eyebrow: "tier 1 · layer 02",
    description: "Scope, exemplars, and never-rules. Cached system envelope.",
    tokens: "521",
    status: "configured",
    tabs: ["configure", "exemplars", "never", "history"],
    href: "layers/l02",
  },
  {
    key: "l03",
    tier: "t1",
    label: "Voice & Style",
    badge: "L03",
    eyebrow: "tier 1 · layer 03",
    description: "Four orthogonal axes plus the audio voice prompt.",
    tokens: "142",
    status: "partial",
    tabs: ["configure", "audio voice", "spoken preview", "history"],
    href: "layers/l03",
  },
  {
    key: "l04",
    tier: "t1",
    label: "Mind / Model",
    badge: "L04",
    eyebrow: "tier 0 · layer 04",
    description: "LLM substrate, sampling knobs, cache policy, fallbacks.",
    tokens: "substrate",
    status: "configured",
    tabs: ["configure", "presets", "runs", "history"],
    href: "layers/l04",
  },

  // ── Tier 2 — per-turn (live) ────────────────────────────────
  {
    key: "l05",
    tier: "t2",
    label: "Knowledge Graph",
    badge: "L05",
    eyebrow: "tier 2 · layer 05",
    description: "Retrieval over the wiki graph. Top-k chunks per turn.",
    tokens: "~640",
    status: "partial",
    tabs: ["configure", "browse", "history"],
    href: "layers/l05",
  },
  {
    key: "l06",
    tier: "t2",
    label: "Context Builder",
    badge: "L06",
    eyebrow: "tier 2 · layer 06",
    description: "Tag ordering, per-tag token budgets, overflow policy.",
    tokens: "—",
    status: "empty",
    tabs: ["configure"],
    href: "layers/l06",
  },
  {
    key: "l07",
    tier: "t2",
    label: "Episodic Memory",
    badge: "L07",
    eyebrow: "tier 2 · layer 07",
    description: "Past-session summaries surfaced as live exemplars.",
    tokens: "~280",
    status: "configured",
    tabs: ["configure", "browse"],
    href: "layers/l07",
  },
  {
    key: "l08",
    tier: "t2",
    label: "Intent / Drives",
    badge: "L08",
    eyebrow: "tier 2 · layer 08",
    description: "Active goals and proactivity weighting.",
    tokens: "—",
    status: "empty",
    tabs: ["configure"],
    href: "layers/l08",
  },
  {
    key: "l09",
    tier: "t2",
    label: "Relationship",
    badge: "L09",
    eyebrow: "tier 2 · layer 09",
    description: "Trust and familiarity as numeric axes, per relationship.",
    tokens: "~80",
    status: "configured",
    tabs: ["configure"],
    href: "layers/l09",
  },

  // ── Stage Manager (world-scope) ─────────────────────────────
  {
    key: "sm-refusals",
    tier: "sm",
    label: "Refusals",
    eyebrow: "stage manager · world-scope",
    description: "Pre-LLM gate. Pattern matchers, severity tiers, routing.",
    tokens: "12 rules",
    status: "configured",
    tabs: ["rules", "templates", "triggers", "audit"],
    href: "layers/sm-refusals",
  },
  {
    key: "sm-runtime",
    tier: "sm",
    label: "Runtime envelope",
    eyebrow: "stage manager · world-scope",
    description: "STT, TTS, barge-in, latency budgets.",
    tokens: "kyutai",
    status: "configured",
    tabs: ["configure"],
    href: "layers/sm-runtime",
  },
  {
    key: "sm-sound",
    tier: "sm",
    label: "Sound design",
    eyebrow: "stage manager · world-scope",
    description: "Ambient, foley, score, prosody, spatial cues.",
    tokens: "3 / 5",
    status: "partial",
    tabs: ["configure"],
    href: "layers/sm-sound",
  },

  // ── Test & eval ─────────────────────────────────────────────
  // Each of these is its own top-level harness route now (no more
  // ?layer=test-regression&tab=runs etc.). Sidebar = navigation.
  {
    key: "test-chat",
    tier: "test",
    label: "Test chat",
    eyebrow: "test & eval",
    description: "Live conversation with the current draft.",
    status: "n/a",
    tabs: ["chat"],
    href: "layers/test-chat",
  },
  {
    key: "test-adversarial",
    tier: "test",
    label: "Adversarial probes",
    eyebrow: "test & eval",
    description: "Preset jailbreak + character-pressure suite.",
    status: "n/a",
    tabs: ["suite"],
    href: "layers/test-adversarial",
  },
  {
    key: "test-runs",
    tier: "test",
    label: "Runs",
    eyebrow: "test & eval · runs",
    description:
      "Single-config eval executions. Pass rate trend, per-probe drill-down with judge rationale.",
    status: "configured",
    tabs: ["overview"],
    href: "runs",
  },
  {
    key: "test-sweeps",
    tier: "test",
    label: "Sweeps",
    eyebrow: "test & eval · sweeps",
    description:
      "Parameter-grid runs with Pareto frontier analysis. Find the best config across model × temperature.",
    status: "configured",
    tabs: ["overview"],
    href: "sweeps",
  },
  {
    key: "test-suites",
    tier: "test",
    label: "Suites",
    eyebrow: "test & eval · suites",
    description: "Probe definitions. Fork → edit → publish; past runs stay pinned to their judged version.",
    status: "configured",
    tabs: ["overview"],
    href: "suites",
  },
  {
    key: "test-history",
    tier: "test",
    label: "History",
    eyebrow: "test & eval · history",
    description: "Full activity log across runs, sweeps, and suite publishes.",
    status: "n/a",
    tabs: ["overview"],
    href: "history",
  },
];

/** Lookup helper — falls back to L01 if the key is unknown. */
export function getLayerDef(key: string | null | undefined): LayerDef {
  const found = LAYERS.find((l) => l.key === key);
  return found ?? LAYERS[0];
}

/** The character shape the harness shell needs (subset of the DB record). */
export type HarnessCharacter = {
  id: string;
  slug: string;
  title: string;
  summary: string | null;
  image: string | null;
  /**
   * L01 Identity — `null` when the character has no L01 authored
   * (compiled prompt falls back to the hardcoded "You are {title}…"
   * anchor). The L01 editor handles both cases.
   */
  identity: import("@odyssey/db").CharacterIdentity | null;
  /**
   * L03 Voice & Style — `null` when the character has no L03 authored
   * (no `<voice>` block emitted; runtime voice path stays legacy). The
   * L03 editor handles both cases.
   */
  voiceStyle: import("@odyssey/db").CharacterVoiceStyle | null;
  /**
   * L04 Brain / Model — `null` when the character has no L04 authored
   * (chat route uses hardcoded defaults: claude-sonnet-4-5 / max_tokens
   * 1024 / cache on / Anthropic defaults for temp + top_p).
   */
  brainModel: import("@odyssey/db").CharacterBrainModel | null;
  /**
   * L02 Directive — `null` when the character predates L02 (legacy
   * single-paragraph system prompt). The L02 editor handles both cases.
   */
  directive: import("@odyssey/db").CharacterDirective | null;
  /**
   * sm-sound Sound design — `null` when no soundscape is bound (character
   * sandbox stays silent). The sm-sound editor handles both cases.
   */
  soundDesign: import("@odyssey/db").CharacterSoundDesign | null;
};
