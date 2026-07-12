"use client";

import { useEffect } from "react";
import { useHeaderContent } from "@/components/header-context";

/** Skeleton for /sounds — ghost toolbar + card grid matching the live
 * layout so the swap-in doesn't shift. */
export default function SoundsLoading() {
  const { setFlush } = useHeaderContent();
  useEffect(() => {
    setFlush(true);
    return () => setFlush(false);
  }, [setFlush]);

  return (
    <div
      style={{
        minHeight: "100%",
        background: "var(--background)",
        display: "flex",
        flexDirection: "column",
      }}
    >
      <style>{`@keyframes sounds-shimmer{0%{opacity:.45}50%{opacity:.85}100%{opacity:.45}}`}</style>
      <div style={{ display: "flex", gap: 16, padding: "24px 40px" }}>
        <Ghost w={360} h={38} r="var(--radius-pill)" />
        <Ghost w={140} h={38} r="var(--radius-pill)" />
      </div>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(360px, 1fr))",
          gap: "var(--space-16)",
          width: "100%",
          padding: "0 40px 56px",
        }}
      >
        {Array.from({ length: 8 }).map((_, i) => (
          <div
            key={i}
            style={{
              height: 180,
              borderRadius: "var(--radius-2xl)",
              background: "var(--material-card)",
              border: "1px solid var(--border-subtle)",
              animation: "sounds-shimmer 1.4s ease-in-out infinite",
              animationDelay: `${i * 90}ms`,
            }}
          />
        ))}
      </div>
    </div>
  );
}

function Ghost({ w, h, r }: { w: number; h: number; r: string }) {
  return (
    <div
      style={{
        width: w,
        height: h,
        borderRadius: r,
        background: "var(--ink-fill)",
        animation: "sounds-shimmer 1.4s ease-in-out infinite",
      }}
    />
  );
}
