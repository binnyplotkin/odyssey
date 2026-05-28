import { CheckCircle, Cpu, XCircle } from "react-feather";
import { AdminPanel, AdminStatusPill } from "@/components/admin-ui";
import type { ToolCard } from "./types";

export function ToolCardView({
  card,
  onUsePrompt,
}: {
  card: ToolCard;
  onUsePrompt: (prompt: string) => void;
}) {
  const failed = card.status === "failed";
  const completed = card.status === "completed";
  const tone = failed ? "danger" : completed ? "accent" : "processing";

  return (
    <AdminPanel
      padding="10px 12px"
      style={{
        borderColor:
          tone === "danger"
            ? "var(--critical-border)"
            : tone === "processing"
              ? "color-mix(in srgb, var(--status-processing) 28%, transparent)"
              : "var(--accent-border)",
        background: "var(--control-bg)",
      }}
    >
      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
        {failed ? (
          <XCircle size={15} color="var(--status-error)" />
        ) : completed ? (
          <CheckCircle size={15} color="var(--accent-strong)" />
        ) : (
          <Cpu size={15} color="var(--status-processing)" />
        )}
        <strong
          style={{
            minWidth: 0,
            flex: 1,
            color: "var(--text-primary)",
            fontFamily: "var(--font-mono, ui-monospace, monospace)",
            fontSize: "var(--font-size-sm)",
            letterSpacing: "0.04em",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {card.toolName}
        </strong>
        <AdminStatusPill tone={tone} dot={card.status === "running"}>
          {card.status}
        </AdminStatusPill>
      </div>
      {card.detail && (
        <div
          style={{
            fontSize: "var(--font-size-base)",
            color: "var(--text-secondary)",
            lineHeight: 1.45,
            marginTop: "var(--space-8)",
          }}
        >
          {card.detail}
        </div>
      )}
      {card.toolName === "analyze_sessions" && completed && (
        <SessionAuditCard card={card} onUsePrompt={onUsePrompt} />
      )}
    </AdminPanel>
  );
}

function SessionAuditCard({
  card,
  onUsePrompt,
}: {
  card: ToolCard;
  onUsePrompt: (prompt: string) => void;
}) {
  const result = asRecord(card.result);
  const data = asRecord(result?.data);
  if (!data) return null;

  const sessions = Array.isArray(data.sessions)
    ? data.sessions.map(asRecord).filter(isRecord)
    : [];
  const snippets = Array.isArray(data.evidenceSnippets)
    ? data.evidenceSnippets.map(asRecord).filter(isRecord)
    : [];
  const targets = Array.isArray(data.recommendationTargets)
    ? data.recommendationTargets.filter(
        (item): item is string => typeof item === "string",
      )
    : [];

  return (
    <div style={auditBoxStyle}>
      <div style={metricGridStyle}>
        <Metric label="sessions" value={data.sessionCount} />
        <Metric label="turns" value={data.turnCount} />
        <Metric label="errors" value={data.errorEventCount} />
        <Metric label="grounded" value={data.citedContextBuildCount} />
      </div>

      <div style={sectionStyle}>
        <div style={sectionTitleStyle}>Quality signals</div>
        <div style={signalGridStyle}>
          <Signal
            label="failed turns"
            value={data.failedTurnCount}
            tone={Number(data.failedTurnCount ?? 0) > 0 ? "warn" : "ok"}
          />
          <Signal
            label="empty replies"
            value={data.missingAssistantTurnCount}
            tone={
              Number(data.missingAssistantTurnCount ?? 0) > 0 ? "warn" : "ok"
            }
          />
          <Signal
            label="avg chars"
            value={data.averageAssistantChars}
            tone={Number(data.averageAssistantChars ?? 0) < 160 ? "warn" : "ok"}
          />
        </div>
      </div>

      {targets.length > 0 && (
        <div style={sectionStyle}>
          <div style={sectionTitleStyle}>Improvement targets</div>
          <ul style={listStyle}>
            {targets.slice(0, 4).map((target, index) => (
              <li key={index}>{target}</li>
            ))}
          </ul>
        </div>
      )}

      {sessions.length > 0 && (
        <div style={sectionStyle}>
          <div style={sectionTitleStyle}>Sessions reviewed</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {sessions.slice(0, 5).map((session) => (
              <div key={String(session.id)} style={rowStyle}>
                <span
                  style={{
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  {String(session.id)}
                </span>
                <span>{String(session.turnCount ?? 0)} turns</span>
              </div>
            ))}
            {sessions.length > 5 && (
              <div style={mutedStyle}>+{sessions.length - 5} more sessions</div>
            )}
          </div>
        </div>
      )}

      {snippets.length > 0 && (
        <details style={sectionStyle}>
          <summary style={summaryStyle}>Transcript snippets</summary>
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: 8,
              marginTop: 8,
            }}
          >
            {snippets.slice(0, 3).map((snippet, index) => (
              <div key={index} style={snippetStyle}>
                <div style={mutedStyle}>
                  {String(snippet.sessionId ?? "session")} · turn{" "}
                  {String(snippet.turnIndex ?? "?")}
                </div>
                {typeof snippet.userText === "string" && snippet.userText && (
                  <div>
                    <strong>User:</strong> {snippet.userText}
                  </div>
                )}
                {typeof snippet.assistantText === "string" &&
                  snippet.assistantText && (
                    <div>
                      <strong>Agent:</strong> {snippet.assistantText}
                    </div>
                  )}
              </div>
            ))}
          </div>
        </details>
      )}

      <button
        type="button"
        onClick={() => onUsePrompt(buildImprovementPrompt(data))}
        style={actionButtonStyle}
      >
        Draft improvement plan prompt
      </button>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: unknown }) {
  return (
    <div style={metricStyle}>
      <span style={metricValueStyle}>{String(value ?? 0)}</span>
      <span style={metricLabelStyle}>{label}</span>
    </div>
  );
}

function Signal({
  label,
  value,
  tone,
}: {
  label: string;
  value: unknown;
  tone: "ok" | "warn";
}) {
  return (
    <div
      style={{
        ...signalStyle,
        borderColor: tone === "warn" ? "var(--warning-amber)" : "var(--border)",
      }}
    >
      <span>{label}</span>
      <strong>{String(value ?? 0)}</strong>
    </div>
  );
}

function buildImprovementPrompt(data: Record<string, unknown>) {
  const characterId =
    typeof data.characterId === "string" ? data.characterId : "";
  const targetText = Array.isArray(data.recommendationTargets)
    ? data.recommendationTargets
        .filter((item) => typeof item === "string")
        .join("\n- ")
    : "";
  const scope = characterId ? ` for character ${characterId}` : "";
  return [
    `Based on the session audit${scope}, propose a conservative improvement plan.`,
    "",
    "Use the audit evidence already gathered in this conversation. If more context is needed, trace the character/wiki/session context first.",
    "Prefer one propose_operation_batch with safe propose_entity_patch and ticket operations only.",
    "Do not include deletes, GitHub operations, or destructive work.",
    targetText ? `\nAudit targets:\n- ${targetText}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function isRecord(
  value: Record<string, unknown> | null,
): value is Record<string, unknown> {
  return value !== null;
}

const auditBoxStyle = {
  marginTop: 10,
  border: "1px solid var(--border)",
  borderRadius: "var(--radius-md)",
  padding: 10,
  background: "var(--control-bg)",
};

const metricGridStyle = {
  display: "grid",
  gridTemplateColumns: "repeat(4, minmax(0, 1fr))",
  gap: 6,
};

const metricStyle = {
  minWidth: 0,
  border: "1px solid var(--border)",
  borderRadius: "var(--radius-sm)",
  padding: "7px 6px",
  background: "var(--material-card)",
  display: "flex",
  flexDirection: "column" as const,
  gap: 2,
};

const metricValueStyle = {
  fontSize: 15,
  fontWeight: 700,
  color: "var(--text-primary)",
};

const metricLabelStyle = {
  fontFamily: "var(--font-mono, ui-monospace, monospace)",
  fontSize: "var(--font-size-xs)",
  color: "var(--text-tertiary)",
  textTransform: "uppercase" as const,
  letterSpacing: "0.06em",
};

const sectionStyle = {
  marginTop: 10,
};

const sectionTitleStyle = {
  fontSize: 12,
  fontWeight: 700,
  color: "var(--text-secondary)",
  marginBottom: 6,
};

const signalGridStyle = {
  display: "grid",
  gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
  gap: 6,
};

const signalStyle = {
  border: "1px solid var(--border)",
  borderRadius: "var(--radius-sm)",
  padding: 7,
  fontSize: 11,
  color: "var(--text-secondary)",
  display: "flex",
  flexDirection: "column" as const,
  gap: 2,
};

const listStyle = {
  margin: 0,
  paddingLeft: 18,
  color: "var(--text-secondary)",
  fontSize: 12,
  lineHeight: 1.45,
};

const rowStyle = {
  display: "grid",
  gridTemplateColumns: "minmax(0, 1fr) auto",
  gap: 8,
  fontSize: 11,
  color: "var(--text-secondary)",
};

const mutedStyle = {
  fontSize: 11,
  color: "var(--text-tertiary)",
};

const summaryStyle = {
  cursor: "pointer",
  fontSize: 12,
  fontWeight: 700,
  color: "var(--text-secondary)",
};

const snippetStyle = {
  border: "1px solid var(--border)",
  borderRadius: "var(--radius-sm)",
  padding: 8,
  fontSize: 12,
  color: "var(--text-secondary)",
  lineHeight: 1.4,
};

const actionButtonStyle = {
  width: "100%",
  marginTop: 10,
  height: 32,
  borderRadius: "var(--radius-sm)",
  border: "1px solid var(--accent-strong)",
  background: "var(--material-card)",
  color: "var(--accent-strong)",
  cursor: "pointer",
  fontWeight: 650,
};
