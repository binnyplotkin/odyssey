import type { ReactNode } from "react";

export const ADMIN_AGENT_PANEL_WIDTH = 420;

export function AgentRail({
  open,
  children,
}: {
  open: boolean;
  children: ReactNode;
}) {
  return (
    <aside
      className="admin-agent-glass-rail"
      aria-label="Admin AI agent"
      aria-hidden={!open}
      style={{
        flexGrow: 0,
        flexShrink: 0,
        flexBasis: open ? ADMIN_AGENT_PANEL_WIDTH : 0,
        width: open ? ADMIN_AGENT_PANEL_WIDTH : 0,
        maxWidth: "42vw",
        minWidth: 0,
        height: "100vh",
        overflow: "hidden",
        pointerEvents: open ? "auto" : "none",
        transition:
          "flex-basis 180ms ease, width 180ms ease, border-color 180ms ease",
        background: "var(--sidebar)",
        borderLeft: open ? "1px solid var(--ink-fill)" : "0 solid transparent",
        boxShadow: open
          ? "-18px 0 48px color-mix(in srgb, var(--shadow) 28%, transparent)"
          : "none",
        display: "flex",
        flexDirection: "column",
      }}
    >
      <div
        className="admin-agent-glass-rail__inner"
        style={{
          width: ADMIN_AGENT_PANEL_WIDTH,
          maxWidth: "42vw",
          minWidth: 0,
          height: "100%",
          display: "flex",
          flexDirection: "column",
          background: "var(--sidebar)",
        }}
      >
        {children}
      </div>
    </aside>
  );
}
