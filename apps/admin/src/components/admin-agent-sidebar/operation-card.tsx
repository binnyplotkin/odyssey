import {
  AlertTriangle,
  CheckCircle,
  Cpu,
  Shield,
  XCircle,
} from "react-feather";
import {
  AdminButton,
  AdminPanel,
  AdminStatusPill,
} from "@/components/admin-ui";
import { preStyle, riskColor, riskTone } from "./styles";
import type { Operation } from "./types";

export function OperationCard({
  operation,
  approving,
  cancelling,
  onApprove,
  onCancel,
}: {
  operation: Operation;
  approving: boolean;
  cancelling: boolean;
  onApprove: () => void;
  onCancel: () => void;
}) {
  const pending = operation.status === "pending";
  const effectiveStatus = approving
    ? "approving"
    : cancelling
      ? "rejecting"
      : operation.status;
  const cancelled =
    effectiveStatus === "cancelled" ||
    effectiveStatus === "canceled" ||
    effectiveStatus === "rejected";
  const executed =
    effectiveStatus === "executed" || effectiveStatus === "completed";
  const tone = riskTone(operation.riskLevel);
  const statusTone =
    effectiveStatus === "failed"
      ? "danger"
      : cancelling || cancelled
        ? "muted"
        : approving
          ? "processing"
          : pending
            ? tone
            : executed
              ? "accent"
              : "muted";

  return (
    <AdminPanel
      padding="12px"
      style={{
        borderColor: riskColor(operation.riskLevel),
        background:
          pending && operation.riskLevel !== "low"
            ? "color-mix(in srgb, var(--warning-amber) 7%, var(--material-card))"
            : "var(--material-card)",
      }}
    >
      <div
        style={{
          display: "flex",
          gap: "var(--space-8)",
          alignItems: "center",
          marginBottom: "var(--space-8)",
        }}
      >
        {approving ? (
          <Cpu size={15} color="var(--status-processing)" />
        ) : cancelling || cancelled ? (
          <XCircle size={15} color="var(--text-tertiary)" />
        ) : pending ? (
          <Shield size={15} color={riskColor(operation.riskLevel)} />
        ) : effectiveStatus === "failed" ? (
          <AlertTriangle size={15} color="var(--status-error)" />
        ) : executed ? (
          <CheckCircle size={15} color="var(--accent-strong)" />
        ) : (
          <Cpu size={15} color={riskColor(operation.riskLevel)} />
        )}
        <strong
          style={{
            fontSize: "var(--font-size-md)",
            lineHeight: 1.35,
            flex: 1,
            minWidth: 0,
            color: "var(--text-primary)",
          }}
        >
          {operation.intent}
        </strong>
        <AdminStatusPill tone={tone}>{operation.riskLevel}</AdminStatusPill>
      </div>

      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: "var(--space-8)",
          marginBottom: "var(--space-10)",
        }}
      >
        <span
          style={{
            minWidth: 0,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
            fontFamily: "var(--font-mono, ui-monospace, monospace)",
            fontSize: "var(--font-size-xs)",
            letterSpacing: "0.08em",
            textTransform: "uppercase",
            color: "var(--text-tertiary)",
          }}
        >
          {operation.toolName}
        </span>
        <AdminStatusPill
          tone={statusTone}
          dot={pending || approving || cancelling}
        >
          {formatOperationStatus(effectiveStatus)}
        </AdminStatusPill>
      </div>
      <OperationPreview operation={operation} />
      <details style={{ marginBottom: pending ? 10 : 0 }}>
        <summary
          style={{
            cursor: "pointer",
            fontFamily: "var(--font-mono, ui-monospace, monospace)",
            fontSize: "var(--font-size-xs)",
            letterSpacing: "0.08em",
            textTransform: "uppercase",
            color: "var(--text-tertiary)",
          }}
        >
          Raw preview
        </summary>
        <pre style={preStyle}>
          {JSON.stringify(operation.previewDiff, null, 2)}
        </pre>
      </details>
      {operation.errorMessage && (
        <div
          style={{
            color: "var(--status-error)",
            fontSize: "var(--font-size-base)",
            marginTop: "var(--space-8)",
          }}
        >
          {operation.errorMessage}
        </div>
      )}
      {executed && operation.resultSummary != null && (
        <div style={resultBoxStyle}>
          <div style={resultTitleStyle}>Result</div>
          <pre style={resultPreStyle}>
            {JSON.stringify(operation.resultSummary, null, 2)}
          </pre>
        </div>
      )}
      {cancelled && (
        <div style={cancelledBoxStyle}>
          This operation was rejected and no write was executed.
        </div>
      )}
      {pending && (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "96px minmax(0, 1fr)",
            gap: "var(--space-8)",
            marginTop: "var(--space-10)",
          }}
        >
          <AdminButton
            variant="secondary"
            tone="muted"
            onClick={onCancel}
            disabled={approving || cancelling}
          >
            {cancelling ? "Rejecting..." : "Reject"}
          </AdminButton>
          <AdminButton
            variant="primary"
            tone={tone}
            onClick={onApprove}
            disabled={approving || cancelling}
          >
            {approving ? "Approving..." : "Approve and execute"}
          </AdminButton>
        </div>
      )}
    </AdminPanel>
  );
}

function formatOperationStatus(status: string) {
  if (status === "canceled") return "cancelled";
  return status.replace(/_/g, " ");
}

