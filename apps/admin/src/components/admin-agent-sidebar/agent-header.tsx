import { ChevronRight } from "react-feather";
import { AdminStatusPill } from "@/components/admin-ui";
import { HalftoneIntelligenceIcon } from "@/components/halftone-intelligence-icon";
import { iconButtonStyle } from "./styles";

export function AgentHeader({
  pathname,
  pendingCount = 0,
  operationCount = 0,
  streaming = false,
  onClose,
}: {
  pathname: string | null;
  pendingCount?: number;
  operationCount?: number;
  streaming?: boolean;
  onClose: () => void;
}) {
  const context = routeContextLabel(pathname);

  return (
    <header
      style={{
        display: "flex",
        flexDirection: "column",
        gap: "var(--space-8)",
        padding: "10px 14px",
        borderBottom: "1px solid var(--ink-fill)",
        background: "var(--sidebar)",
        flexShrink: 0,
      }}
    >
      <div
        style={{
          width: "100%",
          display: "flex",
          alignItems: "center",
          gap: "var(--space-10)",
        }}
      >
        <HalftoneIntelligenceIcon
          state={streaming ? "processing" : "thinking"}
          size={28}
          density="compact"
          intensity={streaming ? 0.92 : 0.82}
          speedScale={streaming ? 0.95 : 0.82}
          label="Admin AI"
        />
        <div style={{ minWidth: 0, flex: 1 }}>
          <div
            style={{
              fontSize: "var(--font-size-lg)",
              fontWeight: 650,
              color: "var(--text-primary)",
              lineHeight: 1.2,
            }}
          >
            Admin agent
          </div>
          <div
            style={{
              fontFamily: "var(--font-mono, ui-monospace, monospace)",
              fontSize: "var(--font-size-xs)",
              letterSpacing: "0.08em",
              textTransform: "uppercase",
              color: "var(--text-tertiary)",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {pathname ?? "/"}
          </div>
        </div>
        <AdminStatusPill tone="accent" dot>
          guarded
        </AdminStatusPill>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close admin agent"
          style={{
            ...iconButtonStyle,
            background: "transparent",
            borderColor: "var(--ink-line)",
          }}
        >
          <ChevronRight size={16} />
        </button>
      </div>

      <div
        style={{
          width: "100%",
          display: "flex",
          alignItems: "center",
          gap: "var(--space-6)",
          overflow: "hidden",
        }}
      >
        <ContextChip label={context.entity} value={context.value} />
        <ContextChip label="mode" value="approval" />
        <ContextChip
          label="writes"
          value={
            pendingCount > 0
              ? `${pendingCount} pending`
              : operationCount > 0
                ? `${operationCount} staged`
                : "none"
          }
          tone={pendingCount > 0 ? "warning" : "muted"}
        />
      </div>
    </header>
  );
}

function ContextChip({
  label,
  value,
  tone = "muted",
}: {
  label: string;
  value: string;
  tone?: "muted" | "warning";
}) {
  return (
    <span
      title={`${label}: ${value}`}
      style={{
        minWidth: 0,
        display: "inline-flex",
        alignItems: "center",
        gap: "var(--space-4)",
        height: 22,
        padding: "0 7px",
        border: `1px solid ${
          tone === "warning"
            ? "color-mix(in srgb, var(--warning-amber) 30%, transparent)"
            : "var(--border)"
        }`,
        borderRadius: "var(--radius-pill)",
        background:
          tone === "warning"
            ? "color-mix(in srgb, var(--warning-amber) 10%, transparent)"
            : "var(--ink-wash)",
        color:
          tone === "warning" ? "var(--warning-amber)" : "var(--text-tertiary)",
        fontFamily: "var(--font-mono, ui-monospace, monospace)",
        fontSize: "var(--font-size-xs)",
        letterSpacing: "0.08em",
        lineHeight: 1,
        textTransform: "uppercase",
        whiteSpace: "nowrap",
      }}
    >
      <span style={{ color: "var(--text-quaternary)" }}>{label}</span>
      <span
        style={{
          minWidth: 0,
          overflow: "hidden",
          textOverflow: "ellipsis",
        }}
      >
        {value}
      </span>
    </span>
  );
}

function routeContextLabel(pathname: string | null) {
  const parts = (pathname ?? "/").split("/").filter(Boolean);
  if (parts[0] === "characters") {
    return { entity: "character", value: parts[1] ?? "index" };
  }
  if (parts[0] === "wikis") {
    return { entity: "wiki", value: parts[1] ?? "index" };
  }
  if (parts[0] === "voices") {
    return { entity: "voice", value: parts[1] ?? "library" };
  }
  if (parts[0] === "worlds") {
    return { entity: "world", value: parts[1] ?? "index" };
  }
  if (parts[0] === "sessions") {
    return { entity: "session", value: parts[1] ?? "index" };
  }
  return { entity: "route", value: pathname ?? "/" };
}
