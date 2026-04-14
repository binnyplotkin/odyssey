"use client";

import {
  type PointerEvent,
  type WheelEvent,
  type MouseEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
} from "react";
import type {
  WorldDefinition,
  CharacterDefinition,
  GroupDefinition,
  RoleDefinition,
  EventTemplate,
  RelationshipDefinition,
} from "@odyssey/types";
import { WorldEditorPanel } from "./world-editor-panel";
import type { EntityType, EditorNode } from "./world-editor";

/* ── Design Tokens (matching Paper designs) ────────────────── */

const T = {
  canvasBg: "#0C0E14",
  chrome: "#111318",
  nodeBg: "#161620",
  borderSubtle: "rgba(255,255,255,0.07)",
  borderInput: "rgba(255,255,255,0.1)",
  textPrimary: "rgba(255,255,255,0.93)",
  textSecondary: "rgba(255,255,255,0.7)",
  textTertiary: "rgba(255,255,255,0.5)",
  textQuaternary: "rgba(255,255,255,0.45)",
  fontHeading: "'Space Grotesk', sans-serif",
  fontBody: "'Inter', sans-serif",
  fontMono: "'JetBrains Mono', monospace",
} as const;

const NODE_COLORS: Record<EntityType, { dot: string; glow: string }> = {
  world:        { dot: "#F4CC15", glow: "rgba(244,204,21,0.2)" },
  role:         { dot: "#F4CC15", glow: "rgba(244,204,21,0.2)" },
  character:    { dot: "#E879A0", glow: "rgba(232,121,160,0.2)" },
  group:        { dot: "#6B8AFF", glow: "rgba(107,138,255,0.2)" },
  event:        { dot: "#F4944D", glow: "rgba(244,148,77,0.2)" },
  state:        { dot: "#8DF0C8", glow: "rgba(141,240,200,0.2)" },
  relationship: { dot: "#A88CFF", glow: "rgba(168,140,255,0.2)" },
};

const ENTITY_LABELS: Record<EntityType, string> = {
  world: "WORLD CORE",
  character: "CHARACTER",
  group: "GROUP",
  role: "ROLE",
  event: "EVENT",
  state: "INITIAL STATE",
  relationship: "RELATIONSHIP",
};

const ENTITY_DESCRIPTIONS: Record<EntityType, string> = {
  world: "Setting, theme, and narrative frame",
  character: "NPC with personality, emotions, and voice",
  group: "Faction with influence, goals, and dynamics",
  role: "Player identity, authority, and goals",
  event: "Scenario with stakes, actors, and triggers",
  state: "Starting metrics, relationships, and flags",
  relationship: "Trust, fear, loyalty between characters",
};

/* ── Types ────────────────────────────────────────────────── */

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

type ValidationError = { nodeId: string; message: string };

type ContextMenuState = { x: number; y: number; nodeId: string } | null;

/* ── Constants ────────────────────────────────────────────── */

const worldSize = { width: 6000, height: 4000 };

function clamp(v: number, min: number, max: number) {
  return Math.min(max, Math.max(min, v));
}

function generateId() {
  return Math.random().toString(36).slice(2, 10);
}

/* ── Layout ──────────────────────────────────────────────── */

