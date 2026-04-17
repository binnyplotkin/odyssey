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
};

async function proposeUpdates(
  openTickets: { id: string; title: string; description: string | null; status: string; domain: string | null }[],
): Promise<Proposal[]> {
  const openai = new OpenAI();

  const prompt = `You are a backlog-sync agent for Odyssey (a voice-first AI simulation engine).

A push just landed on main. Decide which open tickets are impacted and what their new status should be.

Commit message:
${commitMsg}

${prTitle ? `PR title: ${prTitle}\n` : ""}${prNumber ? `PR #${prNumber}\n` : ""}${branch ? `Branch: ${branch}\n` : ""}${diffSummary ? `Diff summary: ${diffSummary}\n` : ""}
Changed files:
${changedFiles.slice(0, 100).join("\n") || "(none reported)"}

Open tickets (id — [status] title — description):
${openTickets
  .map(
    (t) =>
      `${t.id} — [${t.status}] ${t.title}${t.description ? ` — ${t.description.slice(0, 140)}` : ""}`,
  )
  .join("\n")}

For each ticket you believe this push touches, return an update. Skip tickets that are clearly unrelated.

Return EXACTLY this JSON (no markdown fences, no extra text):
{
  "updates": [
    {
      "ticketId": "<id>",
      "newStatus": "backlog" | "todo" | "in-progress" | "review" | "done" | null,
      "activityText": "<one-sentence human-readable note about what this push did for this ticket>",
      "confidence": "high" | "medium" | "low"
    }
  ]
}

Rules:
- "high" = file paths + commit message unambiguously match a ticket's scope.
- "medium" = plausible match but the commit touches multiple areas.
- "low" = tangential; you're reporting it but wouldn't bet on it.
- newStatus: "in-progress" if this push is partial progress; "review"/"done" only if the commit clearly closes the work (e.g. "closes #", "complete", full feature landed); null if you only want to log activity without changing status.
- Prefer fewer, higher-quality updates over many speculative ones. Empty "updates" is a valid answer.`;

  const response = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    max_tokens: 1024,
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
          (x.newStatus === null || validStatus.has(x.newStatus as string))
        );
      })
      .slice(0, 20);
  } catch (err) {
    console.warn("Failed to parse LLM response; no proposals applied.", err);
    return [];
  }
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
  const note = `${prefix} ${shaRef}: ${proposal.activityText}${proposedStatusNote}`;

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
  console.log(`sync-backlog: ${commitSha.slice(0, 7)} — apply=${applyUpdates}`);

  const openTickets = await fetchOpenTickets();
  if (openTickets.length === 0) {
    console.log("No open tickets; nothing to sync.");
    return;
  }

  const proposals = await proposeUpdates(openTickets);
  console.log(`Received ${proposals.length} proposal(s).`);

  const byId = new Map(openTickets.map((t) => [t.id, t]));
  const touchedFeatures = new Set<string>();

  for (const p of proposals) {
    const ticket = byId.get(p.ticketId);
    if (!ticket) {
      console.warn(`Proposal references unknown ticket ${p.ticketId}; skipping.`);
      continue;
    }
    const { touchedFeatureId, statusChanged } = await applyProposal(ticket, p);
    console.log(
      `  ${p.ticketId} [${p.confidence}] ${statusChanged ? "APPLIED" : "proposed"} — ${p.activityText}`,
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
