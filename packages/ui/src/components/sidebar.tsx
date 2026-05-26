"use client";

import {
  type ComponentType,
  type ReactNode,
  useMemo,
  useState,
  useCallback,
  useEffect,
  useRef,
} from "react";
import { createPortal } from "react-dom";

/* ── Types ──────────────────────────────────────────────────── */

export type SidebarItem = {
  href: string;
  label: string;
  icon?: ReactNode;
  /** Optional group key — items sharing the same section are clustered under a label. */
  section?: string;
  /**
   * Optional tab key — when the parent Sidebar declares `tabs`, items are filtered to only
   * those whose `tab` matches the active tab. Items without a tab are always visible.
   */
  tab?: string;
};

export type SidebarTab = {
  key: string;
  label: string;
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
  /**
   * Optional tab toggle rendered above the navigation. Items without a `tab` field are always
   * visible; items with one are shown only when their tab is active. When a user navigates to
   * an item bound to a different tab, the sidebar switches to keep the current page visible.
   */
  tabs?: SidebarTab[];
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
  /** User email — rendered in the HUD sidecar meta line if provided. */
  userEmail?: string;
  /** Workspace name — rendered in the WORKSPACE section if provided. */
  workspaceName?: string;
  /** Docs link href — when provided, a "Docs" row is added to the sidecar actions. */
  docsHref?: string;
  /**
   * Persist collapsed state under this cookie name. The cookie is set on
   * toggle and read by the server during SSR — see `initialCollapsed`. The
   * name doubles as a localStorage migration key (read once on mount and
   * promoted to a cookie) so existing users don't pop open on first visit.
   */
  storageKey?: string;
  /**
   * Server-rendered initial collapsed state. The parent layout reads the
   * persisted cookie via `cookies()` and forwards it here so the first paint
   * matches the user's preference — eliminates the open-then-close flash that
   * happened when the state was hydrated from localStorage post-mount.
   */
  initialCollapsed?: boolean;
  /** Callback fired when the user clicks "Sign out" in the sidebar footer. */
  onSignOut?: () => void;
  /** Callback fired when the user selects a theme. */
  onThemeChange?: (theme: "dark" | "light" | "system") => void;
  /** Current theme value. */
  theme?: "dark" | "light" | "system";
  /** Callback fired when the user clicks "Settings" in the user menu. */
  onSettings?: () => void;
  /** Dynamic content injected into the header bar (between brand/hamburger and actions). */
  headerContent?: ReactNode;
  /** Padding for the main content area. Defaults to "2rem". Pass "0" for flush layouts (e.g. immersive playgrounds). */
  mainPadding?: string;
  /** Page content — rendered beside the sidebar. */
  children?: ReactNode;
};

/* ── Helpers ─────────────────────────────────────────────────── */

type Section = { key: string | null; items: SidebarItem[] };

const HEADER_HEIGHT = 48;
const SIDEBAR_WIDTH = 240;
const ROW_HEIGHT = 40;
const USER_TRIGGER_HEIGHT = 50;
const ICON_LANE = 22;
const TRAILING_LANE = 32;

const MONO = "var(--font-mono, ui-monospace, SFMono-Regular, monospace)";

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
      <path
        d="M10 3L5 8L10 13"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function ExpandIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
      <path
        d="M6 3L11 8L6 13"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function HamburgerIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
      <path
        d="M3 5h12M3 9h12M3 13h12"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </svg>
  );
}

