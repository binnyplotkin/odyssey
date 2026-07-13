"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState, useTransition } from "react";
import type { CSSProperties, FormEvent } from "react";
import { useRouter } from "next/navigation";
import {
  Background,
  BackgroundVariant,
  Controls,
  ReactFlow,
  ReactFlowProvider,
  useNodesState,
  type Edge as FlowEdge,
  type Node as FlowNode,
  type NodeProps,
  type NodeTypes,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import type {
  SceneGraphPayload,
  SceneLibraryCharacter,
  SceneLibrarySound,
  SceneRosterEntry,
} from "@/app/(authenticated)/scenes/[sceneId]/page";
import {
  addAudioToScene,
  addCharacterToScene,
  addEventToScene,
  archiveScene,
  removeSceneNode,
  updateSceneConfig,
  updateSceneNode,
} from "@/app/(authenticated)/scenes/actions";
import {
  AdminButton,
  AdminPageShell,
  AdminRightRail,
  AdminStatusPill,
  adminTokens,
} from "@/components/admin-ui";
import { CharacterNodeCard } from "@/components/character-node-card";
import { Pathname } from "@/components/pathname";
import { useHeaderContent } from "@/components/header-context";
import { VoiceLibraryPicker, type PickerVoice } from "@/components/voice-library-picker";
import { DEFAULT_CHAT_MODEL } from "@/lib/model-registry";

const ROOT_NODE_ID = "__scene";

const T = {
  fg: adminTokens.fg,
  muted: adminTokens.muted,
  panel: adminTokens.panel,
  panelStrong: adminTokens.panelStrong,
  border: adminTokens.border,
  accent: adminTokens.accent,
  accentSoft: adminTokens.accentSoft,
  danger: adminTokens.danger,
  dangerSoft: adminTokens.dangerFill,
  fontHeading: adminTokens.fontBody,
  fontBody: adminTokens.fontBody,
  fontMono: adminTokens.fontMono,
} as const;

type SceneEditorProps = {
  scene: {
    id: string;
    title: string;
    prompt: string;
    status: "draft" | "active" | "archived";
    openingBeat: string;
    defaultAmbience: string | null;
    narratorVoiceId: string | null;
    objective: string | null;
    drive: "gentle" | "balanced" | "insistent" | null;
  };
  roster: SceneRosterEntry[];
  graph: SceneGraphPayload;
  libraryCharacters: SceneLibraryCharacter[];
  librarySounds: SceneLibrarySound[];
};

type SceneNodeData = {
  type: "scene";
  title: string;
  status: SceneEditorProps["scene"]["status"];
  prompt: string;
  openingBeat: string;
  castCount: number;
};

type GraphNodeData = {
  type: "graph";
  node: SceneGraphPayload["nodes"][number];
  character: SceneLibraryCharacter | null;
  sound: SceneLibrarySound | null;
  voiceOptions: PickerVoice[];
};

type SceneFlowData = SceneNodeData | GraphNodeData;

const nodeTypes: NodeTypes = {
  scene: SceneRootNode,
  graph: SceneGraphNode,
};

export function SceneEditor({
  scene,
  roster,
  graph,
  libraryCharacters,
  librarySounds,
}: SceneEditorProps) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [saved, setSaved] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(ROOT_NODE_ID);

  const [title, setTitle] = useState(scene.title);
  const [prompt, setPrompt] = useState(scene.prompt);
  const [status, setStatus] = useState(scene.status);
  const [openingBeat, setOpeningBeat] = useState(scene.openingBeat);
  const [defaultAmbience, setDefaultAmbience] = useState(scene.defaultAmbience ?? "");
  const [narratorVoiceId, setNarratorVoiceId] = useState(scene.narratorVoiceId);
  const [objective, setObjective] = useState(scene.objective ?? "");
  const [drive, setDrive] = useState<"gentle" | "balanced" | "insistent">(
    scene.drive ?? "balanced",
  );
  const [graphNodes, setGraphNodes] = useState(graph.nodes);

  useEffect(() => setGraphNodes(graph.nodes), [graph.nodes]);

  const [voiceOptions, setVoiceOptions] = useState<PickerVoice[]>([]);
  useEffect(() => {
    let cancelled = false;
    fetch("/api/voices")
      .then((r) => r.json())
      .then((data: { voices: PickerVoice[] }) => {
        if (cancelled) return;
        setVoiceOptions(data.voices.filter((v) => v.status === "ready"));
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  const characterById = useMemo(() => {
    const map = new Map<string, SceneLibraryCharacter>();
    for (const character of libraryCharacters) map.set(character.id, character);
    return map;
  }, [libraryCharacters]);

  const soundById = useMemo(() => {
    const map = new Map<string, SceneLibrarySound>();
    for (const sound of librarySounds) map.set(sound.id, sound);
    return map;
  }, [librarySounds]);

  const rosterCharacterIds = useMemo(
    () => new Set(graphNodes.filter((n) => n.kind === "character" && n.refId).map((n) => n.refId!)),
    [graphNodes],
  );
  const addableCharacters = useMemo(
    () => libraryCharacters.filter((c) => !rosterCharacterIds.has(c.id)),
    [libraryCharacters, rosterCharacterIds],
  );

  const selectedGraphNode = useMemo(
    () => graphNodes.find((n) => n.id === selectedNodeId) ?? null,
    [graphNodes, selectedNodeId],
  );

  const saveConfig = useCallback(
    (event?: FormEvent) => {
      event?.preventDefault();
      setSaved(false);
      start(async () => {
        const res = await updateSceneConfig(scene.id, {
          title: title.trim(),
          prompt,
          status,
          openingBeat,
          defaultAmbience: defaultAmbience.trim() || null,
          narratorVoiceId,
          objective: objective.trim() || null,
          drive: drive === "balanced" ? null : drive,
        });
        if (res.ok) setSaved(true);
        router.refresh();
      });
    },
    [
      defaultAmbience,
      narratorVoiceId,
      openingBeat,
      objective,
      drive,
      prompt,
      router,
      scene.id,
      status,
      title,
    ],
  );

  const saveTitle = useCallback(
    async (next: string) => {
      setTitle(next);
      const res = await updateSceneConfig(scene.id, { title: next.trim() });
      if (res.ok) {
        setSaved(true);
        router.refresh();
      }
    },
    [router, scene.id],
  );

  const addCharacter = useCallback(
    (characterId: string) => {
      if (!characterId) return;
      start(async () => {
        await addCharacterToScene(scene.id, characterId);
        router.refresh();
      });
    },
    [router, scene.id],
  );

  const addAudio = useCallback(
    (input: {
      assetId: string;
      role: "bed" | "oneshot";
      isDefault?: boolean;
      triggerHint?: string;
    }) => {
      start(async () => {
        await addAudioToScene(scene.id, input);
        router.refresh();
      });
    },
    [router, scene.id],
  );

  const addEvent = useCallback(
    (input: { label: string; summary?: string }) => {
      // Next slot in the arc: max existing timeIndex + 1 (0-based start).
      const timeIndex =
        graphNodes
          .filter((n) => n.kind === "event")
          .reduce(
            (max, n) =>
              typeof n.data.timeIndex === "number" && n.data.timeIndex > max
                ? n.data.timeIndex
                : max,
            -1,
          ) + 1;
      start(async () => {
        await addEventToScene(scene.id, { ...input, timeIndex });
        router.refresh();
      });
    },
    [router, scene.id, graphNodes],
  );

  const removeCharacter = useCallback(
    (nodeId: string) => {
      start(async () => {
        await removeSceneNode(scene.id, nodeId);
        setSelectedNodeId(ROOT_NODE_ID);
        setSidebarOpen(true);
        router.refresh();
      });
    },
    [router, scene.id],
  );

  const archive = useCallback(() => {
    if (!confirm("Archive this scene? It will be hidden from the list.")) return;
    start(async () => {
      await archiveScene(scene.id);
      router.push("/scenes");
    });
  }, [router, scene.id]);

  const updateLocalNode = useCallback(
    (nodeId: string, patch: Partial<SceneGraphPayload["nodes"][number]>) => {
      setGraphNodes((prev) =>
        prev.map((node) => (node.id === nodeId ? { ...node, ...patch } : node)),
      );
    },
    [],
  );

  const { setFlush, setContent } = useHeaderContent();
  useEffect(() => {
    setFlush(true);
    return () => setFlush(false);
  }, [setFlush]);

  useEffect(() => {
    setContent(
      <ScenePageHeader
        sceneId={scene.id}
        title={title}
        status={status}
        onTitleChange={saveTitle}
        onArchive={archive}
        pending={pending}
      />,
    );
    return () => setContent(null);
  }, [archive, pending, saveTitle, scene.id, setContent, status, title]);

  return (
    <AdminPageShell
      style={{
        display: "flex",
        flexDirection: "row",
        gap: 0,
        minHeight: "calc(100vh - 48px)",
      }}
    >
      <SceneCanvas
        scene={{
          title,
          status,
          prompt,
          openingBeat,
          castCount: roster.length,
        }}
        sceneId={scene.id}
        nodes={graphNodes}
        edges={graph.edges}
        characterById={characterById}
        soundById={soundById}
        voiceOptions={voiceOptions}
        onSelectionChange={(id) => {
          setSelectedNodeId(id);
          setSidebarOpen(Boolean(id));
        }}
        onNodePositionChange={(nodeId, position) => {
          updateLocalNode(nodeId, { position });
        }}
      />

      {sidebarOpen && (
        <SceneInspector
          key={selectedNodeId ?? "none"}
          sceneId={scene.id}
          pending={pending}
          saved={saved}
          selectedNode={selectedGraphNode}
          selectedCharacter={
            selectedGraphNode?.kind === "character" && selectedGraphNode.refId
              ? characterById.get(selectedGraphNode.refId) ?? null
              : null
          }
          selectedSound={
            selectedGraphNode?.kind === "audio" && selectedGraphNode.refId
              ? soundById.get(selectedGraphNode.refId) ?? null
              : null
          }
          scene={{
            title,
            prompt,
            status,
            openingBeat,
            defaultAmbience,
            narratorVoiceId,
            objective,
            drive,
          }}
          rosterCount={roster.length}
          addableCharacters={addableCharacters}
          librarySounds={librarySounds}
          voiceOptions={voiceOptions}
          onSceneChange={{
            setTitle,
            setPrompt,
            setStatus,
            setOpeningBeat,
            setDefaultAmbience,
            setNarratorVoiceId,
            setObjective,
            setDrive,
            saveConfig,
          }}
          onAddCharacter={addCharacter}
          onAddAudio={addAudio}
          onAddEvent={addEvent}
          onRemoveCharacter={removeCharacter}
          onNodeSaved={updateLocalNode}
        />
      )}
    </AdminPageShell>
  );
}

function ScenePageHeader({
  sceneId,
  title,
  status,
  pending,
  onTitleChange,
  onArchive,
}: {
  sceneId: string;
  title: string;
  status: SceneEditorProps["scene"]["status"];
  pending: boolean;
  onTitleChange: (next: string) => void | Promise<void>;
  onArchive: () => void;
}) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        width: "100%",
        gap: "var(--space-16)",
      }}
    >
      <Pathname
        segments={[
          { label: "scenes", href: "/scenes" },
          {
            label: title,
            href: `/scenes/${sceneId}`,
            tag: true,
            editable: { onRename: onTitleChange, ariaLabel: "Scene name" },
          },
        ]}
      />
      <AdminStatusPill tone={status === "active" ? "success" : "muted"} dot>
        {status}
      </AdminStatusPill>
      <div style={{ flex: 1 }} />
      <Link href={`/scenes/${sceneId}/sandbox`} style={sandboxLinkStyle}>
        rehearse
      </Link>
      <button
        type="button"
        aria-label="Archive scene"
        title="Archive scene"
        disabled={pending}
        onClick={onArchive}
        style={headerIconButtonStyle}
      >
        <svg
          width="15"
          height="15"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden
        >
          <rect width="20" height="5" x="2" y="3" rx="1" />
          <path d="M4 8v11a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8" />
          <path d="M10 12h4" />
        </svg>
      </button>
    </div>
  );
}

