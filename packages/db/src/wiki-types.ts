/**
 * Shared types for the Character Knowledge Graph.
 *
 * These types are the wire format between the ingestion pipeline, the
 * wiki-store, the context curator, and the admin UI. Keep them narrow and
 * versionable — if a shape needs to change, prefer additive fields.
 */

import type { VoiceSettingsOverride } from "./voice-store";

/* ── Character & era config ────────────────────────────────────── */

export type EraConfig = {
  /** Stable, immutable key — used by TimeIndex.era to reference this era. */
  key: string;
  /** Human-facing label. */
  title: string;
  /** Ordering among eras for this character; lower = earlier. */
  order: number;
};

export type CharacterRecord = {
  id: string;
  slug: string;
  title: string;
  summary: string | null;
  image: string | null;
  /**
   * Named gradient key for the sidebar/canvas thumbnail (e.g. "dune",
   * "mint"). When `image` is set the upload wins. When both are null the
   * UI falls back to a legacy hash-of-slug gradient so old characters
   * keep their look until edited.
   */
  thumbnailColor: string | null;
  eras: EraConfig[];
  /**
   * Domain-awareness knob. Injected into every ingestion run's system prompt
   * so the generic engine interprets raw sources through this character's
   * tradition. Null means "no domain steering" — fine for generic fictional
   * characters; required for domain-grounded ones (scripture, historical).
   */
  ingestionPrompt: string | null;
  /**
   * L01 Identity — the anchor: a short essence sentence, exactly two
   * defining traits, and optional era/setting context. When present,
   * compiled into the cached `<identity>` block at the top of the
   * system envelope; when null, falls back to the hardcoded
   * "You are {title}…" line.
   *
   * The hard top-2 trait limit is by design (Araujo et al. 2025 — top-2
   * attributes recover >80% of behavioural fidelity; more dilutes).
   *
   * Authored via the IDE's L01 editor. Additive: existing characters
   * keep working with `identity: null`.
   */
  identity: CharacterIdentity | null;
  /**
   * L03 Voice & Style — four orthogonal personality axes (tone palette,
   * decision-making spectrum, brevity, register pad) plus the audio
   * voice prompt + prosody hints. When present, compiled into the
   * cached `<voice>` block of the system envelope, AND (in 1.3b) fed
   * into the TTS pipeline so the spoken output matches.
   *
   * Multi-dimensional by design (OpenAI Personalities API + GPT-5.1
   * Prompting Guide) — tone, decision, brevity, register live as
   * separate axes the model can attend to independently rather than
   * smushed into one freeform "speaking style" string.
   *
   * Authored via the IDE's L03 editor. Additive: existing characters
   * keep working with `voiceStyle: null` and the legacy voice path.
   */
  voiceStyle: CharacterVoiceStyle | null;
  /**
   * L04 Brain / Model — the LLM substrate this character runs on.
   * Model id, sampling knobs (temperature, top_p, max_tokens), cache
   * preference, optional fallback chain. When null, the chat route uses
   * the hardcoded defaults (claude-sonnet-4-5, max_tokens 1024, Anthropic
   * defaults for temp + top_p, cache_control on).
   *
   * Doesn't compile into any system-prompt XML — these are inference-
   * call parameters, not character voice. Authored via the IDE's L04
   * editor.
   */
  brainModel: CharacterBrainModel | null;
  /**
   * L02 Directive — the structured "what this character will engage with",
   * "what they won't", canonical exemplars, and explicit anti-patterns.
   * When present, compiled into the cached system envelope as Frontier
   * Playbook XML (`<scope>`, `<exemplars>`, `<never>`, `<framing>`,
   * `<guidance>`). When null, the legacy template is used.
   *
   * Authored via the IDE's L02 editor. Additive: existing characters
   * (Abraham seeded before this column existed) work unchanged with
   * `directive: null` until an author opens L02 and saves.
   */
  directive: CharacterDirective | null;
  /**
   * Pointer into the global voices library. When set, the voice-stream
   * and probe routes resolve this to a signed Supabase URL and pass it to
   * audio-rt's /speak as `voiceUrl`. When null, the character's slug is
   * used as the voice id (legacy path — works only for voices baked into
   * the audio-rt Docker image).
   */
  voiceId: string | null;
  /**
   * Per-binding override of the bound voice's runtime knobs (provider-
   * specific — e.g. ElevenLabs stability/style/modelId). Null = inherit
   * the voice row's `providerConfig` unchanged. Provider-discriminated;
   * see `VoiceSettingsOverride` in voice-store.ts. The voice's identity
   * (e.g. ElevenLabs `voiceId`) is never overrideable here — re-bind to
   * a different voice for that.
   */
  voiceSettings: VoiceSettingsOverride | null;
  createdAt: string;
  updatedAt: string;
};

