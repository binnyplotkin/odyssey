"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import type { RoadmapVersion, RoadmapFeature } from "@/lib/roadmap";
import { versionToGantt, computeTimelineRange } from "@/lib/roadmap";
import GanttView from "@/components/gantt-view";
import type { GanttBarChange, GanttTicketReorder } from "@/components/gantt-view";
import { useHeaderContent } from "@/components/header-context";
import {
  DndContext,
  closestCenter,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  verticalListSortingStrategy,
  useSortable,
  arrayMove,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

type RoadmapTab = "gantt" | "versions" | "features";

type FeatureTicket = {
  id: string;
  title: string;
  status: string;
  domain: string | null;
  priority: string | null;
  assignee: string | null;
  sortOrder: number;
};

/* ── Sidebar constants ───────────────────────────────────────── */

const SIDEBAR_MIN = 340;
const SIDEBAR_MAX = 640;
const SIDEBAR_DEFAULT = 420;
const SIDEBAR_KEY = "odyssey-gantt-sidebar-width";

/* ── Team members ───────────────────────────────────────────── */

export type TeamMember = { id: string; name: string; email: string; image: string | null };

const AVATAR_COLORS = ["#8B7EB5", "#5B9E82", "#5B7FB5", "#C8875A", "#C45C5C", "#5A9E82"];

const FEATURE_COLORS = [
  "#7C5CFC", "#5B7FB5", "#5B9E82", "#C8875A", "#C45C5C",
  "#8B7EB5", "#3B82F6", "#8CE7D2", "#F59E0B", "#EF4444",
  "#A855F7", "#EC4899", "#14B8A6", "#64748B", "#F97316",
];

function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length >= 2) return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  return name.slice(0, 2).toUpperCase();
}

function memberColor(index: number): string {
  return AVATAR_COLORS[index % AVATAR_COLORS.length];
}

