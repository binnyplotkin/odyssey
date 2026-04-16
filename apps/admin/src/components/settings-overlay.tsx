"use client";

import { useEffect, useState, useCallback } from "react";
import { useSession } from "next-auth/react";
import { X } from "react-feather";

type Tab = "profile" | "appearance" | "team";

const TABS: { id: Tab; label: string }[] = [
  { id: "profile", label: "Profile" },
  { id: "appearance", label: "Appearance" },
  { id: "team", label: "Team" },
];

type TeamMember = { id: string; name: string; email: string; role: string };

export function SettingsOverlay({
  open,
  onClose,
  theme,
  onThemeChange,
}: {
  open: boolean;
  onClose: () => void;
  theme: "dark" | "light" | "system";
  onThemeChange: (t: "dark" | "light" | "system") => void;
}) {
  const { data: session } = useSession();
  const [activeTab, setActiveTab] = useState<Tab>("profile");
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [team, setTeam] = useState<TeamMember[]>([]);

  useEffect(() => {
    if (open && activeTab === "team" && team.length === 0) {
      fetch("/api/team")
        .then((r) => r.json())
        .then((data) => setTeam(data.team ?? []))
        .catch(() => {});
    }
  }, [open, activeTab, team.length]);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    },
    [onClose]
  );

  useEffect(() => {
    if (!open) return;
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [open, handleKeyDown]);

  if (!open) return null;

  const user = session?.user;

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 1000,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "rgba(0, 0, 0, 0.6)",
        backdropFilter: "blur(4px)",
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        style={{
          width: 640,
          maxHeight: "80vh",
          background: "var(--background)",
          border: "1px solid var(--border)",
          borderRadius: 16,
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
          boxShadow: "0 24px 80px rgba(0, 0, 0, 0.5)",
        }}
      >
        {/* Header */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "20px 24px",
            borderBottom: "1px solid var(--border)",
            flexShrink: 0,
          }}
        >
          <span style={{ fontWeight: 600, fontSize: "1rem", color: "var(--foreground)" }}>Settings</span>
          <button
            type="button"
            onClick={onClose}
            onMouseEnter={() => setHoveredId("close")}
            onMouseLeave={() => setHoveredId(null)}
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              width: 28,
              height: 28,
              borderRadius: 6,
              border: "none",
              background: hoveredId === "close" ? "var(--panel)" : "transparent",
              color: "var(--muted)",
              cursor: "pointer",
              transition: "background 150ms, color 150ms",
            }}
          >
            <X size={16} />
          </button>
        </div>

        {/* Tabs */}
        <div
          style={{
            display: "flex",
            gap: 0,
            padding: "0 24px",
            borderBottom: "1px solid var(--border)",
            flexShrink: 0,
          }}
        >
          {TABS.map((tab) => {
            const active = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveTab(tab.id)}
                onMouseEnter={() => setHoveredId(`tab-${tab.id}`)}
                onMouseLeave={() => setHoveredId(null)}
                style={{
                  padding: "12px 16px",
                  fontSize: "0.8125rem",
                  fontWeight: active ? 600 : 400,
                  color: active ? "var(--accent-strong)" : "var(--muted)",
                  background: "none",
                  border: "none",
                  borderBottom: active ? "2px solid var(--accent-strong)" : "2px solid transparent",
                  cursor: "pointer",
                  transition: "color 150ms, border-color 150ms",
                  fontFamily: "inherit",
                }}
              >
                {tab.label}
              </button>
            );
          })}
        </div>

        {/* Content */}
        <div style={{ flex: 1, overflow: "auto", padding: 24 }}>
          {activeTab === "profile" && (
            <ProfileTab user={user} hoveredId={hoveredId} setHoveredId={setHoveredId} />
          )}
          {activeTab === "appearance" && (
            <AppearanceTab theme={theme} onThemeChange={onThemeChange} hoveredId={hoveredId} setHoveredId={setHoveredId} />
          )}
          {activeTab === "team" && (
            <TeamTab team={team} hoveredId={hoveredId} setHoveredId={setHoveredId} />
          )}
        </div>
      </div>
    </div>
  );
}

/* ── Profile Tab ──────────────────────────────────────────────── */

