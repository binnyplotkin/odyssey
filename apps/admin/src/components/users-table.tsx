"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useHeaderContent } from "@/components/header-context";

/* ── Types ─────────────────────────────────────────────────── */

export type AuthMethod = "password" | "google";

export type UserRow = {
  id: string;
  name: string | null;
  email: string;
  role: "admin" | "user";
  image: string | null;
  authMethods: AuthMethod[];
  sessionCount: number;
  lastActiveAt: string | null; // ISO string
  createdAt: string; // ISO string
};

type Props = {
  users: UserRow[];
  currentUserId: string | null;
};

/* ── Design tokens ─────────────────────────────────────────── */

const T = {
  fg: "var(--foreground)",
  muted: "var(--muted)",
  panel: "var(--panel)",
  border: "var(--border)",
  accent: "var(--accent)",
  accentStrong: "var(--accent-strong)",
  accentSoft: "var(--accent-soft)",
  cardHover: "var(--card-hover)",
  fontHeading: "'Space Grotesk', sans-serif",
  fontBody: "'Inter', sans-serif",
  fontMono: "var(--font-mono, 'JetBrains Mono', monospace)",
} as const;

/* ── Avatar palette ────────────────────────────────────────── */

const AVATAR_PALETTE: Array<{ bg: string; fg: string }> = [
  { bg: "#4D3A28", fg: "#E8B87A" },
  { bg: "#4D2828", fg: "#E89090" },
  { bg: "#342D4D", fg: "#B49DE8" },
  { bg: "#28384D", fg: "#7AB0E8" },
  { bg: "#28422D", fg: "#8AD09A" },
  { bg: "#402836", fg: "#E89BC0" },
  { bg: "#334D28", fg: "#A8D07A" },
  { bg: "#34394D", fg: "#A8AEC4" },
];

function hashString(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash + str.charCodeAt(i)) | 0;
  }
  return Math.abs(hash);
}

function avatarColors(userId: string) {
  return AVATAR_PALETTE[hashString(userId) % AVATAR_PALETTE.length];
}

function initial(user: UserRow): string {
  const source = user.name?.trim() || user.email;
  return source.charAt(0).toUpperCase();
}

/* ── Time formatting ───────────────────────────────────────── */

function formatRelative(iso: string | null): { label: string; dotColor: string | null } {
  if (!iso) return { label: "Never", dotColor: null };
  const then = new Date(iso).getTime();
  const diffMs = Date.now() - then;
  const mins = Math.floor(diffMs / 60000);

  if (mins < 2) return { label: "Active now", dotColor: "#4ADE80" };
  if (mins < 60) return { label: `${mins}m ago`, dotColor: "#4ADE80" };

  const hours = Math.floor(mins / 60);
  if (hours < 24) return { label: `${hours}h ago`, dotColor: "#FACC15" };

  const days = Math.floor(hours / 24);
  if (days < 7) return { label: `${days}d ago`, dotColor: "var(--muted)" };

  const weeks = Math.floor(days / 7);
  if (weeks < 4) return { label: `${weeks}w ago`, dotColor: "var(--muted)" };

  const months = Math.floor(days / 30);
  if (months < 12) return { label: `${months}mo ago`, dotColor: "var(--muted)" };

  return { label: `${Math.floor(days / 365)}y ago`, dotColor: "var(--muted)" };
}

function formatJoinDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

/* ── Filters ───────────────────────────────────────────────── */

type RoleValue = "admin" | "user";
type AuthValue = "password" | "google";
type StatusValue = "active" | "idle" | "never";
type JoinedValue = "7d" | "30d" | "year";

type Filters = {
  role?: RoleValue;
  auth?: AuthValue;
  status?: StatusValue;
  joined?: JoinedValue;
};

type FilterKey = keyof Filters;

