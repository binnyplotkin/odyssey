import type { ReactNode, RefObject } from "react";
import { Database, Edit3, Shield } from "react-feather";
import {
  AdminKicker,
  AdminPanel,
  AdminStatusPill,
} from "@/components/admin-ui";
import { emptyStyle } from "./styles";
import type { ChatMessage, Operation, ToolCard } from "./types";
import { MessageBubble } from "./message-bubble";
import { OperationCard } from "./operation-card";
import { ToolCardView } from "./tool-card-view";

export function AgentThread({
  scrollRef,
  messages,
  toolCards,
  operations,
  approvingId,
  cancellingId,
  streaming,
  onApprove,
  onCancel,
  onUsePrompt,
}: {
  scrollRef: RefObject<HTMLDivElement | null>;
  messages: ChatMessage[];
  toolCards: ToolCard[];
  operations: Operation[];
  approvingId: string | null;
  cancellingId: string | null;
  streaming: boolean;
  onApprove: (operationId: string) => void;
  onCancel: (operationId: string) => void;
  onUsePrompt: (prompt: string) => void;
}) {
  const hasActivity =
    messages.length > 0 || toolCards.length > 0 || operations.length > 0;

  return (
    <div
      ref={scrollRef}
      style={{
        flex: 1,
        overflowY: "auto",
        padding: "14px",
        display: "flex",
        flexDirection: "column",
        gap: "var(--space-12)",
        background:
          "linear-gradient(180deg, var(--sidebar) 0%, var(--background) 100%)",
      }}
    >
      {!hasActivity && <AgentEmptyState />}

      {messages.length > 0 && (
        <div style={threadGroupStyle}>
          {messages.map((message) => (
            <MessageBubble key={message.id} message={message} />
          ))}
        </div>
      )}

      {(toolCards.length > 0 || operations.length > 0) && (
        <div style={threadGroupStyle}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: "var(--space-8)",
            }}
          >
            <AdminKicker tone="muted">Activity</AdminKicker>
            {streaming && (
              <AdminStatusPill tone="processing" dot>
                running
              </AdminStatusPill>
            )}
          </div>
          {toolCards.map((card) => (
            <ToolCardView key={card.id} card={card} onUsePrompt={onUsePrompt} />
          ))}
          {operations.map((operation) => (
            <OperationCard
              key={operation.id}
              operation={operation}
              approving={approvingId === operation.id}
              cancelling={cancellingId === operation.id}
              onApprove={() => onApprove(operation.id)}
              onCancel={() => onCancel(operation.id)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function AgentEmptyState() {
  return (
    <AdminPanel
      style={{
        ...emptyStyle,
        display: "flex",
        flexDirection: "column",
        gap: "var(--space-16)",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: "var(--space-12)",
        }}
      >
        <div>
          <AdminKicker>Admin intelligence</AdminKicker>
          <div
            style={{
              marginTop: "var(--space-6)",
              color: "var(--text-primary)",
              fontSize: "var(--font-size-lg)",
              fontWeight: 650,
              lineHeight: 1.3,
            }}
          >
            Ask, inspect, prepare, approve.
          </div>
        </div>
        <AdminStatusPill tone="accent" dot>
          ready
        </AdminStatusPill>
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
          gap: "var(--space-8)",
        }}
      >
        <EmptyCapability icon={<Database size={14} />} label="Read data" />
        <EmptyCapability icon={<Edit3 size={14} />} label="Draft writes" />
        <EmptyCapability icon={<Shield size={14} />} label="Approve only" />
      </div>

      <p
        style={{
          margin: 0,
          color: "var(--text-tertiary)",
          fontSize: "var(--font-size-base)",
          lineHeight: 1.5,
        }}
      >
        Use it for users, worlds, characters, wikis, voices, sessions, evals,
        tickets, and roadmap state. Mutations are staged for review before
        execution.
      </p>
    </AdminPanel>
  );
}

function EmptyCapability({ icon, label }: { icon: ReactNode; label: string }) {
  return (
    <div
      style={{
        minHeight: 62,
        display: "flex",
        flexDirection: "column",
        justifyContent: "space-between",
        gap: "var(--space-8)",
        padding: "10px",
        border: "1px solid var(--border)",
        borderRadius: "var(--radius-md)",
        background: "var(--control-bg)",
        color: "var(--text-secondary)",
      }}
    >
      <span style={{ color: "var(--accent-strong)", lineHeight: 0 }}>
        {icon}
      </span>
      <span
        style={{
          fontFamily: "var(--font-mono, ui-monospace, monospace)",
          fontSize: "var(--font-size-xs)",
          letterSpacing: "0.08em",
          textTransform: "uppercase",
        }}
      >
        {label}
      </span>
    </div>
  );
}

const threadGroupStyle: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: "var(--space-10)",
};
