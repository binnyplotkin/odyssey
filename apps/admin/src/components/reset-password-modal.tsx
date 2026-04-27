"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { setUserPassword } from "@/app/(authenticated)/users/actions";

const T = {
  fg: "#FFFFFFE6",
  fgDim: "#FFFFFFD9",
  fgSoft: "#FFFFFFCC",
  muted: "#FFFFFF80",
  faint: "#FFFFFF66",
  meta: "#FFFFFF99",
  panel: "#161A24",
  panelInner: "#0C0E14",
  panelRaised: "rgba(255,255,255,0.05)",
  border: "#FFFFFF14",
  borderSoft: "#FFFFFF0F",
  borderFaint: "#FFFFFF0A",
  accent: "#8CE7D2",
  accentInk: "#04231E",
  green: "#6FCFA0",
  amber: "#F5C26B",
  red: "#F37272",
  backdrop: "rgba(5,7,12,0.62)",
  fontHeading: "'Space Grotesk', sans-serif",
  fontBody: "'Inter', sans-serif",
  fontMono: "var(--font-mono, 'JetBrains Mono', monospace)",
};

const MIN_LENGTH = 10;

export type ResetPasswordTarget = {
  id: string;
  name: string | null;
  email: string;
  authMethods: ("password" | "google")[];
};

type Props = {
  open: boolean;
  target: ResetPasswordTarget | null;
  onClose: () => void;
  onSaved: () => void;
};

