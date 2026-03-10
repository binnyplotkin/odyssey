"use client";

import Link from "next/link";
import { PointerEvent, WheelEvent, useMemo, useRef, useState, useTransition } from "react";
import { VisibleWorld } from "@/types/simulation";

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

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function nodeToneClasses(tone: NodeTone) {
  switch (tone) {
    case "client":
      return "border-cyan-300/90";
    case "api":
      return "border-indigo-300/90";
    case "engine":
      return "border-amber-300/90";
    case "ai":
      return "border-violet-300/90";
    case "data":
      return "border-emerald-300/90";
    default:
      return "border-white/80";
  }
}

function dotToneClasses(tone: NodeTone) {
  switch (tone) {
    case "client":
      return "bg-cyan-300";
    case "api":
      return "bg-indigo-300";
    case "engine":
      return "bg-amber-300";
    case "ai":
      return "bg-violet-300";
    case "data":
      return "bg-emerald-300";
    default:
      return "bg-white";
  }
}

function edgeStroke(kind: EdgeKind) {
  switch (kind) {
    case "blocked":
      return "rgba(251, 113, 133, 0.95)";
    case "optional":
      return "rgba(196, 181, 253, 0.98)";
    default:
      return "rgba(248, 250, 252, 0.95)";
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

    if (!rect) {
      return { x: 0, y: 0 };
    }

    return {
      x: (clientX - rect.left - camera.x) / zoom,
      y: (clientY - rect.top - camera.y) / zoom,
    };
  }

  function startPan(event: PointerEvent<HTMLDivElement>) {
    if (event.button !== 0) {
      return;
    }

    const target = event.target as HTMLElement;
    if (target.closest("[data-pan-ignore='true']")) {
      return;
    }

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
    if (event.button !== 0) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();

    const targetNode = nodeLookup[nodeId];

    if (!targetNode) {
      return;
    }

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
    if (!dragState || dragState.pointerId !== event.pointerId) {
      return;
    }

    if (dragState.type === "pan") {
      const deltaX = event.clientX - dragState.startClientX;
      const deltaY = event.clientY - dragState.startClientY;

      setCamera({
        x: dragState.originX + deltaX,
        y: dragState.originY + deltaY,
      });
      return;
    }

    const worldPointer = clientToWorld(event.clientX, event.clientY);

    setNodes((current) =>
      current.map((node) => {
        if (node.id !== dragState.nodeId) {
          return node;
        }

        return {
          ...node,
          x: worldPointer.x - dragState.offsetX,
          y: worldPointer.y - dragState.offsetY,
        };
      }),
    );
  }

  function stopDragging(event: PointerEvent<HTMLDivElement>) {
    if (!dragState || dragState.pointerId !== event.pointerId) {
      return;
    }

    if (viewportRef.current?.hasPointerCapture(event.pointerId)) {
      viewportRef.current.releasePointerCapture(event.pointerId);
    }

    setDragState(null);
  }

  function onWheel(event: WheelEvent<HTMLDivElement>) {
    event.preventDefault();

    const rect = viewportRef.current?.getBoundingClientRect();

    if (!rect) {
      return;
    }

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

  return (
    <main className="h-screen w-screen bg-[#030811] text-white">
      <header
        data-pan-ignore="true"
        className="absolute left-4 top-4 z-30 w-[min(980px,calc(100vw-2rem))] rounded-2xl border border-white/25 bg-[#050b17]/88 px-4 py-3 backdrop-blur"
      >
        <div className="flex flex-wrap items-center gap-3">
          <p className="font-mono text-[11px] uppercase tracking-[0.3em] text-slate-300">Engine</p>
          <h1 className="text-lg font-semibold text-white">Pandora&apos;s Box</h1>
          <div className="ml-auto flex gap-2">
            <Link
              href="/"
              className="rounded-full border border-white/30 bg-white/10 px-4 py-1.5 text-sm text-white transition hover:bg-white/20"
            >
              Landing
            </Link>
          </div>
        </div>

        <div className="mt-3 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => setView("architecture")}
            className={`rounded-full border px-4 py-1.5 text-sm transition ${
              view === "architecture"
                ? "border-cyan-300/90 bg-cyan-400/20 text-cyan-100"
                : "border-white/30 bg-white/8 text-white/85 hover:bg-white/16"
            }`}
          >
            Architecture Map
          </button>
          <button
            type="button"
            onClick={() => setView("trace")}
            className={`rounded-full border px-4 py-1.5 text-sm transition ${
              view === "trace"
                ? "border-violet-300/90 bg-violet-400/20 text-violet-100"
                : "border-white/30 bg-white/8 text-white/85 hover:bg-white/16"
            }`}
          >
            Execution Trace
          </button>

          {view === "architecture" ? (
            <div className="ml-auto flex flex-wrap items-center gap-2 text-xs">
              <button
                type="button"
                onClick={() => setZoom((current) => clamp(current * 1.12, 0.45, 1.85))}
                className="rounded-lg border border-white/30 bg-white/10 px-2.5 py-1.5 text-white"
              >
                Zoom +
              </button>
              <button
                type="button"
                onClick={() => setZoom((current) => clamp(current * 0.9, 0.45, 1.85))}
                className="rounded-lg border border-white/30 bg-white/10 px-2.5 py-1.5 text-white"
              >
                Zoom -
              </button>
              <button
                type="button"
                onClick={() => {
                  setZoom(0.78);
                  setCamera({ x: -140, y: -120 });
                }}
                className="rounded-lg border border-white/30 bg-white/10 px-2.5 py-1.5 text-white"
              >
                Reset View
              </button>
              <span className="rounded-lg border border-white/20 px-2.5 py-1.5 text-slate-100">
                {Math.round(zoom * 100)}%
              </span>
            </div>
          ) : null}
        </div>
      </header>

      {view === "architecture" ? (
        <div
          ref={viewportRef}
          className={`relative h-full w-full overflow-hidden ${
            dragState?.type === "pan" ? "cursor-grabbing" : "cursor-default"
          }`}
          style={{ touchAction: "none" }}
          onPointerDown={startPan}
          onPointerMove={onPointerMove}
          onPointerUp={stopDragging}
          onPointerCancel={stopDragging}
          onWheel={onWheel}
        >
          <div
            className="absolute inset-0"
            style={{
              backgroundColor: "#040b17",
              backgroundImage:
                "linear-gradient(rgba(255,255,255,0.08) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.08) 1px, transparent 1px)",
              backgroundSize: `${32 * zoom}px ${32 * zoom}px`,
              backgroundPosition: `${camera.x}px ${camera.y}px`,
            }}
            aria-hidden="true"
          />

          <div
            className="absolute left-0 top-0"
            style={{
              width: `${worldSize.width}px`,
              height: `${worldSize.height}px`,
              transform: `translate(${camera.x}px, ${camera.y}px) scale(${zoom})`,
              transformOrigin: "0 0",
            }}
          >
            <svg
              width={worldSize.width}
              height={worldSize.height}
              className="pointer-events-none absolute left-0 top-0"
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
                  <path d="M 0 0 L 10 5 L 0 10 z" fill="rgba(248, 250, 252, 0.96)" />
                </marker>
              </defs>

              {edges.map((edge) => {
                const from = nodeLookup[edge.from];
                const to = nodeLookup[edge.to];

                if (!from || !to) {
                  return null;
                }

                const { start, end } = getEdgeAnchors(from, to);

                return (
                  <line
                    key={edge.id}
                    x1={start.x}
                    y1={start.y}
                    x2={end.x}
                    y2={end.y}
                    stroke={edgeStroke(edge.kind)}
                    strokeWidth={edge.kind === "optional" ? 2.5 : 3}
                    strokeDasharray={edge.kind === "optional" ? "12 10" : undefined}
                    markerEnd="url(#engine-arrow)"
                  />
                );
              })}
            </svg>

            {nodes.map((node) => (
              <article
                key={node.id}
                className={`absolute select-none rounded-2xl border bg-[#050c1a]/95 p-4 shadow-[0_18px_40px_rgba(0,0,0,0.65)] ${nodeToneClasses(node.tone)} ${
                  dragState?.type === "node" && dragState.nodeId === node.id ? "cursor-grabbing" : "cursor-grab"
                }`}
                style={{
                  left: `${node.x}px`,
                  top: `${node.y}px`,
                  width: `${node.w}px`,
                  minHeight: `${node.h}px`,
                }}
                onPointerDown={(event) => startNodeDrag(event, node.id)}
              >
                <div className="flex items-start gap-2">
                  <span className={`mt-1 inline-block h-2.5 w-2.5 shrink-0 rounded-full ${dotToneClasses(node.tone)}`} />
                  <h2 className="text-base font-semibold leading-6 text-white">{node.title}</h2>
                </div>
                <p className="mt-2 text-[13px] leading-6 text-slate-100">{node.detail}</p>
              </article>
            ))}
          </div>
        </div>
      ) : (
        <section className="h-full overflow-auto px-4 pb-8 pt-36 md:px-8">
          <div className="mx-auto grid w-full max-w-[1400px] gap-6 lg:grid-cols-[360px_1fr]">
            <aside className="rounded-2xl border border-white/25 bg-[#050b17]/88 p-4 md:p-5">
              <h2 className="text-lg font-semibold text-white">Run Turn Trace</h2>
              <p className="mt-2 text-sm leading-6 text-slate-200">
                Submit a sample turn and inspect each transformation step from validation through response payload.
              </p>

              <div className="mt-4 space-y-4">
                <div>
                  <label className="font-mono text-xs uppercase tracking-[0.22em] text-slate-300">World</label>
                  <select
                    value={traceWorldId}
                    onChange={(event) => updateTraceWorld(event.target.value)}
                    className="mt-2 w-full rounded-xl border border-white/25 bg-white/10 px-3 py-2 text-sm text-white outline-none"
                  >
                    {worlds.map((world) => (
                      <option key={world.id} value={world.id} className="bg-slate-900">
                        {world.title}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="font-mono text-xs uppercase tracking-[0.22em] text-slate-300">Role</label>
                  <select
                    value={traceRoleId}
                    onChange={(event) => setTraceRoleId(event.target.value)}
                    className="mt-2 w-full rounded-xl border border-white/25 bg-white/10 px-3 py-2 text-sm text-white outline-none"
                  >
                    {(selectedTraceWorld?.roles ?? []).map((role) => (
                      <option key={role.id} value={role.id} className="bg-slate-900">
                        {role.title}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="font-mono text-xs uppercase tracking-[0.22em] text-slate-300">Input Text</label>
                  <textarea
                    value={traceText}
                    onChange={(event) => setTraceText(event.target.value)}
                    className="mt-2 min-h-36 w-full rounded-xl border border-white/25 bg-white/10 px-3 py-3 text-sm leading-6 text-white outline-none placeholder:text-slate-400"
                    placeholder="Enter a turn request..."
                  />
                </div>

                <button
                  type="button"
                  onClick={runTrace}
                  disabled={isTracing || worlds.length === 0}
                  className="w-full rounded-xl border border-violet-300/70 bg-violet-500/20 px-4 py-2.5 text-sm font-semibold text-violet-100 transition hover:bg-violet-500/30 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {isTracing ? "Tracing..." : "Run Execution Trace"}
                </button>

                {traceError ? <p className="text-sm text-rose-300">{traceError}</p> : null}
              </div>
            </aside>

            <div className="rounded-2xl border border-white/25 bg-[#050b17]/88 p-4 md:p-5">
              {traceResult ? (
                <>
                  <div className="rounded-xl border border-white/20 bg-white/8 p-4">
                    <p className="font-mono text-xs uppercase tracking-[0.22em] text-slate-300">Trace Metadata</p>
                    <div className="mt-2 grid gap-2 text-sm text-slate-100 md:grid-cols-2">
                      <p>World: {traceResult.meta.worldTitle}</p>
                      <p>Role: {traceResult.meta.roleTitle}</p>
                      <p>Generation: {traceResult.meta.generationMode}</p>
                      <p>Persistence: {traceResult.meta.persistenceMode}</p>
                    </div>
                  </div>

                  <div className="mt-4 space-y-4">
                    {traceResult.trace.map((step, index) => (
                      <section key={`${step.id}:${index}`} className="rounded-xl border border-white/20 bg-white/7 p-4">
                        <p className="font-mono text-xs uppercase tracking-[0.22em] text-slate-300">
                          Step {index + 1}
                        </p>
                        <h3 className="mt-1 text-base font-semibold text-white">{step.label}</h3>
                        <pre className="mt-3 overflow-x-auto rounded-lg border border-white/15 bg-[#020611] p-3 text-xs leading-5 text-slate-100">
                          {JSON.stringify(step.data, null, 2)}
                        </pre>
                      </section>
                    ))}
                  </div>
                </>
              ) : (
                <div className="flex min-h-[420px] items-center justify-center rounded-xl border border-dashed border-white/25 bg-white/5 p-6 text-center text-slate-300">
                  Run a trace to inspect the complete pipeline data creation flow.
                </div>
              )}
            </div>
          </div>
        </section>
      )}
    </main>
  );
}
