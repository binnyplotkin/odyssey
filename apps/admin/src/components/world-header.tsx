"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect } from "react";
import { useHeaderContent } from "@/components/header-context";

const T = {
  fg: "var(--foreground)",
  muted: "var(--muted)",
  border: "var(--border)",
  accent: "#8FD1CB",
  fontHeading: "'Space Grotesk', system-ui, sans-serif",
  fontBody: "'Inter', system-ui, sans-serif",
  fontMono: "'JetBrains Mono', ui-monospace, monospace",
};

const TABS = [
  { key: "overview", label: "Overview" },
  { key: "editor", label: "Editor" },
  { key: "sessions", label: "Sessions" },
  { key: "settings", label: "Settings" },
] as const;

type TabKey = (typeof TABS)[number]["key"];

type Props = {
  world: { id: string; title: string; status: "live" | "draft" | "archived" };
};

export function WorldHeader({ world }: Props) {
  const pathname = usePathname();
  const { setContent } = useHeaderContent();

  const activeTab: TabKey = (() => {
    for (const t of TABS) {
      if (t.key !== "overview" && pathname.includes(`/${t.key}`)) return t.key;
    }
    return "overview";
  })();

  const statusStyle = {
    live: { dot: "#7DD3A1", color: "#7DD3A1", label: "Live" },
    draft: { dot: "#F5C67A", color: "#F5C67A", label: "Draft" },
    archived: { dot: "#8B96A8", color: "#8B96A8", label: "Archived" },
  }[world.status];

  useEffect(() => {
    setContent(
      <>
        <Link
          href="/worlds"
          style={{
            display: "flex", alignItems: "center", justifyContent: "center",
            width: 28, height: 28, borderRadius: 6,
            border: `1px solid ${T.border}`, background: "transparent",
            color: T.muted, textDecoration: "none",
            marginRight: 14, flexShrink: 0,
          }}
          aria-label="Back to worlds"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.25" strokeLinecap="round">
            <polyline points="15 18 9 12 15 6" />
          </svg>
        </Link>

        <div style={{ display: "flex", alignItems: "center", gap: 10, flexShrink: 0 }}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={T.accent} strokeWidth="1.8">
            <circle cx="12" cy="12" r="9" />
            <path d="M3 12h18" />
            <path d="M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18" />
          </svg>
          <span style={{
            fontFamily: T.fontHeading, fontSize: 17, fontWeight: 600,
            letterSpacing: "-0.02em", color: T.fg, lineHeight: "22px",
            whiteSpace: "nowrap",
          }}>
            {world.title}
          </span>
          <span style={{
            display: "inline-flex", alignItems: "center", gap: 6,
            padding: "2px 8px", borderRadius: 9999,
            background: "rgba(255,255,255,0.04)",
            fontFamily: T.fontMono, fontSize: 10, fontWeight: 400,
            letterSpacing: "0.1em", textTransform: "uppercase",
            color: statusStyle.color,
          }}>
            <span style={{ width: 6, height: 6, borderRadius: 9999, background: statusStyle.dot }} />
            {statusStyle.label}
          </span>
        </div>

        <span style={{
          width: 1, height: 20, background: T.border, display: "block",
          marginLeft: 14, marginRight: 14, flexShrink: 0,
        }} />

        <div style={{ display: "flex", alignItems: "center", gap: 4, flexShrink: 0 }}>
          {TABS.map((t) => {
            const active = t.key === activeTab;
            return (
              <Link
                key={t.key}
                href={`/worlds/${world.id}${t.key === "overview" ? "" : `/${t.key}`}`}
                style={{
                  padding: "5px 12px", borderRadius: 8,
                  background: active ? "rgba(140, 231, 210, 0.12)" : "transparent",
                  color: active ? T.accent : T.muted,
                  fontFamily: T.fontBody, fontSize: 12, fontWeight: 500,
                  textDecoration: "none", whiteSpace: "nowrap",
                }}
              >
                {t.label}
              </Link>
            );
          })}
        </div>

        <div style={{ flex: 1 }} />

        <div style={{ display: "flex", alignItems: "center", gap: 10, flexShrink: 0 }}>
          <Link
            href={`/worlds/${world.id}/sessions`}
            style={{
              display: "inline-flex", alignItems: "center", gap: 6,
              padding: "6px 12px", borderRadius: 8,
              border: `1px solid ${T.border}`, background: "transparent",
              color: T.fg,
              fontFamily: T.fontBody, fontSize: 11, fontWeight: 500,
              textDecoration: "none", whiteSpace: "nowrap",
            }}
          >
            View sessions
          </Link>
        </div>
      </>,
    );
    return () => setContent(null);
  }, [setContent, world.id, world.title, world.status, activeTab, statusStyle.color, statusStyle.dot, statusStyle.label]);

  return null;
}