function SceneCanvas({
  scene,
  sceneId,
  nodes,
  edges,
  characterById,
  soundById,
  voiceOptions,
  onSelectionChange,
  onNodePositionChange,
}: {
  scene: Omit<SceneNodeData, "type">;
  sceneId: string;
  nodes: SceneGraphPayload["nodes"];
  edges: SceneGraphPayload["edges"];
  characterById: Map<string, SceneLibraryCharacter>;
  soundById: Map<string, SceneLibrarySound>;
  voiceOptions: PickerVoice[];
  onSelectionChange: (id: string | null) => void;
  onNodePositionChange: (
    id: string,
    position: { x: number; y: number },
  ) => void;
}) {
  const initialNodes = useMemo<FlowNode<SceneFlowData>[]>(() => {
    const graphFlowNodes = nodes.map((node, index) => ({
      id: node.id,
      type: "graph",
      position: node.position ?? defaultNodePosition(index, node.kind),
      data: {
        type: "graph" as const,
        node,
        character:
          node.kind === "character" && node.refId
            ? characterById.get(node.refId) ?? null
            : null,
        sound:
          node.kind === "audio" && node.refId
            ? soundById.get(node.refId) ?? null
            : null,
        voiceOptions,
      },
      draggable: true,
    }));

    return [
      {
        id: ROOT_NODE_ID,
        type: "scene",
        position: { x: -340, y: -180 },
        selected: true,
        data: { type: "scene", ...scene },
        draggable: true,
      },
      ...graphFlowNodes,
    ];
  }, [characterById, soundById, nodes, scene, voiceOptions]);

  const [flowNodes, setFlowNodes, onNodesChange] =
    useNodesState<FlowNode<SceneFlowData>>(initialNodes);

  useEffect(() => {
    setFlowNodes((prev) => {
      const selected = new Set(prev.filter((n) => n.selected).map((n) => n.id));
      const positionById = new Map(prev.map((n) => [n.id, n.position]));
      return initialNodes.map((node) => ({
        ...node,
        selected: selected.has(node.id) || (selected.size === 0 && node.id === ROOT_NODE_ID),
        position: positionById.get(node.id) ?? node.position,
      }));
    });
  }, [initialNodes, setFlowNodes]);

  const flowEdges = useMemo<FlowEdge[]>(() => {
    const explicit = edges.map((edge) => ({
      id: edge.id,
      source: edge.fromNodeId,
      target: edge.toNodeId,
      label: edge.kind,
      style: { stroke: "var(--border-subtle)" },
      labelStyle: {
        fill: "var(--text-tertiary)",
        fontFamily: T.fontMono,
        fontSize: 10,
        letterSpacing: "0.08em",
        textTransform: "uppercase",
      },
    }));
    const hasRootEdge = new Set(explicit.flatMap((edge) => [edge.source, edge.target]));
    const rootEdges = nodes
      .filter((node) => !hasRootEdge.has(node.id))
      .map((node) => ({
        id: `${sceneId}:${ROOT_NODE_ID}:${node.id}`,
        source: ROOT_NODE_ID,
        target: node.id,
        style: {
          stroke: "color-mix(in srgb, var(--accent-strong) 28%, var(--border-subtle))",
          strokeDasharray: "5 6",
        },
      }));
    return [...explicit, ...rootEdges];
  }, [edges, nodes, sceneId]);

  return (
    <div
      style={{
        flex: "1 1 0",
        minWidth: 0,
        position: "relative",
        background: "var(--canvas-surface)",
      }}
    >
      <ReactFlowProvider>
        <ReactFlow
          nodes={flowNodes}
          edges={flowEdges}
          onNodesChange={onNodesChange}
          onSelectionChange={({ nodes: selected }) =>
            onSelectionChange(selected[0]?.id ?? null)
          }
          onNodeDragStop={(_, node) => {
            if (node.id === ROOT_NODE_ID) return;
            onNodePositionChange(node.id, node.position);
            void updateSceneNode(sceneId, node.id, { position: node.position });
          }}
          nodeTypes={nodeTypes}
          fitView
          fitViewOptions={{ padding: 0.32, maxZoom: 1, minZoom: 0.55 }}
          minZoom={0.3}
          maxZoom={1.6}
          proOptions={{ hideAttribution: true }}
          panOnScroll
          selectionOnDrag={false}
          style={{ background: "var(--canvas-surface)" }}
        >
          <Background
            variant={BackgroundVariant.Lines}
            gap={28}
            lineWidth={1}
            color="var(--grid-color)"
          />
          <Controls
            showInteractive={false}
            position="bottom-left"
            style={{ overflow: "hidden", border: "1px solid var(--border)" }}
          />
        </ReactFlow>
      </ReactFlowProvider>
    </div>
  );
}

