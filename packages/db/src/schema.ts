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
    // Ordered list of named eras for this character's life. Drives timeIndex
    // comparison by mapping era → integer order.
    // Shape: [{ key: "pre-covenant", title: "Pre-Covenant", order: 0 }, …]
    eras: jsonb("eras").notNull().default([]),
    // The single domain knob. Injected at the top of every ingestion run's
    // system prompt so the generic engine interprets raw sources through this
    // character's specific tradition (scripture vs canon novel vs worldbook).
    ingestionPrompt: text("ingestion_prompt"),
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
    characterId: text("character_id").notNull().references(() => charactersTable.id, { onDelete: "cascade" }),
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
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("wiki_pages_character_slug_idx").on(t.characterId, t.slug),
    index("wiki_pages_character_type_idx").on(t.characterId, t.type),
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
    characterId: text("character_id").notNull().references(() => charactersTable.id, { onDelete: "cascade" }),
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
  ],
);

/** Raw ingested source material (one row per source document). */
export const wikiSourcesTable = pgTable("wiki_sources", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  characterId: text("character_id").notNull().references(() => charactersTable.id, { onDelete: "cascade" }),
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
  characterId: text("character_id").notNull().references(() => charactersTable.id, { onDelete: "cascade" }),
  sourceId: text("source_id").references(() => wikiSourcesTable.id, { onDelete: "set null" }),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
  finishedAt: timestamp("finished_at", { withTimezone: true }),
  status: text("status").notNull().default("running"),   // running | succeeded | failed
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
});