function DefaultBrandIcon() {
  return (
    <svg width="32" height="14" viewBox="0 0 1253 552" fill="none">
      <path
        d="M546.047 167.264C536.748 173.082 520.508 183.309 512.311 189.963C578.447 158.716 640.463 131.927 712.011 112.485C789.513 91.6036 872.254 73.6171 952.815 78.6919C1009 82.2315 1023.71 106.767 977.448 145.978C918.626 195.839 844.995 233.131 775.316 265.992C668.19 315.561 558.614 359.662 447.015 398.124C423.46 406.475 399.821 414.589 376.104 422.467C365.211 426.068 350.785 431.209 339.929 433.914C349.11 429.416 362.505 424.319 372.352 420.133L436.916 392.495C497.647 366.373 558.05 339.497 618.113 311.872L617.721 310.725C556.842 336.257 495.27 360.113 433.078 382.264C415.881 388.481 398.615 394.504 381.282 400.333C372.764 403.239 357.321 408.775 348.761 410.515C394.029 390.182 437.861 371.218 482.997 349.87L481.608 348.6C401.07 383.238 319.612 415.695 237.322 445.937C211.986 455.356 186.565 464.549 161.065 473.515C151.192 476.989 131.532 484.336 121.938 486.82L123.286 488.059C144.465 481.397 167.846 475.355 189.349 469.152C224.934 458.783 260.348 447.835 295.577 436.313C300.048 434.825 304.612 434.009 309.267 432.425C309.34 432.397 309.4 432.376 309.444 432.365C309.385 432.385 309.326 432.405 309.267 432.425C308.39 432.769 305.612 434.269 304.738 434.651C297.707 437.732 290.538 440.322 283.421 443.207L220.921 467.825C147.612 496.268 73.9668 523.836 0 550.523L1.2155 551.713C7.71857 550.248 17.2349 547.162 23.8157 545.257L68.0639 532.447C107.979 521.114 147.982 510.087 188.066 499.368C229.986 487.995 272.003 476.986 314.115 466.343C364.355 453.897 413.647 442.62 463.908 429.408C488.553 422.968 513.112 416.198 537.577 409.101C550.896 405.241 569.354 399.162 582.411 396.39C510.43 430.934 421.953 457.546 345.135 477.587L345.701 478.839C354.186 477.559 369.467 473.83 378.097 471.876C398.096 467.391 418.04 462.668 437.927 457.709C536.288 433.136 637.356 402.314 730.849 362.759L730.464 361.547C684.216 379.574 637.239 395.684 589.663 409.837C571.722 415.289 544.719 424.029 526.568 427.61C565.454 410.989 605.119 397.217 643.09 378.05C654.433 372.323 674.446 366.695 686.973 362.335C707.151 355.294 727.233 347.964 747.205 340.348C838.071 305.741 929.378 264.953 1013.32 215.832C1036.47 202.285 1332.77 16.0042 1231.67 2.96727C1194.12 -1.87509 1145.87 0.366926 1108 1.66091C929.963 7.74303 768.93 45.978 611.086 129.472C588.954 141.273 567.26 153.879 546.047 167.264Z"
        fill="currentColor"
      />
    </svg>
  );
}

/* ── Component ──────────────────────────────────────────────── */

