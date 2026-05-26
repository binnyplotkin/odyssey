/**
 * Bootstrap the eval-harness tables.
 *
 * Five tables: suites (versioned probe definitions), runs (single-config
 * executions), probe_results (per-probe drill-down), sweeps (parameter
 * grids), with eval_runs.sweep_id linking runs back to their parent sweep.
 *
 * See docs/eval-schema.mdx for the full design. Schema definitions live
 * in packages/db/src/schema.ts; this script is the matching DDL that
 * actually creates them in Neon.
 *
 * Usage:
 *   npx tsx scripts/create-eval-tables.ts
 *
 * Safe to re-run — every statement is CREATE IF NOT EXISTS / CREATE INDEX
 * IF NOT EXISTS. Doesn't touch existing data.
 */

import "dotenv/config";
import { neon } from "@neondatabase/serverless";

const DDL = [
  // ── eval_suites ─────────────────────────────────────────
  `CREATE TABLE IF NOT EXISTS eval_suites (
    id            text PRIMARY KEY,
    character_id  text NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
    slug          text NOT NULL,
    version       text NOT NULL,
    probes        jsonb NOT NULL DEFAULT '[]'::jsonb,
    notes         text,
    created_at    timestamptz NOT NULL DEFAULT now(),
    created_by    text REFERENCES users(id) ON DELETE SET NULL
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS eval_suites_slug_version_idx
     ON eval_suites (character_id, slug, version)`,
  `CREATE INDEX IF NOT EXISTS eval_suites_character_idx
     ON eval_suites (character_id)`,

  // ── eval_sweeps ─────────────────────────────────────────
  // Created BEFORE eval_runs so the eval_runs.sweep_id FK can resolve.
  `CREATE TABLE IF NOT EXISTS eval_sweeps (
    id              text PRIMARY KEY,
    character_id    text NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
    suite_id        text NOT NULL REFERENCES eval_suites(id) ON DELETE RESTRICT,
    judge_model     text NOT NULL,
    spec            jsonb NOT NULL,
    probe_ids       jsonb,
    max_concurrency integer,
    configs         jsonb NOT NULL,
    rankings        jsonb NOT NULL,
    pareto          jsonb NOT NULL,
    started_at      timestamptz NOT NULL,
    completed_at    timestamptz NOT NULL,
    created_by      text REFERENCES users(id) ON DELETE SET NULL
  )`,
  `CREATE INDEX IF NOT EXISTS eval_sweeps_char_started_idx
     ON eval_sweeps (character_id, started_at)`,

  // ── eval_runs ───────────────────────────────────────────
  `CREATE TABLE IF NOT EXISTS eval_runs (
    id                       text PRIMARY KEY,
    character_id             text NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
    suite_id                 text NOT NULL REFERENCES eval_suites(id) ON DELETE RESTRICT,
    character_snapshot       jsonb NOT NULL,
    config_hash              text NOT NULL,
    override_config          jsonb,
    effective_model_config   jsonb NOT NULL,
    judge_model              text NOT NULL,
    source                   text NOT NULL DEFAULT 'single',
    sweep_id                 text REFERENCES eval_sweeps(id) ON DELETE SET NULL,
    total                    integer NOT NULL,
    passed                   integer NOT NULL,
    failed                   integer NOT NULL,
    errored                  integer NOT NULL,
    avg_overall              real NOT NULL,
    avg_latency_ms           integer NOT NULL,
    total_tokens             integer NOT NULL,
    estimated_cost_usd       real NOT NULL,
    started_at               timestamptz NOT NULL,
    completed_at             timestamptz NOT NULL,
    created_by               text REFERENCES users(id) ON DELETE SET NULL
  )`,
  `CREATE INDEX IF NOT EXISTS eval_runs_char_started_idx
     ON eval_runs (character_id, started_at)`,
  `CREATE INDEX IF NOT EXISTS eval_runs_config_hash_idx
     ON eval_runs (character_id, config_hash)`,
  `CREATE INDEX IF NOT EXISTS eval_runs_sweep_idx
     ON eval_runs (sweep_id)`,

  // ── eval_probe_results ──────────────────────────────────
  `CREATE TABLE IF NOT EXISTS eval_probe_results (
    id                    text PRIMARY KEY,
    run_id                text NOT NULL REFERENCES eval_runs(id) ON DELETE CASCADE,
    probe_id              text NOT NULL,
    probe_category        text NOT NULL,
    input                 text NOT NULL,
    response              text NOT NULL,
    scores                jsonb NOT NULL,
    overall               real NOT NULL,
    pass                  boolean NOT NULL,
    rationale             text NOT NULL,
    mechanical_failures   jsonb NOT NULL DEFAULT '[]'::jsonb,
    errors                jsonb NOT NULL DEFAULT '[]'::jsonb,
    latency_ms            integer NOT NULL,
    tokens                jsonb NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS eval_probe_results_run_idx
     ON eval_probe_results (run_id)`,
  `CREATE INDEX IF NOT EXISTS eval_probe_results_probe_idx
     ON eval_probe_results (probe_id, run_id)`,
];

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("DATABASE_URL is required");
    process.exit(1);
  }

  const sql = neon(url);

  for (const stmt of DDL) {
    const head = stmt.split("\n")[0].trim();
    process.stdout.write(`  ${head.slice(0, 76)}${head.length > 76 ? "…" : ""} … `);
    try {
      await sql.query(stmt);
      console.log("ok");
    } catch (err: unknown) {
      console.log("FAIL");
      console.error(err instanceof Error ? err.message : err);
      process.exit(1);
    }
  }

  console.log(`\nDone. ${DDL.length} DDL statements executed.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
