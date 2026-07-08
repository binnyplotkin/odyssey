/**
 * Survey stage (nested provenance P1 — docs/nested-provenance-spec.md).
 *
 * One LLM call that classifies a source's ANATOMY before planning:
 *   - direct:  the text IS the material (scripture, a novel, a transcript)
 *   - citing:  a carrier — research report / commentary whose claims are
 *              attributed to other works (bibliography, [n] markers)
 *   - mixed:   substantial direct material + a citing apparatus
 *
 * For citing/mixed sources it also parses the bibliography into structured
 * citations (exploded into STUB sources by `explodeCitations`) and names
 * sections the planner should not mine for wiki pages (bibliographies,
 * methodology) via verbatim text anchors.
 *
 * Anchor-based exclusion is deliberately mechanical: the model returns
 * verbatim first-lines, we resolve them with indexOf. If an anchor doesn't
 * resolve, that exclusion is skipped (fail-open) — exclusion is an
 * optimization, never a correctness gate.
 */

import type { Tool } from "@anthropic-ai/sdk/resources/messages";
import type {
  CreateSourceCitationInput,
  SourceCitation,
  SourceFacets,
  SourceType,
  WikiStore,
} from "@odyssey/db";
import { call, extractToolUse } from "./client";
import type { ModelId } from "./models";

/** Above this the survey sees a truncated document (bibliographies are
 * usually near an end, so we keep head + tail). ~30k tokens. */
const SURVEY_SOURCE_CHAR_BUDGET = 120_000;

export type SurveyAnatomy = "direct" | "citing" | "mixed";

export type SurveyBibliographyEntry = {
  /**
   * ALL inline markers the carrier uses for this work ("[8]", "[24]", …) —
   * reports frequently cite one work under several numbers. Empty when
   * unmarked.
   */
  markers: string[];
  /** Verbatim bibliography entry as it appears in the document. */
  rawCitation: string;
  citation: SourceCitation;
  /** Evidentiary tier of the CITED work, world-relative. */
  sourceType: SourceType;
};

export type SurveyExcludeSection = {
  /** Verbatim first line of the section to exclude (matched with indexOf). */
  anchorStart: string;
  /** Verbatim first line of the NEXT section (exclusive end). Omitted =
   * exclude through end of document. */
  anchorEnd?: string;
  reason: string;
};

export type SurveyResult = {
  anatomy: SurveyAnatomy;
  bibliography: SurveyBibliographyEntry[];
  excludeSections: SurveyExcludeSection[];
  /**
   * The document's OWN citation + facets (distinct from its bibliography of
   * cited works). Written into the source's classify block server-side —
   * relocates what the composer's Classify tab used to author. Empty when the
   * document isn't a formally attributable work (e.g. an unattributed report).
   */
  selfCitation: SourceCitation;
  selfFacets: SourceFacets;
  tokens: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
};

