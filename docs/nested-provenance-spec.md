# Nested Provenance — P1 spec (Attribution)

**Status:** draft · 2026-07-07
**Owner:** Binny
**Depends on:** the kind→sourceType collapse (done), the `classify` metadata block (done)
**Phases:** P1 Attribution (this doc) → P2 Hydration → P3 Re-verification

## Motivation

Today the pipeline grounds every claim to the *pasted document*. That is correct
for direct material (scripture, a novel, a transcript) and wrong for **citing
documents** — research reports, commentaries, synthesis docs — whose whole value
is per-claim attribution to underlying sources. A 50k-char Shakespeare research
report with `[8]`-style citations ingests as if the report itself were the
evidence; the bibliography (Schoenbaum, Honan, parish registers) is destroyed at
the paste boundary.

P1 makes the provenance chain honest and complete:

```
node → passage (in report) → attributed to → Schoenbaum (stub, unverified)
```

## Constitution

These are the invariants every later phase (and every UI surface) must obey.
Changing one is an architecture decision, not a refactor.

1. **Everything that enters is a source.** Its `ingestionType`
   (source | authored | synthetic) routes what provenance *means*:
   cite / declare / inherit.
2. **A ref carries two facts, never conflated:** *evidence* (`sourceId` — the
   document we actually possess) and *attribution* (`attributedSourceId` —
   where the claim really lives). Neither overwrites the other. We never claim
   to have seen text we haven't ("no laundering hearsay into evidence").
3. **Trust is derived, never stored as ground truth.** It is a recomputable
   function of the provenance chain + hydration state. Policy can change
   without re-ingestion.
4. **Provenance is append-only.** Hydration *extends* chains; nothing re-maps
   or rewrites history.

**Transitivity rule.** Citation chains form a DAG (a hydrated source's own
bibliography explodes too). Effective trust of a claim =
**the tier of the nearest *hydrated* ancestor on its attribution path,
discounted once per unhydrated hop.** Monotone: hydration only ever upgrades.

**World-relative tiers.** `sourceType` (primary/secondary/tertiary) is the
*wiki's canon policy applied to a document*, not an absolute property. Genesis
is primary in an Abraham wiki; a novel is primary canon in a fiction wiki.
`authored = axiomatic` is the existing special case of this rule.

## Terminology

- **Carrier** — a citing document (research report, commentary). Transports
  claims it attributes to other works.
- **Stub** — a source row created from a carrier's bibliography: full citation
  metadata, **no content**. Exists so attribution has a real target.
- **Hydration** — a stub acquiring its actual content (P2: upload the real
  Schoenbaum PDF → matches the stub → becomes verifiable).
- **Evidence vs. attribution** — see invariant 2.

## Schema deltas (additive)

### `wiki_sources`

- `content` → **nullable** (stub = NULL). `contentHash` → nullable likewise.
  Stubs dedupe by *citation identity*, not content hash.
- Hydration state lives in the classify block, not a column:
  `metadata.classify.provenance.hydration: "full" | "stub"` (default `"full"`;
  only meaningful for `ingestionType: "source"`).

### New join table: `wiki_source_citations`

Carrier→cited edges. A join table (not a `citedBy` column) because many
carriers can cite one stub, and hydrated sources later gain their own edges.

```ts
export const wikiSourceCitationsTable = pgTable(
  "wiki_source_citations",
  {
    id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
    carrierId: text("carrier_id").notNull()
      .references(() => wikiSourcesTable.id, { onDelete: "cascade" }),
    citedId: text("cited_id").notNull()
      .references(() => wikiSourcesTable.id, { onDelete: "cascade" }),
    marker: text("marker"),          // "[8]" — the carrier's inline marker
    rawCitation: text("raw_citation"), // verbatim bibliography entry
    locator: text("locator"),        // page/section within the cited work, if given
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("wiki_source_citations_carrier_idx").on(t.carrierId),
    index("wiki_source_citations_cited_idx").on(t.citedId),
    uniqueIndex("wiki_source_citations_unique_idx").on(t.carrierId, t.citedId, t.marker),
  ],
);
```

### `wiki_source_refs`

One new nullable column:

```ts
attributedSourceId: text("attributed_source_id")
  .references(() => wikiSourcesTable.id, { onDelete: "set null" }),
```

`sourceId` stays NOT NULL (evidence is always the ingested document).
`onDelete: "set null"` — losing a stub degrades attribution, never destroys
evidence (invariant 2).

### Types (`source-metadata.ts`)

```ts
export type SourceProvenance = {
  ingestionType: "source";
  sourceType: SourceType;
  citation?: SourceCitation;
  hydration?: "full" | "stub";   // absent = "full" (back-compat)
};
```

`SourceCitation.identifier` already carries isbn/doi/url — these are the stub
dedup keys.

## Pipeline changes

Current: Acquire → Plan (chunked) → Write → Ground → Embed.
P1 inserts **Survey** and **Explode** before planning:

```
Acquire → Survey → [Explode citations] → Plan → Write → Ground → Embed
```

### Survey stage (new, one LLM call)

Runs on the acquired text before planning. Output (tool-forced):

```ts
type SurveyResult = {
  anatomy: "direct" | "citing" | "mixed";
  // present when citing/mixed:
  bibliography?: Array<{
    marker: string | null;        // "[8]" or null for unmarked entries
    rawCitation: string;          // verbatim bibliography entry
    citation: SourceCitation;     // parsed: author/year/title/publisher/identifier
    sourceType: SourceType;       // tier of the CITED work, world-relative
  }>;
  // char ranges the planner should NOT mine for wiki pages
  // (bibliography lists, methodology sections, tables of works):
  excludeRanges?: Array<{ start: number; end: number; reason: string }>;
};
```

