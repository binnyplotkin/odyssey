"use client";

import { type ComponentType, type ReactNode, useMemo, useState, useCallback, useEffect } from "react";

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
  /** Brand icon/logo rendered before the brand text. */
  brandIcon?: ReactNode;
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
  /** User display name for the bottom profile area. */
  userName?: string;
  /** User role label (e.g. "Admin"). */
  userRole?: string;
  /** Persist collapsed state to localStorage under this key. */
  storageKey?: string;
  /** Page content — rendered beside the sidebar (expanded) or below the header (collapsed). */
  children?: ReactNode;
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

/* ── Icons ───────────────────────────────────────────────────── */

function CollapseIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
      <path d="M10 3L5 8L10 13" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function HamburgerIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
      <path d="M3 5h12M3 9h12M3 13h12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

function DefaultBrandIcon() {
  return (
    <svg width="22" height="18" viewBox="0 0 52 23" fill="none">
      <path d="M2 21L15 2L28 14L40 5L50 12" stroke="var(--accent-strong)" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/* ── Shared: header right-side items ─────────────────────────── */

function HeaderActions({
  actions,
  userInitial,
}: {
  actions?: SidebarAction[];
  userInitial: string | null;
}) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
      {actions?.map((action) => (
        <button
          key={action.label}
          type="button"
          onClick={action.onClick}
          aria-label={action.label}
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            width: 32,
            height: 32,
            borderRadius: 8,
            border: "none",
            background: "var(--panel)",
            color: "var(--muted)",
            cursor: "pointer",
            transition: "background 150ms, color 150ms",
          }}
        >
          {action.icon ?? (
            <span style={{ fontSize: "0.75rem", fontWeight: 500 }}>
              {action.label.charAt(0)}
            </span>
          )}
        </button>
      ))}

      {userInitial && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            width: 32,
            height: 32,
            borderRadius: 8,
            background: "var(--accent-soft)",
            flexShrink: 0,
          }}
        >
          <span
            style={{
              fontWeight: 600,
              fontSize: "0.8125rem",
              color: "var(--accent-strong)",
            }}
          >
            {userInitial}
          </span>
        </div>
      )}
    </div>
  );
}

/* ── Component ──────────────────────────────────────────────── */