/**
 * One of a character's two defining traits — short anchor word + a
 * sentence of justification that grounds it in voice/scope. The trait
 * name is what's surfaced to the model as the cited trait; the
 * description is for the author's reference and reinforces the compiled
 * prompt with a sentence of texture.
 */
export type IdentityTrait = {
  /** Short noun ("faith", "weariness", "curiosity"). 1–24 chars. */
  name: string;
  /** One-sentence justification. ~120 chars typical, ~280 max. */
  description: string;
};

/**
 * The L01 Identity shape. Every field is optional so partially-authored
 * identities still compile cleanly — the XML compiler skips sections
 * that have no content.
 *
 * Constraints:
 *   - `traits` capped at exactly 2 (hard limit, enforced in editor UI
 *     and at the API boundary). The cap is intentional — adding a third
 *     trait correlates with demographic-leakage failure modes (Venkit
 *     et al. 2026, ~30pp behavioural drift on unrelated tasks).
 *   - `essence` capped at 140 chars (Twitter-ish, forces compression).
 */
export type CharacterIdentity = {
  /** One-sentence anchor describing who this character is. Max 140 chars. */
  essence?: string;
  /** Exactly 0, 1, or 2 traits. Three or more is rejected at the API. */
  traits?: IdentityTrait[];
  /** Time period or era this character exists in ("~2000 BCE"). */
  era?: string;
  /** Place or setting where they exist ("Canaan, Negev desert"). */
  setting?: string;
};

/**
 * L04 Brain / Model — inference-call parameters per character. None of
 * these reach the LLM as text; they're parameters passed to the API
 * call itself.
 *
 * Every field is optional. Missing fields mean "use the chat route's
 * hardcoded default" — which today is `claude-sonnet-4-5` with
 * Anthropic's default temp/top_p and max_tokens 1024.
 *
 * Constraints:
 *   - `provider` is "anthropic", "openai", "cerebras", or "groq" today
 *     (the last two are OpenAI-compatible low-latency inference). New
 *     providers welcome; widen the union here + the chat-providers
 *     factory + the L04 validation schema in lockstep.
 *   - `temperature` ∈ [0, 2]; `topP` ∈ [0, 1]; `maxTokens` ∈ [64, 4096].
 *   - `fallbacks` are listed but **not yet acted on** by the runtime in
 *     1.4a — the schema is here so authors can declare a fallback chain
 *     and a future pass can wire it. The chat route ignores them for now.
 */
