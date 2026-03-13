"use client";

import { PointerEvent, WheelEvent, useMemo, useRef, useState, useTransition } from "react";
import { VisibleWorld } from "@odyssey/types";

type EngineView = "architecture" | "trace";
type NodeTone = "client" | "api" | "engine" | "ai" | "data";

type EngineNode = {
  id: string;
  title: string;
  detail: string;
  tone: NodeTone;
  x: number;
  y: number;
  w: number;
  h: number;
};

type EdgeKind = "main" | "blocked" | "optional";

type EngineEdge = {
  id: string;
  from: string;
  to: string;
  kind: EdgeKind;
};

type TraceStep = {
  id: string;
  label: string;
  data: unknown;
};

type TraceResponse = {
  meta: {
    worldId: string;
    worldTitle: string;
    roleId: string;
    roleTitle: string;
    generationMode: string;
    persistenceMode: string;
  };
  trace: TraceStep[];
};

type DragState =
  | {
      type: "node";
      pointerId: number;
      nodeId: string;
      offsetX: number;
      offsetY: number;
    }
  | {
      type: "pan";
      pointerId: number;
      startClientX: number;
      startClientY: number;
      originX: number;
      originY: number;
    }
  | null;

const worldSize = {
  width: 5000,
  height: 3200,
};

const initialNodes: EngineNode[] = [
  {
    id: "client",
    title: "Client: /simulation/[sessionId]",
    detail: "User submits text/voice turns from SimulationShell.",
    tone: "client",
    x: 280,
    y: 240,
    w: 280,
    h: 120,
  },
  {
    id: "api-turn",
    title: "API: POST /api/sessions/:id/turns",
    detail: "Receives body and forwards to processTurn(sessionId, body).",
    tone: "api",
    x: 670,
    y: 240,
    w: 330,
    h: 120,
  },
  {
    id: "validate-load",
    title: "Validation + Context Load",
    detail: "turnInputSchema.parse, load session, load world definition.",
    tone: "engine",
    x: 1110,
    y: 240,
    w: 360,
    h: 120,
  },
  {
    id: "policy",
    title: "DefaultPolicyGuard",
    detail: "Checks disallowed actions before state mutation.",
    tone: "engine",
    x: 1590,
    y: 240,
    w: 320,
    h: 120,
  },
  {
    id: "blocked",
    title: "Blocked Turn Result",
    detail: "Safe narration/choices when request violates policy.",
    tone: "api",
    x: 1590,
    y: 470,
    w: 320,
    h: 110,
  },
  {
    id: "event",
    title: "RuleBasedEventSelector",
    detail: "Selects event template from world + current state.",
    tone: "engine",
    x: 1110,
    y: 470,
    w: 360,
    h: 120,
  },
  {
    id: "reduce",
    title: "HeuristicStateReducer",
    detail: "Applies turn to produce nextState and stateDelta summary.",
    tone: "engine",
    x: 670,
    y: 470,
    w: 330,
    h: 120,
  },
  {
    id: "memory",
    title: "RollingMemorySummarizer",
    detail: "Updates relationship memory for active event actors.",
    tone: "engine",
    x: 280,
    y: 470,
    w: 280,
    h: 120,
  },
  {
    id: "gen",
    title: "OpenAITextGenerator",
    detail: "Generates narration/dialogue/uiChoices/audioDirectives or fallback output.",
    tone: "ai",
    x: 670,
    y: 730,
    w: 470,
    h: 126,
  },
  {
    id: "persist",
    title: "PersistenceStore",
    detail: "updateSession + appendTurn to Neon (DATABASE_URL) or in-memory store.",
    tone: "data",
    x: 1290,
    y: 730,
    w: 470,
    h: 126,
  },
  {
    id: "response",
    title: "API Response Envelope",
    detail: "Returns updated session + turn payload to client.",
    tone: "api",
    x: 960,
    y: 980,
    w: 380,
    h: 110,
  },
  {
    id: "render",
    title: "Client Render Update",
    detail: "Transcript, choices, and world meters refresh on screen.",
    tone: "client",
    x: 1430,
    y: 980,
    w: 380,
    h: 110,
  },
  {
    id: "audio-stt",
    title: "Audio: STT Route",
    detail: "POST /api/audio/transcribe -> gpt-4o-mini-transcribe.",
    tone: "ai",
    x: 280,
    y: 760,
    w: 280,
    h: 95,
  },
  {
    id: "audio-tts",
    title: "Audio: TTS Route",
    detail: "POST /api/audio/speak -> gpt-4o-mini-tts (mp3 base64).",
    tone: "ai",
    x: 280,
    y: 930,
    w: 280,
    h: 95,
  },
];

