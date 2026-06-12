/**
 * Bootstrap the Scenes stack (scenes + scene_nodes + scene_edges
 * + scene_sessions + scene_session_turns + scene_session_events
 * + scene_session_context_builds + scene_session_audio_artifacts).
 *
 * This is the additive new stack that replaces the legacy `worlds`
 * domain. Scenes are the unit the orchestrator drives — a graph of
 * typed nodes (characters/places/events/narrator) plus opening beat,
 * default ambience, and a narrator voice binding. The `definition`
 * JSONB is forward-compatible with a future node-based canvas editor.
 *
 * Usage:
 *   npx tsx scripts/create-scene-tables.ts
 *
 * Safe to re-run — every statement is CREATE IF NOT EXISTS / CREATE
 * INDEX IF NOT EXISTS. No backfill — the new stack starts empty.
 */

import "dotenv/config";
import { neon } from "@neondatabase/serverless";

const DDL = [
  /* ── scenes ─────────────────────────────────────────────────────
   * Top-level scene row. `definition` JSONB carries:
   *   { nodes, edges, openingBeat, defaultAmbience, narratorVoiceId }
   */
  `CREATE TABLE IF NOT EXISTS scenes (
    id          text PRIMARY KEY,
    user_id     text REFERENCES users(id) ON DELETE CASCADE,
    title       text NOT NULL,
    prompt      text NOT NULL DEFAULT '',
    status      text NOT NULL DEFAULT 'draft',
    definition  jsonb NOT NULL DEFAULT '{}'::jsonb,
    version     integer NOT NULL DEFAULT 1,
    created_at  timestamptz NOT NULL DEFAULT now(),
    updated_at  timestamptz NOT NULL DEFAULT now()
  )`,
  `CREATE INDEX IF NOT EXISTS scenes_user_idx    ON scenes (user_id)`,
  `CREATE INDEX IF NOT EXISTS scenes_status_idx  ON scenes (status)`,

  /* ── scene_nodes ──────────────────────────────────────────────── */
  `CREATE TABLE IF NOT EXISTS scene_nodes (
    id          text PRIMARY KEY,
    scene_id    text NOT NULL REFERENCES scenes(id) ON DELETE CASCADE,
    kind        text NOT NULL,
    ref_id      text,
    label       text NOT NULL,
    summary     text,
    data        jsonb NOT NULL DEFAULT '{}'::jsonb,
    position    jsonb,
    created_at  timestamptz NOT NULL DEFAULT now(),
    updated_at  timestamptz NOT NULL DEFAULT now()
  )`,
  `CREATE INDEX IF NOT EXISTS scene_nodes_scene_idx       ON scene_nodes (scene_id)`,
  `CREATE INDEX IF NOT EXISTS scene_nodes_scene_kind_idx  ON scene_nodes (scene_id, kind)`,
  `CREATE INDEX IF NOT EXISTS scene_nodes_ref_idx         ON scene_nodes (ref_id)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS scene_nodes_scene_ref_uniq
     ON scene_nodes (scene_id, kind, ref_id)
     WHERE ref_id IS NOT NULL`,

  /* ── scene_edges ──────────────────────────────────────────────── */
  `CREATE TABLE IF NOT EXISTS scene_edges (
    id            text PRIMARY KEY,
    scene_id      text NOT NULL REFERENCES scenes(id)       ON DELETE CASCADE,
    from_node_id  text NOT NULL REFERENCES scene_nodes(id)  ON DELETE CASCADE,
    to_node_id    text NOT NULL REFERENCES scene_nodes(id)  ON DELETE CASCADE,
    kind          text NOT NULL,
    data          jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at    timestamptz NOT NULL DEFAULT now()
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS scene_edges_unique_idx
     ON scene_edges (from_node_id, to_node_id, kind)`,
  `CREATE INDEX IF NOT EXISTS scene_edges_scene_idx    ON scene_edges (scene_id)`,
  `CREATE INDEX IF NOT EXISTS scene_edges_to_node_idx  ON scene_edges (to_node_id)`,

  /* ── scene_sessions ─────────────────────────────────────────────
   * One row per live or completed scene session. `current_scene` is the
   * SceneSessionSnapshot JSON the orchestrator persists between turns.
   */
  `CREATE TABLE IF NOT EXISTS scene_sessions (
    id              text PRIMARY KEY,
    user_id         text REFERENCES users(id)       ON DELETE SET NULL,
    scene_id        text REFERENCES scenes(id)      ON DELETE SET NULL,
    character_id    text REFERENCES characters(id)  ON DELETE SET NULL,
    mode            text NOT NULL,
    status          text NOT NULL DEFAULT 'active',
    initial_scene   jsonb,
    current_scene   jsonb,
    metadata        jsonb NOT NULL DEFAULT '{}'::jsonb,
    started_at      timestamptz NOT NULL DEFAULT now(),
    ended_at        timestamptz,
    last_active_at  timestamptz NOT NULL DEFAULT now()
  )`,
  `CREATE INDEX IF NOT EXISTS scene_sessions_user_idx        ON scene_sessions (user_id)`,
  `CREATE INDEX IF NOT EXISTS scene_sessions_character_idx   ON scene_sessions (character_id)`,
  `CREATE INDEX IF NOT EXISTS scene_sessions_scene_idx       ON scene_sessions (scene_id)`,
  `CREATE INDEX IF NOT EXISTS scene_sessions_last_active_idx ON scene_sessions (last_active_at)`,

  /* ── scene_session_context_builds ───────────────────────────────
   * One row per prompt-planning call (curator + orchestration).
   */
  `CREATE TABLE IF NOT EXISTS scene_session_context_builds (
    id              text PRIMARY KEY,
    session_id      text NOT NULL REFERENCES scene_sessions(id) ON DELETE CASCADE,
    turn_id         text,
    mode            text NOT NULL,
    prompt_kind     text NOT NULL,
    query           text,
    scene           jsonb,
    token_budget    integer,
    tokens_used     integer,
    tokens_budget   integer,
    selected_pages  jsonb NOT NULL DEFAULT '[]'::jsonb,
    curator_trace   jsonb NOT NULL DEFAULT '{}'::jsonb,
    timing_trace    jsonb NOT NULL DEFAULT '{}'::jsonb,
    prompt_chunk    text,
    system_prompt   text,
    metadata        jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at      timestamptz NOT NULL DEFAULT now()
  )`,
  `CREATE INDEX IF NOT EXISTS scene_session_context_session_idx ON scene_session_context_builds (session_id)`,
  `CREATE INDEX IF NOT EXISTS scene_session_context_turn_idx    ON scene_session_context_builds (turn_id)`,

  /* ── scene_session_turns ──────────────────────────────────────── */
  `CREATE TABLE IF NOT EXISTS scene_session_turns (
    id                text PRIMARY KEY,
    session_id        text NOT NULL REFERENCES scene_sessions(id) ON DELETE CASCADE,
    turn_index        integer,
    input_mode        text NOT NULL,
    speaker_slug      text,
    user_text         text,
    assistant_text    text,
    provider          text,
    model             text,
    status            text NOT NULL,
    started_at        timestamptz NOT NULL DEFAULT now(),
    completed_at      timestamptz,
    token_usage       jsonb NOT NULL DEFAULT '{}'::jsonb,
    audio_metrics     jsonb NOT NULL DEFAULT '{}'::jsonb,
    latency_summary   jsonb NOT NULL DEFAULT '{}'::jsonb,
    trace             jsonb NOT NULL DEFAULT '{}'::jsonb,
    metadata          jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at        timestamptz NOT NULL DEFAULT now(),
    updated_at        timestamptz NOT NULL DEFAULT now()
  )`,
  `CREATE INDEX IF NOT EXISTS scene_session_turns_session_idx ON scene_session_turns (session_id)`,
  `CREATE INDEX IF NOT EXISTS scene_session_turns_status_idx  ON scene_session_turns (status)`,

  /* ── scene_session_events ─────────────────────────────────────── */
  `CREATE TABLE IF NOT EXISTS scene_session_events (
    id          text PRIMARY KEY,
    session_id  text NOT NULL REFERENCES scene_sessions(id) ON DELETE CASCADE,
    turn_id     text,
    type        text NOT NULL,
    source      text NOT NULL,
    payload     jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at  timestamptz NOT NULL DEFAULT now()
  )`,
  `CREATE INDEX IF NOT EXISTS scene_session_events_session_idx ON scene_session_events (session_id)`,
  `CREATE INDEX IF NOT EXISTS scene_session_events_turn_idx    ON scene_session_events (turn_id)`,
  `CREATE INDEX IF NOT EXISTS scene_session_events_type_idx    ON scene_session_events (type)`,

  /* ── scene_session_audio_artifacts ────────────────────────────── */
  `CREATE TABLE IF NOT EXISTS scene_session_audio_artifacts (
    id                text PRIMARY KEY,
    session_id        text NOT NULL REFERENCES scene_sessions(id) ON DELETE CASCADE,
    turn_id           text,
    direction         text NOT NULL,
    mime_type         text NOT NULL,
    duration_ms       integer,
    sample_rate       integer,
    byte_size         integer NOT NULL,
    storage_key       text NOT NULL,
    waveform_summary  jsonb NOT NULL DEFAULT '{}'::jsonb,
    metadata          jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at        timestamptz NOT NULL DEFAULT now()
  )`,
  `CREATE INDEX IF NOT EXISTS scene_session_audio_session_idx   ON scene_session_audio_artifacts (session_id)`,
  `CREATE INDEX IF NOT EXISTS scene_session_audio_turn_idx      ON scene_session_audio_artifacts (turn_id)`,
  `CREATE INDEX IF NOT EXISTS scene_session_audio_direction_idx ON scene_session_audio_artifacts (direction)`,
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
    process.stdout.write(`  ${head.slice(0, 72)}${head.length > 72 ? "…" : ""} … `);
    try {
      await sql.query(stmt);
      console.log("ok");
    } catch (err: any) {
      console.log("FAIL");
      console.error(err.message ?? err);
      process.exit(1);
    }
  }

  console.log(`\nDone. ${DDL.length} DDL statements executed.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