function avatarBadge(
  assignee: string | null,
  onSelect: (key: string | null) => void,
  menuOpen: string | null,
  setMenuOpen: (id: string | null) => void,
  rowId: string,
  team: TeamMember[],
) {
  const memberIdx = team.findIndex((m) => m.id === assignee);
  const member = memberIdx >= 0 ? team[memberIdx] : null;
  const isOpen = menuOpen === rowId;

  return (
    <div style={{ position: "relative" }}>
      <button
        onClick={(e) => { e.stopPropagation(); setMenuOpen(isOpen ? null : rowId); }}
        style={{
          width: 24, height: 24, borderRadius: "50%",
          display: "flex", alignItems: "center", justifyContent: "center",
          background: member ? memberColor(memberIdx) : "rgba(255, 255, 255, 0.08)",
          border: member ? "none" : "1.5px dashed rgba(255, 255, 255, 0.2)",
          color: member ? "#fff" : "rgba(255, 255, 255, 0.3)",
          fontSize: 10, fontWeight: 600, cursor: "pointer",
          fontFamily: "inherit", padding: 0, lineHeight: 1,
          transition: "all 0.15s ease",
          flexShrink: 0, overflow: "hidden",
        }}
        title={member ? member.name : "Unassigned"}
      >
        {member ? getInitials(member.name) : "+"}
      </button>
      {isOpen && (
        <div
          style={{
            position: "absolute", top: "100%", right: 0, marginTop: 4,
            background: "rgba(30, 30, 34, 0.98)", border: "1px solid rgba(255, 255, 255, 0.1)",
            borderRadius: 8, padding: 4, zIndex: 50, minWidth: 160,
            boxShadow: "0 8px 24px rgba(0, 0, 0, 0.4)",
          }}
          onClick={(e) => e.stopPropagation()}
        >
          {team.map((m, i) => (
            <button
              key={m.id}
              onClick={() => { onSelect(m.id); setMenuOpen(null); }}
              style={{
                display: "flex", alignItems: "center", gap: 8,
                width: "100%", padding: "6px 10px", border: "none",
                background: assignee === m.id ? "rgba(255, 255, 255, 0.08)" : "transparent",
                borderRadius: 5, cursor: "pointer", fontFamily: "inherit",
                color: "rgba(255, 255, 255, 0.7)", fontSize: 12,
              }}
            >
              <span
                style={{
                  width: 20, height: 20, borderRadius: "50%",
                  display: "flex", alignItems: "center", justifyContent: "center",
                  background: memberColor(i), color: "#fff", fontSize: 9, fontWeight: 600,
                  overflow: "hidden", flexShrink: 0,
                }}
              >
                {getInitials(m.name)}
              </span>
              {m.name}
            </button>
          ))}
          {assignee && (
            <>
              <div style={{ height: 1, background: "rgba(255, 255, 255, 0.06)", margin: "4px 0" }} />
              <button
                onClick={() => { onSelect(null); setMenuOpen(null); }}
                style={{
                  display: "flex", alignItems: "center", gap: 8,
                  width: "100%", padding: "6px 10px", border: "none",
                  background: "transparent", borderRadius: 5, cursor: "pointer",
                  fontFamily: "inherit", color: "rgba(255, 255, 255, 0.4)", fontSize: 12,
                }}
              >
                Unassign
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}

/* ── Status helpers ──────────────────────────────────────────── */

function statusDot(status: string) {
  if (status === "done") {
    return (
      <span
        style={{
          width: 8, height: 8, borderRadius: "50%",
          background: "var(--success, #8CE7D2)", flexShrink: 0,
        }}
      />
    );
  }
  if (status === "active") {
    return (
      <span
        style={{
          width: 8, height: 8, borderRadius: "50%",
          background: "var(--accent, #8fd1cb)",
          boxShadow: "0 0 6px var(--accent, #8fd1cb)",
          flexShrink: 0,
          animation: "pulse-dot 2s ease-in-out infinite",
        }}
      />
    );
  }
  return (
    <span
      style={{
        width: 8, height: 8, borderRadius: "50%",
        border: "1.5px solid var(--muted, rgba(255,255,255,0.3))", flexShrink: 0,
      }}
    />
  );
}

function statusBadge(status: string) {
  const map: Record<string, { label: string; bg: string; color: string }> = {
    done: { label: "Complete", bg: "rgba(140, 231, 210, 0.15)", color: "var(--success, #8CE7D2)" },
    active: { label: "In Progress", bg: "rgba(143, 209, 203, 0.15)", color: "var(--accent, #8fd1cb)" },
    planned: { label: "Upcoming", bg: "rgba(255, 255, 255, 0.06)", color: "var(--muted, rgba(255,255,255,0.5))" },
  };
  const s = map[status] ?? map.planned;
  return (
    <span
      style={{
        display: "inline-block", padding: "0.15rem 0.6rem", borderRadius: 9999,
        fontSize: "0.7rem", fontWeight: 600, letterSpacing: "0.06em",
        textTransform: "uppercase", background: s.bg, color: s.color,
      }}
    >
      {s.label}
    </span>
  );
}

/* ── Tabs ────────────────────────────────────────────────────── */

const TABS: { id: RoadmapTab; label: string }[] = [
  { id: "gantt", label: "Gantt" },
  { id: "versions", label: "Versions" },
  { id: "features", label: "Features" },
];

/* ── Sortable ticket row ─────────────────────────────────────── */

function SortableTicketRow({
  ticket,
  team,
  assigneeMenuOpen,
  setAssigneeMenuOpen,
  onAssigneeChange,
}: {
  ticket: FeatureTicket;
  team: TeamMember[];
  assigneeMenuOpen: string | null;
  setAssigneeMenuOpen: (id: string | null) => void;
  onAssigneeChange: (ticketId: string, assignee: string | null) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: ticket.id });

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
    display: "flex",
    alignItems: "center",
    gap: 8,
    padding: "8px 10px",
    borderRadius: 6,
    background: isDragging ? "rgba(59, 130, 246, 0.08)" : "rgba(255, 255, 255, 0.03)",
    border: isDragging ? "1px solid rgba(59, 130, 246, 0.2)" : "1px solid rgba(255, 255, 255, 0.05)",
  };

  return (
    <div ref={setNodeRef} style={style}>
      {/* Drag handle */}
      <span
        {...attributes}
        {...listeners}
        style={{
          cursor: "grab",
          color: "rgba(255, 255, 255, 0.2)",
          fontSize: 10,
          flexShrink: 0,
          lineHeight: 1,
          touchAction: "none",
        }}
      >
        ⠿
      </span>
      {statusDot(ticket.status === "done" ? "done" : ticket.status === "in-progress" || ticket.status === "review" ? "active" : "planned")}
      <span style={{ flex: 1, fontSize: 12, color: "rgba(255, 255, 255, 0.7)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
        {ticket.title}
      </span>
      {avatarBadge(
        ticket.assignee,
        (key) => onAssigneeChange(ticket.id, key),
        assigneeMenuOpen,
        setAssigneeMenuOpen,
        `ticket-${ticket.id}`,
        team,
      )}
      <span style={{ fontSize: 10, color: "rgba(255, 255, 255, 0.3)", textTransform: "capitalize" }}>
        {ticket.status}
      </span>
    </div>
  );
}

/* ── Component ───────────────────────────────────────────────── */

export default function RoadmapClient({ versions: initialVersions, team = [] }: { versions: RoadmapVersion[]; team?: TeamMember[] }) {
  const [versions, setVersions] = useState(initialVersions);
  const [tab, setTab] = useState<RoadmapTab>("gantt");
  const [expanded, setExpanded] = useState<string | null>(versions[0]?.id ?? null);

  // Sidebar state
  const [selectedFeatureId, setSelectedFeatureId] = useState<string | null>(null);
  const [selectedVersionId, setSelectedVersionId] = useState<string | null>(null);
  const [selectedTicketId, setSelectedTicketId] = useState<string | null>(null);
  const [selectedTicket, setSelectedTicket] = useState<{
    id: string; title: string; description: string | null; status: string;
    domain: string | null; priority: string | null; assignee: string | null;
    startDate: string | null; endDate: string | null;
  } | null>(null);
  const [ticketLoading, setTicketLoading] = useState(false);
  const [sidebarWidth, setSidebarWidth] = useState(() => {
    if (typeof window === "undefined") return SIDEBAR_DEFAULT;
    const saved = localStorage.getItem(SIDEBAR_KEY);
    return saved ? Math.max(SIDEBAR_MIN, Math.min(SIDEBAR_MAX, Number(saved))) : SIDEBAR_DEFAULT;
  });
  const [featureTickets, setFeatureTickets] = useState<FeatureTicket[]>([]);
  const [ticketsLoading, setTicketsLoading] = useState(false);
  const [assigneeMenuOpen, setAssigneeMenuOpen] = useState<string | null>(null);
  const [colorMenuOpen, setColorMenuOpen] = useState<string | null>(null);

  // Close menus on outside click
  useEffect(() => {
    if (!assigneeMenuOpen && !colorMenuOpen) return;
    const handler = () => { setAssigneeMenuOpen(null); setColorMenuOpen(null); };
    document.addEventListener("click", handler);
    return () => document.removeEventListener("click", handler);
  }, [assigneeMenuOpen, colorMenuOpen]);

  // Find selected feature from versions data
  const selectedFeature: (RoadmapFeature & { versionTag: string; versionColor: string }) | null =
    selectedFeatureId
      ? versions.flatMap((v) => v.features.map((f) => ({ ...f, versionTag: v.tag, versionColor: v.color }))).find((f) => f.id === selectedFeatureId) ?? null
      : null;

  // Find selected version
  const selectedVersion = selectedVersionId
    ? versions.find((v) => v.id === selectedVersionId) ?? null
    : null;

  // Fetch tickets when feature is selected
  useEffect(() => {
    if (!selectedFeatureId) { setFeatureTickets([]); return; }
    let cancelled = false;
    setTicketsLoading(true);
    fetch(`/api/features/${selectedFeatureId}/tickets`)
      .then((r) => r.json())
      .then((d) => { if (!cancelled) setFeatureTickets(d.tickets ?? []); })
      .catch(() => { if (!cancelled) setFeatureTickets([]); })
      .finally(() => { if (!cancelled) setTicketsLoading(false); });
    return () => { cancelled = true; };
  }, [selectedFeatureId]);

  // Fetch ticket when ticket is selected
  useEffect(() => {
    if (!selectedTicketId) { setSelectedTicket(null); return; }
    let cancelled = false;
    setTicketLoading(true);
    fetch(`/api/tickets/${selectedTicketId}`)
      .then((r) => r.json())
      .then((d) => { if (!cancelled) setSelectedTicket(d.ticket ?? null); })
      .catch(() => { if (!cancelled) setSelectedTicket(null); })
      .finally(() => { if (!cancelled) setTicketLoading(false); });
    return () => { cancelled = true; };
  }, [selectedTicketId]);

  // Resize refs
  const isDragging = useRef(false);
  const startX = useRef(0);
  const startW = useRef(SIDEBAR_DEFAULT);

  const onResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    isDragging.current = true;
    startX.current = e.clientX;
    startW.current = sidebarWidth;
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";

    const onMove = (me: MouseEvent) => {
      if (!isDragging.current) return;
      const dx = startX.current - me.clientX;
      setSidebarWidth(Math.max(SIDEBAR_MIN, Math.min(SIDEBAR_MAX, startW.current + dx)));
    };
    const onUp = () => {
      isDragging.current = false;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
      setSidebarWidth((w) => { localStorage.setItem(SIDEBAR_KEY, String(w)); return w; });
    };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  }, [sidebarWidth]);

  // Feature sidebar update handler
  const updateFeature = useCallback(async (featureId: string, patch: Record<string, unknown>) => {
    // Optimistic update
    setVersions((prev) =>
      prev.map((v) => ({
        ...v,
        features: v.features.map((f) => (f.id === featureId ? { ...f, ...patch } : f)),
      })),
    );
    await fetch(`/api/features/${featureId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });
  }, []);

  // Local-only update (no API call — use for text fields while typing)
  const updateFeatureLocal = useCallback((featureId: string, patch: Record<string, unknown>) => {
    setVersions((prev) =>
      prev.map((v) => ({
        ...v,
        features: v.features.map((f) => (f.id === featureId ? { ...f, ...patch } : f)),
      })),
    );
  }, []);

  // Persist on blur (pairs with updateFeatureLocal for text inputs)
  const persistFeature = useCallback(async (featureId: string, patch: Record<string, unknown>) => {
    await fetch(`/api/features/${featureId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });
  }, []);

  // DnD sensors
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  // Reorder tickets handler
  const handleTicketReorder = useCallback(async (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    const oldIndex = featureTickets.findIndex((t) => t.id === active.id);
    const newIndex = featureTickets.findIndex((t) => t.id === over.id);
    if (oldIndex === -1 || newIndex === -1) return;

    const reordered = arrayMove(featureTickets, oldIndex, newIndex);
    setFeatureTickets(reordered);

    // Update versions state so Gantt reflects new order immediately
    if (selectedFeatureId) {
      const reorderedIds = reordered.map((t) => t.id);
      setVersions((prev) =>
        prev.map((v) => ({
          ...v,
          features: v.features.map((f) => {
            if (f.id !== selectedFeatureId || !f.tickets) return f;
            const sorted = [...f.tickets].sort(
              (a, b) => reorderedIds.indexOf(a.id) - reorderedIds.indexOf(b.id),
            );
            return { ...f, tickets: sorted };
          }),
        })),
      );
    }

    // Persist new sortOrder
    const order = reordered.map((t, i) => ({ id: t.id, sortOrder: i }));
    await fetch("/api/tickets/reorder", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ order }),
    });
  }, [featureTickets, selectedFeatureId]);

  // Ticket sidebar update handler
  const updateTicket = useCallback(async (ticketId: string, patch: Record<string, unknown>) => {
    setFeatureTickets((prev) =>
      prev.map((t) => (t.id === ticketId ? { ...t, ...patch } : t)),
    );
    await fetch(`/api/tickets/${ticketId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });
  }, []);

  // Version sidebar update handlers
  const updateVersion = useCallback(async (versionId: string, patch: Record<string, unknown>) => {
    setVersions((prev) => prev.map((v) => (v.id === versionId ? { ...v, ...patch } : v)));
    await fetch(`/api/versions/${versionId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });
  }, []);

  const updateVersionLocal = useCallback((versionId: string, patch: Record<string, unknown>) => {
    setVersions((prev) => prev.map((v) => (v.id === versionId ? { ...v, ...patch } : v)));
  }, []);

  const persistVersion = useCallback(async (versionId: string, patch: Record<string, unknown>) => {
    await fetch(`/api/versions/${versionId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });
  }, []);

  // Bar drag/resize handler
  const handleBarChange = useCallback(async (change: GanttBarChange) => {
    // Optimistic update
    setVersions((prev) =>
      prev.map((v) => {
        if (change.type === "version" && v.id === change.id) {
          return { ...v, startDate: change.start, endDate: change.end };
        }
        const updatedFeatures = v.features.map((f) => {
          if (change.type === "feature" && f.id === change.id) {
            return { ...f, startDate: change.start, endDate: change.end };
          }
          if (change.type === "ticket" && f.tickets) {
            const updatedTickets = f.tickets.map((t) =>
              t.id === change.id ? { ...t, startDate: change.start, endDate: change.end } : t,
            );
            return { ...f, tickets: updatedTickets };
          }
          return f;
        });
        return { ...v, features: updatedFeatures };
      }),
    );

    // Persist
    let url: string;
    if (change.type === "version") url = `/api/versions/${change.id}`;
    else if (change.type === "feature") url = `/api/features/${change.id}`;
    else url = `/api/tickets/${change.id}`;

    await fetch(url, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ startDate: change.start, endDate: change.end }),
    });
  }, []);

  // Gantt ticket reorder handler
  const handleGanttTicketReorder = useCallback(async (reorder: GanttTicketReorder) => {
    const { featureId, ticketIds } = reorder;

    // Optimistic update — reorder tickets within the feature in versions state
    setVersions((prev) =>
      prev.map((v) => ({
        ...v,
        features: v.features.map((f) => {
          if (f.id !== featureId || !f.tickets) return f;
          const sorted = [...f.tickets].sort(
            (a, b) => ticketIds.indexOf(a.id) - ticketIds.indexOf(b.id),
          );
          return { ...f, tickets: sorted };
        }),
      })),
    );

    // Also update sidebar featureTickets if same feature is open
    if (selectedFeatureId === featureId) {
      setFeatureTickets((prev) => {
        const sorted = [...prev].sort(
          (a, b) => ticketIds.indexOf(a.id) - ticketIds.indexOf(b.id),
        );
        return sorted;
      });
    }

    // Persist
    const order = ticketIds.map((id, i) => ({ id, sortOrder: i }));
    await fetch("/api/tickets/reorder", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ order }),
    });
  }, [selectedFeatureId]);

  // Derived data
  const ganttVersions = versions.map(versionToGantt);
  const timeline = versions.length > 0 ? computeTimelineRange(versions) : null;
  const allFeatures = versions.flatMap((v) => v.features.map((f) => ({ ...f, versionTag: v.tag, versionColor: v.color })));

  const totalFeatures = allFeatures.length;
  const doneFeatures = allFeatures.filter((f) => f.status === "done").length;
  const activeFeatures = allFeatures.filter((f) => f.status === "active").length;

  const tabButtons = (
    <div style={{ display: "flex", gap: 4 }}>
      {TABS.map((t) => (
        <button
          key={t.id}
          onClick={() => setTab(t.id)}
          style={{
            padding: "5px 14px", borderRadius: 8, border: "none",
            background: tab === t.id ? "rgba(140, 231, 210, 0.12)" : "transparent",
            color: tab === t.id ? "#8CE7D2" : "rgba(255, 255, 255, 0.45)",
            fontSize: 12, fontWeight: 500, cursor: "pointer", fontFamily: "inherit",
          }}
        >
          {t.label}
        </button>
      ))}
    </div>
  );

  // ── Push header content into global header ──────────────
  const { setContent } = useHeaderContent();
  const setTabRef = useRef(setTab);
  setTabRef.current = setTab;

  useEffect(() => {
    const onTab = (id: RoadmapTab) => setTabRef.current(id);
    setContent(
      <>
        <h1 style={{ fontSize: 16, fontWeight: 700, color: "var(--foreground, #fff)", margin: 0, marginRight: 12, whiteSpace: "nowrap" }}>
          Roadmap
        </h1>
        <div style={{ display: "flex", gap: 4 }}>
          {TABS.map((t) => (
            <button
              key={t.id}
              onClick={() => onTab(t.id)}
              style={{
                padding: "5px 14px", borderRadius: 8, border: "none",
                background: tab === t.id ? "rgba(140, 231, 210, 0.12)" : "transparent",
                color: tab === t.id ? "#8CE7D2" : "rgba(255, 255, 255, 0.45)",
                fontSize: 12, fontWeight: 500, cursor: "pointer", fontFamily: "inherit",
              }}
            >
              {t.label}
            </button>
          ))}
        </div>
        <div style={{ flex: 1 }} />
        {tab === "gantt" && (
          <>
            <button
              style={{
                padding: "5px 12px", borderRadius: 8,
                border: "1px solid rgba(255, 255, 255, 0.08)",
                background: "rgba(255, 255, 255, 0.05)",
                color: "rgba(255, 255, 255, 0.45)",
                fontSize: 11, cursor: "pointer", fontFamily: "inherit",
              }}
            >
              Phase ▾
            </button>
            <button
              style={{
                padding: "5px 12px", borderRadius: 8,
                border: "1px solid rgba(255, 255, 255, 0.08)",
                background: "rgba(255, 255, 255, 0.05)",
                color: "rgba(255, 255, 255, 0.45)",
                fontSize: 11, cursor: "pointer", fontFamily: "inherit",
              }}
            >
              Status ▾
            </button>
            <button
              style={{
                padding: "5px 14px", borderRadius: 8, border: "none",
                background: "#8CE7D2", color: "#0C0E14",
                fontSize: 11, fontWeight: 600, cursor: "pointer", fontFamily: "inherit",
              }}
            >
              + Version
            </button>
          </>
        )}
      </>
    );
    return () => setContent(null);
  }, [tab, setContent]);

  // ── Gantt tab ──────────────────────────────────────────
  if (tab === "gantt") {
    return (
      <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", overflow: "hidden" }}>
        <div style={{ flex: 1, position: "relative", overflow: "hidden" }}>
          <div style={{ position: "absolute", inset: 0 }}>
            {timeline ? (
              <GanttView
                versions={ganttVersions}
                months={timeline.months}
                timelineStart={timeline.timelineStart}
                timelineEnd={timeline.timelineEnd}
                selectedFeatureId={selectedFeatureId}
                selectedVersionId={selectedVersionId}
                selectedTicketId={selectedTicketId}
                onFeatureClick={(id) => {
                  setSelectedFeatureId(selectedFeatureId === id ? null : id);
                  setSelectedVersionId(null);
                  setSelectedTicketId(null);
                }}
                onVersionClick={(id) => {
                  setSelectedVersionId(selectedVersionId === id ? null : id);
                  setSelectedFeatureId(null);
                  setSelectedTicketId(null);
                }}
                onTicketClick={(id) => {
                  setSelectedTicketId(selectedTicketId === id ? null : id);
                  setSelectedFeatureId(null);
                  setSelectedVersionId(null);
                }}
                onBarChange={handleBarChange}
                onTicketReorder={handleGanttTicketReorder}
              />
            ) : (
              <div style={{ padding: 40, color: "rgba(255,255,255,0.3)", fontSize: 13 }}>No roadmap data yet.</div>
            )}
          </div>

          {/* ── Version detail sidebar ──────────────────── */}
          {selectedVersion && (
            <div
              style={{
                position: "absolute",
                top: 0,
                right: 0,
                bottom: 0,
                width: sidebarWidth,
                display: "flex",
                flexDirection: "column",
                background: "var(--background, #0C0E14)",
                borderLeft: "1px solid rgba(255, 255, 255, 0.1)",
                boxShadow: "-8px 0 32px rgba(0, 0, 0, 0.4)",
                zIndex: 50,
              }}
            >
              {/* Resize handle */}
              <div
                onMouseDown={onResizeStart}
                style={{
                  position: "absolute",
                  left: -3,
                  top: 0,
                  bottom: 0,
                  width: 6,
                  cursor: "col-resize",
                  zIndex: 51,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <div style={{ width: 2, height: 40, borderRadius: 2, background: "rgba(255, 255, 255, 0.15)" }} />
              </div>

              {/* Header */}
              <div
                style={{
                  display: "flex",
                  alignItems: "flex-start",
                  justifyContent: "space-between",
                  padding: "14px 20px",
                  borderBottom: "1px solid rgba(255, 255, 255, 0.08)",
                  flexShrink: 0,
                }}
              >
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
                    <span style={{ width: 8, height: 8, borderRadius: "50%", background: selectedVersion.color, flexShrink: 0 }} />
                    <input
                      value={selectedVersion.tag}
                      onChange={(e) => updateVersionLocal(selectedVersion.id, { tag: e.target.value })}
                      onBlur={() => persistVersion(selectedVersion.id, { tag: selectedVersion.tag })}
                      style={{
                        fontSize: 11, fontWeight: 600, color: selectedVersion.color,
                        fontFamily: "var(--font-mono, ui-monospace, monospace)",
                        background: "transparent", border: "none", outline: "none",
                        padding: 0, width: 80,
                      }}
                    />
                    {statusBadge(selectedVersion.status)}
                  </div>
                  <input
                    value={selectedVersion.title}
                    onChange={(e) => updateVersionLocal(selectedVersion.id, { title: e.target.value })}
                    onBlur={() => persistVersion(selectedVersion.id, { title: selectedVersion.title })}
                    style={{
                      fontSize: 17, fontWeight: 600, color: "rgba(255, 255, 255, 0.88)",
                      margin: 0, lineHeight: 1.3, width: "100%",
                      background: "transparent", border: "none", outline: "none",
                      padding: 0, fontFamily: "inherit",
                    }}
                  />
                </div>
                <button
                  onClick={() => setSelectedVersionId(null)}
                  style={{
                    width: 28, height: 28, borderRadius: 6,
                    display: "flex", alignItems: "center", justifyContent: "center",
                    background: "rgba(255, 255, 255, 0.05)",
                    border: "1px solid rgba(255, 255, 255, 0.08)",
                    color: "rgba(255, 255, 255, 0.4)",
                    fontSize: 16, cursor: "pointer", flexShrink: 0, marginLeft: 12,
                  }}
                >
                  ×
                </button>
              </div>

              {/* Content */}
              <div style={{ flex: 1, overflowY: "auto" }}>
                <div style={{ padding: "12px 20px", borderBottom: "1px solid rgba(255, 255, 255, 0.06)" }}>
                  {/* Timeline */}
                  <div style={{ display: "flex", alignItems: "center", padding: "7px 0" }}>
                    <span style={{ width: 110, flexShrink: 0, fontSize: 12, color: "rgba(255, 255, 255, 0.35)" }}>Start</span>
                    <input
                      type="date"
                      value={selectedVersion.startDate ?? ""}
                      onChange={(e) => updateVersion(selectedVersion.id, { startDate: e.target.value || null })}
                      style={{
                        background: "rgba(255, 255, 255, 0.04)", border: "1px solid rgba(255, 255, 255, 0.08)",
                        borderRadius: 5, padding: "4px 8px", fontSize: 12, color: "rgba(255, 255, 255, 0.6)",
                        fontFamily: "var(--font-mono, ui-monospace, monospace)", outline: "none", colorScheme: "dark",
                      }}
                    />
                  </div>
                  <div style={{ display: "flex", alignItems: "center", padding: "7px 0" }}>
                    <span style={{ width: 110, flexShrink: 0, fontSize: 12, color: "rgba(255, 255, 255, 0.35)" }}>End</span>
                    <input
                      type="date"
                      value={selectedVersion.endDate ?? ""}
                      onChange={(e) => updateVersion(selectedVersion.id, { endDate: e.target.value || null })}
                      style={{
                        background: "rgba(255, 255, 255, 0.04)", border: "1px solid rgba(255, 255, 255, 0.08)",
                        borderRadius: 5, padding: "4px 8px", fontSize: 12, color: "rgba(255, 255, 255, 0.6)",
                        fontFamily: "var(--font-mono, ui-monospace, monospace)", outline: "none", colorScheme: "dark",
                      }}
                    />
                  </div>

                  {/* Status */}
                  <div style={{ display: "flex", alignItems: "center", padding: "7px 0" }}>
                    <span style={{ width: 110, flexShrink: 0, fontSize: 12, color: "rgba(255, 255, 255, 0.35)" }}>Status</span>
                    <select
                      value={selectedVersion.status}
                      onChange={(e) => updateVersion(selectedVersion.id, { status: e.target.value })}
                      style={{
                        background: "rgba(255, 255, 255, 0.04)", border: "1px solid rgba(255, 255, 255, 0.08)",
                        borderRadius: 5, padding: "4px 8px", fontSize: 12, color: "rgba(255, 255, 255, 0.6)",
                        outline: "none", appearance: "none", cursor: "pointer", colorScheme: "dark",
                      }}
                    >
                      <option value="planned">Planned</option>
                      <option value="active">Active</option>
                      <option value="done">Done</option>
                    </select>
                  </div>

                  {/* Color */}
                  <div style={{ display: "flex", alignItems: "center", padding: "7px 0" }}>
                    <span style={{ width: 110, flexShrink: 0, fontSize: 12, color: "rgba(255, 255, 255, 0.35)" }}>Color</span>
                    <input
                      type="color"
                      value={selectedVersion.color}
                      onChange={(e) => updateVersion(selectedVersion.id, { color: e.target.value })}
                      style={{
                        width: 28, height: 28, padding: 0, border: "1px solid rgba(255, 255, 255, 0.08)",
                        borderRadius: 5, cursor: "pointer", background: "transparent",
                      }}
                    />
                    <span style={{ marginLeft: 8, fontSize: 11, color: "rgba(255, 255, 255, 0.4)", fontFamily: "var(--font-mono, ui-monospace, monospace)" }}>
                      {selectedVersion.color}
                    </span>
                  </div>

                  {/* Description */}
                  <div style={{ padding: "10px 0 4px" }}>
                    <textarea
                      value={selectedVersion.description ?? ""}
                      onChange={(e) => { updateVersionLocal(selectedVersion.id, { description: e.target.value || null }); e.target.style.height = "auto"; e.target.style.height = e.target.scrollHeight + "px"; }}
                      onBlur={() => persistVersion(selectedVersion.id, { description: selectedVersion.description })}
                      placeholder="Add a description..."
                      ref={(el) => { if (el) { el.style.height = "auto"; el.style.height = el.scrollHeight + "px"; } }}
                      style={{
                        width: "100%", minHeight: 60, resize: "none", overflow: "hidden",
                        background: "rgba(255, 255, 255, 0.04)", border: "1px solid rgba(255, 255, 255, 0.08)",
                        borderRadius: 6, padding: "8px 10px", fontSize: 13, color: "rgba(255, 255, 255, 0.6)",
                        lineHeight: 1.5, outline: "none", fontFamily: "inherit",
                      }}
                    />
                  </div>
                </div>

                {/* Features list */}
                <div style={{ padding: "16px 20px" }}>
                  <div style={{ fontSize: 12, fontWeight: 600, color: "rgba(255, 255, 255, 0.6)", marginBottom: 12 }}>
                    Features ({selectedVersion.features.length})
                  </div>
                  {selectedVersion.features.length === 0 ? (
                    <div style={{ fontSize: 12, color: "rgba(255, 255, 255, 0.3)" }}>No features yet</div>
                  ) : (
                    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                      {selectedVersion.features.map((f) => {
                        const progress = f.ticketCount > 0 ? Math.round((f.doneTicketCount / f.ticketCount) * 100) : 0;
                        return (
                          <div
                            key={f.id}
                            onClick={() => {
                              setSelectedFeatureId(f.id);
                              setSelectedVersionId(null);
                            }}
                            style={{
                              display: "flex",
                              alignItems: "center",
                              gap: 8,
                              padding: "8px 10px",
                              borderRadius: 6,
                              background: "rgba(255, 255, 255, 0.03)",
                              border: "1px solid rgba(255, 255, 255, 0.05)",
                              cursor: "pointer",
                            }}
                          >
                            {statusDot(f.status)}
                            <span style={{ flex: 1, fontSize: 12, color: "rgba(255, 255, 255, 0.7)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                              {f.title}
                            </span>
                            {f.ticketCount > 0 && (
                              <span style={{ fontSize: 10, color: "rgba(255, 255, 255, 0.3)" }}>
                                {progress}%
                              </span>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* ── Ticket detail sidebar ──────────────────── */}
          {selectedTicketId && selectedTicket && (
            <div
              style={{
                position: "absolute",
                top: 0,
                right: 0,
                bottom: 0,
                width: sidebarWidth,
                display: "flex",
                flexDirection: "column",
                background: "var(--background, #0C0E14)",
                borderLeft: "1px solid rgba(255, 255, 255, 0.1)",
                boxShadow: "-8px 0 32px rgba(0, 0, 0, 0.4)",
                zIndex: 50,
              }}
            >
              {/* Resize handle */}
              <div
                onMouseDown={onResizeStart}
                style={{
                  position: "absolute", left: -3, top: 0, bottom: 0, width: 6,
                  cursor: "col-resize", zIndex: 10,
                  display: "flex", alignItems: "center", justifyContent: "center",
                }}
              >
                <div style={{ width: 2, height: 40, borderRadius: 2, background: "rgba(255, 255, 255, 0.15)" }} />
              </div>

              {/* Header */}
              <div
                style={{
                  display: "flex", alignItems: "flex-start", justifyContent: "space-between",
                  padding: "14px 20px", borderBottom: "1px solid rgba(255, 255, 255, 0.08)", flexShrink: 0,
                }}
              >
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
                    {statusDot(selectedTicket.status === "done" ? "done" : selectedTicket.status === "in-progress" || selectedTicket.status === "review" ? "active" : "planned")}
                    {statusBadge(selectedTicket.status === "done" ? "done" : selectedTicket.status === "in-progress" || selectedTicket.status === "review" ? "active" : "planned")}
                    {selectedTicket.domain && (
                      <span style={{ fontSize: 10, fontWeight: 500, color: "rgba(255, 255, 255, 0.35)", textTransform: "uppercase", letterSpacing: "0.05em" }}>
                        {selectedTicket.domain}
                      </span>
                    )}
                  </div>
                  <input
                    value={selectedTicket.title}
                    onChange={(e) => setSelectedTicket((prev) => prev ? { ...prev, title: e.target.value } : prev)}
                    onBlur={() => updateTicket(selectedTicketId, { title: selectedTicket.title })}
                    style={{
                      fontSize: 17, fontWeight: 600, color: "rgba(255, 255, 255, 0.88)",
                      margin: 0, lineHeight: 1.3, width: "100%",
                      background: "transparent", border: "none", outline: "none",
                      padding: 0, fontFamily: "inherit",
                    }}
                  />
                </div>
                <button
                  onClick={() => setSelectedTicketId(null)}
                  style={{
                    width: 28, height: 28, borderRadius: 6,
                    display: "flex", alignItems: "center", justifyContent: "center",
                    background: "rgba(255, 255, 255, 0.05)",
                    border: "1px solid rgba(255, 255, 255, 0.08)",
                    color: "rgba(255, 255, 255, 0.4)",
                    fontSize: 16, cursor: "pointer", flexShrink: 0, marginLeft: 12,
                  }}
                >
                  ×
                </button>
              </div>

              {/* Content */}
              <div style={{ flex: 1, overflowY: "auto" }}>
                <div style={{ padding: "12px 20px", borderBottom: "1px solid rgba(255, 255, 255, 0.06)" }}>
                  {/* Owner */}
                  <div style={{ display: "flex", alignItems: "center", padding: "7px 0" }}>
                    <span style={{ width: 110, flexShrink: 0, fontSize: 12, color: "rgba(255, 255, 255, 0.35)" }}>Owner</span>
                    {avatarBadge(
                      selectedTicket.assignee,
                      (key) => {
                        setSelectedTicket((prev) => prev ? { ...prev, assignee: key } : prev);
                        updateTicket(selectedTicketId, { assignee: key });
                      },
                      assigneeMenuOpen,
                      setAssigneeMenuOpen,
                      `sidebar-ticket-${selectedTicketId}`,
                      team,
                    )}
                  </div>

                  {/* Status */}
                  <div style={{ display: "flex", alignItems: "center", padding: "7px 0" }}>
                    <span style={{ width: 110, flexShrink: 0, fontSize: 12, color: "rgba(255, 255, 255, 0.35)" }}>Status</span>
                    <select
                      value={selectedTicket.status}
                      onChange={(e) => {
                        const newStatus = e.target.value;
                        setSelectedTicket((prev) => prev ? { ...prev, status: newStatus } : prev);
                        updateTicket(selectedTicketId, { status: newStatus });
                      }}
                      style={{
                        background: "rgba(255, 255, 255, 0.04)", border: "1px solid rgba(255, 255, 255, 0.08)",
                        borderRadius: 5, padding: "4px 8px", fontSize: 12, color: "rgba(255, 255, 255, 0.6)",
                        outline: "none", appearance: "none", cursor: "pointer", colorScheme: "dark",
                      }}
                    >
                      <option value="backlog">Backlog</option>
                      <option value="todo">To Do</option>
                      <option value="in-progress">In Progress</option>
                      <option value="review">Review</option>
                      <option value="done">Done</option>
                    </select>
                  </div>

                  {/* Priority */}
                  <div style={{ display: "flex", alignItems: "center", padding: "7px 0" }}>
                    <span style={{ width: 110, flexShrink: 0, fontSize: 12, color: "rgba(255, 255, 255, 0.35)" }}>Priority</span>
                    <select
                      value={selectedTicket.priority ?? ""}
                      onChange={(e) => {
                        const newPriority = e.target.value || null;
                        setSelectedTicket((prev) => prev ? { ...prev, priority: newPriority } : prev);
                        updateTicket(selectedTicketId, { priority: newPriority });
                      }}
                      style={{
                        background: "rgba(255, 255, 255, 0.04)", border: "1px solid rgba(255, 255, 255, 0.08)",
                        borderRadius: 5, padding: "4px 8px", fontSize: 12, color: "rgba(255, 255, 255, 0.6)",
                        outline: "none", appearance: "none", cursor: "pointer", colorScheme: "dark",
                      }}
                    >
                      <option value="">None</option>
                      <option value="P1">P1</option>
                      <option value="P2">P2</option>
                      <option value="P3">P3</option>
                    </select>
                  </div>

                  {/* Description */}
                  <div style={{ padding: "10px 0 4px" }}>
                    <textarea
                      value={selectedTicket.description ?? ""}
                      onChange={(e) => { setSelectedTicket((prev) => prev ? { ...prev, description: e.target.value || null } : prev); e.target.style.height = "auto"; e.target.style.height = e.target.scrollHeight + "px"; }}
                      onBlur={() => updateTicket(selectedTicketId, { description: selectedTicket.description })}
                      placeholder="Add a description..."
                      ref={(el) => { if (el) { el.style.height = "auto"; el.style.height = el.scrollHeight + "px"; } }}
                      style={{
                        width: "100%", minHeight: 80, resize: "none", overflow: "hidden",
                        background: "rgba(255, 255, 255, 0.04)", border: "1px solid rgba(255, 255, 255, 0.08)",
                        borderRadius: 6, padding: "8px 10px", fontSize: 13, color: "rgba(255, 255, 255, 0.6)",
                        lineHeight: 1.5, outline: "none", fontFamily: "inherit",
                      }}
                    />
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* ── Feature detail sidebar ──────────────────── */}
          {selectedFeature && (
            <div
              style={{
                position: "absolute",
                top: 0,
                right: 0,
                bottom: 0,
                width: sidebarWidth,
                display: "flex",
                flexDirection: "column",
                background: "var(--background, #0C0E14)",
                borderLeft: "1px solid rgba(255, 255, 255, 0.1)",
                boxShadow: "-8px 0 32px rgba(0, 0, 0, 0.4)",
                zIndex: 50,
              }}
            >
              {/* Resize handle */}
              <div
                onMouseDown={onResizeStart}
                style={{
                  position: "absolute",
                  left: -3,
                  top: 0,
                  bottom: 0,
                  width: 6,
                  cursor: "col-resize",
                  zIndex: 51,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <div style={{ width: 2, height: 40, borderRadius: 2, background: "rgba(255, 255, 255, 0.15)" }} />
              </div>

              {/* Header */}
              <div
                style={{
                  display: "flex",
                  alignItems: "flex-start",
                  justifyContent: "space-between",
                  padding: "14px 20px",
                  borderBottom: "1px solid rgba(255, 255, 255, 0.08)",
                  flexShrink: 0,
                }}
              >
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
                    <span style={{ width: 8, height: 8, borderRadius: "50%", background: selectedFeature.color ?? selectedFeature.versionColor, flexShrink: 0 }} />
                    <span style={{ fontSize: 11, fontWeight: 500, color: "rgba(255, 255, 255, 0.4)" }}>
                      {selectedFeature.versionTag}
                    </span>
                    {statusBadge(selectedFeature.status)}
                  </div>
                  <input
                    value={selectedFeature.title}
                    onChange={(e) => updateFeatureLocal(selectedFeature.id, { title: e.target.value })}
                    onBlur={() => persistFeature(selectedFeature.id, { title: selectedFeature.title })}
                    style={{
                      fontSize: 17, fontWeight: 600, color: "rgba(255, 255, 255, 0.88)",
                      margin: 0, lineHeight: 1.3, width: "100%",
                      background: "transparent", border: "none", outline: "none",
                      padding: 0, fontFamily: "inherit",
                    }}
                  />
                </div>
                <button
                  onClick={() => setSelectedFeatureId(null)}
                  style={{
                    width: 28, height: 28, borderRadius: 6,
                    display: "flex", alignItems: "center", justifyContent: "center",
                    background: "rgba(255, 255, 255, 0.05)",
                    border: "1px solid rgba(255, 255, 255, 0.08)",
                    color: "rgba(255, 255, 255, 0.4)",
                    fontSize: 16, cursor: "pointer", flexShrink: 0, marginLeft: 12,
                  }}
                >
                  ×
                </button>
              </div>

              {/* Content */}
              <div style={{ flex: 1, overflowY: "auto" }}>
                {/* Metadata — editable */}
                <div style={{ padding: "12px 20px", borderBottom: "1px solid rgba(255, 255, 255, 0.06)" }}>
                  {/* Timeline */}
                  <div style={{ display: "flex", alignItems: "center", padding: "7px 0" }}>
                    <span style={{ width: 110, flexShrink: 0, fontSize: 12, color: "rgba(255, 255, 255, 0.35)" }}>Start</span>
                    <input
                      type="date"
                      value={selectedFeature.startDate ?? ""}
                      onChange={(e) => updateFeature(selectedFeature.id, { startDate: e.target.value || null })}
                      style={{
                        background: "rgba(255, 255, 255, 0.04)", border: "1px solid rgba(255, 255, 255, 0.08)",
                        borderRadius: 5, padding: "4px 8px", fontSize: 12, color: "rgba(255, 255, 255, 0.6)",
                        fontFamily: "var(--font-mono, ui-monospace, monospace)", outline: "none", colorScheme: "dark",
                      }}
                    />
                  </div>
                  <div style={{ display: "flex", alignItems: "center", padding: "7px 0" }}>
                    <span style={{ width: 110, flexShrink: 0, fontSize: 12, color: "rgba(255, 255, 255, 0.35)" }}>End</span>
                    <input
                      type="date"
                      value={selectedFeature.endDate ?? ""}
                      onChange={(e) => updateFeature(selectedFeature.id, { endDate: e.target.value || null })}
                      style={{
                        background: "rgba(255, 255, 255, 0.04)", border: "1px solid rgba(255, 255, 255, 0.08)",
                        borderRadius: 5, padding: "4px 8px", fontSize: 12, color: "rgba(255, 255, 255, 0.6)",
                        fontFamily: "var(--font-mono, ui-monospace, monospace)", outline: "none", colorScheme: "dark",
                      }}
                    />
                  </div>

                  {/* Status */}
                  <div style={{ display: "flex", alignItems: "center", padding: "7px 0" }}>
                    <span style={{ width: 110, flexShrink: 0, fontSize: 12, color: "rgba(255, 255, 255, 0.35)" }}>Status</span>
                    <select
                      value={selectedFeature.status}
                      onChange={(e) => updateFeature(selectedFeature.id, { status: e.target.value })}
                      style={{
                        background: "rgba(255, 255, 255, 0.04)", border: "1px solid rgba(255, 255, 255, 0.08)",
                        borderRadius: 5, padding: "4px 8px", fontSize: 12, color: "rgba(255, 255, 255, 0.6)",
                        outline: "none", appearance: "none", cursor: "pointer", colorScheme: "dark",
                      }}
                    >
                      <option value="planned">Planned</option>
                      <option value="active">Active</option>
                      <option value="done">Done</option>
                    </select>
                  </div>

                  {/* Owner */}
                  <div style={{ display: "flex", alignItems: "center", padding: "7px 0" }}>
                    <span style={{ width: 110, flexShrink: 0, fontSize: 12, color: "rgba(255, 255, 255, 0.35)" }}>Owner</span>
                    {avatarBadge(
                      selectedFeature.assignee ?? null,
                      (key) => updateFeature(selectedFeature.id, { assignee: key }),
                      assigneeMenuOpen,
                      setAssigneeMenuOpen,
                      `feature-${selectedFeature.id}`,
                      team,
                    )}
                  </div>

                  {/* Color */}
                  <div style={{ display: "flex", alignItems: "center", padding: "7px 0", position: "relative" }}>
                    <span style={{ width: 110, flexShrink: 0, fontSize: 12, color: "rgba(255, 255, 255, 0.35)" }}>Color</span>
                    <button
                      onClick={(e) => { e.stopPropagation(); setColorMenuOpen((prev) => prev === selectedFeature.id ? null : selectedFeature.id); }}
                      style={{
                        width: 22, height: 22, borderRadius: "50%",
                        background: selectedFeature.color ?? selectedFeature.versionColor,
                        border: "2px solid rgba(255, 255, 255, 0.15)",
                        cursor: "pointer", padding: 0,
                      }}
                    />
                    {colorMenuOpen === selectedFeature.id && (
                      <div
                        style={{
                          position: "absolute", top: "100%", left: 110, marginTop: 4,
                          background: "rgba(30, 30, 34, 0.98)", border: "1px solid rgba(255, 255, 255, 0.1)",
                          borderRadius: 10, padding: 10, zIndex: 60,
                          boxShadow: "0 8px 24px rgba(0, 0, 0, 0.4)",
                          display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 6,
                        }}
                        onClick={(e) => e.stopPropagation()}
                      >
                        {FEATURE_COLORS.map((c) => (
                          <button
                            key={c}
                            onClick={() => { updateFeature(selectedFeature.id, { color: c }); setColorMenuOpen(null); }}
                            style={{
                              width: 24, height: 24, borderRadius: "50%",
                              background: c,
                              border: (selectedFeature.color ?? selectedFeature.versionColor) === c ? "2.5px solid #fff" : "2.5px solid transparent",
                              cursor: "pointer", padding: 0,
                              transition: "border-color 0.15s ease, transform 0.1s ease",
                            }}
                          />
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Tickets (read-only) */}
                  <div style={{ display: "flex", alignItems: "center", padding: "7px 0" }}>
                    <span style={{ width: 110, flexShrink: 0, fontSize: 12, color: "rgba(255, 255, 255, 0.35)" }}>Tickets</span>
                    <span style={{ fontSize: 12, color: "rgba(255, 255, 255, 0.6)" }}>
                      {selectedFeature.doneTicketCount}/{selectedFeature.ticketCount} done
                    </span>
                  </div>
                  {selectedFeature.ticketCount > 0 && (
                    <div style={{ marginTop: 4, height: 3, borderRadius: 2, background: "rgba(255, 255, 255, 0.06)", overflow: "hidden" }}>
                      <div
                        style={{
                          width: `${(selectedFeature.doneTicketCount / selectedFeature.ticketCount) * 100}%`,
                          height: "100%",
                          background: selectedFeature.color ?? selectedFeature.versionColor,
                          borderRadius: 2,
                          transition: "width 0.2s ease",
                        }}
                      />
                    </div>
                  )}

                  {/* Description — editable */}
                  <div style={{ padding: "10px 0 4px" }}>
                    <textarea
                      value={selectedFeature.description ?? ""}
                      onChange={(e) => { updateFeatureLocal(selectedFeature.id, { description: e.target.value || null }); e.target.style.height = "auto"; e.target.style.height = e.target.scrollHeight + "px"; }}
                      onBlur={() => persistFeature(selectedFeature.id, { description: selectedFeature.description })}
                      placeholder="Add a description..."
                      ref={(el) => { if (el) { el.style.height = "auto"; el.style.height = el.scrollHeight + "px"; } }}
                      style={{
                        width: "100%", minHeight: 60, resize: "none", overflow: "hidden",
                        background: "rgba(255, 255, 255, 0.04)", border: "1px solid rgba(255, 255, 255, 0.08)",
                        borderRadius: 6, padding: "8px 10px", fontSize: 13, color: "rgba(255, 255, 255, 0.6)",
                        lineHeight: 1.5, outline: "none", fontFamily: "inherit",
                      }}
                    />
                  </div>
                </div>

                {/* Tickets list — sortable */}
                <div style={{ padding: "16px 20px" }}>
                  <div style={{ fontSize: 12, fontWeight: 600, color: "rgba(255, 255, 255, 0.6)", marginBottom: 12 }}>
                    Tickets
                  </div>
                  {ticketsLoading ? (
                    <div style={{ fontSize: 12, color: "rgba(255, 255, 255, 0.3)" }}>Loading...</div>
                  ) : featureTickets.length === 0 ? (
                    <div style={{ fontSize: 12, color: "rgba(255, 255, 255, 0.3)" }}>No tickets linked</div>
                  ) : (
                    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleTicketReorder}>
                      <SortableContext items={featureTickets.map((t) => t.id)} strategy={verticalListSortingStrategy}>
                        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                          {featureTickets.map((t) => (
                            <SortableTicketRow
                              key={t.id}
                              ticket={t}
                              team={team}
                              assigneeMenuOpen={assigneeMenuOpen}
                              setAssigneeMenuOpen={setAssigneeMenuOpen}
                              onAssigneeChange={(ticketId, key) => updateTicket(ticketId, { assignee: key })}
                            />
                          ))}
                        </div>
                      </SortableContext>
                    </DndContext>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    );
  }

  // ── Versions & Features tabs ───────────────────────────
  return (
    <>
      <style>{`
        @keyframes pulse-dot {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.4; }
        }
      `}</style>

      <div style={{ maxWidth: 960, margin: "0 auto" }}>
        {/* Subtitle */}
        <div style={{ marginBottom: "2.5rem" }}>
          <p style={{ fontSize: "0.95rem", color: "var(--muted)", lineHeight: 1.6, maxWidth: 640, margin: 0 }}>
            Building the most fluid, immersive world engine — starting with
            voice-first simulation for high-stakes practice, expanding into
            wellness, storytelling, and full spatial immersion.
          </p>
        </div>

        {/* Progress summary */}
        <div style={{ display: "flex", gap: "1.5rem", marginBottom: "2rem", flexWrap: "wrap" }}>
          <div style={{ background: "var(--panel)", border: "1px solid var(--border)", borderRadius: "0.5rem", padding: "0.75rem 1.25rem", minWidth: 140 }}>
            <div style={{ fontSize: "0.65rem", fontWeight: 600, letterSpacing: "0.1em", textTransform: "uppercase", color: "var(--muted)", marginBottom: "0.25rem" }}>
              Overall
            </div>
            <div style={{ fontSize: "1.5rem", fontWeight: 700, color: "var(--foreground)" }}>
              {totalFeatures > 0 ? Math.round((doneFeatures / totalFeatures) * 100) : 0}%
            </div>
          </div>
          <div style={{ background: "var(--panel)", border: "1px solid var(--border)", borderRadius: "0.5rem", padding: "0.75rem 1.25rem", minWidth: 140 }}>
            <div style={{ fontSize: "0.65rem", fontWeight: 600, letterSpacing: "0.1em", textTransform: "uppercase", color: "var(--muted)", marginBottom: "0.25rem" }}>
              Completed
            </div>
            <div style={{ fontSize: "1.5rem", fontWeight: 700, color: "var(--success, #8CE7D2)" }}>
              {doneFeatures}
              <span style={{ fontSize: "0.85rem", fontWeight: 400, color: "var(--muted)" }}> / {totalFeatures}</span>
            </div>
          </div>
          <div style={{ background: "var(--panel)", border: "1px solid var(--border)", borderRadius: "0.5rem", padding: "0.75rem 1.25rem", minWidth: 140 }}>
            <div style={{ fontSize: "0.65rem", fontWeight: 600, letterSpacing: "0.1em", textTransform: "uppercase", color: "var(--muted)", marginBottom: "0.25rem" }}>
              Active
            </div>
            <div style={{ fontSize: "1.5rem", fontWeight: 700, color: "var(--accent, #8fd1cb)" }}>
              {activeFeatures}
            </div>
          </div>
        </div>

        {/* Band progress rail */}
        {totalFeatures > 0 && (
          <div style={{ display: "flex", height: 6, borderRadius: 3, overflow: "hidden", marginBottom: "2.5rem", background: "var(--panel)", border: "1px solid var(--border)" }}>
            {versions.map((v) => {
              const weight = v.features.length / totalFeatures;
              const done = v.features.filter((f) => f.status === "done").length;
              const active = v.features.filter((f) => f.status === "active").length;
              const fill = v.features.length > 0 ? (done + active * 0.5) / v.features.length : 0;
              return (
                <div key={v.id} style={{ flex: weight, position: "relative", background: `${v.color}1a` }}>
                  <div style={{ position: "absolute", inset: 0, width: `${fill * 100}%`, background: v.color, opacity: 0.8, transition: "width 0.4s ease" }} />
                </div>
              );
            })}
          </div>
        )}

        {/* Versions tab — expandable cards */}
        {tab === "versions" && (
          <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
            {versions.map((v, vi) => {
              const isExpanded = expanded === v.id;
              const done = v.features.filter((f) => f.status === "done").length;
              const progress = v.features.length > 0 ? Math.round((done / v.features.length) * 100) : 0;

              return (
                <div
                  key={v.id}
                  style={{
                    background: "var(--panel)",
                    border: `1px solid ${isExpanded ? v.color + "33" : "var(--border)"}`,
                    borderRadius: "0.75rem", overflow: "hidden",
                    transition: "border-color 0.2s ease",
                  }}
                >
                  <button
                    onClick={() => setExpanded(isExpanded ? null : v.id)}
                    style={{
                      display: "flex", alignItems: "center", gap: "1rem", width: "100%",
                      padding: "1rem 1.25rem", background: "none", border: "none",
                      cursor: "pointer", textAlign: "left", color: "var(--foreground)",
                    }}
                  >
                    <span style={{
                      display: "flex", alignItems: "center", justifyContent: "center",
                      width: 32, height: 32, borderRadius: "50%",
                      background: `${v.color}1a`, color: v.color,
                      fontSize: "0.8rem", fontWeight: 700, flexShrink: 0,
                    }}>
                      {vi + 1}
                    </span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: "0.6rem" }}>
                        <span style={{ fontSize: "1rem", fontWeight: 600 }}>{v.tag} — {v.title}</span>
                        {statusBadge(v.status)}
                      </div>
                      {v.description && (
                        <div style={{ fontSize: "0.8rem", color: "var(--muted)", marginTop: "0.1rem" }}>
                          {v.description}
                        </div>
                      )}
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", flexShrink: 0 }}>
                      <div style={{ width: 64, height: 4, borderRadius: 2, background: "rgba(255,255,255,0.06)", overflow: "hidden" }}>
                        <div style={{ width: `${progress}%`, height: "100%", background: v.color, borderRadius: 2, transition: "width 0.3s ease" }} />
                      </div>
                      <span style={{ fontSize: "0.7rem", fontWeight: 600, color: "var(--muted)", width: 32, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>
                        {progress}%
                      </span>
                    </div>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--muted)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
                      style={{ flexShrink: 0, transform: isExpanded ? "rotate(180deg)" : "rotate(0deg)", transition: "transform 0.2s ease" }}>
                      <polyline points="6 9 12 15 18 9" />
                    </svg>
                  </button>

                  {isExpanded && (
                    <div style={{ padding: "0 1.25rem 1.25rem", borderTop: "1px solid var(--border)" }}>
                      {v.startDate && v.endDate && (
                        <div style={{ fontSize: "0.8rem", color: "var(--muted)", margin: "0.75rem 0" }}>
                          {v.startDate} → {v.endDate}
                        </div>
                      )}
                      {v.features.length === 0 ? (
                        <div style={{ fontSize: "0.85rem", color: "var(--muted)", padding: "0.75rem 0" }}>No features yet</div>
                      ) : (
                        <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem", marginTop: "0.5rem" }}>
                          {v.features.map((f) => (
                            <div key={f.id} style={{ display: "flex", alignItems: "center", gap: "0.6rem", fontSize: "0.85rem", color: f.status === "planned" ? "var(--muted)" : "var(--foreground)" }}>
                              {statusDot(f.status)}
                              <span style={{ textDecoration: f.status === "done" ? "line-through" : "none", opacity: f.status === "done" ? 0.6 : 1 }}>
                                {f.title}
                              </span>
                              {f.ticketCount > 0 && (
                                <span style={{ fontSize: "0.7rem", color: "var(--muted)" }}>
                                  {f.doneTicketCount}/{f.ticketCount} tickets
                                </span>
                              )}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {/* Features tab — flat list grouped by version */}
        {tab === "features" && (
          <div style={{ display: "flex", flexDirection: "column", gap: "1.5rem" }}>
            {versions.map((v) => (
              <div key={v.id}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: "0.75rem" }}>
                  <span style={{ width: 8, height: 8, borderRadius: "50%", background: v.color, flexShrink: 0 }} />
                  <span style={{ fontSize: "0.85rem", fontWeight: 700, color: "var(--foreground)", fontFamily: "var(--font-mono, ui-monospace, monospace)" }}>
                    {v.tag}
                  </span>
                  <span style={{ fontSize: "0.8rem", color: "var(--muted)" }}>{v.title}</span>
                </div>
                {v.features.length === 0 ? (
                  <div style={{ fontSize: "0.8rem", color: "var(--muted)", paddingLeft: 24 }}>No features</div>
                ) : (
                  <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
                    {v.features.map((f) => (
                      <div
                        key={f.id}
                        style={{
                          display: "flex", alignItems: "center", gap: "0.75rem",
                          padding: "0.6rem 1rem", borderRadius: "0.5rem",
                          background: "var(--panel)", border: "1px solid var(--border)",
                        }}
                      >
                        {statusDot(f.status)}
                        <span style={{ flex: 1, fontSize: "0.85rem", color: "var(--foreground)" }}>{f.title}</span>
                        {f.startDate && f.endDate && (
                          <span style={{ fontSize: "0.7rem", color: "var(--muted)", fontFamily: "var(--font-mono, ui-monospace, monospace)" }}>
                            {f.startDate} → {f.endDate}
                          </span>
                        )}
                        {f.ticketCount > 0 && (
                          <span style={{ fontSize: "0.7rem", color: "var(--muted)", background: "rgba(255,255,255,0.05)", padding: "2px 8px", borderRadius: 4 }}>
                            {f.doneTicketCount}/{f.ticketCount}
                          </span>
                        )}
                        {statusBadge(f.status)}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        {/* Vision footer */}
        <div
          style={{
            marginTop: "2.5rem", padding: "1.5rem", borderRadius: "0.75rem",
            background: "linear-gradient(135deg, rgba(143, 209, 203, 0.06) 0%, rgba(196, 167, 231, 0.06) 50%, rgba(231, 106, 106, 0.06) 100%)",
            border: "1px solid var(--border)", textAlign: "center",
          }}
        >
          <div style={{ fontSize: "0.65rem", fontWeight: 600, letterSpacing: "0.12em", textTransform: "uppercase", color: "var(--muted)", marginBottom: "0.5rem" }}>
            North Star
          </div>
          <div style={{ fontSize: "1.1rem", fontWeight: 600, color: "var(--foreground)", lineHeight: 1.5 }}>
            The most fluid, immersive world engine that allows anyone to be
            fully engaged in a complex and dynamic space.
          </div>
        </div>
      </div>
    </>
  );
}
