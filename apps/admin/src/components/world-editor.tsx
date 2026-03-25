"use client";

import {
  PointerEvent,
  WheelEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
} from "react";
import type { WorldDefinition, CharacterDefinition, GroupDefinition, RoleDefinition, EventTemplate, RelationshipDefinition } from "@odyssey/types";
import { WorldEditorPanel } from "./world-editor-panel";

/* ── Types ────────────────────────────────────────────────── */

export type EntityType = "world" | "character" | "group" | "role" | "event" | "state" | "relationship";

export type EditorNode = {
  id: string;
  entityType: EntityType;
  entityId: string;
  label: string;
  subtitle: string;
  x: number;
  y: number;
  w: number;
  h: number;
  collapsed: boolean;
};

type EditorEdge = {
  id: string;
  from: string;
  to: string;
  label?: string;
};

type DragState =
  | { type: "node"; pointerId: number; nodeId: string; offsetX: number; offsetY: number; startClientX: number; startClientY: number }
  | { type: "pan"; pointerId: number; startClientX: number; startClientY: number; originX: number; originY: number }
  | null;

type ValidationError = {
  nodeId: string;
  message: string;
};

/* ── Constants ────────────────────────────────────────────── */

const NODE_COLORS: Record<EntityType, { border: string; dot: string; bg: string }> = {
  world:     { border: "#C4956A", dot: "#C4956A", bg: "rgba(196,149,106,0.08)" },
  character: { border: "#5B8DEF", dot: "#5B8DEF", bg: "rgba(91,141,239,0.08)" },
  group:     { border: "#6DB889", dot: "#6DB889", bg: "rgba(109,184,137,0.08)" },
  role:      { border: "#E2A55A", dot: "#E2A55A", bg: "rgba(226,165,90,0.08)" },
  event:     { border: "#8B6FC0", dot: "#8B6FC0", bg: "rgba(139,111,192,0.08)" },
  state:     { border: "#EF5B5B", dot: "#EF5B5B", bg: "rgba(239,91,91,0.08)" },
  relationship: { border: "#D94F7A", dot: "#D94F7A", bg: "rgba(217,79,122,0.08)" },
};

const ENTITY_LABELS: Record<EntityType, string> = {
  world: "World Core",
  character: "Character",
  group: "Group",
  role: "Role",
  event: "Event",
  state: "Initial State",
  relationship: "Relationship",
};

const ENTITY_DESCRIPTIONS: Record<EntityType, string> = {
  world: "Setting, premise, norms",
  character: "Name, archetype, voice",
  group: "Influence, disposition",
  role: "Player role definition",
  event: "Triggers, stakes, actors",
  state: "Stability, morale, resources",
  relationship: "Trust, fear, loyalty between characters",
};

const ENTITY_ICONS: Record<EntityType, string> = {
  world: "⊕",
  character: "⊙",
  group: "⊜",
  role: "≋",
  event: "⚡",
  state: "⟡",
  relationship: "⇌",
};

const worldSize = { width: 6000, height: 4000 };

function clamp(v: number, min: number, max: number) {
  return Math.min(max, Math.max(min, v));
}

/* ── Inline bar component ─────────────────────────────────── */

function MiniBar({ value, max = 100, color }: { value: number; max?: number; color: string }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: "0.375rem", width: "100%" }}>
      <div style={{ flex: 1, height: 4, borderRadius: 2, background: "rgba(255,255,255,0.06)" }}>
        <div style={{ width: `${(value / max) * 100}%`, height: "100%", borderRadius: 2, background: color }} />
      </div>
      <span style={{ fontSize: "0.6rem", color: "var(--muted)", fontFamily: "var(--font-mono)", minWidth: 18, textAlign: "right" }}>
        {value}
      </span>
    </div>
  );
}

function Badge({ text, color }: { text: string; color?: string }) {
  return (
    <span style={{
      display: "inline-block",
      padding: "0.125rem 0.375rem",
      borderRadius: "0.25rem",
      fontSize: "0.6rem",
      fontWeight: 500,
      background: color ? `${color}20` : "rgba(255,255,255,0.06)",
      color: color ?? "var(--muted)",
      lineHeight: 1.4,
    }}>
      {text}
    </span>
  );
}

function PortDot({ color, label, side = "right" }: { color: string; label?: string; side?: "left" | "right" }) {
  return (
    <div style={{
      display: "flex",
      alignItems: "center",
      gap: "0.25rem",
      justifyContent: side === "right" ? "flex-end" : "flex-start",
    }}>
      {side === "right" && label && (
        <span style={{ fontSize: "0.55rem", color: "var(--muted)" }}>{label}</span>
      )}
      <span style={{
        width: 6,
        height: 6,
        borderRadius: "50%",
        background: color,
        flexShrink: 0,
      }} />
      {side === "left" && label && (
        <span style={{ fontSize: "0.55rem", color: "var(--muted)" }}>{label}</span>
      )}
    </div>
  );
}

/* ── Layout helpers ───────────────────────────────────────── */

function buildNodesFromWorld(world: WorldDefinition): EditorNode[] {
  const nodes: EditorNode[] = [];
  const gap = 40;

  nodes.push({
    id: "node-world",
    entityType: "world",
    entityId: world.id,
    label: world.title,
    subtitle: world.setting.slice(0, 80),
    x: 80,
    y: 100,
    w: 320,
    h: 200,
    collapsed: false,
  });

  world.groups.forEach((group, i) => {
    nodes.push({
      id: `node-group-${group.id}`,
      entityType: "group",
      entityId: group.id,
      label: group.name,
      subtitle: `${group.disposition} · influence ${group.influence}`,
      x: 480,
      y: 80 + i * (140 + gap),
      w: 260,
      h: 140,
      collapsed: false,
    });
  });

  world.characters.forEach((char, i) => {
    nodes.push({
      id: `node-char-${char.id}`,
      entityType: "character",
      entityId: char.id,
      label: char.name,
      subtitle: `${char.title} · ${char.archetype}`,
      x: 820,
      y: 60 + i * (190 + gap),
      w: 280,
      h: 190,
      collapsed: false,
    });
  });

  world.roles.forEach((role, i) => {
    nodes.push({
      id: `node-role-${role.id}`,
      entityType: "role",
      entityId: role.id,
      label: role.title,
      subtitle: role.summary.slice(0, 60),
      x: 80,
      y: 400 + i * (150 + gap),
      w: 280,
      h: 150,
      collapsed: false,
    });
  });

  world.eventTemplates.forEach((event, i) => {
    nodes.push({
      id: `node-event-${event.id}`,
      entityType: "event",
      entityId: event.id,
      label: event.title,
      subtitle: `${event.category} · urgency ${event.urgency}`,
      x: 480,
      y: 400 + i * (170 + gap),
      w: 280,
      h: 170,
      collapsed: false,
    });
  });

  (world.relationships ?? []).forEach((rel, i) => {
    const source = world.characters.find((c) => c.id === rel.sourceCharacterId);
    const target = world.characters.find((c) => c.id === rel.targetCharacterId);
    const sourceName = source?.name ?? rel.sourceCharacterId;
    const targetName = target?.name ?? rel.targetCharacterId;
    nodes.push({
      id: `node-rel-${rel.id}`,
      entityType: "relationship",
      entityId: rel.id,
      label: `${sourceName} → ${targetName}`,
      subtitle: `trust ${rel.metrics.trust} · loyalty ${rel.metrics.loyalty}`,
      x: 1180,
      y: 60 + i * (140 + gap),
      w: 260,
      h: 130,
      collapsed: false,
    });
  });

  nodes.push({
    id: "node-state",
    entityType: "state",
    entityId: "initialState",
    label: "Initial State",
    subtitle: `stability ${world.initialState.stability} · morale ${world.initialState.morale}`,
    x: 80,
    y: 700,
    w: 320,
    h: 180,
    collapsed: false,
  });

  return nodes;
}

