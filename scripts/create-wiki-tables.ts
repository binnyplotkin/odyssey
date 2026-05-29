/**
 * Bootstrap the Character Knowledge Graph tables.
 *
 * Usage:
 *   npx tsx scripts/create-wiki-tables.ts
 *
 * Safe to re-run — every statement is CREATE IF NOT EXISTS / CREATE INDEX IF NOT EXISTS.
 * This is a one-off until we introduce drizzle-kit migrations.
 */

import "dotenv/config";
import { neon } from "@neondatabase/serverless";

const DDL = [
  /* ── characters ─────────────────────────────────────────────── */
  `CREATE TABLE IF NOT EXISTS characters (
    id          text PRIMARY KEY,
    slug        text NOT NULL UNIQUE,
    title       text NOT NULL,
    summary     text,
    image       text,
    eras        jsonb NOT NULL DEFAULT '[]'::jsonb,
    created_at  timestamptz NOT NULL DEFAULT now(),
    updated_at  timestamptz NOT NULL DEFAULT now()
  )`,

  /* ── wiki_pages ─────────────────────────────────────────────── */
  `CREATE TABLE IF NOT EXISTS wiki_pages (
    id               text PRIMARY KEY,
    character_id     text NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
    type             text NOT NULL,
    slug             text NOT NULL,
    title            text NOT NULL,
    summary          text,
    body             text NOT NULL DEFAULT '',
    frontmatter      jsonb NOT NULL DEFAULT '{}'::jsonb,
    perspective      jsonb NOT NULL DEFAULT '{}'::jsonb,
    confidence       real  NOT NULL DEFAULT 0.5,
    time_index       jsonb,
    knows_future     boolean NOT NULL DEFAULT false,
    contradictions   jsonb NOT NULL DEFAULT '[]'::jsonb,
    version          integer NOT NULL DEFAULT 1,
    last_compiled_at timestamptz,
    created_at       timestamptz NOT NULL DEFAULT now(),
    updated_at       timestamptz NOT NULL DEFAULT now()
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS wiki_pages_character_slug_idx ON wiki_pages (character_id, slug)`,
  `CREATE INDEX        IF NOT EXISTS wiki_pages_character_type_idx ON wiki_pages (character_id, type)`,

  /* ── wiki_page_versions (snapshots) ─────────────────────────── */
  `CREATE TABLE IF NOT EXISTS wiki_page_versions (
    id           text PRIMARY KEY,
    page_id      text NOT NULL REFERENCES wiki_pages(id) ON DELETE CASCADE,
    version      integer NOT NULL,
    title        text NOT NULL,
    summary      text,
    body         text NOT NULL,
    frontmatter  jsonb NOT NULL,
    perspective  jsonb NOT NULL,
    confidence   real NOT NULL,
    time_index   jsonb,
    author_kind  text NOT NULL,
    author_id    text,
    note         text,
    created_at   timestamptz NOT NULL DEFAULT now()
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS wiki_page_versions_page_version_idx ON wiki_page_versions (page_id, version)`,

  /* ── wiki_edges ─────────────────────────────────────────────── */
  `CREATE TABLE IF NOT EXISTS wiki_edges (
    id            text PRIMARY KEY,
    character_id  text NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
    from_page_id  text NOT NULL REFERENCES wiki_pages(id) ON DELETE CASCADE,
    to_page_id    text NOT NULL REFERENCES wiki_pages(id) ON DELETE CASCADE,
    kind          text NOT NULL,
    strength      real NOT NULL DEFAULT 1,
    last_seen_at  timestamptz NOT NULL DEFAULT now(),
    created_at    timestamptz NOT NULL DEFAULT now()
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS wiki_edges_unique_idx    ON wiki_edges (from_page_id, to_page_id, kind)`,
  `CREATE INDEX        IF NOT EXISTS wiki_edges_to_page_idx   ON wiki_edges (to_page_id)`,
  `CREATE INDEX        IF NOT EXISTS wiki_edges_character_idx ON wiki_edges (character_id)`,

  /* ── wiki_sources ───────────────────────────────────────────── */
  `CREATE TABLE IF NOT EXISTS wiki_sources (
    id            text PRIMARY KEY,
    character_id  text NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
    title         text NOT NULL,
    kind          text NOT NULL,
    content       text NOT NULL,
    content_hash  text NOT NULL,
    metadata      jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at    timestamptz NOT NULL DEFAULT now(),
    updated_at    timestamptz NOT NULL DEFAULT now()
  )`,

  /* ── wiki_source_refs (provenance) ──────────────────────────── */
  `CREATE TABLE IF NOT EXISTS wiki_source_refs (
    id             text PRIMARY KEY,
    page_id        text NOT NULL REFERENCES wiki_pages(id)   ON DELETE CASCADE,
    source_id      text NOT NULL REFERENCES wiki_sources(id) ON DELETE CASCADE,
    passage        text,
    quote          text,
    relevance_note text,
    created_at     timestamptz NOT NULL DEFAULT now()
  )`,
  `CREATE INDEX IF NOT EXISTS wiki_source_refs_page_idx   ON wiki_source_refs (page_id)`,
  `CREATE INDEX IF NOT EXISTS wiki_source_refs_source_idx ON wiki_source_refs (source_id)`,

  /* ── wiki_ingestion_log ─────────────────────────────────────── */
  `CREATE TABLE IF NOT EXISTS wiki_ingestion_log (
    id                    text PRIMARY KEY,
    character_id          text NOT NULL REFERENCES characters(id)  ON DELETE CASCADE,
    source_id             text          REFERENCES wiki_sources(id) ON DELETE SET NULL,
    started_at            timestamptz NOT NULL DEFAULT now(),
    finished_at           timestamptz,
    status                text NOT NULL DEFAULT 'running',
    pages_created         integer NOT NULL DEFAULT 0,
    pages_updated         integer NOT NULL DEFAULT 0,
    edges_added           integer NOT NULL DEFAULT 0,
    contradictions_found  integer NOT NULL DEFAULT 0,
    tokens_used           integer NOT NULL DEFAULT 0,
    error_message         text,
    notes                 text
  )`,
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
      // neon's template-tag client also exposes a plain call for dynamic SQL.
      await sql.query(stmt);
      console.log("ok");
    } catch (err: any) {
      console.log("FAIL");
      console.error(err.message ?? err);
      process.exit(1);
    }
  }

  console.log(`\nDone. ${DDL.length} statements executed.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
