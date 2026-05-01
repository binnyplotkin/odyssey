/**
 * Bootstrap the global world session observability tables.
 *
 * These tables are deliberately broader than "voice sessions": voice, chat,
 * narrator runs, and future world simulation should all write here so the
 * debugger can answer what context was routed, what the model saw, what
 * happened in the turn, and how long each step took.
 *
 * Usage:
 *   npx tsx scripts/create-world-session-tables.ts
 *
 * Safe to re-run — every statement is CREATE IF NOT EXISTS / CREATE INDEX
 * IF NOT EXISTS.
 */

import "dotenv/config";
import { neon } from "@neondatabase/serverless";

const DDL = [
  `CREATE TABLE IF NOT EXISTS world_sessions (
    id              text PRIMARY KEY,
    user_id         text REFERENCES users(id) ON DELETE SET NULL,
    world_id        text REFERENCES worlds(id) ON DELETE SET NULL,
    character_id    text REFERENCES characters(id) ON DELETE SET NULL,
    mode            text NOT NULL,
    status          text NOT NULL DEFAULT 'active',
    initial_moment  jsonb,
    initial_scene   jsonb,
    current_moment  jsonb,
    current_scene   jsonb,
    metadata        jsonb NOT NULL DEFAULT '{}'::jsonb,
    started_at      timestamptz NOT NULL DEFAULT now(),
    ended_at        timestamptz,
    last_active_at  timestamptz NOT NULL DEFAULT now()
  )`,
  `CREATE INDEX IF NOT EXISTS world_sessions_character_idx    ON world_sessions (character_id)`,
  `CREATE INDEX IF NOT EXISTS world_sessions_world_idx        ON world_sessions (world_id)`,
  `CREATE INDEX IF NOT EXISTS world_sessions_last_active_idx  ON world_sessions (last_active_at)`,

  `CREATE TABLE IF NOT EXISTS world_session_context_builds (
    id             text PRIMARY KEY,
    session_id     text NOT NULL REFERENCES world_sessions(id) ON DELETE CASCADE,
    turn_id        text,
    mode           text NOT NULL,
    prompt_kind    text NOT NULL,
    query          text,
    moment         jsonb,
    scene          jsonb,
    token_budget   integer,
    tokens_used    integer,
    tokens_budget  integer,
    selected_pages jsonb NOT NULL DEFAULT '[]'::jsonb,
    curator_trace  jsonb NOT NULL DEFAULT '{}'::jsonb,
    timing_trace   jsonb NOT NULL DEFAULT '{}'::jsonb,
    prompt_chunk   text,
    system_prompt  text,
    metadata       jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at     timestamptz NOT NULL DEFAULT now()
  )`,
  `CREATE INDEX IF NOT EXISTS world_session_context_session_idx ON world_session_context_builds (session_id)`,
  `CREATE INDEX IF NOT EXISTS world_session_context_turn_idx    ON world_session_context_builds (turn_id)`,

  `CREATE TABLE IF NOT EXISTS world_session_turns (
    id              text PRIMARY KEY,
    session_id      text NOT NULL REFERENCES world_sessions(id) ON DELETE CASCADE,
    turn_index      integer,
    input_mode      text NOT NULL,
    user_text       text,
    assistant_text  text,
    provider        text,
    model           text,
    status          text NOT NULL,
    started_at      timestamptz NOT NULL DEFAULT now(),
    completed_at    timestamptz,
    token_usage     jsonb NOT NULL DEFAULT '{}'::jsonb,
    audio_metrics   jsonb NOT NULL DEFAULT '{}'::jsonb,
    latency_summary jsonb NOT NULL DEFAULT '{}'::jsonb,
    trace           jsonb NOT NULL DEFAULT '{}'::jsonb,
    metadata        jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at      timestamptz NOT NULL DEFAULT now(),
    updated_at      timestamptz NOT NULL DEFAULT now()
  )`,
  `CREATE INDEX IF NOT EXISTS world_session_turns_session_idx ON world_session_turns (session_id)`,
  `CREATE INDEX IF NOT EXISTS world_session_turns_status_idx  ON world_session_turns (status)`,

  `CREATE TABLE IF NOT EXISTS world_session_events (
    id          text PRIMARY KEY,
    session_id  text NOT NULL REFERENCES world_sessions(id) ON DELETE CASCADE,
    turn_id     text,
    type        text NOT NULL,
    source      text NOT NULL,
    payload     jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at  timestamptz NOT NULL DEFAULT now()
  )`,
  `CREATE INDEX IF NOT EXISTS world_session_events_session_idx ON world_session_events (session_id)`,
  `CREATE INDEX IF NOT EXISTS world_session_events_turn_idx    ON world_session_events (turn_id)`,
  `CREATE INDEX IF NOT EXISTS world_session_events_type_idx    ON world_session_events (type)`,
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
