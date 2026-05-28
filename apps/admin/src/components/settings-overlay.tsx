"use client";

import { useEffect, useState, useCallback, useMemo } from "react";
import { useSession } from "next-auth/react";

type Tab = "profile" | "appearance" | "team";

const TABS: { id: Tab; label: string }[] = [
  { id: "profile", label: "Profile" },
  { id: "appearance", label: "Appearance" },
  { id: "team", label: "Team" },
];

const MONO = "var(--font-mono, ui-monospace, SFMono-Regular, monospace)";
const DISPLAY = "var(--font-display, 'Space Grotesk', sans-serif)";

type TeamMember = { id: string; name: string; email: string; role: string };

/* ── Settings Overlay ─────────────────────────────────────────── */

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
  const { data: session, update } = useSession();
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
    [onClose],
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
      role="dialog"
      aria-modal="true"
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 1000,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "var(--modal-backdrop)",
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        style={{
          width: 880,
          maxHeight: "84vh",
          background: "var(--background)",
          border: "1px solid var(--border)",
          borderRadius: "var(--radius-3xl)",
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
          boxShadow: "0 24px 80px var(--shadow)",
        }}
      >
        {/* Topbar */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "var(--space-12)",
            height: 48,
            padding: "0 12px 0 20px",
            borderBottom: "1px solid var(--border)",
            flexShrink: 0,
          }}
        >
          <span
            style={{
              width: 6,
              height: 6,
              borderRadius: "50%",
              background: "var(--accent-strong)",
              flexShrink: 0,
            }}
          />
          <span
            style={{
              fontFamily: MONO,
              fontSize: "var(--font-size-sm)",
              letterSpacing: "0.14em",
              textTransform: "uppercase",
              color: "var(--text-tertiary)",
            }}
          >
            Settings
          </span>
          <div style={{ flex: 1 }} />
          <span
            style={{
              fontFamily: MONO,
              fontSize: "var(--font-size-xs)",
              letterSpacing: "0.1em",
              color: "var(--text-quaternary)",
            }}
          >
            esc to close
          </span>
          <button
            type="button"
            onClick={onClose}
            onMouseEnter={() => setHoveredId("close")}
            onMouseLeave={() => setHoveredId(null)}
            aria-label="Close settings"
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              width: 28,
              height: 28,
              border: "none",
              background:
                hoveredId === "close" ? "var(--surface-1)" : "transparent",
              color:
                hoveredId === "close"
                  ? "var(--foreground)"
                  : "var(--text-tertiary)",
              fontFamily: MONO,
              fontSize: "var(--font-size-xl)",
              cursor: "pointer",
              transition: "background 150ms, color 150ms",
            }}
          >
            ×
          </button>
        </div>

        {/* Body */}
        <div
          style={{
            display: "flex",
            flexDirection: "row",
            flex: 1,
            minHeight: 0,
          }}
        >
          {/* Rail */}
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              width: 220,
              flexShrink: 0,
              borderRight: "1px solid var(--border)",
              padding: "20px 0 0 0",
            }}
          >
            {TABS.map((tab) => {
              const active = activeTab === tab.id;
              const hovered = hoveredId === `rail-${tab.id}`;
              return (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setActiveTab(tab.id)}
                  onMouseEnter={() => setHoveredId(`rail-${tab.id}`)}
                  onMouseLeave={() => setHoveredId(null)}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "var(--space-12)",
                    height: 40,
                    margin: "0 12px",
                    padding: "0 14px",
                    border: "none",
                    borderRadius: "var(--radius-md)",
                    background: active
                      ? "var(--accent-soft)"
                      : hovered
                        ? "var(--surface-1)"
                        : "transparent",
                    cursor: "pointer",
                    textAlign: "left",
                    fontFamily: "inherit",
                    transition: "background 150ms",
                  }}
                >
                  <span
                    style={{
                      flex: 1,
                      fontSize: "0.8125rem",
                      fontWeight: active ? 500 : 400,
                      color: active
                        ? "var(--foreground)"
                        : "var(--text-secondary)",
                    }}
                  >
                    {tab.label}
                  </span>
                </button>
              );
            })}
            <div style={{ flex: 1 }} />
            <div
              style={{
                padding: "14px 16px",
                borderTop: "1px solid var(--border-subtle)",
                fontFamily: MONO,
                fontSize: "var(--font-size-xs)",
                letterSpacing: "0.12em",
                textTransform: "uppercase",
                color: "var(--text-quaternary)",
              }}
            >
              {user?.role ?? "admin"} · v0.42
            </div>
          </div>

          {/* Pane */}
          <div
            style={{
              flex: 1,
              minWidth: 0,
              overflow: "auto",
              padding: "36px 40px 40px 40px",
            }}
          >
            {activeTab === "profile" && (
              <ProfilePane
                user={user}
                hoveredId={hoveredId}
                setHoveredId={setHoveredId}
                onNameUpdated={update}
              />
            )}
            {activeTab === "appearance" && (
              <AppearancePane
                theme={theme}
                onThemeChange={onThemeChange}
                hoveredId={hoveredId}
                setHoveredId={setHoveredId}
              />
            )}
            {activeTab === "team" && (
              <TeamPane
                team={team}
                currentEmail={user?.email ?? null}
                hoveredId={hoveredId}
                setHoveredId={setHoveredId}
              />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

/* ── Shared bits ──────────────────────────────────────────────── */

function pad2(n: number) {
  return n < 10 ? `0${n}` : String(n);
}

function PaneHeader({
  eyebrow,
  headline,
  trailing,
}: {
  eyebrow: string;
  headline: string;
  trailing?: string;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-12)" }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "var(--space-12)",
          fontFamily: MONO,
          fontSize: "var(--font-size-xs)",
          fontWeight: 500,
          letterSpacing: "0.16em",
          textTransform: "uppercase",
          color: "var(--text-tertiary)",
        }}
      >
        <span>{eyebrow}</span>
        <span style={{ flex: 1, height: 1, background: "var(--border-subtle)" }} />
        {trailing && (
          <span style={{ color: "var(--text-quaternary)" }}>{trailing}</span>
        )}
      </div>
      <div
        style={{
          color: "var(--foreground)",
          fontFamily: DISPLAY,
          fontSize: 28,
          fontWeight: 500,
          lineHeight: "36px",
          letterSpacing: "-0.005em",
        }}
      >
        {headline}
      </div>
    </div>
  );
}

