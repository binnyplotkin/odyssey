"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  updateCharacterMeta,
  updateCharacterVoiceSettings,
} from "@/app/(authenticated)/characters/actions";
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  BackgroundVariant,
  Controls,
  useNodesState,
  type Node as FlowNode,
  type NodeProps,
  type NodeTypes,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { useHeaderContent } from "@/components/header-context";
import { EditThumbnailOverlay } from "@/components/edit-thumbnail-overlay";
import {
  BrainGlyph,
  VoiceGlyph,
  WikisGlyph,
} from "@/components/character-glyphs";
import { resolveAvatarGradient } from "@/lib/avatar-gradients";
import type {
  CharacterDirective,
  CharacterIdentity,
  CharacterBrainModel,
  CharacterRecord,
  CharacterVoiceStyle,
  CharacterKnowledgeBindingRecord,
  BindingPriority,
  IdentityTrait,
  KnowledgeGraphData,
  VoiceSettingsOverride,
} from "@odyssey/db";
import { DEFAULT_CHAT_MODEL, type ModelOption } from "@/lib/model-registry";
import { CharacterNodeCard } from "@/components/character-node-card";
import { KnowledgeGraphIcon } from "@/components/knowledge-graph-icon";
import { EditableText } from "@/components/editable-text";
import { Pathname } from "@/components/pathname";
import { TabBar, type TabItem } from "@/components/tab-bar";
import { Menu, type MenuItem } from "@/components/menu";
import {
  VoiceLibraryPicker,
  type PickerVoice,
} from "@/components/voice-library-picker";

/* ── Tokens ────────────────────────────────────────────────────── */

const T = {
  fg: "var(--foreground)",
  muted: "var(--muted)",
  panel: "var(--panel)",
  panelStrong: "var(--panel-strong)",
  border: "var(--border)",
  borderStrong: "var(--border-strong, rgba(255,255,255,0.12))",
  accent: "var(--accent-strong)",
  accentSoft: "color-mix(in srgb, var(--accent-strong) 12%, transparent)",
  warn: "#E8B87A",
  warnSoft: "rgba(232,184,122,0.12)",
  danger: "var(--danger)",
  dangerSoft: "color-mix(in srgb, var(--danger) 10%, transparent)",
  fontHeading: "'Inter', system-ui, sans-serif",
  fontBody: "'Inter', sans-serif",
  fontMono: "'JetBrains Mono', ui-monospace, monospace",
} as const;

function relative(iso: string | null): string {
  if (!iso) return "—";
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}

/* ── Props ─────────────────────────────────────────────────────── */

export type ConfigBinding = {
  binding: CharacterKnowledgeBindingRecord;
  wiki: {
    id: string;
    slug: string;
    title: string;
    summary: string | null;
    pageCount: number;
    sourceCount: number;
    characterCount: number;
    updatedAt: string;
    iconData: KnowledgeGraphData;
  };
};

export type ConfigVersion = {
  id: string;
  versionNumber: number;
  createdAt: string;
};

type Props = {
  character: CharacterRecord;
  knowledge: {
    pageCount: number;
    entityCount: number;
    bindings: ConfigBinding[];
  };
  sessions: {
    rememberedCount: number;
  };
  versions: ConfigVersion[];
  chatModels: ModelOption[];
  voiceModels: ModelOption[];
};

type TabKey = "persona" | "brain" | "knowledge" | "voice" | "limits";

/* ── useDebouncedSave ──────────────────────────────────────────── */

/**
 * Coalesces high-frequency saves (keystrokes, slider drags) into one POST
 * after `delay` ms of quiet. Local state still updates synchronously — only
 * the network call is throttled.
 */
function useDebouncedSave<T>(
  saver: (next: T) => Promise<void> | void,
  delay = 500,
) {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const saverRef = useRef(saver);
  saverRef.current = saver;
  useEffect(
    () => () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    },
    [],
  );
  return useCallback(
    (next: T) => {
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => {
        void saverRef.current(next);
        timerRef.current = null;
      }, delay);
    },
    [delay],
  );
}

/* ── Top-level layout ──────────────────────────────────────────── */

export function CharacterConfig({
  character,
  knowledge,
  sessions,
  versions: initialVersions,
  chatModels,
  voiceModels,
}: Props) {
  const router = useRouter();
  const [tab, setTab] = useState<TabKey>("persona");
  const [title, setTitle] = useState<string>(character.title);
  const [identity, setIdentity] = useState<CharacterIdentity | null>(
    character.identity,
  );
  const [voiceStyle, setVoiceStyle] = useState<CharacterVoiceStyle | null>(
    character.voiceStyle,
  );
  const [brainModel, setBrainModel] = useState<CharacterBrainModel | null>(
    character.brainModel,
  );
  const [directive, setDirective] = useState<CharacterDirective | null>(
    character.directive,
  );
  const [bindings, setBindings] = useState<ConfigBinding[]>(knowledge.bindings);
  // Lifted: voice binding + library options live here so both the canvas
  // card (CharacterCard) and the sidebar picker (VoiceStyleSection) read
  // and update through a single source of truth. Otherwise the canvas
  // pill would stay stale until a full page reload.
  const [voiceId, setVoiceIdLocal] = useState<string | null>(character.voiceId);
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
  const [versions, setVersions] = useState<ConfigVersion[]>(initialVersions);
  const [savedAt, setSavedAt] = useState<number>(Date.now());
  // Sidebar is gated on canvas selection — the character node starts
  // selected, so the sidebar shows on first paint. Clicking the canvas
  // empty space deselects and hides it; clicking the node brings it back.
  const [sidebarOpen, setSidebarOpen] = useState(true);

  // Prompt preview overlay state. Opens from the sidebar footer's
  // paragraph button; closes on Esc, clicking the backdrop, or hitting
  // the Close action.
  const [previewOpen, setPreviewOpen] = useState(false);

  // Thumbnail state — mirrors the persisted character.image +
  // thumbnailColor. The EditThumbnailOverlay commits to the API and then
  // calls onSaved with the canonical values; cancelling reverts.
  const [thumbnailColor, setThumbnailColor] = useState<string | null>(
    character.thumbnailColor,
  );
  const [image, setImage] = useState<string | null>(character.image);
  const [thumbnailOpen, setThumbnailOpen] = useState(false);

  // Page wants flush content — the right config sidebar is meant to bleed to
  // the page edge rather than sit inside a 2rem AdminShell gutter.
  const { setFlush, setContent } = useHeaderContent();
  useEffect(() => {
    setFlush(true);
    return () => setFlush(false);
  }, [setFlush]);

  const avGradient = resolveAvatarGradient(thumbnailColor, character.slug);
  const initial = title.charAt(0).toUpperCase();

  const saveTitle = useCallback(
    async (next: string) => {
      setTitle(next);
      setSavedAt(Date.now());
      await updateCharacterMeta(character.id, { title: next });
    },
    [character.id],
  );

  const saveVersion = useCallback(async () => {
    const res = await fetch(`/api/characters/${character.id}/versions`, {
      method: "POST",
    });
    if (!res.ok) return;
    const { version } = await res.json();
    setVersions((prev) => [
      {
        id: version.id,
        versionNumber: version.versionNumber,
        createdAt: version.createdAt,
      },
      ...prev,
    ]);
    setSavedAt(Date.now());
  }, [character.id]);

  const restoreVersion = useCallback(
    async (versionId: string) => {
      const res = await fetch(
        `/api/characters/${character.id}/versions/${versionId}/restore`,
        { method: "POST" },
      );
      if (!res.ok) return;
      // The server revalidates the page; a router refresh re-fetches the
      // canonical state from the DB so identity/voice/mind/directive +
      // bindings all reflect the restored snapshot.
      router.refresh();
    },
    [character.id, router],
  );

  // Inject the top header content. Title is editable in both this header
  // and the sidebar; both bind to the same `title` state so edits propagate
  // live across surfaces.
  const activeModelId = brainModel?.model ?? DEFAULT_CHAT_MODEL;
  const modelLabel =
    chatModels.find((m) => m.id === activeModelId)?.label ?? activeModelId;
  useEffect(() => {
    setContent(
      <CharacterPageHeader
        characterSlug={character.slug}
        title={title}
        onTitleChange={saveTitle}
        modelLabel={modelLabel}
        versions={versions}
        onSaveVersion={saveVersion}
        onRestoreVersion={restoreVersion}
      />,
    );
    return () => setContent(null);
  }, [
    setContent,
    character.slug,
    title,
    saveTitle,
    modelLabel,
    versions,
    saveVersion,
    restoreVersion,
  ]);

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "row",
        gap: 0,
        minHeight: "calc(100vh - 48px)",
        background: "var(--background)",
        color: T.fg,
      }}
    >
      {/* Main column — infinite canvas with the character node */}
      <CanvasArea
        character={character}
        identity={identity}
        voiceStyle={voiceStyle}
        voiceId={voiceId}
        voiceOptions={voiceOptions}
        brainModel={brainModel}
        bindings={bindings}
        gradient={avGradient}
        image={image}
        initial={initial}
        knowledge={knowledge}
        sessions={sessions}
        onSelectionChange={setSidebarOpen}
        onSelectTab={setTab}
      />

      {/* Right config sidebar — gated on canvas selection */}
      {sidebarOpen && (
        <ConfigSidebar
          character={character}
          title={title}
          onTitleChange={saveTitle}
          tab={tab}
          onTabChange={setTab}
          savedAt={savedAt}
          identity={identity}
          onIdentityChange={(next) => {
            setIdentity(next);
            setSavedAt(Date.now());
          }}
          voiceStyle={voiceStyle}
          onVoiceStyleChange={(next) => {
            setVoiceStyle(next);
            setSavedAt(Date.now());
          }}
          brainModel={brainModel}
          onBrainModelChange={(next) => {
            setBrainModel(next);
            setSavedAt(Date.now());
          }}
          directive={directive}
          onDirectiveChange={(next) => {
            setDirective(next);
            setSavedAt(Date.now());
          }}
          bindings={bindings}
          onBindingsChange={(next) => {
            setBindings(next);
            setSavedAt(Date.now());
          }}
          voiceId={voiceId}
          voiceOptions={voiceOptions}
          onVoiceIdChange={(next) => {
            setVoiceIdLocal(next);
            setSavedAt(Date.now());
          }}
          avGradient={avGradient}
          image={image}
          initial={initial}
          onEditThumbnail={() => setThumbnailOpen(true)}
          chatModels={chatModels}
          voiceModels={voiceModels}
          onOpenPreview={() => setPreviewOpen(true)}
        />
      )}

      {previewOpen && (
        <PromptPreviewOverlay
          characterSlug={character.slug}
          title={title}
          identity={identity}
          voiceStyle={voiceStyle}
          directive={directive}
          bindings={bindings}
          onClose={() => setPreviewOpen(false)}
          onJumpToTab={(t) => {
            setTab(t);
            setPreviewOpen(false);
          }}
        />
      )}

      {thumbnailOpen && (
        <EditThumbnailOverlay
          characterId={character.id}
          slug={character.slug}
          initialThumbnailColor={thumbnailColor}
          initialImage={image}
          initial={initial}
          onClose={() => setThumbnailOpen(false)}
          onSaved={(next) => {
            setThumbnailColor(next.thumbnailColor);
            setImage(next.image);
            setSavedAt(Date.now());
          }}
        />
      )}
    </div>
  );
}

/* ── Page header (breadcrumb + editable title + status + sandbox) ── */

function CharacterPageHeader({
  characterSlug,
  title,
  onTitleChange,
  modelLabel,
  versions,
  onSaveVersion,
  onRestoreVersion,
}: {
  characterSlug: string;
  title: string;
  onTitleChange: (next: string) => void | Promise<void>;
  modelLabel: string;
  versions: ConfigVersion[];
  onSaveVersion: () => void | Promise<void>;
  onRestoreVersion: (versionId: string) => void | Promise<void>;
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
          { label: "characters", href: "/characters" },
          {
            label: title,
            href: `/characters/${characterSlug}`,
            tag: true,
            editable: {
              onRename: onTitleChange,
              ariaLabel: "Character name",
            },
          },
        ]}
      />
      <span
        style={{
          display: "inline-flex",
          alignItems: "center",
          padding: "2px 9px",
          borderRadius: "var(--radius-pill)",
          border: "1px solid var(--border)",
          fontFamily: T.fontMono,
          fontSize: "var(--font-size-2xs)",
          fontWeight: 500,
          letterSpacing: "0.20em",
          textTransform: "uppercase",
          color: "var(--text-secondary)",
          whiteSpace: "nowrap",
        }}
        title={`Brain model: ${modelLabel}`}
      >
        {modelLabel}
      </span>

      <div style={{ flex: 1 }} />

      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "var(--space-8)",
          flexShrink: 0,
        }}
      >
        <VersionDropdown
          versions={versions}
          onSave={onSaveVersion}
          onRestore={onRestoreVersion}
        />
        <Link
          href={`/characters/${characterSlug}/sandbox`}
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: "var(--space-6)",
            padding: "7px 16px",
            border: `1px solid ${T.accent}`,
            borderRadius: "var(--radius-pill)",
            background: T.accent,
            color: "var(--background)",
            fontFamily: T.fontHeading,
            fontSize: "var(--font-size-base)",
            fontWeight: 600,
            textDecoration: "none",
            whiteSpace: "nowrap",
          }}
        >
          sandbox ↗
        </Link>
        <Link
          href={`/characters/${characterSlug}/harness`}
          aria-label="Open harness"
          title="Open harness"
          style={{
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            width: 30,
            height: 28,
            border:
              "1px solid color-mix(in srgb, var(--text-primary) 8%, transparent)",
            borderRadius: "var(--radius-pill)",
            background: "transparent",
            color: "var(--text-tertiary)",
            textDecoration: "none",
            flexShrink: 0,
          }}
        >
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <line x1="21" y1="6" x2="9" y2="6" />
            <line x1="3" y1="6" x2="5" y2="6" />
            <line x1="21" y1="12" x2="15" y2="12" />
            <line x1="3" y1="12" x2="11" y2="12" />
            <line x1="21" y1="18" x2="7" y2="18" />
            <line x1="3" y1="18" x2="3" y2="18" />
            <circle cx="7" cy="6" r="2" fill="var(--background)" />
            <circle cx="13" cy="12" r="2" fill="var(--background)" />
            <circle cx="5" cy="18" r="2" fill="var(--background)" />
          </svg>
        </Link>
      </div>
    </div>
  );
}

/* ── VersionDropdown ───────────────────────────────────────────── */

/**
 * Real version control replacing the placeholder `v 0.3.7` button. Shows
 * the latest version label (or "unsaved" if none yet). Click to open a
 * popover with "Save snapshot" + a list of prior versions; each row
 * restores the snapshot when clicked.
 */