function buildEdgesFromWorld(world: WorldDefinition, nodes: EditorNode[]): EditorEdge[] {
  const edges: EditorEdge[] = [];

  world.characters.forEach((char) => {
    const charNode = nodes.find((n) => n.entityType === "character" && n.entityId === char.id);
    const gids = char.groupIds?.length ? char.groupIds : char.groupId ? [char.groupId] : [];
    for (const gid of gids) {
      const groupNode = nodes.find((n) => n.entityType === "group" && n.entityId === gid);
      if (charNode && groupNode) {
        edges.push({ id: `edge-${charNode.id}-${groupNode.id}`, from: charNode.id, to: groupNode.id, label: "member" });
      }
    }
  });

  world.eventTemplates.forEach((event) => {
    event.actorIds.forEach((actorId) => {
      const eventNode = nodes.find((n) => n.entityType === "event" && n.entityId === event.id);
      const charNode = nodes.find((n) => n.entityType === "character" && n.entityId === actorId);
      if (eventNode && charNode) {
        edges.push({ id: `edge-${eventNode.id}-${charNode.id}`, from: eventNode.id, to: charNode.id, label: "actor" });
      }
    });
  });

  world.roles.forEach((role) => {
    const roleNode = nodes.find((n) => n.entityType === "role" && n.entityId === role.id);
    if (roleNode) {
      edges.push({ id: `edge-world-${roleNode.id}`, from: "node-world", to: roleNode.id });
    }
  });

  world.groups.forEach((group) => {
    const groupNode = nodes.find((n) => n.entityType === "group" && n.entityId === group.id);
    if (groupNode) {
      edges.push({ id: `edge-world-${groupNode.id}`, from: "node-world", to: groupNode.id });
    }
  });

  (world.relationships ?? []).forEach((rel) => {
    const relNode = nodes.find((n) => n.entityType === "relationship" && n.entityId === rel.id);
    const sourceNode = nodes.find((n) => n.entityType === "character" && n.entityId === rel.sourceCharacterId);
    const targetNode = nodes.find((n) => n.entityType === "character" && n.entityId === rel.targetCharacterId);
    if (relNode && sourceNode) {
      edges.push({ id: `edge-${relNode.id}-source`, from: sourceNode.id, to: relNode.id, label: "from" });
    }
    if (relNode && targetNode) {
      edges.push({ id: `edge-${relNode.id}-target`, from: relNode.id, to: targetNode.id, label: "to" });
    }
  });

  return edges;
}

function getEdgeAnchors(from: EditorNode, to: EditorNode) {
  const fc = { x: from.x + from.w / 2, y: from.y + from.h / 2 };
  const tc = { x: to.x + to.w / 2, y: to.y + to.h / 2 };
  const dx = tc.x - fc.x;
  const dy = tc.y - fc.y;

  if (Math.abs(dx) >= Math.abs(dy)) {
    return {
      start: { x: dx >= 0 ? from.x + from.w : from.x, y: fc.y },
      end: { x: dx >= 0 ? to.x : to.x + to.w, y: tc.y },
    };
  }
  return {
    start: { x: fc.x, y: dy >= 0 ? from.y + from.h : from.y },
    end: { x: tc.x, y: dy >= 0 ? to.y : to.y + to.h },
  };
}

/* ── Validation ───────────────────────────────────────────── */

function validateWorld(world: WorldDefinition): ValidationError[] {
  const errors: ValidationError[] = [];

  if (!world.title.trim()) errors.push({ nodeId: "node-world", message: "World title is required" });
  if (!world.setting.trim()) errors.push({ nodeId: "node-world", message: "World setting is required" });
  if (!world.premise.trim()) errors.push({ nodeId: "node-world", message: "World premise is required" });
  if (world.roles.length === 0) errors.push({ nodeId: "node-world", message: "At least one role is required" });
  if (world.groups.length === 0) errors.push({ nodeId: "node-world", message: "At least one group is required" });
  if (world.characters.length === 0) errors.push({ nodeId: "node-world", message: "At least one character is required" });
  if (world.eventTemplates.length === 0) errors.push({ nodeId: "node-world", message: "At least one event is required" });

  world.characters.forEach((char) => {
    const nodeId = `node-char-${char.id}`;
    if (!char.name.trim()) errors.push({ nodeId, message: `Character "${char.id}" needs a name` });
    const gids = char.groupIds?.length ? char.groupIds : char.groupId ? [char.groupId] : [];
    for (const gid of gids) {
      if (!world.groups.some((g) => g.id === gid))
        errors.push({ nodeId, message: `Missing group "${gid}"` });
    }
  });

  world.eventTemplates.forEach((event) => {
    const nodeId = `node-event-${event.id}`;
    event.actorIds.forEach((actorId) => {
      if (!world.characters.some((c) => c.id === actorId))
        errors.push({ nodeId, message: `Actor "${actorId}" not found` });
    });
  });

  return errors;
}

function generateId() {
  return Math.random().toString(36).slice(2, 10);
}

/* ── Rich node content renderers ──────────────────────────── */

function WorldCoreContent({ world }: { world: WorldDefinition }) {
  return (
    <div style={{ marginTop: "0.5rem" }}>
      <p style={{ fontSize: "0.7rem", color: "var(--muted)", lineHeight: 1.4, marginBottom: "0.5rem" }}>
        {world.setting.slice(0, 100)}...
      </p>
      <div style={{ display: "flex", gap: "0.25rem", flexWrap: "wrap", marginBottom: "0.5rem" }}>
        <Badge text={`${world.norms.length} norms`} />
        <Badge text={`${world.powerStructures.length} power structures`} />
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: "0.125rem", alignItems: "flex-end" }}>
        <PortDot color={NODE_COLORS.character.dot} label="characters" />
        <PortDot color={NODE_COLORS.group.dot} label="groups" />
        <PortDot color={NODE_COLORS.event.dot} label="events" />
      </div>
    </div>
  );
}