const edges: EngineEdge[] = [
  { id: "e1", from: "client", to: "api-turn", kind: "main" },
  { id: "e2", from: "api-turn", to: "validate-load", kind: "main" },
  { id: "e3", from: "validate-load", to: "policy", kind: "main" },
  { id: "e4", from: "policy", to: "event", kind: "main" },
  { id: "e5", from: "policy", to: "blocked", kind: "blocked" },
  { id: "e6", from: "event", to: "reduce", kind: "main" },
  { id: "e7", from: "reduce", to: "memory", kind: "main" },
  { id: "e8", from: "memory", to: "gen", kind: "main" },
  { id: "e9", from: "gen", to: "persist", kind: "main" },
  { id: "e10", from: "blocked", to: "persist", kind: "blocked" },
  { id: "e11", from: "persist", to: "response", kind: "main" },
  { id: "e12", from: "response", to: "render", kind: "main" },
  { id: "e13", from: "client", to: "audio-stt", kind: "optional" },
  { id: "e14", from: "response", to: "audio-tts", kind: "optional" },
];

/* ── Tone colors using theme-compatible values ─────────────── */

const toneColors: Record<NodeTone, { border: string; dot: string }> = {
  client:  { border: "var(--accent)",       dot: "var(--accent-strong)" },
  api:     { border: "rgba(129,140,248,0.8)", dot: "rgb(129,140,248)" },
  engine:  { border: "rgba(251,191,36,0.8)",  dot: "rgb(251,191,36)" },
  ai:      { border: "rgba(167,139,250,0.8)", dot: "rgb(167,139,250)" },
  data:    { border: "var(--success)",        dot: "var(--success)" },
};

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function edgeStroke(kind: EdgeKind) {
  switch (kind) {
    case "blocked":
      return "var(--danger)";
    case "optional":
      return "var(--muted)";
    default:
      return "var(--foreground)";
  }
}

function getEdgeAnchors(from: EngineNode, to: EngineNode) {
  const fromCenter = { x: from.x + from.w / 2, y: from.y + from.h / 2 };
  const toCenter = { x: to.x + to.w / 2, y: to.y + to.h / 2 };

  const dx = toCenter.x - fromCenter.x;
  const dy = toCenter.y - fromCenter.y;

  if (Math.abs(dx) >= Math.abs(dy)) {
    return {
      start: {
        x: dx >= 0 ? from.x + from.w : from.x,
        y: fromCenter.y,
      },
      end: {
        x: dx >= 0 ? to.x : to.x + to.w,
        y: toCenter.y,
      },
    };
  }

  return {
    start: {
      x: fromCenter.x,
      y: dy >= 0 ? from.y + from.h : from.y,
    },
    end: {
      x: toCenter.x,
      y: dy >= 0 ? to.y : to.y + to.h,
    },
  };
}

/* ── Legend ─────────────────────────────────────────────────── */

const legendItems: { tone: NodeTone; label: string }[] = [
  { tone: "client", label: "Client" },
  { tone: "api", label: "API" },
  { tone: "engine", label: "Engine" },
  { tone: "ai", label: "AI" },
  { tone: "data", label: "Data" },
];

