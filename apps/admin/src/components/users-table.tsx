"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import type { ReactNode } from "react";
import { useHeaderContent } from "@/components/header-context";
import { UserRowMenu, type UserRowMenuAction } from "@/components/user-row-menu";
import { EditProfileModal } from "@/components/edit-profile-modal";
import { ResetPasswordModal } from "@/components/reset-password-modal";
import { DeleteUserModal } from "@/components/delete-user-modal";
import { changeUserRole, signOutAllSessions } from "@/app/(authenticated)/users/actions";

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
  { bg: "color-mix(in srgb, var(--warning-amber) 16%, transparent)", fg: "var(--warning-amber)" },
  { bg: "var(--critical-fill)", fg: "var(--status-error)" },
  { bg: "color-mix(in srgb, var(--event-violet) 16%, transparent)", fg: "var(--event-violet)" },
  { bg: "color-mix(in srgb, var(--signal-blue) 15%, transparent)", fg: "var(--signal-blue)" },
  { bg: "color-mix(in srgb, var(--status-live) 14%, transparent)", fg: "var(--status-live)" },
  { bg: "color-mix(in srgb, var(--active-teal) 14%, transparent)", fg: "var(--active-teal)" },
  { bg: "color-mix(in srgb, var(--emissive-mint) 12%, transparent)", fg: "var(--emissive-mint)" },
  { bg: "color-mix(in srgb, var(--status-archived) 14%, transparent)", fg: "var(--status-archived)" },
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

  if (mins < 2) return { label: "Active now", dotColor: "var(--status-live)" };
  if (mins < 60) return { label: `${mins}m ago`, dotColor: "var(--status-live)" };

  const hours = Math.floor(mins / 60);
  if (hours < 24) return { label: `${hours}h ago`, dotColor: "var(--status-draft)" };

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

type MenuState = { user: UserRow; anchor: { top: number; left: number } } | null;
type ModalKind = "edit" | "reset" | "delete";

