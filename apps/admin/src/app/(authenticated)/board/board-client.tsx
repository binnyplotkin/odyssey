"use client";

import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import {
  COLUMNS,
  DOMAIN_COLORS,
  PRIORITY_DOT,
} from "@/data/board";
import type {
  Ticket,
  TicketStatus,
  TicketDomain,
  TicketPriority,
} from "@/data/board";

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

/* ── Sub-components ───────────────────────────────────────────── */

function AvatarBubble({ initial }: { initial: string }) {
  return (
    <span
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        width: 18,
        height: 18,
        borderRadius: "50%",
        background: "rgba(139, 126, 192, 0.2)",
        color: "#8B7EB5",
        fontSize: 8,
        fontWeight: 600,
        flexShrink: 0,
      }}
    >
      {initial}
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
  onDragStart,
  onClick,
}: {
  ticket: Ticket;
  isDone: boolean;
  isDragging: boolean;
  isSelected: boolean;
  featureName?: string;
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
        background: isSelected ? "rgba(59, 130, 246, 0.08)" : "rgba(255, 255, 255, 0.03)",
        border: isSelected
          ? "1.5px solid rgba(59, 130, 246, 0.4)"
          : "1px solid rgba(255, 255, 255, 0.06)",
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
            color: "var(--foreground, #fff)",
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
            color: "var(--muted, rgba(255,255,255,0.35))",
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
          borderTop: "1px solid rgba(255, 255, 255, 0.04)",
        }}
      >
        {ticket.assignee && <AvatarBubble initial={ticket.assignee} />}
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
}: {
  options: string[];
  active: string | undefined;
  onSelect: (value: string) => void;
}) {
  return (
    <div
      style={{
        position: "absolute",
        top: "calc(100% + 6px)",
        left: 0,
        minWidth: 140,
        background: "var(--panel, #0f1117)",
        border: "1px solid rgba(255, 255, 255, 0.1)",
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
                : "var(--foreground, rgba(255,255,255,0.7))",
            fontSize: 11,
            fontFamily: "var(--font-mono, ui-monospace, monospace)",
            textAlign: "left",
          }}
        >
          {opt}
        </button>
      ))}
    </div>
  );
}

