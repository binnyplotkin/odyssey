"use client";

import { type ComponentType, type ReactNode, useMemo } from "react";

/* ── Types ──────────────────────────────────────────────────── */

export type SidebarItem = {
  href: string;
  label: string;
  icon?: ReactNode;
  /** Optional group key — items sharing the same section are clustered under a label. */
  section?: string;
};

export type SidebarAction = {
  label: string;
  onClick: () => void;
  icon?: ReactNode;
};

export type SidebarProps = {
  /** Brand label rendered at the top of the sidebar. */
  brand: string;
  /** Navigation items — order is preserved, sections are rendered in encounter order. */
  items: SidebarItem[];
  /** Footer actions (e.g. logout) pinned to the bottom. */
  actions?: SidebarAction[];
  /** Current route pathname — used to derive active state. */
  pathname: string;
  /**
   * Link component to render navigation items.
   * Defaults to `"a"` — pass Next.js `Link` (or any router link) for SPA transitions.
   */
  linkComponent?: ComponentType<{
    href: string;
    children: ReactNode;
    className?: string;
    style?: React.CSSProperties;
  }>;
};

/* ── Helpers ─────────────────────────────────────────────────── */

type Section = { key: string | null; items: SidebarItem[] };

function groupBySection(items: SidebarItem[]): Section[] {
  const sections: Section[] = [];
  let current: Section | null = null;

  for (const item of items) {
    const key = item.section ?? null;

    if (!current || current.key !== key) {
      current = { key, items: [] };
      sections.push(current);
    }

    current.items.push(item);
  }

  return sections;
}

function isActive(pathname: string, href: string) {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(href + "/");
}

/* ── Component ──────────────────────────────────────────────── */

export function Sidebar({
  brand,
  items,
  actions,
  pathname,
  linkComponent,
}: SidebarProps) {
  const LinkTag = linkComponent ?? "a";
  const sections = useMemo(() => groupBySection(items), [items]);

  return (
    <nav
      style={{
        width: 240,
        minHeight: "100vh",
        display: "flex",
        flexDirection: "column",
        padding: "1.25rem 0.75rem",
        gap: "0.25rem",
        background: "var(--sidebar-glass)",
        backdropFilter: "blur(16px)",
        WebkitBackdropFilter: "blur(16px)",
        borderRight: "1px solid var(--border)",
        boxShadow:
          "1px 0 24px var(--shadow), inset -1px 0 0 var(--sidebar-inset)",
      }}
    >
      {/* Brand */}
      <div
        style={{
          padding: "0.25rem 0.75rem 1.25rem",
          display: "flex",
          alignItems: "center",
          gap: "0.5rem",
        }}
      >
        {/* Accent dot */}
        <span
          style={{
            display: "inline-block",
            width: 8,
            height: 8,
            borderRadius: "50%",
            background: "var(--accent-strong)",
            boxShadow: "0 0 6px var(--accent)",
            flexShrink: 0,
          }}
        />
        <span
          style={{
            fontWeight: 700,
            fontSize: "0.8rem",
            letterSpacing: "0.08em",
            textTransform: "uppercase",
            color: "var(--foreground)",
          }}
        >
          {brand}
        </span>
      </div>

      {/* Sections + items */}
      <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: "0.125rem" }}>
        {sections.map((section, sectionIndex) => (
          <div key={section.key ?? `section-${sectionIndex}`}>
            {section.key ? (
              <div
                style={{
                  padding: "0.75rem 0.75rem 0.375rem",
                  fontSize: "0.65rem",
                  fontWeight: 600,
                  letterSpacing: "0.12em",
                  textTransform: "uppercase",
                  color: "var(--muted)",
                }}
              >
                {section.key}
              </div>
            ) : null}

            {section.items.map((item) => {
              const active = isActive(pathname, item.href);

              return (
                <LinkTag
                  key={item.href}
                  href={item.href}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "0.5rem",
                    padding: "0.5rem 0.75rem",
                    borderRadius: "0.625rem",
                    fontSize: "0.8125rem",
                    fontWeight: active ? 600 : 450,
                    color: active ? "var(--accent-strong)" : "var(--foreground)",
                    background: active
                      ? "var(--accent-soft)"
                      : "transparent",
                    boxShadow: active
                      ? "inset 0 1px 2px rgba(0, 0, 0, 0.04), 0 1px 3px rgba(0, 0, 0, 0.03)"
                      : "none",
                    transition: "background 150ms, color 150ms, box-shadow 150ms",
                    cursor: "pointer",
                    textDecoration: "none",
                  }}
                  className="sidebar-item"
                >
                  {item.icon ? (
                    <span
                      style={{
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        width: 20,
                        height: 20,
                        opacity: active ? 1 : 0.55,
                        flexShrink: 0,
                        transition: "opacity 150ms",
                      }}
                    >
                      {item.icon}
                    </span>
                  ) : null}
                  {item.label}
                </LinkTag>
              );
            })}
          </div>
        ))}
      </div>

      {/* Footer actions */}
      {actions && actions.length > 0 ? (
        <div
          style={{
            borderTop: "1px solid var(--border)",
            paddingTop: "0.75rem",
            marginTop: "0.5rem",
            display: "flex",
            flexDirection: "column",
            gap: "0.125rem",
          }}
        >
          {actions.map((action) => (
            <button
              key={action.label}
              type="button"
              onClick={action.onClick}
              style={{
                display: "flex",
                alignItems: "center",
                gap: "0.5rem",
                padding: "0.5rem 0.75rem",
                borderRadius: "0.625rem",
                border: "none",
                background: "transparent",
                fontSize: "0.8125rem",
                fontWeight: 450,
                color: "var(--muted)",
                cursor: "pointer",
                textAlign: "left",
                transition: "background 150ms, color 150ms",
                width: "100%",
              }}
              className="sidebar-item"
            >
              {action.icon ? (
                <span
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    width: 20,
                    height: 20,
                    opacity: 0.55,
                    flexShrink: 0,
                  }}
                >
                  {action.icon}
                </span>
              ) : null}
              {action.label}
            </button>
          ))}
        </div>
      ) : null}
    </nav>
  );
}
