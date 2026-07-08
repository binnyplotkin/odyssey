/**
 * Nested provenance P1 — eval golden set (docs/nested-provenance-spec.md, step 5).
 *
 * Gates the `survey` flag's default-on decision:
 *   1. survey/shakespeare  — anatomy=citing, bibliography recall ≥0.9 over the
 *      expected-works list, ≥95% identifiable citations, exclusions resolve.
 *   2. survey/direct       — a plain scripture source stays anatomy=direct, 0 bib.
 *   3. survey/commentary   — hand-authored fixture with an exactly-known
 *      5-work bibliography: 5/5 recall, exact markers.
 *   4. marker-retention    — planner passages from marker-dense prose retain
 *      ≥95% of adjacent markers (spec gate), locatable fraction ≥0.8.
 *   5. e2e (--e2e)         — full runIngestion({survey:true}) of the report on
 *      a SCRATCH wiki: stubs/edges/pages counts + ≥80% attribution on
 *      marker-bearing refs. Deleted (cascade) afterwards. Costs real tokens.
 *
 * Usage:
 *   npx tsx scripts/eval-nested-provenance.ts            # cases 1-4 (~4 LLM calls)
 *   npx tsx scripts/eval-nested-provenance.ts --e2e      # + full ingest (expensive)
 *   npx tsx scripts/eval-nested-provenance.ts --only=commentary
 */

import "dotenv/config";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { neon } from "@neondatabase/serverless";
import { getWikiStore, getWikisStore, citationIdentityKey } from "@odyssey/db";
import {
  survey,
  resolveExcludeRanges,
  runIngestion,
  resolveModel,
  type SurveyResult,
  type IngestionEvent,
} from "@odyssey/wiki-ingest";
import { planChunked } from "/Users/binnyplotkin/Documents/odyssey/packages/wiki-ingest/src/pipeline";

const FIXTURES = join(
  process.cwd(),
  "packages/wiki-ingest/evals/fixtures",
);
const golden = JSON.parse(readFileSync(join(FIXTURES, "golden.json"), "utf8"));
const MODEL = resolveModel("claude-sonnet-4-5");
const E2E = process.argv.includes("--e2e");
const ONLY = process.argv.find((a) => a.startsWith("--only="))?.slice(7);

type Check = { name: string; gate: string; value: string; pass: boolean };
const checks: Check[] = [];
let totalTokens = 0;

function record(name: string, gate: string, value: string | number | boolean, pass: boolean) {
  checks.push({ name, gate, value: String(value), pass });
  console.log(`  ${pass ? "✓" : "✗"} ${gate} → ${value}`);
}

function fixture(file: string): string {
  return readFileSync(join(FIXTURES, file), "utf8");
}

function norm(s: string): string {
  return s.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, " ").trim();
}

function bibMatches(sv: SurveyResult, needle: string): SurveyResult["bibliography"] {
  const n = norm(needle);
  return sv.bibliography.filter(
    (b) => norm(b.citation.title ?? "").includes(n) || norm(b.rawCitation).includes(n),
  );
}

/* ── Case 1: survey / shakespeare ──────────────────────────────── */
async function caseShakespeare() {
  console.log("\n■ survey/shakespeare");
  const g = golden.shakespeare;
  const text = fixture(g.file);
  const sv = await survey({ model: MODEL, source: { title: "William Shakespeare — research report", content: text } });
  totalTokens += sv.tokens;

  record("shakespeare", "anatomy = citing", sv.anatomy, sv.anatomy === g.anatomy);
  record("shakespeare", `bibliography ≥ ${g.minBibliography}`, sv.bibliography.length, sv.bibliography.length >= g.minBibliography);

  const found = g.expectedWorks.filter((w: string) => bibMatches(sv, w).length > 0);
  const recall = found.length / g.expectedWorks.length;
  record("shakespeare", "expected-works recall ≥ 0.9", `${found.length}/${g.expectedWorks.length} (${recall.toFixed(2)})`, recall >= 0.9);

  const primaryOk = g.expectedPrimaryWorks.filter((w: string) =>
    bibMatches(sv, w).some((b) => b.sourceType === "primary"),
  );
  record("shakespeare", "primary tiering (≥2/3 known-primary works)", `${primaryOk.length}/${g.expectedPrimaryWorks.length}`, primaryOk.length >= 2);

  const identifiable = sv.bibliography.filter((b) => citationIdentityKey(b.citation) != null).length;
  const idFrac = sv.bibliography.length ? identifiable / sv.bibliography.length : 1;
  record("shakespeare", "identifiable citations ≥ 0.95", `${identifiable}/${sv.bibliography.length} (${idFrac.toFixed(2)})`, idFrac >= 0.95);

  const ranges = resolveExcludeRanges(text, sv.excludeSections);
  const excluded = ranges.reduce((a, r) => a + (r.end - r.start), 0);
  record("shakespeare", `exclusions resolve (≥${g.excludeMinResolved} range, ≥${g.excludeMinChars} chars)`, `${ranges.length} ranges · ${excluded} chars`, ranges.length >= g.excludeMinResolved && excluded >= g.excludeMinChars);
}