function NewTicketModal({
  onClose,
  onSave,
}: {
  onClose: () => void;
  onSave: (ticket: Omit<Ticket, "id" | "createdAt">) => void;
}) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [status, setStatus] = useState<TicketStatus>("backlog");
  const [domain, setDomain] = useState<TicketDomain | "">("");
  const [priority, setPriority] = useState<TicketPriority | "">("");
  const [assignee, setAssignee] = useState("B");

  const inputStyle: React.CSSProperties = {
    width: "100%",
    padding: "8px 10px",
    borderRadius: 6,
    border: "1px solid rgba(255, 255, 255, 0.1)",
    background: "rgba(255, 255, 255, 0.04)",
    color: "var(--foreground, #fff)",
    fontSize: 12,
    fontFamily: "inherit",
    outline: "none",
  };

  const labelStyle: React.CSSProperties = {
    fontSize: 10,
    fontWeight: 600,
    letterSpacing: "0.08em",
    textTransform: "uppercase",
    color: "var(--muted, rgba(255,255,255,0.4))",
    marginBottom: 4,
  };

  const selectStyle: React.CSSProperties = {
    ...inputStyle,
    appearance: "none",
    cursor: "pointer",
  };

  const handleSubmit = () => {
    if (!title.trim()) return;
    onSave({
      title: title.trim(),
      description: description.trim() || undefined,
      status,
      domain: domain || undefined,
      priority: priority || undefined,
      assignee: assignee.trim() || undefined,
      phase: "audio-engine",
    });
  };

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
          width: 420,
          background: "var(--panel, #0f1117)",
          border: "1px solid rgba(255, 255, 255, 0.1)",
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
            color: "var(--foreground, #fff)",
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
          <div style={{ flex: 1, display: "flex", flexDirection: "column" }}>
            <span style={labelStyle}>Status</span>
            <select
              style={selectStyle}
              value={status}
              onChange={(e) => setStatus(e.target.value as TicketStatus)}
            >
              {COLUMNS.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.label}
                </option>
              ))}
            </select>
          </div>
          <div style={{ flex: 1, display: "flex", flexDirection: "column" }}>
            <span style={labelStyle}>Domain</span>
            <select
              style={selectStyle}
              value={domain}
              onChange={(e) => setDomain(e.target.value as TicketDomain | "")}
            >
              <option value="">None</option>
              {(Object.keys(DOMAIN_COLORS) as TicketDomain[]).map((d) => (
                <option key={d} value={d}>
                  {d}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Row: Priority + Assignee */}
        <div style={{ display: "flex", gap: 12 }}>
          <div style={{ flex: 1, display: "flex", flexDirection: "column" }}>
            <span style={labelStyle}>Priority</span>
            <select
              style={selectStyle}
              value={priority}
              onChange={(e) => setPriority(e.target.value as TicketPriority | "")}
            >
              <option value="">None</option>
              <option value="P1">P1</option>
              <option value="P2">P2</option>
              <option value="P3">P3</option>
            </select>
          </div>
          <div style={{ flex: 1, display: "flex", flexDirection: "column" }}>
            <span style={labelStyle}>Assignee</span>
            <input
              style={inputStyle}
              value={assignee}
              onChange={(e) => setAssignee(e.target.value)}
              placeholder="Initial (e.g. B)"
              maxLength={3}
            />
          </div>
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
              border: "1px solid rgba(255, 255, 255, 0.1)",
              background: "none",
              color: "var(--muted, rgba(255,255,255,0.5))",
              fontSize: 12,
              fontWeight: 500,
              cursor: "pointer",
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

function TicketDetailSidebar({
  ticket,
  onClose,
  onUpdateTicket,
  featureName,
}: {
  ticket: Ticket;
  onClose: () => void;
  onUpdateTicket: (updated: Ticket) => void;
  featureName?: string;
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

  const col = COLUMNS.find((c) => c.id === ticket.status);
  const doneCount = ticket.subtasks?.filter((s) => s.done).length ?? 0;
  const totalCount = ticket.subtasks?.length ?? 0;
  const progress = totalCount > 0 ? (doneCount / totalCount) * 100 : 0;

  const labelStyle: React.CSSProperties = {
    width: 110,
    flexShrink: 0,
    fontSize: 12,
    color: "rgba(255, 255, 255, 0.35)",
  };

  const rowStyle: React.CSSProperties = {
    display: "flex",
    alignItems: "center",
    padding: "7px 0",
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
        background: "var(--background, #0C0E14)",
        borderLeft: "1px solid rgba(255, 255, 255, 0.1)",
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
            background: "rgba(255, 255, 255, 0.15)",
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
          borderBottom: "1px solid rgba(255, 255, 255, 0.08)",
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
            background: "rgba(255, 255, 255, 0.05)",
            border: "1px solid rgba(255, 255, 255, 0.08)",
            color: "rgba(255, 255, 255, 0.4)",
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
          <h2
            style={{
              margin: 0,
              fontSize: 17,
              fontWeight: 600,
              color: "rgba(255, 255, 255, 0.88)",
              lineHeight: 1.35,
            }}
          >
            {ticket.title}
          </h2>
          {ticket.description && (
            <p
              style={{
                margin: 0,
                fontSize: 13,
                color: "rgba(255, 255, 255, 0.5)",
                lineHeight: 1.55,
              }}
            >
              {ticket.description}
            </p>
          )}
        </div>

        {/* Metadata */}
        <div
          style={{
            padding: "12px 20px",
            borderTop: "1px solid rgba(255, 255, 255, 0.06)",
            borderBottom: "1px solid rgba(255, 255, 255, 0.06)",
            display: "flex",
            flexDirection: "column",
          }}
        >
          {ticket.assignee && (
            <div style={rowStyle}>
              <span style={labelStyle}>Assignee</span>
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <AvatarBubble initial={ticket.assignee} />
                <span style={{ fontSize: 12, color: "rgba(255, 255, 255, 0.7)" }}>
                  {ticket.assignee === "B" ? "Binny" : ticket.assignee}
                </span>
              </div>
            </div>
          )}
          {ticket.priority && (
            <div style={rowStyle}>
              <span style={labelStyle}>Priority</span>
              <PriorityTag priority={ticket.priority} />
            </div>
          )}
          {ticket.domain && (
            <div style={rowStyle}>
              <span style={labelStyle}>Domain</span>
              <DomainTag domain={ticket.domain} />
            </div>
          )}
          {featureName && (
            <div style={rowStyle}>
              <span style={labelStyle}>Feature</span>
              <span
                style={{
                  fontSize: 11,
                  fontFamily: "var(--font-mono, ui-monospace, monospace)",
                  fontWeight: 500,
                  color: "rgba(59, 130, 246, 0.7)",
                  background: "rgba(59, 130, 246, 0.08)",
                  borderRadius: 4,
                  padding: "2px 8px",
                }}
              >
                {featureName}
              </span>
            </div>
          )}
          {ticket.phase && (
            <div style={rowStyle}>
              <span style={labelStyle}>Phase</span>
              <span style={{ fontSize: 12, color: "rgba(255, 255, 255, 0.55)" }}>
                {ticket.phase}
              </span>
            </div>
          )}
          <div style={rowStyle}>
            <span style={labelStyle}>Created</span>
            <span style={{ fontSize: 12, color: "rgba(255, 255, 255, 0.45)" }}>
              {ticket.createdAt}
            </span>
          </div>
        </div>

        {/* Subtasks */}
        {ticket.subtasks && ticket.subtasks.length > 0 && (
          <div style={{ padding: "16px 20px", display: "flex", flexDirection: "column", gap: 10 }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <span style={{ fontSize: 12, fontWeight: 600, color: "rgba(255, 255, 255, 0.6)" }}>
                Subtasks
              </span>
              <span style={{ fontSize: 11, color: "rgba(255, 255, 255, 0.25)" }}>
                {doneCount} / {totalCount}
              </span>
            </div>

            {/* Progress bar */}
            <div style={{ width: "100%", height: 3, borderRadius: 2, background: "rgba(255, 255, 255, 0.06)" }}>
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
                    background: st.done ? "rgba(59, 130, 246, 0.15)" : "rgba(255, 255, 255, 0.04)",
                    border: st.done ? "none" : "1px solid rgba(255, 255, 255, 0.12)",
                    color: "rgba(59, 130, 246, 0.7)",
                  }}
                >
                  {st.done ? "✓" : ""}
                </span>
                <span
                  style={{
                    fontSize: 12,
                    color: st.done ? "rgba(255, 255, 255, 0.35)" : "rgba(255, 255, 255, 0.6)",
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
        {ticket.activity && ticket.activity.length > 0 && (
          <div
            style={{
              padding: "16px 20px",
              borderTop: "1px solid rgba(255, 255, 255, 0.06)",
              display: "flex",
              flexDirection: "column",
              gap: 12,
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <span style={{ fontSize: 12, fontWeight: 600, color: "rgba(255, 255, 255, 0.6)" }}>
                Activity
              </span>
            </div>

            {ticket.activity.map((item) => (
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
                  {item.author}
                </span>
                <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <span style={{ fontSize: 11, fontWeight: 500, color: "rgba(255, 255, 255, 0.6)" }}>
                      {item.author === "B" ? "Binny" : item.author === "S" ? "System" : item.author}
                    </span>
                    <span style={{ fontSize: 11, color: "rgba(255, 255, 255, 0.2)" }}>
                      {item.timestamp}
                    </span>
                  </div>
                  <span
                    style={{
                      fontSize: 12,
                      color: item.type === "system" ? "rgba(255, 255, 255, 0.35)" : "rgba(255, 255, 255, 0.45)",
                      lineHeight: 1.5,
                      fontStyle: item.type === "system" ? "italic" : "normal",
                    }}
                  >
                    {item.text}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Comment input pinned to bottom */}
      <div style={{ padding: "12px 20px", borderTop: "1px solid rgba(255, 255, 255, 0.06)", flexShrink: 0 }}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            padding: "10px 12px",
            borderRadius: 8,
            background: "rgba(255, 255, 255, 0.03)",
            border: "1px solid rgba(255, 255, 255, 0.08)",
          }}
        >
          <span style={{ fontSize: 12, color: "rgba(255, 255, 255, 0.2)" }}>
            Add a comment…
          </span>
        </div>
      </div>
    </div>
  );
}

/* ── Main page ────────────────────────────────────────────────── */

export type FeatureOption = { id: string; title: string };

export default function BoardClient({ initialTickets, features = [] }: { initialTickets: Ticket[]; features?: FeatureOption[] }) {
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
      {/* ── Header bar ─────────────────────────────────────────── */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 12,
          padding: "14px 20px",
          borderBottom: "1px solid var(--border, rgba(255,255,255,0.06))",
          flexShrink: 0,
        }}
      >
        <h1
          style={{
            fontSize: 18,
            fontWeight: 700,
            color: "var(--foreground, #fff)",
            margin: 0,
            marginRight: 8,
          }}
        >
          Board
        </h1>

        {/* Filter pills */}
        <div ref={filterRef} style={{ display: "flex", gap: 6 }}>
          {FILTER_PILLS.map((pill) => {
            const isActive = !!filters[pill.key];
            const isOpen = openFilter === pill.key;
            return (
              <div key={pill.key} style={{ position: "relative" }}>
                <button
                  onClick={() =>
                    setOpenFilter(isOpen ? null : pill.key)
                  }
                  style={{
                    padding: "5px 12px",
                    borderRadius: 8,
                    border: `1px solid ${isActive ? "rgba(140, 231, 210, 0.3)" : "rgba(255, 255, 255, 0.08)"}`,
                    background: isActive
                      ? "rgba(140, 231, 210, 0.08)"
                      : "rgba(255, 255, 255, 0.05)",
                    color: isActive
                      ? "#8CE7D2"
                      : "var(--muted, rgba(255,255,255,0.45))",
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
                      {filters[pill.key]}
                    </span>
                  )}
                </button>
                {isOpen && (
                  <FilterDropdown
                    options={uniqueValues(tickets, pill.key, featureIdToName)}
                    active={filters[pill.key]}
                    onSelect={(v) => toggleFilter(pill.key, v)}
                  />
                )}
              </div>
            );
          })}
        </div>

        <div style={{ flex: 1 }} />

        {/* Refresh */}
        <button
          onClick={handleRefresh}
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            width: 30,
            height: 30,
            borderRadius: 8,
            border: "1px solid rgba(255, 255, 255, 0.08)",
            background: "rgba(255, 255, 255, 0.05)",
            color: "var(--muted, rgba(255,255,255,0.45))",
            cursor: "pointer",
            fontSize: 14,
          }}
          title="Reset board"
        >
          ↻
        </button>

        {/* + New Ticket */}
        <button
          onClick={() => setShowModal(true)}
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
                background: "rgba(255, 255, 255, 0.02)",
                border: `1px solid ${isDragTarget ? "rgba(140, 231, 210, 0.2)" : "rgba(255, 255, 255, 0.06)"}`,
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
                  background: "rgba(255, 255, 255, 0.03)",
                  borderBottom: "1px solid rgba(255, 255, 255, 0.06)",
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
                    color: "var(--foreground, #fff)",
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
                    color: "rgba(255, 255, 255, 0.35)",
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
        />
      )}

      {/* ── New Ticket Modal ───────────────────────────────────── */}
      {showModal && (
        <NewTicketModal
          onClose={() => setShowModal(false)}
          onSave={handleNewTicket}
        />
      )}
    </div>
  );
}