const SURVEY_TOOL: Tool = {
  name: "survey_source",
  description: "Report the source document's anatomy, bibliography, and non-content sections.",
  input_schema: {
    type: "object",
    properties: {
      anatomy: {
        type: "string",
        enum: ["direct", "citing", "mixed"],
        description:
          "direct = the text IS the material; citing = a carrier that attributes claims to other works; mixed = both",
      },
      bibliography: {
        type: "array",
        description:
          "Every distinct work this document cites (empty for direct sources). Parse each bibliography/reference entry.",
        items: {
          type: "object",
          properties: {
            markers: {
              type: "array",
              items: { type: "string" },
              description:
                'EVERY inline citation marker used for this work anywhere in the text, exactly as it appears including brackets, e.g. ["[8]", "[24]", "[51]"] — one work is often cited under several numbers. Empty array if unmarked.',
            },
            rawCitation: {
              type: "string",
              description: "The bibliography entry verbatim from the document.",
            },
            author: { type: "array", items: { type: "string" } },
            year: { type: ["number", "null"] },
            title: { type: ["string", "null"], description: "Title of the cited work." },
            publisher: { type: ["string", "null"] },
            isbn: { type: ["string", "null"] },
            doi: { type: ["string", "null"] },
            url: { type: ["string", "null"] },
            sourceType: {
              type: "string",
              enum: ["primary", "secondary", "tertiary"],
              description:
                "Tier of the CITED work relative to this wiki's subject: primary = original documents/records/firsthand texts; secondary = scholarship about them; tertiary = syntheses of scholarship.",
            },
          },
          required: ["rawCitation", "sourceType"],
        },
      },
      excludeSections: {
        type: "array",
        description:
          "Sections the wiki planner should NOT mine for pages: bibliographies, reference lists, methodology/sources-and-method discussions, tables comparing scholarship. NOT the substantive content itself.",
        items: {
          type: "object",
          properties: {
            anchorStart: {
              type: "string",
              description: "The section's first line, VERBATIM from the document (used for exact string matching).",
            },
            anchorEnd: {
              type: ["string", "null"],
              description: "First line of the NEXT section, verbatim (exclusive end). Null = through end of document.",
            },
            reason: { type: "string" },
          },
          required: ["anchorStart", "reason"],
        },
      },
      self: {
        type: "object",
        description:
          "The document's OWN bibliographic identity + subject facets, ONLY when the document is itself a formally attributable work (a book, paper, article with a byline/publisher). Leave fields null/empty for unattributed material (a generated report, raw notes, scripture excerpt).",
        properties: {
          author: { type: "array", items: { type: "string" } },
          year: { type: ["number", "null"] },
          title: { type: ["string", "null"] },
          publisher: { type: ["string", "null"] },
          isbn: { type: ["string", "null"] },
          doi: { type: ["string", "null"] },
          url: { type: ["string", "null"] },
          themes: { type: "array", items: { type: "string" }, description: "Subject themes of this document." },
          location: { type: "array", items: { type: "string" }, description: "Places central to this document." },
          timePeriod: { type: ["string", "null"], description: "Time period this document concerns." },
          participants: { type: "array", items: { type: "string" }, description: "People/entities central to this document." },
        },
      },
    },
    required: ["anatomy", "bibliography", "excludeSections"],
  },
};

const SURVEY_SYSTEM = `You are the SURVEY stage of a wiki ingestion pipeline. Before any pages are planned, you classify the incoming source document's anatomy and map its citation apparatus.

WHY THIS MATTERS
The pipeline grounds every extracted claim in provenance. A DIRECT source (scripture, a novel, a transcript, an original account) is itself the evidence. A CITING document (research report, literature review, commentary, encyclopedia article) is a carrier: its claims really live in the works it cites, so those works must be captured as structured citations. Attributing a carrier's claims to the carrier itself would launder secondhand paraphrase into firsthand evidence.

RULES
- anatomy: "citing" when the document systematically attributes claims to other works (numbered markers, a bibliography, "according to X"). "direct" when the text is the material itself. "mixed" when substantial direct material carries a citing apparatus (e.g. an annotated translation).
- bibliography: one entry per distinct WORK. Parse authors/year/title/publisher/identifiers from the entry text only — do not invent identifiers that are not present. Copy rawCitation verbatim. Assign each cited work its own evidentiary tier (a report may cite parish registers — primary — and modern biographies — secondary).
- markers: copy inline markers exactly as they appear in the text (e.g. "[8]"), including brackets. List EVERY marker that refers to a given work — reports frequently cite the same work under several different numbers, and each one must map back to the work for provenance to resolve.
- excludeSections: bibliographies, reference lists, methodology discussions, and scholarship-comparison sections describe the document's SOURCING, not the subject matter — the planner should not turn them into wiki pages. Anchor lines must be copied VERBATIM (they are resolved by exact string match). Never exclude substantive content.
- self: the document's OWN bibliographic identity and subject facets. Fill author/year/title/publisher/identifiers ONLY when the document is itself a formally attributable work with a byline or publication data (a book, a journal article, a bylined report). Leave those fields null/empty for unattributed material (a generated brief, raw notes, a scripture excerpt). Fill themes/location/timePeriod/participants whenever the subject matter is clear enough to summarize — these are browse facets for the source, not evidence.
- Do not emit any text outside the tool call.`;

