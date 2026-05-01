"use client";

import { useEffect } from "react";
import { Skeleton } from "@odyssey/ui";
import { useHeaderContent } from "@/components/header-context";

// Suspense fallback for WorldHeaderShell — pushes a layout-shaped skeleton
// into the shared header slot so the visible chrome (back arrow, globe +
// title + status pill, tabs, action button) shimmers in place rather than
// flashing the parent /worlds list loader.

export function WorldHeaderSkeleton() {
  const { setContent } = useHeaderContent();

  useEffect(() => {
    setContent(
      <>
        {/* Back arrow */}
        <Skeleton width={28} height={28} radius={6} style={{ marginRight: 14, flexShrink: 0 }} />

        {/* Globe icon + title + status pill */}
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexShrink: 0 }}>
          <Skeleton width={18} height={18} variant="circle" />
          <Skeleton width={160} height={17} />
          <Skeleton width={64} height={20} radius={9999} static />
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
          {[68, 56, 64, 64].map((w, i) => (
            <Skeleton key={i} width={w} height={24} radius={8} static />
          ))}
        </div>

        <div style={{ flex: 1 }} />

        {/* Action button */}
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexShrink: 0 }}>
          <Skeleton width={104} height={26} radius={8} static />
        </div>
      </>,
    );
    return () => setContent(null);
  }, [setContent]);

  return null;
}