function buildNodesFromWorld(world: WorldDefinition): EditorNode[] {
  const nodes: EditorNode[] = [];
  const gap = 40;

  nodes.push({
    id: "node-world", entityType: "world", entityId: world.id,
    label: world.title, subtitle: world.setting.slice(0, 80),
    x: 80, y: 100, w: 240, h: 180, collapsed: false,
  });

  world.roles.forEach((role, i) => {
    nodes.push({
      id: `node-role-${role.id}`, entityType: "role", entityId: role.id,
      label: role.title, subtitle: role.summary.slice(0, 60),
      x: 80, y: 380 + i * (140 + gap), w: 200, h: 130, collapsed: false,
    });
  });

  world.characters.forEach((char, i) => {
    nodes.push({
      id: `node-char-${char.id}`, entityType: "character", entityId: char.id,
      label: char.name, subtitle: `${char.title} · ${char.archetype}`,
      x: 500, y: 80 + i * (170 + gap), w: 220, h: 160, collapsed: false,
    });
  });

  world.groups.forEach((group, i) => {
    nodes.push({
      id: `node-group-${group.id}`, entityType: "group", entityId: group.id,
      label: group.name, subtitle: `${group.disposition} · influence ${group.influence}`,
      x: 800, y: 80 + i * (150 + gap), w: 220, h: 140, collapsed: false,
    });
  });

  world.eventTemplates.forEach((event, i) => {
    nodes.push({
      id: `node-event-${event.id}`, entityType: "event", entityId: event.id,
      label: event.title, subtitle: `${event.category} · urgency ${event.urgency}`,
      x: 1100, y: 80 + i * (150 + gap), w: 220, h: 140, collapsed: false,
    });
  });

  (world.relationships ?? []).forEach((rel, i) => {
    const source = world.characters.find((c) => c.id === rel.sourceCharacterId);
    const target = world.characters.find((c) => c.id === rel.targetCharacterId);
    nodes.push({
      id: `node-rel-${rel.id}`, entityType: "relationship", entityId: rel.id,
      label: `${source?.name ?? rel.sourceCharacterId} → ${target?.name ?? rel.targetCharacterId}`,
      subtitle: `trust ${rel.metrics.trust} · loyalty ${rel.metrics.loyalty}`,
      x: 1400, y: 80 + i * (130 + gap), w: 240, h: 120, collapsed: false,
    });
  });

  nodes.push({
    id: "node-state", entityType: "state", entityId: "initialState",
    label: "Initial State",
    subtitle: `stability ${world.initialState.stability} · morale ${world.initialState.morale}`,
    x: 370, y: 100, w: 100, h: 100, collapsed: false,
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
      if (charNode && groupNode)
        edges.push({ id: `edge-${charNode.id}-${groupNode.id}`, from: charNode.id, to: groupNode.id });
    }
  });

  world.eventTemplates.forEach((event) => {
    event.actorIds.forEach((actorId) => {
      const eventNode = nodes.find((n) => n.entityType === "event" && n.entityId === event.id);
      const charNode = nodes.find((n) => n.entityType === "character" && n.entityId === actorId);
      if (eventNode && charNode)
        edges.push({ id: `edge-${eventNode.id}-${charNode.id}`, from: eventNode.id, to: charNode.id });
    });
  });

  world.roles.forEach((role) => {
    const roleNode = nodes.find((n) => n.entityType === "role" && n.entityId === role.id);
    if (roleNode) edges.push({ id: `edge-world-${roleNode.id}`, from: "node-world", to: roleNode.id });
  });

  world.groups.forEach((group) => {
    const groupNode = nodes.find((n) => n.entityType === "group" && n.entityId === group.id);
    if (groupNode) edges.push({ id: `edge-world-${groupNode.id}`, from: "node-world", to: groupNode.id });
  });

  (world.relationships ?? []).forEach((rel) => {
    const relNode = nodes.find((n) => n.entityType === "relationship" && n.entityId === rel.id);
    const sourceNode = nodes.find((n) => n.entityType === "character" && n.entityId === rel.sourceCharacterId);
    const targetNode = nodes.find((n) => n.entityType === "character" && n.entityId === rel.targetCharacterId);
    if (relNode && sourceNode) edges.push({ id: `edge-${relNode.id}-source`, from: sourceNode.id, to: relNode.id });
    if (relNode && targetNode) edges.push({ id: `edge-${relNode.id}-target`, from: relNode.id, to: targetNode.id });
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

/* ── Validation ──────────────────────────────────────────── */

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

/* ── Inline mini components ──────────────────────────────── */

function MiniBar({ value, max = 100, color }: { value: number; max?: number; color: string }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6, width: "100%" }}>
      <div style={{ flex: 1, height: 3, borderRadius: 2, background: "rgba(255,255,255,0.06)" }}>
        <div style={{ width: `${(value / max) * 100}%`, height: "100%", borderRadius: 2, background: color }} />
      </div>
      <span style={{ fontSize: 10, color: T.textSecondary, fontFamily: T.fontMono, minWidth: 18, textAlign: "right" }}>
        {value}
      </span>
    </div>
  );
}

function Badge({ text, color }: { text: string; color?: string }) {
  return (
    <span style={{
      display: "inline-block", padding: "1px 6px", borderRadius: 3,
      fontSize: 8, fontWeight: 600, fontFamily: T.fontMono,
      background: color ? `${color}22` : "rgba(255,255,255,0.06)",
      color: color ?? T.textSecondary, letterSpacing: "0.04em",
    }}>
      {text}
    </span>
  );
}

/* ── Node content renderers ──────────────────────────────── */

function WorldCoreContent({ world }: { world: WorldDefinition }) {
  return (
    <div style={{ marginTop: 6 }}>
      <div style={{ fontSize: 10, color: T.textTertiary, lineHeight: 1.4, marginBottom: 6, fontFamily: T.fontBody }}>
        {world.setting.length > 60 ? world.setting.slice(0, 58) + "…" : world.setting}
      </div>
      {world.metrics && (
        <Badge text="v2" color="#A88CFF" />
      )}
    </div>
  );
}

function CharacterContent({ char, world }: { char: CharacterDefinition; world: WorldDefinition }) {
  const groupIds = char.groupIds?.length ? char.groupIds : char.groupId ? [char.groupId] : [];
  const groups = groupIds.map((gid) => world.groups.find((g) => g.id === gid)).filter(Boolean);
  return (
    <div style={{ marginTop: 4, fontFamily: T.fontBody }}>
      <div style={{ fontSize: 11, color: T.textSecondary, marginBottom: 4 }}>
        {char.title} · {groups.map((g) => g?.name).join(", ")}
      </div>
      <div style={{ fontSize: 10, color: T.textTertiary, marginBottom: 6, fontStyle: "italic" }}>
        &ldquo;{char.speakingStyle.slice(0, 50)}&rdquo;
      </div>
      {char.tags && char.tags.length > 0 && (
        <div style={{ display: "flex", gap: 3, flexWrap: "wrap" }}>
          {char.tags.map((tag) => (
            <Badge key={tag} text={tag} color={NODE_COLORS.character.dot} />
          ))}
        </div>
      )}
    </div>
  );
}