function ProfileTab({
  user,
  hoveredId,
  setHoveredId,
}: {
  user: { name?: string | null; email?: string | null; role?: string } | undefined;
  hoveredId: string | null;
  setHoveredId: (id: string | null) => void;
}) {
  const initials = user?.name
    ? user.name
        .split(" ")
        .map((w) => w[0])
        .join("")
        .toUpperCase()
        .slice(0, 2)
    : "?";

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 32 }}>
      {/* Avatar + name */}
      <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
        <div
          style={{
            width: 56,
            height: 56,
            borderRadius: 12,
            background: "var(--accent-soft)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            flexShrink: 0,
          }}
        >
          <span style={{ fontWeight: 700, fontSize: "1.25rem", color: "var(--accent-strong)" }}>{initials}</span>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
          <span style={{ fontWeight: 600, fontSize: "1rem", color: "var(--foreground)" }}>{user?.name ?? "—"}</span>
          <span style={{ fontSize: "0.8125rem", color: "var(--muted)" }}>{user?.email ?? "—"}</span>
        </div>
      </div>

      {/* Fields */}
      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        <FieldRow label="Name" value={user?.name ?? "—"} />
        <FieldRow label="Email" value={user?.email ?? "—"} />
        <FieldRow label="Role" value={user?.role ?? "—"} />
      </div>

      {/* Password */}
      <PasswordSection hoveredId={hoveredId} setHoveredId={setHoveredId} />
    </div>
  );
}

/* ── Password Section ─────────────────────────────────────────── */

function PasswordSection({
  hoveredId,
  setHoveredId,
}: {
  hoveredId: string | null;
  setHoveredId: (id: string | null) => void;
}) {
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [status, setStatus] = useState<"idle" | "loading" | "success" | "error">("idle");
  const [errorMsg, setErrorMsg] = useState("");

  const canSubmit =
    currentPassword.length > 0 &&
    newPassword.length >= 8 &&
    newPassword === confirmPassword &&
    status !== "loading";

  const handleSubmit = async () => {
    if (!canSubmit) return;
    setStatus("loading");
    setErrorMsg("");

    try {
      const res = await fetch("/api/account/password", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ currentPassword, newPassword }),
      });

      if (!res.ok) {
        const data = await res.json();
        setErrorMsg(data.error ?? "Failed to update password");
        setStatus("error");
        return;
      }

      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      setStatus("success");
      setTimeout(() => setStatus("idle"), 3000);
    } catch {
      setErrorMsg("Network error");
      setStatus("error");
    }
  };

  const inputStyle: React.CSSProperties = {
    width: "100%",
    padding: "10px 12px",
    background: "var(--panel)",
    borderRadius: 8,
    border: "1px solid var(--border)",
    fontSize: "0.875rem",
    color: "var(--foreground)",
    fontFamily: "inherit",
    outline: "none",
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div style={{ height: 1, background: "var(--border)" }} />
      <span
        style={{
          fontSize: "0.6875rem",
          fontWeight: 600,
          textTransform: "uppercase",
          letterSpacing: "0.06em",
          color: "var(--muted)",
        }}
      >
        Change password
      </span>

      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <label style={{ fontSize: "0.75rem", color: "var(--muted)" }}>Current password</label>
          <input
            type="password"
            value={currentPassword}
            onChange={(e) => { setCurrentPassword(e.target.value); setStatus("idle"); }}
            style={inputStyle}
          />
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <label style={{ fontSize: "0.75rem", color: "var(--muted)" }}>New password</label>
          <input
            type="password"
            value={newPassword}
            onChange={(e) => { setNewPassword(e.target.value); setStatus("idle"); }}
            placeholder="Min 8 characters"
            style={inputStyle}
          />
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <label style={{ fontSize: "0.75rem", color: "var(--muted)" }}>Confirm new password</label>
          <input
            type="password"
            value={confirmPassword}
            onChange={(e) => { setConfirmPassword(e.target.value); setStatus("idle"); }}
            style={inputStyle}
          />
          {confirmPassword.length > 0 && newPassword !== confirmPassword && (
            <span style={{ fontSize: "0.75rem", color: "var(--danger)" }}>Passwords don't match</span>
          )}
        </div>
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <button
          type="button"
          disabled={!canSubmit}
          onClick={handleSubmit}
          onMouseEnter={() => setHoveredId("pw-save")}
          onMouseLeave={() => setHoveredId(null)}
          style={{
            padding: "8px 20px",
            borderRadius: 8,
            border: "none",
            background: canSubmit
              ? hoveredId === "pw-save"
                ? "var(--accent-strong)"
                : "var(--accent)"
              : "var(--panel)",
            color: canSubmit ? "var(--background)" : "var(--muted)",
            fontSize: "0.8125rem",
            fontWeight: 600,
            cursor: canSubmit ? "pointer" : "default",
            fontFamily: "inherit",
            transition: "background 150ms, color 150ms",
            opacity: status === "loading" ? 0.6 : 1,
          }}
        >
          {status === "loading" ? "Updating..." : "Update password"}
        </button>
        {status === "success" && (
          <span style={{ fontSize: "0.8125rem", color: "var(--success)" }}>Password updated</span>
        )}
        {status === "error" && (
          <span style={{ fontSize: "0.8125rem", color: "var(--danger)" }}>{errorMsg}</span>
        )}
      </div>
    </div>
  );
}

