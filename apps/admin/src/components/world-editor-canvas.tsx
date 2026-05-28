"use client";

import {
  type PointerEvent,
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
import { CharacterPicker } from "./character-picker";
import { CharacterInspector } from "./character-inspector";
import { listCharacterKnowsEdges } from "@/app/(authenticated)/worlds/[worldId]/editor/actions";
import type { EntityType, EditorNode } from "./world-editor";

/* ── Design Tokens (matching Paper designs) ────────────────── */

const T = {
  canvasBg: "var(--canvas-atmosphere, var(--background))",
  chrome: "color-mix(in srgb, var(--background) 84%, transparent)",
  nodeBg: "var(--material-card, var(--material-card))",
  borderSubtle: "var(--border-subtle)",
  borderInput: "var(--control-border)",
  textPrimary: "var(--text-primary)",
  textSecondary: "var(--text-secondary)",
  textTertiary: "var(--text-tertiary)",
  textQuaternary: "var(--text-quaternary)",
  fontHeading: "'Space Grotesk', sans-serif",
  fontBody: "'Inter', sans-serif",
  fontMono: "'JetBrains Mono', monospace",
} as const;

const NODE_COLORS: Record<EntityType, { dot: string; glow: string }> = {
  world:        { dot: "var(--warning-amber)", glow: "color-mix(in srgb, var(--warning-amber) 22%, transparent)" },
  role:         { dot: "var(--warning-amber)", glow: "color-mix(in srgb, var(--warning-amber) 22%, transparent)" },
  character:    { dot: "var(--critical-crimson)", glow: "color-mix(in srgb, var(--critical-crimson) 20%, transparent)" },
  group:        { dot: "var(--signal-blue)", glow: "color-mix(in srgb, var(--signal-blue) 22%, transparent)" },
  event:        { dot: "var(--warning-amber)", glow: "color-mix(in srgb, var(--warning-amber) 20%, transparent)" },
  state:        { dot: "var(--emissive-mint)", glow: "color-mix(in srgb, var(--emissive-mint) 20%, transparent)" },
  relationship: { dot: "var(--event-violet)", glow: "color-mix(in srgb, var(--event-violet) 22%, transparent)" },
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
  kind?: "knows" | "structural";
  attitude?: string;
};

const ATTITUDE_COLORS: Record<string, string> = {
  loving:     "#E879A0",
  loyal:      "#8FD1CB",
  protective: "#8B5CF6",
  grieving:   "#8A8FA3",
  resentful:  "#E36D76",
  wary:       "#E8B76A",
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
      x: 500, y: 80 + i * (90 + gap), w: 220, h: 76, collapsed: false,
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

/* Edges connect to the midpoint of whichever side faces the peer node.
 * `node.h` is a seed value from buildNodesFromWorld; real articles flow
 * to content and rarely match it. Callers pass in a measured height per
 * endpoint (from the ResizeObserver below) so top/bottom anchors land
 * flush with the visible edge of the card, not 10-20px off. */
function getEdgeAnchors(from: EditorNode, to: EditorNode, fromH: number, toH: number) {
  const fc = { x: from.x + from.w / 2, y: from.y + fromH / 2 };
  const tc = { x: to.x + to.w / 2, y: to.y + toH / 2 };
  const dx = tc.x - fc.x;
  const dy = tc.y - fc.y;
  if (Math.abs(dx) >= Math.abs(dy)) {
    return {
      start: { x: dx >= 0 ? from.x + from.w : from.x, y: fc.y },
      end: { x: dx >= 0 ? to.x : to.x + to.w, y: tc.y },
    };
  }
  return {
    start: { x: fc.x, y: dy >= 0 ? from.y + fromH : from.y },
    end: { x: tc.x, y: dy >= 0 ? to.y : to.y + toH },
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
    <div style={{ display: "flex", alignItems: "center", gap: "var(--space-6)", width: "100%" }}>
      <div style={{ flex: 1, height: 3, borderRadius: "var(--radius-2xs)", background: "var(--surface-hover)" }}>
        <div style={{ width: `${(value / max) * 100}%`, height: "100%", borderRadius: "var(--radius-2xs)", background: color }} />
      </div>
      <span style={{ fontSize: "var(--font-size-xs)", color: T.textSecondary, fontFamily: T.fontMono, minWidth: 18, textAlign: "right" }}>
        {value}
      </span>
    </div>
  );
}

function Badge({ text, color }: { text: string; color?: string }) {
  return (
    <span style={{
      display: "inline-block", padding: "1px 6px", borderRadius: "var(--radius-xs)",
      fontSize: "var(--font-size-3xs)", fontWeight: 600, fontFamily: T.fontMono,
      background: color ? `${color}22` : "var(--surface-hover)",
      color: color ?? T.textSecondary, letterSpacing: "0.04em",
    }}>
      {text}
    </span>
  );
}

/* ── Node content renderers ──────────────────────────────── */

function WorldCoreContent({ world }: { world: WorldDefinition }) {
  return (
    <div style={{ marginTop: "var(--space-6)" }}>
      <div style={{ fontSize: "var(--font-size-xs)", color: T.textTertiary, lineHeight: 1.4, marginBottom: "var(--space-6)", fontFamily: T.fontBody }}>
        {world.setting.length > 60 ? world.setting.slice(0, 58) + "…" : world.setting}
      </div>
      {world.metrics && (
        <Badge text="v2" color="#8B5CF6" />
      )}
    </div>
  );
}

/**
 * CharacterChipNode — compact, read-at-a-glance chip matching Paper 10IE-0.
 * Avatar (initial on pink gradient) + link dot, name row with kind dot, role
 * caption (archetype, uppercase), and a slug reference line that appears only
 * when selected.
 */
function CharacterChipNode({
  node, char, isSelected, hasErrors, errorMessage, isDragging, onPointerDown, onContextMenu, setNodeEl,
}: {
  node: EditorNode;
  char: CharacterDefinition;
  isSelected: boolean;
  hasErrors: boolean;
  errorMessage?: string;
  isDragging: boolean;
  onPointerDown: (e: PointerEvent<HTMLElement>) => void;
  onContextMenu: (e: MouseEvent<HTMLElement>) => void;
  setNodeEl?: (el: HTMLElement | null) => void;
}) {
  const initial = (char.name || char.id || "?").trim().charAt(0).toUpperCase() || "?";
  const roleCaption = char.archetype && char.archetype !== "unspecified" ? char.archetype : char.title || "";
  const slug = char.id;
  const [hover, setHover] = useState(false);

  // border + shadow per Paper states (Default / Hover / Selected / Error)
  const border = hasErrors
    ? "1.5px solid var(--status-error)"
    : isSelected
    ? "1.5px solid var(--critical-crimson)"
    : hover
    ? "1px solid var(--border-active)"
    : "1px solid var(--border-subtle)";
  const background = hover && !isSelected ? "var(--surface-hover)" : "var(--material-card)";
  const boxShadow = hasErrors
    ? "0 0 0 4px var(--critical-fill), var(--elevation-card)"
    : isSelected
    ? "0 0 0 4px color-mix(in srgb, var(--critical-crimson) 12%, transparent), 0 0 26px color-mix(in srgb, var(--critical-crimson) 22%, transparent), var(--elevation-card)"
    : hover
    ? "var(--elevation-card)"
    : "var(--elevation-surface)";

  return (
    <article
      ref={setNodeEl}
      data-node-id={node.id}
      style={{
        position: "absolute", left: node.x, top: node.y, width: node.w,
        display: "flex", alignItems: "stretch", gap: "var(--space-10)",
        padding: "10px 14px 10px 10px",
        borderRadius: "var(--radius-card, 18px)",
        border,
        background,
        boxShadow,
        cursor: isDragging ? "grabbing" : "grab",
        userSelect: "none",
        boxSizing: "border-box",
        transition: "box-shadow 150ms, border-color 150ms, background 150ms",
      }}
      onPointerDown={onPointerDown}
      onContextMenu={onContextMenu}
      onPointerEnter={() => setHover(true)}
      onPointerLeave={() => setHover(false)}
    >
      {/* Avatar slot */}
      <div style={{ position: "relative", width: 40, height: 40, flexShrink: 0 }}>
        <div style={{
          width: 40, height: 40, borderRadius: "var(--radius-lg)",
          display: "flex", alignItems: "center", justifyContent: "center",
          backgroundImage:
            "linear-gradient(in oklab 135deg, oklab(78.1% 0.089 0.0005) 0%, oklab(56.5% 0.095 -0.0008) 100%)",
        }}>
          <span style={{
            fontFamily: T.fontHeading, fontSize: 17, fontWeight: 500,
            color: "#2A0E18", lineHeight: "22px", letterSpacing: "-0.01em",
          }}>
            {initial}
          </span>
        </div>
        {/* Link dot — mint when linked to library, amber if errors, hidden otherwise */}
        <div
          title={hasErrors ? (errorMessage || "Error") : "Linked to global character library"}
          style={{
            position: "absolute", right: -3, bottom: -3,
            width: 11, height: 11, borderRadius: "var(--radius-pill)",
            background: hasErrors ? "#E8B76A" : "#8FD1CB",
            border: "2px solid #13161D",
            boxSizing: "border-box",
          }}
        />
      </div>

      {/* Content column */}
      <div style={{
        display: "flex", flexDirection: "column", gap: "var(--space-2)", paddingTop: "var(--space-2)",
        minWidth: 0, flex: 1,
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: "var(--space-6)" }}>
          <span style={{
            width: 5, height: 5, borderRadius: "var(--radius-pill)",
            background: "#E8A0B5", flexShrink: 0,
          }} />
          <span style={{
            fontFamily: T.fontBody, fontSize: "var(--font-size-md)", fontWeight: 500,
            color: "#E7EAF0", lineHeight: "16px", letterSpacing: "-0.005em",
            overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
          }}>
            {char.name}
          </span>
        </div>
        {roleCaption && (
          <div style={{
            fontFamily: T.fontBody, fontSize: "var(--font-size-2xs)", fontWeight: 500,
            color: "#7C8494", lineHeight: "12px",
            letterSpacing: "0.14em", textTransform: "uppercase",
            overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
          }}>
            {roleCaption}
          </div>
        )}
        {isSelected && (
          <div style={{
            marginTop: "var(--space-2)",
            fontFamily: "'DM Mono', 'JetBrains Mono', monospace",
            fontSize: "var(--font-size-2xs)", color: "#5B6272", lineHeight: "12px",
            overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
          }}>
            → characters.{slug}
          </div>
        )}
      </div>
    </article>
  );
}

function GroupContent({ group, world }: { group: GroupDefinition; world: WorldDefinition }) {
  return (
    <div style={{ marginTop: "var(--space-6)" }}>
      <div style={{ display: "flex", gap: "var(--space-24)", marginBottom: "var(--space-4)" }}>
        <div>
          <div style={{ fontSize: "var(--font-size-3xs)", color: T.textQuaternary, fontFamily: T.fontMono, letterSpacing: "0.06em", textTransform: "uppercase" }}>INFLUENCE</div>
          <div style={{ fontSize: "var(--font-size-lg)", fontWeight: 600, color: NODE_COLORS.group.dot, fontFamily: T.fontHeading }}>{group.influence}</div>
        </div>
        <div>
          <div style={{ fontSize: "var(--font-size-3xs)", color: T.textQuaternary, fontFamily: T.fontMono, letterSpacing: "0.06em", textTransform: "uppercase" }}>DISPOSITION</div>
          <div style={{ fontSize: "var(--font-size-md)", fontWeight: 500, color: T.textSecondary, fontFamily: T.fontHeading }}>{group.disposition}</div>
        </div>
      </div>
    </div>
  );
}

function RoleContent({ role }: { role: RoleDefinition }) {
  return (
    <div style={{ marginTop: "var(--space-4)", fontFamily: T.fontBody }}>
      <div style={{ fontSize: "var(--font-size-sm)", color: T.textSecondary, marginBottom: "var(--space-4)" }}>
        {role.summary.length > 50 ? role.summary.slice(0, 48) + "…" : role.summary}
      </div>
    </div>
  );
}

function EventContent({ event, world }: { event: EventTemplate; world: WorldDefinition }) {
  return (
    <div style={{ marginTop: "var(--space-4)" }}>
      <div style={{ fontSize: "var(--font-size-sm)", color: T.textSecondary, fontFamily: T.fontBody, marginBottom: "var(--space-6)" }}>
        {event.summary.slice(0, 60)}…
      </div>
      {event.turnRange && (
        <div style={{ fontSize: "var(--font-size-2xs)", color: T.textTertiary, fontFamily: T.fontMono, marginBottom: "var(--space-4)" }}>
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
  const colors = [
    "var(--emissive-mint)",
    "var(--signal-blue)",
    "var(--status-draft)",
    "var(--warning-amber)",
    "var(--critical-crimson)",
    "var(--event-violet)",
  ];
  return (
    <div style={{ marginTop: "var(--space-6)", display: "flex", flexDirection: "column", gap: "var(--space-4)" }}>
      {metrics.map((m, i) => (
        <div key={m.id} style={{ display: "flex", alignItems: "center", gap: "var(--space-6)" }}>
          <span style={{ fontSize: "var(--font-size-2xs)", color: T.textTertiary, width: 52, fontFamily: T.fontMono }}>{m.label}</span>
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
  { type: "group", label: "Group", description: "Faction with influence, goals, and dynamics" },
  { type: "event", label: "Event", description: "Scenario with stakes, actors, and triggers" },
  { type: "state", label: "Initial State", description: "Starting metrics, relationships, and flags" },
];

const creatable: EntityType[] = ["group", "role", "event", "relationship"];

/* ── Component ───────────────────────────────────────────── */

type Props = {
  worlds?: { id: string; title: string }[];
  fixedWorldId?: string;
};

export function WorldEditorCanvas({ worlds, fixedWorldId }: Props) {
  const viewportRef = useRef<HTMLDivElement | null>(null);

  const [worldId, setWorldId] = useState(fixedWorldId ?? worlds?.[0]?.id ?? "");
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
  const [pickerOpen, setPickerOpen] = useState(false);
  const [contextMenu, setContextMenu] = useState<ContextMenuState>(null);

  /* Measured rendered heights per node. node.h is a seed from
   * buildNodesFromWorld and rarely matches the laid-out size (articles
   * are auto-height). A ResizeObserver updates this map so edges anchor
   * to the actual visible top/bottom of each card. */
  const [measuredHeights, setMeasuredHeights] = useState<Record<string, number>>({});
  const nodeElsRef = useRef<Map<string, HTMLElement>>(new Map());
  const sizeObserverRef = useRef<ResizeObserver | null>(null);

  useEffect(() => {
    const observer = new ResizeObserver((entries) => {
      setMeasuredHeights((prev) => {
        let next: Record<string, number> | null = null;
        for (const entry of entries) {
          const el = entry.target as HTMLElement;
          const id = el.dataset.nodeId;
          if (!id) continue;
          const h = el.offsetHeight;
          if (h > 0 && prev[id] !== h) {
            if (!next) next = { ...prev };
            next[id] = h;
          }
        }
        return next ?? prev;
      });
    });
    sizeObserverRef.current = observer;
    // Catch any refs that attached before this effect ran.
    nodeElsRef.current.forEach((el) => observer.observe(el));
    return () => {
      observer.disconnect();
      sizeObserverRef.current = null;
    };
  }, []);

  const setNodeEl = useCallback((id: string, el: HTMLElement | null) => {
    const map = nodeElsRef.current;
    const prev = map.get(id);
    const obs = sizeObserverRef.current;
    if (prev && prev !== el) {
      obs?.unobserve(prev);
      map.delete(id);
    }
    if (el) {
      map.set(id, el);
      obs?.observe(el);
      // Prime the map so the first edge render doesn't fall back to node.h.
      const h = el.offsetHeight;
      if (h > 0) {
        setMeasuredHeights((m) => (m[id] === h ? m : { ...m, [id]: h }));
      }
    }
  }, []);

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
      const [response, knowsRes] = await Promise.all([
        fetch(`/api/worlds/${id}`, { cache: "no-store" }),
        listCharacterKnowsEdges(id),
      ]);
      if (!response.ok) { setSaveError("Failed to load world."); return; }
      const payload = (await response.json()) as { world: WorldDefinition };
      const w = payload.world;
      setWorld(w);
      const builtNodes = buildNodesFromWorld(w);
      setNodes(builtNodes);
      const structural = buildEdgesFromWorld(w, builtNodes);
      const knows: EditorEdge[] =
        knowsRes.ok && knowsRes.data
          ? knowsRes.data.edges.flatMap<EditorEdge>((e) => {
              const fromNode = builtNodes.find(
                (n) => n.entityType === "character" && n.entityId === e.fromSlug,
              );
              const toNode = builtNodes.find(
                (n) => n.entityType === "character" && n.entityId === e.toSlug,
              );
              if (!fromNode || !toNode) return [];
              return [{
                id: `knows-${e.id}`,
                from: fromNode.id,
                to: toNode.id,
                kind: "knows",
                attitude: e.attitude,
                label: e.attitude,
              }];
            })
          : [];
      setEdges([...structural, ...knows]);
      setValidationErrors(validateWorld(w));
    });
  }

  useEffect(() => {
    if (worldId) loadWorld(worldId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ⌘K / Ctrl+K opens the character picker from anywhere in the editor.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        if (world) {
          setPickerOpen(true);
          setAddMenuOpen(false);
        }
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [world]);

  function handleCharacterLinked() {
    setPickerOpen(false);
    if (worldId) loadWorld(worldId);
  }

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

  /* Zoom is anchored to a client point (cursor for wheel, viewport center for
   * buttons). We avoid calling setCamera inside setZoom's updater — that
   * violates the "updater must be pure" rule and fires twice in StrictMode,
   * doubling the camera shift. Refs mirror the latest values so chained
   * events (fast scroll wheels) compose correctly without waiting for
   * React to commit the previous update. */
  const zoomRef = useRef(zoom);
  zoomRef.current = zoom;
  const cameraRef = useRef(camera);
  cameraRef.current = camera;

  const zoomAt = useCallback((clientX: number, clientY: number, factor: number) => {
    const rect = viewportRef.current?.getBoundingClientRect();
    if (!rect) return;
    const px = clientX - rect.left;
    const py = clientY - rect.top;
    const pz = zoomRef.current;
    const nz = clamp(pz * factor, 0.25, 2.0);
    if (nz === pz) return;
    const pc = cameraRef.current;
    const nc = {
      x: px - ((px - pc.x) / pz) * nz,
      y: py - ((py - pc.y) / pz) * nz,
    };
    zoomRef.current = nz;
    cameraRef.current = nc;
    setZoom(nz);
    setCamera(nc);
  }, []);

  /* React's onWheel is passive, so preventDefault is a no-op there and the
   * page scrolls behind the canvas. Attach a native listener with
   * passive:false so wheel-to-zoom doesn't leak to the document. */
  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return;
    function onWheelNative(e: WheelEvent) {
      e.preventDefault();
      const factor = e.deltaY < 0 ? 1.1 : 1 / 1.1;
      zoomAt(e.clientX, e.clientY, factor);
    }
    el.addEventListener("wheel", onWheelNative, { passive: false });
    return () => el.removeEventListener("wheel", onWheelNative);
  }, [zoomAt]);

  function zoomViewportCenter(factor: number) {
    const rect = viewportRef.current?.getBoundingClientRect();
    if (!rect) return;
    zoomAt(rect.left + rect.width / 2, rect.top + rect.height / 2, factor);
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
      case "character": return null; // rendered by CharacterChipNode
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
      <div style={{
        display: "flex", flexDirection: "column",
        height: "calc(100% + 4rem)", margin: "-2rem",
        overflow: "hidden", background: T.canvasBg, color: T.textPrimary,
      }}>

        {/* ── Top Bar ──────────────────────────────────────── */}
        <div
          data-pan-ignore="true"
          style={{
            display: "flex", alignItems: "center", justifyContent: "space-between",
            height: 48, padding: "0 16px", flexShrink: 0,
            background: T.chrome,
            borderBottom: `1px solid ${T.borderSubtle}`,
            backdropFilter: "blur(18px)",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: "var(--space-12)" }}>
            {!fixedWorldId && (
              <>
                <span style={{ fontFamily: T.fontHeading, fontSize: "var(--font-size-md)", fontWeight: 500, color: T.textSecondary }}>World Editor</span>
                <div style={{ width: 1, height: 18, background: T.borderSubtle }} />

                <select
                  value={worldId}
                  onChange={(e) => loadWorld(e.target.value)}
                  disabled={isLoading}
                  style={{
                    background: "transparent", border: "none", outline: "none", cursor: "pointer",
                    fontFamily: T.fontHeading, fontSize: "var(--font-size-lg)", fontWeight: 600, color: T.textPrimary,
                  }}
                >
                  {(worlds ?? []).map((w) => (
                    <option key={w.id} value={w.id} style={{ background: T.chrome, color: T.textPrimary }}>
                      {w.title}
                    </option>
                  ))}
                </select>
              </>
            )}

            {/* Status badges */}
            {saveStatus === "saved" && (
              <span style={{ padding: "2px 8px", borderRadius: "var(--radius-xs)", background: "color-mix(in srgb, var(--status-live) 18%, transparent)", fontFamily: T.fontMono, fontSize: "var(--font-size-2xs)", fontWeight: 700, color: "var(--status-live)", letterSpacing: "0.06em" }}>
                SAVED
              </span>
            )}
            {dirty && !saveStatus && (
              <span style={{ padding: "2px 8px", borderRadius: "var(--radius-xs)", background: "color-mix(in srgb, var(--status-draft) 18%, transparent)", fontFamily: T.fontMono, fontSize: "var(--font-size-2xs)", fontWeight: 700, color: "var(--status-draft)", letterSpacing: "0.06em" }}>
                UNSAVED
              </span>
            )}
            {validationErrors.length > 0 && (
              <span style={{ padding: "2px 8px", borderRadius: "var(--radius-xs)", background: "color-mix(in srgb, var(--status-error) 18%, transparent)", fontFamily: T.fontMono, fontSize: "var(--font-size-2xs)", fontWeight: 700, color: "var(--status-error)", letterSpacing: "0.06em" }}>
                {validationErrors.length} ISSUE{validationErrors.length > 1 ? "S" : ""}
              </span>
            )}
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: "var(--space-8)" }}>
            {saveError && <span style={{ fontSize: "var(--font-size-sm)", color: "var(--status-error)", fontFamily: T.fontBody, marginRight: "var(--space-8)" }}>{saveError}</span>}
            <button type="button" onClick={() => { setZoom(0.75); setCamera({ x: 0, y: 0 }); }}
              style={{
                padding: "6px 12px", borderRadius: "var(--radius-sm)", border: `1px solid ${T.borderSubtle}`, background: "transparent",
                fontFamily: T.fontHeading, fontSize: "var(--font-size-base)", color: T.textSecondary, cursor: "pointer",
              }}>
              Fit View
            </button>
            <button type="button"
              style={{
                padding: "6px 12px", borderRadius: "var(--radius-sm)", border: `1px solid ${T.borderSubtle}`, background: "transparent",
                fontFamily: T.fontHeading, fontSize: "var(--font-size-base)", color: T.textSecondary, cursor: "pointer",
              }}>
              Auto Layout
            </button>
            <button type="button"
              style={{
                padding: "6px 12px", borderRadius: "var(--radius-sm)", border: `1px solid ${T.borderSubtle}`, background: "transparent",
                fontFamily: T.fontHeading, fontSize: "var(--font-size-base)", color: T.textSecondary, cursor: "pointer",
              }}>
              Preview
            </button>
            <button type="button" onClick={saveWorld} disabled={!dirty || isSaving}
              style={{
                padding: "6px 14px", borderRadius: "var(--radius-sm)", border: "none",
                background: dirty ? "var(--accent-strong)" : T.borderSubtle,
                fontFamily: T.fontHeading, fontSize: "var(--font-size-base)", fontWeight: 600,
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
              onContextMenu={(e) => { e.preventDefault(); }}
            >
              {/* Loading overlay */}
              {isLoading && (
                <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", background: "var(--modal-backdrop)", zIndex: 50 }}>
                  <span style={{ fontSize: "var(--font-size-md)", color: T.textSecondary, fontFamily: T.fontHeading }}>Loading world…</span>
                </div>
              )}

              {/* Dot grid */}
              <div
                style={{
                  position: "absolute", inset: 0,
                  backgroundImage: "radial-gradient(circle, var(--grid-color) 1px, transparent 1px)",
                  backgroundSize: `${24 * zoom}px ${24 * zoom}px`,
                  backgroundPosition: `${camera.x}px ${camera.y}px`,
                }}
                aria-hidden="true"
              />

              {/* Empty state */}
              {!world && !isLoading && (
                <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: "var(--space-16)" }}>
                  <div style={{ width: 72, height: 72, borderRadius: "50%", background: "rgba(168,140,255,0.08)", display: "flex", alignItems: "center", justifyContent: "center" }}>
                    <svg width="28" height="28" viewBox="0 0 28 28" fill="none">
                      <circle cx="14" cy="14" r="4" fill="#8B5CF6" />
                      <circle cx="14" cy="4" r="2.5" fill="#8B5CF6" />
                      <circle cx="14" cy="24" r="2.5" fill="#8B5CF6" />
                      <circle cx="4" cy="14" r="2.5" fill="#8B5CF6" />
                      <circle cx="24" cy="14" r="2.5" fill="#8B5CF6" />
                    </svg>
                  </div>
                  <div style={{ textAlign: "center" }}>
                    <div style={{ fontFamily: T.fontHeading, fontSize: "var(--font-size-2xl)", fontWeight: 600, color: T.textPrimary, marginBottom: "var(--space-6)" }}>No world loaded</div>
                    <div style={{ fontFamily: T.fontBody, fontSize: "var(--font-size-md)", color: T.textTertiary, maxWidth: 280, lineHeight: 1.5 }}>
                      Select a world from the dropdown above or create a new one.
                    </div>
                  </div>
                  <div style={{ display: "flex", gap: "var(--space-10)", marginTop: "var(--space-8)" }}>
                    <button type="button" style={{
                      padding: "8px 16px", borderRadius: "var(--radius-md)", border: "none",
                      background: "#8B5CF6", color: T.canvasBg,
                      fontFamily: T.fontHeading, fontSize: "var(--font-size-md)", fontWeight: 600, cursor: "pointer",
                    }}>
                      Generate with AI
                    </button>
                    <button type="button" style={{
                      padding: "8px 16px", borderRadius: "var(--radius-md)",
                      border: `1px solid ${T.borderSubtle}`, background: "transparent",
                      color: T.textSecondary, fontFamily: T.fontHeading, fontSize: "var(--font-size-md)", cursor: "pointer",
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
                      display: "flex", alignItems: "center", gap: "var(--space-6)", padding: "7px 14px", borderRadius: "var(--radius-md)",
                      border: "none", background: addMenuOpen ? "#8B5CF6" : "rgba(168,140,255,0.15)",
                      color: addMenuOpen ? T.canvasBg : "#8B5CF6",
                      fontFamily: T.fontHeading, fontSize: "var(--font-size-base)", fontWeight: 600, cursor: "pointer",
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
                        background: "#1A1A24", border: `1px solid ${T.borderSubtle}`, borderRadius: "var(--radius-xl)",
                        padding: "var(--space-6)", boxShadow: "var(--elevation-card)", zIndex: 30,
                      }}
                    >
                      <div style={{ padding: "8px 10px 6px", fontFamily: T.fontMono, fontSize: "var(--font-size-2xs)", fontWeight: 700, color: T.textQuaternary, letterSpacing: "0.08em" }}>
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
                              display: "flex", alignItems: "center", gap: "var(--space-10)", padding: "var(--space-10)", borderRadius: "var(--radius-md)",
                              width: "100%", border: "none", background: "transparent",
                              cursor: canCreate ? "pointer" : "default",
                              opacity: canCreate ? 1 : 0.5, textAlign: "left",
                            }}
                            onMouseEnter={(e) => { if (canCreate) e.currentTarget.style.background = "var(--material-card)"; }}
                            onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
                          >
                            <div style={{
                              width: 32, height: 32, borderRadius: "var(--radius-md)", flexShrink: 0,
                              background: `${color.dot}18`,
                              display: "flex", alignItems: "center", justifyContent: "center",
                            }}>
                              <div style={{ width: 10, height: 10, borderRadius: "var(--radius-xs)", background: color.dot }} />
                            </div>
                            <div>
                              <div style={{ fontFamily: T.fontHeading, fontSize: "var(--font-size-md)", fontWeight: 600, color: T.textPrimary }}>{item.label}</div>
                              <div style={{ fontFamily: T.fontBody, fontSize: "var(--font-size-sm)", color: T.textSecondary }}>{item.description}</div>
                            </div>
                          </button>
                        );
                      })}

                      <div style={{ height: 1, background: T.borderSubtle, margin: "4px 10px" }} />

                      <div style={{ padding: "8px 10px 6px", fontFamily: T.fontMono, fontSize: "var(--font-size-2xs)", fontWeight: 700, color: T.textQuaternary, letterSpacing: "0.08em" }}>
                        FROM LIBRARY
                      </div>

                      <button
                        type="button"
                        onClick={() => { setAddMenuOpen(false); setPickerOpen(true); }}
                        style={{
                          display: "flex", alignItems: "center", gap: "var(--space-10)", padding: "var(--space-10)", borderRadius: "var(--radius-md)",
                          width: "100%", border: "none", background: "transparent", cursor: "pointer", textAlign: "left",
                        }}
                        onMouseEnter={(e) => { e.currentTarget.style.background = "var(--material-card)"; }}
                        onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
                      >
                        <div style={{
                          width: 32, height: 32, borderRadius: "var(--radius-md)", flexShrink: 0,
                          background: "rgba(232,121,160,0.12)",
                          display: "flex", alignItems: "center", justifyContent: "center",
                        }}>
                          <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                            <circle cx="7" cy="5" r="2.2" stroke="#E879A0" strokeWidth="1.3" />
                            <path d="M3 12c0-2.2 1.8-3.6 4-3.6s4 1.4 4 3.6" stroke="#E879A0" strokeWidth="1.3" strokeLinecap="round" />
                          </svg>
                        </div>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ display: "flex", alignItems: "center", gap: "var(--space-8)" }}>
                            <div style={{ fontFamily: T.fontHeading, fontSize: "var(--font-size-md)", fontWeight: 600, color: "#E879A0" }}>Character from library</div>
                            <span style={{
                              fontFamily: T.fontMono, fontSize: "var(--font-size-2xs)", letterSpacing: "0.06em",
                              color: T.textQuaternary, padding: "1px 5px", borderRadius: "var(--radius-xs)",
                              background: "rgba(255,255,255,0.06)",
                            }}>
                              ⌘K
                            </span>
                          </div>
                          <div style={{ fontFamily: T.fontBody, fontSize: "var(--font-size-sm)", color: T.textSecondary }}>Link a global character into this world</div>
                        </div>
                      </button>

                      <button type="button" style={{
                        display: "flex", alignItems: "center", gap: "var(--space-10)", padding: "var(--space-10)", borderRadius: "var(--radius-md)",
                        width: "100%", border: "none", background: "transparent", cursor: "pointer", textAlign: "left",
                      }}>
                        <div style={{
                          width: 32, height: 32, borderRadius: "var(--radius-md)", flexShrink: 0,
                          background: "rgba(168,140,255,0.1)",
                          display: "flex", alignItems: "center", justifyContent: "center",
                        }}>
                          <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                            <circle cx="7" cy="7" r="2" fill="#8B5CF6" />
                            <circle cx="7" cy="2" r="1.2" fill="#8B5CF6" />
                            <circle cx="7" cy="12" r="1.2" fill="#8B5CF6" />
                            <circle cx="2" cy="7" r="1.2" fill="#8B5CF6" />
                            <circle cx="12" cy="7" r="1.2" fill="#8B5CF6" />
                          </svg>
                        </div>
                        <div>
                          <div style={{ fontFamily: T.fontHeading, fontSize: "var(--font-size-md)", fontWeight: 600, color: "#8B5CF6" }}>Generate with AI</div>
                          <div style={{ fontFamily: T.fontBody, fontSize: "var(--font-size-sm)", color: T.textQuaternary }}>Auto-create nodes from a description</div>
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
                        <path d="M 0 0 L 10 5 L 0 10 z" fill="var(--text-quaternary)" />
                      </marker>
                    </defs>
                    {edges.map((edge) => {
                      const from = nodeLookup[edge.from];
                      const to = nodeLookup[edge.to];
                      if (!from || !to) return null;
                      const fromH = measuredHeights[edge.from] ?? from.h;
                      const toH = measuredHeights[edge.to] ?? to.h;
                      const { start, end } = getEdgeAnchors(from, to, fromH, toH);
                      const midX = (start.x + end.x) / 2;
                      const isKnows = edge.kind === "knows";
                      const stroke = isKnows
                        ? (edge.attitude && ATTITUDE_COLORS[edge.attitude]) ?? "var(--critical-crimson)"
                        : "var(--border-subtle)";
                      return (
                        <g key={edge.id}>
                          <path
                            d={`M ${start.x} ${start.y} C ${midX} ${start.y}, ${midX} ${end.y}, ${end.x} ${end.y}`}
                            stroke={stroke}
                            strokeWidth={isKnows ? 1.25 : 1.5}
                            strokeDasharray={isKnows ? "4 3" : undefined}
                            strokeOpacity={isKnows ? 0.75 : 1}
                            fill="none"
                            markerEnd={isKnows ? undefined : "url(#canvas-arrow)"}
                          />
                          <path
                            d={`M ${start.x} ${start.y} C ${midX} ${start.y}, ${midX} ${end.y}, ${end.x} ${end.y}`}
                            stroke="var(--emissive-mint)"
                            strokeWidth="1"
                            strokeDasharray="2 12"
                            strokeOpacity={isKnows ? 0.5 : 0.34}
                            fill="none"
                            style={{ animation: "odyssey-signal-flow 2.2s linear infinite" }}
                          />
                        </g>
                      );
                    })}
                  </svg>

                  {/* Nodes */}
                  {nodes.map((node) => {
                    const color = NODE_COLORS[node.entityType];
                    const isSelected = selectedNodeId === node.id;
                    const nodeErrors = errorsForNode(node.id);
                    const hasErrors = nodeErrors.length > 0;

                    if (node.entityType === "character" && world) {
                      const char = world.characters.find((c) => c.id === node.entityId);
                      if (char) {
                        return (
                          <CharacterChipNode
                            key={node.id}
                            node={node}
                            char={char}
                            isSelected={isSelected}
                            hasErrors={hasErrors}
                            errorMessage={nodeErrors[0]?.message}
                            isDragging={dragState?.type === "node" && dragState.nodeId === node.id}
                            onPointerDown={(e) => startNodeDrag(e, node.id)}
                            onContextMenu={(e) => handleContextMenu(e, node.id)}
                            setNodeEl={(el) => setNodeEl(node.id, el)}
                          />
                        );
                      }
                    }

                    return (
                      <article
                        key={node.id}
                        ref={(el) => setNodeEl(node.id, el)}
                        data-node-id={node.id}
                        style={{
                          position: "absolute", left: node.x, top: node.y, width: node.w,
                          padding: node.collapsed ? "8px 12px" : 14,
                          borderRadius: "var(--radius-card, 18px)",
                          border: isSelected
                            ? `2px solid ${color.dot}`
                            : hasErrors
                            ? "2px solid #FF5A5A"
                            : `1px solid ${T.borderSubtle}`,
                          background: T.nodeBg,
                          boxShadow: isSelected
                            ? `0 0 0 1px ${color.glow}, 0 0 28px ${color.glow}, var(--elevation-card)`
                            : "var(--elevation-card)",
                          cursor: dragState?.type === "node" && dragState.nodeId === node.id ? "grabbing" : "grab",
                          userSelect: "none",
                          transition: "box-shadow 180ms, border-color 180ms, transform 180ms",
                        }}
                        onPointerDown={(e) => startNodeDrag(e, node.id)}
                        onContextMenu={(e) => handleContextMenu(e, node.id)}
                      >
                        {/* Header */}
                        <div style={{ display: "flex", alignItems: "center", gap: "var(--space-6)" }}>
                          <span style={{ width: 8, height: 8, borderRadius: "50%", background: color.dot, flexShrink: 0 }} />
                          {node.entityType === "character" && (
                            <span
                              title="Linked to global character library"
                              style={{ width: 6, height: 6, borderRadius: "50%", background: "#8FD1CB", flexShrink: 0, boxShadow: "0 0 6px rgba(122,229,197,0.6)" }}
                            />
                          )}
                          <span style={{ fontFamily: T.fontMono, fontSize: "var(--font-size-2xs)", fontWeight: 700, color: color.dot, letterSpacing: "0.08em" }}>
                            {ENTITY_LABELS[node.entityType]}
                          </span>

                          {/* v2 badge for world core */}
                          {node.entityType === "world" && world?.metrics && (
                            <span style={{ marginLeft: "auto", padding: "1px 5px", borderRadius: "var(--radius-xs)", background: "rgba(168,140,255,0.2)", fontFamily: T.fontMono, fontSize: "var(--font-size-3xs)", fontWeight: 700, color: "#8B5CF6" }}>
                              v2
                            </span>
                          )}

                          {/* Category badge for events */}
                          {node.entityType === "event" && (() => {
                            const ev = world?.eventTemplates.find((e) => e.id === node.entityId);
                            return ev ? (
                              <span style={{ marginLeft: "auto", padding: "2px 6px", borderRadius: "var(--radius-xs)", background: `${color.dot}22`, fontFamily: T.fontMono, fontSize: "var(--font-size-3xs)", color: color.dot }}>
                                {ev.category}
                              </span>
                            ) : null;
                          })()}

                          {/* Error count */}
                          {hasErrors && (
                            <span style={{ marginLeft: "auto", width: 16, height: 16, borderRadius: "50%", background: "#FF5A5A", color: "#fff", fontSize: "var(--font-size-2xs)", fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                              {nodeErrors.length}
                            </span>
                          )}

                          {/* Collapse */}
                          <button
                            type="button"
                            onClick={(e) => { e.stopPropagation(); toggleCollapse(node.id); }}
                            style={{ border: "none", background: "transparent", color: T.textTertiary, cursor: "pointer", fontSize: "var(--font-size-sm)", padding: 0, lineHeight: 1 }}
                          >
                            {node.collapsed ? "▸" : "▾"}
                          </button>
                        </div>

                        {/* Title */}
                        <div style={{
                          fontFamily: T.fontHeading, fontSize: "var(--font-size-lg)", fontWeight: 600, color: T.textPrimary,
                          marginTop: node.collapsed ? 0 : 6,
                          overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                        }}>
                          {node.label}
                        </div>

                        {/* Errors */}
                        {!node.collapsed && hasErrors && (
                          <div style={{ marginTop: "var(--space-4)" }}>
                            {nodeErrors.slice(0, 2).map((err, i) => (
                              <p key={i} style={{ fontSize: "var(--font-size-xs)", color: "#FF5A5A", lineHeight: 1.4, fontFamily: T.fontBody, margin: 0 }}>
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

              {/* Validation / save strip */}
              {world && (() => {
                const hasErrors = validationErrors.length > 0;
                const savedJustNow = saveStatus === "saved" && !dirty;
                const status = hasErrors
                  ? { dot: "var(--status-draft)", glow: "color-mix(in srgb, var(--status-draft) 50%, transparent)", label: `Draft · ${validationErrors.length} warning${validationErrors.length === 1 ? "" : "s"}` }
                  : savedJustNow
                  ? { dot: "var(--emissive-mint)", glow: "color-mix(in srgb, var(--emissive-mint) 50%, transparent)", label: "Saved" }
                  : dirty
                  ? { dot: "var(--status-draft)", glow: "color-mix(in srgb, var(--status-draft) 50%, transparent)", label: "Unsaved changes" }
                  : { dot: "var(--emissive-mint)", glow: "color-mix(in srgb, var(--emissive-mint) 50%, transparent)", label: "Draft · ready" };
                const reason = hasErrors
                  ? validationErrors[0].message
                  : savedJustNow
                  ? "All changes saved"
                  : dirty
                  ? "Save before publishing"
                  : "No issues detected";
                return (
                  <div
                    data-pan-ignore="true"
                    onPointerDown={(e) => e.stopPropagation()}
                    style={{
                      position: "absolute", left: 24, bottom: 24, zIndex: 25,
                      display: "flex", alignItems: "center", gap: "var(--space-14)",
                      padding: "10px 14px", borderRadius: "var(--radius-lg)",
                      background: "color-mix(in srgb, var(--surface-1) 90%, transparent)",
                      border: "1px solid var(--border-subtle)",
                      backdropFilter: "blur(12px)",
                      WebkitBackdropFilter: "blur(12px)",
                      fontFamily: T.fontBody,
                    }}
                  >
                    <div style={{ display: "flex", alignItems: "center", gap: "var(--space-8)" }}>
                      <div style={{
                        width: 8, height: 8, borderRadius: "var(--radius-pill)", background: status.dot,
                        boxShadow: `0 0 10px ${status.glow}`,
                      }} />
                      <div style={{ fontSize: "var(--font-size-base)", fontWeight: 500, color: T.textPrimary }}>
                        {status.label}
                      </div>
                    </div>
                    <div style={{ width: 1, height: 16, background: "var(--border-subtle)" }} />
                    <div style={{
                      fontFamily: T.fontMono, fontSize: "var(--font-size-xs)",
                      letterSpacing: "0.06em", color: T.textSecondary,
                      maxWidth: 280, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                    }}>
                      {reason}
                    </div>
                    <div style={{ width: 1, height: 16, background: "var(--border-subtle)" }} />
                    <div style={{ display: "flex", alignItems: "center", gap: "var(--space-8)" }}>
                      <button
                        type="button"
                        onClick={saveWorld}
                        disabled={!dirty || isSaving}
                        style={{
                          padding: "5px 12px", borderRadius: "var(--radius-md)",
                          border: "1px solid var(--border-subtle)", background: "transparent",
                          color: dirty ? T.textPrimary : T.textTertiary,
                          fontFamily: T.fontBody, fontSize: "var(--font-size-sm)", fontWeight: 500,
                          cursor: dirty && !isSaving ? "pointer" : "not-allowed",
                          opacity: isSaving ? 0.6 : 1,
                        }}
                      >
                        {isSaving ? "Saving…" : "Save draft"}
                      </button>
                      <button
                        type="button"
                        disabled
                        title="Publish flow coming soon"
                        style={{
                          padding: "5px 14px", borderRadius: "var(--radius-md)", border: "none",
                          background: "color-mix(in srgb, var(--accent-strong) 30%, transparent)", color: "var(--background)",
                          fontFamily: T.fontBody, fontSize: "var(--font-size-sm)", fontWeight: 600,
                          cursor: "not-allowed",
                        }}
                      >
                        Publish
                      </button>
                    </div>
                  </div>
                );
              })()}

              {/* Context Menu */}
              {contextMenu && (
                <div
                  data-pan-ignore="true"
                  onClick={(e) => e.stopPropagation()}
                  style={{
                    position: "absolute", left: contextMenu.x, top: contextMenu.y, zIndex: 40,
                    width: 200, background: "var(--material-surface)", border: `1px solid ${T.borderSubtle}`,
                    borderRadius: "var(--radius-xl)", padding: "var(--space-4)", boxShadow: "var(--elevation-panel)",
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
                    { label: "AI Refine", color: "var(--accent-strong)", action: () => setContextMenu(null) },
                    { label: "Validate", action: () => setContextMenu(null) },
                    { type: "separator" as const },
                    {
                      label: "Delete Node", shortcut: "⌫", color: "#FF5A5A",
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
                          width: "100%", padding: "7px 10px", borderRadius: "var(--radius-sm)",
                          border: "none", background: "transparent",
                          fontFamily: T.fontBody, fontSize: "var(--font-size-md)", color: menuItem.color ?? T.textPrimary,
                          cursor: "pointer", textAlign: "left",
                        }}
                        onMouseEnter={(e) => { e.currentTarget.style.background = "var(--border-subtle)"; }}
                        onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
                      >
                        <span>{menuItem.label}</span>
                        {menuItem.shortcut && <span style={{ fontSize: "var(--font-size-sm)", color: T.textTertiary }}>{menuItem.shortcut}</span>}
                        {menuItem.suffix && <span style={{ fontSize: "var(--font-size-sm)", color: T.textTertiary }}>{menuItem.suffix}</span>}
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
              fontFamily: T.fontMono, fontSize: "var(--font-size-2xs)", color: T.textTertiary, letterSpacing: "0.06em",
            }}>
              <div style={{ display: "flex", alignItems: "center", gap: "var(--space-14)" }}>
                {legendItems.map((item) => (
                  <div key={item.type} style={{ display: "flex", alignItems: "center", gap: "var(--space-5)" }}>
                    <div style={{ width: 7, height: 7, borderRadius: "var(--radius-2xs)", background: NODE_COLORS[item.type].dot }} />
                    <span>{item.label}</span>
                  </div>
                ))}
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: "var(--space-12)" }}>
                <span>{nodes.length} nodes</span>
                <div style={{ display: "flex", alignItems: "center", gap: "var(--space-4)" }}>
                  <button type="button" onClick={() => zoomViewportCenter(1 / 1.1)}
                    style={{ border: `1px solid ${T.borderSubtle}`, background: "transparent", color: T.textSecondary, borderRadius: "var(--radius-xs)", padding: "1px 6px", cursor: "pointer", fontSize: "var(--font-size-sm)" }}>
                    −
                  </button>
                  <span style={{ minWidth: 36, textAlign: "center" }}>{Math.round(zoom * 100)}%</span>
                  <button type="button" onClick={() => zoomViewportCenter(1.1)}
                    style={{ border: `1px solid ${T.borderSubtle}`, background: "transparent", color: T.textSecondary, borderRadius: "var(--radius-xs)", padding: "1px 6px", cursor: "pointer", fontSize: "var(--font-size-sm)" }}>
                    +
                  </button>
                </div>
              </div>
            </div>
          </div>

          {/* ── Detail Panel ─────────────────────────────────── */}
          {selectedNode && world && (
            <div style={{
              width: 420, flexShrink: 0, background: T.chrome,
              borderLeft: `1px solid ${T.borderSubtle}`, overflow: "hidden",
              display: "flex", flexDirection: "column",
            }}>
              {selectedNode.entityType === "character" ? (
                <CharacterInspector
                  worldId={worldId}
                  characterSlug={selectedNode.entityId}
                  onClose={() => setSelectedNodeId(null)}
                  onUnlinked={() => {
                    setSelectedNodeId(null);
                    loadWorld(worldId);
                  }}
                />
              ) : (
                <div style={{ overflow: "auto" }}>
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
          )}
        </div>
      </div>

      {/* ── Character Picker (⌘K) ──────────────────────────────── */}
      {worldId && (
        <CharacterPicker
          worldId={worldId}
          open={pickerOpen}
          onClose={() => setPickerOpen(false)}
          onLinked={handleCharacterLinked}
        />
      )}
    </>
  );
}
