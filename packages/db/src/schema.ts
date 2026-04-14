import { integer, jsonb, pgTable, primaryKey, text, timestamp } from "drizzle-orm/pg-core";

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