export type CharacterBrainModel = {
  provider?: "anthropic" | "openai" | "cerebras" | "groq";
  /** Model id from MODEL_REGISTRY (e.g., "claude-sonnet-4-5", "gpt-5", "gpt-oss-120b"). */
  model?: string;
  /** 0 = deterministic, 1 = neutral, 2 = chaotic. Provider defaults to ~1. */
  temperature?: number;
  /** Nucleus sampling. 0.1 = narrow, 1 = full. Provider defaults to ~1. */
  topP?: number;
  /** Output ceiling. 64–4096; default 1024. */
  maxTokens?: number;
  /**
   * Whether to apply Anthropic prompt caching to the cached system
   * envelope. Default true. Anthropic-only — OpenAI + Cerebras don't
   * expose per-block caching; those providers ignore this flag. Setting
   * false disables cache_control on Anthropic requests — useful only
   * for cost A/B testing.
   */
  cacheControl?: boolean;
  /**
   * Declared fallback chain. Not yet acted on by the runtime — the
   * chat route uses only the primary in 1.4a. Schema is here so authors
   * can document intent and a future pass can wire retry.
   */
  fallbacks?: Array<{
    provider: "anthropic" | "openai" | "cerebras" | "groq";
    model: string;
    /** What triggers this fallback. Default "5xx" (server errors). */
    trigger?: "5xx" | "rate_limit";
  }>;
  /**
   * Optional per-mode override for voice turns. Voice mode is latency-
   * sensitive — a frontier chat model is often the wrong choice, and a
   * fast Cerebras open-weights model can hit voice-grade TTFT while
   * still passing the suite (see the GPT-OSS 120B sweep on Abraham:
   * mean 18.7/20 at 0.65s vs Sonnet's 19/20 at 4.7s).
   *
   * Each field is optional and falls back to the corresponding top-level
   * field. So setting just `voice.model` inherits chat's temperature,
   * topP, maxTokens. When the entire `voice` block is unset, voice
   * turns use the chat config verbatim.
   *
   * `cacheControl` isn't exposed here — voice turns don't currently use
   * Anthropic's per-block cache header (the voice-stream route hits
   * Cerebras directly for non-Anthropic models and doesn't apply the
   * cached envelope). Add the flag if/when that changes.
   *
   * `fallbacks` isn't exposed here either — voice has its own runtime
   * fallback (Cerebras → Anthropic on failure) wired in voice-stream;
   * declaring a chain at this layer would shadow that without acting.
   */
  voice?: {
    provider?: "anthropic" | "openai" | "cerebras" | "groq";
    /** Voice-capable model id from MODEL_REGISTRY. */
    model?: string;
    temperature?: number;
    topP?: number;
    maxTokens?: number;
  };
};

/**
 * L03 Voice & Style — four orthogonal axes that shape both the LLM's
 * written voice (via the cached `<voice>` block in the system prompt)
 * and the TTS pipeline (1.3b).
 *
 * Axes:
 *   - tone        — palette of qualitative descriptors (warm, weathered,
 *                   contemplative …). Multi-select chips; cap at 4 to
 *                   avoid dilution.
 *   - decision    — single value on a spectrum from "impulsive" to
 *                   "paralyzed by precedent". Free-text so authors can
 *                   write the point precisely (e.g. "deliberate · invokes
 *                   precedent").
 *   - brevity     — soft default response length: terse / short / medium /
 *                   long / paragraph+. Per `<delivery>`, the runtime
 *                   already enforces brevity broadly; this dials in the
 *                   character's specific resting length.
 *   - register    — 2D pad: formality × warmth, each on -1..1. Persists
 *                   as a `{ formality, warmth }` pair.
 *
 * Plus the audio channel:
 *   - voicePrompt   — free-text description fed to the TTS ("older man,
 *                     weathered by long travel; unhurried cadence; soft
 *                     consonants"). Used by Kyutai TTS in 1.3b.
 *   - referenceClipUrl — optional URL to a reference audio sample for
 *                     voice cloning (1.3b).
 *   - prosody       — chip-style hints (slow, low-pitch, long-pauses,
 *                     soft-consonants). 1.3b feeds these to the TTS
 *                     wherever supported.
 *
 * Every field is optional so partial drafts still compile.
 */
export type CharacterVoiceStyle = {
  tone?: string[];
  decision?: string;
  brevity?: "terse" | "short" | "medium" | "long" | "paragraph";
  register?: { formality: number; warmth: number };
  voicePrompt?: string;
  referenceClipUrl?: string;
  prosody?: string[];
};

/**
 * The L02 Directive shape. Every field is optional so partially-authored
 * directives still compile cleanly — the XML compiler emits only the
 * sections that have content.
 *
 * Constraints:
 *   - `exemplars` capped at 8 entries. The original 5-cap came from
 *     Araujo et al. 2025 (top-3 to top-5 attributes recover >80% of
 *     personality fidelity), but for characters with distinct
 *     deflection patterns (blessing / prayer / crisis / etc.) the
 *     practical floor is higher. 8 is the new ceiling; beyond that
 *     dilution is real.
 *   - All string lists trim individual entries; empty strings dropped.
 */
