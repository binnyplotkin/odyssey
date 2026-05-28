import type { CSSProperties } from "react";
import type { Operation } from "./types";

export const iconButtonStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  width: 30,
  height: 30,
  borderRadius: "var(--radius-md)",
  border: "1px solid var(--border)",
  background: "var(--ink-wash)",
  color: "var(--text-secondary)",
  cursor: "pointer",
};

export const emptyStyle: CSSProperties = {
  border: "1px solid var(--border)",
  borderRadius: "var(--radius-md)",
  padding: "14px 16px",
  color: "var(--text-secondary)",
  fontSize: "var(--font-size-md)",
  lineHeight: 1.5,
  background: "var(--material-card)",
};

export const cardStyle: CSSProperties = {
  border: "1px solid var(--border)",
  borderRadius: "var(--radius-md)",
  padding: "12px",
  background: "var(--material-card)",
};

export const pillStyle: CSSProperties = {
  border: "1px solid var(--border)",
  borderRadius: "var(--radius-pill)",
  padding: "2px 7px",
  fontFamily: "var(--font-mono, ui-monospace, monospace)",
  fontSize: "var(--font-size-xs)",
  letterSpacing: "0.1em",
  textTransform: "uppercase",
  color: "var(--text-secondary)",
};

export const preStyle: CSSProperties = {
  maxHeight: 220,
  overflow: "auto",
  whiteSpace: "pre-wrap",
  wordBreak: "break-word",
  margin: "8px 0 0",
  padding: "10px",
  border: "1px solid var(--border)",
  borderRadius: "var(--radius-sm)",
  background: "var(--control-bg)",
  color: "var(--text-secondary)",
  fontFamily: "var(--font-mono, ui-monospace, monospace)",
  fontSize: "var(--font-size-sm)",
};

export function riskColor(risk: Operation["riskLevel"]) {
  if (risk === "destructive") return "var(--critical-crimson)";
  if (risk === "high") return "var(--warning-amber)";
  if (risk === "medium") return "var(--signal-blue)";
  return "var(--accent-strong)";
}

export function riskTone(risk: Operation["riskLevel"]) {
  if (risk === "destructive") return "danger" as const;
  if (risk === "high") return "warning" as const;
  if (risk === "medium") return "processing" as const;
  return "accent" as const;
}
