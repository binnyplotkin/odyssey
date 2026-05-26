"use client";

import { useEffect } from "react";
import { Skeleton } from "@odyssey/ui";
import { useHeaderContent } from "@/components/header-context";

/**
 * Suspense fallback for CharacterHeaderShell. Each subpage injects its
 * own header once it loads (CharacterConfig has breadcrumb + version
 * dropdown + Sandbox link; chat has its own immersive header; etc.), so
 * this fallback only needs to render the common shape they all share —
 * an avatar tile + breadcrumb crumb. Anything beyond that varies per
 * page and would jump visually when the real header lands.
 */

export function CharacterHeaderSkeleton() {
  const { setContent } = useHeaderContent();

  useEffect(() => {
    setContent(
      <div
        style={{
          display: "flex",
          alignItems: "center",
          width: "100%",
          minWidth: 0,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "var(--space-12)", flexShrink: 0 }}>
          {/* Avatar tile */}
          <Skeleton width={22} height={22} radius={0} />
          {/* Breadcrumb: "characters / <title>" */}
          <div style={{ display: "flex", alignItems: "center", gap: "var(--space-8)" }}>
            <Skeleton width={68} height={12} />
            <span style={{ color: "var(--muted)", opacity: 0.5 }}>/</span>
            <Skeleton width={120} height={14} />
          </div>
        </div>
        <div style={{ flex: 1 }} />
      </div>,
    );
    return () => setContent(null);
  }, [setContent]);

  return null;
}