function FieldRow({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      <span
        style={{
          fontSize: "0.6875rem",
          fontWeight: 600,
          textTransform: "uppercase",
          letterSpacing: "0.06em",
          color: "var(--muted)",
        }}
      >
        {label}
      </span>
      <div
        style={{
          padding: "10px 12px",
          background: "var(--panel)",
          borderRadius: 8,
          border: "1px solid var(--border)",
          fontSize: "0.875rem",
          color: "var(--foreground)",
        }}
      >
        {value}
      </div>
    </div>
  );
}

/* ── Appearance Tab ───────────────────────────────────────────── */

function AppearanceTab({
  theme,
  onThemeChange,
  hoveredId,
  setHoveredId,
}: {
  theme: "dark" | "light" | "system";
  onThemeChange: (t: "dark" | "light" | "system") => void;
  hoveredId: string | null;
  setHoveredId: (id: string | null) => void;
}) {
  const options: { id: "dark" | "light" | "system"; label: string; desc: string }[] = [
    { id: "dark", label: "Dark", desc: "Forest dark theme" },
    { id: "light", label: "Light", desc: "Light theme" },
    { id: "system", label: "System", desc: "Follow OS preference" },
  ];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <span
        style={{
          fontSize: "0.6875rem",
          fontWeight: 600,
          textTransform: "uppercase",
          letterSpacing: "0.06em",
          color: "var(--muted)",
        }}
      >
        Theme
      </span>
      <div style={{ display: "flex", gap: 12 }}>
        {options.map((opt) => {
          const active = theme === opt.id;
          const hovered = hoveredId === `theme-${opt.id}`;
          return (
            <button
              key={opt.id}
              type="button"
              onClick={() => onThemeChange(opt.id)}
              onMouseEnter={() => setHoveredId(`theme-${opt.id}`)}
              onMouseLeave={() => setHoveredId(null)}
              style={{
                flex: 1,
                padding: "16px",
                borderRadius: 10,
                border: active
                  ? "2px solid var(--accent-strong)"
                  : `1px solid ${hovered ? "var(--accent)" : "var(--border)"}`,
                background: active ? "var(--accent-soft)" : hovered ? "var(--panel)" : "transparent",
                cursor: "pointer",
                display: "flex",
                flexDirection: "column",
                gap: 4,
                alignItems: "flex-start",
                fontFamily: "inherit",
                transition: "border-color 150ms, background 150ms",
              }}
            >
              <span
                style={{
                  fontWeight: 600,
                  fontSize: "0.8125rem",
                  color: active ? "var(--accent-strong)" : "var(--foreground)",
                }}
              >
                {opt.label}
              </span>
              <span style={{ fontSize: "0.75rem", color: "var(--muted)" }}>{opt.desc}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

/* ── Team Tab ─────────────────────────────────────────────────── */

function TeamTab({
  team,
  hoveredId,
  setHoveredId,
}: {
  team: TeamMember[];
  hoveredId: string | null;
  setHoveredId: (id: string | null) => void;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <span
        style={{
          fontSize: "0.6875rem",
          fontWeight: 600,
          textTransform: "uppercase",
          letterSpacing: "0.06em",
          color: "var(--muted)",
        }}
      >
        Team members
      </span>
      {team.length === 0 ? (
        <span style={{ fontSize: "0.8125rem", color: "var(--muted)" }}>Loading...</span>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
          {team.map((m) => {
            const initials = m.name
              .split(" ")
              .map((w) => w[0])
              .join("")
              .toUpperCase()
              .slice(0, 2);
            return (
              <div
                key={m.id}
                onMouseEnter={() => setHoveredId(`member-${m.id}`)}
                onMouseLeave={() => setHoveredId(null)}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 12,
                  padding: "10px 12px",
                  borderRadius: 8,
                  background: hoveredId === `member-${m.id}` ? "var(--panel)" : "transparent",
                  transition: "background 150ms",
                }}
              >
                <div
                  style={{
                    width: 32,
                    height: 32,
                    borderRadius: 8,
                    background: "var(--accent-soft)",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    flexShrink: 0,
                  }}
                >
                  <span style={{ fontWeight: 600, fontSize: "0.75rem", color: "var(--accent-strong)" }}>{initials}</span>
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 1, flex: 1, minWidth: 0 }}>
                  <span style={{ fontWeight: 500, fontSize: "0.8125rem", color: "var(--foreground)" }}>{m.name}</span>
                  <span style={{ fontSize: "0.75rem", color: "var(--muted)" }}>{m.email}</span>
                </div>
                <span
                  style={{
                    fontSize: "0.6875rem",
                    fontWeight: 500,
                    textTransform: "capitalize",
                    color: "var(--muted)",
                    padding: "2px 8px",
                    borderRadius: 4,
                    background: "var(--panel)",
                  }}
                >
                  {m.role}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
