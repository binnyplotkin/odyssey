import type { ChatMessage } from "./types";
import { AdminKicker, AdminStatusPill } from "@/components/admin-ui";
import { HalftoneIntelligenceIcon } from "@/components/halftone-intelligence-icon";

export function MessageBubble({ message }: { message: ChatMessage }) {
  const isUser = message.role === "user";
  const isSystem = message.role === "system";
  const isEmptyAssistant = message.role === "assistant" && !message.content;
  const label = isUser ? "You" : isSystem ? "System" : "Agent";

  return (
    <div
      style={{
        alignSelf: isUser ? "flex-end" : "stretch",
        maxWidth: isUser ? "86%" : "100%",
        display: "flex",
        flexDirection: "column",
        gap: "var(--space-6)",
        border: `1px solid ${
          isUser
            ? "var(--accent-border)"
            : isSystem
              ? "var(--border-medium)"
              : "var(--border)"
        }`,
        background: isUser
          ? "var(--accent-soft)"
          : isSystem
            ? "var(--ink-wash)"
            : "var(--material-card)",
        borderRadius: "var(--radius-md)",
        padding: "10px 12px",
        fontSize: "var(--font-size-md)",
        lineHeight: 1.45,
        color: isSystem ? "var(--text-secondary)" : "var(--text-primary)",
        whiteSpace: "pre-wrap",
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
        <AdminKicker tone={isUser ? "accent" : isSystem ? "muted" : "default"}>
          {label}
        </AdminKicker>
        {isEmptyAssistant && (
          <AdminStatusPill tone="processing" dot>
            thinking
          </AdminStatusPill>
        )}
      </div>
      {isEmptyAssistant ? (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "var(--space-10)",
            color: "var(--text-secondary)",
          }}
        >
          <HalftoneIntelligenceIcon
            state="thinking"
            size={24}
            density="compact"
            intensity={0.8}
            speedScale={0.82}
            label="Thinking"
          />
          <span>Preparing a response...</span>
        </div>
      ) : (
        <div>{message.content}</div>
      )}
    </div>
  );
}