function SectionEyebrow({
  label,
  trailing,
  trailingColor,
}: {
  label: string;
  trailing?: string;
  trailingColor?: string;
}) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: "var(--space-10)",
        fontFamily: MONO,
        fontSize: "var(--font-size-xs)",
        fontWeight: 500,
        letterSpacing: "0.14em",
        textTransform: "uppercase",
        color: "var(--text-tertiary)",
      }}
    >
      <span>{label}</span>
      <span style={{ flex: 1, height: 1, background: "var(--border-subtle)" }} />
      {trailing && (
        <span style={{ color: trailingColor ?? "var(--text-quaternary)" }}>
          {trailing}
        </span>
      )}
    </div>
  );
}

const fieldShellStyle: React.CSSProperties = {
  height: 40,
  padding: "0 14px",
  background: "var(--ink-wash)",
  border: "1px solid var(--control-border)",
  borderRadius: "var(--radius-md)",
  display: "flex",
  alignItems: "center",
  color: "var(--foreground)",
  fontSize: "0.8125rem",
  fontFamily: "inherit",
  outline: "none",
};

const readOnlyShellStyle: React.CSSProperties = {
  height: 40,
  padding: "0 14px",
  background: "var(--surface-1)",
  border: "1px solid var(--border-subtle)",
  borderRadius: "var(--radius-md)",
  display: "flex",
  alignItems: "center",
  gap: "var(--space-10)",
  fontFamily: MONO,
  fontSize: "var(--font-size-base)",
  color: "var(--text-secondary)",
};

const mintButtonStyle: React.CSSProperties = {
  height: 40,
  padding: "0 18px",
  background: "var(--accent-strong)",
  color: "var(--background)",
  border: "none",
  borderRadius: "var(--radius-pill)",
  fontFamily: MONO,
  fontSize: "var(--font-size-sm)",
  fontWeight: 600,
  letterSpacing: "0.12em",
  textTransform: "uppercase",
  cursor: "pointer",
  transition: "opacity 150ms, background 150ms",
};

