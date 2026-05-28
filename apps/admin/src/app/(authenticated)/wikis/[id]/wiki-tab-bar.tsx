"use client";

import Link from "next/link";
import { TabBar, type TabItem } from "@/components/tab-bar";

export type WikiTabKey =
  | "overview"
  | "pages"
  | "knowledge"
  | "sources"
  | "runs"
  | "ingestion";

const ACCENT = "var(--accent-strong)";
const DIVIDER = "var(--border)";
const MONO = '"JetBrains Mono", monospace';

type WikiTabDef = {
  key: Exclude<WikiTabKey, "ingestion">;
  label: string;
  href: (wikiId: string) => string;
};

const TAB_DEFS: WikiTabDef[] = [
  { key: "overview", label: "Overview", href: (id) => `/wikis/${id}` },
  { key: "knowledge", label: "Graph", href: (id) => `/wikis/${id}/knowledge` },
  { key: "pages", label: "Pages", href: (id) => `/wikis/${id}/pages` },
  { key: "sources", label: "Sources", href: (id) => `/wikis/${id}/sources` },
  { key: "runs", label: "Runs", href: (id) => `/wikis/${id}/runs` },
];

/**
 * Wiki-route tabs for the admin-shell header. Built on the generic
 * `TabBar` primitive (terminal-style segments with border-x, mono
 * labels, accent under-bar on active/hover). Ingestion lives on the
 * trailing edge as a "+" segment — it's an action, not a peer view.
 */
export function WikiTabBar({
  wikiId,
  active,
}: {
  wikiId: string;
  active: WikiTabKey;
}) {
  const items: TabItem<Exclude<WikiTabKey, "ingestion">>[] = TAB_DEFS.map(
    (def) => ({
      key: def.key,
      label: def.label,
      href: def.href(wikiId),
    }),
  );

  // The TabBar uses a narrower union than WikiTabKey (it doesn't know
  // about "ingestion"); pass `null` when ingestion is active so no tab
  // shows highlighted — the trailing button shows the active state
  // itself.
  const tabActive: Exclude<WikiTabKey, "ingestion"> | null =
    active === "ingestion" ? null : active;

  return (
    <TabBar
      items={items}
      active={tabActive}
      trailing={
        <IngestionAction wikiId={wikiId} active={active === "ingestion"} />
      }
    />
  );
}

/**
 * Trailing "+" segment. Sized and bordered to match the tab segments so
 * the row reads as a continuous strip; visually distinguished by the
 * accent color on the icon (and inverted bg when on the ingestion route).
 */
function IngestionAction({
  wikiId,
  active,
}: {
  wikiId: string;
  active: boolean;
}) {
  return (
    <Link
      href={`/wikis/${wikiId}/ingestion`}
      aria-label="New ingestion run"
      title="New ingestion run"
      style={{
        display: "inline-flex",
        alignItems: "center",
        alignSelf: "stretch",
        justifyContent: "center",
        width: 48,
        borderRight: `1px solid ${DIVIDER}`,
        borderBottom: `2px solid ${active ? ACCENT : "transparent"}`,
        background: active ? "var(--accent-soft)" : "transparent",
        color: ACCENT,
        textDecoration: "none",
        fontFamily: MONO,
        fontSize: "var(--font-size-xl)",
        fontWeight: 500,
        transition:
          "background 120ms ease, color 120ms ease, border-color 120ms ease",
      }}
    >
      +
    </Link>
  );
}