const FILTER_PILLS: { key: FilterKey; label: string; options: { value: string; label: string }[] }[] = [
  { key: "role", label: "Role", options: [{ value: "admin", label: "Admin" }, { value: "user", label: "User" }] },
  { key: "auth", label: "Auth", options: [{ value: "password", label: "Password" }, { value: "google", label: "Google" }] },
  { key: "status", label: "Status", options: [{ value: "active", label: "Active (< 24h)" }, { value: "idle", label: "Idle" }, { value: "never", label: "Never active" }] },
  { key: "joined", label: "Joined", options: [{ value: "7d", label: "Last 7 days" }, { value: "30d", label: "Last 30 days" }, { value: "year", label: "Last year" }] },
];

type SortBy = "lastActive" | "name" | "sessions" | "joined";

const SORTS: { key: SortBy; label: string }[] = [
  { key: "lastActive", label: "Last active" },
  { key: "name", label: "Name" },
  { key: "sessions", label: "Sessions" },
  { key: "joined", label: "Joined" },
];

/* ── Filter predicates ─────────────────────────────────────── */

function statusOf(u: UserRow): StatusValue {
  if (!u.lastActiveAt) return "never";
  const ageMs = Date.now() - new Date(u.lastActiveAt).getTime();
  return ageMs < 24 * 60 * 60 * 1000 ? "active" : "idle";
}

function joinedBucket(u: UserRow): JoinedValue | "older" {
  const ageMs = Date.now() - new Date(u.createdAt).getTime();
  const day = 24 * 60 * 60 * 1000;
  if (ageMs < 7 * day) return "7d";
  if (ageMs < 30 * day) return "30d";
  if (ageMs < 365 * day) return "year";
  return "older";
}

function matchesJoinedFilter(u: UserRow, f: JoinedValue): boolean {
  const ageMs = Date.now() - new Date(u.createdAt).getTime();
  const day = 24 * 60 * 60 * 1000;
  switch (f) {
    case "7d": return ageMs < 7 * day;
    case "30d": return ageMs < 30 * day;
    case "year": return ageMs < 365 * day;
  }
}

/* ── Component ─────────────────────────────────────────────── */

