/**
 * Source "Classify" metadata — the typed, source-scoped description of an
 * ingested source. Supersedes the old free-form YAML `frontmatter` blob stored
 * on `wiki_sources.metadata`.
 *
 * Design (see memory: ingestion-classify-trust-model):
 *  - Trust is NOT an assigned score. It is routed by `ingestionType` and earned
 *    from provenance: a referenceable source is cited + traced; authored canon is
 *    axiomatic; synthetic data inherits trust from its seed nodes.
 *  - `provenance` is a discriminated union keyed by `ingestionType`.
 *  - The universal, reasoned-over fields are typed here; genuinely world-specific
 *    keys (canonicality, verses, …) stay in `extra`.
 *
 * This module is additive. `readClassifyMetadata` coerces the legacy blob so new
 * code can consume the typed shape before the ingest pipeline is migrated.
 */

import type { WikiSourceKind, WikiSourceRecord } from "./wiki-types";

export const SOURCE_METADATA_SCHEMA_VERSION = 1;

/** The nature of the input — routes which provenance/trust model applies. */
export type IngestionType = "source" | "authored" | "synthetic";
// Future variants (fold onto "source"): "transcript" | "dataset".

/** Evidentiary tier — only meaningful inside a referenceable source. */
export type SourceType = "primary" | "secondary" | "tertiary";

export const SOURCE_TYPES: readonly SourceType[] = [
  "primary",
  "secondary",
  "tertiary",
] as const;

export type SourceCitation = {
  author?: string[];
  year?: number;
  title?: string;
  publisher?: string;
  edition?: string;
  /** Where in the source — page range, chapter, verses. */
  locator?: string;
  identifier?: { isbn?: string; doi?: string; url?: string };
};

/** Browse/filter facets — describe what the source is about. */
export type SourceFacets = {
  themes?: string[];
  location?: string[];
  timePeriod?: string;
  participants?: string[];
  characterFocus?: string[];
};

/** Referenceable source — trust = citation completeness + traceable passages. */
export type SourceProvenance = {
  ingestionType: "source";
  sourceType: SourceType;
  citation?: SourceCitation;
  /**
   * Nested provenance: "stub" = citation-only row exploded from a carrier's
   * bibliography, no content until hydrated (P2). Absent = "full" (back-compat).
   */
  hydration?: "full" | "stub";
};

/** Authored canon — axiomatic; declared true by the world owner. No citation. */
export type AuthoredProvenance = {
  ingestionType: "authored";
  author?: string;
  role?: string;
  declaredAt?: string;
};

/** Synthetic / generated — trust = lineage; inherited from `seedPageIds`. */
export type SyntheticProvenance = {
  ingestionType: "synthetic";
  model?: string;
  prompt?: string;
  seedPageIds?: string[];
  generatedAt?: string;
};

export type Provenance =
  | SourceProvenance
  | AuthoredProvenance
  | SyntheticProvenance;

export type ClassifyMetadata = {
  schemaVersion: number;
  provenance: Provenance;
  facets: SourceFacets;
  tags: string[];
  notes?: string;
  /** World-specific keys not promoted to typed fields (canonicality, verses, …). */
  extra: Record<string, unknown>;
};

/* ── kind → sourceType collapse (migration mapping) ─────────────── */

/**
 * Maps the legacy `kind` column onto the evidentiary tier. `kind` retires; its
 * domain nuance (bible/midrash) is preserved separately in `extra.canonicality`.
 */
export function deriveSourceTypeFromKind(kind: WikiSourceKind): SourceType {
  switch (kind) {
    case "bible":
    case "primary":
    case "transcript":
      return "primary";
    case "commentary":
    case "midrash":
    case "annotation":
    case "note":
      return "secondary";
    case "reference":
      return "tertiary";
    default:
      return "secondary";
  }
}

/** Legacy kinds are all referenceable sources; authored/synthetic are new. */
export function deriveIngestionTypeFromKind(_kind: WikiSourceKind): IngestionType {
  return "source";
}

/**
 * Reverse of `deriveSourceTypeFromKind` — a representative legacy `kind` for a
 * tier. Keeps the (still NOT NULL) `kind` column populated while `sourceType`
 * becomes the real classifier, ahead of retiring the column.
 */
export function deriveKindFromSourceType(sourceType: SourceType): WikiSourceKind {
  switch (sourceType) {
    case "primary":
      return "primary";
    case "tertiary":
      return "reference";
    case "secondary":
    default:
      return "commentary";
  }
}

const WIKI_SOURCE_KINDS = new Set<WikiSourceKind>([
  "bible",
  "commentary",
  "midrash",
  "note",
  "transcript",
  "primary",
  "annotation",
  "reference",
]);

/**
 * The legacy `kind` shadow for a source, now that the `kind` column is dropped:
 * the preserved original (`classify.extra.legacyKind`) if valid, else derived
 * from the tier. Keeps `WikiSourceRecord.kind` populated for legacy readers.
 */
