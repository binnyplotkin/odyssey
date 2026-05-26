"use client";

import { useEffect, useState } from "react";
import { updateUserProfile } from "@/app/(authenticated)/users/actions";

const T = {
  fg: "#FFFFFFE6",
  fgDim: "#FFFFFFD9",
  muted: "#FFFFFF80",
  faint: "#FFFFFF66",
  panel: "#161A24",
  panelInner: "#0C0E14",
  panelRaised: "#1E2230",
  border: "#FFFFFF14",
  borderSoft: "#FFFFFF0A",
  accent: "#8FD1CB",
  accentInk: "#04231E",
  green: "#6FCFA0",
  red: "#F37272",
  backdrop: "rgba(5,7,12,0.62)",
  fontHeading: "'Space Grotesk', sans-serif",
  fontBody: "'Inter', sans-serif",
  fontMono: "var(--font-mono, 'JetBrains Mono', monospace)",
};

export type EditProfileTarget = {
  id: string;
  name: string | null;
  email: string;
  role: "admin" | "user";
};

type Props = {
  open: boolean;
  target: EditProfileTarget | null;
  isSelf: boolean;
  onClose: () => void;
  onSaved: () => void;
};

export function EditProfileModal({ open, target, isSelf, onClose, onSaved }: Props) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<"admin" | "user">("user");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open && target) {
      setName(target.name ?? "");
      setEmail(target.email);
      setRole(target.role);
      setError(null);
      setPending(false);
    }
  }, [open, target]);

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape" && !pending) onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, pending, onClose]);

  if (!open || !target) return null;

  const emailChanged = email.trim().toLowerCase() !== target.email.toLowerCase();
  const dirty =
    (name.trim() || null) !== (target.name?.trim() || null) ||
    emailChanged ||
    role !== target.role;

  async function handleSave() {
    if (!target) return;
    setPending(true);
    setError(null);
    const res = await updateUserProfile({
      userId: target.id,
      name: name.trim(),
      email: email.trim(),
      role,
    });
    setPending(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    onSaved();
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
          width: 480, maxWidth: "100%",
          background: T.panel,
          border: `1px solid ${T.border}`,
          borderRadius: "var(--radius-3xl)",
          boxShadow: "var(--elevation-modal)",
          overflow: "hidden",
          animation: "userModalRise 180ms cubic-bezier(0.22, 1, 0.36, 1)",
        }}
      >
        {/* Header */}
        <div style={{
          display: "flex", alignItems: "flex-start", justifyContent: "space-between",
          padding: "22px 24px 18px 24px",
          borderBottom: `1px solid ${T.borderSoft}`,
        }}>
          <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-4)" }}>
            <div style={{
              fontFamily: T.fontHeading, fontSize: 17, fontWeight: 600,
              color: T.fg, lineHeight: "22px",
            }}>
              Edit profile
            </div>
            <div style={{
              fontFamily: T.fontMono, fontSize: "var(--font-size-xs)", color: T.faint,
              letterSpacing: "0.08em", textTransform: "uppercase",
            }}>
              {(target.name ?? target.email)} · {target.role}
            </div>
          </div>
          <CloseButton onClick={onClose} disabled={pending} />
        </div>

        {/* Name */}
        <FieldShell label="Full name" pad="22px 24px 0 24px">
          <Input value={name} onChange={setName} placeholder="No name set" autoFocus />
        </FieldShell>

        {/* Email */}
        <FieldShell
          label="Email address"
          pad="14px 24px 0 24px"
          rightLabel={
            emailChanged ? (
              <Pill tone="warn" text="Will reset verification" />
            ) : (
              <Pill tone="ok" text="Verified" />
            )
          }
        >
          <Input value={email} onChange={setEmail} placeholder="user@example.com" />
          <div style={{ fontFamily: T.fontBody, fontSize: "var(--font-size-base)", color: T.muted, lineHeight: "16px" }}>
            Changing the email signs the user out of all sessions and requires re-verification.
          </div>
        </FieldShell>

        {/* Role */}
        <FieldShell label="Role" pad="16px 24px 0 24px">
          <RoleToggle value={role} onChange={setRole} disableUser={isSelf && role === "admin"} />
          <div style={{ fontFamily: T.fontBody, fontSize: "var(--font-size-base)", color: T.muted, lineHeight: "16px" }}>
            {isSelf
              ? "You can't demote your own admin account."
              : "Admins can invite users, edit worlds, and access the engine."}
          </div>
        </FieldShell>

        {error && (
          <div style={{
            margin: "16px 24px 0 24px",
            padding: "10px 14px",
            borderRadius: "var(--radius-lg)",
            background: "rgba(243,114,114,0.08)",
            border: "1px solid rgba(243,114,114,0.20)",
            fontFamily: T.fontBody, fontSize: "var(--font-size-base)", color: "#F4A8A8",
          }}>
            {error}
          </div>
        )}

        {/* Footer */}
        <div style={{
          display: "flex", alignItems: "center", justifyContent: "space-between",
          padding: "22px 24px",
          marginTop: "var(--space-24)",
          borderTop: `1px solid ${T.borderSoft}`,
          background: "rgba(255,255,255,0.015)",
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: "var(--space-8)" }}>
            <InfoIcon />
            <div style={{ fontFamily: T.fontBody, fontSize: "var(--font-size-base)", color: T.muted }}>
              Changes take effect immediately.
            </div>
          </div>
          <div style={{ display: "flex", gap: "var(--space-8)" }}>
            <button
              type="button"
              onClick={onClose}
              disabled={pending}
              style={ghostButtonStyle(pending)}
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleSave}
              disabled={pending || !dirty}
              style={primaryButtonStyle(pending || !dirty)}
            >
              {pending ? "Saving…" : "Save changes"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ── Subcomponents ────────────────────────────────────────── */

function FieldShell({
  label,
  pad,
  rightLabel,
  children,
}: {
  label: string;
  pad: string;
  rightLabel?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-8)", padding: pad }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <span style={{
          fontFamily: T.fontMono, fontSize: "var(--font-size-xs)", color: T.muted,
          letterSpacing: "0.08em", textTransform: "uppercase",
        }}>
          {label}
        </span>
        {rightLabel}
      </div>
      {children}
    </div>
  );
}