export function ResetPasswordModal({ open, target, onClose, onSaved }: Props) {
  const [pwd, setPwd] = useState("");
  const [confirmPwd, setConfirmPwd] = useState("");
  const [showPwd, setShowPwd] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [signOutAll, setSignOutAll] = useState(true);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const newInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (open) {
      setPwd("");
      setConfirmPwd("");
      setShowPwd(false);
      setShowConfirm(false);
      setSignOutAll(true);
      setError(null);
      setPending(false);
      // Focus on next tick so the modal is mounted.
      setTimeout(() => newInputRef.current?.focus(), 50);
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

  const strength = useMemo(() => scorePassword(pwd), [pwd]);
  const matches = pwd.length > 0 && pwd === confirmPwd;
  const tooShort = pwd.length > 0 && pwd.length < MIN_LENGTH;
  const canSubmit =
    pwd.length >= MIN_LENGTH && matches && !pending;

  if (!open || !target) return null;

  async function handleGenerate() {
    const generated = generatePassword(20);
    setPwd(generated);
    setConfirmPwd(generated);
    setShowPwd(true);
    setShowConfirm(true);
  }

  async function handleSubmit() {
    if (!target) return;
    setPending(true);
    setError(null);
    const res = await setUserPassword({
      userId: target.id,
      newPassword: pwd,
      signOutEverywhere: signOutAll,
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
        padding: 16,
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
          width: 440, maxWidth: "100%",
          background: T.panel, border: `1px solid ${T.border}`,
          borderRadius: 16, overflow: "hidden",
          boxShadow: "0 32px 64px -16px rgba(0,0,0,0.7)",
          animation: "userModalRise 180ms cubic-bezier(0.22, 1, 0.36, 1)",
        }}
      >
        {/* Header */}
        <div style={{
          display: "flex", alignItems: "flex-start", justifyContent: "space-between",
          padding: "22px 24px 18px 24px",
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <span style={{
              width: 36, height: 36, flexShrink: 0, borderRadius: 10,
              background: "rgba(255,255,255,0.04)", border: `1px solid ${T.border}`,
              display: "flex", alignItems: "center", justifyContent: "center",
              color: T.accent,
            }}>
              <KeyIcon />
            </span>
            <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
              <div style={{ fontFamily: T.fontHeading, fontSize: 17, fontWeight: 600, color: T.fg, lineHeight: "22px" }}>
                Reset password
              </div>
              <div style={{ fontFamily: T.fontMono, fontSize: 10, color: T.faint, letterSpacing: "0.08em", textTransform: "uppercase" }}>
                Admin override · Takes effect immediately
              </div>
            </div>
          </div>
          <CloseButton onClick={onClose} disabled={pending} />
        </div>

        {/* User card */}
        <div style={{
          display: "flex", alignItems: "center", gap: 12,
          margin: "0 24px",
          padding: "12px 14px",
          background: T.panelInner, border: `1px solid ${T.borderFaint}`, borderRadius: 10,
        }}>
          <Avatar email={target.email} name={target.name} />
          <div style={{ display: "flex", flexDirection: "column", gap: 2, flex: 1, minWidth: 0 }}>
            <div style={{ fontFamily: T.fontBody, fontSize: 13, fontWeight: 600, color: T.fg }}>
              {target.name ?? target.email}
            </div>
            <div style={{
              fontFamily: T.fontMono, fontSize: 11, color: T.meta,
              overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
            }}>
              {target.email}
            </div>
          </div>
          <span style={{
            display: "flex", alignItems: "center", gap: 5,
            padding: "4px 8px", background: "rgba(255,255,255,0.04)", borderRadius: 6,
            fontFamily: T.fontMono, fontSize: 10, color: T.meta, letterSpacing: "0.06em",
          }}>
            <LockIcon />
            {target.authMethods.includes("password") ? "PASSWORD" : "NEW PASSWORD"}
          </span>
        </div>

        {/* New password */}
        <div style={{ display: "flex", flexDirection: "column", gap: 8, padding: "18px 24px 0 24px" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <span style={{ fontFamily: T.fontMono, fontSize: 10, color: T.muted, letterSpacing: "0.08em", textTransform: "uppercase" }}>
              New password
            </span>
            <button type="button" onClick={handleGenerate} style={generateButtonStyle()}>
              <RefreshIcon />
              Generate strong password
            </button>
          </div>
          <PasswordInput
            value={pwd}
            onChange={setPwd}
            visible={showPwd}
            onToggleVisible={() => setShowPwd((s) => !s)}
            inputRef={newInputRef}
            placeholder={`At least ${MIN_LENGTH} characters`}
          />
          <StrengthMeter score={strength.score} label={strength.label} hint={strength.hint} tooShort={tooShort} />
        </div>

        {/* Confirm */}
        <div style={{ display: "flex", flexDirection: "column", gap: 8, padding: "14px 24px 0 24px" }}>
          <span style={{ fontFamily: T.fontMono, fontSize: 10, color: T.muted, letterSpacing: "0.08em", textTransform: "uppercase" }}>
            Confirm password
          </span>
          <PasswordInput
            value={confirmPwd}
            onChange={setConfirmPwd}
            visible={showConfirm}
            onToggleVisible={() => setShowConfirm((s) => !s)}
            placeholder="Re-enter new password"
          />
          <MatchHint pwd={pwd} confirm={confirmPwd} />
        </div>

        {/* Sign out toggle */}
        <div style={{
          display: "flex", alignItems: "center", justifyContent: "space-between",
          padding: "14px 24px",
        }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
            <div style={{ fontFamily: T.fontBody, fontSize: 13, fontWeight: 500, color: T.fg }}>
              Sign user out everywhere
            </div>
            <div style={{ fontFamily: T.fontBody, fontSize: 12, color: T.muted, lineHeight: "16px" }}>
              Forces re-login on all active sessions.
            </div>
          </div>
          <Toggle on={signOutAll} onChange={setSignOutAll} />
        </div>

        {error && (
          <div style={{
            margin: "0 24px 12px 24px",
            padding: "10px 14px",
            borderRadius: 10,
            background: "rgba(243,114,114,0.08)",
            border: "1px solid rgba(243,114,114,0.20)",
            fontFamily: T.fontBody, fontSize: 12, color: "#F4A8A8",
          }}>
            {error}
          </div>
        )}

        {/* Footer */}
        <div style={{
          display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 8,
          padding: "18px 24px",
          borderTop: `1px solid ${T.borderFaint}`,
          background: "rgba(255,255,255,0.015)",
        }}>
          <button type="button" onClick={onClose} disabled={pending} style={ghostButtonStyle(pending)}>
            Cancel
          </button>
          <button type="button" onClick={handleSubmit} disabled={!canSubmit} style={primaryButtonStyle(!canSubmit)}>
            <SendIcon />
            {pending ? "Setting…" : "Set new password"}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ── Subcomponents ────────────────────────────────────────── */

function PasswordInput({
  value,
  onChange,
  visible,
  onToggleVisible,
  placeholder,
  inputRef,
}: {
  value: string;
  onChange: (v: string) => void;
  visible: boolean;
  onToggleVisible: () => void;
  placeholder?: string;
  inputRef?: React.RefObject<HTMLInputElement | null>;
}) {
  return (
    <div style={{
      display: "flex", alignItems: "center", padding: "11px 14px", gap: 10,
      background: T.panelInner, border: `1px solid ${T.border}`, borderRadius: 10,
    }}>
      <input
        ref={inputRef}
        type={visible ? "text" : "password"}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        style={{
          flex: 1, border: "none", background: "transparent", outline: "none",
          fontFamily: T.fontMono, fontSize: 14, color: T.fg, letterSpacing: visible ? "0.05em" : "0.2em",
        }}
      />
      <IconButton onClick={onToggleVisible} aria-label={visible ? "Hide password" : "Show password"}>
        {visible ? <EyeOffIcon /> : <EyeIcon />}
      </IconButton>
      <IconButton
        onClick={() => navigator.clipboard?.writeText(value)}
        aria-label="Copy password"
        disabled={!value}
      >
        <CopyIcon />
      </IconButton>
    </div>
  );
}

function StrengthMeter({
  score,
  label,
  hint,
  tooShort,
}: {
  score: number;
  label: string;
  hint: string;
  tooShort: boolean;
}) {
  const color = scoreColor(score, tooShort);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6, paddingTop: 2 }}>
      <div style={{ display: "flex", gap: 4 }}>
        {[0, 1, 2, 3].map((i) => (
          <div
            key={i}
            style={{
              flex: 1, height: 3, borderRadius: 2,
              background: i < score ? color : "rgba(255,255,255,0.08)",
            }}
          />
        ))}
      </div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <span style={{
          fontFamily: T.fontBody, fontSize: 11, fontWeight: 500,
          color: tooShort ? T.amber : score > 0 ? color : T.muted,
        }}>
          {tooShort ? `Too short (need ${MIN_LENGTH}+)` : score > 0 ? label : "Enter a password"}
        </span>
        <span style={{
          fontFamily: T.fontMono, fontSize: 10, color: T.faint,
          letterSpacing: "0.06em", textTransform: "uppercase",
        }}>
          {hint}
        </span>
      </div>
    </div>
  );
}

function MatchHint({ pwd, confirm }: { pwd: string; confirm: string }) {
  if (!confirm) {
    return (
      <div style={{ fontFamily: T.fontBody, fontSize: 11, color: T.faint }}>
        Re-enter the password to confirm.
      </div>
    );
  }
  const match = pwd === confirm;
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
      {match ? (
        <>
          <CheckIcon stroke={T.green} />
          <span style={{ fontFamily: T.fontBody, fontSize: 11, color: T.green, fontWeight: 500 }}>
            Passwords match
          </span>
        </>
      ) : (
        <>
          <XSmallIcon stroke={T.red} />
          <span style={{ fontFamily: T.fontBody, fontSize: 11, color: T.red, fontWeight: 500 }}>
            Passwords don't match
          </span>
        </>
      )}
    </div>
  );
}

function Toggle({ on, onChange }: { on: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      onClick={() => onChange(!on)}
      aria-pressed={on}
      style={{
        width: 32, height: 18, padding: 2, border: "none",
        background: on ? T.accent : "rgba(255,255,255,0.12)",
        borderRadius: 9,
        display: "flex",
        justifyContent: on ? "flex-end" : "flex-start",
        cursor: "pointer",
        transition: "background 120ms",
      }}
    >
      <span style={{
        width: 14, height: 14, borderRadius: 7,
        background: on ? T.accentInk : "#FFFFFF",
        transition: "transform 120ms",
      }} />
    </button>
  );
}

function Avatar({ email, name }: { email: string; name: string | null }) {
  const ch = (name?.trim() || email).charAt(0).toUpperCase();
  return (
    <div style={{
      width: 36, height: 36, flexShrink: 0, borderRadius: 18,
      background: "linear-gradient(135deg, #8CE7D2 0%, #4FB8A8 100%)",
      display: "flex", alignItems: "center", justifyContent: "center",
      fontFamily: T.fontHeading, fontSize: 15, fontWeight: 600, color: T.accentInk,
    }}>
      {ch}
    </div>
  );
}

function IconButton({
  onClick,
  children,
  disabled,
  ...rest
}: {
  onClick: () => void;
  children: React.ReactNode;
  disabled?: boolean;
  "aria-label"?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={rest["aria-label"]}
      style={{
        width: 22, height: 22, flexShrink: 0,
        display: "flex", alignItems: "center", justifyContent: "center",
        border: "none", background: "transparent",
        color: T.muted, cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.4 : 1,
      }}
    >
      {children}
    </button>
  );
}

function CloseButton({ onClick, disabled }: { onClick: () => void; disabled?: boolean }) {
  return (
    <button
      type="button" aria-label="Close" onClick={onClick} disabled={disabled}
      style={{
        width: 28, height: 28,
        display: "flex", alignItems: "center", justifyContent: "center",
        borderRadius: 8, border: "none",
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

function generateButtonStyle(): React.CSSProperties {
  return {
    display: "flex", alignItems: "center", gap: 6,
    border: "none", background: "transparent",
    fontFamily: T.fontBody, fontSize: 11, fontWeight: 500,
    color: T.accent, cursor: "pointer",
  };
}

function ghostButtonStyle(disabled: boolean): React.CSSProperties {
  return {
    padding: "9px 16px", borderRadius: 9,
    border: `1px solid ${T.border}`, background: "transparent",
    fontFamily: T.fontBody, fontSize: 13, fontWeight: 500,
    color: T.fgDim,
    cursor: disabled ? "not-allowed" : "pointer",
    opacity: disabled ? 0.6 : 1,
  };
}

function primaryButtonStyle(disabled: boolean): React.CSSProperties {
  return {
    display: "flex", alignItems: "center", gap: 8,
    padding: "9px 18px", borderRadius: 9,
    border: "none", background: T.accent,
    fontFamily: T.fontBody, fontSize: 13, fontWeight: 600,
    color: T.accentInk,
    cursor: disabled ? "not-allowed" : "pointer",
    opacity: disabled ? 0.5 : 1,
  };
}

/* ── Strength scoring ─────────────────────────────────────── */

function scorePassword(pwd: string): { score: 0 | 1 | 2 | 3 | 4; label: string; hint: string } {
  if (!pwd) return { score: 0, label: "", hint: "" };
  let score = 0;
  if (pwd.length >= 10) score++;
  if (pwd.length >= 14) score++;
  const classes =
    Number(/[a-z]/.test(pwd)) +
    Number(/[A-Z]/.test(pwd)) +
    Number(/[0-9]/.test(pwd)) +
    Number(/[^A-Za-z0-9]/.test(pwd));
  if (classes >= 3) score++;
  if (classes === 4 && pwd.length >= 12) score++;
  const clamped = Math.min(4, score) as 0 | 1 | 2 | 3 | 4;

  const label = clamped <= 1 ? "Weak" : clamped === 2 ? "Fair" : clamped === 3 ? "Good" : "Strong";
  const parts: string[] = [];
  parts.push(`${pwd.length} chars`);
  if (classes >= 3) parts.push("mixed");
  if (/[^A-Za-z0-9]/.test(pwd)) parts.push("symbol");
  return { score: clamped, label, hint: parts.join(" · ") };
}

function scoreColor(score: number, tooShort: boolean): string {
  if (tooShort) return T.amber;
  if (score >= 4) return T.green;
  if (score >= 3) return T.green;
  if (score >= 2) return T.amber;
  return T.red;
}

function generatePassword(length: number): string {
  const lower = "abcdefghijkmnpqrstuvwxyz";
  const upper = "ABCDEFGHJKLMNPQRSTUVWXYZ";
  const digits = "23456789";
  const symbols = "!@#$%^&*-_=+";
  const all = lower + upper + digits + symbols;
  const buf = new Uint32Array(length);
  crypto.getRandomValues(buf);
  // Guarantee one of each class.
  const seed = [
    lower[buf[0] % lower.length],
    upper[buf[1] % upper.length],
    digits[buf[2] % digits.length],
    symbols[buf[3] % symbols.length],
  ];
  const rest: string[] = [];
  for (let i = 4; i < length; i++) rest.push(all[buf[i] % all.length]);
  const out = [...seed, ...rest];
  // Fisher-Yates shuffle with a fresh pass of randomness.
  const shuf = new Uint32Array(out.length);
  crypto.getRandomValues(shuf);
  for (let i = out.length - 1; i > 0; i--) {
    const j = shuf[i] % (i + 1);
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out.join("");
}

/* ── Icons ─────────────────────────────────────────────────── */

function KeyIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="m21 2-9.6 9.6" /><circle cx="7.5" cy="15.5" r="5.5" /><path d="m17 6 2 2" />
    </svg>
  );
}

function LockIcon() {
  return (
    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="11" width="18" height="11" rx="2" ry="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" />
    </svg>
  );
}

function EyeIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" /><circle cx="12" cy="12" r="3" />
    </svg>
  );
}

function EyeOffIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" />
      <line x1="1" y1="1" x2="23" y2="23" />
    </svg>
  );
}

function CopyIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
    </svg>
  );
}

function RefreshIcon() {
  return (
    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 2v6h-6" /><path d="M3 12a9 9 0 0 1 15-6.7L21 8" />
      <path d="M3 22v-6h6" /><path d="M21 12a9 9 0 0 1-15 6.7L3 16" />
    </svg>
  );
}

function CheckIcon({ stroke }: { stroke: string }) {
  return (
    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke={stroke} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="20 6 9 17 4 12" />
    </svg>
  );
}

function XSmallIcon({ stroke }: { stroke: string }) {
  return (
    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke={stroke} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  );
}

function SendIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M22 2 11 13" /><path d="M22 2l-7 20-4-9-9-4 20-7Z" />
    </svg>
  );
}
