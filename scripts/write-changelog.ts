#!/usr/bin/env npx tsx
/**
 * write-changelog.ts
 *
 * Called by the GitHub Action on push to main.
 * Gathers commit metadata, calls Claude to generate a structured changelog entry,
 * then writes the result directly to the Neon changelog_entries table.
 *
 * Required env vars:
 *   DATABASE_URL       — Neon connection string
 *   OPENAI_API_KEY     — OpenAI API key
 *
 * Input env vars (set by the GitHub Action):
 *   COMMIT_SHA    — full sha
 *   COMMIT_MSG    — commit message (subject + body)
 *   PR_NUMBER     — PR number (if merged via PR)
 *   PR_TITLE      — PR title
 *   BRANCH        — branch name
 *   AUTHOR        — commit author
 *   DIFF_SUMMARY  — condensed diff stat (e.g. "5 files changed, 120 insertions")
 */

import OpenAI from "openai";
import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import { eq } from "drizzle-orm";
import { pgTable, text, integer, timestamp } from "drizzle-orm/pg-core";

/* ── Inline schema (avoids TS path-mapping issues in standalone script) ── */

const changelogEntries = pgTable("changelog_entries", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  versionId: text("version_id"),
  title: text("title").notNull(),
  body: text("body"),
  category: text("category").notNull(),
  commitSha: text("commit_sha"),
  prNumber: integer("pr_number"),
  prTitle: text("pr_title"),
  branch: text("branch"),
  author: text("author"),
  diffSummary: text("diff_summary"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/* ── Gather inputs ───────────────────────────────────────────────── */

const commitSha = process.env.COMMIT_SHA ?? "";
const commitMsg = process.env.COMMIT_MSG ?? "";
const prNumber = process.env.PR_NUMBER ? parseInt(process.env.PR_NUMBER, 10) : null;
const prTitle = process.env.PR_TITLE ?? null;
const branch = process.env.BRANCH ?? null;
const author = process.env.AUTHOR ?? null;
const diffSummary = process.env.DIFF_SUMMARY ?? null;

if (!commitSha || !commitMsg) {
  console.error("COMMIT_SHA and COMMIT_MSG are required.");
  process.exit(1);
}

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL is required.");
  process.exit(1);
}

if (!process.env.OPENAI_API_KEY) {
  console.error("OPENAI_API_KEY is required.");
  process.exit(1);
}

/* ── Call OpenAI to classify and describe the change ─────────────── */

const openai = new OpenAI();

const prompt = `You are a changelog writer for a software project called Odyssey (a voice-first AI simulation engine).

Given the following commit information, generate a changelog entry.

Commit message:
${commitMsg}

${prTitle ? `PR title: ${prTitle}` : ""}
${prNumber ? `PR #${prNumber}` : ""}
${branch ? `Branch: ${branch}` : ""}
${diffSummary ? `Diff summary: ${diffSummary}` : ""}

Respond with EXACTLY this JSON (no markdown fences, no extra text):
{
  "title": "<concise human-readable title, max 80 chars>",
  "body": "<1-2 sentence description of what changed and why, or null if the title is sufficient>",
  "category": "<one of: feature, fix, improvement, infra, breaking>"
}

Rules:
- "feature" = new capability that didn't exist before
- "fix" = bug fix
- "improvement" = enhancement to existing functionality
- "infra" = CI/CD, deps, tooling, config, refactoring
- "breaking" = backwards-incompatible change
- Title should be written as a present-tense action (e.g. "Add voice waveform animation controls")
- If the commit message already has a clear conventional-commit prefix (feat/fix/chore etc), use it as a strong signal for category
- Body can be null if the title fully describes the change`;

async function classifyCommit(): Promise<{
  title: string;
  body: string | null;
  category: string;
}> {
  const response = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    max_tokens: 256,
    messages: [{ role: "user", content: prompt }],
  });

  const text = response.choices[0]?.message?.content ?? "";
  try {
    const parsed = JSON.parse(text.trim());
    const validCategories = ["feature", "fix", "improvement", "infra", "breaking"];
    if (!validCategories.includes(parsed.category)) {
      parsed.category = "improvement";
    }
    return {
      title: String(parsed.title).slice(0, 120),
      body: parsed.body ? String(parsed.body) : null,
      category: parsed.category,
    };
  } catch {
    // Fallback: use commit message directly
    console.warn("Failed to parse LLM response, using commit message as fallback.");
    return {
      title: commitMsg.split("\n")[0].slice(0, 120),
      body: null,
      category: "improvement",
    };
  }
}

/* ── Write to database ───────────────────────────────────────────── */

async function main() {
  console.log(`Processing commit ${commitSha.slice(0, 7)}: ${commitMsg.split("\n")[0]}`);

  const sql = neon(process.env.DATABASE_URL!);
  const db = drizzle({ client: sql });

  // Idempotency: a previous run may have already written an entry for this
  // commit. Replays (workflow_dispatch backfills, retried CI jobs) must not
  // create duplicates.
  const existing = await db
    .select({ id: changelogEntries.id })
    .from(changelogEntries)
    .where(eq(changelogEntries.commitSha, commitSha))
    .limit(1);
  if (existing.length > 0) {
    console.log(`Changelog entry already exists for ${commitSha.slice(0, 7)} (id ${existing[0].id}); skipping.`);
    return;
  }

  const entry = await classifyCommit();
  console.log(`Classified as [${entry.category}]: ${entry.title}`);

  const [row] = await db
    .insert(changelogEntries)
    .values({
      title: entry.title,
      body: entry.body,
      category: entry.category,
      commitSha,
      prNumber,
      prTitle,
      branch,
      author,
      diffSummary,
    })
    .returning();

  console.log(`Changelog entry created: ${row.id}`);
}

main().catch((err) => {
  console.error("Failed to write changelog entry:", err);
  process.exit(1);
});