export async function survey(args: {
  model: ModelId;
  source: { title: string; content: string };
}): Promise<SurveyResult> {
  const content = truncateForSurvey(args.source.content);
  const result = await call({
    model: args.model,
    system: SURVEY_SYSTEM,
    messages: [
      {
        role: "user",
        content: `# Source document\n\nTitle: ${args.source.title}\n\n---\n\n${content}`,
      },
    ],
    tools: [SURVEY_TOOL],
    toolChoice: { type: "tool", name: "survey_source" },
    maxTokens: 8192,
  });

  const raw = extractToolUse<{
    anatomy?: string;
    bibliography?: Array<Record<string, unknown>>;
    excludeSections?: Array<Record<string, unknown>>;
    self?: Record<string, unknown>;
  }>(result, "survey_source");

  if (!raw || !isAnatomy(raw.anatomy)) {
    throw new Error(
      `survey: tool_use missing/invalid anatomy; stop=${result.stopReason}; raw=${JSON.stringify(raw).slice(0, 300)}`,
    );
  }

  const self = parseSelf(
    raw.self && typeof raw.self === "object" ? raw.self : {},
  );
  return {
    anatomy: raw.anatomy,
    bibliography: coerceArray(raw.bibliography).flatMap(parseBibliographyEntry),
    excludeSections: coerceArray(raw.excludeSections).flatMap(parseExcludeSection),
    selfCitation: self.citation,
    selfFacets: self.facets,
    tokens: result.tokens,
    inputTokens: result.inputTokens,
    outputTokens: result.outputTokens,
    cacheReadTokens: result.cacheReadTokens,
    cacheWriteTokens: result.cacheWriteTokens,
  };
}

/* ── Explode: bibliography → stubs + citation edges ─────────────── */

export type ExplodeResult = {
  /** marker ("[8]") → cited source id, for mechanical ref attribution. */
  markerMap: Map<string, string>;
  stubsOrMatches: number;
  skippedThin: number;
};

/**
 * Create/dedupe a source row per cited work and record carrier→cited edges.
 * Thin citations (fail `citationIdentityKey`) are recorded as skipped — the
 * junk-stub guard. Matching an already-hydrated source is the ideal case
 * (commentary citing already-ingested scripture).
 */