export type CharacterDirective = {
  scope?: {
    /** What this character will engage with — topics, eras, domains. */
    engage?: string[];
    /** What they will deflect or reframe — out-of-bounds requests. */
    refuse?: string[];
  };
  /**
   * Canonical USER/YOU exchanges. Show-don't-tell — these land harder than
   * any number of adjectives describing the character's voice.
   *
   * `tags` are free-text scope hints (e.g. "faith under doubt", "covenant")
   * that the model sees alongside the exchange so it can recognize when
   * an example applies. Optional; untagged examples still compile.
   */
  exemplars?: Array<{
    user: string;
    you: string;
    tags?: string[];
    /**
     * Optional authoring annotation — "why this works". Surfaced to the
     * model as a sibling `<rationale>` element inside the example block so
     * the model sees the pattern-match hint alongside the exchange. Empty
     * means no rationale; the compiler skips the element.
     */
    rationale?: string;
  }>;
  /**
   * Explicit anti-patterns ("Do not break character to discuss being an AI").
   * Negative instructions land harder than positive ones for in-character
   * adherence.
   */
  never?: string[];
  /**
   * Disclosure framing for moments when the player presses on whether the
   * character is "real" (the dramatized-portrayal acknowledgement for
   * Abraham's Tent, for example).
   */
  framing?: string;
  /** Free-form escape hatch — guidance the model should weigh when uncertain. */
  guidance?: string;
};

export type CreateCharacterInput = {
  slug: string;
  title: string;
  summary?: string;
  image?: string;
  thumbnailColor?: string;
  eras?: EraConfig[];
  ingestionPrompt?: string;
  identity?: CharacterIdentity;
  voiceStyle?: CharacterVoiceStyle;
  brainModel?: CharacterBrainModel;
  directive?: CharacterDirective;
};

export type UpdateCharacterInput = Partial<
  Omit<CharacterRecord, "id" | "slug" | "createdAt" | "updatedAt">
>;

/* ── Wiki page core ────────────────────────────────────────────── */

export type WikiPageType =
  | "entity"
  | "event"
  | "concept"
  | "relationship"
  | "timeline"
  | "voice_identity";

/** Character-relative temporal position — `era` is an EraConfig.key. */
export type TimeIndex = {
  era: string;
  index: number;
};

/** How this character "knows" a given page. */
export type PerspectiveKnowsHow = "firsthand" | "heard" | "inferred" | "unknown";

export type Perspective = {
  knowsHow?: PerspectiveKnowsHow;
  /** Short tag set: "reverent", "conflicted", "proud", "afraid", … */
  feels?: string[];
  /** One-phrase summary of why this matters to the character. */
  stake?: string;
};

/* ── Type-discriminated frontmatter ────────────────────────────── */

export type EntityFrontmatter = {
  kind?: "person" | "place" | "object" | "group";
  aliases?: string[];
  /** Slug of the event page where this entity first appears. */
  firstAppearance?: string;
  lastAppearance?: string;
};

export type EventFrontmatter = {
  when?: TimeIndex;
  /** Slug of an entity page (place). */
  where?: string;
  /** Slugs of entity pages (people/groups). */
  participants?: string[];
  /** Slugs of event pages that caused this event. */
  causes?: string[];
  /** Slugs of event pages this event caused. */
  effects?: string[];
};

export type ConceptFrontmatter = {
  aliases?: string[];
  /** Slugs of event pages that instantiate this concept. */
  instances?: string[];
  /** Slugs of related concept pages. */
  relatedConcepts?: string[];
};

export type RelationshipFrontmatter = {
  /** Slug of entity A. */
  from: string;
  /** Slug of entity B. */
  to: string;
  /** Loose-typed: familial | covenantal | political | mentorship | adversarial | … */
  kind: string;
  /** Event slugs in time order that shaped the relationship. */
  evolution?: string[];
};

export type TimelineFrontmatter = Record<string, never>;

export type VoiceIdentityFrontmatter = {
  speechPatterns?: string[];
  idioms?: string[];
  beliefs?: string[];
  emotionalRange?: string[];
  taboos?: string[];
};