const ghostButtonStyle: React.CSSProperties = {
  height: 36,
  padding: "0 18px",
  background: "transparent",
  color: "var(--foreground)",
  border: "1px solid var(--border)",
  borderRadius: "var(--radius-pill)",
  fontFamily: MONO,
  fontSize: "var(--font-size-sm)",
  fontWeight: 500,
  letterSpacing: "0.12em",
  textTransform: "uppercase",
  cursor: "pointer",
  transition: "background 150ms, border-color 150ms",
};

/* ── Profile Pane ─────────────────────────────────────────────── */

function ProfilePane({
  user,
  hoveredId,
  setHoveredId,
  onNameUpdated,
}: {
  user:
    | { name?: string | null; email?: string | null; role?: string }
    | undefined;
  hoveredId: string | null;
  setHoveredId: (id: string | null) => void;
  onNameUpdated: (data?: Record<string, unknown>) => Promise<unknown>;
}) {
  const [nameInput, setNameInput] = useState(user?.name ?? "");
  const [profileName, setProfileName] = useState(user?.name ?? "");
  const [saveState, setSaveState] = useState<
    "idle" | "saving" | "success" | "error"
  >("idle");
  const [saveError, setSaveError] = useState("");

  useEffect(() => {
    setNameInput(user?.name ?? "");
    setProfileName(user?.name ?? "");
  }, [user?.name]);

  const dirty = nameInput.trim().length > 0 && nameInput.trim() !== profileName.trim();
  const canSave = dirty && saveState !== "saving";

  const handleSaveName = async () => {
    const trimmed = nameInput.trim();
    if (!trimmed) {
      setSaveError("Name cannot be empty.");
      setSaveState("error");
      return;
    }

    setSaveState("saving");
    setSaveError("");

    try {
      const res = await fetch("/api/account/profile", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: trimmed }),
      });

      const raw = await res.text();
      let payload: { error?: string; success?: boolean; name?: string } = {};
      try {
        payload = raw ? (JSON.parse(raw) as typeof payload) : {};
      } catch {
        // non-JSON response (e.g., framework error page)
      }

      if (!res.ok) {
        const fallback =
          raw && !raw.startsWith("<!DOCTYPE html")
            ? raw.slice(0, 180)
            : `Failed to update profile (HTTP ${res.status}).`;
        setSaveError(payload.error ?? fallback);
        setSaveState("error");
        return;
      }

      setProfileName(trimmed);
      try {
        await onNameUpdated({ name: trimmed, user: { name: trimmed } });
      } catch {
        // Session refresh can fail in some local/dev setups; DB update already succeeded.
      }
      setSaveState("success");
      setTimeout(() => setSaveState("idle"), 2000);
    } catch {
      setSaveError("Failed to update profile.");
      setSaveState("error");
    }
  };

  const initials = profileName
    ? profileName
        .split(" ")
        .map((w) => w[0])
        .join("")
        .toUpperCase()
        .slice(0, 2)
    : "?";

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-24)" }}>
      <PaneHeader eyebrow="Profile" headline="Who are you on Odyssey?" />

      {/* Identity row */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "var(--space-16)",
          padding: "24px 0",
          borderTop: "1px solid var(--border-subtle)",
          borderBottom: "1px solid var(--border-subtle)",
        }}
      >
        <div
          style={{
            width: 48,
            height: 48,
            background: "var(--accent-soft)",
            borderRadius: "var(--radius-md)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            flexShrink: 0,
            fontFamily: MONO,
            fontSize: "var(--font-size-xl)",
            fontWeight: 600,
            letterSpacing: "0.02em",
            color: "var(--accent-strong)",
          }}
        >
          {initials}
        </div>
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: "var(--space-3)",
            flex: 1,
            minWidth: 0,
          }}
        >
          <div
            style={{
              color: "var(--foreground)",
              fontSize: 15,
              fontWeight: 500,
            }}
          >
            {profileName || "—"}
          </div>
          <div
            style={{
              color: "var(--text-tertiary)",
              fontFamily: MONO,
              fontSize: "var(--font-size-sm)",
              letterSpacing: "0.04em",
            }}
          >
            {[user?.email, user?.role?.toLowerCase()].filter(Boolean).join(" · ")}
          </div>
        </div>
      </div>

      {/* Field — Name */}
      <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-8)" }}>
        <SectionEyebrow
          label="Name"
          trailing="● editable"
          trailingColor="var(--accent-strong)"
        />
        <div style={{ display: "flex", gap: "var(--space-8)" }}>
          <input
            value={nameInput}
            onChange={(e) => {
              setNameInput(e.target.value);
              if (saveState !== "idle") {
                setSaveState("idle");
                setSaveError("");
              }
            }}
            placeholder="Enter your display name"
            style={{ ...fieldShellStyle, flex: 1 }}
          />
          <button
            type="button"
            onClick={handleSaveName}
            disabled={!canSave}
            onMouseEnter={() => setHoveredId("save-name")}
            onMouseLeave={() => setHoveredId(null)}
            style={{
              ...mintButtonStyle,
              opacity: canSave ? (hoveredId === "save-name" ? 0.92 : 1) : 0.4,
              cursor: canSave ? "pointer" : "default",
            }}
          >
            {saveState === "saving" ? "Saving…" : "Save"}
          </button>
        </div>
        {saveState === "success" && (
          <span
            style={{
              color: "var(--accent-strong)",
              fontFamily: MONO,
              fontSize: "var(--font-size-sm)",
              letterSpacing: "0.04em",
            }}
          >
            ● name updated
          </span>
        )}
        {saveState === "error" && (
          <span
            style={{
              color: "var(--status-error)",
              fontFamily: MONO,
              fontSize: "var(--font-size-sm)",
              letterSpacing: "0.04em",
            }}
          >
            ● {saveError}
          </span>
        )}
      </div>

      {/* Field — Email */}
      <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-8)" }}>
        <SectionEyebrow label="Email" trailing="read-only" />
        <div style={readOnlyShellStyle}>{user?.email ?? "—"}</div>
      </div>

      {/* Field — Role */}
      <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-8)" }}>
        <SectionEyebrow label="Role" trailing="read-only" />
        <div style={readOnlyShellStyle}>
          <span
            style={{
              width: 6,
              height: 6,
              borderRadius: "50%",
              background: "var(--accent-strong)",
            }}
          />
          <span>{user?.role?.toLowerCase() ?? "—"}</span>
        </div>
      </div>

      <PasswordSection
        hoveredId={hoveredId}
        setHoveredId={setHoveredId}
      />
    </div>
  );
}