function VersionDropdown({
  versions,
  onSave,
  onRestore,
}: {
  versions: ConfigVersion[];
  onSave: () => void | Promise<void>;
  onRestore: (versionId: string) => void | Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onDocClick(e: MouseEvent) {
      if (!containerRef.current) return;
      if (containerRef.current.contains(e.target as Node)) return;
      setOpen(false);
    }
    function onEsc(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onEsc);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onEsc);
    };
  }, [open]);

  const latest = versions[0] ?? null;
  const label = latest ? `v${latest.versionNumber}` : "unsaved";

  return (
    <div ref={containerRef} style={{ position: "relative" }}>
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: "var(--space-4)",
          padding: "7px 14px",
          border: `1px solid ${open ? T.accent : "color-mix(in srgb, var(--text-primary) 8%, transparent)"}`,
          borderRadius: "var(--radius-pill)",
          background: open ? T.accentSoft : "transparent",
          color: open ? T.accent : "var(--text-tertiary)",
          fontFamily: T.fontMono,
          fontSize: "var(--font-size-sm)",
          letterSpacing: "0.10em",
          textTransform: "uppercase",
          cursor: "pointer",
          whiteSpace: "nowrap",
        }}
      >
        {label} ▾
      </button>

      {open && (
        <div
          role="dialog"
          style={{
            position: "absolute",
            top: "calc(100% + 6px)",
            right: 0,
            width: 280,
            zIndex: 30,
            background: "var(--card)",
            border: `1px solid ${T.border}`,
            padding: "6px 0",
            boxShadow: "0 16px 40px var(--shadow, rgba(0,0,0,0.40))",
            color: T.fg,
            display: "flex",
            flexDirection: "column",
          }}
        >
          <button
            type="button"
            disabled={saving}
            onClick={async () => {
              setSaving(true);
              try {
                await onSave();
                setOpen(false);
              } finally {
                setSaving(false);
              }
            }}
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: "var(--space-8)",
              padding: "8px 14px",
              border: "none",
              background: "transparent",
              color: T.fg,
              fontFamily: T.fontBody,
              fontSize: "var(--font-size-base)",
              fontWeight: 500,
              cursor: saving ? "wait" : "pointer",
              textAlign: "left",
              opacity: saving ? 0.6 : 1,
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = "var(--card-hover)";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = "transparent";
            }}
          >
            <span>{saving ? "Saving snapshot…" : "+ Save snapshot"}</span>
            <span
              style={{
                fontFamily: T.fontMono,
                fontSize: "var(--font-size-xs)",
                color: T.muted,
              }}
            >
              v{(latest?.versionNumber ?? 0) + 1}
            </span>
          </button>

          <div style={{ height: 1, background: T.border, margin: "6px 0" }} />

          <div
            style={{
              padding: "4px 14px",
              fontFamily: T.fontMono,
              fontSize: "var(--font-size-2xs)",
              color: T.muted,
              letterSpacing: "0.08em",
              textTransform: "uppercase",
            }}
          >
            history
          </div>

          {versions.length === 0 && (
            <div
              style={{
                padding: "8px 14px 12px",
                fontFamily: T.fontBody,
                fontSize: "var(--font-size-sm)",
                color: T.muted,
                lineHeight: 1.5,
              }}
            >
              No snapshots yet. Save one to capture the current Identity, Voice,
              Mind, Limits, and Knowledge bindings.
            </div>
          )}

          <div style={{ maxHeight: 280, overflow: "auto" }}>
            {versions.map((v) => (
              <button
                key={v.id}
                type="button"
                onClick={() => {
                  void onRestore(v.id);
                  setOpen(false);
                }}
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: "var(--space-8)",
                  width: "100%",
                  padding: "7px 14px",
                  border: "none",
                  background: "transparent",
                  fontFamily: T.fontBody,
                  fontSize: "var(--font-size-base)",
                  color: T.fg,
                  cursor: "pointer",
                  textAlign: "left",
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = "var(--card-hover)";
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = "transparent";
                }}
              >
                <span style={{ fontFamily: T.fontMono, fontSize: "var(--font-size-sm)" }}>
                  v{v.versionNumber}
                </span>
                <span
                  style={{
                    fontFamily: T.fontMono,
                    fontSize: "var(--font-size-xs)",
                    color: T.muted,
                  }}
                >
                  {relative(v.createdAt)}
                </span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/* ── Canvas area (React Flow) ──────────────────────────────────── */

type CharacterNodeData = {
  character: CharacterRecord;
  identity: CharacterIdentity | null;
  voiceStyle: CharacterVoiceStyle | null;
  voiceId: string | null;
  voiceOptions: PickerVoice[];
  brainModel: CharacterBrainModel | null;
  bindings: ConfigBinding[];
  gradient: string;
  image: string | null;
  initial: string;
  onSelectTab: (t: TabKey) => void;
};

const nodeTypes: NodeTypes = {
  character: CharacterNode,
};

function CanvasArea({
  character,
  identity,
  voiceStyle,
  voiceId,
  voiceOptions,
  brainModel,
  bindings,
  gradient,
  image,
  initial,
  knowledge,
  sessions,
  onSelectionChange,
  onSelectTab,
}: {
  character: CharacterRecord;
  identity: CharacterIdentity | null;
  voiceStyle: CharacterVoiceStyle | null;
  voiceId: string | null;
  voiceOptions: PickerVoice[];
  brainModel: CharacterBrainModel | null;
  bindings: ConfigBinding[];
  gradient: string;
  image: string | null;
  initial: string;
  knowledge: Props["knowledge"];
  sessions: Props["sessions"];
  onSelectionChange: (anySelected: boolean) => void;
  onSelectTab: (t: TabKey) => void;
}) {
  // Single character node, centered and selected by default so the config
  // sidebar shows on first load. Position is hardcoded for now — persistence
  // is a follow-up once there are more nodes worth remembering.
  const [nodes, setNodes, onNodesChange] = useNodesState<
    FlowNode<CharacterNodeData>
  >([
    {
      id: "character",
      type: "character",
      position: { x: -280, y: -180 },
      selected: true,
      data: {
        character,
        identity,
        voiceStyle,
        voiceId,
        voiceOptions,
        brainModel,
        bindings,
        gradient,
        image,
        initial,
        onSelectTab,
      },
      draggable: true,
    },
  ]);

  // Keep node data in sync as the user edits identity / voice / etc. The
  // node's `selected` + `position` are managed by React Flow via
  // onNodesChange; we only ever rewrite `data`.
  useEffect(() => {
    setNodes((prev) =>
      prev.map((n) =>
        n.id === "character"
          ? {
              ...n,
              data: {
                character,
                identity,
                voiceStyle,
                voiceId,
                voiceOptions,
                brainModel,
                bindings,
                gradient,
                image,
                initial,
                onSelectTab,
              },
            }
          : n,
      ),
    );
  }, [
    setNodes,
    character,
    identity,
    voiceStyle,
    voiceId,
    voiceOptions,
    brainModel,
    bindings,
    gradient,
    image,
    initial,
    onSelectTab,
  ]);

  return (
    <div
      style={{
        flex: "1 1 0",
        minWidth: 0,
        position: "relative",
        background: "var(--node-canvas)",
      }}
    >
      <ReactFlowProvider>
        <ReactFlow
          nodes={nodes}
          onNodesChange={onNodesChange}
          onSelectionChange={({ nodes: selected }) =>
            onSelectionChange(selected.length > 0)
          }
          nodeTypes={nodeTypes}
          fitView
          fitViewOptions={{ padding: 0.4, maxZoom: 1, minZoom: 0.6 }}
          minZoom={0.4}
          maxZoom={1.5}
          proOptions={{ hideAttribution: true }}
          panOnScroll
          selectionOnDrag={false}
          style={{ background: "var(--node-canvas)" }}
        >
          <Background
            variant={BackgroundVariant.Lines}
            gap={28}
            lineWidth={1}
            // Use the platform's --grid-color token (the same one driving
            // body::before's atmospheric grid) so the canvas grid lives at
            // the same low alpha across themes.
            color="var(--grid-color)"
          />
          <Controls
            showInteractive={false}
            position="bottom-left"
            style={{
              overflow: "hidden",
              border: "1px solid var(--border)",
            }}
          />
        </ReactFlow>
      </ReactFlowProvider>

    </div>
  );
}

function CharacterNode({
  data,
  selected,
}: NodeProps<FlowNode<CharacterNodeData>>) {
  /* Active brain model + bound voice resolution. The voice lookup
   * walks `voiceOptions` to find the option whose id matches the
   * character's voiceId; falling back to the raw id avoids the slot
   * reading "+ connect" while we're still loading voiceOptions. */
  const activeModel = data.brainModel?.model ?? DEFAULT_CHAT_MODEL;
  const boundVoice = data.voiceId
    ? data.voiceOptions.find((v) => v.id === data.voiceId) ?? null
    : null;
  const voiceSlug = boundVoice?.slug ?? null;
  const voiceProvider = boundVoice?.provider ?? null;

  /* Empty-state heuristic: when essentially nothing has been configured
   * yet — no curated identity, no model override, no bindings, no
   * voice — render the dashed "empty" variant so the canvas reads as
   * "this character is blank, start filling it in". `selected` always
   * wins over `empty` so the user keeps visual feedback while editing
   * a brand-new character. */
  const hasIdentity = Boolean(
    data.identity?.essence?.trim() ||
      (data.identity?.traits ?? []).some((t) => t.name?.trim()),
  );
  const isEmpty =
    !hasIdentity && !data.brainModel && data.bindings.length === 0 && !voiceSlug;
  const state = selected
    ? "selected"
    : isEmpty
      ? "empty"
      : "ready";

  return (
    <CharacterNodeCard
      character={data.character}
      bindings={data.bindings.map((b) => b.wiki)}
      activeModel={activeModel}
      voiceSlug={voiceSlug}
      voiceProvider={voiceProvider}
      state={state}
    />
  );
}

/* ── Faint corner stat cards (knowledge graph / episodic memory) ─ */

function CornerStat({ label, value }: { label: string; value: string }) {
  return (
    <div
      style={{
        alignSelf: "flex-start",
        padding: "12px 16px",
        border: `1px solid ${T.border}`,
        background:
          "color-mix(in srgb, var(--background) 70%, transparent)",
        display: "flex",
        flexDirection: "column",
        gap: "var(--space-4)",
        maxWidth: 260,
      }}
    >
      <span
        style={{
          fontFamily: T.fontMono,
          fontSize: "var(--font-size-2xs)",
          color: T.accent,
          letterSpacing: "0.18em",
          textTransform: "uppercase",
        }}
      >
        {label}
      </span>
      <span
        style={{
          fontFamily: T.fontMono,
          fontSize: "var(--font-size-sm)",
          color: "var(--text-secondary)",
        }}
      >
        {value}
      </span>
    </div>
  );
}

/* ── Main character card ───────────────────────────────────────── */

function CharacterCard({
  character,
  identity,
  voiceStyle,
  voiceId,
  voiceOptions,
  brainModel,
  bindings,
  gradient,
  image,
  initial,
  onSelectTab,
}: {
  character: CharacterRecord;
  identity: CharacterIdentity | null;
  voiceStyle: CharacterVoiceStyle | null;
  voiceId: string | null;
  voiceOptions: PickerVoice[];
  brainModel: CharacterBrainModel | null;
  bindings: ConfigBinding[];
  gradient: string;
  image: string | null;
  initial: string;
  onSelectTab: (t: TabKey) => void;
}) {
  const essence = identity?.essence ?? character.summary ?? "—";
  const activeModel = brainModel?.model ?? DEFAULT_CHAT_MODEL;
  const tones = (voiceStyle?.tone ?? []).filter((t) => t.trim());
  // Voice slot render order: library binding wins (it's the real audio
  // identity), tones fall back when no binding (style without sound), and
  // when neither is configured the slot dims to signal unconfigured.
  const boundVoice = voiceId ? voiceOptions.find((v) => v.id === voiceId) : null;

  return (
    <div
      style={{
        alignSelf: "center",
        width: "100%",
        background: "var(--card)",
        border: `1px solid ${T.border}`,
        padding: "22px 22px",
        display: "flex",
        flexDirection: "column",
        gap: "var(--space-16)",
        overflow: "hidden",
      }}
    >
      {/* top row — CHARACTER label on the left, slug on the right */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: "var(--space-8)",
        }}
      >
        <div
          style={{ display: "flex", alignItems: "center", gap: "var(--space-8)", minWidth: 0 }}
        >
          <span
            style={{
              fontFamily: T.fontMono,
              fontSize: "var(--font-size-xs)",
              color: T.accent,
              letterSpacing: "0.18em",
              textTransform: "uppercase",
            }}
          >
            character
          </span>
        </div>
        <span
          style={{
            fontFamily: T.fontMono,
            fontSize: "var(--font-size-xs)",
            color: "var(--text-quaternary)",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
            minWidth: 0,
          }}
        >
          {character.slug}
        </span>
      </div>

      {/* thumbnail column + identity stack (name, traits, essence) */}
      <div style={{ display: "flex", alignItems: "flex-start", gap: "var(--space-18)" }}>
        <div
          style={{
            width: 128,
            height: 128,
            border:
              "1px solid color-mix(in srgb, var(--accent-strong) 18%, transparent)",
            // When an image is set we layer it over var(--card-hover)
            // (the same tint the model pill uses) so transparent pixels
            // — e.g. after the "Remove black background" pass — read
            // against a calm card-surface tone instead of the panel
            // bleeding through.
            background: image
              ? `center/cover no-repeat url("${image}"), var(--card-hover)`
              : gradient,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            flexShrink: 0,
          }}
        >
          {!image && (
            <span
              style={{
                fontFamily: T.fontHeading,
                fontSize: 56,
                fontWeight: 600,
                color: "rgba(12,14,20,0.75)",
                lineHeight: 1,
              }}
            >
              {initial}
            </span>
          )}
        </div>
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: "var(--space-10)",
            minWidth: 0,
            flex: 1,
          }}
        >
          <h2
            style={{
              fontFamily: T.fontHeading,
              fontSize: 26,
              fontWeight: 700,
              margin: 0,
              letterSpacing: "-0.02em",
              lineHeight: 1.1,
            }}
          >
            {character.title}
          </h2>
          {identity?.traits && identity.traits.some((t) => t.name.trim()) && (
            <div style={{ display: "flex", flexWrap: "wrap", gap: "var(--space-10)" }}>
              {identity.traits
                .filter((t) => t.name.trim())
                .map((t) => (
                  <span
                    key={t.name}
                    title={t.description || undefined}
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: "var(--space-6)",
                      fontFamily: T.fontBody,
                      fontSize: "var(--font-size-base)",
                      fontWeight: 500,
                      color: T.fg,
                    }}
                  >
                    <span
                      aria-hidden="true"
                      style={{
                        width: 8,
                        height: 8,
                        borderRadius: "50%",
                        background: "var(--accent-strong)",
                        flexShrink: 0,
                      }}
                    />
                    {t.name}
                  </span>
                ))}
            </div>
          )}
          {/* essence — sits below the traits inside the identity column.
              Clamped so long essences don't push the brain pill off-card. */}
          <p
            style={{
              fontFamily: T.fontBody,
              fontSize: "var(--font-size-md)",
              lineHeight: 1.5,
              color: T.muted,
              margin: 0,
              overflow: "hidden",
              display: "-webkit-box",
              WebkitLineClamp: 4,
              WebkitBoxOrient: "vertical",
              wordBreak: "break-word",
            }}
          >
            {essence}
          </p>
        </div>
      </div>

      {/* Slot strip — brain, wikis, voice. Each slot is a click-target
          that opens the matching sidebar tab. State (current model /
          wiki count / first tones) is rendered inline so the canvas
          tells the story without the sidebar open. */}
      <div style={{ display: "flex", gap: "var(--space-8)" }}>
        <CharacterSlot
          icon={<BrainGlyph />}
          label="brain"
          value={activeModel}
          tooltip={
            brainModel?.model
              ? "Active model"
              : `Default model (${DEFAULT_CHAT_MODEL})`
          }
          onClick={() => onSelectTab("brain")}
        />
        <CharacterSlot
          icon={<WikisGlyph />}
          label="wikis"
          value={
            bindings.length === 0 ? "none bound" : `${bindings.length} bound`
          }
          dim={bindings.length === 0}
          tooltip={
            bindings.length === 0
              ? "No knowledge graphs bound"
              : bindings.map((b) => b.wiki.title).join(" · ")
          }
          onClick={() => onSelectTab("knowledge")}
        />
        <CharacterSlot
          icon={<VoiceGlyph />}
          label="voice"
          value={
            boundVoice
              ? boundVoice.slug
              : voiceId
                ? "voice bound"
                : tones.length > 0
                  ? tones.slice(0, 2).join(" · ")
                  : "no voice bound"
          }
          dim={!boundVoice && !voiceId && tones.length === 0}
          tooltip={
            boundVoice
              ? `Bound to ${boundVoice.name} (${boundVoice.slug})${tones.length ? ` · ${tones.join(", ")}` : ""}`
              : voiceId
                ? "Voice bound (loading…)"
                : tones.length > 0
                  ? `No voice from library bound · tones: ${tones.join(", ")}`
                  : "No voice bound — audio-rt falls back to character slug"
          }
          onClick={() => onSelectTab("voice")}
        />
      </div>
    </div>
  );
}

/**
 * Slot on the character node that doubles as state-at-a-glance + sidebar
 * shortcut. Click opens the relevant sidebar tab (already opens because
 * the click bubbles up and selects the node via React Flow).
 */
function CharacterSlot({
  icon,
  label,
  value,
  tooltip,
  onClick,
  dim,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  tooltip?: string;
  onClick: () => void;
  dim?: boolean;
}) {
  const [hovered, setHovered] = useState(false);
  return (
    <button
      type="button"
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      title={tooltip}
      style={{
        flex: 1,
        minWidth: 0,
        display: "flex",
        alignItems: "center",
        gap: "var(--space-8)",
        padding: "8px 10px",
        border: `1px solid ${hovered ? "color-mix(in srgb, var(--accent-strong) 35%, var(--border))" : T.border}`,
        background: hovered
          ? "color-mix(in srgb, var(--accent-strong) 6%, var(--card-hover))"
          : "var(--card-hover)",
        cursor: "pointer",
        transition: "background 120ms ease, border-color 120ms ease",
        textAlign: "left",
      }}
    >
      <span style={{ flexShrink: 0, display: "inline-flex" }}>{icon}</span>
      <span
        style={{
          display: "flex",
          flexDirection: "column",
          gap: "var(--space-1)",
          minWidth: 0,
          flex: 1,
        }}
      >
        <span
          style={{
            fontFamily: T.fontMono,
            fontSize: "var(--font-size-2xs)",
            color: hovered ? T.accent : "var(--text-tertiary)",
            letterSpacing: "0.18em",
            textTransform: "uppercase",
            lineHeight: 1.2,
            transition: "color 120ms ease",
          }}
        >
          {label}
        </span>
        <span
          style={{
            fontFamily: T.fontMono,
            fontSize: "var(--font-size-sm)",
            color: dim ? "var(--text-quaternary)" : T.fg,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
            lineHeight: 1.3,
          }}
        >
          {value}
        </span>
      </span>
    </button>
  );
}

/* ── Editable thumbnail (sidebar header) ───────────────────────── */

/**
 * Sidebar avatar that surfaces the edit affordance on hover. Idle is the
 * normal gradient/image tile with the slug initial; hover dims the tile
 * and reveals a pencil glyph + mint focus ring. Click opens the edit
 * overlay via `onClick`.
 */
function EditableThumbnail({
  gradient,
  image,
  initial,
  onClick,
}: {
  gradient: string;
  image: string | null;
  initial: string;
  onClick: () => void;
}) {
  const [hovered, setHovered] = useState(false);
  const background = image
    ? `center/cover no-repeat url("${image}"), var(--card-hover)`
    : gradient;
  return (
    <button
      type="button"
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onFocus={() => setHovered(true)}
      onBlur={() => setHovered(false)}
      aria-label="Edit thumbnail"
      title="Edit thumbnail"
      style={{
        position: "relative",
        width: 48,
        height: 48,
        background,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        flexShrink: 0,
        padding: 0,
        borderRadius: "var(--radius-xl)",
        border:
          "1px solid color-mix(in srgb, var(--accent-strong) 18%, transparent)",
        cursor: "pointer",
        boxShadow: hovered
          ? "0 0 0 2px color-mix(in srgb, var(--accent-strong) 35%, transparent)"
          : "none",
        transition: "box-shadow 120ms ease",
        overflow: "hidden",
      }}
    >
      {!image && (
        <span
          style={{
            fontFamily: T.fontHeading,
            fontSize: "var(--font-size-3xl)",
            fontWeight: 600,
            color: hovered ? "rgba(12,14,20,0.32)" : "rgba(12,14,20,0.78)",
            lineHeight: 1,
            transition: "color 120ms ease",
            pointerEvents: "none",
          }}
        >
          {initial}
        </span>
      )}
      {hovered && (
        <span
          aria-hidden="true"
          style={{
            position: "absolute",
            inset: 0,
            background: "rgba(12,14,20,0.55)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            pointerEvents: "none",
          }}
        >
          <svg
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="#F2F4F8"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M12 20h9" />
            <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4z" />
          </svg>
        </span>
      )}
    </button>
  );
}

/* ── Right config sidebar ──────────────────────────────────────── */

