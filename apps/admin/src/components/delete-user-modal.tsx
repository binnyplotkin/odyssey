"use client";

import { useEffect, useState } from "react";
import { deleteUser } from "@/app/(authenticated)/users/actions";

const T = {
  fg: "#FFFFFFE6",
  fgDim: "#FFFFFFD9",
  muted: "#FFFFFF80",
  faint: "#FFFFFF66",
  panel: "#161A24",
  panelInner: "#0C0E14",
  border: "#FFFFFF14",
  borderSoft: "#FFFFFF0F",
  borderFaint: "#FFFFFF0A",
  red: "#F37272",
  redText: "#F4A8A8",
  redBg: "rgba(243,114,114,0.10)",
  redBorder: "rgba(243,114,114,0.32)",
  backdrop: "rgba(5,7,12,0.62)",
  fontHeading: "'Space Grotesk', sans-serif",
  fontBody: "'Inter', sans-serif",
  fontMono: "var(--font-mono, 'JetBrains Mono', monospace)",
};

export type DeleteUserTarget = {
  id: string;
  name: string | null;
  email: string;
  sessionCount: number;
};

type Props = {
  open: boolean;
  target: DeleteUserTarget | null;
  onClose: () => void;
  onDeleted: () => void;
};

export function DeleteUserModal({ open, target, onClose, onDeleted }: Props) {
  const [confirm, setConfirm] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setConfirm("");
      setError(null);
      setPending(false);
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape" && !pending) onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, pending, onClose]);

  if (!open || !target) return null;

  const expected = target.email;
  const canDelete = confirm.trim().toLowerCase() === expected.toLowerCase() && !pending;

  async function handleDelete() {
    if (!target) return;
    setPending(true);
    setError(null);
    const res = await deleteUser(target.id);
    setPending(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    onDeleted();
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !pending) onClose();
      }}
      style={{
        position: "fixed", inset: 0, zIndex: 1000,
        display: "flex", alignItems: "center", justifyContent: "center",
        padding: "var(--space-16)",
        backgroundColor: T.backdrop,
        animation: "userModalFade 140ms ease-out",
      }}
    >
      <style>{`
        @keyframes userModalFade { from { opacity: 0 } to { opacity: 1 } }
        @keyframes userModalRise { from { opacity: 0; transform: translateY(6px) scale(0.985) } to { opacity: 1; transform: none } }
      `}</style>
      <div
        style={{
          width: 460, maxWidth: "100%",
          background: T.panel, border: `1px solid ${T.border}`,
          borderRadius: "var(--radius-3xl)", overflow: "hidden",
          boxShadow: "var(--elevation-modal)",
          animation: "userModalRise 180ms cubic-bezier(0.22, 1, 0.36, 1)",
        }}
      >
        {/* Header */}
        <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-10)", padding: "22px 24px 18px 24px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "var(--space-8)" }}>
            <span style={{
              display: "flex", alignItems: "center", justifyContent: "center",
              width: 22, height: 22, borderRadius: "var(--radius-sm)",
              background: T.redBg, flexShrink: 0,
            }}>
              <TrashIcon size={11} stroke={T.red} strokeWidth={2.4} />
            </span>
            <span style={{
              fontFamily: T.fontMono, fontSize: "var(--font-size-xs)", fontWeight: 600,
              color: T.red, letterSpacing: "0.12em", textTransform: "uppercase",
            }}>
              Delete user
            </span>
          </div>
          <div style={{
            fontFamily: T.fontHeading, fontSize: 20, fontWeight: 600,
            color: T.fg, lineHeight: "26px", letterSpacing: "-0.005em",
          }}>
            Permanently delete {target.name ?? target.email}?
          </div>
          <div style={{ fontFamily: T.fontBody, fontSize: "var(--font-size-md)", color: T.muted, lineHeight: "19px" }}>
            Their account, OAuth links, and all {target.sessionCount} active session{target.sessionCount === 1 ? "" : "s"} will be removed. Game sessions they created will be retained but unowned. This can't be undone.
          </div>
        </div>

        {/* Confirm input */}
        <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-8)", padding: "0 24px" }}>
          <div style={{ fontFamily: T.fontBody, fontSize: "var(--font-size-base)", color: T.faint, lineHeight: "16px" }}>
            Type <span style={{ fontFamily: T.fontMono, color: T.fgDim }}>{expected}</span> to confirm.
          </div>
          <input
            type="text"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            placeholder={expected}
            autoFocus
            style={{
              padding: "11px 14px",
              background: T.panelInner, border: `1px solid ${confirm && !canDelete ? T.redBorder : T.border}`,
              borderRadius: "var(--radius-lg)",
              fontFamily: T.fontMono, fontSize: "var(--font-size-lg)", color: T.fg, outline: "none",
            }}
          />
        </div>

        {error && (
          <div style={{
            margin: "16px 24px 0 24px",
            padding: "10px 14px",
            borderRadius: "var(--radius-lg)",
            background: T.redBg,
            border: `1px solid ${T.redBorder}`,
            fontFamily: T.fontBody, fontSize: "var(--font-size-base)", color: T.redText,
          }}>
            {error}
          </div>
        )}

        {/* Footer */}
        <div style={{
          display: "flex", alignItems: "center", justifyContent: "flex-end", gap: "var(--space-8)",
          padding: "20px 24px",
          marginTop: "var(--space-16)",
          borderTop: `1px solid ${T.borderFaint}`,
        }}>
          <button type="button" onClick={onClose} disabled={pending} style={ghostButtonStyle(pending)}>
            Cancel
          </button>
          <button type="button" onClick={handleDelete} disabled={!canDelete} style={dangerButtonStyle(!canDelete)}>
            <TrashIcon size={11} stroke={T.redText} strokeWidth={2.2} />
            {pending ? "Deleting…" : "Delete user"}
          </button>
        </div>
      </div>
    </div>
  );
}

function ghostButtonStyle(disabled: boolean): React.CSSProperties {
  return {
    padding: "9px 16px", borderRadius: "var(--radius-md)",
    border: `1px solid ${T.border}`, background: "transparent",
    fontFamily: T.fontBody, fontSize: "var(--font-size-md)", fontWeight: 500,
    color: T.fgDim,
    cursor: disabled ? "not-allowed" : "pointer",
    opacity: disabled ? 0.6 : 1,
  };
}

function dangerButtonStyle(disabled: boolean): React.CSSProperties {
  return {
    display: "flex", alignItems: "center", gap: 7,
    padding: "9px 18px", borderRadius: "var(--radius-md)",
    border: `1px solid ${T.redBorder}`,
    background: "rgba(243,114,114,0.14)",
    fontFamily: T.fontBody, fontSize: "var(--font-size-md)", fontWeight: 600,
    color: T.redText,
    cursor: disabled ? "not-allowed" : "pointer",
    opacity: disabled ? 0.5 : 1,
  };
}

function TrashIcon({ size, stroke, strokeWidth = 2 }: { size: number; stroke: string; strokeWidth?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={stroke} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 6h18" />
      <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
      <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
    </svg>
  );
}