function OperationPreview({ operation }: { operation: Operation }) {
  const preview = asRecord(operation.previewDiff);
  const affected = Array.isArray(operation.affectedRecords)
    ? operation.affectedRecords.map(asRecord).filter(isRecord)
    : [];

  if (preview?.kind === "operation_batch") {
    const operations = Array.isArray(preview.operations)
      ? preview.operations.map(asRecord).filter(isRecord)
      : [];
    return (
      <div style={previewBoxStyle}>
        <div style={previewTitleStyle}>
          {String(preview.title ?? "Batch plan")}
        </div>
        {typeof preview.rationale === "string" && (
          <div style={previewTextStyle}>{preview.rationale}</div>
        )}
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 6,
            marginTop: 8,
          }}
        >
          {operations.map((item, index) => (
            <div key={index} style={miniCardStyle}>
              <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                <span style={indexPillStyle}>{index + 1}</span>
                <strong style={{ fontSize: 12 }}>
                  {String(item.intent ?? item.toolName ?? "Operation")}
                </strong>
              </div>
              <div style={mutedLineStyle}>
                {String(item.toolName ?? "tool")} ·{" "}
                {String(item.riskLevel ?? "risk")}
              </div>
              <AffectedRecords records={item.affectedRecords} />
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (preview?.patch && typeof preview.patch === "object") {
    const patch = asRecord(preview.patch) ?? {};
    return (
      <div style={previewBoxStyle}>
        {typeof preview.rationale === "string" && (
          <div style={previewTextStyle}>{preview.rationale}</div>
        )}
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 6,
            marginTop: 8,
          }}
        >
          {Object.keys(patch).map((field) => (
            <div key={field} style={fieldDiffStyle}>
              <span style={{ fontWeight: 600 }}>{field}</span>
              <span style={{ color: "var(--text-tertiary)" }}>
                {shortValue(asRecord(preview.before)?.[field])} {"->"}{" "}
                {shortValue(patch[field])}
              </span>
            </div>
          ))}
        </div>
        <AffectedRecords records={affected} />
      </div>
    );
  }

  if (preview?.externalSideEffect) {
    return (
      <div style={previewBoxStyle}>
        <div style={previewTitleStyle}>
          {String(preview.externalSideEffect)}
        </div>
        <AffectedRecords records={affected} />
      </div>
    );
  }

  if (affected.length > 0) {
    return (
      <div style={previewBoxStyle}>
        <AffectedRecords records={affected} />
      </div>
    );
  }

  return null;
}

function AffectedRecords({ records }: { records: unknown }) {
  const items = Array.isArray(records)
    ? records.map(asRecord).filter(isRecord)
    : [];
  if (items.length === 0) return null;
  return (
    <div style={{ marginTop: 8 }}>
      <div style={mutedLineStyle}>Affected records</div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 5 }}>
        {items.slice(0, 8).map((record, index) => (
          <span key={index} style={recordPillStyle}>
            {String(record.table ?? "record")}:
            {String(record.label ?? record.id ?? "?")}
          </span>
        ))}
        {items.length > 8 && (
          <span style={recordPillStyle}>+{items.length - 8} more</span>
        )}
      </div>
    </div>
  );
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

function shortValue(value: unknown) {
  if (value === undefined) return "(unset)";
  if (value === null) return "null";
  if (typeof value === "string")
    return value.length > 64 ? `${value.slice(0, 61)}...` : value;
  const text = JSON.stringify(value);
  return text.length > 64 ? `${text.slice(0, 61)}...` : text;
}

const previewBoxStyle = {
  border: "1px solid var(--border)",
  borderRadius: "var(--radius-md)",
  padding: 10,
  background: "var(--control-bg)",
  marginBottom: 10,
};

const previewTitleStyle = {
  fontSize: 12,
  fontWeight: 700,
  marginBottom: 5,
};

const previewTextStyle = {
  fontSize: 12,
  color: "var(--text-secondary)",
  lineHeight: 1.4,
};

const resultBoxStyle = {
  border: "1px solid var(--accent-border)",
  borderRadius: "var(--radius-md)",
  padding: 10,
  background: "var(--accent-wash)",
  marginTop: 10,
};

const resultTitleStyle = {
  fontFamily: "var(--font-mono, ui-monospace, monospace)",
  fontSize: "var(--font-size-xs)",
  letterSpacing: "0.1em",
  textTransform: "uppercase" as const,
  color: "var(--accent-strong)",
  marginBottom: 6,
};

const resultPreStyle = {
  ...preStyle,
  maxHeight: 120,
  margin: 0,
  background: "color-mix(in srgb, var(--background) 52%, transparent)",
};

const cancelledBoxStyle = {
  border: "1px solid var(--border)",
  borderRadius: "var(--radius-md)",
  padding: "9px 10px",
  background: "var(--ink-wash)",
  color: "var(--text-secondary)",
  fontSize: "var(--font-size-base)",
  lineHeight: 1.45,
  marginTop: 10,
};

const miniCardStyle = {
  border: "1px solid var(--border)",
  borderRadius: "var(--radius-sm)",
  padding: 7,
  background: "var(--ink-wash)",
};

const indexPillStyle = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  width: 18,
  height: 18,
  borderRadius: "var(--radius-pill)",
  border: "1px solid var(--border)",
  fontSize: 10,
  color: "var(--text-secondary)",
};

const mutedLineStyle = {
  fontSize: 11,
  color: "var(--text-tertiary)",
  marginTop: 4,
};

const fieldDiffStyle = {
  display: "flex",
  flexDirection: "column" as const,
  gap: 2,
  fontSize: 12,
};

const recordPillStyle = {
  border: "1px solid var(--border)",
  borderRadius: "var(--radius-pill)",
  padding: "2px 7px",
  fontSize: 10,
  color: "var(--text-secondary)",
  maxWidth: "100%",
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap" as const,
};