function ConfigSidebar(props: {
  character: CharacterRecord;
  title: string;
  onTitleChange: (next: string) => void | Promise<void>;
  tab: TabKey;
  onTabChange: (t: TabKey) => void;
  savedAt: number;
  identity: CharacterIdentity | null;
  onIdentityChange: (i: CharacterIdentity | null) => void;
  voiceStyle: CharacterVoiceStyle | null;
  onVoiceStyleChange: (v: CharacterVoiceStyle | null) => void;
  brainModel: CharacterBrainModel | null;
  onBrainModelChange: (m: CharacterBrainModel | null) => void;
  directive: CharacterDirective | null;
  onDirectiveChange: (d: CharacterDirective | null) => void;
  bindings: ConfigBinding[];
  onBindingsChange: (b: ConfigBinding[]) => void;
  voiceId: string | null;
  voiceOptions: PickerVoice[];
  onVoiceIdChange: (next: string | null) => void;
  avGradient: string;
  image: string | null;
  initial: string;
  onEditThumbnail: () => void;
  chatModels: ModelOption[];
  voiceModels: ModelOption[];
  onOpenPreview: () => void;
}) {
  const tabs: Array<{ key: TabKey; label: string }> = [
    { key: "persona", label: "Persona" },
    { key: "brain", label: "Brain" },
    { key: "knowledge", label: "Knowledge" },
    { key: "voice", label: "Voice" },
    { key: "limits", label: "Limits" },
  ];

  /* ── Resizable width ──────────────────────────────────────────
   * 480px is the floor (the previous fixed width — anything narrower
   * starts clipping the section cards inside the tabs). Cap at 720px
   * so the sidebar can't crowd the canvas when the user drags out too
   * far. Width persists per browser via localStorage so reopening the
   * page keeps the user's preference. */
  const SIDEBAR_MIN_WIDTH = 480;
  const SIDEBAR_MAX_WIDTH = 720;
  const SIDEBAR_WIDTH_KEY = "character-config-sidebar-width";

  const [sidebarWidth, setSidebarWidth] = useState<number>(SIDEBAR_MIN_WIDTH);
  const [isResizing, setIsResizing] = useState(false);
  const sidebarRef = useRef<HTMLElement | null>(null);

  /* Restore saved width on mount. `useLayoutEffect` would avoid a
   * flash, but the sidebar starts at the min so the worst case is one
   * frame at the minimum width before expanding — acceptable. */
  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(SIDEBAR_WIDTH_KEY);
      if (saved) {
        const n = Number.parseInt(saved, 10);
        if (Number.isFinite(n)) {
          setSidebarWidth(Math.min(SIDEBAR_MAX_WIDTH, Math.max(SIDEBAR_MIN_WIDTH, n)));
        }
      }
    } catch {
      /* localStorage can throw in private modes; non-fatal. */
    }
  }, []);

  /* Drag handler. Captures the pointer so the drag survives the
   * cursor leaving the 6px handle. Computes new width from the
   * sidebar's *right* edge minus the pointer's clientX — the handle
   * is on the *left* edge, so dragging left grows the sidebar. */
  const onResizeStart = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      e.preventDefault();
      const aside = sidebarRef.current;
      if (!aside) return;
      const rect = aside.getBoundingClientRect();
      const rightEdge = rect.right;
      const target = e.currentTarget;
      target.setPointerCapture(e.pointerId);
      setIsResizing(true);

      const onMove = (ev: PointerEvent) => {
        const next = Math.min(
          SIDEBAR_MAX_WIDTH,
          Math.max(SIDEBAR_MIN_WIDTH, rightEdge - ev.clientX),
        );
        setSidebarWidth(next);
      };
      const onUp = (ev: PointerEvent) => {
        target.releasePointerCapture?.(ev.pointerId);
        target.removeEventListener("pointermove", onMove);
        target.removeEventListener("pointerup", onUp);
        target.removeEventListener("pointercancel", onUp);
        setIsResizing(false);
        try {
          /* Persist the final width — not every intermediate value, so
           * localStorage doesn't churn during the drag. */
          setSidebarWidth((w) => {
            window.localStorage.setItem(SIDEBAR_WIDTH_KEY, String(Math.round(w)));
            return w;
          });
        } catch {
          /* non-fatal */
        }
      };
      target.addEventListener("pointermove", onMove);
      target.addEventListener("pointerup", onUp);
      target.addEventListener("pointercancel", onUp);
    },
    [],
  );

  return (
    <aside
      ref={sidebarRef}
      style={{
        width: sidebarWidth,
        flexShrink: 0,
        position: "sticky",
        top: 0,
        alignSelf: "flex-start",
        // Admin shell's top header is 48px — sticky sidebar fits below it.
        height: "calc(100vh - 48px)",
        background: "rgba(255,255,255,0.02)",
        /* Softer subtle border that flips with the theme, matching the
         * card chrome on /voices and /characters. */
        borderLeft:
          "1px solid var(--ink-fill)",
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
        /* Disable width transitions during the drag so the bar follows
         * the cursor 1:1 — re-enable when idle so collapse/expand from
         * other code paths animates smoothly. */
        transition: isResizing ? "none" : "width 160ms ease",
      }}
    >
      {/* Resize handle on the left edge. 6px wide hit area, transparent
       * by default; the cursor + the accent-tinted highlight while
       * dragging tell the user what's happening. */}
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize sidebar"
        onPointerDown={onResizeStart}
        style={{
          position: "absolute",
          left: -3,
          top: 0,
          bottom: 0,
          width: 6,
          cursor: "ew-resize",
          background: isResizing
            ? "color-mix(in srgb, var(--accent-strong) 35%, transparent)"
            : "transparent",
          transition: isResizing ? "none" : "background 120ms ease",
          zIndex: 2,
          /* Touch action `none` prevents the browser from interpreting
           * a horizontal drag as a scroll gesture on touch devices. */
          touchAction: "none",
        }}
      />
      {/* sidebar header */}
      <div
        style={{
          padding: "20px 24px 0",
          display: "flex",
          alignItems: "flex-start",
          justifyContent: "space-between",
          gap: "var(--space-8)",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "var(--space-10)",
            minWidth: 0,
          }}
        >
          <EditableThumbnail
            gradient={props.avGradient}
            image={props.image}
            initial={props.initial}
            onClick={props.onEditThumbnail}
          />
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: "var(--space-1)",
              minWidth: 0,
            }}
          >
            <EditableText
              value={props.title}
              onChange={props.onTitleChange}
              ariaLabel="Character name"
              style={{
                fontFamily: T.fontHeading,
                fontSize: "var(--font-size-xl)",
                fontWeight: 600,
                color: T.fg,
                letterSpacing: "-0.01em",
              }}
            />
            <span
              style={{
                fontFamily: T.fontMono,
                fontSize: "var(--font-size-xs)",
                letterSpacing: "0.14em",
                textTransform: "uppercase",
                color: "var(--text-tertiary)",
              }}
            >
              auto-saved · {relative(new Date(props.savedAt).toISOString())}
            </span>
          </div>
        </div>
        <button
          type="button"
          aria-label="Sidebar options"
          style={{
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            width: 28,
            height: 28,
            borderRadius: "var(--radius-pill)",
            border:
              "1px solid color-mix(in srgb, var(--text-primary) 8%, transparent)",
            background: "transparent",
            color: "var(--text-tertiary)",
            cursor: "pointer",
            fontFamily: T.fontMono,
            fontSize: "var(--font-size-base)",
            lineHeight: 1,
            transition: "border-color 120ms ease, background 120ms ease",
          }}
        >
          ⋯
        </button>
      </div>

      {/* Tabs — terminal-segment style (shared `TabBar` primitive).
       * Taller bar (52px) flanked by full-bleed horizontal borders so
       * the row reads as a clear band between the header and the tab
       * content. Tabs offset 24px from the left edge to align with the
       * sidebar's gutter. */}
      <div
        style={{
          display: "flex",
          height: 34,
          marginTop: "var(--space-20)",
          paddingLeft: "var(--space-24)",
          borderTop:
            "1px solid var(--ink-fill)",
          borderBottom:
            "1px solid var(--ink-fill)",
        }}
      >
        <TabBar
          items={
            tabs.map((t) => ({
              key: t.key,
              label: t.label,
              onClick: () => props.onTabChange(t.key),
            })) as TabItem<TabKey>[]
          }
          active={props.tab}
        />
      </div>

      {/* tab content (scroll) */}
      <div
        style={{
          flex: 1,
          minHeight: 0,
          overflow: "auto",
          padding: "20px 24px 140px",
          display: "flex",
          flexDirection: "column",
          gap: 28,
        }}
      >
        {props.tab === "persona" && (
          <PersonaTab
            characterId={props.character.id}
            identity={props.identity}
            onIdentityChange={props.onIdentityChange}
            directive={props.directive}
            onDirectiveChange={props.onDirectiveChange}
          />
        )}
        {props.tab === "brain" && (
          <BrainTab
            characterId={props.character.id}
            brainModel={props.brainModel}
            onBrainModelChange={props.onBrainModelChange}
            chatModels={props.chatModels}
            voiceModels={props.voiceModels}
            identity={props.identity}
            voiceStyle={props.voiceStyle}
            directive={props.directive}
          />
        )}
        {props.tab === "knowledge" && (
          <KnowledgeTab
            characterId={props.character.id}
            bindings={props.bindings}
            onBindingsChange={props.onBindingsChange}
          />
        )}
        {props.tab === "voice" && (
          <VoiceTab
            characterId={props.character.id}
            voiceStyle={props.voiceStyle}
            onVoiceStyleChange={props.onVoiceStyleChange}
            voiceId={props.voiceId}
            voiceOptions={props.voiceOptions}
            onVoiceIdChange={props.onVoiceIdChange}
            initialVoiceSettings={props.character.voiceSettings}
          />
        )}
        {props.tab === "limits" && (
          <LimitsTab
            characterId={props.character.id}
            directive={props.directive}
            onDirectiveChange={props.onDirectiveChange}
          />
        )}
      </div>

      {/* system prompt footer */}
      <SystemPromptFooter
        identity={props.identity}
        voiceStyle={props.voiceStyle}
        directive={props.directive}
        onOpenPreview={props.onOpenPreview}
      />
    </aside>
  );
}

/* ── Sidebar Section primitives ────────────────────────────────── */

/**
 * Content rendered inside a section's info popover. Authored once per
 * section (see SECTION_INFO below) and rendered on click of the `i` icon.
 */
type SectionInfo = {
  /** Token budget hint shown top-right of the card. e.g. "~95 tokens". */
  tokens?: string;
  /** Short paragraph under "what it is". */
  what: string;
  /** Pre-formatted block showing how the section lands in the prompt. */
  promptShape?: string;
  /** Trailing caption inside the card. */
  footer?: string;
};

function Section({
  title,
  hint,
  status,
  info,
  children,
}: {
  title: string;
  hint?: string;
  status?: "set" | "tuned" | "empty";
  info?: SectionInfo;
  children: React.ReactNode;
}) {
  return (
    <section style={{ display: "flex", flexDirection: "column", gap: "var(--space-12)" }}>
      <SectionHeader title={title} hint={hint} status={status} info={info} />
      <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-10)" }}>
        {children}
      </div>
    </section>
  );
}

function SectionHeader({
  title,
  hint,
  status,
  info,
}: {
  title: string;
  hint?: string;
  status?: "set" | "tuned" | "empty";
  info?: SectionInfo;
}) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // Click-outside dismiss so the card behaves like a popover. The card is
  // rendered inside this container, so any click inside is treated as
  // intentional (button toggle or close button).
  useEffect(() => {
    if (!open) return;
    function onDocClick(e: MouseEvent) {
      if (!containerRef.current) return;
      if (containerRef.current.contains(e.target as Node)) return;
      setOpen(false);
    }
    function onEsc(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onEsc);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onEsc);
    };
  }, [open]);

  return (
    <div ref={containerRef} style={{ position: "relative" }}>
      <div
        style={{
          display: "flex",
          alignItems: "baseline",
          justifyContent: "space-between",
          gap: "var(--space-8)",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "baseline",
            gap: "var(--space-8)",
            minWidth: 0,
          }}
        >
          <h3
            style={{
              fontFamily: T.fontHeading,
              fontSize: "var(--font-size-2xl)",
              fontWeight: 600,
              color: T.fg,
              margin: 0,
              letterSpacing: "-0.01em",
            }}
          >
            {title}
          </h3>
          {info && (
            <button
              type="button"
              aria-expanded={open}
              aria-label={`About ${title}`}
              onClick={() => setOpen((v) => !v)}
              style={{
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                width: 16,
                height: 16,
                border: `1px solid ${open ? T.accent : T.border}`,
                borderRadius: "var(--radius-pill)",
                background: open ? T.accentSoft : "transparent",
                color: open ? T.accent : "var(--text-tertiary)",
                fontFamily: T.fontMono,
                fontSize: "var(--font-size-xs)",
                cursor: "pointer",
                flexShrink: 0,
                padding: 0,
                lineHeight: 1,
              }}
            >
              i
            </button>
          )}
          {hint && !info && (
            <span
              style={{
                fontFamily: T.fontMono,
                fontSize: "var(--font-size-xs)",
                letterSpacing: "0.14em",
                textTransform: "uppercase",
                color: "var(--text-tertiary)",
              }}
            >
              {hint}
            </span>
          )}
        </div>
        {status && <StatusDot status={status} />}
      </div>
      {info && open && (
        <InfoCard title={title} info={info} onClose={() => setOpen(false)} />
      )}
    </div>
  );
}

function InfoCard({
  title,
  info,
  onClose,
}: {
  title: string;
  info: SectionInfo;
  onClose: () => void;
}) {
  return (
    <div
      data-info-card
      role="dialog"
      style={{
        position: "absolute",
        top: "calc(100% + 8px)",
        left: 0,
        right: 0,
        zIndex: 20,
        backgroundColor: "var(--background)",
        backgroundImage: "none",
        border: `1px solid ${T.border}`,
        borderRadius: "var(--radius-2xl)",
        padding: "14px 16px 12px",
        boxShadow: "0 16px 40px var(--shadow, rgba(0,0,0,0.40))",
        display: "flex",
        flexDirection: "column",
        gap: "var(--space-12)",
        fontFamily: T.fontBody,
        color: T.fg,
      }}
    >
      {/* Card header */}
      <div
        style={{
          display: "flex",
          alignItems: "baseline",
          justifyContent: "space-between",
          gap: "var(--space-8)",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "baseline",
            gap: "var(--space-8)",
            minWidth: 0,
          }}
        >
          <span
            style={{
              fontFamily: T.fontHeading,
              fontSize: 15,
              fontWeight: 600,
              color: T.fg,
            }}
          >
            {title}
          </span>
          <span
            style={{
              fontFamily: T.fontMono,
              fontSize: "var(--font-size-xs)",
              color: T.muted,
              letterSpacing: "0.04em",
            }}
          >
            section info
          </span>
        </div>
        {info.tokens && (
          <span
            style={{ fontFamily: T.fontMono, fontSize: "var(--font-size-xs)", color: T.muted }}
          >
            {info.tokens}
          </span>
        )}
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-6)" }}>
        <span
          style={{
            fontFamily: T.fontMono,
            fontSize: "var(--font-size-2xs)",
            color: T.muted,
            letterSpacing: "0.08em",
            textTransform: "uppercase",
          }}
        >
          what it is
        </span>
        <p
          style={{
            margin: 0,
            fontFamily: T.fontBody,
            fontSize: "var(--font-size-base)",
            lineHeight: 1.55,
            color: T.fg,
          }}
        >
          {info.what}
        </p>
      </div>

      {info.promptShape && (
        <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-6)" }}>
          <span
            style={{
              fontFamily: T.fontMono,
              fontSize: "var(--font-size-2xs)",
              color: T.muted,
              letterSpacing: "0.08em",
              textTransform: "uppercase",
            }}
          >
            how it lands in the system prompt
          </span>
          <pre
            style={{
              margin: 0,
              padding: "10px 12px",
              background: "var(--background)",
              border: `1px solid var(--border)`,
              borderRadius: "var(--radius-md)",
              fontFamily: T.fontMono,
              fontSize: "var(--font-size-sm)",
              lineHeight: 1.5,
              color: "var(--foreground)",
              whiteSpace: "pre-wrap",
              overflowX: "auto",
            }}
          >
            {info.promptShape}
          </pre>
        </div>
      )}

      {info.footer && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: "var(--space-8)",
            paddingTop: "var(--space-4)",
            borderTop: `1px solid ${T.border}`,
            marginTop: "var(--space-2)",
          }}
        >
          <span
            style={{
              fontFamily: T.fontMono,
              fontSize: "var(--font-size-xs)",
              color: T.muted,
              letterSpacing: "0.02em",
              lineHeight: 1.4,
            }}
          >
            {info.footer}
          </span>
          <button
            type="button"
            onClick={onClose}
            style={{
              border: "none",
              background: "transparent",
              color: T.muted,
              fontFamily: T.fontMono,
              fontSize: "var(--font-size-xs)",
              cursor: "pointer",
              padding: 0,
            }}
          >
            close
          </button>
        </div>
      )}
    </div>
  );
}

/* ── Section info content (one entry per sidebar section) ──────── */

const SECTION_INFO: Record<string, SectionInfo> = {
  identity: {
    tokens: "~95 tokens",
    what: "The character's foundational essence — a one-line sentence plus up to two defining traits with personal interpretations. Every other section's output is shaped by this anchor.",
    promptShape:
      "You are abraham:\n  An aged patriarch wandering Canaan,\n  weathered by promise and doubt.\n  Core traits:\n  — faith: A persistent trust in a calling\n    he can't fully understand.\n  — weariness, doubt …",
    footer: "always at the top of the prompt · never trimmed",
  },
  examples: {
    tokens: "~280 tokens (caps at 8)",
    what: 'Q→A pairs you\'ve saved as canonical "how this character speaks" demonstrations. Examples are the strongest steering signal — concrete patterns the model imitates.',
    promptShape:
      "<example>\n  <user>Why did you leave Ur?</user>\n  <you>A voice called. I trusted it\n    before I understood it.</you>\n  <tags>faith under doubt, covenant</tags>\n</example>",
    footer: "tags feed the topics covered line at the top of the prompt",
  },
  voiceStyle: {
    tokens: "~35 tokens · + audio",
    what: "Four orthogonal axes that shape cadence and register (tone, brevity, formality, warmth), plus an optional reference clip that drives the voice synthesizer (TTS) directly.",
    promptShape:
      "Speak in this register:\n  warm · weathered · brief · 2nd-person\n\n// audio clip is routed separately to the TTS",
    footer: "axes feed the LLM · reference clip bypasses it and feeds TTS",
  },
  model: {
    what: "Which model runs this character. Different models trade quality for latency — voice turns are latency-sensitive, chat turns aren't. The chat route picks the provider automatically from the model id.",
    footer: "switching the model doesn't change the prompt — only the brain",
  },
  generation: {
    what: "Sampling parameters for the inference call. Temperature controls how predictable the model is; top-p narrows the candidate set; max output caps reply length. These pass to the API, not into the prompt.",
    promptShape:
      "// passed to the API call, not the prompt:\n//   temperature: 0.70\n//   top_p:        0.95\n//   max_tokens:   1024",
    footer: "doesn't compile to prompt text — affects how the model samples",
  },
  budget: {
    what: "Soft cap on the cached system envelope. When sections grow past the cap, lower-priority content (Examples, then Limits) is trimmed automatically; Identity is never trimmed.",
    footer: "auto-trim keeps the cache warm by avoiding cold rewrites",
  },
  voiceOverride: {
    what: "An optional latency-tuned model used for voice turns only. Voice mode is sensitive to time-to-first-token — a fast Cerebras open-weights model often beats Sonnet's quality at a fraction of the TTFT.",
    footer: "voice turns use this · chat turns use the model above",
  },
  knowledge: {
    what: "Wikis this character is bound to. Each wiki holds authored pages + sources and derives a knowledge graph of their connections. Multiple wikis can be attached with priorities — primary is searched first, references are background context. Wiki edits propagate to every character bound to the same wiki.",
    promptShape:
      '// retrieved per-turn, not statically compiled:\n//   <facts source="genesis-11-25">…</facts>\n//   <facts source="abrahamic-geography">…</facts>',
    footer: "facts are retrieved per turn, not part of the cached envelope",
  },
  topicRefusals: {
    what: "Topics the character will steer away from rather than engage with. The runtime asks the character to deflect gracefully in their own voice — they don't break character to refuse.",
    promptShape:
      "<scope>\n  refuse: post-death events, modern politics\n</scope>",
    footer: "soft-decline at runtime · stays in character",
  },
  hardRules: {
    what: 'Inviolable behaviors enforced every turn. Phrased as "Do not …" — negative instructions land harder than positive framing for in-character adherence (Araujo et al. 2025).',
    promptShape:
      "<never>\n  - Do not break character\n  - Do not describe events after his death\n  - Do not use modern English idioms\n</never>",
    footer: "always emitted · checked every turn",
  },
  stageManager: {
    what: "Meta-behavior between turns: how to handle pushback on refused topics, hostile users, and low-confidence moments. Lands in the next pass once the runtime supports it.",
    footer: "coming soon",
  },
};

function StatusDot({ status }: { status: "set" | "tuned" | "empty" }) {
  const isOn = status === "set" || status === "tuned";
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: "var(--space-6)",
        fontFamily: T.fontMono,
        fontSize: "var(--font-size-2xs)",
        color: isOn ? T.accent : "var(--text-tertiary)",
        letterSpacing: "0.18em",
        textTransform: "uppercase",
      }}
    >
      <span
        style={{
          width: 6,
          height: 6,
          borderRadius: "50%",
          background: isOn ? T.accent : "var(--text-quaternary)",
          boxShadow: isOn ? `0 0 8px ${T.accent}` : undefined,
        }}
      />
      {status}
    </span>
  );
}

/* ── Persona Tab ───────────────────────────────────────────────── */

function PersonaTab({
  characterId,
  identity,
  onIdentityChange,
  directive,
  onDirectiveChange,
}: {
  characterId: string;
  identity: CharacterIdentity | null;
  onIdentityChange: (i: CharacterIdentity | null) => void;
  directive: CharacterDirective | null;
  onDirectiveChange: (d: CharacterDirective | null) => void;
}) {
  return (
    <>
      <IdentitySection
        characterId={characterId}
        identity={identity}
        onChange={onIdentityChange}
      />
      <ExamplesSection
        characterId={characterId}
        directive={directive}
        onChange={onDirectiveChange}
      />
    </>
  );
}

function VoiceTab({
  characterId,
  voiceStyle,
  onVoiceStyleChange,
  voiceId,
  voiceOptions,
  onVoiceIdChange,
  initialVoiceSettings,
}: {
  characterId: string;
  voiceStyle: CharacterVoiceStyle | null;
  onVoiceStyleChange: (v: CharacterVoiceStyle | null) => void;
  voiceId: string | null;
  voiceOptions: PickerVoice[];
  onVoiceIdChange: (next: string | null) => void;
  initialVoiceSettings: VoiceSettingsOverride | null;
}) {
  return (
    <>
      <VoiceStyleSection
        characterId={characterId}
        voiceStyle={voiceStyle}
        onChange={onVoiceStyleChange}
        voiceId={voiceId}
        voiceOptions={voiceOptions}
        onVoiceIdChange={onVoiceIdChange}
        initialVoiceSettings={initialVoiceSettings}
      />
    </>
  );
}

function IdentitySection({
  characterId,
  identity,
  onChange,
}: {
  characterId: string;
  identity: CharacterIdentity | null;
  onChange: (i: CharacterIdentity | null) => void;
}) {
  const persist = useDebouncedSave(async (next: CharacterIdentity) => {
    await fetch(`/api/characters/${characterId}/identity`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ identity: next }),
    });
  });

  const essence = identity?.essence ?? "";
  const traits = identity?.traits ?? [];
  const [addOpen, setAddOpen] = useState(false);

  const save = useCallback(
    (next: CharacterIdentity) => {
      onChange(next);
      persist(next);
    },
    [onChange, persist],
  );

  const status = essence || traits.length > 0 ? "set" : "empty";

  return (
    <Section
      title="Identity"
      hint="the line the model reads first"
      status={status}
      info={SECTION_INFO.identity}
    >
      <FieldLabel>in one sentence</FieldLabel>
      <textarea
        value={essence}
        onChange={(e) => save({ ...(identity ?? {}), essence: e.target.value })}
        placeholder="An aged patriarch wandering Canaan, weathered by promise and doubt."
        rows={2}
        maxLength={140}
        style={textareaStyle}
      />

      <FieldLabel>defining traits</FieldLabel>
      <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-8)" }}>
        {traits.map((t, i) => (
          <TraitCard
            key={i}
            trait={t}
            onChange={(next) => {
              const arr = [...traits];
              arr[i] = next;
              save({ ...(identity ?? {}), traits: arr });
            }}
            onRemove={() => {
              const arr = traits.filter((_, idx) => idx !== i);
              save({ ...(identity ?? {}), traits: arr });
            }}
          />
        ))}
        {traits.length < 2 && (
          <button
            type="button"
            onClick={() => setAddOpen(true)}
            style={addButtonStyle}
          >
            + add a trait
          </button>
        )}
        {traits.length === 2 && (
          <span
            style={{
              fontFamily: T.fontMono,
              fontSize: "var(--font-size-xs)",
              color: T.muted,
              letterSpacing: "0.02em",
            }}
          >
            two-trait cap · authoring research caps fidelity past two
          </span>
        )}
      </div>

      {addOpen && (
        <AddTraitOverlay
          savedCount={traits.length}
          existingNames={new Set(traits.map((t) => t.name.toLowerCase()))}
          onCancel={() => setAddOpen(false)}
          onSave={(trait) => {
            save({ ...(identity ?? {}), traits: [...traits, trait] });
            setAddOpen(false);
          }}
        />
      )}
    </Section>
  );
}