export async function explodeCitations(args: {
  store: WikiStore;
  wikiId: string;
  carrierId: string;
  bibliography: SurveyBibliographyEntry[];
  /** Carrier content — mined mechanically for a numbered marker apparatus. */
  content?: string;
}): Promise<ExplodeResult> {
  const markerMap = new Map<string, string>();
  // For merging the mechanical apparatus: target identity → cited source id.
  const byUrl = new Map<string, string>();
  const byTitle = new Map<string, string>();
  // Direct entry→citedId tracking — includes entries with NO LLM markers,
  // which are exactly the ones the apparatus join must rescue.
  const entryCitedIds: Array<{ rawNorm: string; citedId: string }> = [];
  let stubsOrMatches = 0;
  let skippedThin = 0;

  for (const entry of args.bibliography) {
    let citedId: string;
    try {
      const cited = await args.store.createStubSource({
        wikiId: args.wikiId,
        title: entry.citation.title ?? entry.rawCitation.slice(0, 120),
        sourceType: entry.sourceType,
        citation: entry.citation,
      });
      citedId = cited.id;
      stubsOrMatches += 1;
    } catch {
      // Junk-stub guard: unidentifiable citation. The raw entry still gets
      // recorded on nothing — P1 drops it (spec: log, no garbage stubs).
      skippedThin += 1;
      continue;
    }

    // One edge per marker (each is a distinct citation instance); a single
    // markerless edge when the work is cited without inline markers.
    const markers = entry.markers.length > 0 ? entry.markers : [null];
    await args.store.addSourceCitations(
      markers.map((marker) => ({
        carrierId: args.carrierId,
        citedId,
        marker,
        rawCitation: entry.rawCitation,
        locator: entry.citation.locator ?? null,
      })),
    );
    for (const marker of entry.markers) markerMap.set(marker, citedId);

    const url = entry.citation.identifier?.url;
    if (url) byUrl.set(normalizeUrl(url), citedId);
    if (entry.citation.title) byTitle.set(entry.citation.title.toLowerCase().trim(), citedId);
    entryCitedIds.push({ rawNorm: entry.rawCitation.toLowerCase(), citedId });
  }

  // Merge the mechanical apparatus: markers the survey missed resolve by URL
  // identity (primary), rawCitation containment (the verbatim bibliography
  // entry usually embeds the URL — robust even when the LLM skipped the
  // structured url field), or exact normalized title. Deterministic — the
  // LLM never touches this.
  if (args.content) {
    const byRawCitation = (target: string): string | undefined => {
      if (!/[a-z0-9]\.[a-z]{2}/.test(target)) return undefined; // URL-ish only
      for (const { rawNorm, citedId } of entryCitedIds) {
        if (rawNorm.includes(target)) return citedId;
      }
      return undefined;
    };

    const apparatus = extractMarkerApparatus(args.content);
    const newEdges: CreateSourceCitationInput[] = [];
    for (const [marker, target] of apparatus) {
      if (markerMap.has(marker)) continue;
      const citedId =
        byUrl.get(target) ?? byRawCitation(target) ?? byTitle.get(target);
      if (!citedId) continue;
      markerMap.set(marker, citedId);
      newEdges.push({
        carrierId: args.carrierId,
        citedId,
        marker,
        rawCitation: `[apparatus] ${target}`,
      });
    }
    if (newEdges.length > 0) await args.store.addSourceCitations(newEdges);
  }

  return { markerMap, stubsOrMatches, skippedThin };
}

/* ── Marker apparatus: mechanical [n]→work extraction ───────────── */

/**
 * Many generated research documents end with a numbered reference apparatus:
 *
 *   [1] [14] [63] https://example.org/some-source
 *   [103] Wills and administrations before 1858
 *   https://nationalarchives.gov.uk/…
 *
 * That structure is machine-parseable — no LLM needed. Returns marker → the
 * apparatus target (a normalized URL when present, else the title text).
 * Merged into the marker map by `explodeCitations` via URL identity, this
 * recovers markers the survey missed.
 */
export function extractMarkerApparatus(content: string): Map<string, string> {
  const map = new Map<string, string>();
  const lines = content.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    const m = line.match(/^((?:\[\d{1,3}\]\s*)+)(.*)$/);
    if (!m) continue;
    const markers = m[1].match(/\[\d{1,3}\]/g) ?? [];
    let rest = m[2].trim();
    // Title line whose URL sits on the following line.
    if (rest && !/https?:\/\//.test(rest)) {
      const next = lines[i + 1]?.trim() ?? "";
      if (/^https?:\/\//.test(next)) rest = next;
    }
    const urlMatch = rest.match(/https?:\/\/\S+/);
    const target = urlMatch ? normalizeUrl(urlMatch[0]) : rest.toLowerCase();
    if (!target) continue;
    for (const marker of markers) {
      if (!map.has(marker)) map.set(marker, target);
    }
  }
  return map;
}

