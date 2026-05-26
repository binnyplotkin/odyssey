/**
 * Load an eval suite from the DB and shape it into the runtime `ProbeSuite`
 * the runner expects. Lets the API routes treat suites as data (versioned,
 * mutable through `createSuite`) rather than hard-coded TS imports.
 *
 * The TS suite definitions in `evals/<character>/suite.ts` are the AUTHORING
 * surface; running the seed script writes them into `eval_suites` and the
 * runner reads from there. This helper centralizes that read.
 */

import { getEvalStore, type EvalSuiteRecord } from "@odyssey/db";
import type { Probe, ProbeSuite } from "@odyssey/evals";

/**
 * Fetch the latest published version of a suite by slug, return it as a
 * `ProbeSuite`. Returns null if no suite is published — the caller should
 * surface a friendly "run the seed script" error.
 */
export async function loadLatestSuite(
  characterId: string,
  slug: string,
): Promise<ProbeSuite | null> {
  const row = await getEvalStore().getLatestSuiteBySlug(characterId, slug);
  if (!row) return null;
  return suiteRecordToProbeSuite(row);
}

/**
 * Fetch a specific suite by id (e.g. the historical version a re-run was
 * originally judged against). Same shape; useful for reproducibility.
 */
export async function loadSuiteById(suiteId: string): Promise<ProbeSuite | null> {
  const row = await getEvalStore().getSuite(suiteId);
  if (!row) return null;
  return suiteRecordToProbeSuite(row);
}

function suiteRecordToProbeSuite(row: EvalSuiteRecord): ProbeSuite {
  return {
    id: row.slug,
    version: row.version,
    label: row.notes ?? undefined,
    // The probes column is jsonb; trust the seed script wrote them in the
    // Probe[] shape. The runner does its own validation when probes don't
    // parse, so an off-spec row will surface a clean error later.
    probes: row.probes as Probe[],
  };
}