/**
 * Modal for adding a defining trait. Suggests a small curated pool, lets
 * the author write their own name + description, and validates against
 * duplicates. Enter saves when valid; Esc cancels.
 */
const SUGGESTED_TRAITS: ReadonlyArray<{ name: string; description: string }> = [
  {
    name: "patience",
    description: "Holds tension without resolving it; waits the long arc out.",
  },
  {
    name: "hospitality",
    description:
      "Opens the door first; treats strangers as the test of character.",
  },
  {
    name: "restlessness",
    description: "Cannot stay; keeps moving toward the thing not yet visible.",
  },
  {
    name: "reverence",
    description:
      "Defers to what's older or larger; speaks with measured weight.",
  },
  {
    name: "stubbornness",
    description:
      "Plants and won't be moved, even when persuasion would be easier.",
  },
  {
    name: "melancholy",
    description: "Carries old griefs into present conversations.",
  },
  {
    name: "vulnerability",
    description: "Lets the soft part show; does not perform invulnerability.",
  },
  {
    name: "conviction",
    description: "Will name the thing they believe even when it costs them.",
  },
  {
    name: "grief",
    description: "Loss is close to the surface; shapes the rhythm of speech.",
  },
  {
    name: "wonder",
    description: "Sees the ordinary as still new; asks instead of declaring.",
  },
];

function AddTraitOverlay({
  savedCount,
  existingNames,
  onCancel,
  onSave,
}: {
  savedCount: number;
  existingNames: Set<string>;
  onCancel: () => void;
  onSave: (trait: IdentityTrait) => void;
}) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const nameRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    nameRef.current?.focus();
  }, []);

  const trimmedName = name.trim();
  const trimmedDesc = description.trim();
  const isDuplicate =
    trimmedName.length > 0 && existingNames.has(trimmedName.toLowerCase());
  const canSave = trimmedName.length > 0 && !isDuplicate;

  const commit = useCallback(() => {
    if (!canSave) return;
    onSave({ name: trimmedName, description: trimmedDesc });
  }, [canSave, trimmedName, trimmedDesc, onSave]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        onCancel();
      }
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onCancel]);

  function pickSuggestion(s: { name: string; description: string }) {
    if (existingNames.has(s.name.toLowerCase())) return;
    setName(s.name);
    setDescription(s.description);
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      onClick={onCancel}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 100,
        background: "color-mix(in srgb, var(--background) 70%, transparent)",
        backdropFilter: "blur(4px)",
        display: "flex",
        alignItems: "safe center",
        justifyContent: "center",
        padding: "24px",
        overflow: "auto",
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "100%",
          maxWidth: 480,
          backgroundColor: "var(--background)",
          backgroundImage: "none",
          border: `1px solid ${T.border}`,
          borderRadius: "var(--radius-3xl)",
          boxShadow: "0 24px 60px var(--shadow, rgba(0,0,0,0.40))",
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
        }}
      >
        {/* Header */}
        <div
          style={{
            padding: "18px 20px 14px",
            display: "flex",
            alignItems: "flex-start",
            justifyContent: "space-between",
            gap: "var(--space-12)",
          }}
        >
          <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-6)" }}>
            <span
              style={{
                fontFamily: T.fontMono,
                fontSize: "var(--font-size-sm)",
                letterSpacing: "0.18em",
                textTransform: "uppercase",
                color: T.accent,
              }}
            >
              add a trait
            </span>
            <span
              style={{
                fontFamily: T.fontHeading,
                fontSize: "var(--font-size-xl)",
                fontWeight: 600,
                letterSpacing: "-0.01em",
                color: T.fg,
              }}
            >
              two traits is usually enough · {savedCount} saved
            </span>
          </div>
          <button
            type="button"
            onClick={onCancel}
            aria-label="Close"
            style={{
              width: 22,
              height: 22,
              border: "none",
              background: "transparent",
              color: T.muted,
              cursor: "pointer",
              fontSize: "var(--font-size-2xl)",
              lineHeight: 1,
              padding: 0,
            }}
          >
            ×
          </button>
        </div>

        {/* Suggestions */}
        <div
          style={{
            padding: "0 20px 14px",
            display: "flex",
            flexDirection: "column",
            gap: "var(--space-8)",
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "baseline",
              justifyContent: "space-between",
              gap: "var(--space-8)",
            }}
          >
            <span
              style={{
                fontFamily: T.fontMono,
                fontSize: "var(--font-size-xs)",
                color: T.muted,
                letterSpacing: "0.04em",
              }}
            >
              suggested
            </span>
            <span
              style={{
                fontFamily: T.fontMono,
                fontSize: "var(--font-size-2xs)",
                color: T.muted,
                opacity: 0.7,
              }}
            >
              curated · generic
            </span>
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: "var(--space-6)" }}>
            {SUGGESTED_TRAITS.map((s) => {
              const taken = existingNames.has(s.name.toLowerCase());
              const selected =
                trimmedName.toLowerCase() === s.name.toLowerCase();
              return (
                <button
                  key={s.name}
                  type="button"
                  disabled={taken}
                  onClick={() => pickSuggestion(s)}
                  title={taken ? "already added" : s.description}
                  style={{
                    padding: "5px 11px",
                    border: `1px solid ${selected ? T.accent : T.border}`,
                    borderRadius: "var(--radius-pill)",
                    background: selected ? T.accentSoft : "transparent",
                    color: selected ? T.accent : T.fg,
                    fontFamily: T.fontMono,
                    fontSize: "var(--font-size-sm)",
                    cursor: taken ? "not-allowed" : "pointer",
                    opacity: taken ? 0.4 : 1,
                  }}
                >
                  {s.name}
                </button>
              );
            })}
          </div>
        </div>

        {/* Or write your own */}
        <div
          style={{
            padding: "12px 20px 14px",
            borderTop: `1px solid ${T.border}`,
            display: "flex",
            flexDirection: "column",
            gap: "var(--space-10)",
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "baseline",
              justifyContent: "space-between",
              gap: "var(--space-8)",
            }}
          >
            <span
              style={{
                fontFamily: T.fontMono,
                fontSize: "var(--font-size-xs)",
                color: T.muted,
                letterSpacing: "0.04em",
              }}
            >
              or write your own
            </span>
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-4)" }}>
            <FieldLabel>name</FieldLabel>
            <input
              ref={nameRef}
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && canSave) {
                  e.preventDefault();
                  commit();
                }
              }}
              maxLength={24}
              placeholder="e.g. tenderness"
              style={inputStyle}
            />
            {isDuplicate && (
              <span
                style={{
                  fontFamily: T.fontMono,
                  fontSize: "var(--font-size-xs)",
                  color: T.danger,
                }}
              >
                already added — pick a different name
              </span>
            )}
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-4)" }}>
            <FieldLabel>describe</FieldLabel>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && canSave) {
                  e.preventDefault();
                  commit();
                }
              }}
              placeholder="a one-line interpretation of how this trait shows up in their speech…"
              rows={2}
              maxLength={280}
              style={{ ...textareaStyle, fontSize: "var(--font-size-base)" }}
            />
          </div>
        </div>

        {/* Footer */}
        <div
          style={{
            padding: "12px 20px 14px",
            borderTop: `1px solid ${T.border}`,
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: "var(--space-12)",
          }}
        >
          <span
            style={{
              fontFamily: T.fontMono,
              fontSize: "var(--font-size-xs)",
              color: T.muted,
              letterSpacing: "0.04em",
            }}
          >
            <KeyChip>↵</KeyChip> saves · <KeyChip>esc</KeyChip> cancels
          </span>
          <div style={{ display: "flex", gap: "var(--space-8)" }}>
            <button
              type="button"
              onClick={onCancel}
              style={{
                padding: "7px 16px",
                border: `1px solid ${T.border}`,
                borderRadius: "var(--radius-pill)",
                background: "transparent",
                color: T.fg,
                fontFamily: T.fontHeading,
                fontSize: "var(--font-size-base)",
                fontWeight: 500,
                cursor: "pointer",
              }}
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={commit}
              disabled={!canSave}
              style={{
                padding: "7px 18px",
                border: `1px solid ${canSave ? T.accent : "var(--border)"}`,
                borderRadius: "var(--radius-pill)",
                background: canSave ? T.accent : "var(--card-hover)",
                color: canSave ? "var(--background)" : "var(--text-tertiary)",
                fontFamily: T.fontHeading,
                fontSize: "var(--font-size-base)",
                fontWeight: 600,
                cursor: canSave ? "pointer" : "not-allowed",
              }}
            >
              Save trait
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function TraitCard({
  trait,
  onChange,
  onRemove,
}: {
  trait: IdentityTrait;
  onChange: (next: IdentityTrait) => void;
  onRemove: () => void;
}) {
  const [editing, setEditing] = useState(!trait.name);
  if (editing || !trait.name) {
    return (
      <div
        style={{
          ...cardShell,
          padding: "var(--space-12)",
          display: "flex",
          flexDirection: "column",
          gap: "var(--space-8)",
        }}
      >
        <input
          autoFocus
          value={trait.name}
          onChange={(e) => onChange({ ...trait, name: e.target.value })}
          placeholder="trait name (e.g. faith)"
          maxLength={24}
          style={inputStyle}
        />
        <textarea
          value={trait.description}
          onChange={(e) => onChange({ ...trait, description: e.target.value })}
          placeholder="one-sentence justification"
          rows={2}
          maxLength={280}
          style={{ ...textareaStyle, fontSize: "var(--font-size-base)" }}
        />
        <div style={{ display: "flex", justifyContent: "flex-end", gap: "var(--space-8)" }}>
          <button type="button" onClick={onRemove} style={ghostButtonStyle}>
            remove
          </button>
          <button
            type="button"
            onClick={() => setEditing(false)}
            style={primaryButtonStyle}
            disabled={!trait.name}
          >
            done
          </button>
        </div>
      </div>
    );
  }
  return (
    <div
      style={{
        ...cardShell,
        padding: "12px 14px",
        display: "flex",
        flexDirection: "column",
        gap: "var(--space-4)",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
        }}
      >
        <span
          style={{
            fontFamily: T.fontHeading,
            fontSize: "var(--font-size-lg)",
            fontWeight: 600,
            color: T.fg,
            display: "flex",
            alignItems: "center",
            gap: "var(--space-6)",
          }}
        >
          {trait.name}
          <span
            style={{
              width: 6,
              height: 6,
              borderRadius: "50%",
              background: T.accent,
              opacity: 0.6,
            }}
          />
        </span>
        <button
          type="button"
          onClick={() => setEditing(true)}
          style={editLinkStyle}
        >
          edit ✏︎
        </button>
      </div>
      {trait.description && (
        <span
          style={{
            fontFamily: T.fontBody,
            fontSize: "var(--font-size-base)",
            color: T.muted,
            lineHeight: 1.5,
          }}
        >
          {trait.description}
        </span>
      )}
    </div>
  );
}

type Exemplar = {
  user: string;
  you: string;
  tags?: string[];
  rationale?: string;
};

const EXEMPLAR_CAP = 8;

function ExamplesSection({
  characterId,
  directive,
  onChange,
}: {
  characterId: string;
  directive: CharacterDirective | null;
  onChange: (d: CharacterDirective | null) => void;
}) {
  const persist = useDebouncedSave(async (next: CharacterDirective) => {
    await fetch(`/api/characters/${characterId}/directive`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ directive: next }),
    });
  });

  const exemplars: Exemplar[] = directive?.exemplars ?? [];

  // Editor target: `null` = closed. `{ index: null }` = add new.
  // `{ index: number }` = edit the exemplar at that position.
  const [editorTarget, setEditorTarget] = useState<{
    index: number | null;
  } | null>(null);

  const save = useCallback(
    (next: Exemplar[]) => {
      const directiveNext: CharacterDirective = {
        ...(directive ?? {}),
        exemplars: next,
      };
      onChange(directiveNext);
      persist(directiveNext);
    },
    [directive, onChange, persist],
  );

  const status = exemplars.length > 0 ? "set" : "empty";
  const atCap = exemplars.length >= EXEMPLAR_CAP;

  // Tag suggestions: every tag already in use across this character's
  // examples. Lets authors converge on a shared vocabulary instead of each
  // example inventing its own scope name.
  const tagSuggestions = useMemo(() => {
    const set = new Set<string>();
    for (const e of exemplars) {
      for (const t of e.tags ?? []) {
        const v = t.trim();
        if (v) set.add(v);
      }
    }
    return Array.from(set).sort();
  }, [exemplars]);

  return (
    <Section
      title="Examples"
      hint="Q→A pairs that teach voice and scope"
      status={status}
      info={SECTION_INFO.examples}
    >
      <FieldLabel>
        example exchanges · {exemplars.length} saved
        {atCap ? ` · cap ${EXEMPLAR_CAP}` : ""}
      </FieldLabel>

      <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-8)" }}>
        {exemplars.map((ex, i) => (
          <ExemplarCard
            key={i}
            exemplar={ex}
            onEdit={() => setEditorTarget({ index: i })}
            onRemove={() => save(exemplars.filter((_, idx) => idx !== i))}
          />
        ))}

        {!atCap && (
          <button
            type="button"
            onClick={() => setEditorTarget({ index: null })}
            style={addButtonStyle}
          >
            + Add an example
          </button>
        )}
        {atCap && (
          <span
            style={{
              fontFamily: T.fontMono,
              fontSize: "var(--font-size-xs)",
              color: T.muted,
              lineHeight: 1.5,
            }}
          >
            {EXEMPLAR_CAP}-example cap · authoring research shows fidelity drops
            past this point. Remove one to add another.
          </span>
        )}
      </div>

      {editorTarget && (
        <ExampleOverlay
          initial={
            editorTarget.index === null
              ? { user: "", you: "", tags: [], rationale: "" }
              : exemplars[editorTarget.index]
          }
          isEdit={editorTarget.index !== null}
          tagSuggestions={tagSuggestions}
          onCancel={() => setEditorTarget(null)}
          onSave={(next) => {
            if (editorTarget.index === null) {
              save([...exemplars, next]);
            } else {
              const arr = exemplars.slice();
              arr[editorTarget.index] = next;
              save(arr);
            }
            setEditorTarget(null);
          }}
        />
      )}
    </Section>
  );
}

