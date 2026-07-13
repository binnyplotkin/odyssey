"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, useEffect, useCallback } from "react";
import { useSession, signOut } from "next-auth/react";
import { Sidebar, type SidebarItem, type SidebarTab } from "@odyssey/ui";
import { HeaderProvider, useHeaderContent } from "./header-context";
import { SettingsOverlay } from "./settings-overlay";
import { AdminAgentSidebar } from "./admin-agent-sidebar";
import { HalftoneIntelligenceIcon } from "./halftone-intelligence-icon";
import {
  Grid,
  Globe,
  Film,
  Settings,
  Layout,
  GitBranch,
  Tool,
  Mic,
  Activity,
  Trello,
  Map,
  FileText,
  Triangle,
  Edit3,
  Book,
  Users,
  User,
  Wind,
} from "react-feather";

const I = 18; // icon size

const icons = {
  dashboard: <Grid size={I} />,
  worlds: <Globe size={I} />,
  sessions: <Film size={I} />,
  users: <Users size={I} />,
  characters: <User size={I} />,
  wikis: <Book size={I} />,
  engine: <Settings size={I} />,
  editor: <Layout size={I} />,
  worldEditor: <GitBranch size={I} />,
  builder: <Edit3 size={I} />,
  voice: <Mic size={I} />,
  waveform: <Activity size={I} />,
  board: <Trello size={I} />,
  roadmap: <Map size={I} />,
  changelog: <FileText size={I} />,
  tent: <Triangle size={I} />,
  tool: <Tool size={I} />,
  docs: <Book size={I} />,
  sounds: <Wind size={I} />,
};

/* ── Brand icon ──────────────────────────────────────────────── */

const ODYSSEY_BRAND = "var(--accent-strong)";
const odysseyIcon = (
  <span
    aria-hidden="true"
    style={{
      display: "inline-block",
      width: 34,
      height: 17,
      flexShrink: 0,
      background: ODYSSEY_BRAND,
      mask: "url('/odyssey_icon.svg') center / contain no-repeat",
      WebkitMask: "url('/odyssey_icon.svg') center / contain no-repeat",
    }}
  />
);

/* ── Nav items ────────────────────────────────────────────────── */

const tabs: SidebarTab[] = [
  { key: "dev", label: "Dev" },
  { key: "app", label: "App" },
  { key: "infra", label: "Infra" },
];

const items: SidebarItem[] = [
  { href: "/", label: "Dashboard", icon: icons.dashboard },
  { href: "/roadmap", label: "Roadmap", section: "Project", icon: icons.roadmap, tab: "dev" },
  { href: "/board", label: "Board", section: "Project", icon: icons.board, tab: "dev" },
  { href: "/docs", label: "Docs", section: "Project", icon: icons.docs, tab: "dev" },
  { href: "/changelog", label: "Changelog", section: "Project", icon: icons.changelog, tab: "dev" },
  { href: "/scenes", label: "Scenes", section: "Studio", icon: icons.worlds, tab: "app" },
  { href: "/characters", label: "Characters", section: "Studio", icon: icons.characters, tab: "app" },
  { href: "/wikis", label: "Wikis", section: "Studio", icon: icons.wikis, tab: "app" },
  { href: "/voices", label: "Voices", section: "Studio", icon: icons.waveform, tab: "app" },
  { href: "/sounds", label: "Enviro Sounds", section: "Studio", icon: icons.sounds, tab: "app" },
  { href: "/users", label: "Users", section: "Ops", icon: icons.users, tab: "app" },
  { href: "/sessions", label: "Sessions", section: "Database", icon: icons.sessions, tab: "infra" },
  { href: "/ai-icon-test", label: "AI Icon", section: "Tools", icon: icons.tool, tab: "infra" },
  { href: "/loading-indicator", label: "Loading Indicator", section: "Tools", icon: icons.waveform, tab: "infra" },
  { href: "/voice-test", label: "Voice Test", section: "Tools", icon: icons.voice, tab: "infra" },
  { href: "/voice-test-2", label: "Voice Test 2", section: "Tools", icon: icons.waveform, tab: "infra" },
  { href: "/3d-waveform", label: "3D Waveform", section: "Tools", icon: icons.waveform, tab: "infra" },
  { href: "/voice-test-3", label: "Voice Test 3", section: "Tools", icon: icons.waveform, tab: "infra" },
  { href: "/voice-test-4", label: "Voice Test 4", section: "Tools", icon: icons.waveform, tab: "infra" },
  { href: "/voice-debug", label: "Voice Debug", section: "Tools", icon: icons.waveform, tab: "infra" },
  { href: "/abrahams-tent", label: "Abraham's Tent", section: "Demos", icon: icons.tent, tab: "infra" },
  { href: "/scene-test", label: "Scene Orchestrator", section: "Demos", icon: icons.tool, tab: "infra" },
];

