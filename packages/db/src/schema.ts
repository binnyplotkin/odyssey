import { sql } from "drizzle-orm";
import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  real,
  text,
  timestamp,
  uniqueIndex,
  vector,
} from "drizzle-orm/pg-core";

// ── Auth tables (Auth.js / NextAuth) ──────────────────────────────────

export const usersTable = pgTable("users", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  name: text("name"),
  email: text("email").unique().notNull(),
  emailVerified: timestamp("email_verified", { withTimezone: true }),
  image: text("image"),
  passwordHash: text("password_hash"),
  role: text("role").notNull().default("user"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const accountsTable = pgTable(
  "accounts",
  {
    userId: text("user_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    type: text("type").notNull(),
    provider: text("provider").notNull(),
    providerAccountId: text("provider_account_id").notNull(),
    refresh_token: text("refresh_token"),
    access_token: text("access_token"),
    expires_at: integer("expires_at"),
    token_type: text("token_type"),
    scope: text("scope"),
    id_token: text("id_token"),
    session_state: text("session_state"),
  },
  (table) => [
    primaryKey({ columns: [table.provider, table.providerAccountId] }),
  ],
);

export const authSessionsTable = pgTable("auth_sessions", {
  sessionToken: text("session_token").primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => usersTable.id, { onDelete: "cascade" }),
  expires: timestamp("expires", { withTimezone: true }).notNull(),
});

export const verificationTokensTable = pgTable(
  "verification_tokens",
  {
    identifier: text("identifier").notNull(),
    token: text("token").notNull(),
    expires: timestamp("expires", { withTimezone: true }).notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.identifier, table.token] }),
  ],
);

// ── Game tables ───────────────────────────────────────────────────────

export const sessionsTable = pgTable("sessions", {
  id: text("id").primaryKey(),
  userId: text("user_id").references(() => usersTable.id, { onDelete: "cascade" }),
  worldId: text("world_id").notNull(),
  roleId: text("role_id").notNull(),
  status: text("status").notNull(),
  currentStateVersion: integer("current_state_version").notNull(),
  state: jsonb("state").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  lastActiveAt: timestamp("last_active_at", { withTimezone: true }).notNull(),
});

export const turnsTable = pgTable("turns", {
  id: text("id").primaryKey(),
  sessionId: text("session_id").notNull(),
  stateVersion: integer("state_version").notNull(),
  input: jsonb("input").notNull(),
  result: jsonb("result").notNull(),
  stateDeltaSummary: text("state_delta_summary").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
});

// ── Global live world sessions ─────────────────────────────────────────
//
// These tables are intentionally broader than "voice sessions". Voice, chat,
// and future narrator/world-simulation runs should all land here so one
// session can explain context routing, turns, trace timings, and eventual
// world-state changes.