function SceneRootNode({
  data,
  selected,
}: NodeProps<FlowNode<SceneNodeData>>) {
  return (
    <div
      style={{
        width: 420,
        padding: "var(--space-18)",
        borderRadius: "var(--radius-2xl)",
        border: selected
          ? "1.5px solid color-mix(in srgb, var(--accent-strong) 55%, transparent)"
          : "1px solid var(--border-subtle)",
        boxShadow: selected
          ? "0 0 0 3px color-mix(in srgb, var(--accent-strong) 12%, transparent), 0 14px 36px color-mix(in srgb, var(--accent-strong) 8%, transparent)"
          : "none",
        background: "var(--background)",
        display: "flex",
        flexDirection: "column",
        gap: "var(--space-14)",
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", gap: "var(--space-12)" }}>
        <span style={kickerStyle}>scene</span>
        <span style={{ ...kickerStyle, color: statusColor(data.status) }}>{data.status}</span>
      </div>
      <h3
        style={{
          margin: 0,
          color: T.fg,
          fontFamily: T.fontHeading,
          fontSize: "var(--font-size-2xl)",
          fontWeight: 600,
          lineHeight: "30px",
          overflowWrap: "anywhere",
        }}
      >
        {data.title}
      </h3>
      <p
        style={{
          margin: 0,
          color: "var(--text-secondary)",
          fontFamily: T.fontBody,
          fontSize: "var(--font-size-base)",
          lineHeight: "20px",
          display: "-webkit-box",
          WebkitLineClamp: 4,
          WebkitBoxOrient: "vertical",
          overflow: "hidden",
        }}
      >
        {data.prompt || data.openingBeat || "Scene premise is empty."}
      </p>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 8 }}>
        <Stat label="cast" value={`${data.castCount}`} />
        <Stat label="beat" value={data.openingBeat ? "set" : "empty"} />
      </div>
    </div>
  );
}

