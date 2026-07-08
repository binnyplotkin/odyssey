/**
 * Metadata debug — traces what happens to a source's metadata, pre- and
 * at-ingestion, WITHOUT spending LLM tokens (deterministic pieces only; the
 * two Haiku auto-fills are marked as such and observable in the browser
 * console via the `[classify-debug]` logs when you paste in the composer).
 *
 * Usage:
 *   npx tsx scripts/debug-source-metadata.ts <file> [--sourceType tertiary]
 */

import "dotenv/config";
import { readFileSync } from "node:fs";
import {
  buildStoredSourceMetadata,
  citationIdentityKey,
  deriveKindFromSourceType,
  readClassifyMetadata,
  type SourceType,
} from "@odyssey/db";
import { extractMarkerApparatus } from "@odyssey/wiki-ingest";

const file = process.argv[2];
if (!file) {
  console.error("usage: npx tsx scripts/debug-source-metadata.ts <file> [--sourceType tertiary]");
  process.exit(1);
}
const stIdx = process.argv.indexOf("--sourceType");
const sourceType = (stIdx !== -1 ? process.argv[stIdx + 1] : "tertiary") as SourceType;
const content = readFileSync(file, "utf8");

console.log(`═══ metadata journey · ${file.split("/").pop()} · ${content.length.toLocaleString()} chars ═══\n`);

/* ── 1. Composer (pre-ingestion, browser) ─────────────────────── */
console.log("① COMPOSER (pre-ingestion — two Haiku auto-fills, see [classify-debug] in devtools)");
console.log("   auto-classify (on paste):  → title, sourceType, tags        [LLM]");
console.log("   auto-generate (on paste):  → citation, about-facets         [LLM, pristine-guarded]");
console.log("   provenance strip:          derived display only — nothing stored\n");

/* ── 2. What the POST persists (deterministic — real code path) ── */
const composerPayload = {
  tags: ["shakespeare", "biography"],
  citation: {}, // what Haiku finds for this doc — run the composer to see; often empty for unattributed reports
  facets: {},
};
const stored = buildStoredSourceMetadata(
  deriveKindFromSourceType(sourceType),
  composerPayload,
  { sourceType },
);
const classify = readClassifyMetadata({ metadata: stored });
console.log("② PERSISTED classify block (wiki_sources.metadata.classify):");
console.log("   provenance:", JSON.stringify(classify.provenance));
console.log("   identityKey:", citationIdentityKey(
  classify.provenance.ingestionType === "source" ? classify.provenance.citation ?? {} : {},
) ?? "(null — citation too thin: dedup/hydration joins unavailable for this source)");
console.log("   tags:", JSON.stringify(classify.tags), "\n");

/* ── 3. What the PLANNER consumes ─────────────────────────────── */
console.log("③ PLANNER input (the ONLY per-source metadata the planner sees):");
console.log(`   Title: <your title>`);
console.log(`   Source type: ${sourceType}`);
console.log(`   Tags: ${composerPayload.tags.join(", ")}`);
console.log("   + the content itself (post-survey exclusions). Citation/facets: NOT consumed.\n");

/* ── 4. What ingest-time SURVEY adds (content-derived, no composer input) ── */
const apparatus = extractMarkerApparatus(content);
const bodyMarkers = new Set(content.match(/\[\d{1,3}\]/g) ?? []);
console.log("④ SURVEY at ingest (reads CONTENT ONLY — none of the composer metadata):");
console.log(`   inline markers in document: ${bodyMarkers.size} distinct`);
console.log(`   mechanical apparatus (numbered reference list): ${apparatus.size} markers → works`);
console.log("   + LLM pass: anatomy (direct|citing|mixed), bibliography of CITED works,");
console.log("     exclude-sections — each cited work becomes a stub with ITS OWN citation.\n");

/* ── 5. Consumption table ─────────────────────────────────────── */
console.log("⑤ WHO USES WHAT");
console.log("   field        │ consumed by");
console.log("   ─────────────┼──────────────────────────────────────────────");
console.log("   title        │ planner prompt · UI");
console.log("   sourceType   │ planner prompt · tier buckets · trust readout");
console.log("   tags         │ planner prompt · browse");
console.log("   citation     │ identity joins (dedup/attribution/hydration) · display — NOT planner");
console.log("   facets       │ Sources-library filters — NOT planner");
console.log("   content      │ planner · writer · survey · embeddings (everything)");
