"use client";

import { useEffect } from "react";
import Link from "next/link";
import { useHeaderContent } from "@/components/header-context";

export function DocHeader({ title }: { title: string }) {
  const { setContent } = useHeaderContent();

  useEffect(() => {
    setContent(
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <Link
          href="/docs"
          style={{
            fontSize: 16,
            fontWeight: 700,
            color: "var(--muted)",
            textDecoration: "none",
            whiteSpace: "nowrap",
          }}
        >
          Docs
        </Link>
        <span style={{ color: "var(--muted)", fontSize: 14 }}>/</span>
        <span
          style={{
            fontSize: 16,
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
