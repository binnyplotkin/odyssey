"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type {
  EraConfig,
  WikiEdgeRecord,
  WikiPageRecord,
  WikiSourceRecord,
  WikiSourceRefRecord,
} from "@odyssey/db";
import { DetailCard } from "@/components/character-wiki";
import { WikiPageEditor } from "@/components/wiki-page-editor";

const T = {
  fg: "var(--foreground)",
  muted: "var(--muted)",
  panel: "var(--panel)",
  border: "var(--border)",
  fontHeading: "'Space Grotesk', sans-serif",
  fontBody: "'Inter', sans-serif",
  fontMono: "var(--font-mono, 'JetBrains Mono', monospace)",
};

type Props = {
  characterId: string;
  characterSlug: string;
  characterTitle: string;
  eras: EraConfig[];
  page: WikiPageRecord;
  pages: WikiPageRecord[];
  edges: WikiEdgeRecord[];
  sources: WikiSourceRecord[];
  sourceRefs: WikiSourceRefRecord[];
  initialEditing?: boolean;
};

export function WikiPageView({
  characterId,
  characterSlug,
  characterTitle,
  eras,
  page,
  pages,
  edges,
  sources,
  sourceRefs,
  initialEditing,
}: Props) {
  const router = useRouter();
  const [editing, setEditing] = useState(!!initialEditing);

  const pageById = useMemo(
    () => new Map(pages.map((p) => [p.id, p] as const)),
    [pages],
  );
  const pageBySlug = useMemo(
    () => new Map(pages.map((p) => [p.slug, p] as const)),
    [pages],
  );
  const sourceById = useMemo(
    () => new Map(sources.map((s) => [s.id, s] as const)),
    [sources],
  );

  // Strip ?edit=1 once consumed so a refresh lands in read mode unless the
  // user opens the editor again. Mirrors the wiki-tab behavior.
  useEffect(() => {
    if (!initialEditing) return;
    if (typeof window === "undefined") return;
    const url = new URL(window.location.href);
    if (url.searchParams.has("edit")) {
      url.searchParams.delete("edit");
      window.history.replaceState({}, "", url.toString());
    }
  }, [initialEditing]);

  function navigateToSlug(slug: string) {
    if (slug === page.slug) return;
    router.push(`/characters/${characterSlug}/wiki/${slug}`);
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16, maxWidth: 960, margin: "0 auto", width: "100%" }}>
      <Breadcrumb characterSlug={characterSlug} characterTitle={characterTitle} pageTitle={page.title} />

      {editing ? (
        <div
          style={{
            display: "flex", flexDirection: "column",
            background: T.panel, border: `1px solid ${T.border}`,
            borderRadius: 14, overflow: "clip",
          }}
        >
          <WikiPageEditor
            characterId={characterId}
            page={page}
            eras={eras}
            onSaved={(savedSlug) => {
              setEditing(false);
              if (savedSlug !== page.slug) {
                router.replace(`/characters/${characterSlug}/wiki/${savedSlug}`);
              } else {
                router.refresh();
              }
            }}
            onCancel={() => setEditing(false)}
          />
        </div>
      ) : (
        <DetailCard
          page={page}
          edges={edges}
          pageById={pageById}
          pageBySlug={pageBySlug}
          sourceById={sourceById}
          sourceRefs={sourceRefs}
          onNavigate={navigateToSlug}
          onEdit={() => setEditing(true)}
          router={router}
          standalone
        />
      )}
    </div>
  );
}

function Breadcrumb({
  characterSlug, characterTitle, pageTitle,
}: { characterSlug: string; characterTitle: string; pageTitle: string }) {
  return (
    <nav
      aria-label="Breadcrumb"
      style={{
        display: "flex", alignItems: "center", gap: 8,
        fontFamily: T.fontBody, fontSize: 12, color: T.muted,
      }}
    >
      <Link
        href={`/characters/${characterSlug}/wiki`}
        style={{
          display: "inline-flex", alignItems: "center", gap: 6,
          color: T.muted, textDecoration: "none",
        }}
      >
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.25" strokeLinecap="round">
          <polyline points="15 18 9 12 15 6" />
        </svg>
        <span>{characterTitle} · Wiki</span>
      </Link>
      <span style={{ color: T.muted }}>/</span>
      <span style={{ color: T.fg, fontWeight: 500 }}>{pageTitle}</span>
    </nav>
  );
}
