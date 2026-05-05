/**
 * Shared types for the Character Knowledge Graph.
 *
 * These types are the wire format between the ingestion pipeline, the
 * wiki-store, the context curator, and the admin UI. Keep them narrow and
 * versionable — if a shape needs to change, prefer additive fields.
 */

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
  eras: EraConfig[];
  /**
   * Domain-awareness knob. Injected into every ingestion run's system prompt
   * so the generic engine interprets raw sources through this character's
   * tradition. Null means "no domain steering" — fine for generic fictional
   * characters; required for domain-grounded ones (scripture, historical).
   */
  ingestionPrompt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type CreateCharacterInput = {
  slug: string;
  title: string;
  summary?: string;
  image?: string;
  eras?: EraConfig[];
  ingestionPrompt?: string;
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
  createdAt: string;
  updatedAt: string;
};

export type SavePageInput = {
  characterId: string;
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
  fromPageId: string;
  toPageId: string;
  kind: EdgeKind;
  strength: number;
  lastSeenAt: string;
  createdAt: string;
};

/* ── Sources & provenance ──────────────────────────────────────── */

export type WikiSourceKind = "bible" | "commentary" | "midrash" | "note" | "transcript";

export type WikiSourceRecord = {
  id: string;
  characterId: string;
  title: string;
  kind: WikiSourceKind;
  content: string;
  contentHash: string;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
};

export type CreateSourceInput = {
  characterId: string;
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

export type IngestionStatus = "running" | "succeeded" | "failed";

export type WikiIngestionLogRecord = {
  id: string;
  characterId: string;
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
};

export type StartIngestionInput = {
  characterId: string;
  sourceId?: string | null;
  model?: string | null;
  promptHash?: string | null;
  notes?: string | null;
};

export type FinishIngestionInput = {
  status: "succeeded" | "failed";
  pagesCreated?: number;
  pagesUpdated?: number;
  edgesAdded?: number;
  contradictionsFound?: number;
  tokensUsed?: number;
  errorMessage?: string | null;
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