export function normalizeUrl(url: string): string {
  return url
    .toLowerCase()
    .replace(/[?#].*$/, "") // strip query (utm_source=… noise) + fragments
    .replace(/\/+$/, "")
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "");
}

/* ── Exclusions: verbatim anchors → char ranges (fail-open) ─────── */

export function resolveExcludeRanges(
  content: string,
  sections: SurveyExcludeSection[],
): Array<{ start: number; end: number; reason: string }> {
  const ranges: Array<{ start: number; end: number; reason: string }> = [];
  for (const s of sections) {
    const anchor = s.anchorStart.trim();
    if (anchor.length < 4) continue; // too short to match safely
    const start = content.indexOf(anchor);
    if (start === -1) continue; // fail-open: anchor didn't resolve
    let end = content.length;
    if (s.anchorEnd) {
      const endIdx = content.indexOf(s.anchorEnd.trim(), start + anchor.length);
      if (endIdx !== -1) end = endIdx;
    }
    if (end > start) ranges.push({ start, end, reason: s.reason });
  }
  // Merge overlaps so applyExclusions can splice linearly.
  ranges.sort((a, b) => a.start - b.start);
  const merged: typeof ranges = [];
  for (const r of ranges) {
    const prev = merged[merged.length - 1];
    if (prev && r.start <= prev.end) {
      prev.end = Math.max(prev.end, r.end);
    } else {
      merged.push({ ...r });
    }
  }
  return merged;
}

/** Replace excluded ranges with a short placeholder so the planner never
 * mines them. The writer still sees the ORIGINAL full source. */
export function applyExclusions(
  content: string,
  ranges: Array<{ start: number; end: number; reason: string }>,
): string {
  if (ranges.length === 0) return content;
  let out = "";
  let cursor = 0;
  for (const r of ranges) {
    out += content.slice(cursor, r.start);
    out += `\n[section excluded from planning — ${r.reason}]\n`;
    cursor = r.end;
  }
  out += content.slice(cursor);
  return out;
}

/* ── Ref attribution: markers in a passage → cited source ids ───── */

/** Deterministic marker scan — no LLM judgment. A ref quoting text that
 * carries "[8]" attributes to whatever work "[8]" resolved to. */
export function attributionsForRef(
  ref: { passage?: string | null; quote?: string | null },
  markerMap: Map<string, string>,
): string[] {
  if (markerMap.size === 0) return [];
  const text = `${ref.passage ?? ""}\n${ref.quote ?? ""}`;
  const ids = new Set<string>();
  for (const [marker, citedId] of markerMap) {
    if (text.includes(marker)) ids.add(citedId);
  }
  return Array.from(ids);
}

/* ── parsing helpers ────────────────────────────────────────────── */

/** Models occasionally emit an array field as a JSON-encoded STRING (schema
 * violation seen under streaming accumulation). Coerce defensively — the
 * downstream gates (stub counts) catch a genuinely empty bibliography. */
function coerceArray(v: unknown): Array<Record<string, unknown>> {
  if (Array.isArray(v)) return v as Array<Record<string, unknown>>;
  if (typeof v === "string") {
    try {
      const parsed = JSON.parse(v);
      return Array.isArray(parsed) ? (parsed as Array<Record<string, unknown>>) : [];
    } catch {
      return [];
    }
  }
  return [];
}

function isAnatomy(v: unknown): v is SurveyAnatomy {
  return v === "direct" || v === "citing" || v === "mixed";
}

function isSourceType(v: unknown): v is SourceType {
  return v === "primary" || v === "secondary" || v === "tertiary";
}

function parseBibliographyEntry(
  raw: Record<string, unknown>,
): SurveyBibliographyEntry[] {
  const rawCitation = typeof raw.rawCitation === "string" ? raw.rawCitation.trim() : "";
  if (!rawCitation) return [];
  const sourceType = isSourceType(raw.sourceType) ? raw.sourceType : "secondary";

  const citation: SourceCitation = {};
  const author = Array.isArray(raw.author)
    ? raw.author.filter((a): a is string => typeof a === "string" && a.trim().length > 0)
    : [];
  if (author.length) citation.author = author;
  if (typeof raw.year === "number" && Number.isFinite(raw.year)) citation.year = raw.year;
  if (typeof raw.title === "string" && raw.title.trim()) citation.title = raw.title.trim();
  if (typeof raw.publisher === "string" && raw.publisher.trim()) citation.publisher = raw.publisher.trim();
  const identifier: NonNullable<SourceCitation["identifier"]> = {};
  if (typeof raw.isbn === "string" && raw.isbn.trim()) identifier.isbn = raw.isbn.trim();
  if (typeof raw.doi === "string" && raw.doi.trim()) identifier.doi = raw.doi.trim();
  if (typeof raw.url === "string" && raw.url.trim()) identifier.url = raw.url.trim();
  if (Object.keys(identifier).length) citation.identifier = identifier;

  return [
    {
      markers: Array.isArray(raw.markers)
        ? raw.markers
            .filter((m): m is string => typeof m === "string")
            .map((m) => m.trim())
            .filter(Boolean)
        : // tolerate the old singular shape from any cached/legacy payloads
          typeof raw.marker === "string" && raw.marker.trim()
          ? [raw.marker.trim()]
          : [],
      rawCitation,
      citation,
      sourceType,
    },
  ];
}

/**
 * Parse the document's OWN bibliographic identity + subject facets from the
 * survey tool call. Every field is optional — an unattributed document yields
 * an empty citation, and facets fall back to whatever the model could summarize.
 */
function parseSelf(raw: Record<string, unknown>): {
  citation: SourceCitation;
  facets: SourceFacets;
} {
  const citation: SourceCitation = {};
  const author = Array.isArray(raw.author)
    ? raw.author.filter((a): a is string => typeof a === "string" && a.trim().length > 0)
    : [];
  if (author.length) citation.author = author;
  if (typeof raw.year === "number" && Number.isFinite(raw.year)) citation.year = raw.year;
  if (typeof raw.title === "string" && raw.title.trim()) citation.title = raw.title.trim();
  if (typeof raw.publisher === "string" && raw.publisher.trim()) citation.publisher = raw.publisher.trim();
  const identifier: NonNullable<SourceCitation["identifier"]> = {};
  if (typeof raw.isbn === "string" && raw.isbn.trim()) identifier.isbn = raw.isbn.trim();
  if (typeof raw.doi === "string" && raw.doi.trim()) identifier.doi = raw.doi.trim();
  if (typeof raw.url === "string" && raw.url.trim()) identifier.url = raw.url.trim();
  if (Object.keys(identifier).length) citation.identifier = identifier;

  const facets: SourceFacets = {};
  const strArray = (v: unknown): string[] =>
    Array.isArray(v)
      ? v.filter((s): s is string => typeof s === "string" && s.trim().length > 0).map((s) => s.trim())
      : [];
  const themes = strArray(raw.themes);
  if (themes.length) facets.themes = themes;
  const location = strArray(raw.location);
  if (location.length) facets.location = location;
  if (typeof raw.timePeriod === "string" && raw.timePeriod.trim()) facets.timePeriod = raw.timePeriod.trim();
  const participants = strArray(raw.participants);
  if (participants.length) facets.participants = participants;

  return { citation, facets };
}

function parseExcludeSection(
  raw: Record<string, unknown>,
): SurveyExcludeSection[] {
  const anchorStart = typeof raw.anchorStart === "string" ? raw.anchorStart.trim() : "";
  if (!anchorStart) return [];
  return [
    {
      anchorStart,
      anchorEnd:
        typeof raw.anchorEnd === "string" && raw.anchorEnd.trim()
          ? raw.anchorEnd.trim()
          : undefined,
      reason: typeof raw.reason === "string" ? raw.reason : "non-content section",
    },
  ];
}

function truncateForSurvey(content: string): string {
  const trimmed = content.trim();
  if (trimmed.length <= SURVEY_SOURCE_CHAR_BUDGET) return trimmed;
  // Bibliographies cluster at document ends — keep head + tail.
  const head = trimmed.slice(0, Math.floor(SURVEY_SOURCE_CHAR_BUDGET * 0.7));
  const tail = trimmed.slice(-Math.floor(SURVEY_SOURCE_CHAR_BUDGET * 0.3));
  return `${head}\n\n…[middle truncated for survey]…\n\n${tail}`;
}