export type Frontmatter =
  | EntityFrontmatter
  | EventFrontmatter
  | ConceptFrontmatter
  | RelationshipFrontmatter
  | TimelineFrontmatter
  | VoiceIdentityFrontmatter;

/* ── Contradictions & page records ─────────────────────────────── */

export type Contradiction = {
  /** Page this page conflicts with. */
  otherPageId: string;
  note: string;
};

export type WikiPageRecord = {
  id: string;
  characterId: string;
  wikiId: string | null;
  type: WikiPageType;
  slug: string;
  title: string;
  summary: string | null;
  body: string;
  frontmatter: Frontmatter;
  perspective: Perspective;
  confidence: number;
  timeIndex: TimeIndex | null;
  knowsFuture: boolean;
  contradictions: Contradiction[];
  version: number;
  lastCompiledAt: string | null;
  embedding: number[] | null;
  embeddingModel: string | null;
  embeddedAt: string | null;
  /** Cached 2D coords for the Knowledge view's semantic map (cosine-MDS). */
  layoutX: number | null;
  layoutY: number | null;
  layoutComputedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type SavePageInput = {
  characterId?: string | null;
  wikiId?: string | null;
  type: WikiPageType;
  slug: string;
  title: string;
  summary?: string | null;
  body?: string;
  frontmatter?: Frontmatter;
  perspective?: Perspective;
  confidence?: number;
  timeIndex?: TimeIndex | null;
  knowsFuture?: boolean;
  contradictions?: Contradiction[];

  // Version metadata attached when a snapshot is written
  authorKind?: "llm" | "human" | "system";
  authorId?: string | null;
  note?: string | null;
};

/**
 * Optional callbacks provided by the application layer. Inverted control
 * keeps the db package free of OpenAI / embedding dependencies — savePage
 * decides whether the page materially changed, and only then asks the
 * caller's `embed` function for an embedding.
 */
export type SavePageHooks = {
  /** Compute an embedding for the given text. Return null to skip storing
   * one (e.g. no API key configured). Errors are caught by savePage and
   * the page is saved without an embedding rather than failing the write. */
  embed?: (text: string) => Promise<number[] | null>;
  /** Optional model identifier to persist alongside the embedding. */
  embeddingModel?: string;
  /**
   * Re-derive the 2D knowledge-graph layout for this character and persist
   * the new coordinates. Legacy character-scoped save paths only.
   *
   * Lives as a hook (not inside packages/db) because the layout algorithm
   * is owned by the admin app. Errors are swallowed so a layout failure
   * never blocks the underlying page write. Ingestion paths deliberately
   * leave this unwired — they batch many savePage calls and run a single
   * trailing recompute instead. */
  recomputeLayout?: (characterId: string) => Promise<void>;
  /**
   * Re-derive the 2D knowledge-graph layout for this wiki and persist the
   * new coordinates. Wiki-scoped save paths use this instead of the legacy
   * character callback.
   */
  recomputeWikiLayout?: (wikiId: string) => Promise<void>;
};

export type SavePageResult = {
  page: WikiPageRecord;
  created: boolean;
  versionCreated: boolean;
  edgesAdded: number;
  edgesRemoved: number;
};

export type WikiPageVersionRecord = {
  id: string;
  pageId: string;
  version: number;
  title: string;
  summary: string | null;
  body: string;
  frontmatter: Frontmatter;
  perspective: Perspective;
  confidence: number;
  timeIndex: TimeIndex | null;
  authorKind: "llm" | "human" | "system";
  authorId: string | null;
  note: string | null;
  createdAt: string;
};

/* ── Edges ─────────────────────────────────────────────────────── */

export type EdgeKind =
  | "mentions"
  | "relates_to"
  | "participates_in"
  | "happens_at"
  | "perspective_of"
  | "contradicts";

export type WikiEdgeRecord = {
  id: string;
  characterId: string;
  wikiId: string | null;
  fromPageId: string;
  toPageId: string;
  kind: EdgeKind;
  strength: number;
  lastSeenAt: string;
  createdAt: string;
};

/* ── Sources & provenance ──────────────────────────────────────── */

export type WikiSourceKind =
  | "bible"
  | "commentary"
  | "midrash"
  | "note"
  | "transcript"
  | "primary"
  | "annotation"
  | "reference";

export type WikiSourceRecord = {
  id: string;
  characterId: string;
  wikiId: string | null;
  title: string;
  kind: WikiSourceKind;
  content: string;
  contentHash: string;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
};

export type CreateSourceInput = {
  characterId?: string | null;
  wikiId?: string | null;
  title: string;
  kind: WikiSourceKind;
  content: string;
  metadata?: Record<string, unknown>;
};

export type WikiSourceRefRecord = {
  id: string;
  pageId: string;
  sourceId: string;
  passage: string | null;
  quote: string | null;
  relevanceNote: string | null;
  createdAt: string;
};

export type CreateSourceRefInput = {
  pageId: string;
  sourceId: string;
  passage?: string;
  quote?: string;
  relevanceNote?: string;
};

/* ── Ingestion log ─────────────────────────────────────────────── */

export type IngestionStatus = "queued" | "running" | "succeeded" | "failed" | "canceled";

export type WikiIngestionLogRecord = {
  id: string;
  characterId: string;
  wikiId: string | null;
  sourceId: string | null;
  startedAt: string;
  finishedAt: string | null;
  status: IngestionStatus;
  /** The LLM model used — e.g. "claude-sonnet-4-5". Null for legacy rows. */
  model: string | null;
  /** Short SHA of the character.ingestionPrompt at run time. */
  promptHash: string | null;
  pagesCreated: number;
  pagesUpdated: number;
  edgesAdded: number;
  contradictionsFound: number;
  tokensUsed: number;
  errorMessage: string | null;
  notes: string | null;
  workerId: string | null;
  claimedAt: string | null;
  heartbeatAt: string | null;
};

export type StartIngestionInput = {
  characterId?: string | null;
  wikiId?: string | null;
  sourceId?: string | null;
  model?: string | null;
  promptHash?: string | null;
  notes?: string | null;
  status?: Extract<IngestionStatus, "queued" | "running">;
};

export type FinishIngestionInput = {
  status: "succeeded" | "failed" | "canceled";
  pagesCreated?: number;
  pagesUpdated?: number;
  edgesAdded?: number;
  contradictionsFound?: number;
  tokensUsed?: number;
  errorMessage?: string | null;
};

export type WikiIngestionEventRecord = {
  id: string;
  runId: string;
  seq: number;
  type: string;
  payload: unknown;
  createdAt: string;
};

/* ── Wikis (shared knowledge resources) ─────────────────────────── */

export type Era = {
  key: string;
  title: string;
  order: number;
};

export type WikiRecord = {
  id: string;
  slug: string;
  title: string;
  summary: string | null;
  eras: Era[];
  ingestionPrompt: string | null;
  /** Human-facing name for the prompt — null falls back to "{title} lens." in the UI. */
  ingestionPromptName: string | null;
  createdAt: string;
  updatedAt: string;
};

export type CreateWikiInput = {
  slug: string;
  title: string;
  summary?: string | null;
  eras?: Era[];
  ingestionPrompt?: string | null;
  ingestionPromptName?: string | null;
};

export type UpdateWikiInput = {
  title?: string;
  summary?: string | null;
  eras?: Era[];
  ingestionPrompt?: string | null;
  ingestionPromptName?: string | null;
};

/* ── Character → Wiki bindings ──────────────────────────────────── */

export type BindingPriority = "primary" | "secondary" | "reference";

export type CharacterKnowledgeBindingRecord = {
  id: string;
  characterId: string;
  wikiId: string;
  priority: BindingPriority;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
};

export type CreateBindingInput = {
  characterId: string;
  wikiId: string;
  priority?: BindingPriority;
  isActive?: boolean;
};

export type UpdateBindingInput = {
  priority?: BindingPriority;
  isActive?: boolean;
};

/* ── Parsed wikilink (from body) ───────────────────────────────── */

export type ParsedWikilink = {
  /** The raw "[[...]]" substring, for replacement. */
  raw: string;
  /** Target slug (stable, never changes). */
  slug: string;
  /** Optional display text. If absent, consumer should resolve via current title. */
  display: string | null;
};