function GroupContent({ group, world }: { group: GroupDefinition; world: WorldDefinition }) {
  return (
    <div style={{ marginTop: 6 }}>
      <div style={{ display: "flex", gap: 24, marginBottom: 4 }}>
        <div>
          <div style={{ fontSize: 8, color: T.textQuaternary, fontFamily: T.fontMono, letterSpacing: "0.06em", textTransform: "uppercase" }}>INFLUENCE</div>
          <div style={{ fontSize: 14, fontWeight: 600, color: NODE_COLORS.group.dot, fontFamily: T.fontHeading }}>{group.influence}</div>
        </div>
        <div>
          <div style={{ fontSize: 8, color: T.textQuaternary, fontFamily: T.fontMono, letterSpacing: "0.06em", textTransform: "uppercase" }}>DISPOSITION</div>
          <div style={{ fontSize: 13, fontWeight: 500, color: T.textSecondary, fontFamily: T.fontHeading }}>{group.disposition}</div>
        </div>
      </div>
    </div>
  );
}

function RoleContent({ role }: { role: RoleDefinition }) {
  return (
    <div style={{ marginTop: 4, fontFamily: T.fontBody }}>
      <div style={{ fontSize: 11, color: T.textSecondary, marginBottom: 4 }}>
        {role.summary.length > 50 ? role.summary.slice(0, 48) + "…" : role.summary}
      </div>
    </div>
  );
}

function EventContent({ event, world }: { event: EventTemplate; world: WorldDefinition }) {
  return (
    <div style={{ marginTop: 4 }}>
      <div style={{ fontSize: 11, color: T.textSecondary, fontFamily: T.fontBody, marginBottom: 6 }}>
        {event.summary.slice(0, 60)}…
      </div>
      {event.turnRange && (
        <div style={{ fontSize: 9, color: T.textTertiary, fontFamily: T.fontMono, marginBottom: 4 }}>
          Turns {event.turnRange.min}–{event.turnRange.max}
        </div>
      )}
    </div>
  );
}

function InitialStateContent({ world }: { world: WorldDefinition }) {
  const s = world.initialState;
  const metrics = world.metrics ?? [
    { id: "stability", label: "Stability", initialValue: 50, direction: "higher-better" as const },
    { id: "morale", label: "Morale", initialValue: 50, direction: "higher-better" as const },
    { id: "resources", label: "Resources", initialValue: 50, direction: "higher-better" as const },
    { id: "pressure", label: "Pressure", initialValue: 50, direction: "lower-better" as const },
  ];
  const colors = ["#8DF0C8", "#6B8AFF", "#F4CC15", "#F4944D", "#E879A0", "#A88CFF"];
  return (
    <div style={{ marginTop: 6, display: "flex", flexDirection: "column", gap: 4 }}>
      {metrics.map((m, i) => (
        <div key={m.id} style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span style={{ fontSize: 9, color: T.textTertiary, width: 52, fontFamily: T.fontMono }}>{m.label}</span>
          <MiniBar value={s.metricValues[m.id] ?? (s as Record<string, unknown>)[m.id] as number ?? m.initialValue} color={colors[i % colors.length]} />
        </div>
      ))}
    </div>
  );
}

/* ── Add Node dropdown types ─────────────────────────────── */

const addableTypes: { type: EntityType; label: string; description: string }[] = [
  { type: "world", label: "World Core", description: "Setting, theme, and narrative frame" },
  { type: "role", label: "Role", description: "Player identity, authority, and goals" },
  { type: "character", label: "Character", description: "NPC with personality, emotions, and voice" },
  { type: "group", label: "Group", description: "Faction with influence, goals, and dynamics" },
  { type: "event", label: "Event", description: "Scenario with stakes, actors, and triggers" },
  { type: "state", label: "Initial State", description: "Starting metrics, relationships, and flags" },
];

const creatable: EntityType[] = ["character", "group", "role", "event", "relationship"];

/* ── Component ───────────────────────────────────────────── */

type Props = { worlds: { id: string; title: string }[] };

