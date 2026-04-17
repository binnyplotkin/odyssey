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
// the `world_characters` bridge. Each character has its own knowledge-graph
// wiki (pages + edges + sources), because the wiki encodes that character's
// perspective on source material and travels with them.

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
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
);

/** World ↔ Character bridge (a character can appear in multiple worlds). */
export const worldCharactersTable = pgTable(
  "world_characters",
  {
    worldId: text("world_id").notNull().references(() => worldsTable.id, { onDelete: "cascade" }),
    characterId: text("character_id").notNull().references(() => charactersTable.id, { onDelete: "cascade" }),
    // Per-world role override (e.g. "narrator", "host", "guest") — optional.
    roleInWorld: text("role_in_world"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.worldId, t.characterId] })],
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

/** One row per ingestion run — for the log.md rendering and admin audit. */
export const wikiIngestionLogTable = pgTable("wiki_ingestion_log", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  characterId: text("character_id").notNull().references(() => charactersTable.id, { onDelete: "cascade" }),
  sourceId: text("source_id").references(() => wikiSourcesTable.id, { onDelete: "set null" }),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
  finishedAt: timestamp("finished_at", { withTimezone: true }),
  status: text("status").notNull().default("running"),   // running | succeeded | failed
  pagesCreated: integer("pages_created").notNull().default(0),
  pagesUpdated: integer("pages_updated").notNull().default(0),
  edgesAdded: integer("edges_added").notNull().default(0),
  contradictionsFound: integer("contradictions_found").notNull().default(0),
  tokensUsed: integer("tokens_used").notNull().default(0),
  errorMessage: text("error_message"),
  notes: text("notes"),
});