/* ── Component ─────────────────────────────────────────────── */

export function EngineCanvas({ worlds }: { worlds: VisibleWorld[] }) {
  const viewportRef = useRef<HTMLDivElement | null>(null);

  const [view, setView] = useState<EngineView>("architecture");
  const [nodes, setNodes] = useState<EngineNode[]>(initialNodes);
  const [camera, setCamera] = useState({ x: -140, y: -120 });
  const [zoom, setZoom] = useState(0.78);
  const [dragState, setDragState] = useState<DragState>(null);

  const [traceWorldId, setTraceWorldId] = useState(worlds[0]?.id ?? "");
  const [traceRoleId, setTraceRoleId] = useState(worlds[0]?.roles[0]?.id ?? "");
  const [traceText, setTraceText] = useState(
    "Hold open court, hear the chancellor, and reduce taxes on grain this week.",
  );
  const [traceResult, setTraceResult] = useState<TraceResponse | null>(null);
  const [traceError, setTraceError] = useState<string | null>(null);
  const [isTracing, startTracing] = useTransition();

  const nodeLookup = useMemo(() => {
    return Object.fromEntries(nodes.map((node) => [node.id, node]));
  }, [nodes]);

  const selectedTraceWorld = useMemo(
    () => worlds.find((world) => world.id === traceWorldId) ?? null,
    [traceWorldId, worlds],
  );

  function updateTraceWorld(worldId: string) {
    setTraceWorldId(worldId);
    const world = worlds.find((candidate) => candidate.id === worldId);
    setTraceRoleId(world?.roles[0]?.id ?? "");
  }

  function clientToWorld(clientX: number, clientY: number) {
    const rect = viewportRef.current?.getBoundingClientRect();
    if (!rect) return { x: 0, y: 0 };
    return {
      x: (clientX - rect.left - camera.x) / zoom,
      y: (clientY - rect.top - camera.y) / zoom,
    };
  }

  function startPan(event: PointerEvent<HTMLDivElement>) {
    if (event.button !== 0) return;
    const target = event.target as HTMLElement;
    if (target.closest("[data-pan-ignore='true']")) return;

    event.preventDefault();
    viewportRef.current?.setPointerCapture(event.pointerId);
    setDragState({
      type: "pan",
      pointerId: event.pointerId,
      startClientX: event.clientX,
      startClientY: event.clientY,
      originX: camera.x,
      originY: camera.y,
    });
  }

  function startNodeDrag(event: PointerEvent<HTMLElement>, nodeId: string) {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();

    const targetNode = nodeLookup[nodeId];
    if (!targetNode) return;

    const worldPointer = clientToWorld(event.clientX, event.clientY);
    viewportRef.current?.setPointerCapture(event.pointerId);

    setDragState({
      type: "node",
      pointerId: event.pointerId,
      nodeId,
      offsetX: worldPointer.x - targetNode.x,
      offsetY: worldPointer.y - targetNode.y,
    });
  }

  function onPointerMove(event: PointerEvent<HTMLDivElement>) {
    if (!dragState || dragState.pointerId !== event.pointerId) return;

    if (dragState.type === "pan") {
      setCamera({
        x: dragState.originX + (event.clientX - dragState.startClientX),
        y: dragState.originY + (event.clientY - dragState.startClientY),
      });
      return;
    }

    const worldPointer = clientToWorld(event.clientX, event.clientY);
    setNodes((current) =>
      current.map((node) =>
        node.id !== dragState.nodeId
          ? node
          : { ...node, x: worldPointer.x - dragState.offsetX, y: worldPointer.y - dragState.offsetY },
      ),
    );
  }

  function stopDragging(event: PointerEvent<HTMLDivElement>) {
    if (!dragState || dragState.pointerId !== event.pointerId) return;
    if (viewportRef.current?.hasPointerCapture(event.pointerId)) {
      viewportRef.current.releasePointerCapture(event.pointerId);
    }
    setDragState(null);
  }

  function onWheel(event: WheelEvent<HTMLDivElement>) {
    event.preventDefault();
    const rect = viewportRef.current?.getBoundingClientRect();
    if (!rect) return;

    const pointerX = event.clientX - rect.left;
    const pointerY = event.clientY - rect.top;

    setZoom((previousZoom) => {
      const nextZoom = clamp(
        event.deltaY < 0 ? previousZoom * 1.09 : previousZoom * 0.91,
        0.45,
        1.85,
      );
      setCamera((previousCamera) => {
        const worldX = (pointerX - previousCamera.x) / previousZoom;
        const worldY = (pointerY - previousCamera.y) / previousZoom;
        return {
          x: pointerX - worldX * nextZoom,
          y: pointerY - worldY * nextZoom,
        };
      });
      return nextZoom;
    });
  }

  function runTrace() {
    if (!traceWorldId || !traceRoleId || !traceText.trim()) {
      setTraceError("World, role, and input text are required.");
      return;
    }

    setTraceError(null);
    startTracing(async () => {
      const response = await fetch("/api/engine/trace", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          worldId: traceWorldId,
          roleId: traceRoleId,
          mode: "text",
          text: traceText,
        }),
      });

      const payload = (await response.json()) as TraceResponse | { error?: string };
      if (!response.ok) {
        setTraceResult(null);
        setTraceError((payload as { error?: string }).error ?? "Failed to generate trace.");
        return;
      }
      setTraceResult(payload as TraceResponse);
    });
  }

  /* ── Shared inline styles ────────────────────────────────── */

  const panelStyle: React.CSSProperties = {
    background: "var(--panel)",
    backdropFilter: "blur(16px)",
    border: "1px solid var(--border)",
    boxShadow: "0 24px 80px var(--shadow)",
    borderRadius: "0.75rem",
  };

  const labelStyle: React.CSSProperties = {
    fontFamily: "var(--font-mono)",
    fontSize: "0.65rem",
    fontWeight: 600,
    letterSpacing: "0.12em",
    textTransform: "uppercase",
    color: "var(--muted)",
  };

  const inputStyle: React.CSSProperties = {
    width: "100%",
    padding: "0.5rem 0.75rem",
    borderRadius: "0.5rem",
    border: "1px solid var(--border)",
    background: "var(--panel)",
    color: "var(--foreground)",
    fontSize: "0.8125rem",
    outline: "none",
  };

  const pillBase: React.CSSProperties = {
    padding: "0.375rem 0.875rem",
    borderRadius: "9999px",
    border: "1px solid var(--border)",
    fontSize: "0.8125rem",
    cursor: "pointer",
    transition: "background 150ms, border-color 150ms, color 150ms",
  };

  const pillActive: React.CSSProperties = {
    ...pillBase,
    background: "var(--accent-soft)",
    borderColor: "var(--accent)",
    color: "var(--accent-strong)",
    fontWeight: 600,
  };

  const pillInactive: React.CSSProperties = {
    ...pillBase,
    background: "transparent",
    color: "var(--foreground)",
    fontWeight: 400,
  };

  const smallBtnStyle: React.CSSProperties = {
    padding: "0.25rem 0.625rem",
    borderRadius: "0.375rem",
    border: "1px solid var(--border)",
    background: "var(--panel)",
    color: "var(--foreground)",
    fontSize: "0.75rem",
    cursor: "pointer",
    transition: "background 150ms",
  };

  return (
    <div>
      {/* Page header */}
      <div style={{ marginBottom: "1.5rem" }}>
        <h1 style={{ fontSize: "1.5rem", fontWeight: 700 }}>Engine</h1>
        <p style={{ color: "var(--muted)", fontSize: "0.8125rem", marginTop: "0.25rem" }}>
          Architecture map and execution trace for the simulation pipeline.
        </p>
      </div>

      {/* Toolbar */}
      <div
        data-pan-ignore="true"
        style={{
          ...panelStyle,
          padding: "0.75rem 1rem",
          marginBottom: "1rem",
          display: "flex",
          flexWrap: "wrap",
          alignItems: "center",
          gap: "0.5rem",
        }}
      >
        <button
          type="button"
          onClick={() => setView("architecture")}
          style={view === "architecture" ? pillActive : pillInactive}
        >
          Architecture Map
        </button>
        <button
          type="button"
          onClick={() => setView("trace")}
          style={view === "trace" ? pillActive : pillInactive}
        >
          Execution Trace
        </button>

        {view === "architecture" ? (
          <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: "0.375rem" }}>
            {legendItems.map((item) => (
              <span
                key={item.tone}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "0.25rem",
                  fontSize: "0.7rem",
                  color: "var(--muted)",
                  marginRight: "0.25rem",
                }}
              >
                <span
                  style={{
                    display: "inline-block",
                    width: 8,
                    height: 8,
                    borderRadius: "50%",
                    background: toneColors[item.tone].dot,
                  }}
                />
                {item.label}
              </span>
            ))}

            <span style={{ width: 1, height: 16, background: "var(--border)", margin: "0 0.25rem" }} />

            <button type="button" onClick={() => setZoom((c) => clamp(c * 1.12, 0.45, 1.85))} style={smallBtnStyle}>+</button>
            <button type="button" onClick={() => setZoom((c) => clamp(c * 0.9, 0.45, 1.85))} style={smallBtnStyle}>&minus;</button>
            <button
              type="button"
              onClick={() => { setZoom(0.78); setCamera({ x: -140, y: -120 }); }}
              style={smallBtnStyle}
            >
              Reset
            </button>
            <span style={{ ...labelStyle, padding: "0.25rem 0.5rem", borderRadius: "0.375rem", border: "1px solid var(--border)" }}>
              {Math.round(zoom * 100)}%
            </span>
          </div>
        ) : null}
      </div>

      {/* Architecture view */}
      {view === "architecture" ? (
        <div
          ref={viewportRef}
          style={{
            ...panelStyle,
            height: "calc(100vh - 14rem)",
            position: "relative",
            overflow: "hidden",
            cursor: dragState?.type === "pan" ? "grabbing" : "default",
            touchAction: "none",
          }}
          onPointerDown={startPan}
          onPointerMove={onPointerMove}
          onPointerUp={stopDragging}
          onPointerCancel={stopDragging}
          onWheel={onWheel}
        >
          {/* Grid */}
          <div
            style={{
              position: "absolute",
              inset: 0,
              backgroundImage:
                "linear-gradient(var(--border) 1px, transparent 1px), linear-gradient(90deg, var(--border) 1px, transparent 1px)",
              backgroundSize: `${32 * zoom}px ${32 * zoom}px`,
              backgroundPosition: `${camera.x}px ${camera.y}px`,
              opacity: 0.5,
            }}
            aria-hidden="true"
          />

          {/* World layer */}
          <div
            style={{
              position: "absolute",
              left: 0,
              top: 0,
              width: worldSize.width,
              height: worldSize.height,
              transform: `translate(${camera.x}px, ${camera.y}px) scale(${zoom})`,
              transformOrigin: "0 0",
            }}
          >
            {/* Edges */}
            <svg
              width={worldSize.width}
              height={worldSize.height}
              style={{ position: "absolute", left: 0, top: 0, pointerEvents: "none" }}
              viewBox={`0 0 ${worldSize.width} ${worldSize.height}`}
              fill="none"
              aria-hidden="true"
            >
              <defs>
                <marker
                  id="engine-arrow"
                  viewBox="0 0 10 10"
                  refX="8"
                  refY="5"
                  markerWidth="6"
                  markerHeight="6"
                  orient="auto-start-reverse"
                >
                  <path d="M 0 0 L 10 5 L 0 10 z" fill="var(--foreground)" fillOpacity="0.7" />
                </marker>
              </defs>

              {edges.map((edge) => {
                const from = nodeLookup[edge.from];
                const to = nodeLookup[edge.to];
                if (!from || !to) return null;

                const { start, end } = getEdgeAnchors(from, to);
                return (
                  <line
                    key={edge.id}
                    x1={start.x}
                    y1={start.y}
                    x2={end.x}
                    y2={end.y}
                    stroke={edgeStroke(edge.kind)}
                    strokeWidth={edge.kind === "optional" ? 2 : 2.5}
                    strokeDasharray={edge.kind === "optional" ? "12 10" : undefined}
                    strokeOpacity={edge.kind === "optional" ? 0.5 : 0.7}
                    markerEnd="url(#engine-arrow)"
                  />
                );
              })}
            </svg>

            {/* Nodes */}
            {nodes.map((node) => {
              const tone = toneColors[node.tone];
              return (
                <article
                  key={node.id}
                  style={{
                    position: "absolute",
                    left: node.x,
                    top: node.y,
                    width: node.w,
                    minHeight: node.h,
                    padding: "1rem",
                    borderRadius: "0.75rem",
                    border: `1.5px solid ${tone.border}`,
                    background: "var(--panel)",
                    backdropFilter: "blur(12px)",
                    boxShadow: "0 12px 32px var(--shadow)",
                    cursor: dragState?.type === "node" && dragState.nodeId === node.id ? "grabbing" : "grab",
                    userSelect: "none",
                  }}
                  onPointerDown={(event) => startNodeDrag(event, node.id)}
                >
                  <div style={{ display: "flex", alignItems: "flex-start", gap: "0.5rem" }}>
                    <span
                      style={{
                        display: "inline-block",
                        width: 10,
                        height: 10,
                        borderRadius: "50%",
                        background: tone.dot,
                        marginTop: 4,
                        flexShrink: 0,
                      }}
                    />
                    <span style={{ fontSize: "0.875rem", fontWeight: 600, lineHeight: 1.4, color: "var(--foreground)" }}>
                      {node.title}
                    </span>
                  </div>
                  <p style={{ marginTop: "0.5rem", fontSize: "0.8rem", lineHeight: 1.5, color: "var(--muted)" }}>
                    {node.detail}
                  </p>
                </article>
              );
            })}
          </div>
        </div>
      ) : (
        /* Trace view */
        <div style={{ display: "grid", gap: "1rem", gridTemplateColumns: "minmax(280px, 340px) 1fr" }}>
          {/* Trace form */}
          <aside style={{ ...panelStyle, padding: "1.25rem" }}>
            <h2 style={{ fontSize: "1rem", fontWeight: 600 }}>Run Turn Trace</h2>
            <p style={{ color: "var(--muted)", fontSize: "0.8125rem", marginTop: "0.375rem", lineHeight: 1.5 }}>
              Submit a sample turn and inspect each transformation step.
            </p>

            <div style={{ marginTop: "1rem", display: "flex", flexDirection: "column", gap: "0.875rem" }}>
              <div>
                <label style={labelStyle}>World</label>
                <select
                  value={traceWorldId}
                  onChange={(event) => updateTraceWorld(event.target.value)}
                  style={{ ...inputStyle, marginTop: "0.375rem" }}
                >
                  {worlds.map((world) => (
                    <option key={world.id} value={world.id}>{world.title}</option>
                  ))}
                </select>
              </div>

              <div>
                <label style={labelStyle}>Role</label>
                <select
                  value={traceRoleId}
                  onChange={(event) => setTraceRoleId(event.target.value)}
                  style={{ ...inputStyle, marginTop: "0.375rem" }}
                >
                  {(selectedTraceWorld?.roles ?? []).map((role) => (
                    <option key={role.id} value={role.id}>{role.title}</option>
                  ))}
                </select>
              </div>

              <div>
                <label style={labelStyle}>Input Text</label>
                <textarea
                  value={traceText}
                  onChange={(event) => setTraceText(event.target.value)}
                  placeholder="Enter a turn request..."
                  style={{
                    ...inputStyle,
                    marginTop: "0.375rem",
                    minHeight: "8rem",
                    resize: "vertical",
                    lineHeight: 1.5,
                  }}
                />
              </div>

              <button
                type="button"
                onClick={runTrace}
                disabled={isTracing || worlds.length === 0}
                style={{
                  width: "100%",
                  padding: "0.5rem 1rem",
                  borderRadius: "0.5rem",
                  border: "1px solid var(--accent)",
                  background: "var(--accent-soft)",
                  color: "var(--accent-strong)",
                  fontSize: "0.8125rem",
                  fontWeight: 600,
                  cursor: isTracing ? "not-allowed" : "pointer",
                  opacity: isTracing || worlds.length === 0 ? 0.6 : 1,
                  transition: "opacity 150ms",
                }}
              >
                {isTracing ? "Tracing..." : "Run Execution Trace"}
              </button>

              {traceError ? (
                <p style={{ fontSize: "0.8125rem", color: "var(--danger)" }}>{traceError}</p>
              ) : null}
            </div>
          </aside>

          {/* Trace results */}
          <div style={{ ...panelStyle, padding: "1.25rem" }}>
            {traceResult ? (
              <>
                {/* Metadata */}
                <div
                  style={{
                    padding: "0.875rem",
                    borderRadius: "0.5rem",
                    border: "1px solid var(--border)",
                    background: "var(--panel)",
                  }}
                >
                  <p style={labelStyle}>Trace Metadata</p>
                  <div
                    style={{
                      marginTop: "0.5rem",
                      display: "grid",
                      gridTemplateColumns: "1fr 1fr",
                      gap: "0.375rem",
                      fontSize: "0.8125rem",
                      color: "var(--foreground)",
                    }}
                  >
                    <p>World: {traceResult.meta.worldTitle}</p>
                    <p>Role: {traceResult.meta.roleTitle}</p>
                    <p>Generation: {traceResult.meta.generationMode}</p>
                    <p>Persistence: {traceResult.meta.persistenceMode}</p>
                  </div>
                </div>

                {/* Steps */}
                <div style={{ marginTop: "1rem", display: "flex", flexDirection: "column", gap: "0.75rem" }}>
                  {traceResult.trace.map((step, index) => (
                    <section
                      key={`${step.id}:${index}`}
                      style={{
                        padding: "0.875rem",
                        borderRadius: "0.5rem",
                        border: "1px solid var(--border)",
                      }}
                    >
                      <p style={labelStyle}>Step {index + 1}</p>
                      <h3 style={{ marginTop: "0.25rem", fontSize: "0.875rem", fontWeight: 600 }}>
                        {step.label}
                      </h3>
                      <pre
                        style={{
                          marginTop: "0.625rem",
                          padding: "0.75rem",
                          borderRadius: "0.375rem",
                          border: "1px solid var(--border)",
                          background: "var(--background)",
                          fontSize: "0.75rem",
                          lineHeight: 1.5,
                          overflow: "auto",
                          fontFamily: "var(--font-mono)",
                          color: "var(--foreground)",
                        }}
                      >
                        {JSON.stringify(step.data, null, 2)}
                      </pre>
                    </section>
                  ))}
                </div>
              </>
            ) : (
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  minHeight: 420,
                  borderRadius: "0.5rem",
                  border: "1px dashed var(--border)",
                  color: "var(--muted)",
                  fontSize: "0.875rem",
                  textAlign: "center",
                  padding: "1.5rem",
                }}
              >
                Run a trace to inspect the complete pipeline data flow.
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
