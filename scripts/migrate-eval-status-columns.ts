/**
 * Adds the lifecycle columns to eval_runs + eval_sweeps so the harness UI
 * can launch evals and watch them progress through pending → running →
 * completed (or errored) without blocking on the request.
 *
 * Three column adds + a default for existing rows (everything that already
 * exists is "completed" by definition — it was inserted by the file-write
 * path which only fires on success). Also relaxes the completed_at NOT
 * NULL on eval_runs since pending/running rows don't have it yet.
 *
 * Usage:
 *   npx tsx scripts/migrate-eval-status-columns.ts
 *
 * Idempotent — each ADD COLUMN uses IF NOT EXISTS / catches the duplicate
 * error.
 */

import "dotenv/config";
import { neon } from "@neondatabase/serverless";

const DDL = [
  // eval_runs
  `ALTER TABLE eval_runs ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'completed'`,
  `ALTER TABLE eval_runs ADD COLUMN IF NOT EXISTS error_message text`,
  `ALTER TABLE eval_runs ALTER COLUMN completed_at DROP NOT NULL`,
  // Default summary fields too — pending rows insert with these unset.
  `ALTER TABLE eval_runs ALTER COLUMN total            SET DEFAULT 0`,
  `ALTER TABLE eval_runs ALTER COLUMN passed           SET DEFAULT 0`,
  `ALTER TABLE eval_runs ALTER COLUMN failed           SET DEFAULT 0`,
  `ALTER TABLE eval_runs ALTER COLUMN errored          SET DEFAULT 0`,
  `ALTER TABLE eval_runs ALTER COLUMN avg_overall      SET DEFAULT 0`,
  `ALTER TABLE eval_runs ALTER COLUMN avg_latency_ms   SET DEFAULT 0`,
  `ALTER TABLE eval_runs ALTER COLUMN total_tokens     SET DEFAULT 0`,
  `ALTER TABLE eval_runs ALTER COLUMN estimated_cost_usd SET DEFAULT 0`,

  // eval_sweeps
  `ALTER TABLE eval_sweeps ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'completed'`,
  `ALTER TABLE eval_sweeps ADD COLUMN IF NOT EXISTS error_message text`,
  `ALTER TABLE eval_sweeps ALTER COLUMN completed_at DROP NOT NULL`,

  // Status index — list view filters / orders by status sometimes.
  `CREATE INDEX IF NOT EXISTS eval_runs_status_idx ON eval_runs (character_id, status)`,
  `CREATE INDEX IF NOT EXISTS eval_sweeps_status_idx ON eval_sweeps (character_id, status)`,
];

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("DATABASE_URL is required");
    process.exit(1);
  }

  const sql = neon(url);

  for (const stmt of DDL) {
    const head = stmt.slice(0, 78);
    process.stdout.write(`  ${head}${stmt.length > 78 ? "…" : ""} … `);
    try {
      await sql.query(stmt);
      console.log("ok");
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.log("FAIL");
      console.error(msg);
      process.exit(1);
    }
  }

  console.log(`\nDone. ${DDL.length} DDL statements executed.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
