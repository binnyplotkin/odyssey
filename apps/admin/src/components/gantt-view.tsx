"use client";

import { useState, useMemo, useRef, useCallback, useEffect } from "react";
import type { GanttVersion, GanttTask, GanttTicket } from "@/data/gantt";

/* ── Props ──────────────────────────────────────────────────── */

export type GanttBarChange = {
  type: "version" | "feature" | "ticket";
  id: string;
  start: string;
  end: string;
};

export type GanttViewProps = {
  versions: GanttVersion[];
  months: Array<{ label: string; start: string }>;
  timelineStart: string;
  timelineEnd: string;
  selectedFeatureId?: string | null;
  selectedVersionId?: string | null;
  onFeatureClick?: (featureId: string) => void;
  onVersionClick?: (versionId: string) => void;
  onBarChange?: (change: GanttBarChange) => void;
};

/* ── Helpers ─────────────────────────────────────────────────── */

function toMs(iso: string) {
  return new Date(iso).getTime();
}

function pct(date: string, start: string, end: string) {
  const s = toMs(start);
  const range = toMs(end) - s;
  if (range === 0) return 0;
  return ((toMs(date) - s) / range) * 100;
}

function pctToDate(percent: number, tlStart: string, tlEnd: string): string {
  const s = toMs(tlStart);
  const range = toMs(tlEnd) - s;
  const ms = s + (percent / 100) * range;
  const d = new Date(ms);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function isCurrentMonth(monthStart: string) {
  const now = new Date();
  const d = new Date(monthStart);
  return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
}

function hasValidDates(start: string, end: string) {
  return start !== "" && end !== "" && /^\d{4}-\d{2}-\d{2}$/.test(start) && /^\d{4}-\d{2}-\d{2}$/.test(end) && !isNaN(toMs(start)) && !isNaN(toMs(end)) && toMs(start) < toMs(end);
}

/* ── Styles ──────────────────────────────────────────────────── */

const ROW_VERSION = 48;
const ROW_TASK = 40;
const ROW_TICKET = 32;
const LEFT_W = 280;

/* ── Flat row types ──────────────────────────────────────────── */

type VersionRow = { type: "version"; version: GanttVersion; doneCount: number };
type FeatureRow = { type: "feature"; task: GanttTask; versionColor: string };
type TicketRow = { type: "ticket"; ticket: GanttTicket; featureColor: string };
type FlatRow = VersionRow | FeatureRow | TicketRow;

/* ── Drag state ──────────────────────────────────────────────── */

type DragRowType = "version" | "feature" | "ticket";

type DragState = {
  rowType: DragRowType;
  rowId: string;
  mode: "move" | "resize-left" | "resize-right";
  origLeftPct: number;
  origWidthPct: number;
  startMouseX: number;
  containerWidth: number;
};

/* ── Component ───────────────────────────────────────────────── */

export default function GanttView({
  versions,
  months,
  timelineStart,
  timelineEnd,
  selectedFeatureId,
  selectedVersionId,
  onFeatureClick,
  onVersionClick,
  onBarChange,
}: GanttViewProps) {
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [featureCollapsed, setFeatureCollapsed] = useState<Record<string, boolean>>({});
  const [dragState, setDragState] = useState<DragState | null>(null);
  const [dragDelta, setDragDelta] = useState(0);
  const dragDeltaRef = useRef(0);
  const didDragRef = useRef(false);

  const timelineRef = useRef<HTMLDivElement>(null);
  const leftPanelRef = useRef<HTMLDivElement>(null);

  const toggleVersion = (id: string) =>
    setCollapsed((prev) => ({ ...prev, [id]: !prev[id] }));

  const toggleFeature = (id: string) =>
    setFeatureCollapsed((prev) => ({ ...prev, [id]: !prev[id] }));

  const todayPct = useMemo(
    () => pct(new Date().toISOString().slice(0, 10), timelineStart, timelineEnd),
    [timelineStart, timelineEnd],
  );

  // Build flat row list: versions → features → tickets
  const rows: FlatRow[] = useMemo(() => {
    const result: FlatRow[] = [];
    for (const v of versions) {
      result.push({ type: "version", version: v, doneCount: 0 });
      if (!collapsed[v.id]) {
        for (const t of v.tasks) {
          result.push({ type: "feature", task: t, versionColor: v.color });
          if (!featureCollapsed[t.id] && t.tickets && t.tickets.length > 0) {
            for (const tk of t.tickets) {
              if (hasValidDates(tk.start, tk.end)) {
                result.push({ type: "ticket", ticket: tk, featureColor: t.borderColor });
              }
            }
          }
        }
      }
    }
    return result;
  }, [versions, collapsed, featureCollapsed]);

  // Sync scroll between left panel and timeline
  const handleTimelineScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
    if (leftPanelRef.current) {
      leftPanelRef.current.scrollTop = (e.target as HTMLDivElement).scrollTop;
    }
  }, []);

  const handleLeftScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
    if (timelineRef.current) {
      timelineRef.current.scrollTop = (e.target as HTMLDivElement).scrollTop;
    }
  }, []);

  // ── Drag handlers ─────────────────────────────────────────

  const handleBarMouseDown = useCallback(
    (
      e: React.MouseEvent,
      rowType: DragRowType,
      rowId: string,
      mode: "move" | "resize-left" | "resize-right",
      leftPct: number,
      widthPct: number,
    ) => {
      if (!onBarChange) return;
      e.preventDefault();
      e.stopPropagation();

      const container = timelineRef.current;
      if (!container) return;

      setDragState({
        rowType,
        rowId,
        mode,
        origLeftPct: leftPct,
        origWidthPct: widthPct,
        startMouseX: e.clientX,
        containerWidth: container.getBoundingClientRect().width,
      });
      setDragDelta(0);
      dragDeltaRef.current = 0;
      didDragRef.current = false;
      document.body.style.cursor =
        mode === "move" ? "grabbing" : "col-resize";
      document.body.style.userSelect = "none";
    },
    [onBarChange],
  );

  useEffect(() => {
    if (!dragState) return;

    const onMove = (e: MouseEvent) => {
      const dx = e.clientX - dragState.startMouseX;
      const deltaPct = (dx / dragState.containerWidth) * 100;
      dragDeltaRef.current = deltaPct;
      setDragDelta(deltaPct);
      if (Math.abs(dx) > 3) didDragRef.current = true;
    };

    const onUp = () => {
      const ds = dragState;
      const finalDelta = dragDeltaRef.current;

      let newLeftPct = ds.origLeftPct;
      let newWidthPct = ds.origWidthPct;

      if (ds.mode === "move") {
        newLeftPct = ds.origLeftPct + finalDelta;
      } else if (ds.mode === "resize-left") {
        const shift = Math.min(finalDelta, ds.origWidthPct - 1);
        newLeftPct = ds.origLeftPct + shift;
        newWidthPct = ds.origWidthPct - shift;
      } else {
        newWidthPct = Math.max(1, ds.origWidthPct + finalDelta);
      }

      newLeftPct = Math.max(0, Math.min(100 - 1, newLeftPct));
      newWidthPct = Math.max(1, Math.min(100 - newLeftPct, newWidthPct));

      const newStart = pctToDate(newLeftPct, timelineStart, timelineEnd);
      const newEnd = pctToDate(newLeftPct + newWidthPct, timelineStart, timelineEnd);

      setDragState(null);
      setDragDelta(0);
      dragDeltaRef.current = 0;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";

      // Only fire if actually dragged and dates are valid
      if (didDragRef.current && hasValidDates(newStart, newEnd)) {
        onBarChange?.({
          type: ds.rowType,
          id: ds.rowId,
          start: newStart,
          end: newEnd,
        });
      }
    };

    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, [dragState, timelineStart, timelineEnd, onBarChange]);

  function getBarPcts(
    rowType: DragRowType,
    rowId: string,
    basePct: number,
    baseWidth: number,
  ): { left: number; width: number } {
    if (!dragState || dragState.rowType !== rowType || dragState.rowId !== rowId) {
      return { left: basePct, width: baseWidth };
    }

    let left = basePct;
    let width = baseWidth;

    if (dragState.mode === "move") {
      left = dragState.origLeftPct + dragDelta;
    } else if (dragState.mode === "resize-left") {
      const shift = Math.min(dragDelta, dragState.origWidthPct - 1);
      left = dragState.origLeftPct + shift;
      width = dragState.origWidthPct - shift;
    } else {
      width = Math.max(1, dragState.origWidthPct + dragDelta);
    }

    left = Math.max(0, Math.min(100 - 1, left));
    width = Math.max(1, Math.min(100 - left, width));

    return { left, width };
  }

  const resizeHandleStyle = (side: "left" | "right"): React.CSSProperties => ({
    position: "absolute",
    [side]: -2,
    top: 0,
    bottom: 0,
    width: 6,
    cursor: "col-resize",
    zIndex: 5,
    borderRadius: side === "left" ? "4px 0 0 4px" : "0 4px 4px 0",
  });

  const isDragging = !!dragState;

  // ── Render helpers ────────────────────────────────────────

  function renderBarWithHandles(
    rowType: DragRowType,
    id: string,
    baseLeft: number,
    baseWidth: number,
    barStyle: React.CSSProperties,
    label: React.ReactNode,
  ) {
    const { left, width } = getBarPcts(rowType, id, baseLeft, baseWidth);
    const isBeingDragged = dragState?.rowId === id;

    return (
      <div
        onMouseDown={(e) =>
          handleBarMouseDown(e, rowType, id, "move", baseLeft, baseWidth)
        }
        style={{
          ...barStyle,
          left: `${left}%`,
          width: `${width}%`,
          cursor: onBarChange ? (isBeingDragged ? "grabbing" : "grab") : undefined,
          transition: isDragging ? "none" : "left 0.15s ease, width 0.15s ease",
        }}
      >
        {onBarChange && (
          <div
            onMouseDown={(e) =>
              handleBarMouseDown(e, rowType, id, "resize-left", baseLeft, baseWidth)
            }
            style={resizeHandleStyle("left")}
          />
        )}
        {label}
        {onBarChange && (
          <div
            onMouseDown={(e) =>
              handleBarMouseDown(e, rowType, id, "resize-right", baseLeft, baseWidth)
            }
            style={resizeHandleStyle("right")}
          />
        )}
      </div>
    );
  }

  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        display: "flex",
        overflow: "hidden",
      }}
    >
      {/* ── Left panel ───────────────────────────────────── */}
      <div
        style={{
          width: LEFT_W,
          flexShrink: 0,
          display: "flex",
          flexDirection: "column",
          borderRight: "1px solid rgba(255, 255, 255, 0.06)",
          overflow: "hidden",
        }}
      >
        {/* Column header */}
        <div
          style={{
            height: 44,
            display: "flex",
            alignItems: "center",
            paddingInline: 16,
            borderBottom: "1px solid rgba(255, 255, 255, 0.06)",
            flexShrink: 0,
          }}
        >
          <span
            style={{
              fontSize: 10,
              fontWeight: 600,
              letterSpacing: "0.1em",
              textTransform: "uppercase",
              color: "rgba(255, 255, 255, 0.35)",
            }}
          >
            Roadmap
          </span>
        </div>

        {/* Left rows */}
        <div ref={leftPanelRef} onScroll={handleLeftScroll} style={{ flex: 1, overflowY: "auto" }}>
          {rows.map((row) => {
            if (row.type === "version") {
              const v = row.version;
              const isCollapsed = collapsed[v.id] ?? false;
              const isVersionSelected = selectedVersionId === v.id;
              return (
                <div
                  key={`l-${v.id}`}
                  onClick={() => onVersionClick?.(v.id)}
                  style={{
                    height: ROW_VERSION,
                    display: "flex",
                    alignItems: "center",
                    paddingInline: 16,
                    gap: 10,
                    background: isVersionSelected ? "rgba(59, 130, 246, 0.08)" : "rgba(255, 255, 255, 0.025)",
                    borderBottom: "1px solid rgba(255, 255, 255, 0.04)",
                    borderLeft: isVersionSelected ? "2px solid rgba(59, 130, 246, 0.5)" : "2px solid transparent",
                    flexShrink: 0,
                    cursor: onVersionClick ? "pointer" : undefined,
                  }}
                >
                  <button
                    onClick={(e) => { e.stopPropagation(); toggleVersion(v.id); }}
                    style={{
                      background: "none",
                      border: "none",
                      cursor: "pointer",
                      color: "rgba(255, 255, 255, 0.4)",
                      fontSize: 9,
                      padding: 2,
                      width: 16,
                      height: 16,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      flexShrink: 0,
                      borderRadius: 3,
                      transition: "background 0.15s ease",
                    }}
                    onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = "rgba(255,255,255,0.08)"; }}
                    onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = "none"; }}
                  >
                    <svg width="10" height="10" viewBox="0 0 10 10" fill="currentColor" style={{ transform: isCollapsed ? "rotate(-90deg)" : "rotate(0deg)", transition: "transform 0.15s ease" }}>
                      <path d="M2 3l3 4 3-4H2z" />
                    </svg>
                  </button>
                  <span
                    style={{
                      width: 7,
                      height: 7,
                      borderRadius: "50%",
                      background: v.color,
                      flexShrink: 0,
                    }}
                  />
                  <span
                    style={{
                      fontSize: 14,
                      fontWeight: 700,
                      color: "rgba(255, 255, 255, 0.85)",
                      fontFamily: "var(--font-mono, ui-monospace, monospace)",
                    }}
                  >
                    {v.tag}
                  </span>
                  <span
                    style={{
                      fontSize: 11,
                      color: "rgba(255, 255, 255, 0.4)",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                      flex: 1,
                    }}
                  >
                    {v.title}
                  </span>
                  {isCollapsed && v.tasks.length > 0 && (
                    <span
                      style={{
                        fontSize: 9,
                        fontWeight: 600,
                        color: "rgba(255, 255, 255, 0.3)",
                        background: "rgba(255, 255, 255, 0.06)",
                        padding: "1px 6px",
                        borderRadius: 8,
                        flexShrink: 0,
                      }}
                    >
                      {v.tasks.length}
                    </span>
                  )}
                </div>
              );
            }

            if (row.type === "feature") {
              const t = row.task;
              const isSelected = selectedFeatureId === t.id;
              const hasTickets = t.tickets && t.tickets.some((tk) => hasValidDates(tk.start, tk.end));
              const isFeatureCollapsed = featureCollapsed[t.id] ?? false;
              return (
                <div
                  key={`l-${t.id}`}
                  style={{
                    height: ROW_TASK,
                    display: "flex",
                    alignItems: "center",
                    paddingLeft: 30,
                    paddingRight: 16,
                    gap: 8,
                    borderBottom: "1px solid rgba(255, 255, 255, 0.03)",
                    flexShrink: 0,
                    cursor: onFeatureClick ? "pointer" : undefined,
                    background: isSelected ? "rgba(59, 130, 246, 0.08)" : undefined,
                    borderLeft: isSelected ? "2px solid rgba(59, 130, 246, 0.5)" : "2px solid transparent",
                  }}
                  onClick={() => onFeatureClick?.(t.id)}
                >
                  {hasTickets ? (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        toggleFeature(t.id);
                      }}
                      style={{
                        background: "none",
                        border: "none",
                        cursor: "pointer",
                        color: "rgba(255, 255, 255, 0.3)",
                        fontSize: 8,
                        padding: 2,
                        width: 14,
                        height: 14,
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        flexShrink: 0,
                        borderRadius: 3,
                        transition: "background 0.15s ease",
                      }}
                      onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = "rgba(255,255,255,0.08)"; }}
                      onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = "none"; }}
                    >
                      <svg width="8" height="8" viewBox="0 0 10 10" fill="currentColor" style={{ transform: isFeatureCollapsed ? "rotate(-90deg)" : "rotate(0deg)", transition: "transform 0.15s ease" }}>
                        <path d="M2 3l3 4 3-4H2z" />
                      </svg>
                    </button>
                  ) : (
                    <span style={{ width: 14, flexShrink: 0 }} />
                  )}
                  <span
                    style={{
                      width: 6,
                      height: 6,
                      borderRadius: "50%",
                      background: row.versionColor,
                      opacity: 0.5,
                      flexShrink: 0,
                    }}
                  />
                  <span
                    style={{
                      fontSize: 12,
                      color: isSelected ? "rgba(255, 255, 255, 0.85)" : "rgba(255, 255, 255, 0.6)",
                      whiteSpace: "nowrap",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      flex: 1,
                    }}
                  >
                    {t.label}
                  </span>
                  {hasTickets && isFeatureCollapsed && (
                    <span
                      style={{
                        fontSize: 9,
                        fontWeight: 600,
                        color: "rgba(255, 255, 255, 0.25)",
                        background: "rgba(255, 255, 255, 0.05)",
                        padding: "1px 5px",
                        borderRadius: 6,
                        flexShrink: 0,
                      }}
                    >
                      {t.tickets!.filter((tk) => hasValidDates(tk.start, tk.end)).length}
                    </span>
                  )}
                </div>
              );
            }

            // Ticket row
            const tk = row.ticket;
            return (
              <div
                key={`l-${tk.id}`}
                style={{
                  height: ROW_TICKET,
                  display: "flex",
                  alignItems: "center",
                  paddingLeft: 62,
                  paddingRight: 16,
                  gap: 6,
                  borderBottom: "1px solid rgba(255, 255, 255, 0.02)",
                  flexShrink: 0,
                }}
              >
                <span
                  style={{
                    width: 4,
                    height: 4,
                    borderRadius: "50%",
                    background: "rgba(255, 255, 255, 0.2)",
                    flexShrink: 0,
                  }}
                />
                <span
                  style={{
                    fontSize: 11,
                    color: "rgba(255, 255, 255, 0.4)",
                    whiteSpace: "nowrap",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                  }}
                >
                  {tk.label}
                </span>
              </div>
            );
          })}
        </div>
      </div>

      {/* ── Timeline panel ───────────────────────────────── */}
      <div
        style={{
          flex: 1,
          display: "flex",
          flexDirection: "column",
          position: "relative",
          overflow: "hidden",
        }}
      >
        {/* Month headers */}
        <div
          style={{
            height: 44,
            display: "flex",
            borderBottom: "1px solid rgba(255, 255, 255, 0.06)",
            flexShrink: 0,
            position: "relative",
          }}
        >
          {months.map((m, i) => {
            const isCurrent = isCurrentMonth(m.start);
            return (
              <div
                key={m.label}
                style={{
                  flex: 1,
                  display: "flex",
                  alignItems: "center",
                  paddingLeft: 12,
                  borderLeft: i > 0 ? "1px solid rgba(255, 255, 255, 0.04)" : "none",
                  fontSize: 11,
                  fontWeight: isCurrent ? 600 : 400,
                  color: isCurrent
                    ? "rgba(255, 255, 255, 0.85)"
                    : "rgba(255, 255, 255, 0.3)",
                }}
              >
                {m.label}
              </div>
            );
          })}
        </div>

        {/* Timeline body */}
        <div
          ref={timelineRef}
          onScroll={handleTimelineScroll}
          style={{ flex: 1, overflowY: "auto" }}
        >
          {/* Inner wrapper — establishes positioning context at full content height */}
          <div style={{ position: "relative", minHeight: "100%" }}>
          {/* Vertical grid lines */}
          {months.map((m, i) => {
            if (i === 0) return null;
            const left = pct(m.start, timelineStart, timelineEnd);
            return (
              <div
                key={`grid-${m.label}`}
                style={{
                  position: "absolute",
                  left: `${left}%`,
                  top: 0,
                  bottom: 0,
                  width: 1,
                  background: "rgba(255, 255, 255, 0.04)",
                  pointerEvents: "none",
                }}
              />
            );
          })}

          {/* Today line */}
          {todayPct >= 0 && todayPct <= 100 && (
            <div
              style={{
                position: "absolute",
                left: `${todayPct}%`,
                top: 0,
                bottom: 0,
                width: 2,
                background: "rgba(255, 255, 255, 0.15)",
                zIndex: 10,
                pointerEvents: "none",
              }}
            />
          )}

          {/* Row bars */}
          {rows.map((row) => {
            if (row.type === "version") {
              const v = row.version;
              const isVersionSelected = selectedVersionId === v.id;
              if (!hasValidDates(v.start, v.end)) {
                return (
                  <div
                    key={`t-${v.id}`}
                    onClick={() => { if (!didDragRef.current) onVersionClick?.(v.id); }}
                    style={{
                      height: ROW_VERSION, flexShrink: 0,
                      borderBottom: "1px solid rgba(255, 255, 255, 0.04)",
                      background: isVersionSelected ? "rgba(59, 130, 246, 0.04)" : "rgba(255, 255, 255, 0.015)",
                      cursor: onVersionClick ? "pointer" : undefined,
                    }}
                  />
                );
              }
              const baseLeft = pct(v.start, timelineStart, timelineEnd);
              const baseWidth = pct(v.end, timelineStart, timelineEnd) - baseLeft;

              return (
                <div
                  key={`t-${v.id}`}
                  onClick={() => {
                    if (!didDragRef.current) onVersionClick?.(v.id);
                  }}
                  style={{
                    height: ROW_VERSION,
                    position: "relative",
                    borderBottom: "1px solid rgba(255, 255, 255, 0.04)",
                    background: isVersionSelected ? "rgba(59, 130, 246, 0.04)" : "rgba(255, 255, 255, 0.015)",
                    flexShrink: 0,
                    cursor: !isDragging && onVersionClick ? "pointer" : undefined,
                  }}
                >
                  {renderBarWithHandles(
                    "version",
                    v.id,
                    baseLeft,
                    baseWidth,
                    {
                      position: "absolute",
                      top: 12,
                      bottom: 12,
                      borderRadius: 6,
                      background: v.barBg,
                      border: `1px solid ${v.barBorder}`,
                      display: "flex",
                      alignItems: "center",
                      paddingInline: 10,
                      minWidth: 1,
                    },
                    <span
                      style={{
                        fontSize: 10,
                        fontWeight: 600,
                        fontFamily: "var(--font-mono, ui-monospace, monospace)",
                        color: v.color,
                        opacity: 0.7,
                        whiteSpace: "nowrap",
                        overflow: "hidden",
                        pointerEvents: "none",
                      }}
                    >
                      {v.tag} — {v.title}
                    </span>,
                  )}
                </div>
              );
            }

            if (row.type === "feature") {
              const t = row.task;
              const barSelected = selectedFeatureId === t.id;

              if (!hasValidDates(t.start, t.end)) {
                return (
                  <div
                    key={`t-${t.id}`}
                    onClick={() => { if (!didDragRef.current) onFeatureClick?.(t.id); }}
                    style={{
                      height: ROW_TASK,
                      flexShrink: 0,
                      borderBottom: "1px solid rgba(255, 255, 255, 0.03)",
                      background: barSelected ? "rgba(59, 130, 246, 0.04)" : undefined,
                      cursor: onFeatureClick ? "pointer" : undefined,
                    }}
                  />
                );
              }

              const baseLeft = pct(t.start, timelineStart, timelineEnd);
              const baseWidth = pct(t.end, timelineStart, timelineEnd) - baseLeft;

              return (
                <div
                  key={`t-${t.id}`}
                  onClick={() => {
                    if (!didDragRef.current) onFeatureClick?.(t.id);
                  }}
                  style={{
                    height: ROW_TASK,
                    position: "relative",
                    borderBottom: "1px solid rgba(255, 255, 255, 0.03)",
                    background: barSelected ? "rgba(59, 130, 246, 0.04)" : undefined,
                    flexShrink: 0,
                    cursor: !isDragging && onFeatureClick ? "pointer" : undefined,
                  }}
                >
                  {renderBarWithHandles(
                    "feature",
                    t.id,
                    baseLeft,
                    baseWidth,
                    {
                      position: "absolute",
                      top: 10,
                      bottom: 10,
                      borderRadius: 5,
                      background: t.color,
                      border: barSelected ? `2px solid ${t.borderColor}` : `1px solid ${t.borderColor}`,
                      boxShadow: barSelected ? `0 0 12px ${t.borderColor}` : "none",
                      display: "flex",
                      alignItems: "center",
                      paddingInline: 8,
                      minWidth: 1,
                      overflow: "hidden",
                    },
                    <span
                      style={{
                        fontSize: 10,
                        fontWeight: 500,
                        fontFamily: "var(--font-mono, ui-monospace, monospace)",
                        color: "rgba(255, 255, 255, 0.6)",
                        whiteSpace: "nowrap",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        pointerEvents: "none",
                      }}
                    >
                      {t.label}
                    </span>,
                  )}
                </div>
              );
            }

            // Ticket row
            const tk = row.ticket;
            const baseLeft = pct(tk.start, timelineStart, timelineEnd);
            const baseWidth = pct(tk.end, timelineStart, timelineEnd) - baseLeft;

            return (
              <div
                key={`t-${tk.id}`}
                style={{
                  height: ROW_TICKET,
                  position: "relative",
                  borderBottom: "1px solid rgba(255, 255, 255, 0.02)",
                  flexShrink: 0,
                }}
              >
                {renderBarWithHandles(
                  "ticket",
                  tk.id,
                  baseLeft,
                  baseWidth,
                  {
                    position: "absolute",
                    top: 7,
                    bottom: 7,
                    borderRadius: 4,
                    background: tk.color,
                    border: `1px solid ${tk.borderColor}`,
                    display: "flex",
                    alignItems: "center",
                    paddingInline: 6,
                    minWidth: 1,
                    overflow: "hidden",
                  },
                  <span
                    style={{
                      fontSize: 9,
                      fontWeight: 500,
                      fontFamily: "var(--font-mono, ui-monospace, monospace)",
                      color: "rgba(255, 255, 255, 0.5)",
                      whiteSpace: "nowrap",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      pointerEvents: "none",
                    }}
                  >
                    {tk.label}
                  </span>,
                )}
              </div>
            );
          })}
          </div>{/* end inner wrapper */}
        </div>
      </div>
    </div>
  );
}