function ExemplarCard({
  exemplar,
  onEdit,
  onRemove,
}: {
  exemplar: Exemplar;
  onEdit: () => void;
  onRemove: () => void;
}) {
  return (
    <div
      style={{
        ...cardShell,
        padding: "12px 14px",
        display: "flex",
        flexDirection: "column",
        gap: "var(--space-6)",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "flex-start",
          justifyContent: "space-between",
          gap: "var(--space-8)",
        }}
      >
        <span
          style={{
            fontFamily: T.fontBody,
            fontSize: "var(--font-size-base)",
            fontWeight: 500,
            color: T.fg,
            lineHeight: 1.5,
          }}
        >
          &ldquo;{exemplar.user}&rdquo;
        </span>
        <div style={{ display: "flex", gap: "var(--space-8)", flexShrink: 0 }}>
          <button type="button" onClick={onEdit} style={editLinkStyle}>
            edit ✏︎
          </button>
          <button
            type="button"
            onClick={onRemove}
            style={editLinkStyle}
            aria-label="Remove example"
          >
            ×
          </button>
        </div>
      </div>
      <span
        style={{
          fontFamily: T.fontBody,
          fontSize: "var(--font-size-base)",
          color: T.muted,
          lineHeight: 1.5,
        }}
      >
        {exemplar.you}
      </span>
      {(exemplar.tags?.length ?? 0) > 0 && (
        <div
          style={{ display: "flex", flexWrap: "wrap", gap: "var(--space-4)", marginTop: "var(--space-2)" }}
        >
          {exemplar.tags!.map((t) => (
            <span
              key={t}
              style={{
                padding: "3px 8px",
                background: T.accentSoft,
                border:
                  "1px solid var(--accent-border)",
                fontFamily: T.fontMono,
                fontSize: "var(--font-size-xs)",
                letterSpacing: "0.10em",
                textTransform: "uppercase",
                color: T.accent,
              }}
            >
              {t}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * Modal editor for a single example. Used for both add (when isEdit=false)
 * and edit (when isEdit=true). Saves on Cmd/Ctrl+Enter; Esc cancels.
 */
function ExampleOverlay({
  initial,
  isEdit,
  tagSuggestions,
  onCancel,
  onSave,
}: {
  initial: Exemplar;
  isEdit: boolean;
  tagSuggestions: string[];
  onCancel: () => void;
  onSave: (next: Exemplar) => void;
}) {
  const [user, setUser] = useState(initial.user);
  const [you, setYou] = useState(initial.you);
  const [rationale, setRationale] = useState(initial.rationale ?? "");
  const [tags, setTags] = useState<string[]>(initial.tags ?? []);
  const [draftTag, setDraftTag] = useState("");

  const promptRef = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    promptRef.current?.focus();
  }, []);

  const canSave = user.trim().length > 0 && you.trim().length > 0;

  const commit = useCallback(() => {
    if (!canSave) return;
    const next: Exemplar = {
      user: user.trim(),
      you: you.trim(),
    };
    const cleanTags = tags.map((t) => t.trim()).filter(Boolean);
    if (cleanTags.length > 0) next.tags = cleanTags;
    const r = rationale.trim();
    if (r) next.rationale = r;
    onSave(next);
  }, [canSave, user, you, rationale, tags, onSave]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        onCancel();
      } else if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
        e.preventDefault();
        if (canSave) commit();
      }
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [canSave, commit, onCancel]);

  const addTag = (raw: string) => {
    const v = raw.trim();
    if (!v || tags.some((t) => t.toLowerCase() === v.toLowerCase())) return;
    setTags([...tags, v]);
  };

  const unusedSuggestion = tagSuggestions.find(
    (s) => !tags.some((t) => t.toLowerCase() === s.toLowerCase()),
  );

  return (
    <div
      role="dialog"
      aria-modal="true"
      onClick={onCancel}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 100,
        background: "color-mix(in srgb, var(--background) 70%, transparent)",
        backdropFilter: "blur(4px)",
        display: "flex",
        alignItems: "safe center",
        justifyContent: "center",
        padding: "24px",
        overflow: "auto",
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "100%",
          maxWidth: 560,
          backgroundColor: "var(--background)",
          backgroundImage: "none",
          border: `1px solid ${T.border}`,
          borderRadius: "var(--radius-3xl)",
          boxShadow: "0 24px 60px var(--shadow, rgba(0,0,0,0.40))",
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
        }}
      >
        {/* Header */}
        <div
          style={{
            padding: "18px 20px 14px",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: "var(--space-12)",
          }}
        >
          <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-6)" }}>
            <span
              style={{
                fontFamily: T.fontMono,
                fontSize: "var(--font-size-sm)",
                letterSpacing: "0.18em",
                textTransform: "uppercase",
                color: T.accent,
              }}
            >
              {isEdit ? "edit example" : "new example"}
            </span>
            <span
              style={{
                fontFamily: T.fontHeading,
                fontSize: "var(--font-size-xl)",
                fontWeight: 600,
                letterSpacing: "-0.01em",
                color: T.fg,
              }}
            >
              {isEdit ? "Edit example" : "Add an example"}
            </span>
          </div>
          <button
            type="button"
            onClick={onCancel}
            aria-label="Close"
            style={{
              width: 22,
              height: 22,
              border: "none",
              background: "transparent",
              color: T.muted,
              cursor: "pointer",
              fontSize: "var(--font-size-2xl)",
              lineHeight: 1,
              padding: 0,
            }}
          >
            ×
          </button>
        </div>

        {/* Fields */}
        <div
          style={{
            padding: "0 20px 14px",
            display: "flex",
            flexDirection: "column",
            gap: "var(--space-14)",
          }}
        >
          <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-6)" }}>
            <div
              style={{
                display: "flex",
                alignItems: "baseline",
                justifyContent: "space-between",
              }}
            >
              <span
                style={{
                  fontFamily: T.fontMono,
                  fontSize: "var(--font-size-xs)",
                  color: T.muted,
                  letterSpacing: "0.04em",
                }}
              >
                <strong style={{ color: T.fg, fontWeight: 600 }}>prompt</strong>{" "}
                &nbsp;what the user asked
              </span>
              <span
                style={{
                  fontFamily: T.fontMono,
                  fontSize: "var(--font-size-2xs)",
                  color: T.muted,
                  opacity: 0.7,
                }}
              >
                editable
              </span>
            </div>
            <textarea
              ref={promptRef}
              value={user}
              onChange={(e) => setUser(e.target.value)}
              placeholder='e.g. "How did you know it was God?"'
              rows={2}
              style={{ ...textareaStyle, fontSize: "var(--font-size-md)" }}
            />
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-6)" }}>
            <div
              style={{
                display: "flex",
                alignItems: "baseline",
                justifyContent: "space-between",
              }}
            >
              <span
                style={{
                  fontFamily: T.fontMono,
                  fontSize: "var(--font-size-xs)",
                  color: T.muted,
                  letterSpacing: "0.04em",
                }}
              >
                <strong style={{ color: T.fg, fontWeight: 600 }}>
                  response
                </strong>{" "}
                &nbsp;what they said
              </span>
              <span
                style={{
                  fontFamily: T.fontMono,
                  fontSize: "var(--font-size-2xs)",
                  color: T.muted,
                  opacity: 0.7,
                }}
              >
                editable
              </span>
            </div>
            <textarea
              value={you}
              onChange={(e) => setYou(e.target.value)}
              placeholder="I didn't. I went anyway."
              rows={3}
              style={{ ...textareaStyle, fontSize: "var(--font-size-md)" }}
            />
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-6)" }}>
            <span
              style={{
                fontFamily: T.fontMono,
                fontSize: "var(--font-size-xs)",
                color: T.muted,
                letterSpacing: "0.04em",
              }}
            >
              <strong style={{ color: T.fg, fontWeight: 600 }}>
                why this works
              </strong>{" "}
              &nbsp;optional · helps the model pattern-match
            </span>
            <textarea
              value={rationale}
              onChange={(e) => setRationale(e.target.value)}
              placeholder="Refuses to claim certainty. Owns the ambiguity instead of explaining it away."
              rows={2}
              maxLength={400}
              style={{ ...textareaStyle, fontSize: "var(--font-size-base)" }}
            />
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-6)" }}>
            <span
              style={{
                fontFamily: T.fontMono,
                fontSize: "var(--font-size-xs)",
                color: T.muted,
                letterSpacing: "0.04em",
              }}
            >
              <strong style={{ color: T.fg, fontWeight: 600 }}>tags</strong>{" "}
              &nbsp;topics this example covers · feeds the character&rsquo;s
              scope at runtime
            </span>
            <div style={{ display: "flex", flexWrap: "wrap", gap: "var(--space-6)" }}>
              {tags.map((t) => (
                <span
                  key={t}
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: "var(--space-6)",
                    padding: "3px 10px",
                    background: T.accentSoft,
                    border:
                      "1px solid var(--accent-border)",
                    fontFamily: T.fontMono,
                    fontSize: "var(--font-size-xs)",
                    letterSpacing: "0.10em",
                    textTransform: "uppercase",
                    color: T.accent,
                  }}
                >
                  {t}
                  <button
                    type="button"
                    onClick={() => setTags(tags.filter((x) => x !== t))}
                    aria-label={`Remove ${t}`}
                    style={{
                      border: "none",
                      background: "transparent",
                      color: T.accent,
                      cursor: "pointer",
                      fontFamily: T.fontMono,
                      fontSize: "var(--font-size-xs)",
                      padding: 0,
                    }}
                  >
                    ×
                  </button>
                </span>
              ))}
              <input
                value={draftTag}
                onChange={(e) => setDraftTag(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && draftTag.trim()) {
                    e.preventDefault();
                    addTag(draftTag);
                    setDraftTag("");
                  }
                }}
                placeholder="+ add"
                style={{
                  ...inputStyle,
                  width: 100,
                  padding: "3px 8px",
                  fontSize: "var(--font-size-sm)",
                }}
              />
              {unusedSuggestion && draftTag.length === 0 && (
                <span
                  style={{
                    fontFamily: T.fontMono,
                    fontSize: "var(--font-size-xs)",
                    color: T.muted,
                    alignSelf: "center",
                  }}
                >
                  suggested:&nbsp;
                  <button
                    type="button"
                    onClick={() => addTag(unusedSuggestion)}
                    style={{
                      border: "none",
                      background: "transparent",
                      color: T.fg,
                      fontFamily: T.fontMono,
                      fontSize: "var(--font-size-xs)",
                      cursor: "pointer",
                      padding: 0,
                      textDecoration: "underline",
                      textUnderlineOffset: 2,
                    }}
                  >
                    {unusedSuggestion}
                  </button>
                </span>
              )}
            </div>
          </div>
        </div>

        {/* Footer */}
        <div
          style={{
            padding: "12px 20px 14px",
            borderTop: `1px solid ${T.border}`,
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: "var(--space-12)",
          }}
        >
          <span
            style={{
              fontFamily: T.fontMono,
              fontSize: "var(--font-size-xs)",
              color: T.muted,
              letterSpacing: "0.04em",
            }}
          >
            <KeyChip>⌘ ↵</KeyChip> saves · <KeyChip>esc</KeyChip> cancels
          </span>
          <div style={{ display: "flex", gap: "var(--space-8)" }}>
            <button
              type="button"
              onClick={onCancel}
              style={{
                padding: "7px 16px",
                border: `1px solid ${T.border}`,
                borderRadius: "var(--radius-pill)",
                background: "transparent",
                color: T.fg,
                fontFamily: T.fontHeading,
                fontSize: "var(--font-size-base)",
                fontWeight: 500,
                cursor: "pointer",
              }}
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={commit}
              disabled={!canSave}
              style={{
                padding: "7px 18px",
                border: `1px solid ${canSave ? T.accent : "var(--border)"}`,
                borderRadius: "var(--radius-pill)",
                background: canSave ? T.accent : "var(--card-hover)",
                color: canSave ? "var(--background)" : "var(--text-tertiary)",
                fontFamily: T.fontHeading,
                fontSize: "var(--font-size-base)",
                fontWeight: 600,
                cursor: canSave ? "pointer" : "not-allowed",
              }}
            >
              {isEdit ? "Save example" : "Add example"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ── Voice & Style ─────────────────────────────────────────────── */

const BREVITY_VALUES = [
  "terse",
  "short",
  "medium",
  "long",
  "paragraph",
] as const;
const BREVITY_LABELS: Record<(typeof BREVITY_VALUES)[number], string> = {
  terse: "terse",
  short: "short",
  medium: "medium",
  long: "long",
  paragraph: "paragraph+",
};

function VoiceStyleSection({
  characterId,
  voiceStyle,
  onChange,
  voiceId,
  voiceOptions,
  onVoiceIdChange,
  initialVoiceSettings,
}: {
  characterId: string;
  voiceStyle: CharacterVoiceStyle | null;
  onChange: (v: CharacterVoiceStyle | null) => void;
  voiceId: string | null;
  voiceOptions: PickerVoice[];
  onVoiceIdChange: (next: string | null) => void;
  initialVoiceSettings: VoiceSettingsOverride | null;
}) {
  const [draftTone, setDraftTone] = useState("");
  const [draftProsody, setDraftProsody] = useState("");
  const [voiceSettings, setVoiceSettings] = useState<VoiceSettingsOverride | null>(
    initialVoiceSettings,
  );

  const saveVoiceSettings = useCallback(
    async (next: VoiceSettingsOverride | null) => {
      setVoiceSettings(next);
      await updateCharacterVoiceSettings(characterId, next);
    },
    [characterId],
  );

  const persist = useDebouncedSave(async (next: CharacterVoiceStyle) => {
    await fetch(`/api/characters/${characterId}/voice-style`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ voiceStyle: next }),
    });
  });

  const [voiceError, setVoiceError] = useState<string | null>(null);

  const saveVoiceId = useCallback(
    async (next: string | null) => {
      const prev = voiceId;
      onVoiceIdChange(next);
      setVoiceError(null);
      const res = await fetch(`/api/characters/${characterId}/voice`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ voiceId: next }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setVoiceError(body.error ?? `HTTP ${res.status}`);
        onVoiceIdChange(prev);
      }
    },
    [characterId, voiceId, onVoiceIdChange],
  );

  const save = useCallback(
    (next: CharacterVoiceStyle) => {
      onChange(next);
      persist(next);
    },
    [onChange, persist],
  );

  const tones = voiceStyle?.tone ?? [];
  const prosody = voiceStyle?.prosody ?? [];
  const brevity = voiceStyle?.brevity ?? "short";
  const formality = voiceStyle?.register?.formality ?? 0;
  const warmth = voiceStyle?.register?.warmth ?? 0;
  const decision = voiceStyle?.decision ?? "";
  const referenceClipUrl = voiceStyle?.referenceClipUrl ?? "";

  const bound = voiceId
    ? voiceOptions.find((v) => v.id === voiceId) ?? null
    : null;

  const ttsStatus: SegmentStatus = bound
    ? { tone: "active", label: "ready" }
    : { tone: "muted", label: "unbound" };

  const promptHasContent =
    tones.length > 0 ||
    prosody.length > 0 ||
    !!decision.trim() ||
    formality !== 0 ||
    warmth !== 0;
  const promptStatus: SegmentStatus = promptHasContent
    ? { tone: "active", label: "set" }
    : { tone: "muted", label: "empty" };

  return (
    <section style={{ display: "flex", flexDirection: "column", gap: 22 }}>
      {/* ── Segment B · TTS ────────────────────────────────────────── */}
      <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-12)" }}>
        <SegmentHeader
          label="tts"
          hint="what comes out of the speaker"
          status={ttsStatus}
        />

        <VoiceLibraryPicker
          currentVoiceId={voiceId}
          voices={voiceOptions}
          onChange={saveVoiceId}
        />
        {voiceError && (
          <div
            style={{
              padding: "8px 10px",
              background:
                "var(--critical-wash)",
              border:
                "1px solid var(--critical-border)",
              color: "var(--status-error)",
              fontFamily: T.fontMono,
              fontSize: "var(--font-size-sm)",
            }}
          >
            {voiceError}
          </div>
        )}

        {bound && bound.provider === "elevenlabs" && (
          <ElevenLabsOverridePanel
            base={bound.providerConfig ?? {}}
            value={voiceSettings}
            onChange={saveVoiceSettings}
          />
        )}
        {bound && bound.provider && bound.provider !== "elevenlabs" && (
          <InheritsNote provider={bound.provider} />
        )}

        <FieldLabel>voice prompt</FieldLabel>
        <textarea
          value={voiceStyle?.voicePrompt ?? ""}
          onChange={(e) =>
            save({ ...(voiceStyle ?? {}), voicePrompt: e.target.value })
          }
          placeholder="older man, weathered by long travel; unhurried cadence; soft consonants"
          rows={4}
          style={{ ...textareaStyle, minHeight: 96 }}
        />

        <FieldLabel>prosody · {prosody.length} chips</FieldLabel>
        <div style={{ display: "flex", flexWrap: "wrap", gap: "var(--space-6)" }}>
          {prosody.map((p) => (
            <span
              key={p}
              style={prosodyChipStyle}
            >
              {p}
              <button
                type="button"
                onClick={() =>
                  save({
                    ...(voiceStyle ?? {}),
                    prosody: prosody.filter((x) => x !== p),
                  })
                }
                style={chipRemoveButtonStyle}
                aria-label={`Remove ${p}`}
              >
                ×
              </button>
            </span>
          ))}
          {prosody.length < 6 && (
            <input
              value={draftProsody}
              onChange={(e) => setDraftProsody(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && draftProsody.trim()) {
                  e.preventDefault();
                  const next = [...prosody, draftProsody.trim()].slice(0, 6);
                  save({ ...(voiceStyle ?? {}), prosody: next });
                  setDraftProsody("");
                }
              }}
              placeholder="+ add (Enter)"
              style={addChipInputStyle}
            />
          )}
        </div>

        <FieldLabel>reference clip · voice cloning</FieldLabel>
        <input
          type="url"
          value={referenceClipUrl}
          onChange={(e) =>
            save({
              ...(voiceStyle ?? {}),
              referenceClipUrl: e.target.value,
            })
          }
          placeholder="paste a URL to an audio sample"
          style={inputStyle}
        />
      </div>

      <SegmentDivider />

      {/* ── Segment A · Prompt-driven ─────────────────────────────── */}
      <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-12)" }}>
        <SegmentHeader
          label="prompt-driven"
          hint="what the model reads"
          status={promptStatus}
        />

        <FieldLabel>how they sound · {tones.length} chips</FieldLabel>
        <div style={{ display: "flex", flexWrap: "wrap", gap: "var(--space-6)" }}>
          {tones.map((t) => (
            <span
              key={t}
              style={{
                padding: "4px 10px",
                borderRadius: "var(--radius-pill)",
                background: T.accentSoft,
                border:
                  "1px solid var(--accent-border)",
                fontFamily: T.fontMono,
                fontSize: "var(--font-size-xs)",
                letterSpacing: "0.10em",
                textTransform: "uppercase",
                color: T.accent,
                display: "inline-flex",
                alignItems: "center",
                gap: "var(--space-6)",
                lineHeight: 1.2,
              }}
            >
              {t}
              <button
                type="button"
                onClick={() =>
                  save({
                    ...(voiceStyle ?? {}),
                    tone: tones.filter((x) => x !== t),
                  })
                }
                style={{
                  border: "none",
                  background: "transparent",
                  color: T.accent,
                  cursor: "pointer",
                  fontFamily: T.fontMono,
                  fontSize: "var(--font-size-xs)",
                  padding: 0,
                }}
                aria-label={`Remove ${t}`}
              >
                ×
              </button>
            </span>
          ))}
          {tones.length < 4 && (
            <input
              value={draftTone}
              onChange={(e) => setDraftTone(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && draftTone.trim()) {
                  e.preventDefault();
                  const next = [...tones, draftTone.trim()].slice(0, 4);
                  save({ ...(voiceStyle ?? {}), tone: next });
                  setDraftTone("");
                }
              }}
              placeholder="+ add (Enter)"
              style={addChipInputStyle}
            />
          )}
        </div>

        <FieldLabel>brevity</FieldLabel>
        <div style={{ display: "flex", gap: "var(--space-4)" }}>
          {BREVITY_VALUES.map((v) => {
            const active = brevity === v;
            return (
              <button
                key={v}
                type="button"
                onClick={() => save({ ...(voiceStyle ?? {}), brevity: v })}
                style={{
                  flex: 1,
                  padding: "6px 8px",
                  border: `1px solid ${active ? T.accent : T.border}`,
                  borderRadius: "var(--radius-pill)",
                  background: active ? T.accentSoft : "transparent",
                  color: active ? T.accent : "var(--text-tertiary)",
                  fontFamily: T.fontMono,
                  fontSize: "var(--font-size-xs)",
                  letterSpacing: "0.14em",
                  textTransform: "uppercase",
                  cursor: "pointer",
                }}
              >
                {BREVITY_LABELS[v]}
              </button>
            );
          })}
        </div>

        <FieldLabel>
          register · formality {fmtSigned(formality)} · warmth {fmtSigned(warmth)}
        </FieldLabel>
        <Slider
          label="formality"
          rightLabel={
            formality < 0 ? "casual" : formality > 0 ? "formal" : "neutral"
          }
          min={-1}
          max={1}
          step={0.1}
          value={formality}
          onChange={(v) =>
            save({ ...(voiceStyle ?? {}), register: { formality: v, warmth } })
          }
        />
        <Slider
          label="warmth"
          rightLabel={warmth < 0 ? "cool" : warmth > 0 ? "warm" : "neutral"}
          min={-1}
          max={1}
          step={0.1}
          value={warmth}
          onChange={(v) =>
            save({ ...(voiceStyle ?? {}), register: { formality, warmth: v } })
          }
        />

        <FieldLabel>decision style · impulsive ↔ paralyzed</FieldLabel>
        <input
          type="text"
          value={decision}
          onChange={(e) =>
            save({ ...(voiceStyle ?? {}), decision: e.target.value })
          }
          placeholder="deliberate · invokes precedent"
          style={inputStyle}
        />
      </div>
    </section>
  );
}

type SegmentStatus = {
  tone: "active" | "muted";
  label: string;
};

function SegmentHeader({
  label,
  hint,
  status,
}: {
  label: string;
  hint: string;
  status: SegmentStatus;
}) {
  const active = status.tone === "active";
  return (
    <div
      style={{
        display: "flex",
        alignItems: "baseline",
        justifyContent: "space-between",
        gap: "var(--space-8)",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "baseline",
          gap: "var(--space-10)",
          minWidth: 0,
        }}
      >
        <span
          style={{
            width: 5,
            height: 5,
            borderRadius: "50%",
            background: T.accent,
            boxShadow: `0 0 6px ${T.accent}`,
            transform: "translateY(-2px)",
            flexShrink: 0,
          }}
        />
        <span
          style={{
            fontFamily: T.fontMono,
            fontSize: "var(--font-size-xs)",
            fontWeight: 600,
            letterSpacing: "0.20em",
            textTransform: "uppercase",
            color: T.accent,
          }}
        >
          {label}
        </span>
        <span
          style={{
            fontFamily: T.fontBody,
            fontSize: "var(--font-size-base)",
            color: "var(--text-tertiary)",
          }}
        >
          {hint}
        </span>
      </div>
      <span
        style={{
          fontFamily: T.fontMono,
          fontSize: "var(--font-size-2xs)",
          fontWeight: 500,
          letterSpacing: "0.14em",
          textTransform: "uppercase",
          color: active ? T.accent : "var(--text-tertiary)",
        }}
      >
        {status.label}
      </span>
    </div>
  );
}

function SegmentDivider() {
  return (
    <div
      style={{
        height: 1,
        background:
          "linear-gradient(to right, transparent 0%, rgba(255,255,255,0.06) 8%, rgba(255,255,255,0.06) 92%, transparent 100%)",
      }}
    />
  );
}

function InheritsNote({ provider }: { provider: string }) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: "var(--space-10)",
        padding: "10px 14px",
        borderRadius: "var(--radius-lg)",
        background: "rgba(255,255,255,0.02)",
        border: `1px solid ${T.border}`,
      }}
    >
      <span
        aria-hidden
        style={{
          fontFamily: T.fontMono,
          fontSize: "var(--font-size-base)",
          color: T.muted,
          flexShrink: 0,
        }}
      >
        ⓘ
      </span>
      <span
        style={{
          fontFamily: T.fontBody,
          fontSize: "var(--font-size-base)",
          color: "var(--text-tertiary)",
          lineHeight: 1.5,
        }}
      >
        This voice uses{" "}
        <span style={{ fontFamily: T.fontMono, color: T.fg }}>{provider}</span>{" "}
        — runtime tuning is baked into the voice.{" "}
        <span style={{ color: "var(--text-quaternary)" }}>
          No per-character overrides.
        </span>
      </span>
    </div>
  );
}

const addChipInputStyle: React.CSSProperties = {
  width: 130,
  padding: "4px 10px",
  borderRadius: "var(--radius-pill)",
  border: `1px solid ${T.border}`,
  background: "transparent",
  color: T.fg,
  fontFamily: T.fontMono,
  fontSize: "var(--font-size-xs)",
  letterSpacing: "0.06em",
  lineHeight: 1.2,
  outline: "none",
};

const prosodyChipStyle: React.CSSProperties = {
  padding: "4px 10px",
  borderRadius: "var(--radius-pill)",
  background: "rgba(255,255,255,0.02)",
  border: `1px solid ${T.border}`,
  fontFamily: T.fontMono,
  fontSize: "var(--font-size-xs)",
  letterSpacing: "0.06em",
  color: "var(--text-primary)",
  display: "inline-flex",
  alignItems: "center",
  gap: "var(--space-6)",
  lineHeight: 1.2,
};

