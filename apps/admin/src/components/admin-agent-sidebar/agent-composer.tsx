import type { ReactNode } from "react";
import { Command, Edit3, Search, Send } from "react-feather";
import { AdminStatusPill } from "@/components/admin-ui";

export function AgentComposer({
  draft,
  streaming,
  onDraftChange,
  onSubmit,
}: {
  draft: string;
  streaming: boolean;
  onDraftChange: (draft: string) => void;
  onSubmit: () => void;
}) {
  const disabled = !draft.trim() || streaming;

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit();
      }}
      style={{
        padding: "12px 14px 14px",
        borderTop: "1px solid var(--ink-fill)",
        background: "var(--sidebar)",
        display: "flex",
        flexDirection: "column",
        gap: "var(--space-10)",
        flexShrink: 0,
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: "var(--space-8)",
        }}
      >
        <QuickPrompt
          icon={<Search size={12} />}
          label="Inspect"
          onClick={() =>
            onDraftChange(
              "Inspect this page and summarize the important state.",
            )
          }
        />
        <QuickPrompt
          icon={<Edit3 size={12} />}
          label="Draft"
          onClick={() =>
            onDraftChange("Draft the safest change plan for this page.")
          }
        />
        <QuickPrompt
          icon={<Command size={12} />}
          label="Ops"
          onClick={() =>
            onDraftChange("Show recent operational risks and pending work.")
          }
        />
        {streaming && (
          <AdminStatusPill tone="processing" dot>
            streaming
          </AdminStatusPill>
        )}
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "minmax(0, 1fr) 38px",
          gap: "var(--space-8)",
          alignItems: "end",
        }}
      >
        <textarea
          value={draft}
          onChange={(event) => onDraftChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              onSubmit();
            }
          }}
          placeholder="Ask the admin agent..."
          rows={2}
          style={{
            resize: "none",
            minHeight: 58,
            maxHeight: 148,
            border: "1px solid var(--control-border)",
            borderRadius: "var(--radius-md)",
            padding: "10px 11px",
            background: "var(--control-bg)",
            color: "var(--text-primary)",
            font: "inherit",
            fontSize: "var(--font-size-md)",
            lineHeight: 1.42,
            outline: "none",
          }}
        />
        <button
          type="submit"
          disabled={disabled}
          aria-label="Send"
          title="Send"
          style={{
            width: 38,
            height: 38,
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            border: `1px solid ${
              disabled ? "var(--border)" : "var(--accent-strong)"
            }`,
            borderRadius: "var(--radius-md)",
            background: disabled ? "var(--ink-wash)" : "var(--accent-strong)",
            color: disabled ? "var(--text-quaternary)" : "var(--accent-on)",
            cursor: disabled ? "not-allowed" : "pointer",
            opacity: disabled ? 0.65 : 1,
          }}
        >
          <Send size={16} />
        </button>
      </div>
    </form>
  );
}

function QuickPrompt({
  icon,
  label,
  onClick,
}: {
  icon: ReactNode;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        gap: "var(--space-6)",
        minWidth: 0,
        height: 26,
        padding: "0 8px",
        border: "1px solid var(--border)",
        borderRadius: "var(--radius-md)",
        background: "var(--ink-wash)",
        color: "var(--text-secondary)",
        cursor: "pointer",
        fontFamily: "var(--font-mono, ui-monospace, monospace)",
        fontSize: "var(--font-size-xs)",
        letterSpacing: "0.08em",
        textTransform: "uppercase",
      }}
    >
      {icon}
      {label}
    </button>
  );
}
