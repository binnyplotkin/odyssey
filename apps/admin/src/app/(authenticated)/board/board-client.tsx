"use client";

import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import {
  COLUMNS,
  DOMAIN_COLORS,
  PRIORITY_DOT,
} from "@/data/board";
import type {
  ActivityItem,
  Ticket,
  TicketStatus,
  TicketDomain,
  TicketPriority,
} from "@/data/board";
import { useHeaderContent } from "@/components/header-context";

/* ── API helpers ─────────────────────────────────────────────── */

async function fetchTickets(): Promise<Ticket[]> {
  try {
    const res = await fetch("/api/tickets");
    if (!res.ok) throw new Error("fetch failed");
    const data = await res.json();
    return data.tickets as Ticket[];
  } catch {
    return [];
  }
}

async function apiCreateTicket(input: Omit<Ticket, "id" | "createdAt">): Promise<Ticket | null> {
  try {
    const res = await fetch("/api/tickets", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });
    if (!res.ok) return null;
    const data = await res.json();
    return data.ticket as Ticket;
  } catch {
    return null;
  }
}

async function apiUpdateTicket(id: string, input: Partial<Ticket>): Promise<Ticket | null> {
  try {
    const res = await fetch(`/api/tickets/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });
    if (!res.ok) return null;
    const data = await res.json();
    return data.ticket as Ticket;
  } catch {
    return null;
  }
}

async function apiDeleteTicket(id: string): Promise<boolean> {
  try {
    const res = await fetch(`/api/tickets/${id}`, { method: "DELETE" });
    return res.ok;
  } catch {
    return false;
  }
}

/* ── Filter types ────────────────────────────────────────────── */

type FilterKey = "phase" | "assignee" | "priority" | "domain" | "feature";

type Filters = Partial<Record<FilterKey, string>>;

const FILTER_PILLS: { key: FilterKey; label: string }[] = [
  { key: "feature", label: "Feature" },
  { key: "phase", label: "Phase" },
  { key: "assignee", label: "Assignee" },
  { key: "priority", label: "Priority" },
  { key: "domain", label: "Domain" },
];

/* ── Helpers ──────────────────────────────────────────────────── */

const REPO_URL = "https://github.com/binnyplotkin/odyssey";

function authorLabel(author: string): string {
  if (author === "B") return "Binny";
  if (author === "S") return "System";
  if (author === "ai-sync") return "Sync Bot";
  return author;
}

function timeAgo(iso: string): string {
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return iso;
  const diff = Math.max(0, Date.now() - then);
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 30) return `${days}d ago`;
  const mos = Math.floor(days / 30);
  return `${mos}mo ago`;
}

/**
 * Render activity text with any 7–40 char hex SHAs linked to GitHub.
 * Matches whole-word hex runs so we don't linkify partial hashes inside
 * UUIDs or filenames.
 */
function renderActivityText(text: string): React.ReactNode {
  const parts: React.ReactNode[] = [];
  const re = /\b([0-9a-f]{7,40})\b/g;
  let last = 0;
  let match: RegExpExecArray | null;
  while ((match = re.exec(text)) !== null) {
    if (match.index > last) parts.push(text.slice(last, match.index));
    const sha = match[1];
    parts.push(
      <a
        key={`${match.index}-${sha}`}
        href={`${REPO_URL}/commit/${sha}`}
        target="_blank"
        rel="noopener noreferrer"
        style={{ color: "inherit", textDecoration: "underline", textDecorationStyle: "dotted" }}
      >
        {sha.slice(0, 7)}
      </a>,
    );
    last = match.index + sha.length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return parts.length ? parts : text;
}

function SparkleIcon({ size = 12 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden="true"
    >
      <path d="M12 2l1.8 6.4L20 10l-6.2 1.6L12 18l-1.8-6.4L4 10l6.2-1.6L12 2z" />
      <path d="M19 14l.9 2.3L22 17l-2.1.7L19 20l-.9-2.3L16 17l2.1-.7L19 14z" opacity="0.7" />
    </svg>
  );
}

function uniqueValues(tickets: Ticket[], key: FilterKey, featureMap?: Map<string, string>): string[] {
  const set = new Set<string>();
  for (const t of tickets) {
    let v: string | undefined;
    if (key === "feature") {
      if (t.featureId && featureMap) v = featureMap.get(t.featureId);
    } else if (key === "phase") v = t.phase;
    else if (key === "assignee") v = t.assignee;
    else if (key === "priority") v = t.priority;
    else v = t.domain;
    if (v) set.add(v);
  }
  return Array.from(set).sort();
}

function matchesFilters(ticket: Ticket, filters: Filters, featureNameToId?: Map<string, string>): boolean {
  if (filters.domain && ticket.domain !== filters.domain) return false;
  if (filters.priority && ticket.priority !== filters.priority) return false;
  if (filters.assignee && ticket.assignee !== filters.assignee) return false;
  if (filters.phase && ticket.phase !== filters.phase) return false;
  if (filters.feature) {
    const fId = featureNameToId?.get(filters.feature);
    if (ticket.featureId !== fId) return false;
  }
  return true;
}

/* ── Team types ──────────────────────────────────────────────── */

type TeamMember = { id: string; name: string; email: string; image: string | null };

const AVATAR_COLORS = ["#8B7EB5", "#5B9E82", "#5B7FB5", "#C8875A", "#C45C5C", "#5A9E82"];

function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length >= 2) return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  return name.slice(0, 2).toUpperCase();
}

/* ── Sub-components ───────────────────────────────────────────── */

function AvatarBubble({ assigneeId, team, size = 18 }: { assigneeId: string; team: TeamMember[]; size?: number }) {
  const idx = team.findIndex((m) => m.id === assigneeId);
  const member = idx >= 0 ? team[idx] : null;
  const bg = member ? AVATAR_COLORS[idx % AVATAR_COLORS.length] : "rgba(139, 126, 192, 0.2)";
  const label = member?.name ?? assigneeId;

  return (
    <span
      title={label}
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        width: size,
        height: size,
        borderRadius: "50%",
        background: bg,
        color: "#fff",
        fontSize: size * 0.44,
        fontWeight: 600,
        flexShrink: 0,
        overflow: "hidden",
      }}
    >
      {member ? (
        getInitials(member.name)
      ) : (
        assigneeId.slice(0, 2).toUpperCase()
      )}
    </span>
  );
}

function DomainTag({ domain }: { domain: TicketDomain }) {
  const c = DOMAIN_COLORS[domain];
  return (
    <span
      style={{
        borderRadius: 4,
        padding: "2px 6px",
        background: c.bg,
        fontSize: 9,
        fontFamily: "var(--font-mono, ui-monospace, monospace)",
        fontWeight: 500,
        color: c.color,
        lineHeight: "12px",
        whiteSpace: "nowrap",
      }}
    >
      {domain}
    </span>
  );
}

function PriorityTag({ priority }: { priority: TicketPriority }) {
  return (
    <span
      style={{
        borderRadius: 4,
        padding: "2px 6px",
        background: "rgba(140, 231, 210, 0.08)",
        fontSize: 9,
        fontFamily: "var(--font-mono, ui-monospace, monospace)",
        fontWeight: 500,
        color: "#8CE7D2",
        lineHeight: "12px",
        whiteSpace: "nowrap",
      }}
    >
      {priority}
    </span>
  );
}

function TicketCard({
  ticket,
  isDone,
  isDragging,
  isSelected,
  featureName,
  team,
  onDragStart,
  onClick,
}: {
  ticket: Ticket;
  isDone: boolean;
  isDragging: boolean;
  isSelected: boolean;
  featureName?: string;
  team: TeamMember[];
  onDragStart: (e: React.DragEvent, id: string) => void;
  onClick: () => void;
}) {
  return (
    <div
      draggable
      onDragStart={(e) => onDragStart(e, ticket.id)}
      onClick={onClick}
      style={{
        display: "flex",
        flexDirection: "column",
        borderRadius: 10,
        padding: 12,
        gap: 8,
        background: isSelected ? "rgba(59, 130, 246, 0.08)" : "var(--card)",
        border: isSelected
          ? "1.5px solid rgba(59, 130, 246, 0.4)"
          : "1px solid var(--card-border)",
        boxShadow: isSelected ? "0 0 12px rgba(59, 130, 246, 0.12)" : "none",
        cursor: "grab",
        opacity: isDragging ? 0.35 : isDone ? 0.6 : 1,
        transition: "opacity 0.15s ease, box-shadow 0.15s ease, border-color 0.15s ease, background 0.15s ease",
      }}
    >
      {/* Title row */}
      <div style={{ display: "flex", alignItems: "flex-start", gap: 8 }}>
        <span
          style={{
            flex: 1,
            fontSize: 12,
            fontWeight: 500,
            color: "var(--foreground)",
            lineHeight: "17px",
            overflow: "hidden",
            display: "-webkit-box",
            WebkitLineClamp: 2,
            WebkitBoxOrient: "vertical",
          }}
        >
          {ticket.title}
        </span>
        {ticket.priority && (
          <span
            style={{
              width: 6,
              height: 6,
              borderRadius: "50%",
              background: PRIORITY_DOT[ticket.priority],
              flexShrink: 0,
              marginTop: 4,
            }}
          />
        )}
      </div>

      {/* Description */}
      {ticket.description && (
        <span
          style={{
            fontSize: 10,
            color: "var(--muted)",
            lineHeight: "14px",
            overflow: "hidden",
            display: "-webkit-box",
            WebkitLineClamp: 2,
            WebkitBoxOrient: "vertical",
          }}
        >
          {ticket.description}
        </span>
      )}

      {/* Bottom row */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          paddingTop: 4,
          borderTop: "1px solid var(--divider)",
        }}
      >
        {ticket.assignee && <AvatarBubble assigneeId={ticket.assignee} team={team} />}
        <div style={{ flex: 1 }} />
        {featureName && (
          <span
            style={{
              borderRadius: 4,
              padding: "2px 6px",
              background: "rgba(59, 130, 246, 0.08)",
              fontSize: 9,
              fontFamily: "var(--font-mono, ui-monospace, monospace)",
              fontWeight: 500,
              color: "rgba(59, 130, 246, 0.7)",
              lineHeight: "12px",
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
              maxWidth: 100,
            }}
          >
            {featureName}
          </span>
        )}
        {ticket.domain && <DomainTag domain={ticket.domain} />}
        {ticket.priority && <PriorityTag priority={ticket.priority} />}
      </div>
    </div>
  );
}

function FilterDropdown({
  options,
  active,
  onSelect,
  labelMap,
}: {
  options: string[];
  active: string | undefined;
  onSelect: (value: string) => void;
  labelMap?: Map<string, string>;
}) {
  return (
    <div
      style={{
        position: "absolute",
        top: "calc(100% + 6px)",
        left: 0,
        minWidth: 140,
        background: "var(--dropdown-bg)",
        border: "1px solid var(--input-border)",
        borderRadius: 8,
        padding: "4px 0",
        zIndex: 100,
        boxShadow: "0 8px 24px rgba(0, 0, 0, 0.5)",
      }}
    >
      {options.map((opt) => (
        <button
          key={opt}
          onClick={() => onSelect(opt)}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            width: "100%",
            padding: "6px 12px",
            background: active === opt ? "rgba(140, 231, 210, 0.08)" : "none",
            border: "none",
            cursor: "pointer",
            color:
              active === opt
                ? "#8CE7D2"
                : "var(--text-secondary)",
            fontSize: 11,
            fontFamily: "var(--font-mono, ui-monospace, monospace)",
            textAlign: "left",
          }}
        >
          {labelMap?.get(opt) ?? opt}
        </button>
      ))}
    </div>
  );
}

/* ── Inline select (for sidebar properties) ──────────────────── */

function InlineSelect<T extends string>({
  value,
  onChange,
  options,
  placeholder = "—",
  renderSelected,
  renderOption,
}: {
  value: T | "";
  onChange: (v: T | "") => void;
  options: { value: T; label: string; dot?: string; tag?: { color: string; bg: string } }[];
  placeholder?: string;
  renderSelected?: (opt: { value: T; label: string; dot?: string; tag?: { color: string; bg: string } } | undefined) => React.ReactNode;
  renderOption?: (opt: { value: T; label: string }, selected: boolean) => React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  const selected = options.find((o) => o.value === value);

  const defaultRenderSelected = () => {
    if (!selected) return <span style={{ fontSize: 12, color: "var(--text-placeholder)" }}>{placeholder}</span>;
    if (selected.tag) return (
      <span style={{
        borderRadius: 3, padding: "1px 5px", background: selected.tag.bg,
        fontSize: 10, color: selected.tag.color, lineHeight: "14px",
      }}>
        {selected.label}
      </span>
    );
    return (
      <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
        {selected.dot && <span style={{ width: 6, height: 6, borderRadius: "50%", background: selected.dot, flexShrink: 0 }} />}
        <span style={{ fontSize: 12, color: "var(--text-secondary)" }}>{selected.label}</span>
      </span>
    );
  };

  return (
    <div ref={ref} style={{ position: "relative" }}>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          padding: 0,
          background: "none",
          border: "none",
          cursor: "pointer",
          fontFamily: "inherit",
        }}
      >
        {renderSelected ? renderSelected(selected) : defaultRenderSelected()}
      </button>

      {open && (
        <div style={{
          position: "absolute",
          top: "calc(100% + 4px)",
          left: 0,
          minWidth: 160,
          background: "var(--dropdown-bg)",
          border: "1px solid var(--input-border)",
          borderRadius: 8,
          padding: "4px 0",
          zIndex: 100,
          boxShadow: "0 8px 24px rgba(0, 0, 0, 0.5)",
          maxHeight: 200,
          overflowY: "auto",
        }}>
          <button
            type="button"
            onClick={() => { onChange("" as T | ""); setOpen(false); }}
            style={{
              display: "flex", alignItems: "center", gap: 8,
              width: "100%", padding: "7px 12px",
              background: value === "" ? "rgba(140, 231, 210, 0.08)" : "none",
              border: "none", cursor: "pointer", textAlign: "left",
              color: value === "" ? "var(--accent-strong)" : "var(--text-quaternary)",
              fontSize: 11, fontFamily: "inherit",
            }}
          >
            {placeholder}
          </button>
          {options.map((opt) => {
            const isActive = value === opt.value;
            return (
              <button
                key={opt.value}
                type="button"
                onClick={() => { onChange(opt.value); setOpen(false); }}
                style={{
                  display: "flex", alignItems: "center", gap: 8,
                  width: "100%", padding: "7px 12px",
                  background: isActive ? "rgba(140, 231, 210, 0.08)" : "none",
                  border: "none", cursor: "pointer", textAlign: "left",
                  color: isActive ? "var(--accent-strong)" : "var(--text-secondary)",
                  fontSize: 11, fontFamily: "inherit",
                }}
              >
                {renderOption ? renderOption(opt, isActive) : (
                  <>
                    {opt.dot && <span style={{ width: 6, height: 6, borderRadius: "50%", background: opt.dot, flexShrink: 0 }} />}
                    {opt.tag && (
                      <span style={{
                        borderRadius: 3, padding: "1px 5px", background: opt.tag.bg,
                        fontSize: 10, color: opt.tag.color, lineHeight: "14px",
                      }}>
                        {opt.label}
                      </span>
                    )}
                    {!opt.tag && opt.label}
                  </>
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

/* ── Inline date picker ──────────────────────────────────────── */

function InlineDateInput({ value, onChange }: {
  value: string | undefined;
  onChange: (v: string | undefined) => void;
}) {
  return (
    <input
      type="date"
      value={value ?? ""}
      onChange={(e) => onChange(e.target.value || undefined)}
      style={{
        padding: 0, margin: 0, background: "none", border: "none", outline: "none",
        fontFamily: "inherit", fontSize: 12, width: "100%", cursor: "pointer",
        color: value ? "var(--text-tertiary)" : "var(--text-placeholder)",
        colorScheme: "inherit",
      }}
    />
  );
}

/* ── Custom select for modal ─────────────────────────────────── */

function ModalSelect<T extends string>({
  label,
  value,
  onChange,
  options,
  placeholder = "None",
  renderOption,
}: {
  label: string;
  value: T | "";
  onChange: (v: T | "") => void;
  options: { value: T; label: string; dot?: string; tag?: { color: string; bg: string } }[];
  placeholder?: string;
  renderOption?: (opt: { value: T; label: string }, selected: boolean) => React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  const selected = options.find((o) => o.value === value);

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column" }}>
      <span style={{
        fontSize: 10, fontWeight: 600, letterSpacing: "0.08em",
        textTransform: "uppercase", color: "var(--text-quaternary)", marginBottom: 4,
      }}>
        {label}
      </span>
      <div ref={ref} style={{ position: "relative" }}>
        <button
          type="button"
          onClick={() => setOpen(!open)}
          style={{
            width: "100%",
            padding: "8px 10px",
            borderRadius: 6,
            border: "1px solid var(--input-border)",
            background: "var(--input-bg)",
            color: value ? "var(--foreground)" : "var(--text-quaternary)",
            fontSize: 12,
            fontFamily: "inherit",
            cursor: "pointer",
            textAlign: "left",
            display: "flex",
            alignItems: "center",
            gap: 8,
          }}
        >
          {selected?.dot && (
            <span style={{ width: 6, height: 6, borderRadius: "50%", background: selected.dot, flexShrink: 0 }} />
          )}
          {selected?.tag && (
            <span style={{
              borderRadius: 3, padding: "1px 5px", background: selected.tag.bg,
              fontSize: 10, color: selected.tag.color, lineHeight: "14px",
            }}>
              {selected.label}
            </span>
          )}
          {!selected?.tag && (selected?.label ?? placeholder)}
          <span style={{ marginLeft: "auto", fontSize: 10, color: "var(--text-placeholder)" }}>▾</span>
        </button>

        {open && (
          <div style={{
            position: "absolute",
            top: "calc(100% + 4px)",
            left: 0,
            right: 0,
            background: "var(--dropdown-bg)",
            border: "1px solid var(--input-border)",
            borderRadius: 8,
            padding: "4px 0",
            zIndex: 10,
            boxShadow: "0 8px 24px rgba(0, 0, 0, 0.5)",
            maxHeight: 200,
            overflowY: "auto",
          }}>
            {/* None / clear option */}
            <button
              type="button"
              onClick={() => { onChange("" as T | ""); setOpen(false); }}
              style={{
                display: "flex", alignItems: "center", gap: 8,
                width: "100%", padding: "7px 12px", background: value === "" ? "rgba(140, 231, 210, 0.08)" : "none",
                border: "none", cursor: "pointer", textAlign: "left",
                color: value === "" ? "var(--accent-strong)" : "var(--text-quaternary)",
                fontSize: 11, fontFamily: "inherit",
              }}
            >
              {placeholder}
            </button>
            {options.map((opt) => {
              const isActive = value === opt.value;
              return (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => { onChange(opt.value); setOpen(false); }}
                  style={{
                    display: "flex", alignItems: "center", gap: 8,
                    width: "100%", padding: "7px 12px",
                    background: isActive ? "rgba(140, 231, 210, 0.08)" : "none",
                    border: "none", cursor: "pointer", textAlign: "left",
                    color: isActive ? "var(--accent-strong)" : "var(--text-secondary)",
                    fontSize: 11, fontFamily: "inherit",
                  }}
                >
                  {renderOption ? renderOption(opt, isActive) : (
                    <>
                      {opt.dot && <span style={{ width: 6, height: 6, borderRadius: "50%", background: opt.dot, flexShrink: 0 }} />}
                      {opt.tag && (
                        <span style={{
                          borderRadius: 3, padding: "1px 5px", background: opt.tag.bg,
                          fontSize: 10, color: opt.tag.color, lineHeight: "14px",
                        }}>
                          {opt.label}
                        </span>
                      )}
                      {!opt.tag && opt.label}
                    </>
                  )}
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

function NewTicketModal({
  onClose,
  onSave,
  team,
}: {
  onClose: () => void;
  onSave: (ticket: Omit<Ticket, "id" | "createdAt">) => void;
  team: TeamMember[];
}) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [status, setStatus] = useState<TicketStatus>("backlog");
  const [domain, setDomain] = useState<TicketDomain | "">("");
  const [priority, setPriority] = useState<TicketPriority | "">("");
  const [assignee, setAssignee] = useState("");

  const inputStyle: React.CSSProperties = {
    width: "100%",
    padding: "8px 10px",
    borderRadius: 6,
    border: "1px solid var(--input-border)",
    background: "var(--input-bg)",
    color: "var(--foreground)",
    fontSize: 12,
    fontFamily: "inherit",
    outline: "none",
  };

  const labelStyle: React.CSSProperties = {
    fontSize: 10,
    fontWeight: 600,
    letterSpacing: "0.08em",
    textTransform: "uppercase",
    color: "var(--text-quaternary)",
    marginBottom: 4,
  };

  const handleSubmit = () => {
    if (!title.trim()) return;
    onSave({
      title: title.trim(),
      description: description.trim() || undefined,
      status,
      domain: domain || undefined,
      priority: priority || undefined,
      assignee: assignee || undefined,
    });
  };

  const statusOptions = COLUMNS.map((c) => ({ value: c.id, label: c.label, dot: c.dotColor }));
  const domainOptions = (Object.keys(DOMAIN_COLORS) as TicketDomain[]).map((d) => ({
    value: d, label: d, tag: DOMAIN_COLORS[d],
  }));
  const priorityOptions: { value: TicketPriority; label: string; dot: string }[] = [
    { value: "P1", label: "P1 — Critical", dot: PRIORITY_DOT.P1 },
    { value: "P2", label: "P2 — Medium", dot: PRIORITY_DOT.P2 },
    { value: "P3", label: "P3 — Low", dot: PRIORITY_DOT.P3 },
  ];
  const assigneeOptions = team.map((m, i) => ({ value: m.id, label: m.name, dot: AVATAR_COLORS[i % AVATAR_COLORS.length] }));

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 200,
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
          width: 460,
          background: "var(--dropdown-bg)",
          border: "1px solid var(--input-border)",
          borderRadius: 14,
          padding: 24,
          display: "flex",
          flexDirection: "column",
          gap: 16,
        }}
      >
        <h2
          style={{
            fontSize: 16,
            fontWeight: 600,
            color: "var(--foreground)",
            margin: 0,
          }}
        >
          New Ticket
        </h2>

        {/* Title */}
        <div style={{ display: "flex", flexDirection: "column" }}>
          <span style={labelStyle}>Title</span>
          <input
            style={inputStyle}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="What needs to be done?"
            autoFocus
          />
        </div>

        {/* Description */}
        <div style={{ display: "flex", flexDirection: "column" }}>
          <span style={labelStyle}>Description</span>
          <textarea
            style={{ ...inputStyle, minHeight: 60, resize: "vertical" }}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Optional details..."
          />
        </div>

        {/* Row: Status + Domain */}
        <div style={{ display: "flex", gap: 12 }}>
          <ModalSelect
            label="Status"
            value={status}
            onChange={(v) => setStatus((v || "backlog") as TicketStatus)}
            options={statusOptions}
            placeholder="Backlog"
          />
          <ModalSelect
            label="Domain"
            value={domain}
            onChange={(v) => setDomain(v as TicketDomain | "")}
            options={domainOptions}
            placeholder="None"
          />
        </div>

        {/* Row: Priority + Assignee */}
        <div style={{ display: "flex", gap: 12 }}>
          <ModalSelect
            label="Priority"
            value={priority}
            onChange={(v) => setPriority(v as TicketPriority | "")}
            options={priorityOptions}
            placeholder="None"
          />
          <ModalSelect
            label="Assignee"
            value={assignee}
            onChange={(v) => setAssignee(v)}
            options={assigneeOptions}
            placeholder="Unassigned"
            renderOption={(opt, selected) => (
              <>
                <span style={{
                  display: "flex", alignItems: "center", justifyContent: "center",
                  width: 18, height: 18, borderRadius: "50%",
                  background: assigneeOptions.find((a) => a.value === opt.value)?.dot ?? "#8B7EB5",
                  color: "#fff", fontSize: 8, fontWeight: 600, flexShrink: 0,
                }}>
                  {getInitials(opt.label)}
                </span>
                <span>{opt.label}</span>
              </>
            )}
          />
        </div>

        {/* Actions */}
        <div
          style={{ display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 4 }}
        >
          <button
            onClick={onClose}
            style={{
              padding: "7px 16px",
              borderRadius: 8,
              border: "1px solid var(--input-border)",
              background: "none",
              color: "var(--text-tertiary)",
              fontSize: 12,
              fontWeight: 500,
              cursor: "pointer",
              fontFamily: "inherit",
            }}
          >
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            style={{
              padding: "7px 16px",
              borderRadius: 8,
              border: "none",
              background: "#8CE7D2",
              color: "#000",
              fontSize: 12,
              fontWeight: 600,
              cursor: "pointer",
              fontFamily: "inherit",
              opacity: title.trim() ? 1 : 0.4,
            }}
          >
            Create Ticket
          </button>
        </div>
      </div>
    </div>
  );
}

/* ── Detail sidebar ──────────────────────────────────────────── */

const SIDEBAR_MIN = 360;
const SIDEBAR_MAX = 700;
const SIDEBAR_DEFAULT = 480;
const SIDEBAR_WIDTH_KEY = "odyssey-board-sidebar-width";
const ACTIVITY_INITIAL_VISIBLE = 5;

function TicketDetailSidebar({
  ticket,
  onClose,
  onUpdateTicket,
  featureName,
  features = [],
  team,
}: {
  ticket: Ticket;
  onClose: () => void;
  onUpdateTicket: (updated: Ticket) => void;
  featureName?: string;
  features?: FeatureOption[];
  team: TeamMember[];
}) {
  const [width, setWidth] = useState(() => {
    if (typeof window === "undefined") return SIDEBAR_DEFAULT;
    const stored = localStorage.getItem(SIDEBAR_WIDTH_KEY);
    return stored ? Math.max(SIDEBAR_MIN, Math.min(SIDEBAR_MAX, Number(stored))) : SIDEBAR_DEFAULT;
  });
  const isDragging = useRef(false);
  const startX = useRef(0);
  const startWidth = useRef(SIDEBAR_DEFAULT);

  // Resize handlers
  const handleResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    isDragging.current = true;
    startX.current = e.clientX;
    startWidth.current = width;
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
  }, [width]);

  useEffect(() => {
    const handleMove = (e: MouseEvent) => {
      if (!isDragging.current) return;
      const delta = startX.current - e.clientX;
      const next = Math.max(SIDEBAR_MIN, Math.min(SIDEBAR_MAX, startWidth.current + delta));
      setWidth(next);
    };
    const handleUp = () => {
      if (!isDragging.current) return;
      isDragging.current = false;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      localStorage.setItem(SIDEBAR_WIDTH_KEY, String(width));
    };
    window.addEventListener("mousemove", handleMove);
    window.addEventListener("mouseup", handleUp);
    return () => {
      window.removeEventListener("mousemove", handleMove);
      window.removeEventListener("mouseup", handleUp);
    };
  }, [width]);

  // Subtask toggle
  const handleToggleSubtask = useCallback(
    (subtaskId: string) => {
      if (!ticket.subtasks) return;
      const updated = {
        ...ticket,
        subtasks: ticket.subtasks.map((st) =>
          st.id === subtaskId ? { ...st, done: !st.done } : st,
        ),
      };
      onUpdateTicket(updated);
    },
    [ticket, onUpdateTicket],
  );

  // Activity state — reset when a different ticket is selected.
  const [commentDraft, setCommentDraft] = useState("");
  const [visibleActivityCount, setVisibleActivityCount] = useState(ACTIVITY_INITIAL_VISIBLE);
  useEffect(() => {
    setCommentDraft("");
    setVisibleActivityCount(ACTIVITY_INITIAL_VISIBLE);
  }, [ticket.id]);

  const handleSubmitComment = useCallback(() => {
    const text = commentDraft.trim();
    if (!text) return;
    const entry: ActivityItem = {
      id: crypto.randomUUID(),
      author: "B",
      authorColor: "#5B9E82",
      timestamp: new Date().toISOString(),
      text,
      type: "comment",
    };
    onUpdateTicket({ ...ticket, activity: [...(ticket.activity ?? []), entry] });
    setCommentDraft("");
  }, [commentDraft, ticket, onUpdateTicket]);

  // Newest-first, sliced to the visible window.
  const sortedActivity = useMemo(() => {
    const items = ticket.activity ?? [];
    return [...items].sort(
      (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime(),
    );
  }, [ticket.activity]);
  const visibleActivity = sortedActivity.slice(0, visibleActivityCount);
  const hiddenCount = Math.max(0, sortedActivity.length - visibleActivityCount);

  const col = COLUMNS.find((c) => c.id === ticket.status);
  const doneCount = ticket.subtasks?.filter((s) => s.done).length ?? 0;
  const totalCount = ticket.subtasks?.length ?? 0;
  const progress = totalCount > 0 ? (doneCount / totalCount) * 100 : 0;

  const labelStyle: React.CSSProperties = {
    fontSize: 10,
    fontWeight: 600,
    letterSpacing: "0.04em",
    textTransform: "uppercase",
    color: "var(--text-quaternary)",
    marginBottom: 8,
  };

  const rowStyle: React.CSSProperties = {
    display: "flex",
    flexDirection: "column",
    padding: "8px 0",
  };

  return (
    <div
      style={{
        position: "absolute",
        right: 0,
        top: 0,
        bottom: 0,
        width,
        display: "flex",
        flexDirection: "column",
        background: "var(--background)",
        borderLeft: "1px solid var(--input-border)",
        boxShadow: "-8px 0 32px rgba(0, 0, 0, 0.4)",
        zIndex: 50,
        overflow: "hidden",
      }}
    >
      {/* Resize handle */}
      <div
        onMouseDown={handleResizeStart}
        style={{
          position: "absolute",
          left: -3,
          top: 0,
          bottom: 0,
          width: 6,
          cursor: "col-resize",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          zIndex: 51,
        }}
      >
        <div
          style={{
            width: 2,
            height: 40,
            borderRadius: 2,
            background: "var(--border)",
            transition: "background 0.15s ease",
          }}
        />
      </div>

      {/* Header */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "14px 20px",
          borderBottom: "1px solid var(--divider)",
          flexShrink: 0,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span
            style={{
              width: 6,
              height: 6,
              borderRadius: "50%",
              background: col?.dotColor ?? "#64748B",
            }}
          />
          <span style={{ fontSize: 11, fontWeight: 500, color: col?.dotColor ?? "#64748B", opacity: 0.8 }}>
            {col?.label ?? ticket.status}
          </span>
        </div>
        <button
          onClick={onClose}
          style={{
            width: 28,
            height: 28,
            borderRadius: 6,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            background: "var(--input-bg)",
            border: "1px solid var(--card-border)",
            color: "var(--text-quaternary)",
            fontSize: 16,
            cursor: "pointer",
            fontFamily: "inherit",
          }}
        >
          ×
        </button>
      </div>

      {/* Scrollable content */}
      <div
        style={{
          flex: 1,
          overflowY: "auto",
          display: "flex",
          flexDirection: "column",
        }}
      >
        {/* Title + Description */}
        <div style={{ padding: "20px 20px 16px", display: "flex", flexDirection: "column", gap: 10 }}>
          <input
            value={ticket.title}
            onChange={(e) => onUpdateTicket({ ...ticket, title: e.target.value })}
            style={{
              margin: 0,
              padding: 0,
              fontSize: 17,
              fontWeight: 600,
              color: "var(--text-primary)",
              lineHeight: 1.35,
              background: "none",
              border: "none",
              outline: "none",
              fontFamily: "inherit",
              width: "100%",
            }}
          />
          <textarea
            value={ticket.description ?? ""}
            onChange={(e) => onUpdateTicket({ ...ticket, description: e.target.value || undefined })}
            placeholder="Add a description..."
            rows={ticket.description ? undefined : 1}
            style={{
              margin: 0,
              padding: 0,
              fontSize: 13,
              color: "var(--text-tertiary)",
              lineHeight: 1.55,
              background: "none",
              border: "none",
              outline: "none",
              fontFamily: "inherit",
              width: "100%",
              resize: "none",
              overflow: "hidden",
              fieldSizing: "content" as unknown as undefined,
            }}
          />
        </div>

        {/* Metadata — 2-column grid */}
        <div
          style={{
            padding: "12px 20px",
            borderTop: "1px solid var(--divider)",
            borderBottom: "1px solid var(--divider)",
            display: "grid",
            gridTemplateColumns: "1fr 1fr",
            gap: "4px 12px",
          }}
        >
          {/* Status */}
          <div style={rowStyle}>
            <span style={labelStyle}>Status</span>
            <InlineSelect
              value={ticket.status}
              onChange={(v) => onUpdateTicket({ ...ticket, status: (v || "backlog") as TicketStatus })}
              options={COLUMNS.map((c) => ({ value: c.id, label: c.label, dot: c.dotColor }))}
              placeholder="Backlog"
            />
          </div>

          {/* Assignee */}
          <div style={rowStyle}>
            <span style={labelStyle}>Assignee</span>
            <InlineSelect
              value={ticket.assignee ?? ""}
              onChange={(v) => onUpdateTicket({ ...ticket, assignee: v || undefined })}
              options={team.map((m, i) => ({ value: m.id, label: m.name, dot: AVATAR_COLORS[i % AVATAR_COLORS.length] }))}
              placeholder="Unassigned"
              renderSelected={(opt) => {
                if (!opt) return <span style={{ fontSize: 12, color: "var(--text-placeholder)" }}>Unassigned</span>;
                return (
                  <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <AvatarBubble assigneeId={opt.value} team={team} size={20} />
                    <span style={{ fontSize: 12, color: "var(--text-secondary)" }}>{opt.label}</span>
                  </span>
                );
              }}
              renderOption={(opt, selected) => (
                <>
                  <span style={{
                    display: "flex", alignItems: "center", justifyContent: "center",
                    width: 18, height: 18, borderRadius: "50%",
                    background: team.findIndex((m) => m.id === opt.value) >= 0
                      ? AVATAR_COLORS[team.findIndex((m) => m.id === opt.value) % AVATAR_COLORS.length]
                      : "#8B7EB5",
                    color: "#fff", fontSize: 8, fontWeight: 600, flexShrink: 0,
                  }}>
                    {getInitials(opt.label)}
                  </span>
                  <span>{opt.label}</span>
                </>
              )}
            />
          </div>

          {/* Priority */}
          <div style={rowStyle}>
            <span style={labelStyle}>Priority</span>
            <InlineSelect
              value={ticket.priority ?? ""}
              onChange={(v) => onUpdateTicket({ ...ticket, priority: (v || undefined) as TicketPriority | undefined })}
              options={[
                { value: "P1" as TicketPriority, label: "P1 — Critical", dot: PRIORITY_DOT.P1 },
                { value: "P2" as TicketPriority, label: "P2 — Medium", dot: PRIORITY_DOT.P2 },
                { value: "P3" as TicketPriority, label: "P3 — Low", dot: PRIORITY_DOT.P3 },
              ]}
              placeholder="None"
            />
          </div>

          {/* Domain */}
          <div style={rowStyle}>
            <span style={labelStyle}>Domain</span>
            <InlineSelect
              value={ticket.domain ?? ""}
              onChange={(v) => onUpdateTicket({ ...ticket, domain: (v || undefined) as TicketDomain | undefined })}
              options={(Object.keys(DOMAIN_COLORS) as TicketDomain[]).map((d) => ({
                value: d, label: d, tag: DOMAIN_COLORS[d],
              }))}
              placeholder="None"
            />
          </div>

          {/* Feature */}
          <div style={rowStyle}>
            <span style={labelStyle}>Feature</span>
            <InlineSelect
              value={ticket.featureId ?? ""}
              onChange={(v) => onUpdateTicket({ ...ticket, featureId: v || undefined })}
              options={features.map((f) => ({ value: f.id, label: f.title }))}
              placeholder="None"
              renderSelected={(opt) => {
                if (!opt) return <span style={{ fontSize: 12, color: "var(--text-placeholder)" }}>None</span>;
                return (
                  <span style={{
                    fontSize: 11, fontFamily: "var(--font-mono, ui-monospace, monospace)",
                    fontWeight: 500, color: "rgba(59, 130, 246, 0.7)",
                    background: "rgba(59, 130, 246, 0.08)", borderRadius: 4, padding: "2px 8px",
                  }}>
                    {opt.label}
                  </span>
                );
              }}
            />
          </div>

          {/* Phase */}
          <div style={rowStyle}>
            <span style={labelStyle}>Phase</span>
            <input
              value={ticket.phase ?? ""}
              onChange={(e) => onUpdateTicket({ ...ticket, phase: e.target.value || undefined })}
              placeholder="—"
              style={{
                padding: 0, margin: 0, background: "none", border: "none", outline: "none",
                fontFamily: "inherit", fontSize: 12, width: "100%",
                color: ticket.phase ? "var(--text-tertiary)" : "var(--text-placeholder)",
              }}
            />
          </div>

          {/* Start Date */}
          <div style={rowStyle}>
            <span style={labelStyle}>Start Date</span>
            <InlineDateInput
              value={ticket.startDate}
              onChange={(v) => onUpdateTicket({ ...ticket, startDate: v })}
            />
          </div>

          {/* End Date */}
          <div style={rowStyle}>
            <span style={labelStyle}>End Date</span>
            <InlineDateInput
              value={ticket.endDate}
              onChange={(v) => onUpdateTicket({ ...ticket, endDate: v })}
            />
          </div>

          {/* Created */}
          <div style={rowStyle}>
            <span style={labelStyle}>Created</span>
            <span style={{ fontSize: 12, color: "var(--text-tertiary)" }}>
              {ticket.createdAt.slice(0, 10)}
            </span>
          </div>
        </div>

        {/* Subtasks */}
        {ticket.subtasks && ticket.subtasks.length > 0 && (
          <div style={{ padding: "16px 20px", display: "flex", flexDirection: "column", gap: 10 }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <span style={{ fontSize: 12, fontWeight: 600, color: "var(--text-tertiary)" }}>
                Subtasks
              </span>
              <span style={{ fontSize: 11, color: "var(--text-placeholder)" }}>
                {doneCount} / {totalCount}
              </span>
            </div>

            {/* Progress bar */}
            <div style={{ width: "100%", height: 3, borderRadius: 2, background: "var(--card-border)" }}>
              <div
                style={{
                  width: `${progress}%`,
                  height: 3,
                  borderRadius: 2,
                  background: "rgba(59, 130, 246, 0.5)",
                  transition: "width 0.2s ease",
                }}
              />
            </div>

            {/* Subtask items */}
            {ticket.subtasks.map((st) => (
              <button
                key={st.id}
                onClick={() => handleToggleSubtask(st.id)}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  padding: "4px 0",
                  background: "none",
                  border: "none",
                  cursor: "pointer",
                  textAlign: "left",
                }}
              >
                <span
                  style={{
                    width: 16,
                    height: 16,
                    borderRadius: 4,
                    flexShrink: 0,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontSize: 10,
                    background: st.done ? "rgba(59, 130, 246, 0.15)" : "var(--input-bg)",
                    border: st.done ? "none" : "1px solid var(--input-border)",
                    color: "rgba(59, 130, 246, 0.7)",
                  }}
                >
                  {st.done ? "✓" : ""}
                </span>
                <span
                  style={{
                    fontSize: 12,
                    color: st.done ? "var(--text-quaternary)" : "var(--text-tertiary)",
                    textDecoration: st.done ? "line-through" : "none",
                  }}
                >
                  {st.label}
                </span>
              </button>
            ))}
          </div>
        )}

        {/* Activity */}
        <div
          style={{
            padding: "16px 20px",
            borderTop: "1px solid var(--divider)",
            display: "flex",
            flexDirection: "column",
            gap: 12,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ fontSize: 12, fontWeight: 600, color: "var(--text-tertiary)" }}>
              Activity
            </span>
            {sortedActivity.length > 0 && (
              <span style={{ fontSize: 11, color: "var(--text-placeholder)" }}>
                {sortedActivity.length}
              </span>
            )}
          </div>

          {/* Comment composer */}
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <textarea
              value={commentDraft}
              onChange={(e) => setCommentDraft(e.target.value)}
              onKeyDown={(e) => {
                if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
                  e.preventDefault();
                  handleSubmitComment();
                }
              }}
              placeholder="Add a comment…"
              rows={2}
              style={{
                padding: "8px 10px",
                borderRadius: 6,
                border: "1px solid var(--input-border)",
                background: "var(--input-background, transparent)",
                color: "var(--text-primary)",
                fontSize: 12,
                lineHeight: 1.5,
                fontFamily: "inherit",
                resize: "vertical",
                outline: "none",
              }}
            />
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span style={{ fontSize: 10, color: "var(--text-placeholder)" }}>
                ⌘ + Enter to post
              </span>
              <button
                type="button"
                onClick={handleSubmitComment}
                disabled={!commentDraft.trim()}
                style={{
                  padding: "4px 10px",
                  borderRadius: 6,
                  border: "1px solid var(--input-border)",
                  background: commentDraft.trim() ? "var(--text-tertiary)" : "transparent",
                  color: commentDraft.trim() ? "var(--background)" : "var(--text-placeholder)",
                  fontSize: 11,
                  fontWeight: 500,
                  cursor: commentDraft.trim() ? "pointer" : "default",
                }}
              >
                Comment
              </button>
            </div>
          </div>

          {visibleActivity.map((item) => (
            <div key={item.id} style={{ display: "flex", gap: 8 }}>
              <span
                style={{
                  width: 20,
                  height: 20,
                  borderRadius: "50%",
                  background: item.authorColor + "33",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: 9,
                  fontWeight: 600,
                  color: item.authorColor,
                  flexShrink: 0,
                  marginTop: 1,
                }}
              >
                {item.author === "ai-sync" ? (
                  <SparkleIcon size={11} />
                ) : (
                  item.author.slice(0, 1).toUpperCase()
                )}
              </span>
              <div style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0, flex: 1 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <span style={{ fontSize: 11, fontWeight: 500, color: "var(--text-tertiary)" }}>
                    {authorLabel(item.author)}
                  </span>
                  <span
                    style={{ fontSize: 11, color: "var(--text-placeholder)" }}
                    title={item.timestamp}
                  >
                    {timeAgo(item.timestamp)}
                  </span>
                </div>
                <span
                  style={{
                    fontSize: 12,
                    color: item.type === "system" ? "var(--text-quaternary)" : "var(--text-tertiary)",
                    lineHeight: 1.5,
                    fontStyle: item.type === "system" ? "italic" : "normal",
                    wordBreak: "break-word",
                  }}
                >
                  {renderActivityText(item.text)}
                </span>
              </div>
            </div>
          ))}

          {hiddenCount > 0 && (
            <button
              type="button"
              onClick={() => setVisibleActivityCount((n) => n + 10)}
              style={{
                alignSelf: "flex-start",
                padding: "4px 0",
                border: "none",
                background: "transparent",
                color: "var(--text-placeholder)",
                fontSize: 11,
                fontWeight: 500,
                cursor: "pointer",
              }}
            >
              Show {hiddenCount} more
            </button>
          )}

          {sortedActivity.length === 0 && (
            <span style={{ fontSize: 11, color: "var(--text-placeholder)", fontStyle: "italic" }}>
              No activity yet.
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

/* ── Main page ────────────────────────────────────────────────── */

export type FeatureOption = { id: string; title: string };

export default function BoardClient({ initialTickets, features = [], team = [] }: { initialTickets: Ticket[]; features?: FeatureOption[]; team?: TeamMember[] }) {
  const [tickets, setTickets] = useState<Ticket[]>(initialTickets);

  // Feature lookup maps: id→title and title→id
  const featureIdToName = useMemo(() => {
    const m = new Map<string, string>();
    for (const f of features) m.set(f.id, f.title);
    return m;
  }, [features]);
  const featureNameToId = useMemo(() => {
    const m = new Map<string, string>();
    for (const f of features) m.set(f.title, f.id);
    return m;
  }, [features]);

  const teamNameMap = useMemo(() => {
    const m = new Map<string, string>();
    for (const t of team) m.set(t.id, t.name);
    return m;
  }, [team]);

  // Drag state
  const [draggedId, setDraggedId] = useState<string | null>(null);
  const [dragOverColumn, setDragOverColumn] = useState<TicketStatus | null>(null);

  // Filters
  const [filters, setFilters] = useState<Filters>({});
  const [openFilter, setOpenFilter] = useState<FilterKey | null>(null);
  const filterRef = useRef<HTMLDivElement>(null);

  // Modal
  const [showModal, setShowModal] = useState(false);

  // Selected ticket (detail sidebar)
  const [selectedTicketId, setSelectedTicketId] = useState<string | null>(null);

  // Close filter dropdown on outside click
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

  // ── Push header content into global header ──
  const { setContent } = useHeaderContent();
  const toggleFilterRef = useRef((key: FilterKey, value: string) => {});
  const setOpenFilterRef = useRef(setOpenFilter);
  const setShowModalRef = useRef(setShowModal);
  const handleRefreshRef = useRef(() => {});

  useEffect(() => {
    setContent(
      <>
        <h1 style={{ fontSize: 16, fontWeight: 700, color: "var(--foreground)", marginTop: 0, marginRight: 12, marginBottom: 0, marginLeft: 0, whiteSpace: "nowrap" }}>
          Board
        </h1>

        {/* Filter pills */}
        <div ref={filterRef} style={{ display: "flex", gap: 6, whiteSpace: "nowrap" }}>
          {FILTER_PILLS.map((pill) => {
            const isActive = !!filters[pill.key];
            const isOpen = openFilter === pill.key;
            return (
              <div key={pill.key} style={{ position: "relative" }}>
                <button
                  onClick={() =>
                    setOpenFilterRef.current(isOpen ? null : pill.key)
                  }
                  style={{
                    padding: "5px 12px",
                    borderRadius: 8,
                    border: `1px solid ${isActive ? "rgba(140, 231, 210, 0.3)" : "var(--card-border)"}`,
                    background: isActive
                      ? "rgba(140, 231, 210, 0.08)"
                      : "var(--input-bg)",
                    color: isActive
                      ? "#8CE7D2"
                      : "var(--muted)",
                    fontSize: 11,
                    fontWeight: 500,
                    cursor: "pointer",
                    fontFamily: "inherit",
                    whiteSpace: "nowrap",
                  }}
                >
                  {pill.label}
                  {isActive && (
                    <span style={{ marginLeft: 4, opacity: 0.6 }}>
                      {pill.key === "assignee" ? (teamNameMap.get(filters[pill.key]!) ?? filters[pill.key]) : filters[pill.key]}
                    </span>
                  )}
                </button>
                {isOpen && (
                  <FilterDropdown
                    options={uniqueValues(tickets, pill.key, featureIdToName)}
                    active={filters[pill.key]}
                    onSelect={(v) => toggleFilterRef.current(pill.key, v)}
                    labelMap={pill.key === "assignee" ? teamNameMap : undefined}
                  />
                )}
              </div>
            );
          })}
        </div>

        <div style={{ flex: 1 }} />

        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          {/* Refresh */}
          <button
            onClick={() => handleRefreshRef.current()}
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              width: 30,
              height: 30,
              borderRadius: 8,
              border: "1px solid var(--card-border)",
              background: "var(--input-bg)",
              color: "var(--muted)",
              cursor: "pointer",
              fontSize: 14,
            }}
            title="Reset board"
          >
            ↻
          </button>

          {/* + New Ticket */}
          <button
            onClick={() => setShowModalRef.current(true)}
            style={{
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
            + New Ticket
          </button>
        </div>
      </>
    );
    return () => setContent(null);
  }, [filters, openFilter, tickets, featureIdToName, teamNameMap, setContent]);

  // ── Drag handlers ──

  const handleDragStart = useCallback((e: React.DragEvent, ticketId: string) => {
    e.dataTransfer.setData("text/plain", ticketId);
    e.dataTransfer.effectAllowed = "move";
    setDraggedId(ticketId);
  }, []);

  const handleDragOver = useCallback(
    (e: React.DragEvent, columnId: TicketStatus) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
      if (dragOverColumn !== columnId) setDragOverColumn(columnId);
    },
    [dragOverColumn],
  );

  const handleDragLeave = useCallback(() => {
    setDragOverColumn(null);
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent, targetStatus: TicketStatus) => {
      e.preventDefault();
      const ticketId = e.dataTransfer.getData("text/plain");
      setDragOverColumn(null);
      setDraggedId(null);
      // Optimistic update, then persist
      setTickets((prev) =>
        prev.map((t) =>
          t.id === ticketId ? { ...t, status: targetStatus } : t,
        ),
      );
      apiUpdateTicket(ticketId, { status: targetStatus });
    },
    [],
  );

  // ── Filter handlers ──

  const toggleFilter = useCallback((key: FilterKey, value: string) => {
    setFilters((prev) => {
      if (prev[key] === value) {
        const next = { ...prev };
        delete next[key];
        return next;
      }
      return { ...prev, [key]: value };
    });
    setOpenFilter(null);
  }, []);

  const handleRefresh = useCallback(async () => {
    setFilters({});
    const remote = await fetchTickets();
    setTickets(remote);
  }, []);

  // ── New ticket ──

  const handleNewTicket = useCallback(
    async (data: Omit<Ticket, "id" | "createdAt">) => {
      const created = await apiCreateTicket(data);
      if (created) {
        setTickets((prev) => [created, ...prev]);
      }
      setShowModal(false);
    },
    [],
  );

  // Keep header refs current
  toggleFilterRef.current = toggleFilter;
  setOpenFilterRef.current = setOpenFilter;
  setShowModalRef.current = setShowModal;
  handleRefreshRef.current = handleRefresh;

  // ── Update ticket (for subtask toggling etc.) ──

  const handleUpdateTicket = useCallback((updated: Ticket) => {
    // Optimistic update, then persist
    setTickets((prev) =>
      prev.map((t) => (t.id === updated.id ? updated : t)),
    );
    apiUpdateTicket(updated.id, updated);
  }, []);

  // ── Derived ──

  const getColumnTickets = (status: TicketStatus) =>
    tickets.filter((t) => t.status === status && matchesFilters(t, filters, featureNameToId));

  const activeFilterCount = Object.keys(filters).length;
  const selectedTicket = selectedTicketId ? tickets.find((t) => t.id === selectedTicketId) ?? null : null;

  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
      }}
    >
      {/* ── Columns ────────────────────────────────────────────── */}
      <div
        style={{
          display: "flex",
          gap: 10,
          flex: 1,
          minHeight: 0,
          overflowX: "auto",
          overflowY: "hidden",
          padding: "16px 20px 20px",
        }}
      >
        {COLUMNS.map((col) => {
          const colTickets = getColumnTickets(col.id);
          const isDragTarget = dragOverColumn === col.id;
          const isDone = col.id === "done";

          return (
            <div
              key={col.id}
              onDragOver={(e) => handleDragOver(e, col.id)}
              onDragLeave={handleDragLeave}
              onDrop={(e) => handleDrop(e, col.id)}
              style={{
                width: 310,
                minWidth: 280,
                height: "100%",
                flexShrink: 0,
                display: "flex",
                flexDirection: "column",
                borderRadius: 14,
                background: "var(--card)",
                border: `1px solid ${isDragTarget ? "rgba(140, 231, 210, 0.2)" : "var(--card-border)"}`,
                transition: "border-color 0.15s ease",
                overflow: "hidden",
              }}
            >
              {/* Column header */}
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  padding: "12px 14px",
                  background: "var(--card)",
                  borderBottom: "1px solid var(--divider)",
                }}
              >
                <span
                  style={{
                    width: 7,
                    height: 7,
                    borderRadius: "50%",
                    background: col.dotColor,
                    flexShrink: 0,
                  }}
                />
                <span
                  style={{
                    fontSize: 12,
                    fontWeight: 600,
                    color: "var(--foreground)",
                    flex: 1,
                  }}
                >
                  {col.label}
                </span>
                <span
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    minWidth: 20,
                    height: 18,
                    borderRadius: 9,
                    background: col.dotColor + "1A",
                    fontSize: 10,
                    fontFamily: "var(--font-mono, ui-monospace, monospace)",
                    fontWeight: 600,
                    color: "var(--text-quaternary)",
                    padding: "0 6px",
                  }}
                >
                  {colTickets.length}
                </span>
              </div>

              {/* Cards */}
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: 10,
                  padding: 10,
                  flex: 1,
                  minHeight: 0,
                  overflowY: "auto",
                }}
              >
                {colTickets.map((ticket) => (
                  <TicketCard
                    key={ticket.id}
                    ticket={ticket}
                    isDone={isDone}
                    isDragging={draggedId === ticket.id}
                    isSelected={selectedTicketId === ticket.id}
                    featureName={ticket.featureId ? featureIdToName.get(ticket.featureId) : undefined}
                    team={team}
                    onDragStart={handleDragStart}
                    onClick={() => setSelectedTicketId(ticket.id)}
                  />
                ))}
              </div>
            </div>
          );
        })}
      </div>

      {/* ── Detail sidebar ─────────────────────────────────────── */}
      {selectedTicket && (
        <TicketDetailSidebar
          ticket={selectedTicket}
          onClose={() => setSelectedTicketId(null)}
          onUpdateTicket={handleUpdateTicket}
          featureName={selectedTicket.featureId ? featureIdToName.get(selectedTicket.featureId) : undefined}
          features={features}
          team={team}
        />
      )}

      {/* ── New Ticket Modal ───────────────────────────────────── */}
      {showModal && (
        <NewTicketModal
          onClose={() => setShowModal(false)}
          onSave={handleNewTicket}
          team={team}
        />
      )}
    </div>
  );
}
