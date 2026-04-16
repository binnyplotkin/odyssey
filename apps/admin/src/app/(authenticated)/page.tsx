import fs from "fs/promises";
import path from "path";
import matter from "gray-matter";
import {
  getVersionStore,
  getFeatureStore,
  getTicketStore,
  getChangelogStore,
} from "@odyssey/db";
import DashboardClient from "./dashboard-client";

export const dynamic = "force-dynamic";

async function loadDocs() {
  const docsDir = path.resolve(process.cwd(), "../../docs");
  try {
    const files = await fs.readdir(docsDir);
    const docs = await Promise.all(
      files
        .filter((f) => f.endsWith(".md") || f.endsWith(".mdx"))
        .map(async (f) => {
          const id = f.replace(/\.mdx?$/, "");
          const raw = await fs.readFile(path.join(docsDir, f), "utf-8");
          const { data: frontmatter, content } = matter(raw);
          const firstLine = content.split("\n").find((l) => l.startsWith("# "));
          const title = (frontmatter.title as string) || (firstLine ? firstLine.replace(/^#\s+/, "") : id);
          const stat = await fs.stat(path.join(docsDir, f));
          return { id, title, updatedAt: stat.mtime.toISOString() };
        }),
    );
    docs.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    return docs;
  } catch {
    return [];
  }
}

export default async function DashboardPage() {
  const [versions, features, tickets, changelog, docs] = await Promise.all([
    getVersionStore().list(),
    getFeatureStore().list(),
    getTicketStore().list(),
    getChangelogStore().list(),
    loadDocs(),
  ]);

  // Build version summaries with feature/ticket rollups
  const versionSummaries = versions.map((v) => {
    const vFeatures = features.filter((f) => f.versionId === v.id);
    const vTicketIds = new Set(vFeatures.map((f) => f.id));
    const vTickets = tickets.filter((t) => t.featureId && vTicketIds.has(t.featureId));
    const doneTickets = vTickets.filter((t) => t.status === "done").length;
    return {
      id: v.id,
      tag: v.tag,
      title: v.title,
      color: v.color,
      status: v.status,
      startDate: v.startDate,
      endDate: v.endDate,
      featureCount: vFeatures.length,
      features: vFeatures.map((f) => {
        const fTickets = tickets.filter((t) => t.featureId === f.id);
        const fDone = fTickets.filter((t) => t.status === "done").length;
        return {
          id: f.id,
          title: f.title,
          status: f.status,
          color: f.color ?? v.color,
          ticketCount: fTickets.length,
          doneTicketCount: fDone,
        };
      }),
      ticketCount: vTickets.length,
      doneTicketCount: doneTickets,
    };
  });

  // Ticket breakdowns
  const ticketsByStatus: Record<string, number> = {};
  const ticketsByDomain: Record<string, number> = {};
  const ticketsByPriority: Record<string, number> = {};
  for (const t of tickets) {
    ticketsByStatus[t.status] = (ticketsByStatus[t.status] ?? 0) + 1;
    if (t.domain) ticketsByDomain[t.domain] = (ticketsByDomain[t.domain] ?? 0) + 1;
    if (t.priority) ticketsByPriority[t.priority] = (ticketsByPriority[t.priority] ?? 0) + 1;
  }

  return (
    <DashboardClient
      versions={versionSummaries}
      totalFeatures={features.length}
      totalTickets={tickets.length}
      openTickets={tickets.filter((t) => t.status !== "done").length}
      ticketsByStatus={ticketsByStatus}
      ticketsByDomain={ticketsByDomain}
      ticketsByPriority={ticketsByPriority}
      recentChangelog={changelog.slice(0, 8)}
      docs={docs}
    />
  );
}
