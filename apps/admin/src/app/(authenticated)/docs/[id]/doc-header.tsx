"use client";

import { useEffect } from "react";
import Link from "next/link";
import { useHeaderContent } from "@/components/header-context";

export function DocHeader({ title }: { title: string }) {
  const { setContent } = useHeaderContent();

  useEffect(() => {
    setContent(
      <div style={{ display: "flex", alignItems: "center", gap: "var(--space-8)" }}>
        <Link
          href="/docs"
          style={{
            fontSize: "var(--font-size-xl)",
            fontWeight: 700,
            color: "var(--muted)",
            textDecoration: "none",
            whiteSpace: "nowrap",
          }}
        >
          Docs
        </Link>
        <span style={{ color: "var(--muted)", fontSize: "var(--font-size-lg)" }}>/</span>
        <span
          style={{
            fontSize: "var(--font-size-xl)",
            fontWeight: 700,
            color: "var(--foreground, #fff)",
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
          }}
        >
          {title}
        </span>
      </div>
    );
    return () => setContent(null);
  }, [title, setContent]);

  return null;
}