export function UsersTable({ users, currentUserId }: Props) {
  const [search, setSearch] = useState("");
  const [filters, setFilters] = useState<Filters>({});
  const [sortBy, setSortBy] = useState<SortBy>("lastActive");
  const [openFilter, setOpenFilter] = useState<FilterKey | null>(null);
  const filterRef = useRef<HTMLDivElement | null>(null);

  const [menu, setMenu] = useState<MenuState>(null);
  const [modal, setModal] = useState<{ kind: ModalKind; user: UserRow } | null>(null);
  const [, startTransition] = useTransition();
  const [actionError, setActionError] = useState<string | null>(null);
  const [busyUserId, setBusyUserId] = useState<string | null>(null);

  const openMenu = useCallback((user: UserRow, anchor: { top: number; left: number }) => {
    setMenu({ user, anchor });
  }, []);

  const closeMenu = useCallback(() => setMenu(null), []);
  const closeModal = useCallback(() => setModal(null), []);

  const handleMenuAction = useCallback(
    (action: UserRowMenuAction) => {
      if (!menu) return;
      const user = menu.user;
      setMenu(null);

      switch (action) {
        case "edit":
          setModal({ kind: "edit", user });
          break;
        case "resetPassword":
          setModal({ kind: "reset", user });
          break;
        case "delete":
          setModal({ kind: "delete", user });
          break;
        case "toggleRole": {
          if (user.id === currentUserId && user.role === "admin") {
            setActionError("You can't demote your own admin account.");
            return;
          }
          const nextRole = user.role === "admin" ? "user" : "admin";
          setBusyUserId(user.id);
          startTransition(async () => {
            const res = await changeUserRole(user.id, nextRole);
            setBusyUserId(null);
            if (!res.ok) setActionError(res.error);
          });
          break;
        }
        case "signOutAll": {
          if (user.sessionCount === 0) return;
          setBusyUserId(user.id);
          startTransition(async () => {
            const res = await signOutAllSessions(user.id);
            setBusyUserId(null);
            if (!res.ok) setActionError(res.error);
          });
          break;
        }
      }
    },
    [menu, currentUserId],
  );

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
      <div
        style={{
          display: "flex",
          alignItems: "center",
          width: "100%",
          gap: "var(--space-12)",
          minWidth: 0,
        }}
      >
        <h1
          style={{
            fontSize: "var(--font-size-xl)",
            fontWeight: 700,
            color: "var(--foreground)",
            marginTop: 0,
            marginRight: 0,
            marginBottom: 0,
            marginLeft: 0,
            whiteSpace: "nowrap",
            fontFamily: T.fontHeading,
          }}
        >
          Users
        </h1>

        {/* Filter pills */}
        <div ref={filterRef} className="admin-table-header-filters" style={{ display: "flex", gap: "var(--space-6)", whiteSpace: "nowrap" }}>
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
                  className="odyssey-filter-pill"
                  data-active={isActive}
                  type="button"
                  onClick={() => setOpenFilterRef.current(isOpen ? null : pill.key)}
                  style={{
                    padding: "5px 12px",
                    borderRadius: "var(--radius-md)",
                    border: `1px solid ${isActive ? "var(--border-active)" : "var(--border)"}`,
                    background: isActive ? "var(--accent-soft)" : "transparent",
                    color: isActive ? "var(--accent-strong)" : "var(--muted)",
                    fontSize: "var(--font-size-sm)",
                    fontWeight: 500,
                    cursor: "pointer",
                    fontFamily: "inherit",
                    whiteSpace: "nowrap",
                  }}
                >
                  {pill.label}
                  {isActive && <span style={{ marginLeft: "var(--space-4)", opacity: 0.7 }}>{activeLabel}</span>}
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

        <div style={{ display: "flex", alignItems: "center", gap: "var(--space-8)" }}>
          <button
            className="odyssey-icon-button"
            type="button"
            onClick={() => clearAllFiltersRef.current()}
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              width: 30,
              height: 30,
              borderRadius: "var(--radius-md)",
              border: "1px solid var(--border)",
              background: "transparent",
              color: "var(--muted)",
              cursor: "pointer",
              fontSize: "var(--font-size-lg)",
            }}
            title="Reset filters"
          >
            ↻
          </button>

          <button
            className="odyssey-primary-button"
            type="button"
            style={{
              display: "flex",
              alignItems: "center",
              gap: "var(--space-4)",
              padding: "6px 14px",
              borderRadius: "var(--radius-md)",
              border: "none",
              background: "var(--emissive-mint)",
              color: "#07100E",
              fontSize: "var(--font-size-sm)",
              fontWeight: 600,
              cursor: "pointer",
              fontFamily: "inherit",
              whiteSpace: "nowrap",
            }}
          >
            + Invite User
          </button>
        </div>
      </div>,
    );
    return () => setContent(null);
  }, [filters, openFilter, setContent]);

  /* ── Body ─────────────────────────────────────────────────── */

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-20)" }}>
      {/* Toolbar */}
      <div className="admin-table-toolbar odyssey-toolbar" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "var(--space-16)", flexWrap: "wrap" }}>
        <div className="admin-table-toolbar-primary" style={{ display: "flex", alignItems: "center", gap: "var(--space-16)" }}>
          <div className="admin-table-search odyssey-search" style={{
            display: "flex", alignItems: "center", gap: "var(--space-8)",
            padding: "0.5rem 0.75rem", borderRadius: "var(--radius-lg)",
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

        <div className="admin-table-toolbar-actions" style={{ display: "flex", alignItems: "center", gap: "var(--space-8)" }}>
          <div className="odyssey-select-shell" style={{
            display: "flex", alignItems: "center", gap: "var(--space-6)",
            padding: "0.4rem 0.75rem", borderRadius: "var(--radius-button, 12px)",
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
            className="odyssey-ghost-button"
            type="button"
            style={{
              display: "flex", alignItems: "center", gap: "var(--space-6)",
              padding: "0.4rem 0.75rem", borderRadius: "var(--radius-button, 12px)",
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
      <div className="admin-table-scroll">
        <div className="admin-table-grid" style={{
          display: "flex", flexDirection: "column",
          minWidth: 920,
          background: T.panel,
          border: `1px solid ${T.border}`,
          borderRadius: "var(--radius-2xl)",
          overflow: "hidden",
        }}>
          <HeaderRow />
          {filtered.map((u) => (
            <UserDataRow
              key={u.id}
              user={u}
              isCurrent={u.id === currentUserId}
              busy={busyUserId === u.id}
              onOpenMenu={openMenu}
            />
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

      {actionError && (
        <ActionErrorBanner message={actionError} onDismiss={() => setActionError(null)} />
      )}

      {menu && (
        <UserRowMenu
          anchor={menu.anchor}
          role={menu.user.role}
          isCurrent={menu.user.id === currentUserId}
          onSelect={handleMenuAction}
          onClose={closeMenu}
        />
      )}

      <EditProfileModal
        open={modal?.kind === "edit"}
        target={modal?.kind === "edit" ? {
          id: modal.user.id,
          name: modal.user.name,
          email: modal.user.email,
          role: modal.user.role,
        } : null}
        isSelf={modal?.user.id === currentUserId}
        onClose={closeModal}
        onSaved={closeModal}
      />

      <ResetPasswordModal
        open={modal?.kind === "reset"}
        target={modal?.kind === "reset" ? {
          id: modal.user.id,
          name: modal.user.name,
          email: modal.user.email,
          authMethods: modal.user.authMethods,
        } : null}
        onClose={closeModal}
        onSaved={closeModal}
      />

      <DeleteUserModal
        open={modal?.kind === "delete"}
        target={modal?.kind === "delete" ? {
          id: modal.user.id,
          name: modal.user.name,
          email: modal.user.email,
          sessionCount: modal.user.sessionCount,
        } : null}
        onClose={closeModal}
        onDeleted={closeModal}
      />
    </div>
  );
}

function ActionErrorBanner({ message, onDismiss }: { message: string; onDismiss: () => void }) {
  useEffect(() => {
    const id = setTimeout(onDismiss, 6000);
    return () => clearTimeout(id);
  }, [onDismiss]);
  return (
    <div
      role="status"
      style={{
        position: "fixed", bottom: 24, left: "50%", transform: "translateX(-50%)",
        padding: "10px 14px", borderRadius: "var(--radius-lg)",
        background: "rgba(243,114,114,0.10)",
        border: "1px solid rgba(243,114,114,0.32)",
        color: "var(--status-error)",
        fontFamily: T.fontBody, fontSize: "var(--font-size-base)",
        boxShadow: "var(--elevation-card)",
        zIndex: 1100,
      }}
      onClick={onDismiss}
    >
      {message}
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
      className="odyssey-dropdown"
      style={{
        position: "absolute",
        top: "calc(100% + 6px)",
        left: 0,
        minWidth: 160,
        background: "var(--dropdown-bg, var(--panel))",
        border: "1px solid var(--border)",
        borderRadius: "var(--radius-md)",
        padding: "4px 0",
        zIndex: 100,
        boxShadow: "var(--elevation-card)",
      }}
    >
      {options.map((opt) => (
        <button
          className="odyssey-dropdown-item"
          data-active={active === opt.value}
          key={opt.value}
          type="button"
          onClick={() => onSelect(opt.value)}
          style={{
            display: "flex",
            alignItems: "center",
            gap: "var(--space-8)",
            width: "100%",
            padding: "6px 12px",
            background: active === opt.value ? "var(--accent-soft)" : "none",
            border: "none",
            cursor: "pointer",
            color: active === opt.value ? "var(--accent-strong)" : "var(--muted)",
            fontSize: "var(--font-size-sm)",
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
    <div className="admin-table-header-row" style={{
      display: "flex", alignItems: "center", gap: "var(--space-20)",
      padding: "12px 20px",
      borderBottom: `1px solid ${T.border}`,
      background: T.cardHover,
    }}>
      <div className="admin-table-row-check" style={{ width: 20, height: 20, flexShrink: 0, border: `1.25px solid ${T.border}`, borderRadius: "var(--radius-xs)" }} />
      <span style={{ ...headerStyle, flex: 1, minWidth: 0 }}>User</span>
      <span style={{ ...headerStyle, width: 110 }}>Role</span>
      <span style={{ ...headerStyle, width: 170 }}>Auth</span>
      <span style={{ ...headerStyle, width: 80, textAlign: "right" }}>Sessions</span>
      <span style={{ ...headerStyle, width: 130 }}>Last active</span>
      <span style={{ ...headerStyle, width: 110 }}>Joined</span>
      <div style={{ width: 72, flexShrink: 0 }} />
    </div>
  );
}

/* ── Data row ──────────────────────────────────────────────── */

function UserDataRow({
  user,
  isCurrent,
  busy,
  onOpenMenu,
}: {
  user: UserRow;
  isCurrent: boolean;
  busy: boolean;
  onOpenMenu: (user: UserRow, anchor: { top: number; left: number }) => void;
}) {
  const active = formatRelative(user.lastActiveAt);

  return (
    <div
      className="admin-table-data-row"
      style={{
        display: "flex", alignItems: "center", gap: "var(--space-20)",
        padding: "14px 20px",
        borderBottom: `1px solid ${T.border}`,
        transition: "background 100ms",
        opacity: busy ? 0.55 : 1,
      }}
      onMouseEnter={(e) => { e.currentTarget.style.background = T.cardHover; }}
      onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
    >
      <div className="admin-table-row-check" style={{ width: 20, height: 20, flexShrink: 0, border: `1.25px solid ${T.border}`, borderRadius: "var(--radius-xs)" }} />

      <div className="admin-table-primary-cell" style={{ display: "flex", alignItems: "center", gap: "var(--space-12)", flex: 1, minWidth: 0 }}>
        <Avatar user={user} isCurrent={isCurrent} />
        <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-2)", minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: "var(--space-8)" }}>
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
                padding: "2px 6px", borderRadius: "var(--radius-xs)",
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

      <div className="admin-table-mobile-fields">
        <MobileField label="Role"><RoleBadge role={user.role} /></MobileField>
        <MobileField label="Auth">
          <span style={{ display: "flex", alignItems: "center", gap: "var(--space-6)", minWidth: 0 }}>
            <AuthIcons methods={user.authMethods} />
            <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {user.authMethods.length === 0 ? "None" : user.authMethods.map(authLabel).join(" / ")}
            </span>
          </span>
        </MobileField>
        <MobileField label="Sessions">{user.sessionCount}</MobileField>
        <MobileField label="Last active">
          <span style={{ display: "flex", alignItems: "center", gap: "var(--space-6)" }}>
            {active.dotColor && (
              <span style={{ width: 6, height: 6, borderRadius: "50%", background: active.dotColor, display: "block" }} />
            )}
            {active.label}
          </span>
        </MobileField>
        <MobileField label="Joined">{formatJoinDate(user.createdAt)}</MobileField>
      </div>

      <div className="admin-table-desktop-cell" style={{ width: 110, flexShrink: 0 }}>
        <RoleBadge role={user.role} />
      </div>

      <div className="admin-table-desktop-cell" style={{ width: 170, flexShrink: 0, display: "flex", alignItems: "center", gap: "var(--space-6)" }}>
        <AuthIcons methods={user.authMethods} />
        <span style={{ fontFamily: T.fontBody, fontSize: "0.75rem", color: "var(--foreground)", lineHeight: "15px" }}>
          {user.authMethods.length === 0 ? "None" : user.authMethods.map(authLabel).join(" · ")}
        </span>
      </div>

      <span className="admin-table-desktop-cell" style={{
        width: 80, flexShrink: 0, textAlign: "right",
        fontFamily: T.fontMono, fontSize: "0.8125rem", fontWeight: 500,
        color: user.sessionCount > 0 ? "var(--foreground)" : T.muted,
      }}>
        {user.sessionCount}
      </span>

      <div className="admin-table-desktop-cell" style={{ width: 130, flexShrink: 0, display: "flex", alignItems: "center", gap: "var(--space-6)" }}>
        {active.dotColor && (
          <span style={{ width: 6, height: 6, borderRadius: "50%", background: active.dotColor, display: "block" }} />
        )}
        <span style={{ fontFamily: T.fontBody, fontSize: "0.75rem", color: "var(--foreground)" }}>
          {active.label}
        </span>
      </div>

      <span className="admin-table-desktop-cell" style={{
        width: 110, flexShrink: 0,
        fontFamily: T.fontBody, fontSize: "0.75rem", color: T.muted,
      }}>
        {formatJoinDate(user.createdAt)}
      </span>

      <div
        className="admin-table-row-actions"
        style={{
          width: 72,
          flexShrink: 0,
          display: "flex",
          alignItems: "center",
          justifyContent: "flex-end",
          gap: "var(--space-6)",
        }}
      >
        <CopyUserIdButton userId={user.id} disabled={busy} />
        <button
          className="admin-table-row-menu"
          type="button"
          onClick={(e) => {
            const rect = e.currentTarget.getBoundingClientRect();
            onOpenMenu(user, { top: rect.bottom + 6, left: rect.right });
          }}
          disabled={busy}
          style={{
            width: 24, height: 24, flexShrink: 0,
            display: "flex", alignItems: "center", justifyContent: "center",
            border: "none", background: "transparent",
            cursor: busy ? "not-allowed" : "pointer",
            color: T.muted, borderRadius: "var(--radius-xs)",
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
    </div>
  );
}

function CopyUserIdButton({ userId, disabled }: { userId: string; disabled: boolean }) {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const id = window.setTimeout(() => setCopied(false), 1400);
    return () => window.clearTimeout(id);
  }, [copied]);

  return (
    <button
      type="button"
      onClick={async () => {
        if (disabled) return;
        try {
          await navigator.clipboard.writeText(userId);
          setCopied(true);
        } catch {
          setCopied(false);
        }
      }}
      disabled={disabled}
      style={{
        width: 34,
        height: 24,
        flexShrink: 0,
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        borderRadius: "var(--radius-xs)",
        border: "1px solid var(--border)",
        background: copied ? "var(--accent-soft)" : "transparent",
        color: copied ? "var(--accent-strong)" : T.muted,
        cursor: disabled ? "not-allowed" : "pointer",
        fontFamily: T.fontMono,
        fontSize: "0.625rem",
        fontWeight: 600,
        letterSpacing: "0.04em",
      }}
      aria-label={`Copy user id ${userId}`}
      title={copied ? "Copied user ID" : "Copy user ID"}
    >
      {copied ? "OK" : "ID"}
    </button>
  );
}

function MobileField({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="admin-table-mobile-field">
      <span className="admin-table-mobile-label">{label}</span>
      <span className="admin-table-mobile-value">{children}</span>
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
        background: "linear-gradient(135deg, var(--emissive-mint) 0%, var(--active-teal) 100%)",
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
      display: "inline-flex", alignItems: "center", gap: "var(--space-6)",
      padding: "4px 10px",
      background: admin ? T.accentSoft : T.cardHover,
      borderRadius: "var(--radius-button, 12px)",
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
    <div style={{ display: "flex", alignItems: "center", gap: "var(--space-4)" }}>
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