/* ── Password Section ────────────────────────────────────────── */

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
  const [status, setStatus] = useState<
    "idle" | "loading" | "success" | "error"
  >("idle");
  const [errorMsg, setErrorMsg] = useState("");

  const mismatch =
    confirmPassword.length > 0 && newPassword !== confirmPassword;
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
        const data = await res.json().catch(() => ({}));
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

  const labelStyle: React.CSSProperties = {
    width: 90,
    flexShrink: 0,
    fontFamily: MONO,
    fontSize: "var(--font-size-xs)",
    letterSpacing: "0.06em",
    textTransform: "uppercase",
    color: "var(--text-tertiary)",
  };

  const inputStyle: React.CSSProperties = {
    ...fieldShellStyle,
    flex: 1,
    height: 36,
  };

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: "var(--space-14)",
        paddingTop: "var(--space-32)",
        marginTop: "var(--space-8)",
        borderTop: "1px solid var(--border)",
      }}
    >
      <SectionEyebrow label="Password" trailing="min 8 chars" />
      <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-10)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "var(--space-14)" }}>
          <div style={labelStyle}>Current</div>
          <input
            type="password"
            value={currentPassword}
            onChange={(e) => {
              setCurrentPassword(e.target.value);
              if (status !== "idle") setStatus("idle");
            }}
            style={inputStyle}
          />
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: "var(--space-14)" }}>
          <div style={labelStyle}>New</div>
          <input
            type="password"
            value={newPassword}
            onChange={(e) => {
              setNewPassword(e.target.value);
              if (status !== "idle") setStatus("idle");
            }}
            placeholder="enter new password"
            style={inputStyle}
          />
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: "var(--space-14)" }}>
          <div style={labelStyle}>Confirm</div>
          <input
            type="password"
            value={confirmPassword}
            onChange={(e) => {
              setConfirmPassword(e.target.value);
              if (status !== "idle") setStatus("idle");
            }}
            placeholder="re-enter to confirm"
            style={inputStyle}
          />
        </div>
        {mismatch && (
          <span
            style={{
              fontFamily: MONO,
              fontSize: "var(--font-size-sm)",
              color: "var(--status-error)",
              paddingLeft: 104,
            }}
          >
            ● passwords don't match
          </span>
        )}
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: "var(--space-14)", paddingTop: "var(--space-6)" }}>
        <button
          type="button"
          disabled={!canSubmit}
          onClick={handleSubmit}
          onMouseEnter={() => setHoveredId("pw-save")}
          onMouseLeave={() => setHoveredId(null)}
          style={{
            ...ghostButtonStyle,
            background:
              canSubmit && hoveredId === "pw-save"
                ? "var(--surface-1)"
                : "transparent",
            color: canSubmit ? "var(--foreground)" : "var(--text-quaternary)",
            borderColor: canSubmit ? "var(--border)" : "var(--border-subtle)",
            cursor: canSubmit ? "pointer" : "default",
            opacity: status === "loading" ? 0.6 : 1,
          }}
        >
          {status === "loading" ? "Updating…" : "Update password"}
        </button>
        {status === "success" && (
          <span
            style={{
              color: "var(--accent-strong)",
              fontFamily: MONO,
              fontSize: "var(--font-size-sm)",
              letterSpacing: "0.04em",
            }}
          >
            ● password updated
          </span>
        )}
        {status === "error" && (
          <span
            style={{
              color: "var(--status-error)",
              fontFamily: MONO,
              fontSize: "var(--font-size-sm)",
              letterSpacing: "0.04em",
            }}
          >
            ● {errorMsg}
          </span>
        )}
      </div>
    </div>
  );
}