Notes:
- `excludeRanges` is what stops "Sources and method" sections from spawning
  entity pages about biographies inside a world-knowledge wiki.
- Survey is also the natural home for `ingestionType` detection
  (detected-but-confirmable) when the composer's type chip is built.
- Model: same tier as the planner (survey quality gates everything downstream).

### Explode citations

For each bibliography entry:
1. **Dedupe** against existing sources in this wiki:
   identifier match (isbn/doi/url) → else normalized `author+year+title`.
   Match may hit a *hydrated* source (e.g. commentary citing already-ingested
   Genesis) — then no stub is created and attribution lands on the real source
   immediately.
2. Else **create a stub**: `createSource` with `content: null`,
   `provenance: { ingestionType: "source", sourceType, citation, hydration: "stub" }`.
3. Write the `wiki_source_citations` edge (carrier → cited, marker, rawCitation).
4. Build the run's **marker map**: `marker → citedSourceId`, passed to the
   planner/writer stages.

Junk-stub guard: a bibliography entry must parse to at least
(author or identifier) + title to become a stub; otherwise it is recorded on
the citation edge (`rawCitation`) with `citedId` pointing at a per-carrier
"unparsed citations" bucket — never a garbage stub. (Alternative: skip the
bucket and just log; decide during build.)

### Planner

- Passages already come back per-op (`sourcePassages`). P1 addition: the
  planner is instructed to **preserve inline citation markers verbatim** inside
  extracted passages (no paraphrasing them away).
- Chunking: survey runs on the *full* text once; the marker map is global to
  the run, so chunked planning needs no changes beyond what exists
  (`plannedSoFar` already threads chunk context).

### Writer / Ground

- When persisting `wiki_source_refs`, resolve markers found in the ref's
  passage/quote via the marker map → set `attributedSourceId`.
- Resolution is **mechanical string matching** on markers (`[8]`), not an LLM
  judgment — keep it deterministic. A passage with multiple markers produces
  multiple ref rows (one per attribution), same evidence quote.
- No marker in the passage → `attributedSourceId` stays null → the claim is
  attributed to the carrier itself (exactly today's semantics; zero regression
  for direct sources).

## Trust rollup (P1 scope)

P1 chains are depth ≤ 2 (node → carrier → stub), so the transitivity rule
reduces to:

| Attribution | Display state |
|---|---|
| carrier only (no marker) | tier of carrier |
| → stub (unhydrated) | tier of cited work, badged **attributed · unverified** |
| → hydrated source | tier of cited work, **verified** (P2 makes this reachable) |

Computed at read time (invariant 3) — a helper in `db`
(`effectiveTrustForRef(ref, sources)`), no stored rollup.

## UI touchpoints (P1 minimal)

- **Sources library:** stubs appear with a `STUB` badge + "cited by N sources";
  they carry citation metadata but no content view. Tier buckets apply as usual.
- **Source detail (carrier):** a "Cites" section listing its bibliography edges.
- **Node citation panel (existing refs list):** attributed refs render
  "per *Schoenbaum, Documentary Life* — via: Shakespeare research report".
- Composer: no changes required for P1 (survey runs server-side). The Extract
  tab may later surface "N cited works detected".

## Purge semantics

- Purging a carrier cascades its citation edges; a stub whose last citing edge
  disappears AND has no attributed refs is deleted (refcount check inside the
  existing purge-impact collector). Hydrated sources are never auto-deleted.
- Purging a stub: `attributed_source_id` set-nulls (refs survive as
  carrier-attributed).

## Eval plan

Attribution quality is LLM-bound; it ships with evals or it doesn't ship:
- **Survey extraction:** golden set of ~10 documents (this Shakespeare report,
  a commentary, a plain narrative, a URL article) → expected bibliography
  entries + exclude ranges. Score precision/recall on parsed citations.
- **Marker preservation:** planner passages from a marked-up document must
  retain ≥95% of markers verbatim.
- **End-to-end:** ingest the Shakespeare report on a scratch wiki → assert
  stub count, citation edges, and that ≥80% of refs whose quotes contain
  markers carry the right `attributedSourceId`.
- Junk-stub rate: 0 stubs without (author|identifier)+title.

## Non-goals (P1)

- **Hydration matching** (upload real PDF → stub) — P2.
- **Re-verification** of carrier paraphrases against hydrated text — P3.
- Global cross-wiki citation registry — deliberately out; per-wiki stubs with
  hard identifiers get 95% of the value, and append-only provenance means a
  registry can be layered on later.
- Recursive explosion of hydrated sources' own bibliographies (works, but
  gated behind P2 since it needs hydration first).

## Rollout order

1. Schema: `content`/`contentHash` nullable, `wiki_source_citations`,
   `wiki_source_refs.attributed_source_id` (all additive; migration script per
   house pattern — dry-run default, `--apply`).
2. Types + store: `hydration` on `SourceProvenance`; `createStubSource` +
   citation-edge CRUD + `effectiveTrustForRef` in wiki-store.
3. Survey stage + explode step in `wiki-ingest` (behind a per-run flag,
   default ON for `anatomy: citing` only — direct sources see zero change).
4. Marker preservation in planner prompt + mechanical resolution at ref
   persistence.
5. Evals (golden set) — gate before default-on.
6. UI: stub badge + Cites section + attributed ref rendering.