function CharacterContent({ char, world }: { char: CharacterDefinition; world: WorldDefinition }) {
  const groupIds = char.groupIds?.length ? char.groupIds : char.groupId ? [char.groupId] : [];
  const groups = groupIds.map((gid) => world.groups.find((g) => g.id === gid)).filter(Boolean);
  return (
    <div style={{ marginTop: "0.375rem" }}>
      <p style={{ fontSize: "0.7rem", color: "var(--muted)", marginBottom: "0.375rem" }}>{char.title}</p>
      <div style={{ display: "flex", gap: "0.25rem", flexWrap: "wrap", marginBottom: "0.5rem" }}>
        <Badge text={char.archetype} color={NODE_COLORS.character.dot} />
        {groups.map((group) => group && <Badge key={group.id} text={group.name} color={NODE_COLORS.group.dot} />)}
      </div>
      {char.tags && char.tags.length > 0 && (
        <div style={{ display: "flex", gap: "0.2rem", flexWrap: "wrap", marginBottom: "0.375rem" }}>
          {char.tags.map((tag) => (
            <span key={tag} style={{ fontSize: "0.5rem", padding: "0.1rem 0.3rem", borderRadius: "0.2rem", background: "rgba(232,121,160,0.12)", color: "rgba(232,121,160,0.7)" }}>{tag}</span>
          ))}
        </div>
      )}
      <div style={{ display: "flex", flexDirection: "column", gap: "0.25rem" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "0.375rem" }}>
          <span style={{ fontSize: "0.55rem", color: "var(--muted)", width: 36 }}>anger</span>
          <MiniBar value={char.emotionalBaseline.anger} color="#EF5B5B" />
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: "0.375rem" }}>
          <span style={{ fontSize: "0.55rem", color: "var(--muted)", width: 36 }}>fear</span>
          <MiniBar value={char.emotionalBaseline.fear} color="#E2A55A" />
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: "0.375rem" }}>
          <span style={{ fontSize: "0.55rem", color: "var(--muted)", width: 36 }}>hope</span>
          <MiniBar value={char.emotionalBaseline.hope} color="#6DB889" />
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: "0.375rem" }}>
          <span style={{ fontSize: "0.55rem", color: "var(--muted)", width: 36 }}>loyalty</span>
          <MiniBar value={char.emotionalBaseline.loyalty} color="#5B8DEF" />
        </div>
      </div>
    </div>
  );
}

function GroupContent({ group }: { group: GroupDefinition }) {
  return (
    <div style={{ marginTop: "0.375rem" }}>
      <div style={{ display: "flex", alignItems: "center", gap: "0.375rem", marginBottom: "0.375rem" }}>
        {group.powerType && <Badge text={group.powerType} />}
        <Badge
          text={group.disposition}
          color={
            group.disposition === "supportive" ? "#6DB889"
            : group.disposition === "hostile" ? "#EF5B5B"
            : group.disposition === "volatile" ? "#E2A55A"
            : undefined
          }
        />
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: "0.375rem", marginBottom: "0.375rem" }}>
        <span style={{ fontSize: "0.6rem", color: "var(--muted)" }}>Influence</span>
        <MiniBar value={group.influence} color={NODE_COLORS.group.dot} />
      </div>
      {group.tags && group.tags.length > 0 && (
        <div style={{ display: "flex", gap: "0.25rem", flexWrap: "wrap", marginBottom: "0.375rem" }}>
          {group.tags.map((tag) => (
            <Badge key={tag} text={tag} color={NODE_COLORS.group.dot} />
          ))}
        </div>
      )}
      <div style={{ marginTop: "0.25rem", display: "flex", justifyContent: "flex-end" }}>
        <PortDot color={NODE_COLORS.character.dot} label="members" />
      </div>
    </div>
  );
}

function RoleContent({ role }: { role: RoleDefinition }) {
  return (
    <div style={{ marginTop: "0.375rem" }}>
      <p style={{ fontSize: "0.7rem", color: "var(--muted)", lineHeight: 1.4, marginBottom: "0.5rem" }}>
        {role.summary.slice(0, 80)}
      </p>
      <div style={{ display: "flex", gap: "0.25rem", flexWrap: "wrap" }}>
        {role.responsibilities.slice(0, 3).map((r, i) => (
          <Badge key={i} text={r.length > 20 ? r.slice(0, 18) + "..." : r} />
        ))}
      </div>
    </div>
  );
}

function EventContent({ event, world }: { event: EventTemplate; world: WorldDefinition }) {
  const triggerParts: string[] = [];
  if (event.triggerWhen?.stabilityBelow) triggerParts.push(`stability < ${event.triggerWhen.stabilityBelow}`);
  if (event.triggerWhen?.pressureAbove) triggerParts.push(`pressure > ${event.triggerWhen.pressureAbove}`);
  if (event.triggerWhen?.resourcesBelow) triggerParts.push(`resources < ${event.triggerWhen.resourcesBelow}`);
  if (event.triggerWhen?.moraleBelow) triggerParts.push(`morale < ${event.triggerWhen.moraleBelow}`);

  return (
    <div style={{ marginTop: "0.375rem" }}>
      <p style={{ fontSize: "0.7rem", color: "var(--muted)", lineHeight: 1.4, marginBottom: "0.375rem" }}>
        {event.summary.slice(0, 80)}...
      </p>
      <div style={{ display: "flex", alignItems: "center", gap: "0.375rem", marginBottom: "0.375rem" }}>
        <span style={{ fontSize: "0.6rem", color: "var(--muted)" }}>Urgency</span>
        <MiniBar value={event.urgency} color={event.urgency > 70 ? "#EF5B5B" : "#E2A55A"} />
      </div>
      {triggerParts.length > 0 && (
        <p style={{ fontSize: "0.6rem", color: "var(--muted)", marginBottom: "0.375rem" }}>
          Trigger: {triggerParts.join(", ")}
        </p>
      )}
      <div style={{ display: "flex", gap: "0.25rem", flexWrap: "wrap" }}>
        <span style={{ fontSize: "0.55rem", color: "var(--muted)", marginRight: "0.125rem" }}>Actors:</span>
        {event.actorIds.map((id) => {
          const char = world.characters.find((c) => c.id === id);
          return <Badge key={id} text={char?.name ?? id} color={NODE_COLORS.character.dot} />;
        })}
      </div>
    </div>
  );
}