/* ── Appearance Pane ─────────────────────────────────────────── */

function AppearancePane({
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
  const captions: Record<typeof theme, string> = {
    dark: "Atmospheric computation on deep environmental dark. The default for simulation and graph work.",
    light: "Quiet observatory mode: pale atmosphere, low glare, and restrained computational contrast.",
    system: "Follow the OS preference and switch automatically as your environment changes.",
  };

  const swatches: {
    label: string;
    value: string;
    bg: string;
    text: string;
    border?: string;
  }[] = [
    {
      label: "Ground",
      value: "#07090B",
      bg: "var(--background)",
      text: "var(--foreground)",
    },
    {
      label: "Accent",
      value: "#BFD1CB",
      bg: "var(--accent-soft)",
      text: "var(--accent-strong)",
    },
    {
      label: "Border",
      value: "0.05w",
      bg: "var(--surface-2)",
      text: "var(--text-secondary)",
    },
    {
      label: "Danger",
      value: "#FF5A5A",
      bg: "color-mix(in srgb, var(--status-error) 10%, transparent)",
      text: "var(--status-error)",
    },
  ];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-24)" }}>
      <PaneHeader eyebrow="Appearance" headline="How should this read?" />

      {/* Theme section */}
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: "var(--space-14)",
          paddingTop: "var(--space-24)",
          borderTop: "1px solid var(--border-subtle)",
        }}
      >
        <SectionEyebrow label="Theme" trailing="applies instantly" />
        <div style={{ display: "flex", flexDirection: "row", gap: "var(--space-8)" }}>
          {(["dark", "light", "system"] as const).map((t) => {
            const selected = theme === t;
            const hovered = hoveredId === `theme-${t}`;
            return (
              <button
                key={t}
                type="button"
                onClick={() => onThemeChange(t)}
                onMouseEnter={() => setHoveredId(`theme-${t}`)}
                onMouseLeave={() => setHoveredId(null)}
                style={{
                  flex: 1,
                  padding: "14px 0",
                  border: `1px solid ${selected ? "var(--accent-strong)" : "var(--border)"}`,
                  borderRadius: "var(--radius-pill)",
                  background: selected
                    ? "var(--accent-soft)"
                    : hovered
                      ? "var(--surface-1)"
                      : "transparent",
                  color: selected
                    ? "var(--accent-strong)"
                    : "var(--text-tertiary)",
                  fontFamily: MONO,
                  fontSize: "var(--font-size-sm)",
                  fontWeight: selected ? 500 : 400,
                  letterSpacing: "0.14em",
                  textTransform: "uppercase",
                  cursor: "pointer",
                  transition: "background 150ms, color 150ms, border-color 150ms",
                }}
              >
                {t}
              </button>
            );
          })}
        </div>
        <div
          style={{
            color: "var(--text-secondary)",
            fontSize: "var(--font-size-base)",
            lineHeight: "18px",
            paddingTop: "var(--space-4)",
          }}
        >
          {captions[theme]}
        </div>
      </div>

      {/* Palette section */}
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: "var(--space-14)",
          paddingTop: "var(--space-24)",
          marginTop: "var(--space-8)",
          borderTop: "1px solid var(--border)",
        }}
      >
        <SectionEyebrow label="Palette" trailing="atmospheric · signal" />
        <div
          style={{
            display: "flex",
            flexDirection: "row",
            border: "1px solid var(--border)",
          }}
        >
          {swatches.map((s, i) => (
            <div
              key={s.label}
              style={{
                flex: 1,
                display: "flex",
                flexDirection: "column",
                gap: "var(--space-6)",
                padding: "var(--space-14)",
                background: s.bg,
                borderRight:
                  i < swatches.length - 1
                    ? "1px solid var(--border)"
                    : "none",
              }}
            >
              <div
                style={{
                  fontFamily: MONO,
                  fontSize: "var(--font-size-2xs)",
                  letterSpacing: "0.12em",
                  textTransform: "uppercase",
                  color: "var(--text-tertiary)",
                }}
              >
                {s.label}
              </div>
              <div style={{ fontFamily: MONO, fontSize: "var(--font-size-base)", color: s.text }}>
                {s.value}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Preview section */}
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: "var(--space-14)",
          paddingTop: "var(--space-24)",
          marginTop: "var(--space-8)",
          borderTop: "1px solid var(--border)",
        }}
      >
        <SectionEyebrow label="Preview" />
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            border: "1px solid var(--border)",
            background: "var(--background)",
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: "var(--space-12)",
              padding: "12px 16px",
              borderBottom: "1px solid var(--border-subtle)",
            }}
          >
            <span
              style={{
                width: 6,
                height: 6,
                borderRadius: "50%",
                background: "var(--accent-strong)",
              }}
            />
            <span
              style={{
                fontFamily: MONO,
                fontSize: "var(--font-size-xs)",
                letterSpacing: "0.14em",
                textTransform: "uppercase",
                color: "var(--text-tertiary)",
              }}
            >
              Running · Op 3 of 8
            </span>
            <span style={{ flex: 1 }} />
            <span
              style={{
                fontFamily: MONO,
                fontSize: "var(--font-size-xs)",
                color: "var(--text-quaternary)",
              }}
            >
              02:14
            </span>
          </div>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: "var(--space-12)",
              padding: "14px 16px",
              background: "var(--accent-soft)",
            }}
          >
            <span
              style={{
                width: 28,
                fontFamily: MONO,
                fontSize: "var(--font-size-sm)",
                color: "var(--accent-strong)",
              }}
            >
              02
            </span>
            <span
              style={{
                flex: 1,
                color: "var(--foreground)",
                fontSize: "var(--font-size-md)",
                fontWeight: 500,
              }}
            >
              Characters
            </span>
            <span
              style={{
                fontFamily: MONO,
                fontSize: "var(--font-size-xs)",
                color: "var(--accent-strong)",
              }}
            >
              12
            </span>
          </div>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: "var(--space-12)",
              padding: "14px 16px",
            }}
          >
            <span
              style={{
                width: 28,
                fontFamily: MONO,
                fontSize: "var(--font-size-sm)",
                color: "var(--text-quaternary)",
              }}
            >
              03
            </span>
            <span
              style={{
                flex: 1,
                color: "var(--text-secondary)",
                fontSize: "var(--font-size-md)",
              }}
            >
              Wikis
            </span>
            <span
              style={{
                fontFamily: MONO,
                fontSize: "var(--font-size-xs)",
                color: "var(--text-quaternary)",
              }}
            >
              7
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ── Team Pane ────────────────────────────────────────────────── */