export function Sidebar({
  brand,
  brandIcon,
  items,
  tabs,
  actions,
  pathname,
  linkComponent,
  userName,
  userRole,
  userEmail,
  workspaceName,
  docsHref,
  storageKey = "odyssey-sidebar-collapsed",
  initialCollapsed = false,
  onSignOut,
  onThemeChange,
  theme = "dark",
  onSettings,
  headerContent,
  mainPadding = "2rem",
  children,
}: SidebarProps) {
  const LinkTag = linkComponent ?? "a";
  const icon = brandIcon ?? <DefaultBrandIcon />;

  const [activeTab, setActiveTab] = useState<string | null>(
    () => tabs?.[0]?.key ?? null,
  );

  // When the user navigates to an item bound to a tab, follow it so the active page stays
  // visible. Intentionally omits activeTab from deps — otherwise clicking a tab while on a page
  // bound to a different tab would immediately revert.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!tabs || tabs.length === 0) return;
    const current = items.find((item) => isActive(pathname, item.href));
    if (current?.tab) {
      setActiveTab(current.tab);
    }
  }, [pathname, items, tabs]);

  const selectTab = useCallback((key: string) => {
    setActiveTab(key);
  }, []);

  const { topSections, tabbedSections } = useMemo(() => {
    if (!tabs || tabs.length === 0) {
      return {
        topSections: [] as Section[],
        tabbedSections: groupBySection(items),
      };
    }
    const topItems = items.filter((item) => !item.tab);
    const tabItems = items.filter((item) => item.tab === activeTab);
    return {
      topSections: groupBySection(topItems),
      tabbedSections: groupBySection(tabItems),
    };
  }, [items, tabs, activeTab]);

  const [collapsed, setCollapsed] = useState(initialCollapsed);
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const userMenuRef = useRef<HTMLDivElement>(null);
  const sidecarRef = useRef<HTMLDivElement>(null);
  const [sidecarPos, setSidecarPos] = useState<{
    bottom: number;
    left: number;
  } | null>(null);

  // One-shot migration: if a previous session persisted the state in
  // localStorage but no cookie exists yet, copy it to the cookie so the
  // server picks it up on the next request.
  useEffect(() => {
    const cookieAlreadySet = document.cookie
      .split("; ")
      .some((c) => c.startsWith(`${storageKey}=`));
    if (cookieAlreadySet) return;
    const stored = localStorage.getItem(storageKey);
    if (stored !== "true" && stored !== "false") return;
    document.cookie = `${storageKey}=${stored}; path=/; max-age=31536000; SameSite=Lax`;
    if (stored === "true" && !collapsed) setCollapsed(true);
    localStorage.removeItem(storageKey);
    // collapsed intentionally omitted — only run on first mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storageKey]);

  const toggle = useCallback(() => {
    setCollapsed((prev) => {
      const next = !prev;
      document.cookie = `${storageKey}=${next}; path=/; max-age=31536000; SameSite=Lax`;
      return next;
    });
  }, [storageKey]);

  useEffect(() => {
    if (!userMenuOpen) return;
    const handleClick = (e: MouseEvent) => {
      const target = e.target as Node;
      const insideTrigger =
        userMenuRef.current?.contains(target) ?? false;
      const insideSidecar =
        sidecarRef.current?.contains(target) ?? false;
      if (!insideTrigger && !insideSidecar) {
        setUserMenuOpen(false);
      }
    };
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setUserMenuOpen(false);
    };
    document.addEventListener("mousedown", handleClick);
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("mousedown", handleClick);
      document.removeEventListener("keydown", handleKey);
    };
  }, [userMenuOpen]);

  const userInitial = userName ? userName.charAt(0).toUpperCase() : null;

  const renderItem = (item: SidebarItem) => {
    const active = isActive(pathname, item.href);
    const hovered = hoveredId === `nav-${item.href}`;
    return (
      <LinkTag
        key={item.href}
        href={item.href}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 12,
          height: ROW_HEIGHT,
          padding: "0 16px 0 14px",
          borderLeft: `2px solid ${
            active
              ? "var(--sidebar-active-border, var(--accent-strong))"
              : hovered
                ? "var(--accent-strong)"
                : "transparent"
          }`,
          background: active
            ? "var(--sidebar-active, var(--accent-soft))"
            : hovered
              ? "var(--sidebar-hover, var(--panel))"
              : "transparent",
          color: active ? "var(--foreground)" : "var(--text-secondary)",
          transition: "background 150ms, color 150ms",
          cursor: "pointer",
          textDecoration: "none",
          whiteSpace: "nowrap",
        }}
        onMouseEnter={() => setHoveredId(`nav-${item.href}`)}
        onMouseLeave={() => setHoveredId(null)}
      >
        <span
          style={{
            width: ICON_LANE,
            flexShrink: 0,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            color: active ? "var(--accent-strong)" : "var(--text-tertiary)",
            transition: "color 150ms",
          }}
        >
          {item.icon}
        </span>
        <span
          style={{
            flex: 1,
            minWidth: 0,
            overflow: "hidden",
            textOverflow: "ellipsis",
            fontSize: "0.8125rem",
            fontWeight: active ? 500 : 400,
            letterSpacing: "-0.005em",
            color: active ? "var(--foreground)" : "var(--text-secondary)",
            transition: "color 150ms",
          }}
        >
          {item.label}
        </span>
        <span
          style={{
            width: TRAILING_LANE,
            flexShrink: 0,
            textAlign: "right",
            fontFamily: MONO,
            fontSize: 10,
            color: active ? "var(--accent-strong)" : "var(--text-quaternary)",
            transition: "color 150ms",
          }}
        />
      </LinkTag>
    );
  };

  const renderSection = (
    section: Section,
    sectionIndex: number,
    keyPrefix: string,
  ) => (
    <div
      key={section.key ?? `${keyPrefix}-${sectionIndex}`}
      style={{ display: "flex", flexDirection: "column" }}
    >
      {section.key && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            padding: "20px 16px 10px 16px",
            fontFamily: MONO,
            fontSize: 10,
            fontWeight: 500,
            letterSpacing: "0.18em",
            textTransform: "uppercase",
            color: "var(--text-tertiary)",
          }}
        >
          <span>{section.key}</span>
          <span style={{ flex: 1, height: 1, background: "var(--border)" }} />
        </div>
      )}
      {section.items.map((item) => renderItem(item))}
    </div>
  );

  /* ── Single stable DOM — sidebar width toggles ────────────── */
  return (
    <div
      style={{
        display: "flex",
        width: "100%",
        height: "100vh",
        overflow: "hidden",
      }}
    >
      {/* Sidebar */}
      <nav
        style={{
          width: collapsed ? 0 : SIDEBAR_WIDTH,
          display: "flex",
          flexDirection: "column",
          background: "var(--sidebar-bg, var(--sidebar))",
          borderRight: collapsed
            ? "none"
            : "1px solid var(--sidebar-border, var(--border-subtle, var(--border)))",
          boxShadow: collapsed ? "none" : "inset -1px 0 0 rgba(255,255,255,0.018)",
          backdropFilter: "blur(18px)",
          flexShrink: 0,
          overflow: "hidden",
          transition: "width 200ms ease",
        }}
      >
        {/* Sidebar header: brand + collapse — exactly aligns with main header */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            height: HEADER_HEIGHT,
            minWidth: SIDEBAR_WIDTH,
            padding: "0 12px 0 20px",
            borderBottom:
              "1px solid var(--sidebar-border, var(--border-subtle, var(--border)))",
            flexShrink: 0,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            {icon}
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
              width: 24,
              height: 24,
              border: "1px solid transparent",
              borderRadius: "var(--radius-button, 12px)",
              background:
                hoveredId === "collapse"
                  ? "var(--sidebar-hover, var(--panel))"
                  : "transparent",
              color:
                hoveredId === "collapse"
                  ? "var(--foreground)"
                  : "var(--text-tertiary)",
              cursor: "pointer",
              flexShrink: 0,
              transition: "background 150ms, color 150ms",
            }}
          >
            <CollapseIcon />
          </button>
        </div>

        {/* Tab row — underlined mono tabs */}
        {tabs && tabs.length > 0 && (
          <div
            style={{
              display: "flex",
              flexDirection: "row",
              minWidth: SIDEBAR_WIDTH,
              borderBottom:
                "1px solid var(--sidebar-border, var(--border-subtle, var(--border)))",
              flexShrink: 0,
            }}
          >
            {tabs.map((tab) => {
              const selected = tab.key === activeTab;
              const hovered = hoveredId === `tab-${tab.key}`;
              return (
                <button
                  key={tab.key}
                  type="button"
                  onClick={() => selectTab(tab.key)}
                  onMouseEnter={() => setHoveredId(`tab-${tab.key}`)}
                  onMouseLeave={() => setHoveredId(null)}
                  style={{
                    flex: 1,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    height: 36,
                    border: "none",
                    background: selected
                      ? "var(--sidebar-active, var(--accent-soft))"
                      : hovered
                        ? "var(--sidebar-hover, var(--card-hover))"
                        : "transparent",
                    borderBottom: `1.5px solid ${
                      selected
                        ? "var(--sidebar-active-border, var(--accent-strong))"
                        : hovered
                          ? "var(--accent-strong)"
                          : "transparent"
                    }`,
                    marginBottom: -1,
                    cursor: "pointer",
                    fontFamily: MONO,
                    fontSize: 11,
                    fontWeight: selected ? 500 : 400,
                    letterSpacing: "0.12em",
                    textTransform: "uppercase",
                    color: selected
                      ? "var(--accent-strong)"
                      : hovered
                        ? "var(--text-primary)"
                        : "var(--text-tertiary)",
                    transition:
                      "background 150ms, color 150ms, border-color 150ms",
                  }}
                >
                  {tab.label}
                </button>
              );
            })}
          </div>
        )}

        {/* Navigation sections */}
        <div
          style={{
            flex: 1,
            display: "flex",
            flexDirection: "column",
            padding: "20px 0 12px",
            minWidth: SIDEBAR_WIDTH,
            overflowY: "auto",
          }}
        >
          {topSections.map((section, i) => renderSection(section, i, "top"))}
          {tabbedSections.map((section, i) =>
            renderSection(section, i, "tabbed"),
          )}
        </div>

        {/* User menu */}
        {userName && (
          <div
            ref={userMenuRef}
            style={{
              position: "relative",
              minWidth: SIDEBAR_WIDTH,
              flexShrink: 0,
            }}
          >
            {/* User trigger button */}
            <button
              type="button"
              onClick={() => {
                if (!userMenuOpen && userMenuRef.current) {
                  const rect = userMenuRef.current.getBoundingClientRect();
                  setSidecarPos({
                    bottom: window.innerHeight - rect.bottom,
                    left: rect.right,
                  });
                }
                setUserMenuOpen(!userMenuOpen);
              }}
              onMouseEnter={() => setHoveredId("user-trigger")}
              onMouseLeave={() => setHoveredId(null)}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 12,
                width: "100%",
                height: USER_TRIGGER_HEIGHT,
                padding: "12px 16px 12px 18px",
                borderTop: "1px solid var(--border-subtle, var(--border))",
                borderLeft: `2px solid ${userMenuOpen ? "var(--accent-strong)" : "transparent"}`,
                background:
                  userMenuOpen
                    ? "var(--sidebar-active, var(--accent-soft))"
                    : hoveredId === "user-trigger"
                      ? "var(--sidebar-hover, var(--panel))"
                      : "transparent",
                cursor: "pointer",
                textAlign: "left",
                fontFamily: "inherit",
                transition: "background 150ms, border-color 150ms",
              }}
            >
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  width: 26,
                  height: 26,
                  background: userMenuOpen
                    ? "color-mix(in srgb, var(--accent-strong) 18%, transparent)"
                    : "var(--accent-soft)",
                  flexShrink: 0,
                  fontFamily: MONO,
                  fontWeight: 600,
                  fontSize: 11,
                  letterSpacing: "0.04em",
                  color: "var(--accent-strong)",
                  transition: "background 150ms",
                }}
              >
                {userInitial}
              </div>
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: 2,
                  flex: 1,
                  minWidth: 0,
                }}
              >
                <span
                  style={{
                    fontWeight: 500,
                    fontSize: "0.8125rem",
                    color: "var(--foreground)",
                    whiteSpace: "nowrap",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                  }}
                >
                  {userName}
                </span>
                {userRole && (
                  <span
                    style={{
                      fontFamily: MONO,
                      fontWeight: 400,
                      fontSize: 10,
                      letterSpacing: "0.06em",
                      color: "var(--text-tertiary)",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {userRole.toLowerCase()}
                  </span>
                )}
              </div>
              <span
                style={{
                  width: 14,
                  flexShrink: 0,
                  textAlign: "right",
                  fontFamily: MONO,
                  fontSize: 12,
                  color: userMenuOpen
                    ? "var(--accent-strong)"
                    : "var(--text-tertiary)",
                  transition: "color 150ms",
                }}
              >
                ›
              </span>
            </button>

            {/* HUD Sidecar (portal'd to the right of the sidebar) */}
            {userMenuOpen &&
              sidecarPos &&
              createPortal(
                <div
                  ref={sidecarRef}
                  style={{
                    position: "fixed",
                    bottom: sidecarPos.bottom,
                    left: sidecarPos.left,
                    width: 320,
                    background: "var(--surface-material, var(--background))",
                    borderTop: "1px solid var(--border-subtle, var(--border))",
                    borderRight: "1px solid var(--border-subtle, var(--border))",
                    borderBottom: "1px solid var(--border-subtle, var(--border))",
                    borderRadius: "0 var(--radius-panel, 20px) 0 0",
                    boxShadow: "var(--elevation-panel, 8px 0 32px var(--shadow))",
                    backdropFilter: "blur(22px)",
                    zIndex: 200,
                    display: "flex",
                    flexDirection: "column",
                  }}
                >
                  {/* Sidecar header */}
                  <div
                    style={{
                      display: "flex",
                      flexDirection: "column",
                      gap: 14,
                      padding: "20px 20px 18px 20px",
                      borderBottom: "1px solid var(--border-subtle, var(--border))",
                    }}
                  >
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 10,
                        fontFamily: MONO,
                        fontSize: 10,
                        fontWeight: 500,
                        letterSpacing: "0.14em",
                        textTransform: "uppercase",
                        color: "var(--text-tertiary)",
                      }}
                    >
                      <span
                        style={{
                          width: 6,
                          height: 6,
                          borderRadius: "50%",
                          background: "var(--accent-strong)",
                        }}
                      />
                      <span>SESSION</span>
                      <span
                        style={{
                          flex: 1,
                          height: 1,
                          background: "var(--border-subtle, var(--border))",
                        }}
                      />
                      <span style={{ color: "var(--text-quaternary)" }}>
                        esc to close
                      </span>
                    </div>
                    <div
                      style={{
                        display: "flex",
                        flexDirection: "column",
                        gap: 4,
                      }}
                    >
                      <div
                        style={{
                          color: "var(--foreground)",
                          fontFamily:
                            "var(--font-display, 'Space Grotesk', sans-serif)",
                          fontSize: 20,
                          fontWeight: 500,
                          letterSpacing: "-0.005em",
                        }}
                      >
                        {userName}
                      </div>
                      <div
                        style={{
                          color: "var(--text-tertiary)",
                          fontFamily: MONO,
                          fontSize: 11,
                          letterSpacing: "0.04em",
                        }}
                      >
                        {[userEmail, userRole?.toLowerCase()]
                          .filter(Boolean)
                          .join(" · ")}
                      </div>
                    </div>
                  </div>

                  {/* Workspace section */}
                  {workspaceName && (
                    <div style={{ display: "flex", flexDirection: "column" }}>
                      <div
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 10,
                          padding: "16px 20px 8px 20px",
                          fontFamily: MONO,
                          fontSize: 10,
                          fontWeight: 500,
                          letterSpacing: "0.14em",
                          textTransform: "uppercase",
                          color: "var(--text-tertiary)",
                        }}
                      >
                        <span>WORKSPACE</span>
                        <span
                          style={{
                            flex: 1,
                            height: 1,
                            background: "var(--border-subtle, var(--border))",
                          }}
                        />
                      </div>
                      <div
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 12,
                          padding: "8px 20px 14px 20px",
                        }}
                      >
                        <div
                          style={{
                            width: 14,
                            height: 14,
                            border: "1px solid var(--accent-strong)",
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            flexShrink: 0,
                          }}
                        >
                          <div
                            style={{
                              width: 6,
                              height: 6,
                              background: "var(--accent-strong)",
                            }}
                          />
                        </div>
                        <span
                          style={{
                            flex: 1,
                            color: "var(--foreground)",
                            fontSize: "0.8125rem",
                          }}
                        >
                          {workspaceName}
                        </span>
                        {userRole && (
                          <span
                            style={{
                              fontFamily: MONO,
                              fontSize: 10,
                              letterSpacing: "0.06em",
                              color: "var(--text-quaternary)",
                            }}
                          >
                            {userRole.toLowerCase()}
                          </span>
                        )}
                      </div>
                    </div>
                  )}

                  {/* Theme section — 3-tab toggle */}
                  {onThemeChange && (
                    <div
                      style={{
                        display: "flex",
                        flexDirection: "column",
                        borderTop: "1px solid var(--border-subtle, var(--border))",
                      }}
                    >
                      <div
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 10,
                          padding: "12px 20px 8px 20px",
                          fontFamily: MONO,
                          fontSize: 10,
                          fontWeight: 500,
                          letterSpacing: "0.14em",
                          textTransform: "uppercase",
                          color: "var(--text-tertiary)",
                        }}
                      >
                        <span>THEME</span>
                        <span
                          style={{
                            flex: 1,
                            height: 1,
                            background: "var(--border-subtle, var(--border))",
                          }}
                        />
                        <span style={{ color: "var(--text-quaternary)" }}>
                          {theme}
                        </span>
                      </div>
                      <div
                        style={{
                          display: "flex",
                          flexDirection: "row",
                          margin: "0 20px 14px 20px",
                        }}
                      >
                        {(["dark", "light", "system"] as const).map(
                          (t, i, arr) => {
                            const selected = theme === t;
                            const isLast = i === arr.length - 1;
                            return (
                              <button
                                key={t}
                                type="button"
                                onClick={() => onThemeChange(t)}
                                onMouseEnter={() =>
                                  setHoveredId(`theme-${t}`)
                                }
                                onMouseLeave={() => setHoveredId(null)}
                                style={{
                                  flex: 1,
                                  padding: "10px 0",
                                  border: "1px solid var(--border-subtle, var(--border))",
                                  borderRight: isLast
                                    ? "1px solid var(--border-subtle, var(--border))"
                                    : "none",
                                  background: selected
                                    ? "var(--accent-soft)"
                                    : hoveredId === `theme-${t}`
                                      ? "var(--panel)"
                                      : "transparent",
                                  color: selected
                                    ? "var(--accent-strong)"
                                    : "var(--text-tertiary)",
                                  fontFamily: MONO,
                                  fontSize: 10,
                                  fontWeight: selected ? 500 : 400,
                                  letterSpacing: "0.14em",
                                  textTransform: "uppercase",
                                  cursor: "pointer",
                                  transition: "background 150ms, color 150ms",
                                }}
                              >
                                {t}
                              </button>
                            );
                          },
                        )}
                      </div>
                    </div>
                  )}

                  {/* Actions section */}
                  <div
                    style={{
                      display: "flex",
                      flexDirection: "column",
                      borderTop: "1px solid var(--border-subtle, var(--border))",
                    }}
                  >
                    {onSettings && (
                      <button
                        type="button"
                        onClick={() => {
                          onSettings();
                          setUserMenuOpen(false);
                        }}
                        onMouseEnter={() => setHoveredId("menu-settings")}
                        onMouseLeave={() => setHoveredId(null)}
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 12,
                          width: "100%",
                          padding: "14px 20px",
                          border: "none",
                          borderBottom: "1px solid var(--divider)",
                          background:
                            hoveredId === "menu-settings"
                              ? "var(--panel)"
                              : "transparent",
                          cursor: "pointer",
                          textAlign: "left",
                          fontFamily: "inherit",
                          transition: "background 150ms",
                        }}
                      >
                        <span
                          style={{
                            width: 22,
                            flexShrink: 0,
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            color: "var(--text-tertiary)",
                          }}
                        >
                          <svg
                            width="14"
                            height="14"
                            viewBox="0 0 14 14"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="1"
                            strokeLinecap="square"
                          >
                            <circle cx="7" cy="7" r="1.6" />
                            <path d="M7 1 V2.6 M7 11.4 V13 M1 7 H2.6 M11.4 7 H13 M2.7 2.7 L3.8 3.8 M10.2 10.2 L11.3 11.3 M2.7 11.3 L3.8 10.2 M10.2 3.8 L11.3 2.7" />
                          </svg>
                        </span>
                        <span
                          style={{
                            flex: 1,
                            color: "var(--foreground)",
                            fontSize: "0.8125rem",
                          }}
                        >
                          Settings
                        </span>
                        <span
                          style={{
                            fontFamily: MONO,
                            fontSize: 10,
                            letterSpacing: "0.06em",
                            color: "var(--text-quaternary)",
                          }}
                        >
                          ⌘,
                        </span>
                      </button>
                    )}
                    {docsHref && (
                      <a
                        href={docsHref}
                        target="_blank"
                        rel="noopener noreferrer"
                        onMouseEnter={() => setHoveredId("menu-docs")}
                        onMouseLeave={() => setHoveredId(null)}
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 12,
                          width: "100%",
                          padding: "14px 20px",
                          background:
                            hoveredId === "menu-docs"
                              ? "var(--panel)"
                              : "transparent",
                          textDecoration: "none",
                          transition: "background 150ms",
                        }}
                      >
                        <span
                          style={{
                            width: 22,
                            flexShrink: 0,
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            color: "var(--text-tertiary)",
                          }}
                        >
                          <svg
                            width="14"
                            height="14"
                            viewBox="0 0 14 14"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="1"
                            strokeLinecap="square"
                          >
                            <path d="M2 1.5 H9 L12 4.5 V12.5 H2 Z" />
                            <line x1="4" y1="6" x2="10" y2="6" />
                            <line x1="4" y1="9" x2="10" y2="9" />
                          </svg>
                        </span>
                        <span
                          style={{
                            flex: 1,
                            color: "var(--foreground)",
                            fontSize: "0.8125rem",
                          }}
                        >
                          Docs
                        </span>
                        <span
                          style={{
                            fontFamily: MONO,
                            fontSize: 10,
                            color: "var(--text-quaternary)",
                          }}
                        >
                          ↗
                        </span>
                      </a>
                    )}
                  </div>

                  {/* Sign out */}
                  {onSignOut && (
                    <button
                      type="button"
                      onClick={() => {
                        onSignOut();
                        setUserMenuOpen(false);
                      }}
                      onMouseEnter={() => setHoveredId("menu-signout")}
                      onMouseLeave={() => setHoveredId(null)}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 12,
                        width: "100%",
                        padding: "14px 20px",
                        border: "none",
                        borderTop: "1px solid var(--border-subtle, var(--border))",
                        background:
                          hoveredId === "menu-signout"
                            ? "rgba(248, 113, 113, 0.06)"
                            : "transparent",
                        cursor: "pointer",
                        textAlign: "left",
                        fontFamily: "inherit",
                        transition: "background 150ms",
                      }}
                    >
                      <span
                        style={{
                          width: 22,
                          flexShrink: 0,
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          color: "var(--danger)",
                        }}
                      >
                        <svg
                          width="14"
                          height="14"
                          viewBox="0 0 14 14"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="1"
                          strokeLinecap="square"
                        >
                          <path d="M5 1.5 H11 V12.5 H5" />
                          <path d="M8 7 H1.5 M1.5 7 L3.5 5 M1.5 7 L3.5 9" />
                        </svg>
                      </span>
                      <span
                        style={{
                          flex: 1,
                          color: "var(--danger)",
                          fontSize: "0.8125rem",
                        }}
                      >
                        Sign out
                      </span>
                    </button>
                  )}
                </div>,
                document.body,
              )}
          </div>
        )}
      </nav>

      {/* Right column: header + content */}
      <div
        style={{
          flex: 1,
          display: "flex",
          flexDirection: "column",
          minWidth: 0,
        }}
      >
        <header
          style={{
            display: "flex",
            alignItems: "center",
            height: HEADER_HEIGHT,
            padding: "0 24px",
            borderBottom:
              "1px solid var(--header-border, var(--border-subtle, var(--border)))",
            background: "var(--header-bg, var(--sidebar))",
            backdropFilter: "blur(var(--header-blur, 18px))",
            flexShrink: 0,
            overflow: "visible",
            position: "relative",
            zIndex: 10,
          }}
        >
          {/* Brand icon as menu toggle — only when collapsed */}
          {collapsed && (
            <button
              type="button"
              onClick={toggle}
              onMouseEnter={() => setHoveredId("hamburger")}
              onMouseLeave={() => setHoveredId(null)}
              aria-label="Open sidebar"
              style={{
                width: 56,
                height: HEADER_HEIGHT,
                marginLeft: -24,
                marginRight: 16,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                border: "none",
                borderRight:
                  "1px solid var(--header-border, var(--border-subtle, var(--border)))",
                background:
                  hoveredId === "hamburger"
                    ? "var(--accent-soft)"
                    : "transparent",
                color: "var(--accent-strong)",
                cursor: "pointer",
                flexShrink: 0,
                transition: "background 150ms, color 150ms",
              }}
            >
              {hoveredId === "hamburger" ? <ExpandIcon /> : icon}
            </button>
          )}

          {/* Page-level header content. The slot stretches to the full
              header height so headers that want to anchor things (tab
              underlines, status bars) to the header edge can do so via
              `alignSelf: stretch` / `height: 100%`. Simpler centered
              content stays centered by adding `alignItems: center` to
              its own root, which is the convention most consumers
              already follow. */}
          {headerContent ? (
            <div
              style={{
                flex: 1,
                // `alignSelf: stretch` overrides the parent <header>'s
                // `alignItems: center` for this slot specifically, so the
                // wrapper actually fills the header height. Without
                // it the wrapper would just be the height of its content
                // (centered by the header), and any child trying to align
                // something to the header's bottom edge (e.g. a tab
                // underline) would land short of the divider.
                alignSelf: "stretch",
                display: "flex",
                alignItems: "stretch",
                minWidth: 0,
              }}
            >
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
                  background:
                    hoveredId === `action-${action.label}`
                      ? "var(--accent-soft)"
                      : "var(--panel)",
                  color:
                    hoveredId === `action-${action.label}`
                      ? "var(--foreground)"
                      : "var(--muted)",
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

        <main
          style={{
            flex: 1,
            overflow: "auto",
            minHeight: 0,
            padding: mainPadding,
            position: "relative",
          }}
        >
          {children}
        </main>
      </div>
    </div>
  );
}