const chipRemoveButtonStyle: React.CSSProperties = {
  border: "none",
  background: "transparent",
  color: T.muted,
  cursor: "pointer",
  fontFamily: T.fontMono,
  fontSize: "var(--font-size-xs)",
  padding: 0,
};

function fmtSigned(n: number): string {
  if (n === 0) return "0.0";
  return (n > 0 ? "+" : "") + n.toFixed(1);
}

/* ── ElevenLabs override panel ────────────────────────────────────
 *
 * Renders only when the character's bound voice is an ElevenLabs voice.
 * Lets the user override the voice row's runtime tuning per-character,
 * so one voice can power multiple characters with different feels (e.g.
 * the same Calliope voice, but a stoic character pins low style/high
 * stability while an emotive one cranks both). Saves to
 * characters.voice_settings via the updateCharacterVoiceSettings action;
 * the engine resolver in audio.ts overlays this on top of providerConfig
 * at synth time, leaving voiceId untouched.
 */

const ELEVENLABS_MODEL_OPTIONS = [
  "eleven_multilingual_v2",
  "eleven_turbo_v2_5",
  "eleven_flash_v2_5",
  "eleven_monolingual_v1",
] as const;

type ElevenLabsOverrideField =
  | "modelId"
  | "stability"
  | "similarityBoost"
  | "style"
  | "speakerBoost";

function ElevenLabsOverridePanel({
  base,
  value,
  onChange,
}: {
  base: Record<string, unknown>;
  value: VoiceSettingsOverride | null;
  onChange: (next: VoiceSettingsOverride | null) => void | Promise<void>;
}) {
  // Narrow the override to the ElevenLabs branch; treat any mismatched
  // shape as "no overrides yet" so a stale Cartesia override after a
  // re-bind to ElevenLabs doesn't blow up the panel.
  const eleven =
    value && value.provider === "elevenlabs"
      ? (value as Extract<VoiceSettingsOverride, { provider: "elevenlabs" }>)
      : null;

  const baseModelId =
    typeof base.modelId === "string" ? base.modelId : "eleven_multilingual_v2";
  const baseStability = typeof base.stability === "number" ? base.stability : 0.5;
  const baseSimilarity =
    typeof base.similarityBoost === "number" ? base.similarityBoost : 0.75;
  const baseStyle = typeof base.style === "number" ? base.style : 0;
  const baseSpeakerBoost =
    typeof base.speakerBoost === "boolean" ? base.speakerBoost : true;

  function patch(
    field: ElevenLabsOverrideField,
    fieldValue: number | string | boolean | undefined,
  ) {
    const next = { provider: "elevenlabs" as const, ...(eleven ?? {}) };
    if (fieldValue === undefined) {
      delete (next as Record<string, unknown>)[field];
    } else {
      (next as Record<string, unknown>)[field] = fieldValue;
    }
    // If every override field has been cleared, drop the whole row to null
    // so the character cleanly inherits the voice defaults again.
    const hasAnyOverride =
      next.modelId !== undefined ||
      next.stability !== undefined ||
      next.similarityBoost !== undefined ||
      next.style !== undefined ||
      next.speakerBoost !== undefined;
    void onChange(hasAnyOverride ? next : null);
  }

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: "var(--space-10)",
        padding: "var(--space-14)",
        background: "color-mix(in srgb, var(--accent-strong) 4%, transparent)",
        border:
          "1px solid color-mix(in srgb, var(--accent-strong) 18%, transparent)",
        borderRadius: "var(--radius-lg)",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
        }}
      >
        <span
          style={{
            fontFamily: T.fontMono,
            fontSize: "var(--font-size-xs)",
            letterSpacing: "0.14em",
            textTransform: "uppercase",
            color: "var(--accent-strong)",
          }}
        >
          ElevenLabs overrides
        </span>
        {eleven && (
          <button
            type="button"
            onClick={() => void onChange(null)}
            style={{
              border: "none",
              background: "transparent",
              color: "var(--text-tertiary)",
              fontFamily: T.fontMono,
              fontSize: "var(--font-size-xs)",
              letterSpacing: "0.06em",
              cursor: "pointer",
            }}
          >
            reset all
          </button>
        )}
      </div>

      <OverrideRowDropdown
        label="model"
        baseValue={baseModelId}
        overrideValue={eleven?.modelId}
        options={ELEVENLABS_MODEL_OPTIONS as unknown as string[]}
        onSet={(v) => patch("modelId", v)}
        onClear={() => patch("modelId", undefined)}
      />
      <OverrideRowSlider
        label="stability"
        baseValue={baseStability}
        overrideValue={eleven?.stability}
        min={0}
        max={1}
        step={0.05}
        onSet={(v) => patch("stability", v)}
        onClear={() => patch("stability", undefined)}
      />
      <OverrideRowSlider
        label="similarity boost"
        baseValue={baseSimilarity}
        overrideValue={eleven?.similarityBoost}
        min={0}
        max={1}
        step={0.05}
        onSet={(v) => patch("similarityBoost", v)}
        onClear={() => patch("similarityBoost", undefined)}
      />
      <OverrideRowSlider
        label="style"
        baseValue={baseStyle}
        overrideValue={eleven?.style}
        min={0}
        max={1}
        step={0.05}
        onSet={(v) => patch("style", v)}
        onClear={() => patch("style", undefined)}
      />
      <OverrideRowToggle
        label="speaker boost"
        hint="enhance similarity to the source clip"
        baseValue={baseSpeakerBoost}
        overrideValue={eleven?.speakerBoost}
        onSet={(v) => patch("speakerBoost", v)}
        onClear={() => patch("speakerBoost", undefined)}
      />
    </div>
  );
}

function OverrideRowToggle({
  label,
  hint,
  baseValue,
  overrideValue,
  onSet,
  onClear,
}: {
  label: string;
  hint?: string;
  baseValue: boolean;
  overrideValue: boolean | undefined;
  onSet: (v: boolean) => void;
  onClear: () => void;
}) {
  const customized = overrideValue !== undefined;
  const effective = overrideValue ?? baseValue;
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: "var(--space-12)",
        paddingTop: "var(--space-4)",
      }}
    >
      <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-2)", minWidth: 0 }}>
        <span
          style={{
            fontFamily: T.fontMono,
            fontSize: "var(--font-size-xs)",
            letterSpacing: "0.06em",
            color: customized ? "var(--text-primary)" : "var(--text-tertiary)",
          }}
        >
          {label}
        </span>
        {hint && (
          <span
            style={{
              fontFamily: T.fontBody,
              fontSize: "var(--font-size-sm)",
              color: "var(--text-tertiary)",
            }}
          >
            {hint}
          </span>
        )}
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: "var(--space-10)" }}>
        {customized ? (
          <button
            type="button"
            onClick={onClear}
            style={{
              border: "none",
              background: "transparent",
              color: "var(--text-tertiary)",
              fontFamily: T.fontMono,
              fontSize: "var(--font-size-xs)",
              cursor: "pointer",
            }}
          >
            reset · inherits {baseValue ? "on" : "off"}
          </button>
        ) : (
          <button
            type="button"
            onClick={() => onSet(!baseValue)}
            style={{
              border: "none",
              background: "transparent",
              color: "var(--accent-strong)",
              fontFamily: T.fontMono,
              fontSize: "var(--font-size-xs)",
              cursor: "pointer",
            }}
          >
            customize · inherits {baseValue ? "on" : "off"}
          </button>
        )}
        <Toggle on={effective} onChange={onSet} />
      </div>
    </div>
  );
}

function OverrideRowSlider({
  label,
  baseValue,
  overrideValue,
  min,
  max,
  step,
  onSet,
  onClear,
}: {
  label: string;
  baseValue: number;
  overrideValue: number | undefined;
  min: number;
  max: number;
  step: number;
  onSet: (v: number) => void;
  onClear: () => void;
}) {
  const customized = overrideValue !== undefined;
  const effective = overrideValue ?? baseValue;
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: "var(--space-6)",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "baseline",
          justifyContent: "space-between",
          gap: "var(--space-8)",
        }}
      >
        <span
          style={{
            fontFamily: T.fontMono,
            fontSize: "var(--font-size-xs)",
            letterSpacing: "0.06em",
            color: customized ? "var(--text-primary)" : "var(--text-tertiary)",
          }}
        >
          {label}
        </span>
        <div
          style={{
            display: "flex",
            alignItems: "baseline",
            gap: "var(--space-10)",
            fontFamily: T.fontMono,
            fontSize: "var(--font-size-xs)",
          }}
        >
          <span
            style={{
              color: customized ? "var(--accent-strong)" : "var(--text-tertiary)",
            }}
          >
            {customized ? `customized · ${effective.toFixed(2)}` : `inherits · ${baseValue.toFixed(2)}`}
          </span>
          {customized ? (
            <button
              type="button"
              onClick={onClear}
              style={{
                border: "none",
                background: "transparent",
                color: "var(--text-tertiary)",
                fontFamily: T.fontMono,
                fontSize: "var(--font-size-xs)",
                cursor: "pointer",
              }}
            >
              reset
            </button>
          ) : (
            <button
              type="button"
              onClick={() => onSet(baseValue)}
              style={{
                border: "none",
                background: "transparent",
                color: "var(--accent-strong)",
                fontFamily: T.fontMono,
                fontSize: "var(--font-size-xs)",
                cursor: "pointer",
              }}
            >
              customize
            </button>
          )}
        </div>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={effective}
        disabled={!customized}
        onChange={(e) => onSet(parseFloat(e.target.value))}
        style={{
          width: "100%",
          accentColor: "var(--accent-strong)",
          opacity: customized ? 1 : 0.45,
        }}
      />
    </div>
  );
}

function OverrideRowDropdown({
  label,
  baseValue,
  overrideValue,
  options,
  onSet,
  onClear,
}: {
  label: string;
  baseValue: string;
  overrideValue: string | undefined;
  options: string[];
  onSet: (v: string) => void;
  onClear: () => void;
}) {
  const customized = overrideValue !== undefined;
  const effective = overrideValue ?? baseValue;
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: "var(--space-6)",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "baseline",
          justifyContent: "space-between",
          gap: "var(--space-8)",
        }}
      >
        <span
          style={{
            fontFamily: T.fontMono,
            fontSize: "var(--font-size-xs)",
            letterSpacing: "0.06em",
            color: customized ? "var(--text-primary)" : "var(--text-tertiary)",
          }}
        >
          {label}
        </span>
        {customized ? (
          <button
            type="button"
            onClick={onClear}
            style={{
              border: "none",
              background: "transparent",
              color: "var(--text-tertiary)",
              fontFamily: T.fontMono,
              fontSize: "var(--font-size-xs)",
              cursor: "pointer",
            }}
          >
            reset · inherits {baseValue}
          </button>
        ) : (
          <button
            type="button"
            onClick={() => onSet(baseValue)}
            style={{
              border: "none",
              background: "transparent",
              color: "var(--accent-strong)",
              fontFamily: T.fontMono,
              fontSize: "var(--font-size-xs)",
              cursor: "pointer",
            }}
          >
            customize · inherits {baseValue}
          </button>
        )}
      </div>
      {customized && (
        <Menu
          value={effective}
          onChange={onSet}
          items={options.map((opt) => ({ value: opt, label: opt }))}
          ariaLabel={label}
          triggerStyle={{
            width: "100%",
            justifyContent: "space-between",
            padding: "8px 10px",
            background: "var(--input-bg)",
            border: "1px solid var(--input-border)",
            borderRadius: "var(--radius-sm)",
            color: "var(--text-primary)",
            fontFamily: T.fontMono,
            fontSize: "var(--font-size-base)",
          }}
        />
      )}
    </div>
  );
}

function Slider({
  label,
  rightLabel,
  min,
  max,
  step,
  value,
  onChange,
}: {
  label: string;
  rightLabel: string;
  min: number;
  max: number;
  step: number;
  value: number;
  onChange: (v: number) => void;
}) {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: "var(--space-6)",
        padding: "10px 12px",
        background: T.panel,
        border: `1px solid ${T.border}`,
        borderRadius: "var(--radius-lg)",
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "baseline",
        }}
      >
        <span
          style={{
            fontFamily: T.fontMono,
            fontSize: "var(--font-size-xs)",
            color: T.muted,
            letterSpacing: "0.04em",
          }}
        >
          {label}
        </span>
        <span style={{ fontFamily: T.fontMono, fontSize: "var(--font-size-xs)", color: T.muted }}>
          {rightLabel}
        </span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        style={{ width: "100%", accentColor: T.accent }}
      />
    </div>
  );
}

/* ── Mind Tab ──────────────────────────────────────────────────── */

function BrainTab({
  characterId,
  brainModel,
  onBrainModelChange,
  chatModels,
  voiceModels,
  identity,
  voiceStyle,
  directive,
}: {
  characterId: string;
  brainModel: CharacterBrainModel | null;
  onBrainModelChange: (m: CharacterBrainModel | null) => void;
  chatModels: ModelOption[];
  voiceModels: ModelOption[];
  identity: CharacterIdentity | null;
  voiceStyle: CharacterVoiceStyle | null;
  directive: CharacterDirective | null;
}) {
  const persist = useDebouncedSave(async (next: CharacterBrainModel) => {
    await fetch(`/api/characters/${characterId}/brain-model`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ brainModel: next }),
    });
  });

  const save = useCallback(
    (next: CharacterBrainModel) => {
      onBrainModelChange(next);
      persist(next);
    },
    [onBrainModelChange, persist],
  );

  const currentModelId = brainModel?.model ?? chatModels[0]?.id ?? "";
  const currentModel = chatModels.find((m) => m.id === currentModelId);

  return (
    <>
      <Section
        title="Model"
        hint="the brain running this character"
        status={currentModel ? "set" : "empty"}
        info={SECTION_INFO.model}
      >
        {currentModel ? (
          <ModelCard model={currentModel} />
        ) : (
          <EmptyHint>No model picked.</EmptyHint>
        )}
        <ModelPicker
          models={chatModels}
          value={currentModelId}
          onChange={(id) =>
            save({
              ...(brainModel ?? {}),
              model: id,
              provider: chatModels.find((m) => m.id === id)?.provider,
            })
          }
        />
      </Section>

      <Section
        title="Generation"
        hint="how the model samples"
        status="tuned"
        info={SECTION_INFO.generation}
      >
        <Slider
          label="temperature"
          rightLabel={(brainModel?.temperature ?? 0.7).toFixed(2)}
          min={0}
          max={2}
          step={0.05}
          value={brainModel?.temperature ?? 0.7}
          onChange={(v) => save({ ...(brainModel ?? {}), temperature: v })}
        />
        <Slider
          label="top-p"
          rightLabel={(brainModel?.topP ?? 0.95).toFixed(2)}
          min={0}
          max={1}
          step={0.05}
          value={brainModel?.topP ?? 0.95}
          onChange={(v) => save({ ...(brainModel ?? {}), topP: v })}
        />
        <Slider
          label="max output"
          rightLabel={`${brainModel?.maxTokens ?? 1024} tok`}
          min={64}
          max={4096}
          step={64}
          value={brainModel?.maxTokens ?? 1024}
          onChange={(v) =>
            save({ ...(brainModel ?? {}), maxTokens: Math.round(v) })
          }
        />
      </Section>

      <Section
        title="System prompt budget"
        hint="soft cap with auto-trim"
        status="tuned"
        info={SECTION_INFO.budget}
      >
        <BudgetCard
          identity={identity}
          voiceStyle={voiceStyle}
          directive={directive}
        />
      </Section>

      <Section
        title="Voice override"
        hint="latency-tuned model for voice turns"
        status={brainModel?.voice?.model ? "set" : "empty"}
        info={SECTION_INFO.voiceOverride}
      >
        <ModelPicker
          models={voiceModels}
          value={brainModel?.voice?.model ?? ""}
          allowEmpty
          onChange={(id) =>
            save({
              ...(brainModel ?? {}),
              voice: id
                ? {
                    model: id,
                    provider: voiceModels.find((m) => m.id === id)?.provider,
                  }
                : undefined,
            })
          }
        />
      </Section>
    </>
  );
}

function ModelCard({ model }: { model: ModelOption }) {
  return (
    <div
      style={{
        ...cardShell,
        padding: "14px 16px",
        display: "flex",
        flexDirection: "column",
        gap: "var(--space-8)",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: "var(--space-8)",
        }}
      >
        <span
          style={{
            fontFamily: T.fontHeading,
            fontSize: 15,
            fontWeight: 600,
            color: T.fg,
          }}
        >
          {model.id}
        </span>
        <span
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: "var(--space-6)",
            padding: "4px 10px",
            borderRadius: "var(--radius-pill)",
            background: T.accentSoft,
            border:
              "1px solid var(--accent-border)",
            fontFamily: T.fontMono,
            fontSize: "var(--font-size-2xs)",
            letterSpacing: "0.18em",
            textTransform: "uppercase",
            color: T.accent,
            lineHeight: 1.2,
          }}
        >
          <span
            style={{
              width: 6,
              height: 6,
              borderRadius: "50%",
              background: T.accent,
              boxShadow: `0 0 6px ${T.accent}`,
            }}
          />
          healthy
        </span>
      </div>
      <span
        style={{
          fontFamily: T.fontMono,
          fontSize: "var(--font-size-xs)",
          color: T.muted,
          letterSpacing: "0.04em",
        }}
      >
        {model.provider}
        {model.label ? ` · ${model.label}` : ""}
      </span>
      <div style={{ display: "flex", flexWrap: "wrap", gap: "var(--space-4)" }}>
        {model.contextWindow && (
          <MetaChip>ctx {Math.round(model.contextWindow / 1000)}k</MetaChip>
        )}
        {model.pricing?.input != null && (
          <MetaChip>${model.pricing.input.toFixed(2)} / 1M in</MetaChip>
        )}
        {model.pricing?.output != null && (
          <MetaChip>${model.pricing.output.toFixed(2)} / 1M out</MetaChip>
        )}
      </div>
    </div>
  );
}