export function Sidebar({
  brand,
  brandIcon,
  items,
  actions,
  pathname,
  linkComponent,
  userName,
  userRole,
  storageKey = "odyssey-sidebar-collapsed",
  children,
}: SidebarProps) {
  const LinkTag = linkComponent ?? "a";
  const sections = useMemo(() => groupBySection(items), [items]);
  const icon = brandIcon ?? <DefaultBrandIcon />;

  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    const stored = localStorage.getItem(storageKey);
    if (stored === "true") setCollapsed(true);
  }, [storageKey]);

  const toggle = useCallback(() => {
    setCollapsed((prev) => {
      const next = !prev;
      localStorage.setItem(storageKey, String(next));
      return next;
    });
  }, [storageKey]);

  const userInitial = userName ? userName.charAt(0).toUpperCase() : null;

  /* ── Collapsed: full-width header + content ────────────────── */
  if (collapsed) {
    return (
      <div style={{ display: "flex", flexDirection: "column", minHeight: "100vh" }}>
        <header
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            height: 56,
            padding: "0 24px",
            background: "var(--sidebar-glass)",
            backdropFilter: "blur(16px)",
            WebkitBackdropFilter: "blur(16px)",
            borderBottom: "1px solid var(--border)",
            flexShrink: 0,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
            <button
              type="button"
              onClick={toggle}
              aria-label="Open sidebar"
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                width: 36,
                height: 36,
                borderRadius: 8,
                border: "none",
                background: "var(--panel)",
                color: "var(--foreground)",
                cursor: "pointer",
                transition: "background 150ms",
              }}
            >
              <HamburgerIcon />
            </button>

            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              {icon}
              <span
                style={{
                  fontWeight: 600,
                  fontSize: "1rem",
                  letterSpacing: "-0.02em",
                  color: "var(--foreground)",
                  opacity: 0.85,
                }}
              >
                {brand}
              </span>
            </div>
          </div>

          <HeaderActions actions={actions} userInitial={userInitial} />
        </header>

        <main style={{ flex: 1, padding: "2rem" }}>{children}</main>
      </div>
    );
  }

  /* ── Expanded: sidebar (full height) | header + content ───── */
  return (
    <div style={{ display: "flex", minHeight: "100vh" }}>
      {/* Sidebar */}
      <nav
        style={{
          width: 240,
          display: "flex",
          flexDirection: "column",
          background: "var(--sidebar-glass)",
          backdropFilter: "blur(16px)",
          WebkitBackdropFilter: "blur(16px)",
          borderRight: "1px solid var(--border)",
          boxShadow: "1px 0 24px var(--shadow), inset -1px 0 0 var(--sidebar-inset)",
          flexShrink: 0,
        }}
      >
        {/* Sidebar header: brand + collapse */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            height: 56,
            padding: "0 16px 0 20px",
            borderBottom: "1px solid var(--border)",
            flexShrink: 0,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            {icon}
            <span
              style={{
                fontWeight: 600,
                fontSize: "1rem",
                letterSpacing: "-0.02em",
                color: "var(--foreground)",
                opacity: 0.85,
              }}
            >
              {brand}
            </span>
          </div>

          <button
            type="button"
            onClick={toggle}
            aria-label="Collapse sidebar"
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              width: 28,
              height: 28,
              borderRadius: 6,
              border: "none",
              background: "var(--panel)",
              color: "var(--muted)",
              cursor: "pointer",
              flexShrink: 0,
              transition: "background 150ms, color 150ms",
            }}
          >
            <CollapseIcon />
          </button>
        </div>

        {/* Navigation sections */}
        <div
          style={{
            flex: 1,
            display: "flex",
            flexDirection: "column",
            gap: 16,
            padding: "12px 12px 0",
            overflowY: "auto",
          }}
        >
          {sections.map((section, sectionIndex) => (
            <div
              key={section.key ?? `section-${sectionIndex}`}
              style={{ display: "flex", flexDirection: "column", gap: 2 }}
            >
              {section.key && (
                <div
                  style={{
                    padding: "0 8px 8px",
                    fontSize: "0.6875rem",
                    fontWeight: 500,
                    letterSpacing: "0.06em",
                    textTransform: "uppercase",
                    color: "var(--muted)",
                  }}
                >
                  {section.key}
                </div>
              )}

              {section.items.map((item) => {
                const active = isActive(pathname, item.href);

                return (
                  <LinkTag
                    key={item.href}
                    href={item.href}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 10,
                      padding: "8px 10px",
                      borderRadius: 8,
                      fontSize: "0.8125rem",
                      fontWeight: active ? 500 : 400,
                      color: active ? "var(--accent-strong)" : "var(--foreground)",
                      background: active ? "var(--accent-soft)" : "transparent",
                      transition: "background 150ms, color 150ms, opacity 150ms",
                      cursor: "pointer",
                      textDecoration: "none",
                    }}
                  >
                    {item.icon && (
                      <span
                        style={{
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          width: 18,
                          height: 18,
                          flexShrink: 0,
                          color: active ? "var(--accent-strong)" : "var(--foreground)",
                          opacity: active ? 1 : 0.8,
                          transition: "color 150ms, opacity 150ms",
                        }}
                      >
                        {item.icon}
                      </span>
                    )}
                    {item.label}
                  </LinkTag>
                );
              })}
            </div>
          ))}
        </div>

        {/* User area */}
        {userName && (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              padding: "16px 20px",
              borderTop: "1px solid var(--border)",
              flexShrink: 0,
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                width: 32,
                height: 32,
                borderRadius: 8,
                background: "var(--accent-soft)",
                flexShrink: 0,
              }}
            >
              <span
                style={{
                  fontWeight: 600,
                  fontSize: "0.8125rem",
                  color: "var(--accent-strong)",
                }}
              >
                {userInitial}
              </span>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 1 }}>
              <span
                style={{
                  fontWeight: 500,
                  fontSize: "0.8125rem",
                  color: "var(--foreground)",
                  opacity: 0.85,
                }}
              >
                {userName}
              </span>
              {userRole && (
                <span
                  style={{
                    fontWeight: 400,
                    fontSize: "0.6875rem",
                    color: "var(--muted)",
                  }}
                >
                  {userRole}
                </span>
              )}
            </div>
          </div>
        )}
      </nav>

      {/* Right column: header + content */}
      <div style={{ flex: 1, display: "flex", flexDirection: "column" }}>
        <header
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "flex-end",
            height: 56,
            padding: "0 24px",
            borderBottom: "1px solid var(--border)",
            flexShrink: 0,
          }}
        >
          <HeaderActions actions={actions} userInitial={userInitial} />
        </header>

        <main style={{ flex: 1, padding: "2rem" }}>{children}</main>
      </div>
    </div>
  );
}