/* ── Case 2: survey / direct ───────────────────────────────────── */
async function caseDirect() {
  console.log("\n■ survey/direct (Genesis scripture)");
  const g = golden.genesisDirect;
  const sv = await survey({ model: MODEL, source: { title: "Genesis 11:27 — 12:20 · Abram leaves Haran", content: fixture(g.file) } });
  totalTokens += sv.tokens;
  record("direct", "anatomy = direct", sv.anatomy, sv.anatomy === g.anatomy);
  record("direct", "bibliography = 0", sv.bibliography.length, sv.bibliography.length <= g.maxBibliography);
}

/* ── Case 3: survey / commentary ───────────────────────────────── */
async function caseCommentary() {
  console.log("\n■ survey/commentary (hand-authored, 5 known works)");
  const g = golden.commentary;
  const sv = await survey({ model: MODEL, source: { title: "Reading the Call of Abram: Notes on Genesis 12", content: fixture(g.file) } });
  totalTokens += sv.tokens;

  record("commentary", "anatomy citing|mixed", sv.anatomy, g.anatomy.includes(sv.anatomy));
  let hit = 0;
  for (const exp of g.expectedWorks) {
    const m = sv.bibliography.find(
      (b) =>
        (norm(b.citation.title ?? b.rawCitation).includes(norm(exp.title)) ||
          norm(b.rawCitation).includes(norm(exp.author))) &&
        b.markers.includes(exp.marker),
    );
    if (m) hit += 1;
    else console.log(`    missing: ${exp.marker} ${exp.author}`);
  }
  record("commentary", "5/5 works with exact markers", `${hit}/5`, hit === 5);
}

/* ── Case 4: marker retention (planner) ────────────────────────── */
async function caseMarkerRetention() {
  console.log("\n■ marker-retention (planner passages)");
  const g = golden.markerRetention;
  const text = fixture(g.file).slice(g.window.start, g.window.start + g.window.chars);
  const opPlan = await planChunked({
    model: MODEL,
    characterDomainPrompt: null,
    wikiContext: null,
    source: { title: "Shakespeare report (excerpt)", sourceType: "tertiary", tags: [], content: text },
    existingPages: [],
  });
  totalTokens += opPlan.tokens;

  const passages = opPlan.ops.flatMap((o) => o.sourcePassages ?? []);
  // Fold BOTH sides before matching: docx fixtures carry mid-sentence line
  // breaks (models flatten to spaces) and typographic quotes/dashes (models
  // emit ASCII). Verbatim-modulo-typography still counts as located.
  const fold = (s: string) =>
    s
      .replace(/[‘’]/g, "'")
      .replace(/[“”]/g, '"')
      .replace(/[–—]/g, "-")
      .replace(/\s+/g, " ")
      .trim();
  const flatText = fold(text);
  let locatable = 0;
  let expected = 0;
  let retained = 0;
  for (const p of passages) {
    const flatPassage = fold(p);
    const at = flatText.indexOf(flatPassage.slice(0, 80));
    if (at === -1) continue;
    locatable += 1;
    const span = flatText.slice(at, at + flatPassage.length + 40);
    const expectedMarkers = span.match(/\[\d{1,3}\]/g) ?? [];
    const retainedMarkers = (flatPassage.match(/\[\d{1,3}\]/g) ?? []).filter((m) => expectedMarkers.includes(m));
    expected += expectedMarkers.length;
    retained += retainedMarkers.length;
  }
  const locFrac = passages.length ? locatable / passages.length : 0;
  const rate = expected > 0 ? retained / expected : 1;
  record("markers", "locatable passages ≥ 0.8", `${locatable}/${passages.length} (${locFrac.toFixed(2)})`, locFrac >= 0.8);
  record("markers", `retention ≥ ${g.gate}`, `${retained}/${expected} (${rate.toFixed(2)})`, rate >= g.gate);
}

