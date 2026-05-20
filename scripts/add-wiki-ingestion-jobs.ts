/**
 * Add durable wiki-ingestion job metadata and replayable event rows.
 *
 * Usage:
 *   npx tsx scripts/add-wiki-ingestion-jobs.ts
 */

import "dotenv/config";
import { neon } from "@neondatabase/serverless";

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("DATABASE_URL is required");
    process.exit(1);
  }

  const db = neon(url);
  await db`
    ALTER TABLE wiki_ingestion_log
      ADD COLUMN IF NOT EXISTS worker_id text,
      ADD COLUMN IF NOT EXISTS claimed_at timestamptz,
      ADD COLUMN IF NOT EXISTS heartbeat_at timestamptz
  `;

  await db`
    UPDATE wiki_ingestion_log
    SET heartbeat_at = COALESCE(heartbeat_at, started_at)
    WHERE heartbeat_at IS NULL
      AND status = 'running'
  `;

  await db`
    CREATE TABLE IF NOT EXISTS wiki_ingestion_events (
      id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
      run_id text NOT NULL REFERENCES wiki_ingestion_log(id) ON DELETE CASCADE,
      seq integer NOT NULL,
      type text NOT NULL,
      payload jsonb NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now()
    )
  `;

  await db`
    CREATE UNIQUE INDEX IF NOT EXISTS wiki_ingestion_events_run_seq_idx
    ON wiki_ingestion_events (run_id, seq)
  `;

  await db`
    CREATE INDEX IF NOT EXISTS wiki_ingestion_events_run_idx
    ON wiki_ingestion_events (run_id)
  `;

  await db`
    CREATE INDEX IF NOT EXISTS wiki_ingestion_log_status_started_idx
    ON wiki_ingestion_log (status, started_at)
  `;

  console.log("[add-wiki-ingestion-jobs] durable ingestion schema ready");
}

main().catch((err) => {
  console.error("[add-wiki-ingestion-jobs] failed:", err);
  process.exit(1);
});