function SceneGraphNode({
  data,
  selected,
}: NodeProps<FlowNode<GraphNodeData>>) {
  const node = data.node;
  if (node.kind === "character" && data.character) {
    const boundVoice = data.character.voiceId
      ? data.voiceOptions.find((v) => v.id === data.character?.voiceId)
      : null;
    return (
      <CharacterNodeCard
        character={data.character}
        bindings={[]}
        activeModel={data.character.brainModel?.model ?? DEFAULT_CHAT_MODEL}
        voiceSlug={boundVoice?.slug ?? null}
        voiceProvider={boundVoice?.provider ?? null}
        state={selected ? "selected" : "ready"}
      />
    );
  }
  if (node.kind === "audio") {
    const role = asString(node.data.role) || "bed";
    const isDefault = node.data.isDefault === true;
    const triggerHint = asString(node.data.triggerHint);
    return (
      <div
        style={{
          width: 320,
          padding: "var(--space-16)",
          borderRadius: "var(--radius-xl)",
          border: selected
            ? "1.5px solid color-mix(in srgb, var(--accent-strong) 55%, transparent)"
            : "1px solid var(--border-subtle)",
          background: "var(--background)",
          boxShadow: selected
            ? "0 0 0 3px color-mix(in srgb, var(--accent-strong) 12%, transparent)"
            : "none",
          display: "flex",
          flexDirection: "column",
          gap: "var(--space-10)",
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", gap: "var(--space-8)" }}>
          <span style={kickerStyle}>audio · {role}</span>
          {isDefault && <span style={{ ...kickerStyle, color: T.accent }}>default</span>}
        </div>
        <strong
          style={{
            color: T.fg,
            fontFamily: T.fontHeading,
            fontSize: "var(--font-size-lg)",
            overflowWrap: "anywhere",
          }}
        >
          {data.sound?.name ?? node.label}
        </strong>
        <span style={{ color: T.accent, fontFamily: T.fontMono, fontSize: "var(--font-size-sm)" }}>
          {data.sound?.slug ?? node.refId ?? "missing asset"}
          {data.sound && data.sound.status !== "ready" && " · needs processing"}
        </span>
        <p style={{ margin: 0, color: T.muted, lineHeight: "19px" }}>
          {triggerHint
            ? `Cue: ${triggerHint}`
            : data.sound?.description ||
              node.summary ||
              (role === "bed" ? "Looped background bed." : "One-shot effect.")}
        </p>
      </div>
    );
  }
  if (node.kind === "event") {
    const timeIndex =
      typeof node.data.timeIndex === "number" ? node.data.timeIndex : null;
    return (
      <div
        style={{
          width: 300,
          padding: "var(--space-16)",
          borderRadius: "var(--radius-xl)",
          border: selected
            ? "1.5px solid color-mix(in srgb, var(--accent-strong) 55%, transparent)"
            : "1px solid var(--border-subtle)",
          background: "var(--background)",
          boxShadow: selected
            ? "0 0 0 3px color-mix(in srgb, var(--accent-strong) 12%, transparent)"
            : "none",
          display: "flex",
          flexDirection: "column",
          gap: "var(--space-8)",
        }}
      >
        <span style={kickerStyle}>
          arc{timeIndex !== null ? ` · beat ${timeIndex + 1}` : ""}
        </span>
        <strong
          style={{
            color: T.fg,
            fontFamily: T.fontHeading,
            fontSize: "var(--font-size-lg)",
            overflowWrap: "anywhere",
          }}
        >
          {node.label}
        </strong>
        <p style={{ margin: 0, color: T.muted, lineHeight: "19px", fontSize: "var(--font-size-sm)" }}>
          {node.summary || "What it looks like when this beat lands — add a summary."}
        </p>
      </div>
    );
  }
  if (node.kind === "ambience") {
    const trackId = asString(node.data.trackId);
    const isDefault = node.data.isDefault === true;
    return (
      <div
        style={{
          width: 320,
          padding: "var(--space-16)",
          borderRadius: "var(--radius-xl)",
          border: selected
            ? "1.5px solid color-mix(in srgb, var(--accent-strong) 55%, transparent)"
            : "1px solid var(--border-subtle)",
          background: "var(--background)",
          boxShadow: selected
            ? "0 0 0 3px color-mix(in srgb, var(--accent-strong) 12%, transparent)"
            : "none",
          display: "flex",
          flexDirection: "column",
          gap: "var(--space-10)",
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", gap: "var(--space-8)" }}>
          <span style={kickerStyle}>ambience</span>
          {isDefault && <span style={{ ...kickerStyle, color: T.accent }}>default</span>}
        </div>
        <strong
          style={{
            color: T.fg,
            fontFamily: T.fontHeading,
            fontSize: "var(--font-size-lg)",
            overflowWrap: "anywhere",
          }}
        >
          {node.label}
        </strong>
        <span style={{ color: T.accent, fontFamily: T.fontMono, fontSize: "var(--font-size-sm)" }}>
          {trackId || "missing track"}
        </span>
        <p style={{ margin: 0, color: T.muted, lineHeight: "19px" }}>
          {node.summary || asString(node.data.description) || "Looped background audio."}
        </p>
      </div>
    );
  }

  return (
    <div
      style={{
        width: 320,
        padding: "var(--space-16)",
        borderRadius: "var(--radius-xl)",
        border: selected
          ? "1.5px solid color-mix(in srgb, var(--accent-strong) 55%, transparent)"
          : "1px solid var(--border-subtle)",
        background: "var(--background)",
        boxShadow: selected
          ? "0 0 0 3px color-mix(in srgb, var(--accent-strong) 12%, transparent)"
          : "none",
        display: "flex",
        flexDirection: "column",
        gap: "var(--space-10)",
      }}
    >
      <span style={kickerStyle}>{node.kind}</span>
      <strong
        style={{
          color: T.fg,
          fontFamily: T.fontHeading,
          fontSize: "var(--font-size-lg)",
          overflowWrap: "anywhere",
        }}
      >
        {node.label}
      </strong>
      <p style={{ margin: 0, color: T.muted, lineHeight: "19px" }}>
        {node.summary || "No node summary yet."}
      </p>
    </div>
  );
}

function SceneInspector({
  sceneId,
  pending,
  saved,
  selectedNode,
  selectedCharacter,
  selectedSound,
  scene,
  rosterCount,
  addableCharacters,
  librarySounds,
  voiceOptions,
  onSceneChange,
  onAddCharacter,
  onAddAudio,
  onAddEvent,
  onRemoveCharacter,
  onNodeSaved,
}: {
  sceneId: string;
  pending: boolean;
  saved: boolean;
  selectedNode: SceneGraphPayload["nodes"][number] | null;
  selectedCharacter: SceneLibraryCharacter | null;
  selectedSound: SceneLibrarySound | null;
  scene: {
    title: string;
    prompt: string;
    status: SceneEditorProps["scene"]["status"];
    openingBeat: string;
    defaultAmbience: string;
    narratorVoiceId: string | null;
    objective: string;
    drive: "gentle" | "balanced" | "insistent";
  };
  rosterCount: number;
  addableCharacters: SceneLibraryCharacter[];
  librarySounds: SceneLibrarySound[];
  voiceOptions: PickerVoice[];
  onSceneChange: {
    setTitle: (next: string) => void;
    setPrompt: (next: string) => void;
    setStatus: (next: SceneEditorProps["scene"]["status"]) => void;
    setOpeningBeat: (next: string) => void;
    setDefaultAmbience: (next: string) => void;
    setNarratorVoiceId: (next: string | null) => void;
    setObjective: (next: string) => void;
    setDrive: (next: "gentle" | "balanced" | "insistent") => void;
    saveConfig: (event?: FormEvent) => void;
  };
  onAddCharacter: (characterId: string) => void;
  onAddAudio: (input: {
    assetId: string;
    role: "bed" | "oneshot";
    isDefault?: boolean;
    triggerHint?: string;
  }) => void;
  onAddEvent: (input: { label: string; summary?: string }) => void;
  onRemoveCharacter: (nodeId: string) => void;
  onNodeSaved: (
    nodeId: string,
    patch: Partial<SceneGraphPayload["nodes"][number]>,
  ) => void;
}) {
  return (
    <AdminRightRail width={430}>
      {selectedNode ? (
        <GraphNodeInspector
          sceneId={sceneId}
          pending={pending}
          node={selectedNode}
          character={selectedCharacter}
          sound={selectedSound}
          onRemoveCharacter={onRemoveCharacter}
          onNodeSaved={onNodeSaved}
        />
      ) : (
        <SceneSettingsInspector
          pending={pending}
          saved={saved}
          scene={scene}
          rosterCount={rosterCount}
          addableCharacters={addableCharacters}
          librarySounds={librarySounds}
          voiceOptions={voiceOptions}
          onSceneChange={onSceneChange}
          onAddCharacter={onAddCharacter}
          onAddAudio={onAddAudio}
          onAddEvent={onAddEvent}
        />
      )}
    </AdminRightRail>
  );
}

function SceneSettingsInspector({
  pending,
  saved,
  scene,
  rosterCount,
  addableCharacters,
  librarySounds,
  voiceOptions,
  onSceneChange,
  onAddCharacter,
  onAddAudio,
  onAddEvent,
}: {
  pending: boolean;
  saved: boolean;
  scene: {
    title: string;
    prompt: string;
    status: SceneEditorProps["scene"]["status"];
    openingBeat: string;
    defaultAmbience: string;
    narratorVoiceId: string | null;
    objective: string;
    drive: "gentle" | "balanced" | "insistent";
  };
  rosterCount: number;
  addableCharacters: SceneLibraryCharacter[];
  librarySounds: SceneLibrarySound[];
  voiceOptions: PickerVoice[];
  onSceneChange: {
    setTitle: (next: string) => void;
    setPrompt: (next: string) => void;
    setStatus: (next: SceneEditorProps["scene"]["status"]) => void;
    setOpeningBeat: (next: string) => void;
    setDefaultAmbience: (next: string) => void;
    setNarratorVoiceId: (next: string | null) => void;
    setObjective: (next: string) => void;
    setDrive: (next: "gentle" | "balanced" | "insistent") => void;
    saveConfig: (event?: FormEvent) => void;
  };
  onAddCharacter: (characterId: string) => void;
  onAddAudio: (input: {
    assetId: string;
    role: "bed" | "oneshot";
    isDefault?: boolean;
    triggerHint?: string;
  }) => void;
  onAddEvent: (input: { label: string; summary?: string }) => void;
}) {
  const [audioAssetId, setAudioAssetId] = useState("");
  const [audioRole, setAudioRole] = useState<"bed" | "oneshot">("bed");
  const [audioDefault, setAudioDefault] = useState(false);
  const [audioTriggerHint, setAudioTriggerHint] = useState("");
  const [beatLabel, setBeatLabel] = useState("");
  const [beatSummary, setBeatSummary] = useState("");

  const addAudio = () => {
    if (!audioAssetId) return;
    onAddAudio({
      assetId: audioAssetId,
      role: audioRole,
      isDefault: audioRole === "bed" ? audioDefault : false,
      triggerHint: audioTriggerHint.trim() || undefined,
    });
    setAudioAssetId("");
    setAudioRole("bed");
    setAudioDefault(false);
    setAudioTriggerHint("");
  };

  return (
    <form onSubmit={onSceneChange.saveConfig} style={inspectorFormStyle}>
      <InspectorHeader eyebrow="scene" title={scene.title} meta={`${rosterCount} cast nodes`} />
      <Field label="Title">
        <input
          value={scene.title}
          onChange={(event) => onSceneChange.setTitle(event.target.value)}
          style={inputStyle}
        />
      </Field>
      <Field label="Description / premise">
        <textarea
          value={scene.prompt}
          onChange={(event) => onSceneChange.setPrompt(event.target.value)}
          rows={4}
          placeholder="1-3 sentences the orchestrator reads to understand the setting."
          style={textareaStyle}
        />
      </Field>
      <Field label="Opening beat">
        <input
          value={scene.openingBeat}
          onChange={(event) => onSceneChange.setOpeningBeat(event.target.value)}
          placeholder="The beat the scene opens on."
          style={inputStyle}
        />
      </Field>
      <Field label="Scene objective">
        <textarea
          value={scene.objective}
          onChange={(event) => onSceneChange.setObjective(event.target.value)}
          rows={2}
          placeholder="What the scene is driving toward — the director writes beats in service of this."
          style={textareaStyle}
        />
      </Field>
      <Field label="Director drive">
        <select
          value={scene.drive}
          onChange={(event) =>
            onSceneChange.setDrive(
              event.target.value as "gentle" | "balanced" | "insistent",
            )
          }
          style={{ ...inputStyle, cursor: "pointer" }}
        >
          <option value="gentle">gentle — follow the user&apos;s lead</option>
          <option value="balanced">balanced — default pacing</option>
          <option value="insistent">insistent — press toward goals</option>
        </select>
      </Field>
      <Field label="Default ambience">
        <input
          value={scene.defaultAmbience}
          onChange={(event) => onSceneChange.setDefaultAmbience(event.target.value)}
          placeholder="Ambience track id, or blank for silence."
          style={inputStyle}
        />
      </Field>
      <Field label="Narrator voice">
        <VoiceLibraryPicker
          currentVoiceId={scene.narratorVoiceId}
          voices={voiceOptions}
          onChange={onSceneChange.setNarratorVoiceId}
        />
      </Field>
      <Field label="Status">
        <select
          value={scene.status}
          onChange={(event) =>
            onSceneChange.setStatus(event.target.value as SceneEditorProps["scene"]["status"])
          }
          style={{ ...inputStyle, cursor: "pointer" }}
        >
          <option value="draft">draft</option>
          <option value="active">active</option>
          <option value="archived">archived</option>
        </select>
      </Field>
      <Field label="Add character">
        <select
          defaultValue=""
          onChange={(event) => {
            onAddCharacter(event.target.value);
            event.target.value = "";
          }}
          disabled={pending || addableCharacters.length === 0}
          style={{ ...inputStyle, cursor: "pointer" }}
        >
          <option value="" disabled>
            {addableCharacters.length === 0 ? "All characters are in this scene" : "Add a character"}
          </option>
          {addableCharacters.map((character) => (
            <option key={character.id} value={character.id}>
              {character.title}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Add audio">
        <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-8)" }}>
          <select
            value={audioAssetId}
            onChange={(event) => setAudioAssetId(event.target.value)}
            disabled={pending || librarySounds.length === 0}
            style={{ ...inputStyle, cursor: "pointer" }}
          >
            <option value="" disabled>
              {librarySounds.length === 0
                ? "Sound library is empty — add sounds at /sounds"
                : "Pick a sound from the library"}
            </option>
            {librarySounds.map((sound) => (
              <option key={sound.id} value={sound.id}>
                {sound.name}
                {sound.status !== "ready" ? " (needs processing)" : ""}
              </option>
            ))}
          </select>
          <select
            value={audioRole}
            onChange={(event) => setAudioRole(event.target.value as "bed" | "oneshot")}
            style={{ ...inputStyle, cursor: "pointer" }}
          >
            <option value="bed">bed — looping ambience</option>
            <option value="oneshot">one-shot — cueable effect</option>
          </select>
          <input
            value={audioTriggerHint}
            onChange={(event) => setAudioTriggerHint(event.target.value)}
            placeholder="Cue hint for the director, optional"
            style={inputStyle}
          />
          {audioRole === "bed" && (
            <label style={checkboxRowStyle}>
              <input
                type="checkbox"
                checked={audioDefault}
                onChange={(event) => setAudioDefault(event.target.checked)}
              />
              Default background bed
            </label>
          )}
          <AdminButton
            type="button"
            variant="secondary"
            disabled={pending || !audioAssetId}
            onClick={addAudio}
          >
            Add audio
          </AdminButton>
        </div>
      </Field>
      <Field label="Add arc beat">
        <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-8)" }}>
          <input
            value={beatLabel}
            onChange={(event) => setBeatLabel(event.target.value)}
            placeholder="Beat name, e.g. Sarah's laugh — and the denial"
            style={inputStyle}
          />
          <textarea
            value={beatSummary}
            onChange={(event) => setBeatSummary(event.target.value)}
            rows={2}
            placeholder="What it looks like when this beat lands (optional)."
            style={textareaStyle}
          />
          <AdminButton
            type="button"
            variant="secondary"
            disabled={pending || !beatLabel.trim()}
            onClick={() => {
              onAddEvent({
                label: beatLabel.trim(),
                summary: beatSummary.trim() || undefined,
              });
              setBeatLabel("");
              setBeatSummary("");
            }}
          >
            Add arc beat
          </AdminButton>
        </div>
      </Field>
      <InspectorFooter pending={pending} saved={saved} />
    </form>
  );
}

function GraphNodeInspector({
  sceneId,
  pending,
  node,
  character,
  sound,
  onRemoveCharacter,
  onNodeSaved,
}: {
  sceneId: string;
  pending: boolean;
  node: SceneGraphPayload["nodes"][number];
  character: SceneLibraryCharacter | null;
  sound: SceneLibrarySound | null;
  onRemoveCharacter: (nodeId: string) => void;
  onNodeSaved: (
    nodeId: string,
    patch: Partial<SceneGraphPayload["nodes"][number]>,
  ) => void;
}) {
  const [label, setLabel] = useState(node.label);
  const [summary, setSummary] = useState(node.summary ?? "");
  const [roleInScene, setRoleInScene] = useState(asString(node.data.roleInScene));
  const [archetype, setArchetype] = useState(asString(node.data.archetype));
  const [emotionalBaseline, setEmotionalBaseline] = useState(
    asString(node.data.emotionalBaseline),
  );
  const [motivations, setMotivations] = useState(asString(node.data.motivations));
  const [speakingStyle, setSpeakingStyle] = useState(asString(node.data.speakingStyle));
  // Condition → behavior pairs the director acts on ("when the promise is
  // doubted" → "press with the story of the stars"). Rows with either half
  // empty are dropped on save.
  const [behaviorTriggers, setBehaviorTriggers] = useState<
    Array<{ condition: string; behavior: string }>
  >(
    Array.isArray(node.data.behaviorTriggers)
      ? (node.data.behaviorTriggers as Array<{ condition?: string; behavior?: string }>).map(
          (t) => ({ condition: t.condition ?? "", behavior: t.behavior ?? "" }),
        )
      : [],
  );
  // Knowledge horizon: the scene's dramatic present on THIS character's era
  // timeline. Era "" = no horizon (the character knows their whole life).
  const savedHorizon = node.data.knowledgeHorizon as
    | { era?: string; index?: number }
    | undefined;
  const [horizonEra, setHorizonEra] = useState(asString(savedHorizon?.era));
  const [horizonIndex, setHorizonIndex] = useState(
    typeof savedHorizon?.index === "number" ? String(savedHorizon.index) : "0",
  );
  const [trackId, setTrackId] = useState(asString(node.data.trackId));
  const [ambienceDescription, setAmbienceDescription] = useState(
    asString(node.data.description),
  );
  const [isDefaultAmbience, setIsDefaultAmbience] = useState(node.data.isDefault === true);
  const [audioRole, setAudioRole] = useState<"bed" | "oneshot">(
    asString(node.data.role) === "oneshot" ? "oneshot" : "bed",
  );
  const [audioTriggerHint, setAudioTriggerHint] = useState(
    asString(node.data.triggerHint),
  );
  const [audioGainDb, setAudioGainDb] = useState(
    typeof node.data.gainDb === "number" ? String(node.data.gainDb) : "",
  );
  const [eventTimeIndex, setEventTimeIndex] = useState(
    typeof node.data.timeIndex === "number" ? String(node.data.timeIndex) : "0",
  );
  const [saved, setSaved] = useState(false);
  const [saving, startSaving] = useTransition();

  const saveNode = (event?: FormEvent) => {
    event?.preventDefault();
    setSaved(false);
    const parsedGain = Number(audioGainDb);
    const cleanedTriggers = behaviorTriggers
      .map((t) => ({ condition: t.condition.trim(), behavior: t.behavior.trim() }))
      .filter((t) => t.condition && t.behavior);
    const nextData =
      node.kind === "character"
        ? compactObject({
            ...node.data,
            roleInScene,
            archetype,
            emotionalBaseline,
            motivations,
            speakingStyle,
            behaviorTriggers: cleanedTriggers.length ? cleanedTriggers : undefined,
            knowledgeHorizon: horizonEra
              ? {
                  era: horizonEra,
                  index: Number.isFinite(Number(horizonIndex))
                    ? Math.trunc(Number(horizonIndex))
                    : 0,
                }
              : undefined,
          })
        : node.kind === "ambience"
          ? compactObject({
              trackId,
              description: ambienceDescription,
              isDefault: isDefaultAmbience,
            })
        : node.kind === "event"
          ? compactObject({
              ...node.data,
              timeIndex: Number.isFinite(Number(eventTimeIndex))
                ? Math.trunc(Number(eventTimeIndex))
                : 0,
            })
        : node.kind === "audio"
          ? {
              role: audioRole,
              ...(audioTriggerHint.trim()
                ? { triggerHint: audioTriggerHint.trim() }
                : {}),
              ...(audioRole === "bed" && isDefaultAmbience
                ? { isDefault: true }
                : {}),
              ...(audioGainDb.trim() && Number.isFinite(parsedGain)
                ? { gainDb: parsedGain }
                : {}),
            }
        : node.data;

    startSaving(async () => {
      const res = await updateSceneNode(sceneId, node.id, {
        label: label.trim() || node.label,
        summary: summary.trim() || null,
        data: nextData,
      });
      if (res.ok) {
        setSaved(true);
        onNodeSaved(node.id, {
          label: label.trim() || node.label,
          summary: summary.trim() || null,
          data: nextData,
        });
      }
    });
  };

  return (
    <form onSubmit={saveNode} style={inspectorFormStyle}>
      <InspectorHeader
	        eyebrow={node.kind === "audio" ? `audio · ${audioRole}` : node.kind}
	        title={sound?.name ?? label}
	        meta={
	          character
	            ? character.slug
	            : sound
	              ? sound.slug
	              : asString(node.data.trackId) || (node.refId ?? "native node")
	        }
	      />
      {character && (
        <Link href={`/characters/${character.slug}`} style={subtleLinkStyle}>
          open character
        </Link>
      )}
      {node.kind === "audio" && (
        <Link href="/sounds" style={subtleLinkStyle}>
          open sound library
        </Link>
      )}
      <Field label="Label">
        <input value={label} onChange={(event) => setLabel(event.target.value)} style={inputStyle} />
      </Field>
      <Field label="Scene summary">
        <textarea
          value={summary}
          onChange={(event) => setSummary(event.target.value)}
          rows={3}
          placeholder="How this node matters in this scene."
          style={textareaStyle}
        />
      </Field>
	      {node.kind === "character" && (
	        <>
          <Field label="Role in scene">
            <input
              value={roleInScene}
              onChange={(event) => setRoleInScene(event.target.value)}
              placeholder="Host, witness, antagonist..."
              style={inputStyle}
            />
          </Field>
          <Field label="Archetype">
            <input
              value={archetype}
              onChange={(event) => setArchetype(event.target.value)}
              placeholder="Reluctant matriarch, anxious servant..."
              style={inputStyle}
            />
          </Field>
          <Field label="Emotional baseline">
            <input
              value={emotionalBaseline}
              onChange={(event) => setEmotionalBaseline(event.target.value)}
              placeholder="Guarded, hopeful, defensive..."
              style={inputStyle}
            />
          </Field>
          <Field label="Motivations">
            <textarea
              value={motivations}
              onChange={(event) => setMotivations(event.target.value)}
              rows={3}
              style={textareaStyle}
            />
          </Field>
          <Field label="Speaking style">
            <textarea
              value={speakingStyle}
              onChange={(event) => setSpeakingStyle(event.target.value)}
              rows={3}
              style={textareaStyle}
            />
          </Field>
          <Field label="Behavior triggers (condition → behavior)">
            <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-8)" }}>
              {behaviorTriggers.map((trigger, index) => (
                <div
                  key={index}
                  style={{ display: "flex", gap: "var(--space-6)", alignItems: "center" }}
                >
                  <input
                    value={trigger.condition}
                    onChange={(event) =>
                      setBehaviorTriggers((prev) =>
                        prev.map((t, i) =>
                          i === index ? { ...t, condition: event.target.value } : t,
                        ),
                      )
                    }
                    placeholder="when…"
                    style={{ ...inputStyle, flex: 1 }}
                  />
                  <input
                    value={trigger.behavior}
                    onChange={(event) =>
                      setBehaviorTriggers((prev) =>
                        prev.map((t, i) =>
                          i === index ? { ...t, behavior: event.target.value } : t,
                        ),
                      )
                    }
                    placeholder="they…"
                    style={{ ...inputStyle, flex: 1 }}
                  />
                  <button
                    type="button"
                    aria-label="Remove trigger"
                    onClick={() =>
                      setBehaviorTriggers((prev) => prev.filter((_, i) => i !== index))
                    }
                    style={{
                      flexShrink: 0,
                      width: 28,
                      height: 28,
                      borderRadius: "var(--radius-md)",
                      border: "1px solid var(--ink-line)",
                      background: "transparent",
                      color: T.muted,
                      cursor: "pointer",
                      lineHeight: 1,
                    }}
                  >
                    ×
                  </button>
                </div>
              ))}
              <AdminButton
                type="button"
                variant="secondary"
                disabled={behaviorTriggers.length >= 6}
                onClick={() =>
                  setBehaviorTriggers((prev) => [...prev, { condition: "", behavior: "" }])
                }
              >
                + add trigger
              </AdminButton>
            </div>
          </Field>
          <Field label="Knowledge horizon">
            <div style={{ display: "flex", gap: "var(--space-6)", alignItems: "center" }}>
              <select
                value={horizonEra}
                onChange={(event) => setHorizonEra(event.target.value)}
                style={{ ...inputStyle, flex: 1, cursor: "pointer" }}
              >
                <option value="">none — knows their whole life</option>
                {[...(character?.eras ?? [])]
                  .sort((a, b) => a.order - b.order)
                  .map((era) => (
                    <option key={era.key} value={era.key}>
                      {era.title}
                    </option>
                  ))}
              </select>
              <input
                type="number"
                value={horizonIndex}
                onChange={(event) => setHorizonIndex(event.target.value)}
                disabled={!horizonEra}
                title="Position within the era (wiki-page timeIndex)"
                style={{ ...inputStyle, width: 88, flexShrink: 0 }}
              />
            </div>
            <p
              style={{
                margin: 0,
                color: T.muted,
                lineHeight: "19px",
                fontSize: "var(--font-size-sm)",
              }}
            >
              The scene&apos;s dramatic present for this character. Wiki pages
              time-indexed after this moment are withheld from their context
              (pages marked &quot;knows future&quot; still pass).
            </p>
          </Field>
	        </>
	      )}
	      {node.kind === "ambience" && (
	        <>
	          <Field label="Track ID">
	            <input
	              value={trackId}
	              onChange={(event) => setTrackId(event.target.value)}
	              placeholder="Existing public ambience filename without .mp3"
	              style={inputStyle}
	            />
	          </Field>
	          <Field label="Description">
	            <textarea
	              value={ambienceDescription}
	              onChange={(event) => setAmbienceDescription(event.target.value)}
	              rows={3}
	              placeholder="How this bed should feel in the scene."
	              style={textareaStyle}
	            />
	          </Field>
	          <label style={checkboxRowStyle}>
	            <input
	              type="checkbox"
	              checked={isDefaultAmbience}
	              onChange={(event) => setIsDefaultAmbience(event.target.checked)}
	            />
	            Default background bed
	          </label>
	        </>
	      )}
	      {node.kind === "audio" && (
	        <>
	          {sound?.description && (
	            <p
	              style={{
	                margin: 0,
	                color: T.muted,
	                fontFamily: T.fontBody,
	                fontSize: "var(--font-size-base)",
	                lineHeight: "19px",
	              }}
	            >
	              {sound.description}
	            </p>
	          )}
	          <Field label="Role">
	            <select
	              value={audioRole}
	              onChange={(event) =>
	                setAudioRole(event.target.value as "bed" | "oneshot")
	              }
	              style={{ ...inputStyle, cursor: "pointer" }}
	            >
	              <option value="bed">bed — looping ambience</option>
	              <option value="oneshot">one-shot — cueable effect</option>
	            </select>
	          </Field>
	          <Field label="Cue hint (what the director reads)">
	            <input
	              value={audioTriggerHint}
	              onChange={(event) => setAudioTriggerHint(event.target.value)}
	              placeholder="e.g. when the fire is mentioned"
	              style={inputStyle}
	            />
	          </Field>
	          <Field label="Gain trim (dB, −24…+12)">
	            <input
	              value={audioGainDb}
	              onChange={(event) => setAudioGainDb(event.target.value)}
	              placeholder="0"
	              inputMode="decimal"
	              style={inputStyle}
	            />
	          </Field>
	          {audioRole === "bed" && (
	            <label style={checkboxRowStyle}>
	              <input
	                type="checkbox"
	                checked={isDefaultAmbience}
	                onChange={(event) => setIsDefaultAmbience(event.target.checked)}
	              />
	              Default background bed
	            </label>
	          )}
	        </>
	      )}
	      {node.kind === "event" && (
	        <Field label="Arc position (0 = first beat)">
	          <input
	            value={eventTimeIndex}
	            onChange={(event) => setEventTimeIndex(event.target.value)}
	            inputMode="numeric"
	            style={inputStyle}
	          />
	        </Field>
	      )}
	      <InspectorFooter pending={pending || saving} saved={saved} label="Save node" />
	      {(node.kind === "character" || node.kind === "ambience" || node.kind === "audio" || node.kind === "event") && (
	        <button
	          type="button"
	          onClick={() => onRemoveCharacter(node.id)}
	          disabled={pending || saving}
	          style={dangerButtonStyle}
	        >
	          Remove from scene
	        </button>
	      )}
    </form>
  );
}

function InspectorHeader({
  eyebrow,
  title,
  meta,
}: {
  eyebrow: string;
  title: string;
  meta: string;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-6)" }}>
      <span style={kickerStyle}>{eyebrow}</span>
      <h2
        style={{
          margin: 0,
          color: T.fg,
          fontFamily: T.fontHeading,
          fontSize: "var(--font-size-xl)",
          fontWeight: 600,
          overflowWrap: "anywhere",
        }}
      >
        {title}
      </h2>
      <span style={{ ...kickerStyle, color: T.muted }}>{meta}</span>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label style={{ display: "flex", flexDirection: "column", gap: "var(--space-8)" }}>
      <span style={fieldLabelStyle}>{label}</span>
      {children}
    </label>
  );
}

function InspectorFooter({
  pending,
  saved,
  label = "Save changes",
}: {
  pending: boolean;
  saved: boolean;
  label?: string;
}) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: "var(--space-10)" }}>
      <AdminButton type="submit" variant="primary" disabled={pending}>
        {pending ? "Saving..." : label}
      </AdminButton>
      {saved && !pending && (
        <span style={{ color: "var(--accent-strong)", fontSize: "var(--font-size-sm)" }}>
          Saved.
        </span>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div
      style={{
        minWidth: 0,
        padding: "9px 10px",
        border: "1px solid var(--border-subtle)",
        borderRadius: "var(--radius-md)",
        background: "color-mix(in srgb, var(--text-primary) 4%, transparent)",
        display: "flex",
        flexDirection: "column",
        gap: 4,
      }}
    >
      <span style={{ ...kickerStyle, fontSize: "var(--font-size-2xs)" }}>{label}</span>
      <strong
        style={{
          color: T.fg,
          fontFamily: T.fontHeading,
          fontSize: "var(--font-size-base)",
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
      >
        {value}
      </strong>
    </div>
  );
}

function defaultNodePosition(index: number, kind: string) {
  if (kind === "character") {
    return {
      x: 220 + (index % 2) * 520,
      y: -240 + Math.floor(index / 2) * 340,
    };
  }
  return {
    x: 220 + (index % 3) * 360,
    y: 180 + Math.floor(index / 3) * 240,
  };
}

function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function compactObject(input: Record<string, unknown>): Record<string, unknown> {
  const next: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input)) {
    if (typeof value === "string") {
      const trimmed = value.trim();
      if (trimmed) next[key] = trimmed;
      continue;
    }
    if (value !== undefined && value !== null) next[key] = value;
  }
  return next;
}

function statusColor(status: SceneEditorProps["scene"]["status"]): string {
  if (status === "active") return "var(--accent-strong)";
  if (status === "archived") return T.danger;
  return "var(--status-draft)";
}

const sandboxLinkStyle: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  minHeight: 30,
  padding: "0 16px",
  border: `1px solid ${T.accent}`,
  borderRadius: "var(--radius-pill)",
  background: T.accent,
  color: "var(--background)",
  fontFamily: T.fontHeading,
  fontSize: "var(--font-size-base)",
  fontWeight: 600,
  textDecoration: "none",
  whiteSpace: "nowrap",
};