function InitialStateContent({ world }: { world: WorldDefinition }) {
  const s = world.initialState;
  return (
    <div style={{ marginTop: "0.5rem", display: "flex", flexDirection: "column", gap: "0.375rem" }}>
      <div style={{ display: "flex", alignItems: "center", gap: "0.375rem" }}>
        <span style={{ fontSize: "0.6rem", color: "var(--muted)", width: 56 }}>Stability</span>
        <MiniBar value={s.stability ?? 50} color="#6DB889" />
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: "0.375rem" }}>
        <span style={{ fontSize: "0.6rem", color: "var(--muted)", width: 56 }}>Morale</span>
        <MiniBar value={s.morale ?? 50} color="#E2A55A" />
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: "0.375rem" }}>
        <span style={{ fontSize: "0.6rem", color: "var(--muted)", width: 56 }}>Resources</span>
        <MiniBar value={s.resources ?? 50} color="#5B8DEF" />
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: "0.375rem" }}>
        <span style={{ fontSize: "0.6rem", color: "var(--muted)", width: 56 }}>Pressure</span>
        <MiniBar value={s.pressure ?? 50} color="#EF5B5B" />
      </div>
    </div>
  );
}

/* ── Palette sidebar items ────────────────────────────────── */

const paletteEntityTypes: EntityType[] = ["world", "character", "group", "role", "event", "relationship", "state"];
const addableTypes: EntityType[] = ["character", "group", "role", "event", "relationship"];

/* ── Component ────────────────────────────────────────────── */

type WorldEditorProps = {
  worlds: { id: string; title: string }[];
};