function Input({
  value,
  onChange,
  placeholder,
  autoFocus,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  autoFocus?: boolean;
}) {
  return (
    <div style={{
      display: "flex", alignItems: "center", padding: "11px 14px",
      background: T.panelInner, border: `1px solid ${T.border}`, borderRadius: "var(--radius-lg)",
    }}>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        autoFocus={autoFocus}
        style={{
          flex: 1, border: "none", background: "transparent", outline: "none",
          fontFamily: T.fontBody, fontSize: "var(--font-size-lg)", color: T.fg,
        }}
      />
    </div>
  );
}

function RoleToggle({
  value,
  onChange,
  disableUser,
}: {
  value: "admin" | "user";
  onChange: (r: "admin" | "user") => void;
  disableUser?: boolean;
}) {
  return (
    <div style={{
      display: "flex", padding: "var(--space-4)",
      background: T.panelInner, border: `1px solid ${T.border}`, borderRadius: "var(--radius-lg)", gap: "var(--space-4)",
    }}>
      <RoleSegment label="User" active={value === "user"} disabled={disableUser} onClick={() => onChange("user")} />
      <RoleSegment label="Admin" active={value === "admin"} onClick={() => onChange("admin")} />
    </div>
  );
}

function RoleSegment({
  label,
  active,
  disabled,
  onClick,
}: {
  label: string;
  active: boolean;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      style={{
        flex: 1, padding: "8px 12px", borderRadius: "var(--radius-md)",
        background: active ? T.panelRaised : "transparent",
        border: active ? `1px solid ${T.border}` : "1px solid transparent",
        display: "flex", alignItems: "center", justifyContent: "center", gap: "var(--space-8)",
        fontFamily: T.fontBody, fontSize: "var(--font-size-md)",
        color: active ? T.fg : "#FFFFFF99",
        fontWeight: active ? 600 : 500,
        cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.5 : 1,
      }}
    >
      <span style={{
        width: 6, height: 6, borderRadius: "var(--radius-xs)",
        background: active ? T.accent : "#FFFFFF40",
      }} />
      {label}
    </button>
  );
}

function Pill({ tone, text }: { tone: "ok" | "warn"; text: string }) {
  const color = tone === "ok" ? T.green : "#F5C26B";
  return (
    <span style={{ display: "flex", alignItems: "center", gap: "var(--space-5)" }}>
      <span style={{ width: 6, height: 6, borderRadius: "var(--radius-xs)", background: color }} />
      <span style={{
        fontFamily: T.fontMono, fontSize: "var(--font-size-xs)", color,
        letterSpacing: "0.08em", textTransform: "uppercase",
      }}>
        {text}
      </span>
    </span>
  );
}

function CloseButton({ onClick, disabled }: { onClick: () => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      aria-label="Close"
      onClick={onClick}
      disabled={disabled}
      style={{
        width: 28, height: 28,
        display: "flex", alignItems: "center", justifyContent: "center",
        borderRadius: "var(--radius-md)", border: "none",
        background: "rgba(255,255,255,0.03)",
        color: "#FFFFFF99", cursor: disabled ? "not-allowed" : "pointer",
      }}
    >
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
      </svg>
    </button>
  );
}

function InfoIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={T.faint} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" />
      <line x1="12" y1="8" x2="12" y2="12" />
      <line x1="12" y1="16" x2="12.01" y2="16" />
    </svg>
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

function primaryButtonStyle(disabled: boolean): React.CSSProperties {
  return {
    padding: "9px 18px", borderRadius: "var(--radius-md)",
    border: "none", background: T.accent,
    fontFamily: T.fontBody, fontSize: "var(--font-size-md)", fontWeight: 600,
    color: T.accentInk,
    cursor: disabled ? "not-allowed" : "pointer",
    opacity: disabled ? 0.5 : 1,
  };
}