/* ── Case 5: end-to-end (opt-in) ───────────────────────────────── */
async function caseE2E() {
  console.log("\n■ e2e — full survey ingest on a scratch wiki (expensive)");
  const g = golden.e2e;
  const sql = neon(process.env.DATABASE_URL!);
  const wikis = getWikisStore();
  const store = getWikiStore();

  const scratch = await wikis.createWiki({
    slug: `eval-nested-prov-${Date.now().toString(36)}`,
    title: "EVAL SCRATCH — nested provenance",
    summary: "Temporary wiki created by eval-nested-provenance.ts; safe to delete.",
    eras: [],
  });
  console.log(`  scratch wiki: ${scratch.id}`);

  try {
    const source = await store.createSource({
      wikiId: scratch.id,
      title: "William Shakespeare — research report",
      sourceType: "tertiary",
      content: fixture(g.file),
      metadata: { tags: ["shakespeare", "eval"] },
    });

    const events: IngestionEvent[] = [];
    for await (const ev of runIngestion({
      wikiId: scratch.id,
      sourceId: source.id,
      model: "claude-sonnet-4-5",
      survey: true,
      writerConcurrency: 6,
    })) {
      events.push(ev);
      if (ev.type === "survey-complete") console.log(`  survey: ${ev.anatomy} · ${ev.stubsOrMatches}/${ev.citedWorks} works · ${ev.markersMapped ?? "?"} markers mapped · ${ev.excludedSections} excl`);
      if (ev.type === "plan-complete") console.log(`  plan: ${ev.opCount} ops`);
      if (ev.type === "op-failed") console.log(`  op-failed: ${ev.op.slug} · ${ev.error}`);
      if (ev.type === "succeeded") console.log("  run succeeded");
      if (ev.type === "failed") console.log(`  run FAILED: ${ev.error}`);
    }

    const succeeded = events.some((e) => e.type === "succeeded");
    record("e2e", "run succeeded", succeeded, succeeded);
    const surveyEv = events.find((e) => e.type === "survey-complete");
    record("e2e", "anatomy = citing", surveyEv && "anatomy" in surveyEv ? surveyEv.anatomy : "(none)", !!surveyEv && (surveyEv as { anatomy: string }).anatomy === "citing");

    const [stubs] = (await sql.query(
      "SELECT count(*)::int AS n FROM wiki_sources WHERE wiki_id = $1 AND content IS NULL", [scratch.id],
    )) as Array<{ n: number }>;
    record("e2e", `stubs ≥ ${g.minStubs}`, stubs.n, stubs.n >= g.minStubs);

    const [edges] = (await sql.query(
      "SELECT count(*)::int AS n FROM wiki_source_citations WHERE carrier_id = $1", [source.id],
    )) as Array<{ n: number }>;
    record("e2e", `citation edges ≥ ${g.minCitationEdges}`, edges.n, edges.n >= g.minCitationEdges);

    const pages = await store.listPagesForWiki(scratch.id);
    record("e2e", `pages > ${g.minPages}`, pages.length, pages.length > g.minPages);

    // Attribution: refs whose quote/passage carries a marker must resolve to
    // the SAME cited source the citation edge maps that marker to.
    const markerToCited = new Map<string, string>();
    const edgeRows = (await sql.query(
      "SELECT marker, cited_id FROM wiki_source_citations WHERE carrier_id = $1 AND marker IS NOT NULL", [source.id],
    )) as Array<{ marker: string; cited_id: string }>;
    for (const e of edgeRows) markerToCited.set(e.marker, e.cited_id);

    const refs = await store.listSourceRefsForWiki(scratch.id);
    const markerRefs = refs.filter((r) => /\[\d{1,3}\]/.test(`${r.passage ?? ""} ${r.quote ?? ""}`));
    const correct = markerRefs.filter((r) => {
      const markers = `${r.passage ?? ""} ${r.quote ?? ""}`.match(/\[\d{1,3}\]/g) ?? [];
      return markers.some((m) => markerToCited.get(m) === r.attributedSourceId);
    });
    const frac = markerRefs.length ? correct.length / markerRefs.length : 0;
    record("e2e", `attribution on marker-bearing refs ≥ ${g.attributionGate}`, `${correct.length}/${markerRefs.length} (${frac.toFixed(2)})`, frac >= g.attributionGate || markerRefs.length === 0);
    if (markerRefs.length === 0) {
      record("e2e", "marker-bearing refs exist (writer preserved markers)", 0, false);
    }
  } finally {
    await sql.query("DELETE FROM wikis WHERE id = $1", [scratch.id]);
    console.log("  scratch wiki deleted (cascade)");
  }
}

/* ── Runner ─────────────────────────────────────────────────────── */

// Diagnostics for silent mid-run deaths: a drained event loop exits 0 with no
// error (dangling promise); the heartbeat keeps the loop alive and timestamps
// progress, and the handlers surface anything swallowed.
const heartbeat = setInterval(
  () => console.log(`  [hb] ${new Date().toISOString()}`),
  20_000,
);
process.on("unhandledRejection", (reason) => {
  console.error("UNHANDLED REJECTION:", reason);
  process.exit(3);
});
process.on("uncaughtException", (err) => {
  console.error("UNCAUGHT EXCEPTION:", err);
  process.exit(4);
});
process.on("beforeExit", (code) => {
  console.log(`[beforeExit] event loop drained (code ${code})`);
});

async function main() {
  const cases: Array<[string, () => Promise<void>]> = [
    ["shakespeare", caseShakespeare],
    ["direct", caseDirect],
    ["commentary", caseCommentary],
    ["markers", caseMarkerRetention],
  ];
  if (E2E) cases.push(["e2e", caseE2E]);

  for (const [name, fn] of cases) {
    if (ONLY && name !== ONLY) continue;
    await fn();
  }

  const failed = checks.filter((c) => !c.pass);
  console.log(`\n═══ scorecard ═══`);
  console.log(`${checks.length - failed.length}/${checks.length} gates passed · ~${totalTokens.toLocaleString()} tokens (survey/planner cases)`);
  for (const f of failed) console.log(`  FAIL [${f.name}] ${f.gate} → ${f.value}`);
  if (failed.length > 0) process.exit(1);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => clearInterval(heartbeat));