export function WorldEditor({ worlds }: WorldEditorProps) {
  const viewportRef = useRef<HTMLDivElement | null>(null);

  const [worldId, setWorldId] = useState(worlds[0]?.id ?? "");
  const [world, setWorld] = useState<WorldDefinition | null>(null);
  const [dirty, setDirty] = useState(false);

  const [nodes, setNodes] = useState<EditorNode[]>([]);
  const [edges, setEdges] = useState<EditorEdge[]>([]);
  const [camera, setCamera] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(0.75);
  const [dragState, setDragState] = useState<DragState>(null);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);

  const [validationErrors, setValidationErrors] = useState<ValidationError[]>([]);
  const [isLoading, startLoading] = useTransition();
  const [isSaving, startSaving] = useTransition();
  const [saveStatus, setSaveStatus] = useState<"saved" | "error" | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);

  const nodeLookup = useMemo(() => Object.fromEntries(nodes.map((n) => [n.id, n])), [nodes]);
  const selectedNode = selectedNodeId ? nodeLookup[selectedNodeId] ?? null : null;

  const errorsForNode = useCallback(
    (nodeId: string) => validationErrors.filter((e) => e.nodeId === nodeId),
    [validationErrors],
  );

  /* ── Load world ─────────────────────────────────────────── */

  function loadWorld(id: string) {
    setWorldId(id);
    setSaveStatus(null);
    setSaveError(null);
    setSelectedNodeId(null);
    setDirty(false);

    startLoading(async () => {
      const response = await fetch(`/api/worlds/${id}`, { cache: "no-store" });
      if (!response.ok) {
        setSaveError("Failed to load world.");
        return;
      }

      const payload = (await response.json()) as { world: WorldDefinition };
      const w = payload.world;
      setWorld(w);

      const builtNodes = buildNodesFromWorld(w);
      const builtEdges = buildEdgesFromWorld(w, builtNodes);
      setNodes(builtNodes);
      setEdges(builtEdges);
      setValidationErrors(validateWorld(w));
    });
  }

  useEffect(() => {
    if (worldId) loadWorld(worldId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ── Save world ─────────────────────────────────────────── */

  function saveWorld() {
    if (!world) return;

    setSaveError(null);
    setSaveStatus(null);

    const errors = validateWorld(world);
    setValidationErrors(errors);
    if (errors.length > 0) {
      setSaveError(`${errors.length} validation error${errors.length > 1 ? "s" : ""}`);
      return;
    }

    startSaving(async () => {
      const response = await fetch(`/api/worlds/${worldId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ definition: world }),
      });

      if (!response.ok) {
        const payload = (await response.json()) as { error?: string };
        setSaveError(payload.error ?? "Failed to save.");
        setSaveStatus("error");
        return;
      }

      setSaveStatus("saved");
      setDirty(false);
    });
  }

  /* ── World mutation helpers ─────────────────────────────── */

  function updateWorldField(updater: (w: WorldDefinition) => WorldDefinition) {
    if (!world) return;
    const next = updater(world);
    setWorld(next);
    setDirty(true);
    setSaveStatus(null);
    setValidationErrors(validateWorld(next));
  }

  function updateCharacter(charId: string, updater: (c: CharacterDefinition) => CharacterDefinition) {
    updateWorldField((w) => ({ ...w, characters: w.characters.map((c) => (c.id === charId ? updater(c) : c)) }));
  }

  function updateGroup(groupId: string, updater: (g: GroupDefinition) => GroupDefinition) {
    updateWorldField((w) => ({ ...w, groups: w.groups.map((g) => (g.id === groupId ? updater(g) : g)) }));
  }

  function updateRole(roleId: string, updater: (r: RoleDefinition) => RoleDefinition) {
    updateWorldField((w) => ({ ...w, roles: w.roles.map((r) => (r.id === roleId ? updater(r) : r)) }));
  }

  function updateEvent(eventId: string, updater: (e: EventTemplate) => EventTemplate) {
    updateWorldField((w) => ({ ...w, eventTemplates: w.eventTemplates.map((e) => (e.id === eventId ? updater(e) : e)) }));
  }

  function updateRelationship(relId: string, updater: (r: RelationshipDefinition) => RelationshipDefinition) {
    updateWorldField((w) => ({ ...w, relationships: (w.relationships ?? []).map((r) => (r.id === relId ? updater(r) : r)) }));
  }

  function deleteEntity(entityType: EntityType, entityId: string) {
    if (!world) return;
    let next = { ...world };
    switch (entityType) {
      case "character": next = { ...next, characters: next.characters.filter((c) => c.id !== entityId) }; break;
      case "group": next = { ...next, groups: next.groups.filter((g) => g.id !== entityId) }; break;
      case "role": next = { ...next, roles: next.roles.filter((r) => r.id !== entityId) }; break;
      case "event": next = { ...next, eventTemplates: next.eventTemplates.filter((e) => e.id !== entityId) }; break;
      case "relationship": next = { ...next, relationships: (next.relationships ?? []).filter((r) => r.id !== entityId) }; break;
      default: return;
    }
    setWorld(next);
    setDirty(true);
    setValidationErrors(validateWorld(next));
    const nodeId = nodes.find((n) => n.entityType === entityType && n.entityId === entityId)?.id;
    if (nodeId) {
      setNodes((prev) => prev.filter((n) => n.id !== nodeId));
      setEdges((prev) => prev.filter((e) => e.from !== nodeId && e.to !== nodeId));
      if (selectedNodeId === nodeId) setSelectedNodeId(null);
    }
  }

  /* ── Add entity ─────────────────────────────────────────── */

  function addEntity(entityType: EntityType) {
    if (!world) return;
    const id = generateId();
    let next = { ...world };
    switch (entityType) {
      case "character": {
        next = { ...next, characters: [...next.characters, {
          id, name: "New Character", title: "Untitled", archetype: "neutral",
          groupId: world.groups[0]?.id ?? "",
          groupIds: [world.groups[0]?.id ?? ""],
          motivations: [""],
          emotionalBaseline: { anger: 20, fear: 20, hope: 50, loyalty: 50, volatility: 50 },
          speakingStyle: "measured and calm",
          tags: [],
        }] };
        break;
      }
      case "group": {
        next = { ...next, groups: [...next.groups, { id, name: "New Group", description: "", influence: 50, disposition: "neutral" as const, volatility: 50, tags: [] }] };
        break;
      }
      case "role": {
        next = { ...next, roles: [...next.roles, { id, title: "New Role", summary: "", responsibilities: [""] }] };
        break;
      }
      case "event": {
        next = { ...next, eventTemplates: [...next.eventTemplates, {
          id, title: "New Event", category: "politics" as const, summary: "", urgency: 50,
          triggerWhen: {}, stakes: [""], narratorPrompt: "",
          actorIds: world.characters[0] ? [world.characters[0].id] : [],
        }] };
        break;
      }
      case "relationship": {
        const srcId = world.characters[0]?.id ?? "";
        const tgtId = world.characters[1]?.id ?? world.characters[0]?.id ?? "";
        next = { ...next, relationships: [...(next.relationships ?? []), {
          id, sourceCharacterId: srcId, targetCharacterId: tgtId,
          metrics: { trust: 50, fear: 10, loyalty: 50, respect: 50 },
          recentMemory: [],
        }] };
        break;
      }
      default: return;
    }
    setWorld(next);
    setDirty(true);
    const maxY = nodes.reduce((m, n) => Math.max(m, n.y + n.h), 0);
    const newNode: EditorNode = {
      id: `node-${entityType.slice(0, 4)}-${id}`,
      entityType, entityId: id,
      label: entityType === "character" ? "New Character" : entityType === "group" ? "New Group" : entityType === "role" ? "New Role" : entityType === "relationship" ? "New Relationship" : "New Event",
      subtitle: "", x: 400, y: maxY + 60, w: 260, h: 140, collapsed: false,
    };
    setNodes((prev) => [...prev, newNode]);
    setSelectedNodeId(newNode.id);
    setValidationErrors(validateWorld(next));
  }

  /* ── Canvas interactions ────────────────────────────────── */

  function clientToWorld(clientX: number, clientY: number) {
    const rect = viewportRef.current?.getBoundingClientRect();
    if (!rect) return { x: 0, y: 0 };
    return { x: (clientX - rect.left - camera.x) / zoom, y: (clientY - rect.top - camera.y) / zoom };
  }

  function startPan(event: PointerEvent<HTMLDivElement>) {
    if (event.button !== 0) return;
    if ((event.target as HTMLElement).closest("[data-pan-ignore='true']")) return;
    event.preventDefault();
    viewportRef.current?.setPointerCapture(event.pointerId);
    setDragState({ type: "pan", pointerId: event.pointerId, startClientX: event.clientX, startClientY: event.clientY, originX: camera.x, originY: camera.y });
  }

  function startNodeDrag(event: PointerEvent<HTMLElement>, nodeId: string) {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    const targetNode = nodeLookup[nodeId];
    if (!targetNode) return;
    const wp = clientToWorld(event.clientX, event.clientY);
    viewportRef.current?.setPointerCapture(event.pointerId);
    setDragState({ type: "node", pointerId: event.pointerId, nodeId, offsetX: wp.x - targetNode.x, offsetY: wp.y - targetNode.y, startClientX: event.clientX, startClientY: event.clientY });
  }

  function onPointerMove(event: PointerEvent<HTMLDivElement>) {
    if (!dragState || dragState.pointerId !== event.pointerId) return;
    if (dragState.type === "pan") {
      setCamera({ x: dragState.originX + (event.clientX - dragState.startClientX), y: dragState.originY + (event.clientY - dragState.startClientY) });
      return;
    }
    const wp = clientToWorld(event.clientX, event.clientY);
    setNodes((cur) => cur.map((n) => n.id !== dragState.nodeId ? n : { ...n, x: wp.x - dragState.offsetX, y: wp.y - dragState.offsetY }));
  }

  function stopDragging(event: PointerEvent<HTMLDivElement>) {
    if (!dragState || dragState.pointerId !== event.pointerId) return;
    if (viewportRef.current?.hasPointerCapture(event.pointerId)) viewportRef.current.releasePointerCapture(event.pointerId);

    // If the pointer barely moved during a node drag, treat it as a click → select
    if (dragState.type === "node") {
      const dx = event.clientX - dragState.startClientX;
      const dy = event.clientY - dragState.startClientY;
      if (Math.abs(dx) < 4 && Math.abs(dy) < 4) {
        setSelectedNodeId((prev) => prev === dragState.nodeId ? null : dragState.nodeId);
      }
    }

    // If the pointer barely moved during a pan, treat as canvas click → deselect
    if (dragState.type === "pan") {
      const dx = event.clientX - dragState.startClientX;
      const dy = event.clientY - dragState.startClientY;
      if (Math.abs(dx) < 4 && Math.abs(dy) < 4) {
        setSelectedNodeId(null);
      }
    }

    setDragState(null);
  }

  function onWheel(event: WheelEvent<HTMLDivElement>) {
    event.preventDefault();
    const rect = viewportRef.current?.getBoundingClientRect();
    if (!rect) return;
    const px = event.clientX - rect.left;
    const py = event.clientY - rect.top;
    setZoom((pz) => {
      const nz = clamp(event.deltaY < 0 ? pz * 1.09 : pz * 0.91, 0.25, 2.0);
      setCamera((pc) => ({ x: px - ((px - pc.x) / pz) * nz, y: py - ((py - pc.y) / pz) * nz }));
      return nz;
    });
  }

  function toggleCollapse(nodeId: string) {
    setNodes((prev) => prev.map((n) => n.id === nodeId ? { ...n, collapsed: !n.collapsed } : n));
  }

  /* ── Sync node labels ───────────────────────────────────── */

  useEffect(() => {
    if (!world) return;
    setNodes((prev) =>
      prev.map((node) => {
        switch (node.entityType) {
          case "world": return { ...node, label: world.title, subtitle: world.setting.slice(0, 80) };
          case "character": { const c = world.characters.find((ch) => ch.id === node.entityId); return c ? { ...node, label: c.name, subtitle: `${c.title} · ${c.archetype}` } : node; }
          case "group": { const g = world.groups.find((gr) => gr.id === node.entityId); return g ? { ...node, label: g.name, subtitle: `${g.disposition} · influence ${g.influence}` } : node; }
          case "role": { const r = world.roles.find((ro) => ro.id === node.entityId); return r ? { ...node, label: r.title, subtitle: r.summary.slice(0, 60) } : node; }
          case "event": { const e = world.eventTemplates.find((ev) => ev.id === node.entityId); return e ? { ...node, label: e.title, subtitle: `${e.category} · urgency ${e.urgency}` } : node; }
          case "state": return { ...node, subtitle: `stability ${world.initialState.stability} · morale ${world.initialState.morale}` };
          default: return node;
        }
      }),
    );
  }, [world]);

  /* ── Rich node content renderer ─────────────────────────── */

  function renderNodeContent(node: EditorNode) {
    if (!world || node.collapsed) return null;

    switch (node.entityType) {
      case "world": return <WorldCoreContent world={world} />;
      case "character": {
        const c = world.characters.find((ch) => ch.id === node.entityId);
        return c ? <CharacterContent char={c} world={world} /> : null;
      }
      case "group": {
        const g = world.groups.find((gr) => gr.id === node.entityId);
        return g ? <GroupContent group={g} /> : null;
      }
      case "role": {
        const r = world.roles.find((ro) => ro.id === node.entityId);
        return r ? <RoleContent role={r} /> : null;
      }
      case "event": {
        const e = world.eventTemplates.find((ev) => ev.id === node.entityId);
        return e ? <EventContent event={e} world={world} /> : null;
      }
      case "state": return <InitialStateContent world={world} />;
      default: return null;
    }
  }

  /* ── Styles ─────────────────────────────────────────────── */

  const labelStyle: React.CSSProperties = {
    fontFamily: "var(--font-mono)",
    fontSize: "0.6rem",
    fontWeight: 600,
    letterSpacing: "0.12em",
    textTransform: "uppercase",
    color: "var(--muted)",
  };

  const worldTitle = worlds.find((w) => w.id === worldId)?.title ?? "Untitled World";

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "calc(100vh - 4rem)", margin: "-2rem", overflow: "hidden" }}>

      {/* ── Top bar ──────────────────────────────────────────── */}
      <div
        data-pan-ignore="true"
        style={{
          display: "flex",
          alignItems: "center",
          padding: "0.625rem 1.25rem",
          borderBottom: "1px solid var(--border)",
          background: "var(--panel)",
          gap: "0.75rem",
          flexShrink: 0,
        }}
      >
        <span style={{ fontSize: "0.9375rem", fontWeight: 700 }}>World Editor</span>
        <span style={{ color: "var(--border)" }}>|</span>

        <select
          value={worldId}
          onChange={(e) => loadWorld(e.target.value)}
          disabled={isLoading}
          style={{
            background: "transparent",
            border: "none",
            color: "var(--accent-strong, var(--accent))",
            fontSize: "0.875rem",
            fontWeight: 600,
            outline: "none",
            cursor: "pointer",
          }}
        >
          {worlds.map((w) => (
            <option key={w.id} value={w.id} style={{ background: "var(--panel)", color: "var(--foreground)" }}>
              {w.title}
            </option>
          ))}
        </select>

        {saveStatus === "saved" && (
          <span style={{ fontSize: "0.7rem", padding: "0.125rem 0.5rem", borderRadius: "0.25rem", background: "rgba(109,184,137,0.15)", color: "#6DB889", fontWeight: 600 }}>
            Saved
          </span>
        )}
        {dirty && !saveStatus && (
          <span style={{ fontSize: "0.7rem", padding: "0.125rem 0.5rem", borderRadius: "0.25rem", background: "rgba(251,191,36,0.15)", color: "#fbbf24", fontWeight: 600 }}>
            Unsaved
          </span>
        )}
        {validationErrors.length > 0 && (
          <span style={{ fontSize: "0.7rem", padding: "0.125rem 0.5rem", borderRadius: "0.25rem", background: "rgba(239,91,91,0.15)", color: "#EF5B5B", fontWeight: 600 }}>
            {validationErrors.length} issue{validationErrors.length > 1 ? "s" : ""}
          </span>
        )}

        <div style={{ flex: 1 }} />

        {saveError && <span style={{ fontSize: "0.75rem", color: "var(--danger)" }}>{saveError}</span>}

        <button
          type="button"
          onClick={saveWorld}
          disabled={!dirty || isSaving}
          style={{
            padding: "0.375rem 1rem",
            borderRadius: "0.5rem",
            border: "none",
            background: dirty ? "var(--accent-strong, var(--accent))" : "var(--border)",
            color: dirty ? "#fff" : "var(--muted)",
            fontSize: "0.8125rem",
            fontWeight: 600,
            cursor: dirty ? "pointer" : "not-allowed",
            opacity: isSaving ? 0.6 : 1,
          }}
        >
          {isSaving ? "Saving..." : "Save World"}
        </button>
      </div>

      {/* ── Main area ────────────────────────────────────────── */}
      <div style={{ display: "flex", flex: 1, overflow: "hidden" }}>

        {/* ── Left sidebar palette ───────────────────────────── */}
        <div
          data-pan-ignore="true"
          style={{
            width: 200,
            flexShrink: 0,
            borderRight: "1px solid var(--border)",
            background: "var(--panel)",
            padding: "1rem 0.75rem",
            display: "flex",
            flexDirection: "column",
            gap: "0.5rem",
            overflow: "auto",
          }}
        >
          <div style={labelStyle}>Add Nodes</div>

          {paletteEntityTypes.map((type) => {
            const colors = NODE_COLORS[type];
            const canAdd = addableTypes.includes(type);
            return (
              <button
                key={type}
                type="button"
                onClick={() => canAdd && addEntity(type)}
                disabled={!canAdd || !world}
                style={{
                  display: "flex",
                  alignItems: "flex-start",
                  gap: "0.5rem",
                  width: "100%",
                  padding: "0.625rem 0.5rem",
                  borderRadius: "0.5rem",
                  border: `1px solid ${colors.border}30`,
                  background: `${colors.bg}`,
                  color: "var(--foreground)",
                  cursor: canAdd && world ? "pointer" : "default",
                  textAlign: "left",
                  opacity: !canAdd || !world ? 0.5 : 1,
                  transition: "background 150ms",
                }}
              >
                <span style={{ fontSize: "1rem", color: colors.dot, lineHeight: 1.2, flexShrink: 0 }}>
                  {ENTITY_ICONS[type]}
                </span>
                <div>
                  <div style={{ fontSize: "0.8125rem", fontWeight: 600 }}>{ENTITY_LABELS[type]}</div>
                  <div style={{ fontSize: "0.65rem", color: "var(--muted)", marginTop: "0.125rem" }}>
                    {ENTITY_DESCRIPTIONS[type]}
                  </div>
                </div>
              </button>
            );
          })}

          <div style={{ ...labelStyle, marginTop: "0.75rem" }}>AI Assist</div>
          <button
            type="button"
            disabled
            style={{
              display: "flex",
              alignItems: "flex-start",
              gap: "0.5rem",
              width: "100%",
              padding: "0.625rem 0.5rem",
              borderRadius: "0.5rem",
              border: "1px solid rgba(226,165,90,0.2)",
              background: "rgba(226,165,90,0.05)",
              color: "var(--accent-strong, var(--accent))",
              cursor: "not-allowed",
              textAlign: "left",
              opacity: 0.6,
            }}
          >
            <span style={{ fontSize: "1rem", lineHeight: 1.2 }}>✦</span>
            <div>
              <div style={{ fontSize: "0.8125rem", fontWeight: 600 }}>Generate World</div>
              <div style={{ fontSize: "0.65rem", color: "var(--muted)", marginTop: "0.125rem" }}>
                From a text prompt
              </div>
            </div>
          </button>
        </div>

        {/* ── Canvas ─────────────────────────────────────────── */}
        <div style={{ flex: 1, position: "relative", display: "flex", flexDirection: "column" }}>
          <div
            ref={viewportRef}
            style={{
              flex: 1,
              position: "relative",
              overflow: "hidden",
              cursor: dragState?.type === "pan" ? "grabbing" : "default",
              touchAction: "none",
              background: "var(--background)",
            }}
            onPointerDown={startPan}
            onPointerMove={onPointerMove}
            onPointerUp={stopDragging}
            onPointerCancel={stopDragging}
            onWheel={onWheel}
          >
            {/* Loading */}
            {isLoading && (
              <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", background: "rgba(0,0,0,0.4)", zIndex: 50, fontSize: "0.875rem", color: "var(--muted)" }}>
                Loading world...
              </div>
            )}

            {/* Dot grid */}
            <div
              style={{
                position: "absolute", inset: 0,
                backgroundImage: "radial-gradient(circle, var(--border) 1px, transparent 1px)",
                backgroundSize: `${24 * zoom}px ${24 * zoom}px`,
                backgroundPosition: `${camera.x}px ${camera.y}px`,
                opacity: 0.5,
              }}
              aria-hidden="true"
            />

            {/* Empty state */}
            {!world && !isLoading && (
              <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: "1rem" }}>
                <div style={{ width: 64, height: 64, borderRadius: "50%", background: "rgba(196,149,106,0.1)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "1.5rem", color: NODE_COLORS.world.dot }}>
                  ⊕
                </div>
                <div style={{ textAlign: "center" }}>
                  <div style={{ fontSize: "1.125rem", fontWeight: 600, marginBottom: "0.375rem" }}>Start building your world</div>
                  <div style={{ fontSize: "0.8125rem", color: "var(--muted)", maxWidth: 320, lineHeight: 1.5 }}>
                    Drag node types from the palette or use AI to generate a complete world from a prompt.
                  </div>
                </div>
              </div>
            )}

            {/* Node/edge count badge */}
            {world && nodes.length > 0 && (
              <div style={{
                position: "absolute", top: 12, left: 12, zIndex: 10,
                display: "flex", gap: "0.5rem",
                fontSize: "0.7rem", color: "var(--muted)",
                background: "var(--panel)", border: "1px solid var(--border)",
                borderRadius: "0.375rem", padding: "0.25rem 0.625rem",
              }}>
                <span>{nodes.length} nodes</span>
                <span>{edges.length} connections</span>
              </div>
            )}

            {/* World layer */}
            {world && (
              <div
                style={{
                  position: "absolute", left: 0, top: 0,
                  width: worldSize.width, height: worldSize.height,
                  transform: `translate(${camera.x}px, ${camera.y}px) scale(${zoom})`,
                  transformOrigin: "0 0",
                }}
              >
                {/* Edges */}
                <svg
                  width={worldSize.width} height={worldSize.height}
                  style={{ position: "absolute", left: 0, top: 0, pointerEvents: "none" }}
                  viewBox={`0 0 ${worldSize.width} ${worldSize.height}`}
                  fill="none" aria-hidden="true"
                >
                  <defs>
                    <marker id="editor-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse">
                      <path d="M 0 0 L 10 5 L 0 10 z" fill="var(--muted)" fillOpacity="0.4" />
                    </marker>
                  </defs>
                  {edges.map((edge) => {
                    const from = nodeLookup[edge.from];
                    const to = nodeLookup[edge.to];
                    if (!from || !to) return null;
                    const { start, end } = getEdgeAnchors(from, to);
                    const midX = (start.x + end.x) / 2;
                    return (
                      <g key={edge.id}>
                        <path
                          d={`M ${start.x} ${start.y} C ${midX} ${start.y}, ${midX} ${end.y}, ${end.x} ${end.y}`}
                          stroke="var(--border)" strokeWidth={1.5} strokeOpacity={0.7} fill="none"
                          markerEnd="url(#editor-arrow)"
                        />
                      </g>
                    );
                  })}
                </svg>

                {/* Nodes */}
                {nodes.map((node) => {
                  const colors = NODE_COLORS[node.entityType];
                  const nodeErrors = errorsForNode(node.id);
                  const isSelected = selectedNodeId === node.id;
                  const hasErrors = nodeErrors.length > 0;

                  return (
                    <article
                      key={node.id}
                      style={{
                        position: "absolute",
                        left: node.x, top: node.y, width: node.w,
                        padding: node.collapsed ? "0.5rem 0.75rem" : "0.75rem",
                        borderRadius: "0.625rem",
                        border: `1.5px solid ${hasErrors ? "#EF5B5B" : isSelected ? colors.dot : colors.border}`,
                        background: isSelected ? colors.bg : "var(--panel)",
                        boxShadow: isSelected
                          ? `0 0 0 2px ${colors.dot}40, 0 12px 32px var(--shadow)`
                          : "0 4px 16px var(--shadow)",
                        cursor: dragState?.type === "node" && dragState.nodeId === node.id ? "grabbing" : "grab",
                        userSelect: "none",
                        transition: "box-shadow 150ms, border-color 150ms",
                      }}
                      onPointerDown={(e) => startNodeDrag(e, node.id)}
                    >
                      {/* Header row */}
                      <div style={{ display: "flex", alignItems: "center", gap: "0.375rem" }}>
                        {/* Left port dot */}
                        <span style={{ width: 7, height: 7, borderRadius: "50%", background: colors.dot, flexShrink: 0 }} />

                        {/* Type label */}
                        <span style={{ ...labelStyle, fontSize: "0.55rem", color: colors.dot }}>
                          {ENTITY_LABELS[node.entityType]}
                        </span>

                        {/* Category badge for events */}
                        {node.entityType === "event" && world && (() => {
                          const ev = world.eventTemplates.find((e) => e.id === node.entityId);
                          return ev ? <Badge text={ev.category} color={colors.dot} /> : null;
                        })()}

                        <div style={{ flex: 1 }} />

                        {/* Error badge */}
                        {hasErrors && (
                          <span style={{
                            width: 16, height: 16, borderRadius: "50%",
                            background: "#EF5B5B", color: "#fff",
                            fontSize: "0.55rem", fontWeight: 700,
                            display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
                          }}>
                            {nodeErrors.length}
                          </span>
                        )}

                        {/* Collapse chevron */}
                        <button
                          type="button"
                          onClick={(e) => { e.stopPropagation(); toggleCollapse(node.id); }}
                          style={{
                            border: "none", background: "transparent", color: "var(--muted)",
                            cursor: "pointer", fontSize: "0.75rem", padding: 0, lineHeight: 1,
                          }}
                        >
                          {node.collapsed ? "▸" : "▾"}
                        </button>
                      </div>

                      {/* Title */}
                      <div style={{
                        fontSize: "0.875rem", fontWeight: 600, color: "var(--foreground)",
                        marginTop: node.collapsed ? 0 : "0.375rem",
                        overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                      }}>
                        {node.label}
                      </div>

                      {/* Validation errors inline */}
                      {!node.collapsed && hasErrors && (
                        <div style={{ marginTop: "0.25rem" }}>
                          {nodeErrors.slice(0, 2).map((err, i) => (
                            <p key={i} style={{ fontSize: "0.6rem", color: "#EF5B5B", lineHeight: 1.4 }}>
                              {err.message}
                            </p>
                          ))}
                        </div>
                      )}

                      {/* Rich content */}
                      {!node.collapsed && !hasErrors && renderNodeContent(node)}

                      {/* Valid indicator */}
                      {!node.collapsed && !hasErrors && nodeErrors.length === 0 && node.entityType !== "world" && node.entityType !== "state" && (
                        <div style={{ marginTop: "0.375rem", display: "flex", alignItems: "center", gap: "0.25rem" }}>
                          <span style={{ fontSize: "0.6rem", color: "#6DB889" }}>✓</span>
                          <span style={{ fontSize: "0.55rem", color: "#6DB889" }}>Valid</span>
                        </div>
                      )}
                    </article>
                  );
                })}
              </div>
            )}
          </div>

          {/* ── Bottom status bar ─────────────────────────────── */}
          <div style={{
            display: "flex",
            alignItems: "center",
            padding: "0.375rem 1rem",
            borderTop: "1px solid var(--border)",
            background: "var(--panel)",
            gap: "1rem",
            flexShrink: 0,
            fontSize: "0.7rem",
            color: "var(--muted)",
          }}>
            {/* Error/warning summary */}
            {validationErrors.length > 0 && (
              <>
                <span style={{ color: "#EF5B5B" }}>
                  {validationErrors.length} error{validationErrors.length > 1 ? "s" : ""}
                </span>
                <span style={{ color: "var(--border)" }}>|</span>
                <span>{validationErrors[0].message}</span>
              </>
            )}

            <div style={{ flex: 1 }} />

            {/* Keyboard shortcuts */}
            <div style={{ display: "flex", gap: "0.75rem", alignItems: "center" }}>
              <span>
                <kbd style={{ padding: "0.0625rem 0.25rem", borderRadius: "0.1875rem", border: "1px solid var(--border)", fontSize: "0.6rem", fontFamily: "var(--font-mono)" }}>Space</kbd>
                {" "}Pan
              </span>
              <span>
                <kbd style={{ padding: "0.0625rem 0.25rem", borderRadius: "0.1875rem", border: "1px solid var(--border)", fontSize: "0.6rem", fontFamily: "var(--font-mono)" }}>Scroll</kbd>
                {" "}Zoom
              </span>
            </div>

            <span style={{ width: 1, height: 14, background: "var(--border)" }} />

            {/* Zoom controls */}
            <div style={{ display: "flex", alignItems: "center", gap: "0.375rem" }}>
              <button type="button" onClick={() => setZoom((z) => clamp(z * 0.9, 0.25, 2.0))}
                style={{ border: "1px solid var(--border)", background: "transparent", color: "var(--foreground)", borderRadius: "0.25rem", padding: "0.125rem 0.375rem", cursor: "pointer", fontSize: "0.75rem" }}>
                &minus;
              </button>
              <span style={{ fontFamily: "var(--font-mono)", fontSize: "0.65rem", minWidth: 36, textAlign: "center" }}>
                {Math.round(zoom * 100)}%
              </span>
              <button type="button" onClick={() => setZoom((z) => clamp(z * 1.12, 0.25, 2.0))}
                style={{ border: "1px solid var(--border)", background: "transparent", color: "var(--foreground)", borderRadius: "0.25rem", padding: "0.125rem 0.375rem", cursor: "pointer", fontSize: "0.75rem" }}>
                +
              </button>
              <button type="button" onClick={() => { setZoom(0.75); setCamera({ x: 0, y: 0 }); }}
                style={{ border: "1px solid var(--border)", background: "transparent", color: "var(--foreground)", borderRadius: "0.25rem", padding: "0.125rem 0.375rem", cursor: "pointer", fontSize: "0.7rem" }}>
                ⤢
              </button>
            </div>
          </div>
        </div>

        {/* ── Detail panel ───────────────────────────────────── */}
        {selectedNode && world && (
          <WorldEditorPanel
            node={selectedNode}
            world={world}
            errors={errorsForNode(selectedNode.id)}
            onUpdateCharacter={updateCharacter}
            onUpdateGroup={updateGroup}
            onUpdateRole={updateRole}
            onUpdateEvent={updateEvent}
            onUpdateRelationship={updateRelationship}
            onUpdateWorld={updateWorldField}
            onDelete={deleteEntity}
            onClose={() => setSelectedNodeId(null)}
          />
        )}
      </div>
    </div>
  );
}
