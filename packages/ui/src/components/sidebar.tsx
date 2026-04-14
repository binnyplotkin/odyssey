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
  /** Callback fired when the user clicks "Sign out" in the sidebar footer. */
  onSignOut?: () => void;
  /** Dynamic content injected into the header bar (between brand/hamburger and actions). */
  headerContent?: ReactNode;
  /** Page content — rendered beside the sidebar. */
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
    <svg width="32" height="14" viewBox="0 0 1253 552" fill="none">
      <path d="M546.047 167.264C536.748 173.082 520.508 183.309 512.311 189.963C578.447 158.716 640.463 131.927 712.011 112.485C789.513 91.6036 872.254 73.6171 952.815 78.6919C1009 82.2315 1023.71 106.767 977.448 145.978C918.626 195.839 844.995 233.131 775.316 265.992C668.19 315.561 558.614 359.662 447.015 398.124C423.46 406.475 399.821 414.589 376.104 422.467C365.211 426.068 350.785 431.209 339.929 433.914C349.11 429.416 362.505 424.319 372.352 420.133L436.916 392.495C497.647 366.373 558.05 339.497 618.113 311.872L617.721 310.725C556.842 336.257 495.27 360.113 433.078 382.264C415.881 388.481 398.615 394.504 381.282 400.333C372.764 403.239 357.321 408.775 348.761 410.515C394.029 390.182 437.861 371.218 482.997 349.87L481.608 348.6C401.07 383.238 319.612 415.695 237.322 445.937C211.986 455.356 186.565 464.549 161.065 473.515C151.192 476.989 131.532 484.336 121.938 486.82L123.286 488.059C144.465 481.397 167.846 475.355 189.349 469.152C224.934 458.783 260.348 447.835 295.577 436.313C300.048 434.825 304.612 434.009 309.267 432.425C309.34 432.397 309.4 432.376 309.444 432.365C309.385 432.385 309.326 432.405 309.267 432.425C308.39 432.769 305.612 434.269 304.738 434.651C297.707 437.732 290.538 440.322 283.421 443.207L220.921 467.825C147.612 496.268 73.9668 523.836 0 550.523L1.2155 551.713C7.71857 550.248 17.2349 547.162 23.8157 545.257L68.0639 532.447C107.979 521.114 147.982 510.087 188.066 499.368C229.986 487.995 272.003 476.986 314.115 466.343C364.355 453.897 413.647 442.62 463.908 429.408C488.553 422.968 513.112 416.198 537.577 409.101C550.896 405.241 569.354 399.162 582.411 396.39C510.43 430.934 421.953 457.546 345.135 477.587L345.701 478.839C354.186 477.559 369.467 473.83 378.097 471.876C398.096 467.391 418.04 462.668 437.927 457.709C536.288 433.136 637.356 402.314 730.849 362.759L730.464 361.547C684.216 379.574 637.239 395.684 589.663 409.837C571.722 415.289 544.719 424.029 526.568 427.61C565.454 410.989 605.119 397.217 643.09 378.05C654.433 372.323 674.446 366.695 686.973 362.335C707.151 355.294 727.233 347.964 747.205 340.348C838.071 305.741 929.378 264.953 1013.32 215.832C1036.47 202.285 1332.77 16.0042 1231.67 2.96727C1194.12 -1.87509 1145.87 0.366926 1108 1.66091C929.963 7.74303 768.93 45.978 611.086 129.472C588.954 141.273 567.26 153.879 546.047 167.264Z" fill="currentColor" />
    </svg>
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
  onSignOut,
  headerContent,
  children,
}: SidebarProps) {
  const LinkTag = linkComponent ?? "a";
  const sections = useMemo(() => groupBySection(items), [items]);
  const icon = brandIcon ?? <DefaultBrandIcon />;

  const [collapsed, setCollapsed] = useState(false);
  const [hoveredId, setHoveredId] = useState<string | null>(null);

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

  /* ── Single stable DOM — sidebar width toggles ────────────── */
  return (
    <div style={{ display: "flex", width: "100%", height: "100%", overflow: "hidden" }}>
      {/* Sidebar */}
      <nav
        style={{
          width: collapsed ? 0 : 240,
          display: "flex",
          flexDirection: "column",
          background: "var(--sidebar-glass)",
          backdropFilter: "blur(16px)",
          WebkitBackdropFilter: "blur(16px)",
          borderRight: collapsed ? "none" : "1px solid var(--border)",
          boxShadow: collapsed ? "none" : "1px 0 24px var(--shadow), inset -1px 0 0 var(--sidebar-inset)",
          flexShrink: 0,
          overflow: "hidden",
          transition: "width 200ms ease",
        }}
      >
        {/* Sidebar header: brand + collapse */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            height: 56,
            minWidth: 240,
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
                whiteSpace: "nowrap",
              }}
            >
              {brand}
            </span>
          </div>

          <button
            type="button"
            onClick={toggle}
            onMouseEnter={() => setHoveredId("collapse")}
            onMouseLeave={() => setHoveredId(null)}
            aria-label="Collapse sidebar"
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              width: 28,
              height: 28,
              borderRadius: 6,
              border: "none",
              background: hoveredId === "collapse" ? "var(--accent-soft)" : "var(--panel)",
              color: hoveredId === "collapse" ? "var(--foreground)" : "var(--muted)",
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
            minWidth: 240,
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
                      background: active
                        ? "var(--accent-soft)"
                        : hoveredId === `nav-${item.href}`
                          ? "var(--panel)"
                          : "transparent",
                      transition: "background 150ms, color 150ms, opacity 150ms",
                      cursor: "pointer",
                      textDecoration: "none",
                      whiteSpace: "nowrap",
                    }}
                    onMouseEnter={() => setHoveredId(`nav-${item.href}`)}
                    onMouseLeave={() => setHoveredId(null)}
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
              minWidth: 240,
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
            <div style={{ display: "flex", flexDirection: "column", gap: 1, flex: 1, minWidth: 0 }}>
              <span
                style={{
                  fontWeight: 500,
                  fontSize: "0.8125rem",
                  color: "var(--foreground)",
                  opacity: 0.85,
                  whiteSpace: "nowrap",
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
                    whiteSpace: "nowrap",
                  }}
                >
                  {userRole}
                </span>
              )}
            </div>
            {onSignOut && (
              <button
                type="button"
                onClick={onSignOut}
                onMouseEnter={() => setHoveredId("signout")}
                onMouseLeave={() => setHoveredId(null)}
                aria-label="Sign out"
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  width: 28,
                  height: 28,
                  borderRadius: 6,
                  border: "none",
                  background: hoveredId === "signout" ? "var(--panel)" : "transparent",
                  color: hoveredId === "signout" ? "var(--foreground)" : "var(--muted)",
                  cursor: "pointer",
                  flexShrink: 0,
                  transition: "background 150ms, color 150ms",
                }}
              >
                <svg width="16" height="16" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M6 2h8a2 2 0 012 2v10a2 2 0 01-2 2H6" />
                  <path d="M10 9H2M2 9l3-3M2 9l3 3" />
                </svg>
              </button>
            )}
          </div>
        )}
      </nav>

      {/* Right column: header + content */}
      <div style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0 }}>
        <header
          style={{
            display: "flex",
            alignItems: "center",
            height: 56,
            padding: "0 24px",
            borderBottom: "1px solid var(--border)",
            flexShrink: 0,
          }}
        >
          {/* Hamburger — only when collapsed */}
          {collapsed && (
            <button
              type="button"
              onClick={toggle}
              onMouseEnter={() => setHoveredId("hamburger")}
              onMouseLeave={() => setHoveredId(null)}
              aria-label="Open sidebar"
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                width: 36,
                height: 36,
                borderRadius: 8,
                border: "none",
                background: hoveredId === "hamburger" ? "var(--accent-soft)" : "var(--panel)",
                color: "var(--foreground)",
                cursor: "pointer",
                marginRight: 12,
                flexShrink: 0,
                transition: "background 150ms",
              }}
            >
              <HamburgerIcon />
            </button>
          )}

          {/* Brand — only when collapsed */}
          {collapsed && (
            <>
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
              <div
                style={{
                  width: 1,
                  alignSelf: "stretch",
                  margin: "12px 16px",
                  background: "var(--border)",
                  flexShrink: 0,
                }}
              />
            </>
          )}

          {/* Page-level header content */}
          {headerContent ? (
            <div style={{ flex: 1, display: "flex", alignItems: "center", minWidth: 0 }}>
              {headerContent}
            </div>
          ) : (
            <div style={{ flex: 1 }} />
          )}

          {/* Actions */}
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            {actions?.map((action) => (
              <button
                key={action.label}
                type="button"
                onClick={action.onClick}
                onMouseEnter={() => setHoveredId(`action-${action.label}`)}
                onMouseLeave={() => setHoveredId(null)}
                aria-label={action.label}
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  width: 32,
                  height: 32,
                  borderRadius: 8,
                  border: "none",
                  background: hoveredId === `action-${action.label}` ? "var(--accent-soft)" : "var(--panel)",
                  color: hoveredId === `action-${action.label}` ? "var(--foreground)" : "var(--muted)",
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
          </div>
        </header>

        <main style={{ flex: 1, overflow: "auto", minHeight: 0, padding: "2rem", position: "relative" }}>
          {children}
        </main>
      </div>
    </div>
  );
}
