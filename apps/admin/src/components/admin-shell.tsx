"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect } from "react";
import { Sidebar, type SidebarItem, type SidebarAction } from "@odyssey/ui";

/* ── Icon helpers ─────────────────────────────────────────────── */

function Icon({ children }: { children: React.ReactNode }) {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 18 18"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {children}
    </svg>
  );
}

const icons = {
  dashboard: (
    <Icon>
      <rect x="2" y="2" width="6" height="6" rx="1.5" />
      <rect x="10" y="2" width="6" height="6" rx="1.5" />
      <rect x="2" y="10" width="6" height="6" rx="1.5" />
      <rect x="10" y="10" width="6" height="6" rx="1.5" />
    </Icon>
  ),
  worlds: (
    <Icon>
      <circle cx="9" cy="9" r="7" />
      <path d="M2 9h14" />
      <path d="M9 2c2 2.5 3 5 3 7s-1 4.5-3 7c-2-2.5-3-5-3-7s1-4.5 3-7z" />
    </Icon>
  ),
  sessions: (
    <Icon>
      <path d="M6 2v14M12 2v14M2 6h14M2 12h14" />
    </Icon>
  ),
  engine: (
    <Icon>
      <circle cx="9" cy="9" r="2.5" />
      <path d="M9 2v2M9 14v2M2 9h2M14 9h2M4.2 4.2l1.4 1.4M12.4 12.4l1.4 1.4M4.2 13.8l1.4-1.4M12.4 5.6l1.4-1.4" />
    </Icon>
  ),
  editor: (
    <Icon>
      <rect x="2" y="2" width="14" height="14" rx="2" />
      <path d="M2 7h14M7 7v9" />
    </Icon>
  ),
  worldEditor: (
    <Icon>
      <path d="M3 3h4v4H3zM11 3h4v4h-4zM7 11h4v4H7z" />
      <path d="M5 7v2h2M13 7v2h-2M9 7v4" />
    </Icon>
  ),
  builder: (
    <Icon>
      <path d="M2 16l5-5M8 6l4 4M10 2l6 6-8 8H2v-6z" />
    </Icon>
  ),
  voice: (
    <Icon>
      <path d="M9 2v6M9 10v6M5 5v8M13 5v8M1 8v2M17 8v2" />
    </Icon>
  ),
  waveform: (
    <Icon>
      <path d="M2 9h2l2-5 2 10 2-8 2 6 2-3h2" />
    </Icon>
  ),
  roadmap: (
    <Icon>
      <path d="M3 3v12h12" />
      <path d="M7 11l3-4 4 2" />
    </Icon>
  ),
  logout: (
    <Icon>
      <path d="M6 2h8a2 2 0 012 2v10a2 2 0 01-2 2H6" />
      <path d="M10 9H2M2 9l3-3M2 9l3 3" />
    </Icon>
  ),
};

/* ── Nav items ────────────────────────────────────────────────── */

const items: SidebarItem[] = [
  { href: "/", label: "Dashboard", icon: icons.dashboard },
  { href: "/worlds", label: "Worlds", section: "Data", icon: icons.worlds },
  { href: "/sessions", label: "Sessions", section: "Data", icon: icons.sessions },
  { href: "/engine", label: "Engine", section: "Tools", icon: icons.engine },
  { href: "/editor", label: "Editor", section: "Tools", icon: icons.editor },
  { href: "/world-editor", label: "World Editor", section: "Tools", icon: icons.worldEditor },
  { href: "/builder", label: "Builder", section: "Tools", icon: icons.builder },
  { href: "/voice-test", label: "Voice Test", section: "Tools", icon: icons.voice },
  { href: "/voice-test-2", label: "Voice Test 2", section: "Tools", icon: icons.voice },
  { href: "/voice-test-3", label: "Waveform", section: "Tools", icon: icons.waveform },
  { href: "/voice-test-4", label: "3D Waveform", section: "Tools", icon: icons.waveform },
  { href: "/roadmap", label: "Roadmap", section: "Tools", icon: icons.roadmap },
];

/* ── Shell Component ──────────────────────────────────────────── */

export function AdminShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  // Always dark mode
  useEffect(() => {
    document.documentElement.setAttribute("data-theme", "dark");
  }, []);

  const actions: SidebarAction[] = [
    {
      label: "Logout",
      onClick: () => {
        document.cookie =
          "odyssey_admin_auth=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/";
        window.location.reload();
      },
      icon: icons.logout,
    },
  ];

  return (
    <Sidebar
      brand="Odyssey"
      items={items}
      actions={actions}
      pathname={pathname}
      linkComponent={Link}
      userName="Binny"
      userRole="Admin"
    >
      {children}
    </Sidebar>
  );
}