export function UsersTable({ users, currentUserId }: Props) {
  const [search, setSearch] = useState("");
  const [filters, setFilters] = useState<Filters>({});
  const [sortBy, setSortBy] = useState<SortBy>("lastActive");
  const [openFilter, setOpenFilter] = useState<FilterKey | null>(null);
  const filterRef = useRef<HTMLDivElement | null>(null);

  // Close dropdown on outside click
  useEffect(() => {
    if (!openFilter) return;
    const handler = (e: MouseEvent) => {
      if (filterRef.current && !filterRef.current.contains(e.target as Node)) {
        setOpenFilter(null);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [openFilter]);

  const toggleFilter = useCallback((key: FilterKey, value: string) => {
    setFilters((prev) => {
      if (prev[key] === value) {
        const next = { ...prev };
        delete next[key];
        return next;
      }
      return { ...prev, [key]: value as never };
    });
    setOpenFilter(null);
  }, []);

  const clearAllFilters = useCallback(() => {
    setFilters({});
    setSearch("");
  }, []);

  const counts = useMemo(() => {
    const c = { all: users.length, admin: 0, user: 0 };
    for (const u of users) c[u.role]++;
    return c;
  }, [users]);

  const filtered = useMemo(() => {
    let result = users;

    if (search.trim()) {
      const q = search.trim().toLowerCase();
      result = result.filter((u) =>
        (u.name ?? "").toLowerCase().includes(q) ||
        u.email.toLowerCase().includes(q),
      );
    }

    if (filters.role) result = result.filter((u) => u.role === filters.role);
    if (filters.auth) result = result.filter((u) => u.authMethods.includes(filters.auth!));
    if (filters.status) result = result.filter((u) => statusOf(u) === filters.status);
    if (filters.joined) result = result.filter((u) => matchesJoinedFilter(u, filters.joined!));

    result = [...result].sort((a, b) => {
      switch (sortBy) {
        case "name":
          return (a.name ?? a.email).localeCompare(b.name ?? b.email);
        case "sessions":
          return b.sessionCount - a.sessionCount;
        case "joined":
          return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
        case "lastActive":
        default: {
          const ta = a.lastActiveAt ? new Date(a.lastActiveAt).getTime() : 0;
          const tb = b.lastActiveAt ? new Date(b.lastActiveAt).getTime() : 0;
          return tb - ta;
        }
      }
    });

    return result;
  }, [users, search, filters, sortBy]);

  /* ── Push content into global header ──────────────────────── */

  const { setContent } = useHeaderContent();
  const toggleFilterRef = useRef(toggleFilter);
  const setOpenFilterRef = useRef(setOpenFilter);
  const clearAllFiltersRef = useRef(clearAllFilters);
  toggleFilterRef.current = toggleFilter;
  setOpenFilterRef.current = setOpenFilter;
  clearAllFiltersRef.current = clearAllFilters;

  useEffect(() => {
    setContent(
      <>
        <h1
          style={{
            fontSize: 16,
            fontWeight: 700,
            color: "var(--foreground)",
            marginTop: 0,
            marginRight: 12,
            marginBottom: 0,
            marginLeft: 0,
            whiteSpace: "nowrap",
            fontFamily: T.fontHeading,
          }}
        >
          Users
        </h1>

        {/* Filter pills */}
        <div ref={filterRef} style={{ display: "flex", gap: 6, whiteSpace: "nowrap" }}>
          {FILTER_PILLS.map((pill) => {
            const activeValue = filters[pill.key];
            const isActive = !!activeValue;
            const isOpen = openFilter === pill.key;
            const activeLabel = isActive
              ? pill.options.find((o) => o.value === activeValue)?.label ?? activeValue
              : null;
            return (
              <div key={pill.key} style={{ position: "relative" }}>
                <button
                  type="button"
                  onClick={() => setOpenFilterRef.current(isOpen ? null : pill.key)}
                  style={{
                    padding: "5px 12px",
                    borderRadius: 8,
                    border: `1px solid ${isActive ? "rgba(140, 231, 210, 0.3)" : "var(--border)"}`,
                    background: isActive ? "rgba(140, 231, 210, 0.08)" : "transparent",
                    color: isActive ? "#8CE7D2" : "var(--muted)",
                    fontSize: 11,
                    fontWeight: 500,
                    cursor: "pointer",
                    fontFamily: "inherit",
                    whiteSpace: "nowrap",
                  }}
                >
                  {pill.label}
                  {isActive && <span style={{ marginLeft: 4, opacity: 0.7 }}>{activeLabel}</span>}
                </button>
                {isOpen && (
                  <FilterDropdown
                    options={pill.options}
                    active={activeValue}
                    onSelect={(v) => toggleFilterRef.current(pill.key, v)}
                  />
                )}
              </div>
            );
          })}
        </div>

        <div style={{ flex: 1 }} />

        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <button
            type="button"
            onClick={() => clearAllFiltersRef.current()}
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              width: 30,
              height: 30,
              borderRadius: 8,
              border: "1px solid var(--border)",
              background: "transparent",
              color: "var(--muted)",
              cursor: "pointer",
              fontSize: 14,
            }}
            title="Reset filters"
          >
            ↻
          </button>

          <button
            type="button"
            style={{
              display: "flex",
              alignItems: "center",
              gap: 4,
              padding: "6px 14px",
              borderRadius: 8,
              border: "none",
              background: "#8CE7D2",
              color: "#000",
              fontSize: 11,
              fontWeight: 600,
              cursor: "pointer",
              fontFamily: "inherit",
              whiteSpace: "nowrap",
            }}
          >
            + Invite User
          </button>
        </div>
      </>,
    );
    return () => setContent(null);
  }, [filters, openFilter, setContent]);

  /* ── Body ─────────────────────────────────────────────────── */

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      {/* Toolbar */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16, flexWrap: "wrap" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          <div style={{
            display: "flex", alignItems: "center", gap: 8,
            padding: "0.5rem 0.75rem", borderRadius: 10,
            background: T.panel, border: `1px solid ${T.border}`,
            width: 320,
          }}>
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
              <circle cx="6" cy="6" r="4.5" stroke="var(--muted)" strokeWidth="1.5" />
              <line x1="9.5" y1="9.5" x2="12.5" y2="12.5" stroke="var(--muted)" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
            <input
              type="text"
              placeholder="Search by name or email…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              style={{
                flex: 1, border: "none", background: "transparent", outline: "none",
                fontSize: "0.8125rem", color: T.fg, fontFamily: T.fontBody,
              }}
            />
          </div>
          <span style={{
            fontFamily: T.fontMono, fontSize: "0.6875rem", fontWeight: 500,
            color: T.muted, letterSpacing: "0.06em", textTransform: "uppercase",
          }}>
            {filtered.length} {filtered.length === 1 ? "user" : "users"} · {counts.admin} admin{counts.admin === 1 ? "" : "s"}
          </span>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <div style={{
            display: "flex", alignItems: "center", gap: 6,
            padding: "0.4rem 0.75rem", borderRadius: 9999,
            border: `1px solid ${T.border}`,
            fontSize: "0.75rem", color: T.muted, fontFamily: T.fontBody,
          }}>
            <span>Sort</span>
            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value as SortBy)}
              style={{
                border: "none", background: "transparent", outline: "none",
                color: T.fg, fontSize: "0.75rem", fontWeight: 500, cursor: "pointer", fontFamily: T.fontBody,
              }}
            >
              {SORTS.map((s) => (
                <option key={s.key} value={s.key} style={{ background: "var(--background)", color: T.fg }}>
                  {s.label}
                </option>
              ))}
            </select>
          </div>
          <button
            type="button"
            style={{
              display: "flex", alignItems: "center", gap: 6,
              padding: "0.4rem 0.75rem", borderRadius: 9999,
              border: `1px solid ${T.border}`, background: "transparent",
              color: T.muted, fontSize: "0.75rem", cursor: "pointer",
              fontFamily: T.fontBody,
            }}
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <polyline points="7 10 12 15 17 10" />
              <line x1="12" y1="15" x2="12" y2="3" />
            </svg>
            Export CSV
          </button>
        </div>
      </div>

      {/* Table */}
      <div style={{
        display: "flex", flexDirection: "column",
        background: T.panel,
        border: `1px solid ${T.border}`,
        borderRadius: 14,
        overflow: "hidden",
      }}>
        <HeaderRow />
        {filtered.map((u) => (
          <UserDataRow key={u.id} user={u} isCurrent={u.id === currentUserId} />
        ))}
        {filtered.length === 0 && (
          <div style={{
            padding: "3rem 1rem", textAlign: "center",
            color: T.muted, fontSize: "0.8125rem", fontFamily: T.fontBody,
          }}>
            No users match your filters.
          </div>
        )}
      </div>
    </div>
  );
}