function ModelPicker({
  models,
  value,
  onChange,
  allowEmpty,
}: {
  models: ModelOption[];
  value: string;
  onChange: (id: string) => void;
  allowEmpty?: boolean;
}) {
  const items: MenuItem<string>[] = [
    ...(allowEmpty
      ? [{ value: "", label: "— inherit chat model —" } as MenuItem<string>]
      : []),
    ...models.map((m) => ({ value: m.id, label: m.id, meta: m.provider })),
  ];
  return (
    <Menu
      value={value}
      onChange={onChange}
      items={items}
      ariaLabel="Model"
      renderTrigger={(current) => (
        <span
          style={{
            flex: 1,
            display: "inline-flex",
            justifyContent: "space-between",
            alignItems: "center",
            gap: "var(--space-12)",
            minWidth: 0,
          }}
        >
          <span
            style={{
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {current?.label ?? (allowEmpty ? "— inherit chat model —" : "Select model")}
          </span>
          {current?.meta && (
            <span
              style={{
                fontFamily: T.fontMono,
                fontSize: "var(--font-size-2xs)",
                fontWeight: 500,
                color: T.muted,
                letterSpacing: "0.06em",
                textTransform: "uppercase",
                flexShrink: 0,
              }}
            >
              {current.meta}
            </span>
          )}
        </span>
      )}
      triggerStyle={{
        width: "100%",
        padding: "9px 12px",
        background: "var(--card)",
        fontFamily: T.fontMono,
        fontSize: "var(--font-size-base)",
      }}
    />
  );
}

function BudgetCard({
  identity,
  voiceStyle,
  directive,
}: {
  identity: CharacterIdentity | null;
  voiceStyle: CharacterVoiceStyle | null;
  directive: CharacterDirective | null;
}) {
  // Reuses the same per-section estimators as the sidebar footer so both
  // surfaces always show the same total.
  const id = estimateIdentityTokens(identity);
  const voice = estimateVoiceTokens(voiceStyle);
  const examples = estimateExamplesTokens(directive);
  const limits = estimateLimitsTokens(directive);
  const total = id + voice + examples + limits;
  const pct = Math.min(1, total / 2000) * 100;

  return (
    <div
      style={{
        ...cardShell,
        padding: "14px 16px",
        display: "flex",
        flexDirection: "column",
        gap: "var(--space-10)",
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "baseline",
        }}
      >
        <div style={{ display: "flex", alignItems: "baseline", gap: "var(--space-8)" }}>
          <span
            style={{
              fontFamily: T.fontHeading,
              fontSize: 32,
              fontWeight: 600,
              letterSpacing: "-0.02em",
              lineHeight: 1,
              color: T.accent,
            }}
          >
            {total}
          </span>
          <span
            style={{
              fontFamily: T.fontMono,
              fontSize: "var(--font-size-sm)",
              letterSpacing: "0.14em",
              textTransform: "uppercase",
              color: "var(--text-tertiary)",
            }}
          >
            / 2,000 tok
          </span>
        </div>
      </div>
      <div
        style={{
          height: 4,
          borderRadius: "var(--radius-pill)",
          background: "var(--card-hover)",
          overflow: "hidden",
        }}
      >
        <div
          style={{
            width: `${pct}%`,
            height: "100%",
            borderRadius: "var(--radius-pill)",
            background: T.accent,
          }}
        />
      </div>
      <span
        style={{
          fontFamily: T.fontMono,
          fontSize: "var(--font-size-xs)",
          color: "var(--text-tertiary)",
          letterSpacing: "0.14em",
          textTransform: "uppercase",
        }}
      >
        identity {id} · voice {voice} · examples {examples} · limits {limits}
      </span>
      <span
        style={{
          fontFamily: T.fontMono,
          fontSize: "var(--font-size-2xs)",
          color: "var(--text-quaternary)",
          letterSpacing: "0.10em",
          textTransform: "uppercase",
        }}
      >
        rough char/4 estimate · real counts from prompt compile
      </span>
    </div>
  );
}

function MetaChip({ children }: { children: React.ReactNode }) {
  return (
    <span
      style={{
        padding: "3px 8px",
        background: "var(--card-hover)",
        border: `1px solid ${T.border}`,
        borderRadius: "var(--radius-pill)",
        fontFamily: T.fontMono,
        fontSize: "var(--font-size-xs)",
        letterSpacing: "0.08em",
        color: "var(--text-tertiary)",
      }}
    >
      {children}
    </span>
  );
}

/* ── Knowledge Tab ─────────────────────────────────────────────── */

function KnowledgeTab({
  characterId,
  bindings,
  onBindingsChange,
}: {
  characterId: string;
  bindings: ConfigBinding[];
  onBindingsChange: (b: ConfigBinding[]) => void;
}) {
  const updatePriority = useCallback(
    (bindingId: string, priority: BindingPriority) => {
      onBindingsChange(
        bindings.map((b) =>
          b.binding.id === bindingId
            ? { ...b, binding: { ...b.binding, priority } }
            : b,
        ),
      );
      void fetch(`/api/characters/${characterId}/bindings/${bindingId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ priority }),
      });
    },
    [bindings, characterId, onBindingsChange],
  );

  const updateActive = useCallback(
    (bindingId: string, isActive: boolean) => {
      onBindingsChange(
        bindings.map((b) =>
          b.binding.id === bindingId
            ? { ...b, binding: { ...b.binding, isActive } }
            : b,
        ),
      );
      void fetch(`/api/characters/${characterId}/bindings/${bindingId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ isActive }),
      });
    },
    [bindings, characterId, onBindingsChange],
  );

  const totalFacts = bindings.reduce((n, b) => n + b.wiki.pageCount, 0);

  return (
    <>
      <Section
        title="Bound graphs"
        hint={`${bindings.length} ${bindings.length === 1 ? "graph" : "graphs"} · ${totalFacts} facts`}
        status={bindings.length > 0 ? "set" : "empty"}
        info={SECTION_INFO.knowledge}
      >
        {bindings.length === 0 && (
          <EmptyHint>
            No knowledge bound yet. Bind a wiki to give this character what to
            know.
          </EmptyHint>
        )}
        {bindings.map(({ binding, wiki }) => (
          <BindingCard
            key={binding.id}
            binding={binding}
            wiki={wiki}
            onPriorityChange={(p) => updatePriority(binding.id, p)}
            onActiveChange={(a) => updateActive(binding.id, a)}
          />
        ))}
        <Link
          href="/wikis"
          style={{
            ...addButtonStyle,
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            textDecoration: "none",
          }}
        >
          <span>+ Bind another graph</span>
          <span
            style={{ fontFamily: T.fontMono, fontSize: "var(--font-size-xs)", color: T.muted }}
          >
            browse library ↗
          </span>
        </Link>
        <span
          style={{
            fontFamily: T.fontMono,
            fontSize: "var(--font-size-xs)",
            color: T.muted,
            lineHeight: 1.5,
            marginTop: "var(--space-4)",
          }}
        >
          Graphs are shared resources. Edit them in the Knowledge library.
          Changes apply to every character bound to the same graph.
        </span>
      </Section>
    </>
  );
}

const PRIORITY_OPTIONS: BindingPriority[] = [
  "primary",
  "secondary",
  "reference",
];
const PRIORITY_COLORS: Record<
  BindingPriority,
  { fg: string; bg: string; border: string }
> = {
  primary: { fg: T.accent, bg: T.accentSoft, border: "rgba(140,231,210,0.30)" },
  secondary: {
    fg: "#A8C4E8",
    bg: "rgba(168,196,232,0.10)",
    border: "rgba(168,196,232,0.30)",
  },
  reference: { fg: T.muted, bg: "rgba(255,255,255,0.04)", border: T.border },
};

function BindingCard({
  binding,
  wiki,
  onPriorityChange,
  onActiveChange,
}: {
  binding: CharacterKnowledgeBindingRecord;
  wiki: ConfigBinding["wiki"];
  onPriorityChange: (p: BindingPriority) => void;
  onActiveChange: (a: boolean) => void;
}) {
  const color = PRIORITY_COLORS[binding.priority];
  return (
    <div
      style={{
        ...cardShell,
        padding: "14px 16px",
        display: "flex",
        flexDirection: "column",
        gap: "var(--space-10)",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: "var(--space-8)",
        }}
      >
        <Link
          href={`/wikis/${wiki.id}`}
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: "var(--space-10)",
            color: T.fg,
            textDecoration: "none",
            fontFamily: T.fontHeading,
            fontSize: "var(--font-size-lg)",
            fontWeight: 600,
            minWidth: 0,
          }}
        >
          <span
            style={{
              color: color.fg,
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              width: 28,
              height: 28,
              border: `1px solid ${color.border}`,
              borderRadius: "var(--radius-md)",
              background: color.bg,
              flexShrink: 0,
            }}
          >
            <KnowledgeGraphIcon data={wiki.iconData} size={20} />
          </span>
          <span
            style={{
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {wiki.title}
          </span>
        </Link>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "var(--space-6)",
            flexShrink: 0,
          }}
        >
          <Menu<BindingPriority>
            value={binding.priority}
            onChange={onPriorityChange}
            items={PRIORITY_OPTIONS.map((p) => ({ value: p, label: p }))}
            ariaLabel="Binding priority"
            align="right"
            showChevron={false}
            triggerStyle={{
              padding: "3px 8px",
              border: `1px solid ${color.border}`,
              borderRadius: "var(--radius-pill)",
              background: color.bg,
              color: color.fg,
              fontFamily: T.fontMono,
              fontSize: "var(--font-size-xs)",
              letterSpacing: "0.10em",
              textTransform: "uppercase",
            }}
          />
          <Toggle on={binding.isActive} onChange={onActiveChange} />
        </div>
      </div>
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: "var(--space-12)",
          fontFamily: T.fontMono,
          fontSize: "var(--font-size-xs)",
          color: T.muted,
        }}
      >
        <span>{wiki.pageCount} facts</span>
        <span>·</span>
        <span>{wiki.sourceCount} sources</span>
        {wiki.characterCount > 1 && (
          <>
            <span>·</span>
            <span>
              shared with {wiki.characterCount - 1} other
              {wiki.characterCount - 1 === 1 ? "" : "s"}
            </span>
          </>
        )}
        <span>·</span>
        <span>refreshed {relative(wiki.updatedAt)}</span>
      </div>
    </div>
  );
}

function Toggle({
  on,
  onChange,
}: {
  on: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      onClick={() => onChange(!on)}
      style={{
        width: 30,
        height: 16,
        borderRadius: "var(--radius-pill)",
        border: `1px solid ${on ? "rgba(140,231,210,0.40)" : T.border}`,
        background: on ? T.accentSoft : "transparent",
        position: "relative",
        cursor: "pointer",
        padding: 0,
        flexShrink: 0,
      }}
    >
      <span
        style={{
          position: "absolute",
          top: 2,
          left: on ? 16 : 2,
          width: 10,
          height: 10,
          borderRadius: "50%",
          background: on ? T.accent : T.muted,
          transition: "left 120ms",
        }}
      />
    </button>
  );
}

/* ── Limits Tab ────────────────────────────────────────────────── */

function LimitsTab({
  characterId,
  directive,
  onDirectiveChange,
}: {
  characterId: string;
  directive: CharacterDirective | null;
  onDirectiveChange: (d: CharacterDirective | null) => void;
}) {
  const [draftRefusal, setDraftRefusal] = useState("");

  const persist = useDebouncedSave(async (next: CharacterDirective) => {
    await fetch(`/api/characters/${characterId}/directive`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ directive: next }),
    });
  });

  const save = useCallback(
    (next: CharacterDirective) => {
      onDirectiveChange(next);
      persist(next);
    },
    [onDirectiveChange, persist],
  );

  const refusals = directive?.scope?.refuse ?? [];
  const nevers = directive?.never ?? [];

  return (
    <>
      <Section
        title="Topic refusals"
        hint="things they won't discuss"
        status={refusals.length > 0 ? "set" : "empty"}
        info={SECTION_INFO.topicRefusals}
      >
        <FieldLabel>topics · soft-decline at runtime</FieldLabel>
        <div style={{ display: "flex", flexWrap: "wrap", gap: "var(--space-6)" }}>
          {refusals.map((r) => (
            <span
              key={r}
              style={{
                padding: "4px 10px",
                borderRadius: "var(--radius-pill)",
                background: T.dangerSoft,
                border:
                  "1px solid color-mix(in srgb, var(--danger) 30%, transparent)",
                fontFamily: T.fontMono,
                fontSize: "var(--font-size-xs)",
                letterSpacing: "0.10em",
                textTransform: "uppercase",
                color: T.danger,
                display: "inline-flex",
                alignItems: "center",
                gap: "var(--space-6)",
                lineHeight: 1.2,
              }}
            >
              {r}
              <button
                type="button"
                onClick={() =>
                  save({
                    ...(directive ?? {}),
                    scope: {
                      ...(directive?.scope ?? {}),
                      refuse: refusals.filter((x) => x !== r),
                    },
                  })
                }
                style={{
                  border: "none",
                  background: "transparent",
                  color: T.danger,
                  cursor: "pointer",
                  fontFamily: T.fontMono,
                  fontSize: "var(--font-size-xs)",
                  padding: 0,
                }}
                aria-label={`Remove ${r}`}
              >
                ×
              </button>
            </span>
          ))}
          <input
            value={draftRefusal}
            onChange={(e) => setDraftRefusal(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && draftRefusal.trim()) {
                e.preventDefault();
                save({
                  ...(directive ?? {}),
                  scope: {
                    ...(directive?.scope ?? {}),
                    refuse: [...refusals, draftRefusal.trim()],
                  },
                });
                setDraftRefusal("");
              }
            }}
            placeholder="+ add a topic"
            style={{ ...addChipInputStyle, width: 150 }}
          />
        </div>
        <span
          style={{
            fontFamily: T.fontBody,
            fontSize: "var(--font-size-sm)",
            color: T.muted,
            lineHeight: 1.5,
          }}
        >
          When a session steers toward these, the character deflects gracefully
          in their own voice — they don&rsquo;t break character to refuse.
        </span>
      </Section>

      <Section
        title="Hard rules"
        hint="enforced every turn"
        status={nevers.length > 0 ? "set" : "empty"}
        info={SECTION_INFO.hardRules}
      >
        {nevers.length === 0 && (
          <EmptyHint>
            No hard rules yet. Add a never to gate a behavior unconditionally.
          </EmptyHint>
        )}
        {nevers.map((rule, i) => (
          <div
            key={i}
            style={{
              ...cardShell,
              padding: "10px 14px",
              display: "flex",
              alignItems: "center",
              gap: "var(--space-10)",
            }}
          >
            <span
              style={{
                fontFamily: T.fontMono,
                fontSize: "var(--font-size-xs)",
                color: T.muted,
                width: 22,
                textAlign: "center",
                flexShrink: 0,
              }}
            >
              {String(i + 1).padStart(2, "0")}
            </span>
            <span
              style={{
                fontFamily: T.fontBody,
                fontSize: "var(--font-size-base)",
                color: T.fg,
                flex: 1,
              }}
            >
              {rule}
            </span>
            <button
              type="button"
              onClick={() =>
                save({
                  ...(directive ?? {}),
                  never: nevers.filter((_, idx) => idx !== i),
                })
              }
              style={ghostButtonStyle}
              aria-label="Remove rule"
            >
              remove
            </button>
          </div>
        ))}
        <AddRule
          onAdd={(text) =>
            save({ ...(directive ?? {}), never: [...nevers, text] })
          }
        />
      </Section>

      <Section
        title="Stage Manager"
        hint="behavior between turns"
        status="empty"
        info={SECTION_INFO.stageManager}
      >
        <EmptyHint>
          Deflection envelope, hostile-user fallback, and low-confidence
          behavior land in the next pass once the runtime supports them.
        </EmptyHint>
      </Section>
    </>
  );
}

function AddRule({ onAdd }: { onAdd: (text: string) => void }) {
  const [text, setText] = useState("");
  return (
    <input
      value={text}
      onChange={(e) => setText(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === "Enter" && text.trim()) {
          e.preventDefault();
          onAdd(text.trim());
          setText("");
        }
      }}
      placeholder="+ add a rule (press Enter)"
      style={{
        ...inputStyle,
        padding: "9px 12px",
        fontFamily: T.fontBody,
        fontSize: "var(--font-size-base)",
        background: "rgba(140,231,210,0.04)",
        borderColor: "rgba(140,231,210,0.20)",
      }}
    />
  );
}

/* ── System prompt footer ──────────────────────────────────────── */

function SystemPromptFooter({
  identity,
  voiceStyle,
  directive,
  onOpenPreview,
}: {
  identity: CharacterIdentity | null;
  voiceStyle: CharacterVoiceStyle | null;
  directive: CharacterDirective | null;
  onOpenPreview: () => void;
}) {
  const tokens = estimateTokens(identity, voiceStyle, directive);
  const pct = Math.min(1, tokens / 2000);

  return (
    <div
      style={{
        position: "absolute",
        bottom: 0,
        left: 0,
        right: 0,
        padding: "14px 24px 18px",
        // Glass surface that flips with the theme. The token bar slot needs
        // an opaque-ish backdrop so the scroll content behind doesn't bleed
        // through the chip.
        background: "color-mix(in srgb, var(--background) 92%, transparent)",
        backdropFilter: "blur(8px)",
        borderTop: `1px solid ${T.border}`,
        display: "flex",
        alignItems: "center",
        gap: "var(--space-12)",
      }}
    >
      <div
        style={{ flex: 1, display: "flex", flexDirection: "column", gap: "var(--space-6)" }}
      >
        <span
          style={{
            fontFamily: T.fontMono,
            fontSize: "var(--font-size-xs)",
            color: "var(--text-tertiary)",
            letterSpacing: "0.18em",
            textTransform: "uppercase",
          }}
        >
          system prompt · <span style={{ color: T.accent }}>{tokens}</span> /
          2,000 tok
        </span>
        <div
          style={{
            height: 3,
            background: "var(--card-hover)",
            overflow: "hidden",
          }}
        >
          <div
            style={{
              width: `${pct * 100}%`,
              height: "100%",
              background: T.accent,
            }}
          />
        </div>
      </div>
      <button
        type="button"
        onClick={onOpenPreview}
        aria-label="Preview what the model sees"
        title="Preview what the model sees"
        style={{
          width: 32,
          height: 32,
          padding: 0,
          border: `1px solid ${T.border}`,
          borderRadius: "var(--radius-md)",
          background: "transparent",
          color: "var(--text-tertiary)",
          cursor: "pointer",
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          flexShrink: 0,
        }}
      >
        <ParagraphGlyph />
      </button>
    </div>
  );
}

function ParagraphGlyph() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      aria-hidden="true"
      style={{ flexShrink: 0 }}
    >
      <line x1="21" y1="6" x2="3" y2="6" />
      <line x1="17" y1="10" x2="3" y2="10" />
      <line x1="21" y1="14" x2="3" y2="14" />
      <line x1="17" y1="18" x2="3" y2="18" />
    </svg>
  );
}

/* ── Prompt preview overlay ────────────────────────────────────── */

type PreviewView = "rendered" | "schema";

type PreviewSection = {
  key: string;
  label: string;
  hint: string;
  body: string;
  tokens: number;
  editTab: TabKey | null;
  editLabel: string;
};