function TeamPane({
  team,
  currentEmail,
  hoveredId,
  setHoveredId,
}: {
  team: TeamMember[];
  currentEmail: string | null | undefined;
  hoveredId: string | null;
  setHoveredId: (id: string | null) => void;
}) {
  const [query, setQuery] = useState("");
  const [inviteFlash, setInviteFlash] = useState(false);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return team;
    return team.filter(
      (m) =>
        m.name.toLowerCase().includes(q) ||
        m.email.toLowerCase().includes(q) ||
        m.role.toLowerCase().includes(q),
    );
  }, [team, query]);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-24)" }}>
      <PaneHeader
        eyebrow="Team"
        headline="Who's in the camp?"
        trailing={team.length > 0 ? `${pad2(team.length)} members` : undefined}
      />

      {/* Search + Invite */}
      <div style={{ display: "flex", alignItems: "center", gap: "var(--space-8)" }}>
        <div
          style={{
            flex: 1,
            display: "flex",
            alignItems: "center",
            gap: "var(--space-10)",
            height: 38,
            padding: "0 14px",
            background: "var(--ink-wash)",
            border: "1px solid var(--control-border)",
            borderRadius: "var(--radius-pill)",
          }}
        >
          <svg
            width="13"
            height="13"
            viewBox="0 0 13 13"
            fill="none"
            style={{ flexShrink: 0 }}
          >
            <circle
              cx="5.5"
              cy="5.5"
              r="3.5"
              stroke="var(--text-tertiary)"
              strokeWidth="1"
            />
            <line
              x1="8.5"
              y1="8.5"
              x2="11.5"
              y2="11.5"
              stroke="var(--text-tertiary)"
              strokeWidth="1"
              strokeLinecap="square"
            />
          </svg>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Find someone…"
            style={{
              flex: 1,
              border: "none",
              outline: "none",
              background: "transparent",
              color: "var(--foreground)",
              fontSize: "var(--font-size-md)",
              fontFamily: "inherit",
            }}
          />
          <span
            style={{
              fontFamily: MONO,
              fontSize: "var(--font-size-xs)",
              color: "var(--text-quaternary)",
            }}
          >
            ⌘F
          </span>
        </div>
        <button
          type="button"
          onClick={() => {
            setInviteFlash(true);
            setTimeout(() => setInviteFlash(false), 2400);
          }}
          onMouseEnter={() => setHoveredId("invite")}
          onMouseLeave={() => setHoveredId(null)}
          style={{
            ...mintButtonStyle,
            opacity: hoveredId === "invite" ? 0.92 : 1,
          }}
        >
          + Invite
        </button>
      </div>

      {inviteFlash && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "var(--space-10)",
            padding: "10px 14px",
            border: "1px solid var(--border)",
            background: "var(--surface-1)",
            fontFamily: MONO,
            fontSize: "var(--font-size-sm)",
            letterSpacing: "0.04em",
            color: "var(--text-secondary)",
            marginTop: -8,
          }}
        >
          <span
            style={{
              width: 6,
              height: 6,
              borderRadius: "50%",
              background: "var(--accent-strong)",
            }}
          />
          <span>Invite flow lands next — for now, add members via the database.</span>
        </div>
      )}

      {/* Members */}
      <div style={{ display: "flex", flexDirection: "column" }}>
        {/* Table header */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "var(--space-10)",
            paddingBottom: "var(--space-8)",
            borderBottom: "1px solid var(--border-subtle)",
            fontFamily: MONO,
            fontSize: "var(--font-size-xs)",
            fontWeight: 500,
            letterSpacing: "0.14em",
            textTransform: "uppercase",
            color: "var(--text-tertiary)",
          }}
        >
          <div style={{ width: 28 }}>#</div>
          <div style={{ flex: 1 }}>Member</div>
          <div style={{ width: 200 }}>Email</div>
          <div style={{ width: 80, textAlign: "right" }}>Role</div>
        </div>

        {team.length === 0 ? (
          <div
            style={{
              padding: "24px 0",
              color: "var(--text-tertiary)",
              fontFamily: MONO,
              fontSize: "var(--font-size-sm)",
              letterSpacing: "0.04em",
            }}
          >
            loading team…
          </div>
        ) : filtered.length === 0 ? (
          <div
            style={{
              padding: "24px 0",
              color: "var(--text-tertiary)",
              fontFamily: MONO,
              fontSize: "var(--font-size-sm)",
              letterSpacing: "0.04em",
            }}
          >
            no matches for "{query}"
          </div>
        ) : (
          filtered.map((m, i) => {
            const isMe = currentEmail && m.email === currentEmail;
            const initials = m.name
              ? m.name
                  .split(" ")
                  .map((w) => w[0])
                  .join("")
                  .toUpperCase()
                  .slice(0, 2)
              : "?";
            const hovered = hoveredId === `member-${m.id}`;
            return (
              <div
                key={m.id}
                onMouseEnter={() => setHoveredId(`member-${m.id}`)}
                onMouseLeave={() => setHoveredId(null)}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "var(--space-10)",
                  height: 52,
                  borderBottom:
                    i < filtered.length - 1
                      ? "1px solid var(--border-subtle)"
                      : "none",
                  paddingLeft: "var(--space-14)",
                  paddingRight: "var(--space-14)",
                  marginLeft: -14,
                  marginRight: -14,
                  borderRadius: "var(--radius-md)",
                  background: isMe
                    ? "var(--accent-soft)"
                    : hovered
                      ? "var(--surface-1)"
                      : "transparent",
                  transition: "background 150ms",
                }}
              >
                <div
                  style={{
                    width: 28,
                    flexShrink: 0,
                    fontFamily: MONO,
                    fontSize: "var(--font-size-sm)",
                    fontWeight: isMe ? 500 : 400,
                    color: isMe
                      ? "var(--accent-strong)"
                      : "var(--text-quaternary)",
                  }}
                >
                  {pad2(i + 1)}
                </div>
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "var(--space-12)",
                    flex: 1,
                    minWidth: 0,
                  }}
                >
                  <div
                    style={{
                      width: 32,
                      height: 32,
                      background: isMe
                        ? "color-mix(in srgb, var(--accent-strong) 18%, transparent)"
                        : "var(--ink-fill)",
                      borderRadius: "var(--radius-md)",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      flexShrink: 0,
                      fontFamily: MONO,
                      fontSize: "var(--font-size-sm)",
                      fontWeight: 600,
                      color: isMe
                        ? "var(--accent-strong)"
                        : "var(--text-secondary)",
                    }}
                  >
                    {initials}
                  </div>
                  <div
                    style={{
                      display: "flex",
                      alignItems: "baseline",
                      gap: "var(--space-8)",
                      minWidth: 0,
                    }}
                  >
                    <span
                      style={{
                        color: isMe
                          ? "var(--foreground)"
                          : "var(--text-secondary)",
                        fontSize: "var(--font-size-md)",
                        fontWeight: isMe ? 500 : 400,
                      }}
                    >
                      {m.name || "—"}
                    </span>
                    {isMe && (
                      <span
                        style={{
                          fontFamily: MONO,
                          fontSize: "var(--font-size-xs)",
                          letterSpacing: "0.08em",
                          color: "var(--text-tertiary)",
                        }}
                      >
                        YOU
                      </span>
                    )}
                  </div>
                </div>
                <div
                  style={{
                    width: 200,
                    fontFamily: MONO,
                    fontSize: "var(--font-size-sm)",
                    color: "var(--text-tertiary)",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  {m.email}
                </div>
                <div
                  style={{
                    width: 80,
                    textAlign: "right",
                    fontFamily: MONO,
                    fontSize: "var(--font-size-xs)",
                    letterSpacing: "0.1em",
                    textTransform: "uppercase",
                    color: isMe
                      ? "var(--accent-strong)"
                      : "var(--text-tertiary)",
                  }}
                >
                  {m.role}
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
