#!/usr/bin/env npx tsx
/**
 * sync-backlog.ts
 *
 * Called by .github/workflows/backlog-sync.yml on push to main.
 * Matches a push's commits + changed files against open tickets,
 * appends AI-authored activity entries, optionally mutates status
 * on high-confidence hits, then deterministically rolls up feature
 * status from child tickets.
 *
 * Required env vars:
 *   DATABASE_URL, OPENAI_API_KEY
 *
 * Optional:
 *   APPLY_BACKLOG_UPDATES  — "true" to flip out of proposal mode
 *
 * Input env vars (from GitHub Action):
 *   COMMIT_SHA, COMMIT_MSG, PR_NUMBER, PR_TITLE, BRANCH, AUTHOR,
 *   DIFF_SUMMARY, CHANGED_FILES (newline-separated)
 */

import OpenAI from "openai";
import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import { eq, ne } from "drizzle-orm";
import { integer, jsonb, pgTable, text, timestamp } from "drizzle-orm/pg-core";

/* ── Inline schema (mirrors packages/db/src/schema.ts) ─────────── */

const tickets = pgTable("tickets", {
  id: text("id").primaryKey(),
  title: text("title").notNull(),
  description: text("description"),
  status: text("status").notNull(),
  domain: text("domain"),
  featureId: text("feature_id"),
  activity: jsonb("activity"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
});

const features = pgTable("features", {
  id: text("id").primaryKey(),
  title: text("title").notNull(),
  status: text("status").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
});

type ActivityItem = {
  id: string;
  author: string;
  authorColor: string;
  timestamp: string;
  text: string;
  type: "comment" | "system";
};

/* ── Inputs ────────────────────────────────────────────────────── */

const commitSha = process.env.COMMIT_SHA ?? "";
const commitMsg = process.env.COMMIT_MSG ?? "";
const prNumber = process.env.PR_NUMBER ? parseInt(process.env.PR_NUMBER, 10) : null;
const prTitle = process.env.PR_TITLE ?? null;
const branch = process.env.BRANCH ?? null;
const author = process.env.AUTHOR ?? null;
const diffSummary = process.env.DIFF_SUMMARY ?? null;
const changedFiles = (process.env.CHANGED_FILES ?? "").split("\n").filter(Boolean);
const applyUpdates = process.env.APPLY_BACKLOG_UPDATES === "true";

// Event kinds: push-main (default) | pr-opened | pr-ready_for_review |
// pr-synchronize | pr-reopened. The PR events restrict which status
// transitions make sense.
const eventKind = process.env.EVENT_KIND ?? "push-main";
const isPrEvent = eventKind.startsWith("pr-");

/* ── Meta-commit detection ─────────────────────────────────────── */
// If every changed file is infra/meta (CI, scripts, top-level config,
// docs), skip the LLM entirely — these commits don't advance product
// tickets, and the agent will hallucinate connections if asked.

const META_PREFIXES = [".github/", "scripts/", "docs/"];
const META_FILENAMES = new Set([
  "README.md",
  "CLAUDE.md",
  "package.json",
  "package-lock.json",
  "tsconfig.json",
  ".gitignore",
  ".eslintrc.json",
  ".prettierrc",
]);

function isMetaPath(path: string): boolean {
  if (META_FILENAMES.has(path)) return true;
  if (META_PREFIXES.some((p) => path.startsWith(p))) return true;
  if (path.endsWith(".md") && !path.includes("/")) return true;
  return false;
}

const metaOnly = changedFiles.length > 0 && changedFiles.every(isMetaPath);

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

const sql = neon(process.env.DATABASE_URL);
const db = drizzle({ client: sql });

/* ── 1. Fetch open tickets + features ──────────────────────────── */

async function fetchOpenTickets() {
  return db.select().from(tickets).where(ne(tickets.status, "done"));
}

async function fetchAllFeatures() {
  return db.select().from(features);
}

/* ── 2. Ask AI which tickets this push touches ─────────────────── */

type Proposal = {
  ticketId: string;
  newStatus: "backlog" | "todo" | "in-progress" | "review" | "done" | null;
  activityText: string;
  confidence: "high" | "medium" | "low";
  evidenceFiles: string[];
  evidenceTicketQuote: string;
};

async function proposeUpdates(
  openTickets: { id: string; title: string; description: string | null; status: string; domain: string | null }[],
): Promise<Proposal[]> {
  const openai = new OpenAI();

  const eventFraming = (() => {
    switch (eventKind) {
      case "pr-opened":
      case "pr-reopened":
        return `A pull request was just opened. Propose "review" for tickets whose work this PR contains. Do NOT propose "done" — the PR hasn't merged yet.`;
      case "pr-ready_for_review":
        return `A pull request was marked ready for review (out of draft). Propose "review" for tickets whose work this PR contains. Do NOT propose "done".`;
      case "pr-synchronize":
        return `New commits were pushed to an open PR. Generally propose newStatus: null (activity-only) unless the new commits clearly pivot the scope.`;
      default:
        return `A push just landed on main. If the work clearly closes a ticket (e.g. "closes #", full feature landed), propose "done"; otherwise "in-progress" or null.`;
    }
  })();

  const prompt = `You are a backlog-sync agent for Odyssey (a voice-first AI simulation engine).

${eventFraming}

Decide which open tickets are impacted and what their new status should be.

Commit message:
${commitMsg}

${prTitle ? `PR title: ${prTitle}\n` : ""}${prNumber ? `PR #${prNumber}\n` : ""}${branch ? `Branch: ${branch}\n` : ""}${diffSummary ? `Diff summary: ${diffSummary}\n` : ""}
Changed files:
${changedFiles.slice(0, 100).join("\n") || "(none reported)"}

Open tickets (id — [status] title — description):
${openTickets
  .map(
    (t) =>
      `${t.id} — [${t.status}] ${t.title}${t.description ? ` — ${t.description.slice(0, 500)}` : ""}`,
  )
  .join("\n")}

For each ticket you believe this push directly advances, return an update. Skip tickets that are not directly advanced by this commit's code.

Return EXACTLY this JSON (no markdown fences, no extra text):
{
  "updates": [
    {
      "ticketId": "<id>",
      "newStatus": "backlog" | "todo" | "in-progress" | "review" | "done" | null,
      "activityText": "<one-sentence human-readable note about what this push did for this ticket>",
      "confidence": "high" | "medium" | "low",
      "evidenceFiles": ["<path>", "..."],
      "evidenceTicketQuote": "<verbatim phrase from THIS ticket's description that names the scope this commit delivered>"
    }
  ]
}

Rules — read carefully:
- evidenceFiles MUST be non-empty and MUST be drawn verbatim from the "Changed files" list above.
- evidenceTicketQuote MUST be a verbatim substring (≥ 6 words, ≥ 30 chars) copied from THIS ticket's description above. It must name the specific scope that this commit's code actually delivers — NOT just a word that happens to appear in both.
- Do NOT match on vocabulary overlap alone. Example of what NOT to do: matching an admin UI polish commit to a ticket about "browser mic → Kyutai STT → Claude LLM → Kyutai TTS" just because both mention "Claude" or "voice". The commit's code must literally advance the quoted scope.
- Example of what NOT to do: matching a commit that polishes the /characters list admin page to a ticket whose description is "Create all nodes: World Core, Characters (Abraham, Sarah, Isaac, three angels with emotional baselines)" — those are different scopes ("admin list UI" vs "authoring narrative character nodes in a world canvas") even though both contain the word "characters".
- "high" = the commit's code changes literally deliver what the quote describes. Anything less is medium at best.
- "medium" = plausibly advances the quoted scope but the relationship is partial or indirect.
- "low" = tangential.
- If a ticket is in status "backlog", matching it means you're promoting it. Only do so when the commit is unmistakably the start of that specific work.
- newStatus: "in-progress" when work starts or continues; "review" when complete and up for review; "done" only if the commit unambiguously closes it (merged work / "closes #"); null for activity-only.
- Prefer fewer, higher-quality updates. Return at most 3. Empty "updates" is the correct answer for infra/CI/tooling pushes or when no ticket is directly advanced.`;

  const response = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    max_tokens: 1600,
    messages: [{ role: "user", content: prompt }],
  });

  const text = response.choices[0]?.message?.content ?? "";
  try {
    const parsed = JSON.parse(text.trim());
    const updates = Array.isArray(parsed?.updates) ? parsed.updates : [];
    const validStatus = new Set(["backlog", "todo", "in-progress", "review", "done"]);
    const validConfidence = new Set(["high", "medium", "low"]);
    return updates
      .filter((u: unknown): u is Proposal => {
        const x = u as Partial<Proposal>;
        return (
          typeof x.ticketId === "string" &&
          typeof x.activityText === "string" &&
          validConfidence.has(x.confidence as string) &&
          (x.newStatus === null || validStatus.has(x.newStatus as string)) &&
          Array.isArray(x.evidenceFiles) &&
          x.evidenceFiles.length > 0 &&
          x.evidenceFiles.every((f) => typeof f === "string") &&
          typeof x.evidenceTicketQuote === "string" &&
          x.evidenceTicketQuote.trim().length >= 30
        );
      })
      // On PR events the PR hasn't merged yet, so "done" is always premature.
      // Downgrade to "review" rather than drop so we still surface the match.
      .map((p) =>
        isPrEvent && p.newStatus === "done" ? { ...p, newStatus: "review" as const } : p,
      )
      // Hard cap — a single commit rarely legitimately advances more than this.
      .slice(0, 3);
  } catch (err) {
    console.warn("Failed to parse LLM response; no proposals applied.", err);
    return [];
  }
}

/* ── Grounding: validate evidence + calibrate confidence ───────── */
// Two checks:
//   1. Reject proposals whose evidenceFiles aren't actually in the push
//      (catches fabricated paths).
//   2. Downgrade "high" to "medium" when no evidence-file path tokens
//      overlap with the ticket's title/description/domain (catches the
//      "WebSocket streaming hallucination" failure mode).

const changedFileSet = new Set(changedFiles);

function pathTokens(path: string): string[] {
  return path
    .toLowerCase()
    .split(/[/._\-\s]+/)
    .filter((t) => t.length >= 4);
}

function ticketTokens(ticket: {
  title: string;
  description: string | null;
  domain: string | null;
}): Set<string> {
  const blob = [ticket.title, ticket.description ?? "", ticket.domain ?? ""]
    .join(" ")
    .toLowerCase();
  return new Set(blob.split(/[^a-z0-9]+/).filter((t) => t.length >= 4));
}

function normalize(s: string): string {
  return s.toLowerCase().replace(/\s+/g, " ").trim();
}

function calibrate(
  proposal: Proposal,
  ticket: { title: string; description: string | null; domain: string | null },
): { proposal: Proposal; reject?: string } {
  const realEvidence = proposal.evidenceFiles.filter((f) => changedFileSet.has(f));
  if (realEvidence.length === 0) {
    return { proposal, reject: "no cited file was actually in the push" };
  }

  // The quote must be a verbatim substring of the ticket description (case-
  // and whitespace-insensitive). Catches fabricated quotes and prevents
  // matching on title-only keywords.
  const fullText = normalize(`${ticket.title} ${ticket.description ?? ""}`);
  const quote = normalize(proposal.evidenceTicketQuote);
  if (!quote || !fullText.includes(quote)) {
    return { proposal, reject: `quote not found in ticket text: "${proposal.evidenceTicketQuote.slice(0, 60)}…"` };
  }

  const ticketBag = ticketTokens(ticket);
  const hasOverlap = realEvidence.some((f) =>
    pathTokens(f).some((tok) => ticketBag.has(tok)),
  );
  const calibratedConfidence: Proposal["confidence"] =
    proposal.confidence === "high" && !hasOverlap ? "medium" : proposal.confidence;

  return {
    proposal: {
      ...proposal,
      evidenceFiles: realEvidence,
      confidence: calibratedConfidence,
    },
  };
}

/* ── 3. Apply proposals (activity always; status only if allowed) ─ */

function makeActivityItem(text: string): ActivityItem {
  return {
    id: crypto.randomUUID(),
    author: "ai-sync",
    authorColor: "#8B5CF6",
    timestamp: new Date().toISOString(),
    text,
    type: "system",
  };
}

async function applyProposal(
  ticket: { id: string; status: string; activity: unknown; featureId: string | null },
  proposal: Proposal,
): Promise<{ touchedFeatureId: string | null; statusChanged: boolean }> {
  const prefix =
    proposal.confidence === "high"
      ? "[sync]"
      : proposal.confidence === "medium"
      ? "[sync · medium confidence]"
      : "[sync · low confidence]";
  const shortSha = commitSha.slice(0, 7);
  const shaRef = prNumber ? `PR #${prNumber} (${shortSha})` : shortSha;
  const proposedStatusNote =
    proposal.newStatus && proposal.newStatus !== ticket.status
      ? ` · proposed status → ${proposal.newStatus}`
      : "";
  const evidenceNote = proposal.evidenceFiles.length
    ? ` · files: ${proposal.evidenceFiles.slice(0, 3).join(", ")}`
    : "";
  const quoteNote = ` · scope: "${proposal.evidenceTicketQuote.slice(0, 120)}"`;
  const note = `${prefix} ${shaRef}: ${proposal.activityText}${proposedStatusNote}${quoteNote}${evidenceNote}`;

  const existing = Array.isArray(ticket.activity) ? (ticket.activity as ActivityItem[]) : [];
  const nextActivity = [...existing, makeActivityItem(note)];

  const shouldMutateStatus =
    applyUpdates &&
    proposal.confidence === "high" &&
    proposal.newStatus !== null &&
    proposal.newStatus !== ticket.status;

  await db
    .update(tickets)
    .set({
      activity: nextActivity,
      ...(shouldMutateStatus ? { status: proposal.newStatus! } : {}),
      updatedAt: new Date(),
    })
    .where(eq(tickets.id, ticket.id));

  return { touchedFeatureId: ticket.featureId, statusChanged: shouldMutateStatus };
}

/* ── 4. Deterministic feature-status rollup ────────────────────── */

function rollupStatus(childStatuses: string[]): "planned" | "active" | "done" {
  if (childStatuses.length === 0) return "planned";
  if (childStatuses.every((s) => s === "done")) return "done";
  if (childStatuses.some((s) => s === "in-progress" || s === "review" || s === "todo")) return "active";
  return "planned";
}

async function rollupFeatures(featureIds: Set<string>) {
  if (!applyUpdates || featureIds.size === 0) return;
  for (const fid of featureIds) {
    const children = await db.select({ status: tickets.status }).from(tickets).where(eq(tickets.featureId, fid));
    const next = rollupStatus(children.map((c) => c.status));
    const [feature] = await db.select().from(features).where(eq(features.id, fid)).limit(1);
    if (!feature || feature.status === next) continue;
    await db.update(features).set({ status: next, updatedAt: new Date() }).where(eq(features.id, fid));
    console.log(`Feature ${fid} rolled up: ${feature.status} → ${next}`);
  }
}

/* ── Main ──────────────────────────────────────────────────────── */

async function main() {
  console.log(
    `sync-backlog: ${commitSha.slice(0, 7)} — event=${eventKind} apply=${applyUpdates}`,
  );

  if (metaOnly) {
    console.log(
      `Meta-only push (${changedFiles.length} file(s) under .github/ · scripts/ · docs/ · top-level config). Skipping LLM.`,
    );
    return;
  }

  const openTickets = await fetchOpenTickets();
  if (openTickets.length === 0) {
    console.log("No open tickets; nothing to sync.");
    return;
  }

  const rawProposals = await proposeUpdates(openTickets);
  console.log(`Received ${rawProposals.length} raw proposal(s).`);

  const byId = new Map(openTickets.map((t) => [t.id, t]));
  const touchedFeatures = new Set<string>();

  for (const raw of rawProposals) {
    const ticket = byId.get(raw.ticketId);
    if (!ticket) {
      console.warn(`Proposal references unknown ticket ${raw.ticketId}; skipping.`);
      continue;
    }

    const { proposal, reject } = calibrate(raw, ticket);
    if (reject) {
      console.warn(`  ${raw.ticketId} rejected — ${reject}`);
      continue;
    }
    if (raw.confidence !== proposal.confidence) {
      console.log(
        `  ${proposal.ticketId} confidence ${raw.confidence} → ${proposal.confidence} (no path/ticket overlap)`,
      );
    }

    const { touchedFeatureId, statusChanged } = await applyProposal(ticket, proposal);
    console.log(
      `  ${proposal.ticketId} [${proposal.confidence}] ${statusChanged ? "APPLIED" : "proposed"} — ${proposal.activityText}`,
    );
    if (statusChanged && touchedFeatureId) touchedFeatures.add(touchedFeatureId);
  }

  await rollupFeatures(touchedFeatures);
  console.log("Done.");
}

main().catch((err) => {
  console.error("sync-backlog failed:", err);
  process.exit(1);
});
