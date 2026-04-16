"use client";

import { useEffect } from "react";
import Link from "next/link";
import type { DocEntry } from "./page";
import { useHeaderContent } from "@/components/header-context";

const CARD_GRADIENTS = [
  "linear-gradient(135deg, #0a2e1f 0%, #1a5c3a 50%, #071f14 100%)", // Emerald Deep
  "linear-gradient(135deg, #0b1a3a 0%, #153060 50%, #060f26 100%)", // Midnight Navy
  "linear-gradient(135deg, #2a1a0a 0%, #4a2e12 50%, #1a0f04 100%)", // Burnt Amber
  "linear-gradient(135deg, #1a0a2e 0%, #2e145a 50%, #14082a 100%)", // Violet Abyss
  "linear-gradient(135deg, #2e0a12 0%, #501828 50%, #260a14 100%)", // Crimson Shadow
  "linear-gradient(135deg, #0f2a12 0%, #1e5420 50%, #0c2414 100%)", // Forest Depths
];

export function DocsListClient({ docs }: { docs: DocEntry[] }) {
  const { setContent } = useHeaderContent();

  useEffect(() => {
    setContent(
      <h1 style={{ fontSize: 16, fontWeight: 700, color: "var(--foreground, #fff)", margin: 0, whiteSpace: "nowrap" }}>
        Docs
      </h1>
    );
    return () => setContent(null);
  }, [setContent]);

  return (
    <div style={{ width: "100%", display: "flex", flexDirection: "column", gap: 12 }}>
      {docs.length === 0 ? (
        <p style={{ color: "var(--muted)", fontSize: "0.875rem", padding: "32px" }}>
          No documents found. Add <code>.md</code> or <code>.mdx</code> files to the <code>docs/</code> directory.
        </p>
      ) : (
        docs.map((doc, i) => {
          const imageLeft = i % 2 === 0;
          const gradient = CARD_GRADIENTS[doc.gradientIndex % CARD_GRADIENTS.length];

          const gradientPanel = (
            <div
              style={{
                flex: 1,
                minHeight: 280,
                background: gradient,
              }}
            />
          );

          const textPanel = (
            <div
              style={{
                flex: 1,
                display: "flex",
                flexDirection: "column",
                justifyContent: "space-between",
                padding: "40px 40px",
                gap: 20,
                background: "var(--panel)",
              }}
            >
              <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                <span
                  style={{
                    fontSize: "0.8125rem",
                    fontWeight: 700,
                    color: "var(--muted)",
                    letterSpacing: "0.015em",
                  }}
                >
                  {new Date(doc.updatedAt).toLocaleDateString("en-US", {
                    year: "numeric",
                    month: "long",
                    day: "numeric",
                  })}
                </span>
              </div>

              <div style={{ display: "flex", flexDirection: "column", gap: 16, flex: 1 }}>
                <h2
                  style={{
                    fontSize: "1.75rem",
                    fontWeight: 600,
                    color: "var(--foreground)",
                    margin: 0,
                    lineHeight: 1.2,
                    letterSpacing: "-0.02em",
                  }}
                >
                  {doc.title}
                </h2>

                {doc.preview && (
                  <p
                    style={{
                      fontSize: "0.9375rem",
                      color: "var(--muted)",
                      margin: 0,
                      lineHeight: 1.6,
                      display: "-webkit-box",
                      WebkitLineClamp: 4,
                      WebkitBoxOrient: "vertical" as const,
                      overflow: "hidden",
                    }}
                  >
                    {doc.preview}
                  </p>
                )}
              </div>

              <span
                style={{
                  fontSize: "0.9375rem",
                  color: "var(--accent-strong, #8DFCCB)",
                  fontWeight: 500,
                }}
              >
                read article →
              </span>
            </div>
          );

          return (
            <Link
              key={doc.id}
              href={`/docs/${doc.id}`}
              style={{
                display: "flex",
                flexDirection: imageLeft ? "row" : "row-reverse",
                borderRadius: 14,
                border: "1px solid var(--border)",
                overflow: "hidden",
                textDecoration: "none",
                color: "inherit",
                transition: "border-color 200ms",
              }}
            >
              {gradientPanel}
              {textPanel}
            </Link>
          );
        })
      )}
    </div>
  );
}