const headerIconButtonStyle: CSSProperties = {
  width: 30,
  height: 30,
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  border: "1px solid color-mix(in srgb, var(--text-primary) 8%, transparent)",
  borderRadius: "var(--radius-pill)",
  background: "transparent",
  color: "var(--text-tertiary)",
  cursor: "pointer",
};

const inspectorFormStyle: CSSProperties = {
  minHeight: "100%",
  padding: "24px 24px 120px",
  display: "flex",
  flexDirection: "column",
  gap: "var(--space-18)",
  color: T.fg,
  fontFamily: T.fontBody,
};

const inputStyle: CSSProperties = {
  height: 38,
  width: "100%",
  padding: "0 12px",
  background: "var(--control-bg)",
  border: "1px solid var(--control-border)",
  borderRadius: "var(--radius-md)",
  color: T.fg,
  fontFamily: T.fontBody,
  fontSize: "var(--font-size-base)",
  outline: "none",
};

const textareaStyle: CSSProperties = {
  ...inputStyle,
  height: "auto",
  minHeight: 86,
  padding: "10px 12px",
  resize: "vertical",
  lineHeight: "20px",
};

const fieldLabelStyle: CSSProperties = {
  color: "var(--text-tertiary)",
  fontFamily: T.fontMono,
  fontSize: "var(--font-size-xs)",
  letterSpacing: "0.14em",
  textTransform: "uppercase",
};

const checkboxRowStyle: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: "var(--space-8)",
  color: T.muted,
  fontFamily: T.fontBody,
  fontSize: "var(--font-size-sm)",
};

const kickerStyle: CSSProperties = {
  color: "var(--text-tertiary)",
  fontFamily: T.fontMono,
  fontSize: "var(--font-size-xs)",
  letterSpacing: "0.14em",
  textTransform: "uppercase",
};

const subtleLinkStyle: CSSProperties = {
  color: T.accent,
  fontFamily: T.fontMono,
  fontSize: "var(--font-size-xs)",
  letterSpacing: "0.12em",
  textTransform: "uppercase",
  textDecoration: "none",
};

const dangerButtonStyle: CSSProperties = {
  minHeight: 38,
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  padding: "0 16px",
  border: `1px solid color-mix(in srgb, ${T.danger} 40%, transparent)`,
  borderRadius: "var(--radius-pill)",
  background: T.dangerSoft,
  color: T.danger,
  fontFamily: T.fontMono,
  fontSize: "var(--font-size-sm)",
  letterSpacing: "0.10em",
  textTransform: "uppercase",
  cursor: "pointer",
};