/* ── Shell Component ──────────────────────────────────────────── */

/* Routes whose page (and matching loading.tsx skeleton) want to render
 * full-bleed against the shell — they manage their own internal
 * padding. Without this, the SSR-streamed loading.tsx paints with the
 * shell's default 2rem outer padding for one frame, then collapses to
 * 0 once the client component's useLayoutEffect fires setFlush(true).
 * Match by path prefix (the leading "/" makes "/voices" match "/voices"
 * and "/voices/:slug" but not "/voices-something"). */
const FLUSH_ROUTE_PREFIXES = ["/voices", "/characters", "/wikis", "/sounds"];

function isFlushRoute(pathname: string | null): boolean {
  if (!pathname) return false;
  if (pathname.startsWith("/wikis/")) return true;
  return FLUSH_ROUTE_PREFIXES.some(
    (p) => pathname === p || pathname.startsWith(`${p}/`),
  );
}

function AdminShellInner({ children, initialCollapsed }: { children: React.ReactNode; initialCollapsed?: boolean }) {
  const pathname = usePathname();
  const { content: headerContent, flush } = useHeaderContent();
  /* Either explicit (a client component called setFlush) or implicit
   * (the URL is on the flush list) wins. Implicit handles the SSR
   * loading.tsx case where no client component has mounted yet. */
  const isFlush = flush || isFlushRoute(pathname);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [agentOpen, setAgentOpen] = useState(false);
  const { data: session } = useSession();
  const [theme, setTheme] = useState<"dark" | "light" | "system">(() => {
    if (typeof window !== "undefined") {
      return (localStorage.getItem("odyssey-theme") as "dark" | "light" | "system") ?? "dark";
    }
    return "dark";
  });

  useEffect(() => {
    const resolved =
      theme === "system"
        ? window.matchMedia("(prefers-color-scheme: dark)").matches
          ? "dark"
          : "light"
        : theme;
    document.documentElement.setAttribute("data-theme", resolved);
    document.documentElement.setAttribute("data-theme-variant", "river");
    document.documentElement.style.colorScheme = resolved;
    document.body.style.backgroundColor = "var(--background)";
    localStorage.setItem("odyssey-theme", theme);
    localStorage.setItem("odyssey-theme-variant", "river");
  }, [theme]);

  // Listen for OS theme changes when set to "system"
  useEffect(() => {
    if (theme !== "system") return;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const handler = (e: MediaQueryListEvent) => {
      const resolved = e.matches ? "dark" : "light";
      document.documentElement.setAttribute("data-theme", resolved);
      document.documentElement.setAttribute("data-theme-variant", "river");
      document.documentElement.style.colorScheme = resolved;
      document.body.style.backgroundColor = "var(--background)";
    };
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, [theme]);

  const handleThemeChange = useCallback((t: "dark" | "light" | "system") => {
    setTheme(t);
  }, []);

  const userName = session?.user?.name?.trim() || "Admin";
  const userRole = session?.user?.role === "admin" ? "Admin" : "User";
  const userEmail = session?.user?.email ?? undefined;

  return (
    <Sidebar
      brand="Odyssey"
      brandIcon={odysseyIcon}
      items={items}
      tabs={tabs}
      pathname={pathname}
      linkComponent={Link}
      userName={userName}
      userRole={userRole}
      userEmail={userEmail}
      workspaceName="odyssey-labs"
      docsHref="/docs"
      headerContent={headerContent}
      actions={agentOpen ? [] : [
        {
          label: "Open admin agent",
          icon: ({ hovered }) => (
            <HalftoneIntelligenceIcon
              state="thinking"
              preset={hovered ? "radial" : undefined}
              size={28}
              density="compact"
              intensity={hovered ? 1.08 : 0.9}
              speedScale={hovered ? 1.25 : 0.85}
              label="AI"
            />
          ),
          onClick: () => setAgentOpen(true),
        },
      ]}
      mainPadding={isFlush ? "0" : "2rem"}
      onSignOut={() => signOut({ callbackUrl: "/login" })}
      theme={theme}
      onThemeChange={handleThemeChange}
      onSettings={() => setSettingsOpen(true)}
      initialCollapsed={initialCollapsed}
      rightRail={<AdminAgentSidebar open={agentOpen} onOpenChange={setAgentOpen} />}
    >
      {children}
      <SettingsOverlay
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        theme={theme}
        onThemeChange={handleThemeChange}
      />
    </Sidebar>
  );
}

export function AdminShell({
  children,
  initialCollapsed,
}: {
  children: React.ReactNode;
  initialCollapsed?: boolean;
}) {
  return (
    <HeaderProvider>
      <AdminShellInner initialCollapsed={initialCollapsed}>{children}</AdminShellInner>
    </HeaderProvider>
  );
}
