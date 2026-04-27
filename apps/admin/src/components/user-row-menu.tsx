"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";

const T = {
  panel: "#1A1F2C",
  panelHover: "#FFFFFF0A",
  border: "#FFFFFF14",
  divider: "#FFFFFF0F",
  text: "#FFFFFFD9",
  textMuted: "#FFFFFFB3",
  meta: "#FFFFFF73",
  amber: "#F5C26B",
  red: "#F37272",
  fontBody: "'Inter', sans-serif",
  fontMono: "var(--font-mono, 'JetBrains Mono', monospace)",
};

export type UserRowMenuAction =
  | "edit"
  | "toggleRole"
  | "resetPassword"
  | "signOutAll"
  | "delete";

type Props = {
  anchor: { top: number; left: number };
  role: "admin" | "user";
  isCurrent: boolean;
  onSelect: (action: UserRowMenuAction) => void;
  onClose: () => void;
};

export function UserRowMenu({ anchor, role, isCurrent, onSelect, onClose }: Props) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  useLayoutEffect(() => {
    if (!ref.current) return;
    const rect = ref.current.getBoundingClientRect();
    const margin = 8;
    let top = anchor.top;
    let left = anchor.left - rect.width;
    if (top + rect.height > window.innerHeight - margin) {
      top = Math.max(margin, anchor.top - rect.height - 28);
    }
    if (left < margin) left = margin;
    setPos({ top, left });
  }, [anchor]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    function onClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    }
    window.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onClick);
    return () => {
      window.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onClick);
    };
  }, [onClose]);

  return (
    <div
      ref={ref}
      role="menu"
      style={{
        position: "fixed",
        top: pos?.top ?? anchor.top,
        left: pos?.left ?? anchor.left,
        width: 240,
        zIndex: 900,
        opacity: pos ? 1 : 0,
        display: "flex",
        flexDirection: "column",
        padding: 6,
        background: T.panel,
        borderRadius: 12,
        border: `1px solid ${T.border}`,
        boxShadow: "0 24px 48px -12px rgba(0,0,0,0.6), 0 4px 12px rgba(0,0,0,0.4)",
      }}
    >
      <MenuItem icon={<EditIcon />} label="Edit profile" onClick={() => onSelect("edit")} />
      <MenuItem
        icon={<UserSwapIcon />}
        label="Change role"
        meta={role.toUpperCase()}
        onClick={() => onSelect("toggleRole")}
        disabled={isCurrent && role === "admin"}
        disabledHint={isCurrent && role === "admin" ? "self" : undefined}
      />
      <MenuItem icon={<KeyIcon />} label="Reset password" onClick={() => onSelect("resetPassword")} />
      <MenuItem icon={<LogoutIcon />} label="Sign out all sessions" onClick={() => onSelect("signOutAll")} />
      <div style={{ height: 1, background: T.divider, margin: "4px 0" }} />
      <MenuItem
        icon={<TrashIcon stroke={T.red} />}
        label="Delete user…"
        tone="danger"
        onClick={() => onSelect("delete")}
        disabled={isCurrent}
        disabledHint={isCurrent ? "self" : undefined}
      />
    </div>
  );
}

function MenuItem({
  icon,
  label,
  meta,
  onClick,
  tone = "default",
  disabled,
  disabledHint,
}: {
  icon: React.ReactNode;
  label: string;
  meta?: string;
  onClick: () => void;
  tone?: "default" | "danger";
  disabled?: boolean;
  disabledHint?: "self";
}) {
  const [hover, setHover] = useState(false);
  const color = tone === "danger" ? T.red : T.text;
  const dim = disabled ? 0.4 : 1;
  return (
    <button
      type="button"
      role="menuitem"
      onClick={() => { if (!disabled) onClick(); }}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      disabled={disabled}
      title={disabledHint === "self" ? "Not available on your own account" : undefined}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        padding: "8px 10px",
        borderRadius: 8,
        border: "none",
        background: hover && !disabled ? T.panelHover : "transparent",
        color,
        cursor: disabled ? "not-allowed" : "pointer",
        fontFamily: T.fontBody,
        fontSize: 13,
        fontWeight: 500,
        textAlign: "left",
        opacity: dim,
      }}
    >
      <span style={{ width: 16, height: 16, flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center", color: tone === "danger" ? T.red : T.textMuted }}>
        {icon}
      </span>
      <span style={{ flex: 1 }}>{label}</span>
      {meta && (
        <span style={{
          fontFamily: T.fontMono,
          fontSize: 10,
          color: T.meta,
          letterSpacing: "0.04em",
        }}>
          {meta}
        </span>
      )}
    </button>
  );
}

/* ── Icons ─────────────────────────────────────────────────── */

function EditIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4Z" />
    </svg>
  );
}

function UserSwapIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="m17 11 2 2 4-4" />
    </svg>
  );
}

function KeyIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="m21 2-9.6 9.6" />
      <circle cx="7.5" cy="15.5" r="5.5" />
      <path d="m17 6 2 2" />
    </svg>
  );
}

function LogoutIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
      <polyline points="16 17 21 12 16 7" />
      <line x1="21" y1="12" x2="9" y2="12" />
    </svg>
  );
}

function TrashIcon({ stroke }: { stroke?: string }) {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={stroke ?? "currentColor"} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="3 6 5 6 21 6" />
      <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
    </svg>
  );
}
