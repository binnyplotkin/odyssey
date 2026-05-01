"use client";

import { useEffect } from "react";
import { Skeleton } from "@odyssey/ui";
import { useHeaderContent } from "@/components/header-context";

// Suspense fallback for CharacterHeaderShell — pushes a layout-shaped
// skeleton into the shared header slot so the visible chrome (back arrow,
// avatar/title, tabs, action buttons) shimmers in place rather than
// flashing the parent /characters list loader.

export function CharacterHeaderSkeleton() {
  const { setContent } = useHeaderContent();

  useEffect(() => {
    setContent(
      <>
        {/* Back arrow */}
        <Skeleton width={28} height={28} radius={6} style={{ marginRight: 14, flexShrink: 0 }} />

        {/* Avatar + title */}
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
          <Skeleton width={24} height={24} variant="circle" />
          <Skeleton width={140} height={16} />
        </div>

        {/* Vertical divider */}
        <span
          style={{
            width: 1,
            height: 20,
            background: "var(--border)",
            display: "block",
            marginLeft: 14,
            marginRight: 14,
            flexShrink: 0,
          }}
        />

        {/* Tab pills */}
        <div style={{ display: "flex", alignItems: "center", gap: 4, flexShrink: 0 }}>
          {[68, 56, 68, 76].map((w, i) => (
            <Skeleton key={i} width={w} height={24} radius={8} static />
          ))}
        </div>

        <div style={{ flex: 1 }} />

        {/* Action buttons */}
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexShrink: 0 }}>
          <Skeleton width={76} height={26} radius={8} static />
          <Skeleton width={64} height={26} radius={8} static />
        </div>
      </>,
    );
    return () => setContent(null);
  }, [setContent]);

  return null;
}