export const worldSessionsTable = pgTable(
  "world_sessions",
  {
    id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
    userId: text("user_id").references(() => usersTable.id, { onDelete: "set null" }),
    worldId: text("world_id").references(() => worldsTable.id, { onDelete: "set null" }),
    characterId: text("character_id").references(() => charactersTable.id, { onDelete: "set null" }),
    mode: text("mode").notNull(), // chat | voice | mixed | simulation
    status: text("status").notNull().default("active"),
    initialMoment: jsonb("initial_moment"),
    initialScene: jsonb("initial_scene"),
    currentMoment: jsonb("current_moment"),
    currentScene: jsonb("current_scene"),
    metadata: jsonb("metadata").notNull().default({}),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
    endedAt: timestamp("ended_at", { withTimezone: true }),
    lastActiveAt: timestamp("last_active_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("world_sessions_user_idx").on(table.userId),
    index("world_sessions_character_idx").on(table.characterId),
    index("world_sessions_world_idx").on(table.worldId),
    index("world_sessions_last_active_idx").on(table.lastActiveAt),
  ],
);

export const worldSessionContextBuildsTable = pgTable(
  "world_session_context_builds",
  {
    id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
    sessionId: text("session_id").notNull().references(() => worldSessionsTable.id, { onDelete: "cascade" }),
    turnId: text("turn_id"),
    mode: text("mode").notNull(),
    promptKind: text("prompt_kind").notNull(),
    query: text("query"),
    moment: jsonb("moment"),
    scene: jsonb("scene"),
    tokenBudget: integer("token_budget"),
    tokensUsed: integer("tokens_used"),
    tokensBudget: integer("tokens_budget"),
    selectedPages: jsonb("selected_pages").notNull().default([]),
    curatorTrace: jsonb("curator_trace").notNull().default({}),
    timingTrace: jsonb("timing_trace").notNull().default({}),
    promptChunk: text("prompt_chunk"),
    systemPrompt: text("system_prompt"),
    metadata: jsonb("metadata").notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("world_session_context_session_idx").on(table.sessionId),
    index("world_session_context_turn_idx").on(table.turnId),
  ],
);

export const worldSessionTurnsTable = pgTable(
  "world_session_turns",
  {
    id: text("id").primaryKey(),
    sessionId: text("session_id").notNull().references(() => worldSessionsTable.id, { onDelete: "cascade" }),
    turnIndex: integer("turn_index"),
    inputMode: text("input_mode").notNull(),
    userText: text("user_text"),
    assistantText: text("assistant_text"),
    provider: text("provider"),
    model: text("model"),
    status: text("status").notNull(),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    tokenUsage: jsonb("token_usage").notNull().default({}),
    audioMetrics: jsonb("audio_metrics").notNull().default({}),
    latencySummary: jsonb("latency_summary").notNull().default({}),
    trace: jsonb("trace").notNull().default({}),
    metadata: jsonb("metadata").notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("world_session_turns_session_idx").on(table.sessionId),
    index("world_session_turns_status_idx").on(table.status),
  ],
);

export const worldSessionEventsTable = pgTable(
  "world_session_events",
  {
    id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
    sessionId: text("session_id").notNull().references(() => worldSessionsTable.id, { onDelete: "cascade" }),
    turnId: text("turn_id"),
    type: text("type").notNull(),
    source: text("source").notNull(), // user | assistant | system | stt | llm | tts | world
    payload: jsonb("payload").notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("world_session_events_session_idx").on(table.sessionId),
    index("world_session_events_turn_idx").on(table.turnId),
    index("world_session_events_type_idx").on(table.type),
  ],
);

export const worldSessionAudioArtifactsTable = pgTable(
  "world_session_audio_artifacts",
  {
    id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
    sessionId: text("session_id").notNull().references(() => worldSessionsTable.id, { onDelete: "cascade" }),
    turnId: text("turn_id"),
    direction: text("direction").notNull(), // input | output
    mimeType: text("mime_type").notNull(),
    durationMs: integer("duration_ms"),
    sampleRate: integer("sample_rate"),
    byteSize: integer("byte_size").notNull(),
    storageKey: text("storage_key").notNull(),
    waveformSummary: jsonb("waveform_summary").notNull().default({}),
    metadata: jsonb("metadata").notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("world_session_audio_session_idx").on(table.sessionId),
    index("world_session_audio_turn_idx").on(table.turnId),
    index("world_session_audio_direction_idx").on(table.direction),
  ],
);

// ── Roadmap ─────────────────────────────────────────────────────────

export const versionsTable = pgTable("versions", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  tag: text("tag").notNull(),                 // "v0.1", "v0.2"
  title: text("title").notNull(),             // "MVP", "Moshi Fork"
  description: text("description"),
  color: text("color").notNull(),             // "#3B82F6"
  status: text("status").notNull(),           // planned | active | done
  startDate: text("start_date"),              // ISO date "2026-03-10"
  endDate: text("end_date"),                  // ISO date "2026-06-30"
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const featuresTable = pgTable("features", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  versionId: text("version_id").notNull().references(() => versionsTable.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  description: text("description"),
  color: text("color"),                       // optional override; inherit version color if null
  status: text("status").notNull(),           // planned | active | done
  assignee: text("assignee"),                 // team member initials or name
  startDate: text("start_date"),              // ISO date
  endDate: text("end_date"),                  // ISO date
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

// ── Kanban board ─────────────────────────────────────────────────────

export const ticketsTable = pgTable("tickets", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  title: text("title").notNull(),
  description: text("description"),
  status: text("status").notNull(),          // backlog | todo | in-progress | review | done
  domain: text("domain"),                     // research | voice | engine | data | frontend | world | infra | design
  priority: text("priority"),                 // P1 | P2 | P3
  assignee: text("assignee"),
  phase: text("phase"),
  featureId: text("feature_id").references(() => featuresTable.id, { onDelete: "set null" }),
  sortOrder: integer("sort_order").notNull().default(0),
  startDate: text("start_date"),              // ISO date "2026-03-10"
  endDate: text("end_date"),                  // ISO date "2026-06-30"
  subtasks: jsonb("subtasks"),                // Subtask[]
  activity: jsonb("activity"),                // ActivityItem[]
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

// ── Changelog ───────────────────────────────────────────────────────

export const platformVersionsTable = pgTable("platform_versions", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  version: text("version").notNull().unique(),      // "0.1.0"
  title: text("title").notNull(),                    // "MVP Foundation"
  summary: text("summary"),                          // markdown
  status: text("status").notNull(),                  // draft | published
  releasedAt: timestamp("released_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const changelogEntriesTable = pgTable("changelog_entries", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  versionId: text("version_id").references(() => platformVersionsTable.id, { onDelete: "set null" }),
  title: text("title").notNull(),
  body: text("body"),                                // markdown
  category: text("category").notNull(),              // feature | fix | improvement | infra | breaking
  commitSha: text("commit_sha"),
  prNumber: integer("pr_number"),
  prTitle: text("pr_title"),
  branch: text("branch"),
  author: text("author"),
  diffSummary: text("diff_summary"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const worldsTable = pgTable("worlds", {
  id: text("id").primaryKey(),
  userId: text("user_id").references(() => usersTable.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  prompt: text("prompt").notNull(),
  status: text("status").notNull(),
  definition: jsonb("definition").notNull(),
  version: integer("version").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
});

// ── Characters + Knowledge Graph ──────────────────────────────────────
//
// A character is global — one row, reused across any number of worlds via
// the world graph (`world_nodes` with kind='character', refId=character.id).
// Each character has its own knowledge-graph wiki (pages + edges + sources),
// because the wiki encodes that character's perspective on source material
// and travels with them.

/** Global characters (Abraham, Sarah, Narrator, …). */
export const charactersTable = pgTable(
  "characters",
  {
    id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
    slug: text("slug").notNull().unique(),              // immutable, used in URLs + wikilinks
    title: text("title").notNull(),                     // human-facing; renameable
    summary: text("summary"),                           // short one-liner
    image: text("image"),                               // avatar URL; null falls back to initial
    // Named gradient key from the AvatarGradient registry (e.g. "dune",
    // "mint"). When `image` is set the uploaded image wins. When both
    // are null the renderer falls back to the legacy slug-hash gradient
    // so back-compat is preserved.
    thumbnailColor: text("thumbnail_color"),
    // Ordered list of named eras for this character's life. Drives timeIndex
    // comparison by mapping era → integer order.
    // Shape: [{ key: "pre-covenant", title: "Pre-Covenant", order: 0 }, …]
    eras: jsonb("eras").notNull().default([]),
    // The single domain knob. Injected at the top of every ingestion run's
    // system prompt so the generic engine interprets raw sources through this
    // character's specific tradition (scripture vs canon novel vs worldbook).
    ingestionPrompt: text("ingestion_prompt"),
    // L01 Identity — essence sentence + exactly-two defining traits +
    // optional era/setting. Compiled into the `<identity>` block at the
    // top of the cached system envelope. Null = use the hardcoded
    // "You are {title}…" anchor (back-compat for characters created
    // before this column existed).
    // Shape: see CharacterIdentity in wiki-types.ts.
    identity: jsonb("identity"),
    // L03 Voice & Style — four orthogonal axes (tone palette, decision
    // spectrum, brevity, register pad) + audio voice prompt + prosody.
    // Compiled into the `<voice>` block of the cached system envelope.
    // In 1.3b the audio fields also feed the TTS pipeline.
    // Shape: see CharacterVoiceStyle in wiki-types.ts.
    voiceStyle: jsonb("voice_style"),
    // L04 Brain / Model — inference-call parameters (model, temperature,
    // top_p, max_tokens, cache preference, optional fallback chain).
    // Doesn't compile to system-prompt text; the chat route reads it and
    // overrides its hardcoded defaults. Null = use defaults.
    // Shape: see CharacterBrainModel in wiki-types.ts.
    brainModel: jsonb("brain_model"),
    // L02 Directive — structured scope/exemplars/never/framing/guidance.
    // Compiled into the cached system envelope as Frontier Playbook XML.
    // Null = use legacy single-paragraph template (back-compat for
    // characters created before this column existed).
    // Shape: see CharacterDirective in wiki-types.ts.
    directive: jsonb("directive"),
    // The wiki page (type='voice_identity') that defines how this character
    // speaks. Points to wiki_pages.id. Always lives in a wiki bound to this
    // character; surfaced on Persona → Voice & Style rather than under the
    // /wikis surface. Null until a voice_identity page exists.
    voiceIdentityPageId: text("voice_identity_page_id"),
    // Pointer into the global voices library (voices.id). Null falls back
    // to the audio-rt default voice (abraham). Set via the /voices admin
    // surface; many characters can share the same voice row.
    voiceId: text("voice_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
);

// ── Voices (global library) ───────────────────────────────────────────
//
// A voice = a Pocket TTS speaker embedding (kvcache state) exported from a
// short audio clip and stored as .safetensors. The source clip lives in
// the Supabase `voice-sources` bucket; the .safetensors lives in
// `voice-embeddings`. audio-rt loads the embedding on first /speak call
// for that voice and caches it in-process.
//
// Slug is the stable address used by audio-rt's /speak payload (e.g.
// "abraham"). For voices baked into the audio-rt Docker image (legacy)
// only the slug matters; for Supabase-managed voices both id and slug
// resolve to the same embedding via the lookup path inside audio-rt.
//
// Status lifecycle:
//   uploaded   — row exists, source clip in storage, no embedding yet
//   processing — audio-rt is running export-voice
//   ready      — embedding_path set, voice is usable
//   failed     — extraction errored; statusError holds the message
export const voicesTable = pgTable(
  "voices",
  {
    id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
    slug: text("slug").notNull().unique(),
    name: text("name").notNull(),
    description: text("description"),
    status: text("status").notNull().default("uploaded"),
    statusError: text("status_error"),
    // Path within the voice-sources Supabase bucket. WAV (or whatever the
    // user uploaded — Pocket TTS accepts wav and mp3). Null only if the
    // voice was seeded directly without an upload (e.g. legacy bake).
    sourcePath: text("source_path"),
    // Path within the voice-embeddings Supabase bucket. Null until
    // extraction succeeds.
    embeddingPath: text("embedding_path"),
    // Optional smoke-test sample synthesized after extraction so the UI
    // can A/B without re-running synthesis on every page load.
    previewPath: text("preview_path"),
    durationS: real("duration_s"),
    sampleRate: integer("sample_rate"),
    createdBy: text("created_by").references(() => usersTable.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("voices_status_idx").on(t.status),
  ],
);

// ── Character versions (named snapshots of full config state) ───────
//
// One row per saved version. Version numbers are monotonic per character
// (v1, v2, v3 …) — the next number is computed at save time as
// `MAX(versionNumber) + 1`. The `snapshot` JSONB captures the full
// authorial state at save time: identity, voiceStyle, brainModel,
// directive, ingestionPrompt, eras, voiceIdentityPageId, title/summary,
// plus the wiki bindings list (priorities + active flag).
//
// Wiki page/edge/source content is NOT snapshotted here — wikis are
// shared resources with their own change history. The snapshot captures
// the character's pointer to wikis (bindings), not the wiki content.
//
// Restoring a version overwrites the live character row + replaces the
// bindings list. To preserve history, save a snapshot first.
export const characterVersionsTable = pgTable(
  "character_versions",
  {
    id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
    characterId: text("character_id").notNull().references(() => charactersTable.id, { onDelete: "cascade" }),
    versionNumber: integer("version_number").notNull(),
    snapshot: jsonb("snapshot").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    createdBy: text("created_by").references(() => usersTable.id, { onDelete: "set null" }),
  },
  (t) => [
    uniqueIndex("character_versions_unique_idx").on(t.characterId, t.versionNumber),
    index("character_versions_character_idx").on(t.characterId),
  ],
);

// ── Wikis (shared knowledge resources) ───────────────────────────────
//
// A wiki is a shared knowledge resource — pages, edges, sources — that can be
// bound to many characters via `character_knowledge_bindings`. Wikis own the
// content; characters reference them. This decouples "what's known about the
// Genesis world" from "who is using that knowledge to speak right now."
//
// Migration: previously wiki_pages/edges/sources were scoped per-character
// via character_id. They're now scoped per-wiki via wiki_id. The character_id
// columns remain (nullable) during the transition; a future migration drops
// them once all rows are backfilled.

/** Top-level wiki container — pages + edges + sources live under this. */
export const wikisTable = pgTable(
  "wikis",
  {
    id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
    slug: text("slug").notNull().unique(),              // immutable, used in URLs
    title: text("title").notNull(),                     // human-facing; renameable
    summary: text("summary"),                           // short one-liner
    // Ordered list of named eras used by pages in this wiki for timeIndex
    // mapping. Same shape as `characters.eras` (which is deprecated for new
    // wikis but kept for back-compat until cleanup).
    // Shape: [{ key: "pre-covenant", title: "Pre-Covenant", order: 0 }, …]
    eras: jsonb("eras").notNull().default([]),
    // Domain knob injected at the top of every ingestion run's system prompt
    // so the generic engine interprets raw sources through this wiki's specific
    // tradition (scripture vs canon novel vs worldbook).
    ingestionPrompt: text("ingestion_prompt"),
    // Human-facing name for the prompt — separate from the wiki title so the
    // same wiki can iterate on prompt identity (e.g. "Stoic Narrator") without
    // renaming the wiki itself. Null falls back to `{title} lens.` in the UI.
    ingestionPromptName: text("ingestion_prompt_name"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
);

/**
 * Wiki pages for a character — one row per page.
 * Body is markdown with [[slug|Display Text]] wikilinks. Edges are derived
 * on save into `wiki_edges` (source of truth is the body; edges are cache).
 */
export const wikiPagesTable = pgTable(
  "wiki_pages",
  {
    id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
    // DEPRECATED: kept nullable for back-compat during migration to wiki-scoped
    // pages. New code should read/write via wikiId. Will be dropped once all
    // rows are backfilled and dependent stores rewritten.
    characterId: text("character_id").references(() => charactersTable.id, { onDelete: "cascade" }),
    // The wiki this page belongs to. Nullable during migration; will be made
    // NOT NULL once data move script runs against all existing rows.
    wikiId: text("wiki_id").references(() => wikisTable.id, { onDelete: "cascade" }),
    // entity | event | concept | relationship | timeline | voice_identity
    type: text("type").notNull(),
    slug: text("slug").notNull(),                       // unique per character; immutable
    title: text("title").notNull(),
    summary: text("summary"),                           // LLM-written 1–2 sentences
    body: text("body").notNull().default(""),           // markdown with wikilinks
    frontmatter: jsonb("frontmatter").notNull().default({}),   // type-specific fields
    perspective: jsonb("perspective").notNull().default({}),   // { knows_how, feels, stake }
    confidence: real("confidence").notNull().default(0.5),     // synthesis certainty 0..1
    // { era: string, index: int } — era key references character.eras[].key.
    // Null for non-temporal pages (concepts, voice_identity, timeline index).
    timeIndex: jsonb("time_index"),
    // If true, this page bleeds through the timeline filter — e.g. covenants
    // Abraham was promised but hadn't yet lived through.
    knowsFuture: boolean("knows_future").notNull().default(false),
    contradictions: jsonb("contradictions").notNull().default([]),   // [{ otherPageId, note }]
    version: integer("version").notNull().default(1),
    lastCompiledAt: timestamp("last_compiled_at", { withTimezone: true }),
    // Semantic embedding of title+summary+body, populated on material change
    // by savePage() and consumed by the wiki-curator's semantic-seed pass.
    // Sized for OpenAI text-embedding-3-small.
    embedding: vector("embedding", { dimensions: 1536 }),
    embeddingModel: text("embedding_model"),
    embeddedAt: timestamp("embedded_at", { withTimezone: true }),
    // Cached 2D layout for the Knowledge view. Computed from embeddings via
    // cosine-distance MDS, persisted so repeat visits are stable. Recomputed
    // lazily when any page in the character is missing coordinates, or via
    // an explicit "Recompute layout" action.
    layoutX: real("layout_x"),
    layoutY: real("layout_y"),
    layoutComputedAt: timestamp("layout_computed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("wiki_pages_character_slug_idx").on(t.characterId, t.slug),
    uniqueIndex("wiki_pages_wiki_slug_idx").on(t.wikiId, t.slug),
    index("wiki_pages_character_type_idx").on(t.characterId, t.type),
    index("wiki_pages_wiki_idx").on(t.wikiId),
    index("wiki_pages_wiki_type_idx").on(t.wikiId, t.type),
    // HNSW index for fast cosine similarity. Partial index on rows that
    // actually have an embedding so freshly-created pages don't slow it.
    index("wiki_pages_embedding_idx")
      .using("hnsw", t.embedding.op("vector_cosine_ops"))
      .where(sql`${t.embedding} IS NOT NULL`),
  ],
);

/** Append-only page history — full snapshots, not diffs. */
export const wikiPageVersionsTable = pgTable(
  "wiki_page_versions",
  {
    id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
    pageId: text("page_id").notNull().references(() => wikiPagesTable.id, { onDelete: "cascade" }),
    version: integer("version").notNull(),
    title: text("title").notNull(),
    summary: text("summary"),
    body: text("body").notNull(),
    frontmatter: jsonb("frontmatter").notNull(),
    perspective: jsonb("perspective").notNull(),
    confidence: real("confidence").notNull(),
    timeIndex: jsonb("time_index"),
    authorKind: text("author_kind").notNull(),          // "llm" | "human" | "system"
    authorId: text("author_id"),                         // userId (human) | ingestionRunId (llm)
    note: text("note"),                                  // free-form reason for change
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("wiki_page_versions_page_version_idx").on(t.pageId, t.version)],
);

/**
 * Typed edges between wiki pages, derived from markdown body on save.
 * Kinds: mentions | relates_to | participates_in | happens_at | perspective_of | contradicts
 */
export const wikiEdgesTable = pgTable(
  "wiki_edges",
  {
    id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
    // DEPRECATED: kept nullable for back-compat during migration.
    characterId: text("character_id").references(() => charactersTable.id, { onDelete: "cascade" }),
    // The wiki this edge belongs to. Nullable during migration.
    wikiId: text("wiki_id").references(() => wikisTable.id, { onDelete: "cascade" }),
    fromPageId: text("from_page_id").notNull().references(() => wikiPagesTable.id, { onDelete: "cascade" }),
    toPageId: text("to_page_id").notNull().references(() => wikiPagesTable.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(),
    strength: real("strength").notNull().default(1),    // priors for curator ranking
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("wiki_edges_unique_idx").on(t.fromPageId, t.toPageId, t.kind),
    index("wiki_edges_to_page_idx").on(t.toPageId),
    index("wiki_edges_character_idx").on(t.characterId),
    index("wiki_edges_wiki_idx").on(t.wikiId),
  ],
);

/** Raw ingested source material (one row per source document). */
export const wikiSourcesTable = pgTable("wiki_sources", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  // DEPRECATED: kept nullable for back-compat during migration.
  characterId: text("character_id").references(() => charactersTable.id, { onDelete: "cascade" }),
  // The wiki this source belongs to. Nullable during migration.
  wikiId: text("wiki_id").references(() => wikisTable.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  kind: text("kind").notNull(),                          // bible | commentary | midrash | note | transcript
  content: text("content").notNull(),
  contentHash: text("content_hash").notNull(),           // detect changes on re-ingest
  metadata: jsonb("metadata").notNull().default({}),     // { author, translation, url, … }
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/** Provenance — which passages in which sources back which pages. */
export const wikiSourceRefsTable = pgTable(
  "wiki_source_refs",
  {
    id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
    pageId: text("page_id").notNull().references(() => wikiPagesTable.id, { onDelete: "cascade" }),
    sourceId: text("source_id").notNull().references(() => wikiSourcesTable.id, { onDelete: "cascade" }),
    passage: text("passage"),                            // e.g. "Gen 18:1-15"
    quote: text("quote"),                                // snippet pulled from source
    relevanceNote: text("relevance_note"),               // why this passage informs this page
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("wiki_source_refs_page_idx").on(t.pageId),
    index("wiki_source_refs_source_idx").on(t.sourceId),
  ],
);

// ── Character ↔ Wiki bindings ─────────────────────────────────────────
//
// A character binds to one or more wikis (knowledge graphs). The binding
// expresses priority — primary wikis weight first in retrieval, secondary
// next, reference last. A character with no bindings has no world knowledge
// beyond their own identity/persona configuration.

/** Many-to-many link between characters and wikis with priority. */
export const characterKnowledgeBindingsTable = pgTable(
  "character_knowledge_bindings",
  {
    id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
    characterId: text("character_id").notNull().references(() => charactersTable.id, { onDelete: "cascade" }),
    wikiId: text("wiki_id").notNull().references(() => wikisTable.id, { onDelete: "cascade" }),
    // primary | secondary | reference — controls retrieval ordering and weight.
    priority: text("priority").notNull().default("primary"),
    // Disabled bindings are kept for audit but skipped during retrieval.
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("character_knowledge_bindings_unique_idx").on(t.characterId, t.wikiId),
    index("character_knowledge_bindings_character_idx").on(t.characterId),
    index("character_knowledge_bindings_wiki_idx").on(t.wikiId),
  ],
);

// ── World Graph ───────────────────────────────────────────────────────
//
// A world is a graph. Nodes are typed entities inside a world; edges are
// typed directed relationships between them. `kind` is a discriminator
// validated in the app (character | place | event to start). Character
// nodes reference the global `characters` library via `refId`; other
// kinds are native to the world. Kind-specific fields live in `data`.

/** Typed entity inside a world (character | place | event | …). */
export const worldNodesTable = pgTable(
  "world_nodes",
  {
    id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
    worldId: text("world_id").notNull().references(() => worldsTable.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(),                        // character | place | event (extend later)
    refId: text("ref_id"),                                // characters.id when kind='character'; else null
    label: text("label").notNull(),                       // display name in this world
    summary: text("summary"),
    data: jsonb("data").notNull().default({}),            // kind-specific fields, validated app-side
    position: jsonb("position"),                          // { x, y } for canvas editor
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("world_nodes_world_idx").on(t.worldId),
    index("world_nodes_world_kind_idx").on(t.worldId, t.kind),
    index("world_nodes_ref_idx").on(t.refId),
    // Prevent the same library entity from being imported twice into one world.
    // Partial — only enforced when refId is set.
    uniqueIndex("world_nodes_world_ref_uniq")
      .on(t.worldId, t.kind, t.refId)
      .where(sql`${t.refId} IS NOT NULL`),
  ],
);

/** Typed directed edge between two nodes in the same world. */
export const worldEdgesTable = pgTable(
  "world_edges",
  {
    id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
    worldId: text("world_id").notNull().references(() => worldsTable.id, { onDelete: "cascade" }),
    fromNodeId: text("from_node_id").notNull().references(() => worldNodesTable.id, { onDelete: "cascade" }),
    toNodeId: text("to_node_id").notNull().references(() => worldNodesTable.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(),                         // knows | happens_at | involves | member_of | plays | …
    data: jsonb("data").notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("world_edges_unique_idx").on(t.fromNodeId, t.toNodeId, t.kind),
    index("world_edges_world_idx").on(t.worldId),
    index("world_edges_to_node_idx").on(t.toNodeId),
  ],
);

/** One row per ingestion run — for the log.md rendering and admin audit. */
export const wikiIngestionLogTable = pgTable("wiki_ingestion_log", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  // DEPRECATED: kept nullable for back-compat during migration.
  characterId: text("character_id").references(() => charactersTable.id, { onDelete: "cascade" }),
  // The wiki this ingestion run targeted. Nullable during migration.
  wikiId: text("wiki_id").references(() => wikisTable.id, { onDelete: "cascade" }),
  sourceId: text("source_id").references(() => wikiSourcesTable.id, { onDelete: "set null" }),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
  finishedAt: timestamp("finished_at", { withTimezone: true }),
  status: text("status").notNull().default("running"),   // queued | running | succeeded | failed | canceled
  /** The LLM model that ran this ingestion — e.g. "claude-sonnet-4-5". */
  model: text("model"),
  /** Short SHA of the character.ingestionPrompt at run time — for reproducibility. */
  promptHash: text("prompt_hash"),
  pagesCreated: integer("pages_created").notNull().default(0),
  pagesUpdated: integer("pages_updated").notNull().default(0),
  edgesAdded: integer("edges_added").notNull().default(0),
  contradictionsFound: integer("contradictions_found").notNull().default(0),
  tokensUsed: integer("tokens_used").notNull().default(0),
  errorMessage: text("error_message"),
  notes: text("notes"),
  workerId: text("worker_id"),
  claimedAt: timestamp("claimed_at", { withTimezone: true }),
  heartbeatAt: timestamp("heartbeat_at", { withTimezone: true }),
});

/** Replayable event stream for durable wiki ingestion runs. */
export const wikiIngestionEventsTable = pgTable(
  "wiki_ingestion_events",
  {
    id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
    runId: text("run_id").notNull().references(() => wikiIngestionLogTable.id, { onDelete: "cascade" }),
    seq: integer("seq").notNull(),
    type: text("type").notNull(),
    payload: jsonb("payload").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("wiki_ingestion_events_run_seq_idx").on(t.runId, t.seq),
    index("wiki_ingestion_events_run_idx").on(t.runId),
  ],
);

// ── Eval harness ────────────────────────────────────────────────────
//
// Persists everything the @odyssey/evals package produces: probe suites,
// individual runs against a character, parameter sweeps, and per-probe
// drill-down with judge scores + rationales.
//
// Source of truth lives here; the file outputs under `.evals/...` are
// convenience exports for offline reading + CLI piping. See docs/eval-schema.mdx
// for the full design write-up.

/**
 * Versioned probe-suite definitions. Old code path kept the suite hard-coded
 * in TS (`evals/abraham/suite.ts`); lifting it into the DB lets authors edit
 * and version suites without re-deploys, and lets one suite be referenced by
 * many runs without copying probes around.
 *
 * Versions are immutable once written — editing produces a new (slug, version)
 * row. Lets historical runs continue to point at exactly the probes they
 * were judged against.
 */
export const evalSuitesTable = pgTable(
  "eval_suites",
  {
    id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
    characterId: text("character_id").notNull().references(() => charactersTable.id, { onDelete: "cascade" }),
    /** "abraham" — unique per character. */
    slug: text("slug").notNull(),
    /** Semver string. Same slug at multiple versions is fine; the unique index
     * is on (character, slug, version). */
    version: text("version").notNull(),
    /** Full probe definitions (Probe[] shape from @odyssey/evals). Jsonb so
     * the runner can deserialize without a separate probes table — trade-off
     * is we can't query "which suite uses probe X". Acceptable for v1. */
    probes: jsonb("probes").notNull().default([]),
    notes: text("notes"),
    /** Authored release notes shown in the suite explorer + publish modal.
     * Replaces the legacy `notes` column for new drafts; both are kept so
     * older seeded suites don't lose their description text. */
    releaseNotes: text("release_notes"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    /**
     * When this version was published (= became immutable). Null = draft,
     * still editable via `PATCH /suites/:id`. A partial unique index on
     * (character_id, slug) WHERE published_at IS NULL enforces "at most one
     * draft per slug per character" — see migrate-eval-drafts script.
     *
     * Existing rows are backfilled with created_at so historical suites
     * keep behaving immutably (the seed script ran before drafts existed).
     */
    publishedAt: timestamp("published_at", { withTimezone: true }),
    /** When a draft was forked from this row's predecessor — null on the
     * v1.0.0 base and on fully-published rows that weren't forked. Used
     * by the UI to show "draft forked 3h ago from v1.0.0". */
    forkedFromId: text("forked_from_id"),
    createdBy: text("created_by").references(() => usersTable.id, { onDelete: "set null" }),
  },
  (t) => [
    uniqueIndex("eval_suites_slug_version_idx").on(t.characterId, t.slug, t.version),
    index("eval_suites_character_idx").on(t.characterId),
    index("eval_suites_published_idx").on(t.characterId, t.publishedAt),
  ],
);

/**
 * One row per single-config execution of a suite. Carries the FULL character
 * snapshot at run time (not a reference) so reruns + debugging can reproduce
 * exactly what was tested even if the character has been edited since.
 *
 * Summary fields are denormalized from `eval_probe_results` so the list view
 * doesn't have to aggregate on every render — see runs-list query in the
 * eval-schema doc.
 */
export const evalRunsTable = pgTable(
  "eval_runs",
  {
    id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
    characterId: text("character_id").notNull().references(() => charactersTable.id, { onDelete: "cascade" }),
    suiteId: text("suite_id").notNull().references(() => evalSuitesTable.id, { onDelete: "restrict" }),

    /** Snapshot of L01-L04 at the moment the run started. Full content, not
     * a reference — lets us reproduce / diff against later character edits. */
    characterSnapshot: jsonb("character_snapshot").notNull(),
    /** sha256 of the snapshot's hashable fields. Lets us group "runs against
     * identical config" across time, even if labels/comments changed. */
    configHash: text("config_hash").notNull(),
    /** Per-run override on top of saved brainModel (from --config / --sweep).
     * Null for runs against the unmodified character. */
    overrideConfig: jsonb("override_config"),
    /** The merged config that actually ran (effective = saved + override). */
    effectiveModelConfig: jsonb("effective_model_config").notNull(),

    judgeModel: text("judge_model").notNull(),

    /** "single" = ad-hoc CLI / UI run. "sweep" = one config inside a sweep.
     * Joined to the parent sweep via sweepId when source = "sweep". */
    source: text("source").notNull().default("single"),
    sweepId: text("sweep_id").references(() => evalSweepsTable.id, { onDelete: "set null" }),

    /** Lifecycle: pending → running → completed (or errored). UI-launched runs
     * insert a placeholder row immediately (so the activity feed shows it
     * spinning) and update through the states as the eval progresses.
     * CLI-launched runs go straight to "completed" since they only write
     * once the eval finishes. */
    status: text("status").notNull().default("completed"),
    errorMessage: text("error_message"),

    // ── Summary (denormalized from probe_results) ──
    // Defaults to 0 for pending/running rows so the UI can render them
    // without null-checks; populated on completion.
    total: integer("total").notNull().default(0),
    passed: integer("passed").notNull().default(0),
    failed: integer("failed").notNull().default(0),
    errored: integer("errored").notNull().default(0),
    avgOverall: real("avg_overall").notNull().default(0),
    avgLatencyMs: integer("avg_latency_ms").notNull().default(0),
    totalTokens: integer("total_tokens").notNull().default(0),
    estimatedCostUsd: real("estimated_cost_usd").notNull().default(0),

    startedAt: timestamp("started_at", { withTimezone: true }).notNull(),
    /** Null while the run is pending/running; set on completion or error. */
    completedAt: timestamp("completed_at", { withTimezone: true }),
    createdBy: text("created_by").references(() => usersTable.id, { onDelete: "set null" }),
  },
  (t) => [
    index("eval_runs_char_started_idx").on(t.characterId, t.startedAt),
    index("eval_runs_config_hash_idx").on(t.characterId, t.configHash),
    index("eval_runs_sweep_idx").on(t.sweepId),
  ],
);

/**
 * One row per probe in a run — heavy. Stores full character response, all
 * five dimension scores, judge rationale, and any mechanical-check failures.
 *
 * Loaded only when a run is expanded; the list view reads from the
 * denormalized summary on `eval_runs`.
 */
export const evalProbeResultsTable = pgTable(
  "eval_probe_results",
  {
    id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
    runId: text("run_id").notNull().references(() => evalRunsTable.id, { onDelete: "cascade" }),

    /** Suite-local id, e.g. "id-tell-me". Not a FK — probes live as jsonb
     * inside eval_suites.probes, so this is a soft pointer. */
    probeId: text("probe_id").notNull(),
    probeCategory: text("probe_category").notNull(),
    /** Probe.input verbatim. Denormalized so a probe rename in a future suite
     * version doesn't corrupt historical run archeology. */
    input: text("input").notNull(),
    response: text("response").notNull(),

    /** { voice: { score, rationale }, scope: {…}, frame: {…}, brevity: {…},
     * factual: {…} } — dimension set may grow, jsonb leaves it open. */
    scores: jsonb("scores").notNull(),
    overall: real("overall").notNull(),
    pass: boolean("pass").notNull(),
    /** Judge's one-sentence summary. */
    rationale: text("rationale").notNull(),

    /** Strings describing mechanical checks that failed (e.g. "missing
     * required substring: 988"). Empty array on clean runs. */
    mechanicalFailures: jsonb("mechanical_failures").notNull().default([]),
    /** Runtime errors (timeouts, judge failures, etc.). Empty array on
     * clean runs; populated when the probe didn't complete cleanly. */
    errors: jsonb("errors").notNull().default([]),

    latencyMs: integer("latency_ms").notNull(),
    /** { input, output, cacheRead, cacheCreation } token counts. */
    tokens: jsonb("tokens").notNull(),
  },
  (t) => [
    index("eval_probe_results_run_idx").on(t.runId),
    // "How has probe X scored across all runs of this character?" — used by
    // the per-probe trend view (future) and regression-bisection.
    index("eval_probe_results_probe_idx").on(t.probeId, t.runId),
  ],
);

/**
 * One row per parameter sweep. The expanded configs, rankings, and Pareto
 * frontier are denormalized for the same reason as eval_runs.summary —
 * list view + chart must be fast and not require N+1 aggregation queries.
 *
 * Each sweep creates N eval_runs rows (one per config in the grid), joined
 * via eval_runs.sweepId.
 */
export const evalSweepsTable = pgTable(
  "eval_sweeps",
  {
    id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
    characterId: text("character_id").notNull().references(() => charactersTable.id, { onDelete: "cascade" }),
    suiteId: text("suite_id").notNull().references(() => evalSuitesTable.id, { onDelete: "restrict" }),

    judgeModel: text("judge_model").notNull(),

    /** The SweepSpec — { model: [...], temperature: [...], ... }. Lets the
     * UI offer "re-run this sweep" with the same grid. */
    spec: jsonb("spec").notNull(),
    /** Probe subset filter (null = all probes in the suite). */
    probeIds: jsonb("probe_ids"),
    maxConcurrency: integer("max_concurrency"),

    /** Cartesian-expanded configs: [{ id, override }, ...] */
    configs: jsonb("configs").notNull(),
    /** Ranked configs after sort, mirrors ConfigRanking[]. */
    rankings: jsonb("rankings").notNull(),
    /** Subset of rankings on the Pareto frontier (post-error-filter). */
    pareto: jsonb("pareto").notNull(),

    /** Lifecycle: pending → running → completed (or errored). Mirrors
     * eval_runs.status. While a sweep is running, `rankings` and `pareto`
     * are partial — the runs that have completed so far. */
    status: text("status").notNull().default("completed"),
    errorMessage: text("error_message"),

    startedAt: timestamp("started_at", { withTimezone: true }).notNull(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    createdBy: text("created_by").references(() => usersTable.id, { onDelete: "set null" }),
  },
  (t) => [
    index("eval_sweeps_char_started_idx").on(t.characterId, t.startedAt),
  ],
);