export function shadowKind(classify: ClassifyMetadata): WikiSourceKind {
  const legacy = classify.extra.legacyKind;
  if (typeof legacy === "string" && WIKI_SOURCE_KINDS.has(legacy as WikiSourceKind)) {
    return legacy as WikiSourceKind;
  }
  const sourceType =
    classify.provenance.ingestionType === "source"
      ? classify.provenance.sourceType
      : "secondary";
  return deriveKindFromSourceType(sourceType);
}

/* ── Back-compat reader ─────────────────────────────────────────── */

/**
 * Coerce a source's stored `metadata` (legacy YAML `frontmatter` blob, or an
 * already-typed ClassifyMetadata) into the typed shape. Non-destructive.
 */
export function readClassifyMetadata(
  source: { kind?: WikiSourceKind; metadata: Record<string, unknown> },
): ClassifyMetadata {
  const raw = isRecord(source.metadata) ? source.metadata : {};

  // Prefer an already-stored typed block (written by `buildStoredSourceMetadata`).
  const stored = raw.classify;
  if (
    isRecord(stored) &&
    isRecord(stored.provenance) &&
    isIngestionType((stored.provenance as { ingestionType?: unknown }).ingestionType)
  ) {
    return normalizeStoredClassify(stored);
  }

  // Legacy rows: coerce the YAML `frontmatter` blob into the typed shape.
  const frontmatter = isRecord(raw.frontmatter) ? raw.frontmatter : {};
  return {
    schemaVersion: asNumber(raw.schemaVersion) ?? SOURCE_METADATA_SCHEMA_VERSION,
    provenance: readProvenance(raw, frontmatter, source.kind ?? "reference"),
    facets: readFacets(frontmatter),
    tags: asStringArray(raw.tags),
    notes: asString(raw.notes),
    extra: readExtra(frontmatter),
  };
}

/**
 * Attach a typed `classify` block to a source's stored metadata, derived from
 * its kind + legacy fields. Call on write. Legacy keys (tags/frontmatter/…) are
 * preserved for back-compat until readers repoint to the typed block.
 */
export function buildStoredSourceMetadata(
  kind: WikiSourceKind,
  metadata: Record<string, unknown> | undefined,
  overrides?: { sourceType?: SourceType },
): Record<string, unknown> {
  const raw = isRecord(metadata) ? metadata : {};
  const classify = readClassifyMetadata({ kind, metadata: raw });
  if (overrides?.sourceType && classify.provenance.ingestionType === "source") {
    classify.provenance = {
      ...classify.provenance,
      sourceType: overrides.sourceType,
    };
  }
  return { ...raw, classify };
}

function normalizeStoredClassify(
  stored: Record<string, unknown>,
): ClassifyMetadata {
  return {
    schemaVersion: asNumber(stored.schemaVersion) ?? SOURCE_METADATA_SCHEMA_VERSION,
    provenance: stored.provenance as Provenance,
    facets: isRecord(stored.facets) ? (stored.facets as SourceFacets) : {},
    tags: asStringArray(stored.tags),
    notes: asString(stored.notes),
    extra: isRecord(stored.extra) ? (stored.extra as Record<string, unknown>) : {},
  };
}

/** Frontmatter keys consumed by typed fields — excluded from `extra`. */
const CONSUMED_KEYS = new Set([
  // → facets
  "themes",
  "location",
  "time_period",
  "participants",
  "character_focus",
  // → provenance.sourceType
  "source_type",
  // → provenance.citation
  "title",
  "author",
  "year",
  "publisher",
  "edition",
  "isbn",
  "doi",
  "url",
]);

function readProvenance(
  raw: Record<string, unknown>,
  frontmatter: Record<string, unknown>,
  kind: WikiSourceKind,
): Provenance {
  // Prefer an already-typed provenance object if present.
  const existing = raw.provenance;
  if (isRecord(existing) && isIngestionType(existing.ingestionType)) {
    return existing as unknown as Provenance;
  }

  // Legacy rows: everything is a referenceable source.
  const declared = asString(frontmatter.source_type);
  const sourceType: SourceType = isSourceType(declared)
    ? declared
    : deriveSourceTypeFromKind(kind);

  const citation = readCitation(frontmatter);
  return citation
    ? { ingestionType: "source", sourceType, citation }
    : { ingestionType: "source", sourceType };
}