/* ── Filter dropdown ───────────────────────────────────────── */

function FilterDropdown({
  options,
  active,
  onSelect,
}: {
  options: { value: string; label: string }[];
  active: string | undefined;
  onSelect: (value: string) => void;
}) {
  return (
    <div
      style={{
        position: "absolute",
        top: "calc(100% + 6px)",
        left: 0,
        minWidth: 160,
        background: "var(--dropdown-bg, var(--panel))",
        border: "1px solid var(--border)",
        borderRadius: 8,
        padding: "4px 0",
        zIndex: 100,
        boxShadow: "0 8px 24px rgba(0, 0, 0, 0.5)",
      }}
    >
      {options.map((opt) => (
        <button
          key={opt.value}
          type="button"
          onClick={() => onSelect(opt.value)}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            width: "100%",
            padding: "6px 12px",
            background: active === opt.value ? "rgba(140, 231, 210, 0.08)" : "none",
            border: "none",
            cursor: "pointer",
            color: active === opt.value ? "#8CE7D2" : "var(--muted)",
            fontSize: 11,
            fontFamily: "var(--font-mono, ui-monospace, monospace)",
            textAlign: "left",
          }}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}

/* ── Header row ────────────────────────────────────────────── */

function HeaderRow() {
  const headerStyle = {
    fontFamily: T.fontMono, fontSize: "0.6875rem", fontWeight: 500,
    color: T.muted, letterSpacing: "0.08em", textTransform: "uppercase" as const,
    flexShrink: 0,
  };
  return (
    <div style={{
      display: "flex", alignItems: "center", gap: 20,
      padding: "12px 20px",
      borderBottom: `1px solid ${T.border}`,
      background: T.cardHover,
    }}>
      <div style={{ width: 20, height: 20, flexShrink: 0, border: `1.25px solid ${T.border}`, borderRadius: 4 }} />
      <span style={{ ...headerStyle, flex: 1, minWidth: 0 }}>User</span>
      <span style={{ ...headerStyle, width: 110 }}>Role</span>
      <span style={{ ...headerStyle, width: 170 }}>Auth</span>
      <span style={{ ...headerStyle, width: 80, textAlign: "right" }}>Sessions</span>
      <span style={{ ...headerStyle, width: 130 }}>Last active</span>
      <span style={{ ...headerStyle, width: 110 }}>Joined</span>
      <div style={{ width: 24, flexShrink: 0 }} />
    </div>
  );
}

/* ── Data row ──────────────────────────────────────────────── */

function UserDataRow({ user, isCurrent }: { user: UserRow; isCurrent: boolean }) {
  const active = formatRelative(user.lastActiveAt);

  return (
    <div
      style={{
        display: "flex", alignItems: "center", gap: 20,
        padding: "14px 20px",
        borderBottom: `1px solid ${T.border}`,
        transition: "background 100ms",
      }}
      onMouseEnter={(e) => { e.currentTarget.style.background = T.cardHover; }}
      onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
    >
      <div style={{ width: 20, height: 20, flexShrink: 0, border: `1.25px solid ${T.border}`, borderRadius: 4 }} />

      <div style={{ display: "flex", alignItems: "center", gap: 12, flex: 1, minWidth: 0 }}>
        <Avatar user={user} isCurrent={isCurrent} />
        <div style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{
              fontFamily: T.fontHeading, fontSize: "0.875rem", fontWeight: 500,
              color: "var(--foreground)", lineHeight: "18px",
              overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
            }}>
              {user.name?.trim() || user.email}
            </span>
            {isCurrent && (
              <span style={{
                fontFamily: T.fontMono, fontSize: "0.5625rem", fontWeight: 600,
                color: T.accentStrong, background: T.accentSoft,
                padding: "2px 6px", borderRadius: 4,
                letterSpacing: "0.08em", textTransform: "uppercase",
              }}>
                You
              </span>
            )}
          </div>
          <span style={{
            fontFamily: T.fontBody, fontSize: "0.75rem",
            color: T.muted, lineHeight: "15px",
            overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
          }}>
            {user.email}
          </span>
        </div>
      </div>

      <div style={{ width: 110, flexShrink: 0 }}>
        <RoleBadge role={user.role} />
      </div>

      <div style={{ width: 170, flexShrink: 0, display: "flex", alignItems: "center", gap: 6 }}>
        <AuthIcons methods={user.authMethods} />
        <span style={{ fontFamily: T.fontBody, fontSize: "0.75rem", color: "var(--foreground)", lineHeight: "15px" }}>
          {user.authMethods.length === 0 ? "None" : user.authMethods.map(authLabel).join(" · ")}
        </span>
      </div>

      <span style={{
        width: 80, flexShrink: 0, textAlign: "right",
        fontFamily: T.fontMono, fontSize: "0.8125rem", fontWeight: 500,
        color: user.sessionCount > 0 ? "var(--foreground)" : T.muted,
      }}>
        {user.sessionCount}
      </span>

      <div style={{ width: 130, flexShrink: 0, display: "flex", alignItems: "center", gap: 6 }}>
        {active.dotColor && (
          <span style={{ width: 6, height: 6, borderRadius: "50%", background: active.dotColor, display: "block" }} />
        )}
        <span style={{ fontFamily: T.fontBody, fontSize: "0.75rem", color: "var(--foreground)" }}>
          {active.label}
        </span>
      </div>

      <span style={{
        width: 110, flexShrink: 0,
        fontFamily: T.fontBody, fontSize: "0.75rem", color: T.muted,
      }}>
        {formatJoinDate(user.createdAt)}
      </span>

      <button
        type="button"
        style={{
          width: 24, height: 24, flexShrink: 0,
          display: "flex", alignItems: "center", justifyContent: "center",
          border: "none", background: "transparent", cursor: "pointer",
          color: T.muted, borderRadius: 4,
        }}
        aria-label="User actions"
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
          <circle cx="5" cy="12" r="1.75" />
          <circle cx="12" cy="12" r="1.75" />
          <circle cx="19" cy="12" r="1.75" />
        </svg>
      </button>
    </div>
  );
}

/* ── Sub-components ────────────────────────────────────────── */

function Avatar({ user, isCurrent }: { user: UserRow; isCurrent: boolean }) {
  const [imageFailed, setImageFailed] = useState(false);

  if (user.image && !imageFailed) {
    return (
      <img
        src={user.image}
        alt={user.name ?? user.email}
        // Google's avatar CDN (lh3.googleusercontent.com) rejects requests that
        // carry a Referer header. Stripping it makes the image load.
        referrerPolicy="no-referrer"
        onError={() => setImageFailed(true)}
        style={{ width: 36, height: 36, flexShrink: 0, borderRadius: "50%", objectFit: "cover" }}
      />
    );
  }

  if (isCurrent) {
    return (
      <div style={{
        width: 36, height: 36, flexShrink: 0, borderRadius: "50%",
        background: "linear-gradient(135deg, #8CE7D2 0%, #4FB8A8 100%)",
        display: "flex", alignItems: "center", justifyContent: "center",
      }}>
        <span style={{ fontFamily: T.fontHeading, fontSize: "0.875rem", fontWeight: 600, color: "#0C0E14", lineHeight: "16px" }}>
          {initial(user)}
        </span>
      </div>
    );
  }

  const colors = avatarColors(user.id);
  return (
    <div style={{
      width: 36, height: 36, flexShrink: 0, borderRadius: "50%",
      background: colors.bg,
      display: "flex", alignItems: "center", justifyContent: "center",
    }}>
      <span style={{ fontFamily: T.fontHeading, fontSize: "0.875rem", fontWeight: 600, color: colors.fg, lineHeight: "16px" }}>
        {initial(user)}
      </span>
    </div>
  );
}

function RoleBadge({ role }: { role: "admin" | "user" }) {
  const admin = role === "admin";
  return (
    <span style={{
      display: "inline-flex", alignItems: "center", gap: 6,
      padding: "4px 10px",
      background: admin ? T.accentSoft : T.cardHover,
      borderRadius: 9999,
      fontFamily: T.fontMono, fontSize: "0.625rem", fontWeight: 600,
      color: admin ? T.accentStrong : T.muted,
      letterSpacing: "0.08em", textTransform: "uppercase",
    }}>
      <span style={{
        width: 8, height: 8, borderRadius: "50%",
        background: admin ? T.accentStrong : T.muted,
        display: "block",
      }} />
      {role}
    </span>
  );
}

function authLabel(method: AuthMethod): string {
  switch (method) {
    case "password": return "Password";
    case "google": return "Google";
  }
}

function AuthIcons({ methods }: { methods: AuthMethod[] }) {
  const stroke = "var(--muted)";
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
      {methods.includes("password") && (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={stroke} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-label="Password">
          <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
          <path d="M7 11V7a5 5 0 0 1 10 0v4" />
        </svg>
      )}
      {methods.includes("google") && (
        <svg width="14" height="14" viewBox="0 0 24 24" fill={stroke} aria-label="Google">
          <path d="M21.35 11.1h-9.17v2.73h6.51c-.33 3.81-3.5 5.44-6.5 5.44C8.36 19.27 5 16.25 5 12c0-4.1 3.2-7.27 7.2-7.27 3.09 0 4.9 1.97 4.9 1.97L19 4.72S16.56 2 12.1 2C6.42 2 2.03 6.8 2.03 12c0 5.05 4.13 10 10.22 10 5.35 0 9.25-3.67 9.25-9.09 0-1.15-.15-1.82-.15-1.82z" />
        </svg>
      )}
    </div>
  );
}

/* Silence unused-warning safety for the bucket helper used in future UI. */
void joinedBucket;