function PromptPreviewOverlay({
  characterSlug,
  title,
  identity,
  voiceStyle,
  directive,
  bindings,
  onClose,
  onJumpToTab,
}: {
  characterSlug: string;
  title: string;
  identity: CharacterIdentity | null;
  voiceStyle: CharacterVoiceStyle | null;
  directive: CharacterDirective | null;
  bindings: ConfigBinding[];
  onClose: () => void;
  onJumpToTab: (t: TabKey) => void;
}) {
  const [view, setView] = useState<PreviewView>("rendered");
  const [copied, setCopied] = useState(false);

  const rendered = useMemo(
    () =>
      buildRenderedSections({
        slug: characterSlug,
        title,
        identity,
        voiceStyle,
        directive,
      }),
    [characterSlug, title, identity, voiceStyle, directive],
  );
  const schema = useMemo(() => SCHEMA_SECTIONS, []);
  const sections = view === "rendered" ? rendered : schema;
  const total = sections.reduce((n, s) => n + s.tokens, 0);

  const copyPrompt = useCallback(async () => {
    const text = sections
      .map((s) => `${s.label.toUpperCase()}\n${s.body}\n`)
      .join("\n");
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch {
      // clipboard blocked — silently no-op; copy is a nice-to-have.
    }
  }, [sections]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      } else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "c") {
        // Don't intercept when the user has a text selection — they may be
        // trying to copy a single section. We grab the whole prompt only
        // when there's nothing currently selected.
        const sel = window.getSelection();
        if (!sel || sel.toString().length === 0) {
          e.preventDefault();
          void copyPrompt();
        }
      }
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose, copyPrompt]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 100,
        background: "color-mix(in srgb, var(--background) 70%, transparent)",
        backdropFilter: "blur(4px)",
        display: "flex",
        alignItems: "flex-start",
        justifyContent: "center",
        padding: "48px 24px",
        overflow: "auto",
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "100%",
          maxWidth: 880,
          backgroundColor: "var(--background)",
          backgroundImage: "none",
          border: `1px solid ${T.border}`,
          borderRadius: "var(--radius-3xl)",
          boxShadow: "0 24px 60px var(--shadow, rgba(0,0,0,0.40))",
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
          maxHeight: "calc(100vh - 96px)",
        }}
      >
        {/* Header */}
        <div
          style={{
            padding: "20px 24px 16px",
            display: "flex",
            alignItems: "flex-start",
            justifyContent: "space-between",
            gap: "var(--space-12)",
            borderBottom: `1px solid ${T.border}`,
          }}
        >
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: "var(--space-6)",
              minWidth: 0,
            }}
          >
            <span
              style={{
                fontFamily: T.fontMono,
                fontSize: "var(--font-size-sm)",
                letterSpacing: "0.18em",
                textTransform: "uppercase",
                color: T.accent,
              }}
            >
              system prompt preview
            </span>
            <span
              style={{
                fontFamily: T.fontHeading,
                fontSize: "var(--font-size-2xl)",
                fontWeight: 600,
                letterSpacing: "-0.01em",
                color: T.fg,
              }}
            >
              What the model sees
            </span>
            <span
              style={{
                fontFamily: T.fontMono,
                fontSize: "var(--font-size-xs)",
                color: "var(--text-tertiary)",
                letterSpacing: "0.10em",
              }}
            >
              {view === "rendered"
                ? `for next session · current config of ${title.toLowerCase()}`
                : "abstract template · slot markers + conditionals"}
            </span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: "var(--space-16)" }}>
            <span
              style={{
                fontFamily: T.fontMono,
                fontSize: "var(--font-size-sm)",
                letterSpacing: "0.14em",
                textTransform: "uppercase",
                color: "var(--text-tertiary)",
                whiteSpace: "nowrap",
              }}
            >
              total{" "}
              <span style={{ color: T.accent, fontWeight: 600 }}>{total}</span>{" "}
              / 2,000 tok
            </span>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              style={{
                width: 26,
                height: 24,
                border: `1px solid ${T.border}`,
                borderRadius: "var(--radius-pill)",
                background: "transparent",
                color: "var(--text-tertiary)",
                cursor: "pointer",
                fontSize: "var(--font-size-xl)",
                lineHeight: 1,
                padding: 0,
              }}
            >
              ×
            </button>
          </div>
        </div>

        {/* Tab toggle + hint */}
        <div
          style={{
            padding: "14px 24px 0",
            display: "flex",
            alignItems: "center",
            gap: "var(--space-14)",
          }}
        >
          <div
            style={{
              display: "inline-flex",
              padding: 0,
              border: `1px solid ${T.border}`,
              borderRadius: "var(--radius-pill)",
              overflow: "hidden",
            }}
          >
            {(["rendered", "schema"] as const).map((v) => {
              const active = v === view;
              return (
                <button
                  key={v}
                  type="button"
                  onClick={() => setView(v)}
                  style={{
                    padding: "6px 16px",
                    border: "none",
                    background: active ? T.accentSoft : "transparent",
                    color: active ? T.accent : "var(--text-tertiary)",
                    fontFamily: T.fontMono,
                    fontSize: "var(--font-size-sm)",
                    letterSpacing: "0.14em",
                    textTransform: "uppercase",
                    fontWeight: active ? 600 : 400,
                    cursor: "pointer",
                  }}
                >
                  {v}
                </button>
              );
            })}
          </div>
          <span
            style={{ fontFamily: T.fontMono, fontSize: "var(--font-size-xs)", color: T.muted }}
          >
            {view === "rendered"
              ? "click a section to jump back to its source ↗"
              : "{{slot}} markers expand from sandbox state · conditionals depend on what's authored"}
          </span>
        </div>

        {/* Sections */}
        <div
          style={{
            flex: 1,
            minHeight: 0,
            overflow: "auto",
            padding: "16px 24px",
            display: "flex",
            flexDirection: "column",
            gap: "var(--space-10)",
          }}
        >
          {sections.map((s) => (
            <PreviewSectionCard
              key={s.key}
              section={s}
              onJumpToTab={onJumpToTab}
            />
          ))}

          {/* Not in this prompt */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              flexWrap: "wrap",
              gap: "var(--space-8)",
              padding: "10px 4px 4px",
            }}
          >
            <span
              style={{
                fontFamily: T.fontMono,
                fontSize: "var(--font-size-xs)",
                color: T.muted,
                letterSpacing: "0.02em",
              }}
            >
              not in this prompt:
            </span>
            <NotInPromptChip>
              {bindings.length} knowledge graph
              {bindings.length === 1 ? "" : "s"} · retrieved per turn
            </NotInPromptChip>
            <NotInPromptChip>voice clip · sent to TTS</NotInPromptChip>
            <NotInPromptChip>model config · API params</NotInPromptChip>
          </div>
        </div>

        {/* Footer */}
        <div
          style={{
            padding: "12px 24px 14px",
            borderTop: `1px solid ${T.border}`,
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: "var(--space-12)",
          }}
        >
          <span
            style={{
              fontFamily: T.fontMono,
              fontSize: "var(--font-size-xs)",
              color: T.muted,
              letterSpacing: "0.04em",
            }}
          >
            <KeyChip>⌘ C</KeyChip> {copied ? "copied" : "copies"} ·{" "}
            <KeyChip>esc</KeyChip> closes
          </span>
          <div style={{ display: "flex", gap: "var(--space-8)" }}>
            <button
              type="button"
              onClick={copyPrompt}
              style={{
                padding: "7px 16px",
                border: `1px solid ${T.border}`,
                borderRadius: "var(--radius-pill)",
                background: "transparent",
                color: T.fg,
                fontFamily: T.fontHeading,
                fontSize: "var(--font-size-base)",
                fontWeight: 500,
                cursor: "pointer",
                display: "inline-flex",
                alignItems: "center",
                gap: "var(--space-6)",
              }}
            >
              <span style={{ fontFamily: T.fontMono, fontSize: "var(--font-size-sm)" }}>
                {copied ? "✓" : "⧉"}
              </span>
              {copied ? "Copied" : "Copy prompt"}
            </button>
            <button
              type="button"
              onClick={onClose}
              style={{
                padding: "7px 18px",
                border: `1px solid ${T.accent}`,
                borderRadius: "var(--radius-pill)",
                background: T.accent,
                color: "var(--background)",
                fontFamily: T.fontHeading,
                fontSize: "var(--font-size-base)",
                fontWeight: 600,
                cursor: "pointer",
              }}
            >
              Close
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function PreviewSectionCard({
  section,
  onJumpToTab,
}: {
  section: PreviewSection;
  onJumpToTab: (t: TabKey) => void;
}) {
  const jumpable = section.editTab !== null;
  return (
    <div
      onClick={() => {
        if (section.editTab) onJumpToTab(section.editTab);
      }}
      style={{
        ...cardShell,
        padding: "12px 14px",
        display: "flex",
        flexDirection: "column",
        gap: "var(--space-8)",
        cursor: jumpable ? "pointer" : "default",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "baseline",
          justifyContent: "space-between",
          gap: "var(--space-8)",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "baseline",
            gap: "var(--space-8)",
            minWidth: 0,
          }}
        >
          <span
            style={{ fontFamily: T.fontMono, fontSize: "var(--font-size-sm)", color: T.muted }}
          >
            —
          </span>
          <span
            style={{
              fontFamily: T.fontMono,
              fontSize: "var(--font-size-base)",
              fontWeight: 600,
              color: T.fg,
            }}
          >
            {section.label}
          </span>
          <span
            style={{
              fontFamily: T.fontMono,
              fontSize: "var(--font-size-xs)",
              color: T.muted,
              letterSpacing: "0.02em",
            }}
          >
            {section.hint}
          </span>
        </div>
        <div
          style={{
            display: "flex",
            alignItems: "baseline",
            gap: "var(--space-10)",
            flexShrink: 0,
          }}
        >
          <span
            style={{ fontFamily: T.fontMono, fontSize: "var(--font-size-xs)", color: T.muted }}
          >
            {section.tokens} tokens
          </span>
          {jumpable && (
            <span
              style={{
                fontFamily: T.fontMono,
                fontSize: "var(--font-size-xs)",
                color: T.muted,
                letterSpacing: "0.02em",
              }}
            >
              {section.editLabel} ↗
            </span>
          )}
        </div>
      </div>
      {section.body && (
        <pre
          style={{
            margin: 0,
            fontFamily: T.fontMono,
            fontSize: "var(--font-size-base)",
            lineHeight: 1.55,
            color: T.fg,
            whiteSpace: "pre-wrap",
            wordBreak: "break-word",
          }}
        >
          {section.body}
        </pre>
      )}
    </div>
  );
}

function NotInPromptChip({ children }: { children: React.ReactNode }) {
  return (
    <span
      style={{
        padding: "3px 10px",
        borderRadius: "var(--radius-pill)",
        background: "var(--card-hover)",
        border: `1px solid ${T.border}`,
        fontFamily: T.fontMono,
        fontSize: "var(--font-size-xs)",
        color: T.muted,
      }}
    >
      {children}
    </span>
  );
}

function KeyChip({ children }: { children: React.ReactNode }) {
  return (
    <span
      style={{
        display: "inline-block",
        padding: "1px 6px",
        borderRadius: "var(--radius-xs)",
        border: `1px solid ${T.border}`,
        background: "var(--card-hover)",
        fontFamily: T.fontMono,
        fontSize: "var(--font-size-2xs)",
        color: T.fg,
        letterSpacing: "0.04em",
        margin: "0 1px",
      }}
    >
      {children}
    </span>
  );
}

/* ── Section content builders ──────────────────────────────────── */

function buildRenderedSections({
  slug,
  title,
  identity,
  voiceStyle,
  directive,
}: {
  slug: string;
  title: string;
  identity: CharacterIdentity | null;
  voiceStyle: CharacterVoiceStyle | null;
  directive: CharacterDirective | null;
}): PreviewSection[] {
  const out: PreviewSection[] = [];

  // Identity — anchor; never trimmed.
  const idLines: string[] = [];
  idLines.push(`You are ${slug}:`);
  if (identity?.essence) idLines.push(`  ${identity.essence}`);
  const traits = (identity?.traits ?? []).filter((t) => t.name.trim());
  if (traits.length > 0) {
    idLines.push("");
    idLines.push("  Core traits:");
    for (const t of traits) {
      idLines.push(
        t.description.trim()
          ? `  — ${t.name}: ${t.description}`
          : `  — ${t.name}`,
      );
    }
  }
  out.push({
    key: "identity",
    label: "identity",
    hint: "anchor · never trimmed",
    body: idLines.join("\n"),
    tokens: estimateIdentityTokens(identity),
    editTab: "persona",
    editLabel: "edit in persona",
  });

  // Topics covered — derived from example tags.
  const tagSet = new Set<string>();
  for (const e of directive?.exemplars ?? []) {
    for (const t of e.tags ?? []) {
      const trimmed = t.trim();
      if (trimmed) tagSet.add(trimmed);
    }
  }
  if (tagSet.size > 0) {
    const tags = Array.from(tagSet);
    out.push({
      key: "topics-covered",
      label: "topics covered",
      hint: "derived from example tags",
      body: `Topics covered: ${tags.join(" · ")}.`,
      // Tokens roll up into the examples bucket via tag chars there too,
      // but we surface a separate count for the line itself.
      tokens: Math.round(`Topics covered: ${tags.join(" · ")}.`.length / 4),
      editTab: "persona",
      editLabel: "edit in persona",
    });
  }

  // Voice & style — register descriptor.
  const tones = voiceStyle?.tone?.filter((t) => t.trim()) ?? [];
  const brevity = voiceStyle?.brevity;
  const registerParts = [...tones, brevity ?? null].filter(Boolean) as string[];
  if (registerParts.length > 0 || voiceStyle?.voicePrompt) {
    const lines: string[] = [];
    if (registerParts.length > 0) {
      lines.push(`Speak in this register: ${registerParts.join(" · ")}.`);
    }
    if (voiceStyle?.voicePrompt) {
      lines.push(``);
      lines.push(`// TTS reference: ${voiceStyle.voicePrompt}`);
    }
    out.push({
      key: "voice-style",
      label: "voice & style",
      hint: "register descriptor",
      body: lines.join("\n"),
      tokens: estimateVoiceTokens(voiceStyle),
      editTab: "voice",
      editLabel: "edit in voice",
    });
  }

  // Examples — XML <example> blocks with tags.
  const exemplars = (directive?.exemplars ?? []).filter(
    (e) => e.user?.trim() && e.you?.trim(),
  );
  if (exemplars.length > 0) {
    const blocks = exemplars.map((e) => {
      const tagAttr = (e.tags ?? []).filter((t) => t.trim()).join(", ");
      const header = tagAttr ? `<example tags="${tagAttr}">` : "<example>";
      return `${header}\n  user: ${e.user.trim()}\n  ${slug}: ${e.you.trim()}\n</example>`;
    });
    out.push({
      key: "examples",
      label: "examples",
      hint: `${exemplars.length} of ${exemplars.length} included`,
      body: blocks.join("\n\n"),
      tokens: estimateExamplesTokens(directive),
      editTab: "persona",
      editLabel: "edit in persona",
    });
  }

  // Topic refusals.
  const refuses = (directive?.scope?.refuse ?? []).filter((r) => r.trim());
  if (refuses.length > 0) {
    const body = [
      "Decline gracefully on these topics in your own voice:",
      ...refuses.map((r) => `  — ${r}`),
    ].join("\n");
    out.push({
      key: "topic-refusals",
      label: "topic refusals",
      hint: "soft-decline in character",
      body,
      tokens: Math.round(body.length / 4),
      editTab: "limits",
      editLabel: "edit in limits",
    });
  }

  // Hard rules.
  const nevers = (directive?.never ?? []).filter((n) => n.trim());
  if (nevers.length > 0) {
    const body = [
      "Always:",
      ...nevers.map(
        (n, i) =>
          `  ${i + 1}. Never ${n.replace(/^(do not |don'?t )/i, "").trim()}.`,
      ),
    ].join("\n");
    out.push({
      key: "hard-rules",
      label: "hard rules",
      hint: `${nevers.length} active · enforced every turn`,
      body,
      tokens: Math.round(body.length / 4),
      editTab: "limits",
      editLabel: "edit in limits",
    });
  }

  // Stage manager placeholder — schema isn't wired yet but show what's
  // there so authors aren't surprised by silence.
  if (directive?.framing) {
    out.push({
      key: "stage-manager",
      label: "stage manager",
      hint: "between-turn policy",
      body: directive.framing,
      tokens: Math.round(directive.framing.length / 4),
      editTab: "limits",
      editLabel: "edit in limits",
    });
  }

  return out;
}

/**
 * Schema view — abstract templates with {{slot}} markers. Static; doesn't
 * depend on current state. Mirrors the same section order as the rendered
 * view so the user can compare side-by-side via the tab toggle.
 */
const SCHEMA_SECTIONS: PreviewSection[] = [
  {
    key: "identity",
    label: "identity",
    hint: "always present",
    body: `You are {{character_handle}}:
  {{identity_sentence}}

  Core traits:
  {{#each defining_traits}}
  — {{name}}: {{description}}
  {{/each}}`,
    tokens: 95,
    editTab: "persona",
    editLabel: "edit in persona",
  },
  {
    key: "topics-covered",
    label: "topics covered",
    hint: "if any examples are tagged",
    body: `Topics covered: {{example_tags | unique | join(" · ")}}.`,
    tokens: 26,
    editTab: "persona",
    editLabel: "edit in persona",
  },
  {
    key: "voice-style",
    label: "voice & style",
    hint: "always present",
    body: `Speak in this register: {{voice_axes | join(" · ")}}.`,
    tokens: 35,
    editTab: "voice",
    editLabel: "edit in voice",
  },
  {
    key: "examples",
    label: "examples",
    hint: "{{#each examples}} until budget cap",
    body: `{{#each examples (priority order, until budget cap)}}
<example tags="{{tags}}">
  user: {{prompt}}
  {{character_handle}}: {{response}}
</example>
{{/each}}`,
    tokens: 280,
    editTab: "persona",
    editLabel: "edit in persona",
  },
  {
    key: "topic-refusals",
    label: "topic refusals",
    hint: "if any topic refusals authored",
    body: `Decline gracefully on these topics in your own voice:
{{#each topic_refusals}}
  — {{topic}}
{{/each}}`,
    tokens: 28,
    editTab: "limits",
    editLabel: "edit in limits",
  },
  {
    key: "hard-rules",
    label: "hard rules",
    hint: "if any hard rules are active",
    body: `Always:
{{#each active_rules}}
  {{index}}. {{rule}}
{{/each}}`,
    tokens: 50,
    editTab: "limits",
    editLabel: "edit in limits",
  },
  {
    key: "stage-manager",
    label: "stage manager",
    hint: "if any stage manager behavior set",
    body: `On pushback: {{deflection_attempts}}-attempt deflection envelope, then {{hostile_fallback}}.
{{#if low_confidence_set}}
On uncertainty: {{low_confidence_behavior}}.
{{/if}}`,
    tokens: 7,
    editTab: "limits",
    editLabel: "edit in limits",
  },
];

// Rough char/4 estimate per section. Real token counts come from the
// system-prompt compile pass; this is just for the UI affordance. Split
// per section so the budget breakdown ("Identity X · Voice Y · …") and
// the footer total share one source of truth and always agree.
function estimateIdentityTokens(identity: CharacterIdentity | null): number {
  let chars = 0;
  if (identity?.essence) chars += identity.essence.length;
  for (const t of identity?.traits ?? [])
    chars += t.name.length + t.description.length;
  return Math.round(chars / 4);
}

function estimateVoiceTokens(voiceStyle: CharacterVoiceStyle | null): number {
  let chars = 0;
  for (const c of voiceStyle?.tone ?? []) chars += c.length + 1;
  if (voiceStyle?.voicePrompt) chars += voiceStyle.voicePrompt.length;
  return Math.round(chars / 4);
}

function estimateExamplesTokens(directive: CharacterDirective | null): number {
  let chars = 0;
  for (const e of directive?.exemplars ?? []) {
    chars += (e.user?.length ?? 0) + (e.you?.length ?? 0);
    for (const t of e.tags ?? []) chars += t.length + 1;
  }
  return Math.round(chars / 4);
}

function estimateLimitsTokens(directive: CharacterDirective | null): number {
  let chars = 0;
  for (const r of directive?.scope?.refuse ?? []) chars += r.length + 1;
  for (const n of directive?.never ?? []) chars += n.length + 1;
  return Math.round(chars / 4);
}

function estimateTokens(
  identity: CharacterIdentity | null,
  voiceStyle: CharacterVoiceStyle | null,
  directive: CharacterDirective | null,
): number {
  // Compose from the per-section helpers so the total + breakdown agree.
  return (
    estimateIdentityTokens(identity) +
    estimateVoiceTokens(voiceStyle) +
    estimateLimitsTokens(directive) +
    estimateExamplesTokens(directive)
  );
}

/* ── Shared bits ───────────────────────────────────────────────── */

function FieldLabel({ children }: { children: React.ReactNode }) {
  return (
    <span
      style={{
        fontFamily: T.fontMono,
        fontSize: "var(--font-size-xs)",
        color: "var(--text-tertiary)",
        letterSpacing: "0.18em",
        textTransform: "uppercase",
      }}
    >
      {children}
    </span>
  );
}

function EmptyHint({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        ...cardShell,
        padding: "14px 16px",
        background: "transparent",
        borderStyle: "dashed",
      }}
    >
      <span
        style={{
          fontFamily: T.fontBody,
          fontSize: "var(--font-size-base)",
          color: T.muted,
          lineHeight: 1.5,
        }}
      >
        {children}
      </span>
    </div>
  );
}

/* Shared shell + control styles. Adding `borderRadius` at the
 * primitive level cascades through every consumer (InfoCard, inputs,
 * textareas, action buttons), so the sidebar reads consistently
 * rounded without touching every call site. */
const cardShell: React.CSSProperties = {
  background: T.panel,
  border: `1px solid ${T.border}`,
  borderRadius: "var(--radius-xl)",
};

const inputStyle: React.CSSProperties = {
  padding: "9px 12px",
  border: `1px solid ${T.border}`,
  borderRadius: "var(--radius-md)",
  background: "var(--card)",
  color: T.fg,
  fontFamily: T.fontBody,
  fontSize: "var(--font-size-md)",
  width: "100%",
  outline: "none",
};

const textareaStyle: React.CSSProperties = {
  ...inputStyle,
  fontFamily: T.fontBody,
  fontSize: "var(--font-size-md)",
  lineHeight: 1.5,
  resize: "vertical",
};

const addButtonStyle: React.CSSProperties = {
  padding: "10px 14px",
  border: `1px solid ${T.border}`,
  borderRadius: "var(--radius-lg)",
  background: "color-mix(in srgb, var(--accent-strong) 4%, transparent)",
  color: T.fg,
  fontFamily: T.fontBody,
  fontSize: "var(--font-size-md)",
  fontWeight: 500,
  cursor: "pointer",
  width: "100%",
  textAlign: "left",
};

const primaryButtonStyle: React.CSSProperties = {
  padding: "7px 16px",
  border: `1px solid ${T.accent}`,
  borderRadius: "var(--radius-pill)",
  background: T.accent,
  color: "var(--background)",
  fontFamily: T.fontHeading,
  fontSize: "var(--font-size-base)",
  fontWeight: 600,
  cursor: "pointer",
};

const ghostButtonStyle: React.CSSProperties = {
  padding: "6px 12px",
  border: `1px solid ${T.border}`,
  borderRadius: "var(--radius-pill)",
  background: "transparent",
  color: "var(--text-tertiary)",
  fontFamily: T.fontMono,
  fontSize: "var(--font-size-xs)",
  letterSpacing: "0.14em",
  textTransform: "uppercase",
  cursor: "pointer",
};

const editLinkStyle: React.CSSProperties = {
  border: "none",
  background: "transparent",
  color: "var(--text-tertiary)",
  fontFamily: T.fontMono,
  fontSize: "var(--font-size-xs)",
  letterSpacing: "0.10em",
  textTransform: "uppercase",
  cursor: "pointer",
  padding: 0,
};
