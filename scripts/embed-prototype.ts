/**
 * Move 01 gate — validate a self-hosted embedder before any migration.
 *
 * Head-to-head on Abraham's knowledge graph: embed every page + the
 * context-activation gold queries with BOTH bge-small (local, transformers.js)
 * and OpenAI text-embedding-3-small (the current model), then compare
 * recall@K against the gold expected page slugs, plus per-embed speed.
 *
 * No production changes: embeds everything fresh in-process. If bge-small
 * holds recall near OpenAI, we proceed to the schema migration + backfill.
 *
 *   npm i --no-save @huggingface/transformers
 *   npx tsx scripts/embed-prototype.ts
 */
import * as dotenv from "dotenv";
dotenv.config({ override: true, quiet: true });

import {
  getCharacterStore,
  getWikisStore,
  getWikiStore,
  wikiEmbeddingSource,
  type WikiPageRecord,
} from "@odyssey/db";
import { embedText, embedTexts } from "@odyssey/engine";
import { SUITES } from "@odyssey/sonar";
import { pipeline } from "@huggingface/transformers";

const K = 5;
const BGE_MODEL = "Xenova/bge-small-en-v1.5";
const BGE_QUERY_PREFIX = "Represent this sentence for searching relevant passages: ";

function normalize(v: number[]): number[] {
  let s = 0;
  for (const x of v) s += x * x;
  const m = Math.sqrt(s) || 1;
  return v.map((x) => x / m);
}
const dot = (a: number[], b: number[]) => a.reduce((s, x, i) => s + x * b[i], 0);

function pageText(p: WikiPageRecord): string {
  try {
    const t = wikiEmbeddingSource(p as never);
    if (typeof t === "string" && t.trim()) return t;
  } catch {
    /* fall through */
  }
  return `${p.title ?? p.slug}`;
}

(async () => {
  const ch = await getCharacterStore().getBySlug("abraham");
  if (!ch) throw new Error("character 'abraham' not found");
  const wikis = (await getWikisStore().listWikisForCharacter(ch.id)).filter((w) => w.binding.isActive);
  const pages = (await Promise.all(wikis.map((w) => getWikiStore().listPagesForWiki(w.id)))).flat();
  const slugs = pages.map((p) => p.slug);
  const texts = pages.map(pageText);
  console.log(`abraham · ${pages.length} pages across ${wikis.length} active wiki(s)`);

  // ── bge-small (local) ──
  const tLoad = performance.now();
  const extractor = await pipeline("feature-extraction", BGE_MODEL);
  console.log(`bge-small loaded in ${Math.round(performance.now() - tLoad)}ms`);
  const bge = async (text: string, isQuery = false): Promise<number[]> => {
    const out = await extractor((isQuery ? BGE_QUERY_PREFIX : "") + text, { pooling: "cls", normalize: true });
    return Array.from(out.data as Float32Array);
  };
  const tBge = performance.now();
  const bgePages: number[][] = [];
  for (const tx of texts) bgePages.push(await bge(tx));
  const bgeMsPer = (performance.now() - tBge) / Math.max(1, texts.length);
  console.log(`bge-small embedded ${texts.length} pages · ${bgeMsPer.toFixed(0)}ms/page · dim=${bgePages[0]?.length}`);

  // ── OpenAI text-embedding-3-small (current) ──
  const tOa = performance.now();
  const oaPages = (await embedTexts(texts)).map((v) => (v ? normalize(v) : []));
  console.log(`openai embedded ${texts.length} pages in ${Math.round(performance.now() - tOa)}ms (batched) · dim=${oaPages.find((v) => v.length)?.length}`);

  const topSlugs = (q: number[], pageVecs: number[][]): string[] =>
    slugs
      .map((s, j) => ({ s: s.toLowerCase(), sim: pageVecs[j]?.length ? dot(q, pageVecs[j]) : -1 }))
      .sort((a, b) => b.sim - a.sim)
      .slice(0, K)
      .map((x) => x.s);

  const suite = SUITES["context-activation-baseline"];
  const gold = suite.contextActivation?.turns ?? [];
  const bgeRecalls: number[] = [];
  const oaRecalls: number[] = [];
  console.log(`\nquery                                                bge@${K}   oa@${K}`);
  for (let i = 0; i < suite.turns.length; i++) {
    const want = gold[i]?.expectedPageSlugs?.map((s) => s.toLowerCase());
    if (!want?.length) continue;
    const turn = suite.turns[i];
    const q = typeof turn === "string" ? turn : "parts" in turn ? turn.parts.join(" ") : "";
    const wantSet = new Set(want);
    const bgeTop = topSlugs(await bge(q, true), bgePages);
    const oaTop = topSlugs(normalize((await embedText(q)) ?? []), oaPages);
    const bgeRec = [...wantSet].filter((s) => bgeTop.includes(s)).length / wantSet.size;
    const oaRec = [...wantSet].filter((s) => oaTop.includes(s)).length / wantSet.size;
    bgeRecalls.push(bgeRec);
    oaRecalls.push(oaRec);
    console.log(`${q.slice(0, 50).padEnd(52)} ${(bgeRec * 100).toFixed(0).padStart(4)}%  ${(oaRec * 100).toFixed(0).padStart(4)}%`);
  }
  const avg = (a: number[]) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : 0);
  console.log(`\n── recall@${K} ── bge-small ${(avg(bgeRecalls) * 100).toFixed(1)}%  vs  openai ${(avg(oaRecalls) * 100).toFixed(1)}%`);
  console.log(`── speed   ── bge-small ~${bgeMsPer.toFixed(0)}ms/embed (local, CPU)  vs  openai ~400ms warm / ~3800ms cold (API)`);
  console.log(`\nverdict: ${avg(bgeRecalls) >= avg(oaRecalls) - 0.05 ? "bge-small holds recall — proceed to migration" : "bge-small drops recall — try gte-small/nomic or stay hosted"}`);
  process.exit(0);
})();
