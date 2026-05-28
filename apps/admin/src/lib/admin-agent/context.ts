import fs from "node:fs/promises";
import path from "node:path";
import {
  getChangelogStore,
  getFeatureStore,
  getTicketStore,
  getVersionStore,
} from "@odyssey/db";
import type { AdminAgentRouteContext, AdminAgentUser } from "./types";
import { getProjectRoot } from "./codebase";
import { getConfiguredRepositoryNames } from "./github";

const ADMIN_ROUTES = [
  "/",
  "/roadmap",
  "/board",
  "/docs",
  "/changelog",
  "/worlds",
  "/characters",
  "/wikis",
  "/voices",
  "/users",
  "/sessions",
  "/engine",
  "/editor",
  "/builder",
  "/voice-debug",
].join(", ");

const DB_SCHEMA_SUMMARY = [
  "Auth: users, accounts, auth_sessions, verification_tokens.",
  "Simulation: sessions, turns, world_sessions, world_session_turns, context_builds, events, audio_artifacts.",
  "Roadmap: versions, features, tickets, platform_versions, changelog_entries.",
  "Studio: worlds, characters, voices, voice_previews, voice_extraction_attempts.",
  "Knowledge: wikis, wiki_pages, wiki_page_versions, wiki_edges, wiki_sources, wiki_source_refs, character_knowledge_bindings, wiki_ingestion_log/events.",
  "Graph/evals: world_nodes, world_edges, eval_suites, eval_runs, eval_probe_results, eval_sweeps.",
  "Agent audit: admin_agent_conversations, messages, tool_calls, operations.",
].join("\n");

export async function buildAdminAgentSystemContext(input: {
  adminUser: AdminAgentUser;
  routeContext?: AdminAgentRouteContext;
}) {
  const root = await getProjectRoot();
  const [readme, mvp, live] = await Promise.all([
    readText(path.join(root, "README.md"), 3_500),
    readText(path.join(root, "docs/path-to-mvp.mdx"), 3_500),
    buildLiveOpsContext(),
  ]);

  return [
    "You are Odyssey's admin operations agent inside the authenticated admin app.",
    "You help admins inspect the database, understand project architecture, and prepare operational changes.",
    "You must not claim a write/delete/bulk operation has executed unless an approved operation result says it did.",
    "Never request or reveal secrets, environment variables, raw credentials, password hashes, or unrestricted SQL.",
    "Use only the provided tools. Reads are allowed. Writes require an operation proposal and explicit approval.",
    "For codebase, architecture, route, component, API, package, or implementation questions, gather current source context with code read tools before answering.",
    "For code changes, use the GitHub/Codex Web delegation tools. Do not treat the hosted filesystem as a place to commit production code.",
    "Code-task, PR-comment, and merge actions are external side effects and must be proposed for approval before execution.",
    `Readable project root: ${root}`,
    `Allowlisted GitHub repositories: ${getConfiguredRepositoryNames().join(", ") || "(none configured)"}`,
    "",
    `Current admin: ${input.adminUser.email ?? input.adminUser.id} (${input.adminUser.role ?? "unknown role"})`,
    `Current route: ${input.routeContext?.pathname ?? "unknown"}`,
    input.routeContext?.title ? `Route title: ${input.routeContext.title}` : "",
    "",
    "Admin route map:",
    ADMIN_ROUTES,
    "",
    "Database schema summary:",
    DB_SCHEMA_SUMMARY,
    "",
    "Live admin context:",
    live,
    "",
    "README excerpt:",
    readme,
    "",
    "MVP/path context excerpt:",
    mvp,
  ].filter(Boolean).join("\n");
}

async function buildLiveOpsContext() {
  try {
    const [versions, features, tickets, changelog] = await Promise.all([
      getVersionStore().list(),
      getFeatureStore().list(),
      getTicketStore().list(),
      getChangelogStore().list(),
    ]);
    const activeTickets = tickets.filter((t) => t.status !== "done").slice(0, 12);
    return JSON.stringify({
      versions: versions.slice(0, 8).map(({ id, tag, title, status }) => ({ id, tag, title, status })),
      features: features.slice(0, 12).map(({ id, versionId, title, status }) => ({ id, versionId, title, status })),
      activeTickets: activeTickets.map(({ id, title, status, priority, domain }) => ({ id, title, status, priority, domain })),
      recentChangelog: changelog.slice(0, 6).map(({ id, title, category, createdAt }) => ({ id, title, category, createdAt })),
    });
  } catch (error) {
    return `Live context unavailable: ${error instanceof Error ? error.message : String(error)}`;
  }
}

async function readText(filePath: string, maxChars: number) {
  try {
    const text = await fs.readFile(filePath, "utf8");
    return text.length > maxChars ? `${text.slice(0, maxChars)}\n...` : text;
  } catch {
    return "(not available)";
  }
}