function readCitation(
  frontmatter: Record<string, unknown>,
): SourceCitation | undefined {
  const citation: SourceCitation = {};
  const author = asStringArray(frontmatter.author);
  if (author.length) citation.author = author;
  const year = asNumber(frontmatter.year);
  if (year != null) citation.year = year;
  const publisher = asString(frontmatter.publisher);
  if (publisher) citation.publisher = publisher;
  const title = asString(frontmatter.title);
  if (title) citation.title = title;
  const identifier: NonNullable<SourceCitation["identifier"]> = {};
  const isbn = asString(frontmatter.isbn);
  if (isbn) identifier.isbn = isbn;
  const doi = asString(frontmatter.doi);
  if (doi) identifier.doi = doi;
  const url = asString(frontmatter.url);
  if (url) identifier.url = url;
  if (Object.keys(identifier).length) citation.identifier = identifier;
  return Object.keys(citation).length ? citation : undefined;
}

function readFacets(frontmatter: Record<string, unknown>): SourceFacets {
  const facets: SourceFacets = {};
  const themes = asStringArray(frontmatter.themes);
  if (themes.length) facets.themes = themes;
  const location = asStringArray(frontmatter.location);
  if (location.length) facets.location = location;
  const timePeriod = asString(frontmatter.time_period);
  if (timePeriod) facets.timePeriod = timePeriod;
  const participants = asStringArray(frontmatter.participants);
  if (participants.length) facets.participants = participants;
  const characterFocus = asStringArray(frontmatter.character_focus);
  if (characterFocus.length) facets.characterFocus = characterFocus;
  return facets;
}

function readExtra(
  frontmatter: Record<string, unknown>,
): Record<string, unknown> {
  const extra: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(frontmatter)) {
    if (CONSUMED_KEYS.has(key)) continue;
    extra[key] = value;
  }
  return extra;
}

/* ── Nested provenance: stubs, citation identity, trust policy ──── */

/** Input for creating a citation-only STUB source from a carrier's bibliography. */
export type CreateStubSourceInput = {
  wikiId: string;
  title: string;
  sourceType: SourceType;
  citation: SourceCitation;
  tags?: string[];
};

/**
 * Dedup identity for a cited work: hard identifier first (isbn > doi > url),
 * else normalized author+year+title. Returns null when the citation is too
 * thin to identify — the junk-stub guard (spec: no stub without
 * (author|identifier) + title).
 */
export function citationIdentityKey(citation: SourceCitation): string | null {
  const id = citation.identifier;
  if (id?.isbn) return `isbn:${id.isbn.replace(/[-\s]/g, "").toLowerCase()}`;
  if (id?.doi) return `doi:${id.doi.trim().toLowerCase()}`;
  if (id?.url) return `url:${id.url.trim().toLowerCase().replace(/\/+$/, "")}`;

  const title = normalizeIdentityPart(citation.title);
  if (!title) return null;
  const author = normalizeIdentityPart(citation.author?.[0]);
  if (!author) return null;
  const year = citation.year != null ? String(citation.year) : "";
  return `work:${author}|${year}|${title}`;
}

function normalizeIdentityPart(value: string | undefined): string | null {
  if (!value) return null;
  const normalized = value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
  return normalized.length > 0 ? normalized : null;
}

/** How a ref's trust resolves under the transitivity rule (P1: depth ≤ 2). */
export type RefTrust = {
  /** Tier of the source the claim is attributed to; null when the provenance
   * isn't tiered (authored/synthetic) or the source is unknown. */
  sourceType: SourceType | null;
  state: "direct" | "attributed-unverified" | "attributed-verified";
};

/**
 * Trust policy for one ref (spec: derived at read time, never stored).
 * - no attribution → tier of the evidence source, "direct"
 * - attributed to a stub → cited tier, "attributed-unverified"
 * - attributed to a hydrated source → cited tier, "attributed-verified"
 */
export function effectiveTrustForRef(
  ref: { sourceId: string; attributedSourceId: string | null },
  classifyForSource: (sourceId: string) => ClassifyMetadata | null | undefined,
): RefTrust {
  const tierOf = (id: string): { tier: SourceType | null; stub: boolean } => {
    const classify = classifyForSource(id);
    const p = classify?.provenance;
    if (!p || p.ingestionType !== "source") return { tier: null, stub: false };
    return { tier: p.sourceType, stub: p.hydration === "stub" };
  };

  if (!ref.attributedSourceId) {
    return { sourceType: tierOf(ref.sourceId).tier, state: "direct" };
  }
  const attributed = tierOf(ref.attributedSourceId);
  return {
    sourceType: attributed.tier,
    state: attributed.stub ? "attributed-unverified" : "attributed-verified",
  };
}

/* ── guards / coercion ──────────────────────────────────────────── */

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isIngestionType(value: unknown): value is IngestionType {
  return value === "source" || value === "authored" || value === "synthetic";
}

function isSourceType(value: unknown): value is SourceType {
  return (
    value === "primary" || value === "secondary" || value === "tertiary"
  );
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function asNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && /^-?\d+(?:\.\d+)?$/.test(value)) {
    return Number(value);
  }
  return undefined;
}

function asStringArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.filter((item): item is string => typeof item === "string");
  }
  return typeof value === "string" && value.length > 0 ? [value] : [];
}