export function WorldEditorCanvas({ worlds }: Props) {
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

  const [addMenuOpen, setAddMenuOpen] = useState(false);
  const [contextMenu, setContextMenu] = useState<ContextMenuState>(null);

  const nodeLookup = useMemo(() => Object.fromEntries(nodes.map((n) => [n.id, n])), [nodes]);
  const selectedNode = selectedNodeId ? nodeLookup[selectedNodeId] ?? null : null;

  const errorsForNode = useCallback(
    (nodeId: string) => validationErrors.filter((e) => e.nodeId === nodeId),
    [validationErrors],
  );

  /* ── Load / Save world ─────────────────────────────────── */

  function loadWorld(id: string) {
    setWorldId(id);
    setSaveStatus(null);
    setSaveError(null);
    setSelectedNodeId(null);
    setDirty(false);
    setContextMenu(null);

    startLoading(async () => {
      const response = await fetch(`/api/worlds/${id}`, { cache: "no-store" });
      if (!response.ok) { setSaveError("Failed to load world."); return; }
      const payload = (await response.json()) as { world: WorldDefinition };
      const w = payload.world;
      setWorld(w);
      const builtNodes = buildNodesFromWorld(w);
      setNodes(builtNodes);
      setEdges(buildEdgesFromWorld(w, builtNodes));
      setValidationErrors(validateWorld(w));
    });
  }

  useEffect(() => {
    if (worldId) loadWorld(worldId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function saveWorld() {
    if (!world) return;
    setSaveError(null);
    setSaveStatus(null);
    const errors = validateWorld(world);
    setValidationErrors(errors);
    if (errors.length > 0) { setSaveError(`${errors.length} validation error${errors.length > 1 ? "s" : ""}`); return; }

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

  /* ── World mutation helpers ────────────────────────────── */

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

  /* ── Add entity ────────────────────────────────────────── */

  function addEntity(entityType: EntityType) {
    if (!world) return;
    const id = generateId();
    let next = { ...world };
    switch (entityType) {
      case "character": {
        next = { ...next, characters: [...next.characters, {
          id, name: "New Character", title: "Untitled", archetype: "neutral",
          groupId: world.groups[0]?.id ?? "", groupIds: [world.groups[0]?.id ?? ""],
          motivations: [""], emotionalBaseline: { anger: 20, fear: 20, hope: 50, loyalty: 50, volatility: 50 },
          speakingStyle: "measured and calm", tags: [],
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
          actorIds: world.characters[0] ? [world.characters[0].id] : [], weight: 1,
        }] };
        break;
      }
      case "relationship": {
        const srcId = world.characters[0]?.id ?? "";
        const tgtId = world.characters[1]?.id ?? world.characters[0]?.id ?? "";
        next = { ...next, relationships: [...(next.relationships ?? []), {
          id, sourceCharacterId: srcId, targetCharacterId: tgtId,
          metrics: { trust: 50, fear: 10, loyalty: 50, respect: 50 }, recentMemory: [],
        }] };
        break;
      }
      default: return;
    }
    setWorld(next);
    setDirty(true);
    const maxY = nodes.reduce((m, n) => Math.max(m, n.y + n.h), 0);
    const newNode: EditorNode = {
      id: `node-${entityType.slice(0, 4)}-${id}`, entityType, entityId: id,
      label: entityType === "character" ? "New Character" : entityType === "group" ? "New Group" : entityType === "role" ? "New Role" : entityType === "relationship" ? "New Relationship" : "New Event",
      subtitle: "", x: 400, y: maxY + 60, w: 220, h: 140, collapsed: false,
    };
    setNodes((prev) => [...prev, newNode]);
    setSelectedNodeId(newNode.id);
    setValidationErrors(validateWorld(next));
    setAddMenuOpen(false);
  }

  /* ── Canvas interactions ───────────────────────────────── */

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
    setContextMenu(null);
    setAddMenuOpen(false);
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
    setContextMenu(null);
    setAddMenuOpen(false);
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
    if (dragState.type === "node") {
      const dx = event.clientX - dragState.startClientX;
      const dy = event.clientY - dragState.startClientY;
      if (Math.abs(dx) < 4 && Math.abs(dy) < 4) {
        setSelectedNodeId((prev) => prev === dragState.nodeId ? null : dragState.nodeId);
      }
    }
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

  function handleContextMenu(event: MouseEvent<HTMLElement>, nodeId: string) {
    event.preventDefault();
    event.stopPropagation();
    const rect = viewportRef.current?.getBoundingClientRect();
    if (!rect) return;
    setContextMenu({ x: event.clientX - rect.left, y: event.clientY - rect.top, nodeId });
    setSelectedNodeId(nodeId);
  }

  function toggleCollapse(nodeId: string) {
    setNodes((prev) => prev.map((n) => n.id === nodeId ? { ...n, collapsed: !n.collapsed } : n));
  }

  /* ── Sync node labels ──────────────────────────────────── */

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

  /* ── Close context menu / add menu on click outside ──── */

  useEffect(() => {
    function handleClick() {
      setContextMenu(null);
    }
    window.addEventListener("click", handleClick);
    return () => window.removeEventListener("click", handleClick);
  }, []);

  /* ── Rich node content ─────────────────────────────────── */

  function renderNodeContent(node: EditorNode) {
    if (!world || node.collapsed) return null;
    switch (node.entityType) {
      case "world": return <WorldCoreContent world={world} />;
      case "character": { const c = world.characters.find((ch) => ch.id === node.entityId); return c ? <CharacterContent char={c} world={world} /> : null; }
      case "group": { const g = world.groups.find((gr) => gr.id === node.entityId); return g ? <GroupContent group={g} world={world} /> : null; }
      case "role": { const r = world.roles.find((ro) => ro.id === node.entityId); return r ? <RoleContent role={r} /> : null; }
      case "event": { const e = world.eventTemplates.find((ev) => ev.id === node.entityId); return e ? <EventContent event={e} world={world} /> : null; }
      case "state": return <InitialStateContent world={world} />;
      default: return null;
    }
  }

  /* ── Legend items ──────────────────────────────────────── */

  const legendItems: { type: EntityType; label: string }[] = [
    { type: "world", label: "World Core" },
    { type: "role", label: "Role" },
    { type: "character", label: "Character" },
    { type: "group", label: "Group" },
    { type: "event", label: "Event" },
    { type: "state", label: "Initial State" },
  ];

  /* ── Render ────────────────────────────────────────────── */

  return (
    <>
      {/* Google Fonts */}
      <link rel="preconnect" href="https://fonts.googleapis.com" />
      <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
      <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&family=JetBrains+Mono:wght@400;500;700&family=Space+Grotesk:wght@400;500;600;700&display=swap" rel="stylesheet" />

      <div style={{
        display: "flex", flexDirection: "column",
        height: "100vh", margin: "-2rem",
        overflow: "hidden", background: T.canvasBg, color: T.textPrimary,
      }}>

        {/* ── Top Bar ──────────────────────────────────────── */}
        <div
          data-pan-ignore="true"
          style={{
            display: "flex", alignItems: "center", justifyContent: "space-between",
            height: 48, padding: "0 16px", flexShrink: 0,
            background: T.chrome, borderBottom: `1px solid ${T.borderSubtle}`,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <span style={{ fontFamily: T.fontHeading, fontSize: 13, fontWeight: 500, color: T.textSecondary }}>World Editor</span>
            <div style={{ width: 1, height: 18, background: T.borderSubtle }} />

            <select
              value={worldId}
              onChange={(e) => loadWorld(e.target.value)}
              disabled={isLoading}
              style={{
                background: "transparent", border: "none", outline: "none", cursor: "pointer",
                fontFamily: T.fontHeading, fontSize: 14, fontWeight: 600, color: T.textPrimary,
              }}
            >
              {worlds.map((w) => (
                <option key={w.id} value={w.id} style={{ background: T.chrome, color: T.textPrimary }}>
                  {w.title}
                </option>
              ))}
            </select>

            {/* Status badges */}
            {saveStatus === "saved" && (
              <span style={{ padding: "2px 8px", borderRadius: 4, background: "rgba(141,240,200,0.2)", fontFamily: T.fontMono, fontSize: 9, fontWeight: 700, color: "#8DF0C8", letterSpacing: "0.06em" }}>
                SAVED
              </span>
            )}
            {dirty && !saveStatus && (
              <span style={{ padding: "2px 8px", borderRadius: 4, background: "rgba(244,204,21,0.2)", fontFamily: T.fontMono, fontSize: 9, fontWeight: 700, color: "#F4CC15", letterSpacing: "0.06em" }}>
                UNSAVED
              </span>
            )}
            {validationErrors.length > 0 && (
              <span style={{ padding: "2px 8px", borderRadius: 4, background: "rgba(239,91,91,0.2)", fontFamily: T.fontMono, fontSize: 9, fontWeight: 700, color: "#EF5B5B", letterSpacing: "0.06em" }}>
                {validationErrors.length} ISSUE{validationErrors.length > 1 ? "S" : ""}
              </span>
            )}
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            {saveError && <span style={{ fontSize: 11, color: "#EF5B5B", fontFamily: T.fontBody, marginRight: 8 }}>{saveError}</span>}
            <button type="button" onClick={() => { setZoom(0.75); setCamera({ x: 0, y: 0 }); }}
              style={{
                padding: "6px 12px", borderRadius: 6, border: `1px solid ${T.borderSubtle}`, background: "transparent",
                fontFamily: T.fontHeading, fontSize: 12, color: T.textSecondary, cursor: "pointer",
              }}>
              Fit View
            </button>
            <button type="button"
              style={{
                padding: "6px 12px", borderRadius: 6, border: `1px solid ${T.borderSubtle}`, background: "transparent",
                fontFamily: T.fontHeading, fontSize: 12, color: T.textSecondary, cursor: "pointer",
              }}>
              Auto Layout
            </button>
            <button type="button"
              style={{
                padding: "6px 12px", borderRadius: 6, border: `1px solid ${T.borderSubtle}`, background: "transparent",
                fontFamily: T.fontHeading, fontSize: 12, color: T.textSecondary, cursor: "pointer",
              }}>
              Preview
            </button>
            <button type="button" onClick={saveWorld} disabled={!dirty || isSaving}
              style={{
                padding: "6px 14px", borderRadius: 6, border: "none",
                background: dirty ? "#8DF0C8" : T.borderSubtle,
                fontFamily: T.fontHeading, fontSize: 12, fontWeight: 600,
                color: dirty ? T.canvasBg : T.textTertiary,
                cursor: dirty ? "pointer" : "not-allowed", opacity: isSaving ? 0.6 : 1,
              }}>
              {isSaving ? "Saving…" : "Save World"}
            </button>
          </div>
        </div>

        {/* ── Main area ────────────────────────────────────── */}
        <div style={{ display: "flex", flex: 1, overflow: "hidden" }}>

          {/* ── Canvas ───────────────────────────────────────── */}
          <div style={{ flex: 1, position: "relative", display: "flex", flexDirection: "column" }}>
            <div
              ref={viewportRef}
              style={{
                flex: 1, position: "relative", overflow: "hidden",
                cursor: dragState?.type === "pan" ? "grabbing" : "default",
                touchAction: "none", background: T.canvasBg,
              }}
              onPointerDown={startPan}
              onPointerMove={onPointerMove}
              onPointerUp={stopDragging}
              onPointerCancel={stopDragging}
              onWheel={onWheel}
              onContextMenu={(e) => { e.preventDefault(); }}
            >
              {/* Loading overlay */}
              {isLoading && (
                <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", background: "rgba(0,0,0,0.5)", zIndex: 50 }}>
                  <span style={{ fontSize: 13, color: T.textSecondary, fontFamily: T.fontHeading }}>Loading world…</span>
                </div>
              )}

              {/* Dot grid */}
              <div
                style={{
                  position: "absolute", inset: 0,
                  backgroundImage: "radial-gradient(circle, rgba(255,255,255,0.08) 1px, transparent 1px)",
                  backgroundSize: `${24 * zoom}px ${24 * zoom}px`,
                  backgroundPosition: `${camera.x}px ${camera.y}px`,
                }}
                aria-hidden="true"
              />

              {/* Empty state */}
              {!world && !isLoading && (
                <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 16 }}>
                  <div style={{ width: 72, height: 72, borderRadius: "50%", background: "rgba(168,140,255,0.08)", display: "flex", alignItems: "center", justifyContent: "center" }}>
                    <svg width="28" height="28" viewBox="0 0 28 28" fill="none">
                      <circle cx="14" cy="14" r="4" fill="#A88CFF" />
                      <circle cx="14" cy="4" r="2.5" fill="#A88CFF" />
                      <circle cx="14" cy="24" r="2.5" fill="#A88CFF" />
                      <circle cx="4" cy="14" r="2.5" fill="#A88CFF" />
                      <circle cx="24" cy="14" r="2.5" fill="#A88CFF" />
                    </svg>
                  </div>
                  <div style={{ textAlign: "center" }}>
                    <div style={{ fontFamily: T.fontHeading, fontSize: 18, fontWeight: 600, color: T.textPrimary, marginBottom: 6 }}>No world loaded</div>
                    <div style={{ fontFamily: T.fontBody, fontSize: 13, color: T.textTertiary, maxWidth: 280, lineHeight: 1.5 }}>
                      Select a world from the dropdown above or create a new one.
                    </div>
                  </div>
                  <div style={{ display: "flex", gap: 10, marginTop: 8 }}>
                    <button type="button" style={{
                      padding: "8px 16px", borderRadius: 8, border: "none",
                      background: "#A88CFF", color: T.canvasBg,
                      fontFamily: T.fontHeading, fontSize: 13, fontWeight: 600, cursor: "pointer",
                    }}>
                      Generate with AI
                    </button>
                    <button type="button" style={{
                      padding: "8px 16px", borderRadius: 8,
                      border: `1px solid ${T.borderSubtle}`, background: "transparent",
                      color: T.textSecondary, fontFamily: T.fontHeading, fontSize: 13, cursor: "pointer",
                    }}>
                      Start from scratch
                    </button>
                  </div>
                </div>
              )}

              {/* Add Node button */}
              {world && (
                <div data-pan-ignore="true" style={{ position: "absolute", top: 16, right: 16, zIndex: 20 }}>
                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); setAddMenuOpen(!addMenuOpen); setContextMenu(null); }}
                    style={{
                      display: "flex", alignItems: "center", gap: 6, padding: "7px 14px", borderRadius: 8,
                      border: "none", background: addMenuOpen ? "#A88CFF" : "rgba(168,140,255,0.15)",
                      color: addMenuOpen ? T.canvasBg : "#A88CFF",
                      fontFamily: T.fontHeading, fontSize: 12, fontWeight: 600, cursor: "pointer",
                    }}
                  >
                    <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                      <line x1="7" y1="2" x2="7" y2="12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                      <line x1="2" y1="7" x2="12" y2="7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                    </svg>
                    Add Node
                  </button>

                  {/* Add Node Dropdown */}
                  {addMenuOpen && (
                    <div
                      onClick={(e) => e.stopPropagation()}
                      style={{
                        position: "absolute", top: 40, right: 0, width: 280,
                        background: "#1A1A24", border: `1px solid ${T.borderSubtle}`, borderRadius: 12,
                        padding: 6, boxShadow: "0 12px 40px rgba(0,0,0,0.5)", zIndex: 30,
                      }}
                    >
                      <div style={{ padding: "8px 10px 6px", fontFamily: T.fontMono, fontSize: 9, fontWeight: 700, color: T.textQuaternary, letterSpacing: "0.08em" }}>
                        NODE TYPES
                      </div>
                      {addableTypes.map((item) => {
                        const color = NODE_COLORS[item.type];
                        const canCreate = creatable.includes(item.type);
                        return (
                          <button
                            key={item.type}
                            type="button"
                            onClick={() => canCreate && addEntity(item.type)}
                            disabled={!canCreate}
                            style={{
                              display: "flex", alignItems: "center", gap: 10, padding: 10, borderRadius: 8,
                              width: "100%", border: "none", background: "transparent",
                              cursor: canCreate ? "pointer" : "default",
                              opacity: canCreate ? 1 : 0.5, textAlign: "left",
                            }}
                            onMouseEnter={(e) => { if (canCreate) e.currentTarget.style.background = "rgba(255,255,255,0.03)"; }}
                            onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
                          >
                            <div style={{
                              width: 32, height: 32, borderRadius: 8, flexShrink: 0,
                              background: `${color.dot}18`,
                              display: "flex", alignItems: "center", justifyContent: "center",
                            }}>
                              <div style={{ width: 10, height: 10, borderRadius: 3, background: color.dot }} />
                            </div>
                            <div>
                              <div style={{ fontFamily: T.fontHeading, fontSize: 13, fontWeight: 600, color: T.textPrimary }}>{item.label}</div>
                              <div style={{ fontFamily: T.fontBody, fontSize: 11, color: T.textSecondary }}>{item.description}</div>
                            </div>
                          </button>
                        );
                      })}

                      <div style={{ height: 1, background: T.borderSubtle, margin: "4px 10px" }} />

                      <button type="button" style={{
                        display: "flex", alignItems: "center", gap: 10, padding: 10, borderRadius: 8,
                        width: "100%", border: "none", background: "transparent", cursor: "pointer", textAlign: "left",
                      }}>
                        <div style={{
                          width: 32, height: 32, borderRadius: 8, flexShrink: 0,
                          background: "rgba(168,140,255,0.1)",
                          display: "flex", alignItems: "center", justifyContent: "center",
                        }}>
                          <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                            <circle cx="7" cy="7" r="2" fill="#A88CFF" />
                            <circle cx="7" cy="2" r="1.2" fill="#A88CFF" />
                            <circle cx="7" cy="12" r="1.2" fill="#A88CFF" />
                            <circle cx="2" cy="7" r="1.2" fill="#A88CFF" />
                            <circle cx="12" cy="7" r="1.2" fill="#A88CFF" />
                          </svg>
                        </div>
                        <div>
                          <div style={{ fontFamily: T.fontHeading, fontSize: 13, fontWeight: 600, color: "#A88CFF" }}>Generate with AI</div>
                          <div style={{ fontFamily: T.fontBody, fontSize: 11, color: T.textQuaternary }}>Auto-create nodes from a description</div>
                        </div>
                      </button>
                    </div>
                  )}
                </div>
              )}

              {/* World layer (nodes + edges) */}
              {world && (
                <div style={{
                  position: "absolute", left: 0, top: 0,
                  width: worldSize.width, height: worldSize.height,
                  transform: `translate(${camera.x}px, ${camera.y}px) scale(${zoom})`,
                  transformOrigin: "0 0",
                }}>
                  {/* Edges */}
                  <svg
                    width={worldSize.width} height={worldSize.height}
                    style={{ position: "absolute", left: 0, top: 0, pointerEvents: "none" }}
                    viewBox={`0 0 ${worldSize.width} ${worldSize.height}`}
                    fill="none" aria-hidden="true"
                  >
                    <defs>
                      <marker id="canvas-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse">
                        <path d="M 0 0 L 10 5 L 0 10 z" fill="rgba(255,255,255,0.15)" />
                      </marker>
                    </defs>
                    {edges.map((edge) => {
                      const from = nodeLookup[edge.from];
                      const to = nodeLookup[edge.to];
                      if (!from || !to) return null;
                      const { start, end } = getEdgeAnchors(from, to);
                      const midX = (start.x + end.x) / 2;
                      return (
                        <path
                          key={edge.id}
                          d={`M ${start.x} ${start.y} C ${midX} ${start.y}, ${midX} ${end.y}, ${end.x} ${end.y}`}
                          stroke="rgba(255,255,255,0.08)" strokeWidth={1.5} fill="none"
                          markerEnd="url(#canvas-arrow)"
                        />
                      );
                    })}
                  </svg>

                  {/* Nodes */}
                  {nodes.map((node) => {
                    const color = NODE_COLORS[node.entityType];
                    const isSelected = selectedNodeId === node.id;
                    const nodeErrors = errorsForNode(node.id);
                    const hasErrors = nodeErrors.length > 0;

                    return (
                      <article
                        key={node.id}
                        style={{
                          position: "absolute", left: node.x, top: node.y, width: node.w,
                          padding: node.collapsed ? "8px 12px" : 14,
                          borderRadius: 10,
                          border: isSelected
                            ? `2px solid ${color.dot}`
                            : hasErrors
                            ? "2px solid #EF5B5B"
                            : `1px solid ${T.borderSubtle}`,
                          background: T.nodeBg,
                          boxShadow: isSelected
                            ? `0 0 20px ${color.glow}`
                            : "0 4px 16px rgba(0,0,0,0.3)",
                          cursor: dragState?.type === "node" && dragState.nodeId === node.id ? "grabbing" : "grab",
                          userSelect: "none",
                          transition: "box-shadow 150ms, border-color 150ms",
                        }}
                        onPointerDown={(e) => startNodeDrag(e, node.id)}
                        onContextMenu={(e) => handleContextMenu(e, node.id)}
                      >
                        {/* Header */}
                        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                          <span style={{ width: 8, height: 8, borderRadius: "50%", background: color.dot, flexShrink: 0 }} />
                          <span style={{ fontFamily: T.fontMono, fontSize: 9, fontWeight: 700, color: color.dot, letterSpacing: "0.08em" }}>
                            {ENTITY_LABELS[node.entityType]}
                          </span>

                          {/* v2 badge for world core */}
                          {node.entityType === "world" && world?.metrics && (
                            <span style={{ marginLeft: "auto", padding: "1px 5px", borderRadius: 3, background: "rgba(168,140,255,0.2)", fontFamily: T.fontMono, fontSize: 8, fontWeight: 700, color: "#A88CFF" }}>
                              v2
                            </span>
                          )}

                          {/* Category badge for events */}
                          {node.entityType === "event" && (() => {
                            const ev = world?.eventTemplates.find((e) => e.id === node.entityId);
                            return ev ? (
                              <span style={{ marginLeft: "auto", padding: "2px 6px", borderRadius: 4, background: `${color.dot}22`, fontFamily: T.fontMono, fontSize: 8, color: color.dot }}>
                                {ev.category}
                              </span>
                            ) : null;
                          })()}

                          {/* Error count */}
                          {hasErrors && (
                            <span style={{ marginLeft: "auto", width: 16, height: 16, borderRadius: "50%", background: "#EF5B5B", color: "#fff", fontSize: 9, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                              {nodeErrors.length}
                            </span>
                          )}

                          {/* Collapse */}
                          <button
                            type="button"
                            onClick={(e) => { e.stopPropagation(); toggleCollapse(node.id); }}
                            style={{ border: "none", background: "transparent", color: T.textTertiary, cursor: "pointer", fontSize: 11, padding: 0, lineHeight: 1 }}
                          >
                            {node.collapsed ? "▸" : "▾"}
                          </button>
                        </div>

                        {/* Title */}
                        <div style={{
                          fontFamily: T.fontHeading, fontSize: 14, fontWeight: 600, color: T.textPrimary,
                          marginTop: node.collapsed ? 0 : 6,
                          overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                        }}>
                          {node.label}
                        </div>

                        {/* Errors */}
                        {!node.collapsed && hasErrors && (
                          <div style={{ marginTop: 4 }}>
                            {nodeErrors.slice(0, 2).map((err, i) => (
                              <p key={i} style={{ fontSize: 10, color: "#EF5B5B", lineHeight: 1.4, fontFamily: T.fontBody, margin: 0 }}>
                                {err.message}
                              </p>
                            ))}
                          </div>
                        )}

                        {/* Rich content */}
                        {!node.collapsed && !hasErrors && renderNodeContent(node)}
                      </article>
                    );
                  })}
                </div>
              )}

              {/* Context Menu */}
              {contextMenu && (
                <div
                  data-pan-ignore="true"
                  onClick={(e) => e.stopPropagation()}
                  style={{
                    position: "absolute", left: contextMenu.x, top: contextMenu.y, zIndex: 40,
                    width: 200, background: "#1A1A24", border: `1px solid ${T.borderSubtle}`,
                    borderRadius: 10, padding: 4, boxShadow: "0 8px 32px rgba(0,0,0,0.6)",
                  }}
                >
                  {[
                    { label: "Edit Node", action: () => { setSelectedNodeId(contextMenu.nodeId); setContextMenu(null); } },
                    { label: "Duplicate", shortcut: "⌘D", action: () => setContextMenu(null) },
                    { label: "Connect to…", action: () => setContextMenu(null) },
                    { type: "separator" as const },
                    { label: "Move to Group", suffix: "▸", action: () => setContextMenu(null) },
                    { label: "Assign to Event", suffix: "▸", action: () => setContextMenu(null) },
                    { type: "separator" as const },
                    { label: "AI Refine", color: "#8DF0C8", action: () => setContextMenu(null) },
                    { label: "Validate", action: () => setContextMenu(null) },
                    { type: "separator" as const },
                    {
                      label: "Delete Node", shortcut: "⌫", color: "#EF5B5B",
                      action: () => {
                        const node = nodeLookup[contextMenu.nodeId];
                        if (node) deleteEntity(node.entityType, node.entityId);
                        setContextMenu(null);
                      },
                    },
                  ].map((item, i) => {
                    if ("type" in item && item.type === "separator") {
                      return <div key={i} style={{ height: 1, background: T.borderSubtle, margin: "3px 8px" }} />;
                    }
                    const menuItem = item as { label: string; shortcut?: string; suffix?: string; color?: string; action: () => void };
                    return (
                      <button
                        key={i}
                        type="button"
                        onClick={menuItem.action}
                        style={{
                          display: "flex", alignItems: "center", justifyContent: "space-between",
                          width: "100%", padding: "7px 10px", borderRadius: 6,
                          border: "none", background: "transparent",
                          fontFamily: T.fontBody, fontSize: 13, color: menuItem.color ?? T.textPrimary,
                          cursor: "pointer", textAlign: "left",
                        }}
                        onMouseEnter={(e) => { e.currentTarget.style.background = "rgba(255,255,255,0.05)"; }}
                        onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
                      >
                        <span>{menuItem.label}</span>
                        {menuItem.shortcut && <span style={{ fontSize: 11, color: T.textTertiary }}>{menuItem.shortcut}</span>}
                        {menuItem.suffix && <span style={{ fontSize: 11, color: T.textTertiary }}>{menuItem.suffix}</span>}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>

            {/* ── Legend Bar ──────────────────────────────────── */}
            <div style={{
              display: "flex", alignItems: "center", justifyContent: "space-between",
              height: 36, padding: "0 16px", flexShrink: 0,
              background: T.chrome, borderTop: `1px solid ${T.borderSubtle}`,
              fontFamily: T.fontMono, fontSize: 9, color: T.textTertiary, letterSpacing: "0.06em",
            }}>
              <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
                {legendItems.map((item) => (
                  <div key={item.type} style={{ display: "flex", alignItems: "center", gap: 5 }}>
                    <div style={{ width: 7, height: 7, borderRadius: 2, background: NODE_COLORS[item.type].dot }} />
                    <span>{item.label}</span>
                  </div>
                ))}
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                <span>{nodes.length} nodes</span>
                <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                  <button type="button" onClick={() => setZoom((z) => clamp(z * 0.9, 0.25, 2.0))}
                    style={{ border: `1px solid ${T.borderSubtle}`, background: "transparent", color: T.textSecondary, borderRadius: 3, padding: "1px 6px", cursor: "pointer", fontSize: 11 }}>
                    −
                  </button>
                  <span style={{ minWidth: 36, textAlign: "center" }}>{Math.round(zoom * 100)}%</span>
                  <button type="button" onClick={() => setZoom((z) => clamp(z * 1.12, 0.25, 2.0))}
                    style={{ border: `1px solid ${T.borderSubtle}`, background: "transparent", color: T.textSecondary, borderRadius: 3, padding: "1px 6px", cursor: "pointer", fontSize: 11 }}>
                    +
                  </button>
                </div>
              </div>
            </div>
          </div>

          {/* ── Detail Panel ─────────────────────────────────── */}
          {selectedNode && world && (
            <div style={{
              width: 360, flexShrink: 0, background: T.chrome,
              borderLeft: `1px solid ${T.borderSubtle}`, overflow: "auto",
            }}>
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
            </div>
          )}
        </div>
      </div>
    </>
  );
}
