"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { updateCharacterMeta } from "@/app/(authenticated)/characters/actions";
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
} from "@odyssey/db";
import { DEFAULT_CHAT_MODEL, type ModelOption } from "@odyssey/engine";
import { KnowledgeGraphIcon } from "@/components/knowledge-graph-icon";
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
  useEffect(() => {
    setContent(
      <CharacterPageHeader
        characterSlug={character.slug}
        title={title}
        onTitleChange={saveTitle}
        avGradient={avGradient}
        image={image}
        initial={initial}
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
    avGradient,
    image,
    initial,
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
  avGradient,
  image,
  initial,
  versions,
  onSaveVersion,
  onRestoreVersion,
}: {
  characterSlug: string;
  title: string;
  onTitleChange: (next: string) => void | Promise<void>;
  avGradient: string;
  image: string | null;
  initial: string;
  versions: ConfigVersion[];
  onSaveVersion: () => void | Promise<void>;
  onRestoreVersion: (versionId: string) => void | Promise<void>;
}) {
  return (
    <>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 12,
          flexShrink: 0,
        }}
      >
        <div
          style={{
            width: 22,
            height: 22,
            background: image
              ? `center/cover no-repeat url("${image}"), var(--card-hover)`
              : avGradient,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            flexShrink: 0,
            border:
              "1px solid color-mix(in srgb, var(--accent-strong) 18%, transparent)",
          }}
        >
          {!image && (
            <span
              style={{
                fontFamily: T.fontHeading,
                fontSize: 11,
                fontWeight: 600,
                color: "rgba(12,14,20,0.85)",
                lineHeight: "12px",
              }}
            >
              {initial}
            </span>
          )}
        </div>
        <Link
          href="/characters"
          style={{
            fontFamily: T.fontMono,
            fontSize: 11,
            letterSpacing: "0.18em",
            textTransform: "uppercase",
            color: T.accent,
            textDecoration: "none",
            whiteSpace: "nowrap",
          }}
        >
          characters
        </Link>
        <span
          style={{
            fontFamily: T.fontMono,
            fontSize: 11,
            color: "var(--text-quaternary)",
          }}
        >
          /
        </span>
        <EditableText
          value={title}
          onChange={onTitleChange}
          ariaLabel="Character name"
          style={{
            fontFamily: T.fontHeading,
            fontSize: 15,
            fontWeight: 600,
            letterSpacing: "-0.01em",
            color: T.fg,
          }}
        />
      </div>

      <div style={{ flex: 1 }} />

      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
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
            gap: 8,
            padding: "7px 16px",
            border: `1px solid ${T.accent}`,
            background: T.accent,
            color: "var(--background)",
            fontFamily: T.fontHeading,
            fontSize: 12,
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
            border: `1px solid ${T.border}`,
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
    </>
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
          padding: "6px 12px",
          border: `1px solid ${open ? T.accent : T.border}`,
          background: open ? T.accentSoft : "transparent",
          color: open ? T.accent : "var(--text-tertiary)",
          fontFamily: T.fontMono,
          fontSize: 11,
          letterSpacing: "0.10em",
          textTransform: "uppercase",
          cursor: "pointer",
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
              gap: 8,
              padding: "8px 14px",
              border: "none",
              background: "transparent",
              color: T.fg,
              fontFamily: T.fontBody,
              fontSize: 12,
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
                fontSize: 10,
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
              fontSize: 9,
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
                fontSize: 11,
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
                  gap: 8,
                  width: "100%",
                  padding: "7px 14px",
                  border: "none",
                  background: "transparent",
                  fontFamily: T.fontBody,
                  fontSize: 12,
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
                <span style={{ fontFamily: T.fontMono, fontSize: 11 }}>
                  v{v.versionNumber}
                </span>
                <span
                  style={{
                    fontFamily: T.fontMono,
                    fontSize: 10,
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

/* ── EditableText ──────────────────────────────────────────────── */

/**
 * Click-to-edit inline text. Renders as a span by default; click swaps to
 * an input. Enter or blur commits the change (only if non-empty + changed);
 * Escape reverts.
 */
function EditableText({
  value,
  onChange,
  ariaLabel,
  style,
  maxLength = 80,
}: {
  value: string;
  onChange: (next: string) => void | Promise<void>;
  ariaLabel: string;
  style?: React.CSSProperties;
  maxLength?: number;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const inputRef = useRef<HTMLInputElement>(null);

  // Reset draft whenever the upstream value changes (e.g. live update from
  // a different surface that edited the same field).
  useEffect(() => {
    if (!editing) setDraft(value);
  }, [value, editing]);

  // Focus + select on edit-mode entry.
  useEffect(() => {
    if (editing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [editing]);

  function commit() {
    const next = draft.trim();
    if (next && next !== value) {
      void onChange(next);
    } else {
      setDraft(value);
    }
    setEditing(false);
  }

  // Shared box geometry so the layout stays put across non-edit / hover /
  // edit states. Only border-color + background swap; padding + margin +
  // border-width never change.
  const boxStyle: React.CSSProperties = {
    borderRadius: 6,
    padding: "2px 8px",
    margin: "-2px -8px",
    borderStyle: "solid",
    borderWidth: 1,
  };

  if (editing) {
    return (
      <input
        ref={inputRef}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            commit();
          } else if (e.key === "Escape") {
            e.preventDefault();
            setDraft(value);
            setEditing(false);
          }
        }}
        aria-label={ariaLabel}
        maxLength={maxLength}
        style={{
          ...style,
          ...boxStyle,
          background: "var(--input-bg)",
          borderColor: "var(--border)",
          outline: "none",
          minWidth: 80,
          color: "var(--foreground)",
        }}
      />
    );
  }

  return (
    <button
      type="button"
      onClick={() => setEditing(true)}
      aria-label={`Edit ${ariaLabel.toLowerCase()}`}
      style={{
        ...style,
        ...boxStyle,
        background: "transparent",
        // Border is always rendered — transparent in idle state so the box
        // size stays identical when it becomes visible on hover or edit.
        borderColor: "transparent",
        cursor: "text",
        textAlign: "left",
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.borderColor = "var(--border)";
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.borderColor = "transparent";
      }}
    >
      {value}
    </button>
  );
}

/* ── Canvas area (React Flow) ──────────────────────────────────── */

type CharacterNodeData = {
  character: CharacterRecord;
  identity: CharacterIdentity | null;
  voiceStyle: CharacterVoiceStyle | null;
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
        background: "var(--background)",
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
          style={{ background: "var(--background)" }}
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

      {/* Fixed overlays — stat hints + recent sessions float above the
          canvas, anchored to the page rather than the canvas viewport. */}
      <div
        style={{
          position: "absolute",
          top: 28,
          left: 32,
          display: "flex",
          flexDirection: "column",
          gap: 12,
          pointerEvents: "none",
        }}
      >
        <CornerStat
          label="knowledge graph"
          value={`${knowledge.pageCount} facts · ${knowledge.entityCount} entities`}
        />
        <CornerStat
          label="episodic memory"
          value={`${sessions.rememberedCount} sessions remembered`}
        />
      </div>
    </div>
  );
}

function CharacterNode({
  data,
  selected,
}: NodeProps<FlowNode<CharacterNodeData>>) {
  // Fixed width inside the node — React Flow nodes don't get flex sizing
  // from their parent, so the card's responsive maxWidth doesn't apply.
  //
  // Selection ring: 6px accent halo at 40% opacity. Hover: a thinner, more
  // subtle ring as an affordance. color-mix() lets the alpha apply to the
  // theme token so the ring stays in the right palette per theme.
  const [hovered, setHovered] = useState(false);

  const selectedRing =
    "0 0 0 6px color-mix(in srgb, var(--accent-strong) 40%, transparent)";
  const hoverRing =
    "0 0 0 3px color-mix(in srgb, var(--accent-strong) 20%, transparent)";

  return (
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        // Square node: width drives the aspect ratio set on the card below.
        width: 420,
        boxShadow: selected ? selectedRing : hovered ? hoverRing : "none",
        transition: "box-shadow 120ms ease",
      }}
    >
      <CharacterCard
        character={data.character}
        identity={data.identity}
        voiceStyle={data.voiceStyle}
        brainModel={data.brainModel}
        bindings={data.bindings}
        gradient={data.gradient}
        image={data.image}
        initial={data.initial}
        onSelectTab={data.onSelectTab}
      />
    </div>
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
        gap: 4,
        maxWidth: 260,
      }}
    >
      <span
        style={{
          fontFamily: T.fontMono,
          fontSize: 9,
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
          fontSize: 11,
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
        gap: 16,
        overflow: "hidden",
      }}
    >
      {/* top row — CHARACTER label on the left, slug on the right */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 8,
        }}
      >
        <div
          style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}
        >
          <span
            style={{
              fontFamily: T.fontMono,
              fontSize: 10,
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
            fontSize: 10,
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
      <div style={{ display: "flex", alignItems: "flex-start", gap: 18 }}>
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
            gap: 10,
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
            <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
              {identity.traits
                .filter((t) => t.name.trim())
                .map((t) => (
                  <span
                    key={t.name}
                    title={t.description || undefined}
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 6,
                      fontFamily: T.fontBody,
                      fontSize: 12,
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
              fontSize: 13,
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
      <div style={{ display: "flex", gap: 8 }}>
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
            tones.length === 0 ? "no style yet" : tones.slice(0, 2).join(" · ")
          }
          dim={tones.length === 0}
          tooltip={
            tones.length === 0
              ? "Voice style not configured"
              : `Tones: ${tones.join(", ")}`
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
        gap: 8,
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
          gap: 1,
          minWidth: 0,
          flex: 1,
        }}
      >
        <span
          style={{
            fontFamily: T.fontMono,
            fontSize: 9,
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
            fontSize: 11,
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
        border:
          "1px solid color-mix(in srgb, var(--accent-strong) 18%, transparent)",
        cursor: "pointer",
        boxShadow: hovered
          ? "0 0 0 2px color-mix(in srgb, var(--accent-strong) 35%, transparent)"
          : "none",
        transition: "box-shadow 120ms ease",
      }}
    >
      {!image && (
        <span
          style={{
            fontFamily: T.fontHeading,
            fontSize: 22,
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

  return (
    <aside
      style={{
        width: 480,
        flexShrink: 0,
        position: "sticky",
        top: 0,
        alignSelf: "flex-start",
        // Admin shell's top header is 48px — sticky sidebar fits below it.
        height: "calc(100vh - 48px)",
        background: "rgba(255,255,255,0.02)",
        borderLeft: `1px solid ${T.border}`,
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
      }}
    >
      {/* sidebar header */}
      <div
        style={{
          padding: "20px 24px 0",
          display: "flex",
          alignItems: "flex-start",
          justifyContent: "space-between",
          gap: 8,
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
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
              gap: 1,
              minWidth: 0,
            }}
          >
            <EditableText
              value={props.title}
              onChange={props.onTitleChange}
              ariaLabel="Character name"
              style={{
                fontFamily: T.fontHeading,
                fontSize: 16,
                fontWeight: 600,
                color: T.fg,
                letterSpacing: "-0.01em",
              }}
            />
            <span
              style={{
                fontFamily: T.fontMono,
                fontSize: 10,
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
            width: 28,
            height: 26,
            border: `1px solid ${T.border}`,
            background: "transparent",
            color: "var(--text-tertiary)",
            cursor: "pointer",
            fontFamily: T.fontMono,
            fontSize: 12,
          }}
        >
          ⋯
        </button>
      </div>

      {/* tabs */}
      <div
        style={{
          padding: "16px 24px 0",
          borderBottom: `1px solid ${T.border}`,
          display: "flex",
          gap: 4,
          flexWrap: "wrap",
        }}
      >
        {tabs.map((t) => {
          const active = t.key === props.tab;
          return (
            <button
              key={t.key}
              type="button"
              onClick={() => props.onTabChange(t.key)}
              style={{
                padding: "8px 14px",
                marginBottom: -1,
                border: "none",
                borderBottom: `2px solid ${active ? T.accent : "transparent"}`,
                background: "transparent",
                color: active ? T.accent : "var(--text-tertiary)",
                fontFamily: T.fontMono,
                fontSize: 11,
                letterSpacing: "0.14em",
                textTransform: "uppercase",
                fontWeight: active ? 600 : 400,
                cursor: "pointer",
              }}
            >
              {t.label}
            </button>
          );
        })}
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
            initialVoiceId={props.character.voiceId}
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
    <section style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <SectionHeader title={title} hint={hint} status={status} info={info} />
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
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
          gap: 8,
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "baseline",
            gap: 8,
            minWidth: 0,
          }}
        >
          <h3
            style={{
              fontFamily: T.fontHeading,
              fontSize: 18,
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
                background: open ? T.accentSoft : "transparent",
                color: open ? T.accent : "var(--text-tertiary)",
                fontFamily: T.fontMono,
                fontSize: 10,
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
                fontSize: 10,
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
        background: "var(--card)",
        border: `1px solid ${T.border}`,
        padding: "14px 16px 12px",
        boxShadow: "0 16px 40px var(--shadow, rgba(0,0,0,0.40))",
        display: "flex",
        flexDirection: "column",
        gap: 12,
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
          gap: 8,
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "baseline",
            gap: 8,
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
              fontSize: 10,
              color: T.muted,
              letterSpacing: "0.04em",
            }}
          >
            section info
          </span>
        </div>
        {info.tokens && (
          <span
            style={{ fontFamily: T.fontMono, fontSize: 10, color: T.muted }}
          >
            {info.tokens}
          </span>
        )}
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        <span
          style={{
            fontFamily: T.fontMono,
            fontSize: 9,
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
            fontSize: 12,
            lineHeight: 1.55,
            color: T.fg,
          }}
        >
          {info.what}
        </p>
      </div>

      {info.promptShape && (
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <span
            style={{
              fontFamily: T.fontMono,
              fontSize: 9,
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
              fontFamily: T.fontMono,
              fontSize: 11,
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
            gap: 8,
            paddingTop: 4,
            borderTop: `1px solid ${T.border}`,
            marginTop: 2,
          }}
        >
          <span
            style={{
              fontFamily: T.fontMono,
              fontSize: 10,
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
              fontSize: 10,
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
        gap: 6,
        fontFamily: T.fontMono,
        fontSize: 9,
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
  initialVoiceId,
}: {
  characterId: string;
  voiceStyle: CharacterVoiceStyle | null;
  onVoiceStyleChange: (v: CharacterVoiceStyle | null) => void;
  initialVoiceId: string | null;
}) {
  return (
    <>
      <VoiceStyleSection
        characterId={characterId}
        voiceStyle={voiceStyle}
        onChange={onVoiceStyleChange}
        initialVoiceId={initialVoiceId}
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
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
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
              fontSize: 10,
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
        alignItems: "flex-start",
        justifyContent: "center",
        padding: "10vh 24px",
        overflow: "auto",
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "100%",
          maxWidth: 480,
          background: "var(--card)",
          border: `1px solid ${T.border}`,
          boxShadow: "0 24px 60px var(--shadow, rgba(0,0,0,0.40))",
          display: "flex",
          flexDirection: "column",
        }}
      >
        {/* Header */}
        <div
          style={{
            padding: "18px 20px 14px",
            display: "flex",
            alignItems: "flex-start",
            justifyContent: "space-between",
            gap: 12,
          }}
        >
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <span
              style={{
                fontFamily: T.fontMono,
                fontSize: 11,
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
                fontSize: 16,
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
              fontSize: 18,
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
            gap: 8,
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "baseline",
              justifyContent: "space-between",
              gap: 8,
            }}
          >
            <span
              style={{
                fontFamily: T.fontMono,
                fontSize: 10,
                color: T.muted,
                letterSpacing: "0.04em",
              }}
            >
              suggested
            </span>
            <span
              style={{
                fontFamily: T.fontMono,
                fontSize: 9,
                color: T.muted,
                opacity: 0.7,
              }}
            >
              curated · generic
            </span>
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
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
                    background: selected ? T.accentSoft : "transparent",
                    color: selected ? T.accent : T.fg,
                    fontFamily: T.fontMono,
                    fontSize: 11,
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
            gap: 10,
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "baseline",
              justifyContent: "space-between",
              gap: 8,
            }}
          >
            <span
              style={{
                fontFamily: T.fontMono,
                fontSize: 10,
                color: T.muted,
                letterSpacing: "0.04em",
              }}
            >
              or write your own
            </span>
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
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
                  fontSize: 10,
                  color: T.danger,
                }}
              >
                already added — pick a different name
              </span>
            )}
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
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
              style={{ ...textareaStyle, fontSize: 12 }}
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
            gap: 12,
          }}
        >
          <span
            style={{
              fontFamily: T.fontMono,
              fontSize: 10,
              color: T.muted,
              letterSpacing: "0.04em",
            }}
          >
            <KeyChip>↵</KeyChip> saves · <KeyChip>esc</KeyChip> cancels
          </span>
          <div style={{ display: "flex", gap: 8 }}>
            <button
              type="button"
              onClick={onCancel}
              style={{
                padding: "7px 16px",
                border: `1px solid ${T.border}`,
                background: "transparent",
                color: T.fg,
                fontFamily: T.fontHeading,
                fontSize: 12,
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
                background: canSave ? T.accent : "var(--card-hover)",
                color: canSave ? "var(--background)" : "var(--text-tertiary)",
                fontFamily: T.fontHeading,
                fontSize: 12,
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
          padding: 12,
          display: "flex",
          flexDirection: "column",
          gap: 8,
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
          style={{ ...textareaStyle, fontSize: 12 }}
        />
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
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
        gap: 4,
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
            fontSize: 14,
            fontWeight: 600,
            color: T.fg,
            display: "flex",
            alignItems: "center",
            gap: 6,
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
            fontSize: 12,
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

      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
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
              fontSize: 10,
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
        gap: 6,
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "flex-start",
          justifyContent: "space-between",
          gap: 8,
        }}
      >
        <span
          style={{
            fontFamily: T.fontBody,
            fontSize: 12,
            fontWeight: 500,
            color: T.fg,
            lineHeight: 1.5,
          }}
        >
          &ldquo;{exemplar.user}&rdquo;
        </span>
        <div style={{ display: "flex", gap: 8, flexShrink: 0 }}>
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
          fontSize: 12,
          color: T.muted,
          lineHeight: 1.5,
        }}
      >
        {exemplar.you}
      </span>
      {(exemplar.tags?.length ?? 0) > 0 && (
        <div
          style={{ display: "flex", flexWrap: "wrap", gap: 4, marginTop: 2 }}
        >
          {exemplar.tags!.map((t) => (
            <span
              key={t}
              style={{
                padding: "3px 8px",
                background: T.accentSoft,
                border:
                  "1px solid color-mix(in srgb, var(--accent-strong) 30%, transparent)",
                fontFamily: T.fontMono,
                fontSize: 10,
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
        alignItems: "flex-start",
        justifyContent: "center",
        padding: "8vh 24px",
        overflow: "auto",
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "100%",
          maxWidth: 560,
          background: "var(--card)",
          border: `1px solid ${T.border}`,
          boxShadow: "0 24px 60px var(--shadow, rgba(0,0,0,0.40))",
          display: "flex",
          flexDirection: "column",
        }}
      >
        {/* Header */}
        <div
          style={{
            padding: "18px 20px 14px",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 12,
          }}
        >
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <span
              style={{
                fontFamily: T.fontMono,
                fontSize: 11,
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
                fontSize: 16,
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
              fontSize: 18,
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
            gap: 14,
          }}
        >
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
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
                  fontSize: 10,
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
                  fontSize: 9,
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
              style={{ ...textareaStyle, fontSize: 13 }}
            />
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
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
                  fontSize: 10,
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
                  fontSize: 9,
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
              style={{ ...textareaStyle, fontSize: 13 }}
            />
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <span
              style={{
                fontFamily: T.fontMono,
                fontSize: 10,
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
              style={{ ...textareaStyle, fontSize: 12 }}
            />
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <span
              style={{
                fontFamily: T.fontMono,
                fontSize: 10,
                color: T.muted,
                letterSpacing: "0.04em",
              }}
            >
              <strong style={{ color: T.fg, fontWeight: 600 }}>tags</strong>{" "}
              &nbsp;topics this example covers · feeds the character&rsquo;s
              scope at runtime
            </span>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
              {tags.map((t) => (
                <span
                  key={t}
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 6,
                    padding: "3px 10px",
                    background: T.accentSoft,
                    border:
                      "1px solid color-mix(in srgb, var(--accent-strong) 30%, transparent)",
                    fontFamily: T.fontMono,
                    fontSize: 10,
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
                      fontSize: 10,
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
                  fontSize: 11,
                }}
              />
              {unusedSuggestion && draftTag.length === 0 && (
                <span
                  style={{
                    fontFamily: T.fontMono,
                    fontSize: 10,
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
                      fontSize: 10,
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
            gap: 12,
          }}
        >
          <span
            style={{
              fontFamily: T.fontMono,
              fontSize: 10,
              color: T.muted,
              letterSpacing: "0.04em",
            }}
          >
            <KeyChip>⌘ ↵</KeyChip> saves · <KeyChip>esc</KeyChip> cancels
          </span>
          <div style={{ display: "flex", gap: 8 }}>
            <button
              type="button"
              onClick={onCancel}
              style={{
                padding: "7px 16px",
                border: `1px solid ${T.border}`,
                background: "transparent",
                color: T.fg,
                fontFamily: T.fontHeading,
                fontSize: 12,
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
                background: canSave ? T.accent : "var(--card-hover)",
                color: canSave ? "var(--background)" : "var(--text-tertiary)",
                fontFamily: T.fontHeading,
                fontSize: 12,
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
  initialVoiceId,
}: {
  characterId: string;
  voiceStyle: CharacterVoiceStyle | null;
  onChange: (v: CharacterVoiceStyle | null) => void;
  initialVoiceId: string | null;
}) {
  const [draftTone, setDraftTone] = useState("");

  const persist = useDebouncedSave(async (next: CharacterVoiceStyle) => {
    await fetch(`/api/characters/${characterId}/voice-style`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ voiceStyle: next }),
    });
  });

  // Voice-library binding. Lives as local state because it's independent
  // of the voiceStyle JSON column and persists via its own endpoint.
  const [voiceId, setVoiceId] = useState<string | null>(initialVoiceId);
  const [voiceOptions, setVoiceOptions] = useState<PickerVoice[]>([]);
  const [voiceError, setVoiceError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/voices")
      .then((r) => r.json())
      .then((data: { voices: PickerVoice[] }) => {
        if (cancelled) return;
        // Only ready voices can be bound — others would fail PATCH validation.
        setVoiceOptions(data.voices.filter((v) => v.status === "ready"));
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  const saveVoiceId = useCallback(
    async (next: string | null) => {
      const prev = voiceId;
      setVoiceId(next);
      setVoiceError(null);
      const res = await fetch(`/api/characters/${characterId}/voice`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ voiceId: next }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setVoiceError(body.error ?? `HTTP ${res.status}`);
        setVoiceId(prev);
      }
    },
    [characterId, voiceId],
  );

  const save = useCallback(
    (next: CharacterVoiceStyle) => {
      onChange(next);
      persist(next);
    },
    [onChange, persist],
  );

  const tones = voiceStyle?.tone ?? [];
  const brevity = voiceStyle?.brevity ?? "short";
  const formality = voiceStyle?.register?.formality ?? 0;
  const warmth = voiceStyle?.register?.warmth ?? 0;

  const status = tones.length > 0 ? "set" : "empty";

  return (
    <Section
      title="Voice & Style"
      hint="tone, length, register"
      status={status}
      info={SECTION_INFO.voiceStyle}
    >
      <FieldLabel>how they sound · {tones.length} chips</FieldLabel>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
        {tones.map((t) => (
          <span
            key={t}
            style={{
              padding: "3px 10px",
              background: T.accentSoft,
              border:
                "1px solid color-mix(in srgb, var(--accent-strong) 30%, transparent)",
              fontFamily: T.fontMono,
              fontSize: 10,
              letterSpacing: "0.10em",
              textTransform: "uppercase",
              color: T.accent,
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
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
                fontSize: 10,
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
            style={{
              ...inputStyle,
              width: 110,
              padding: "3px 8px",
              fontSize: 11,
            }}
          />
        )}
      </div>

      <FieldLabel>brevity</FieldLabel>
      <div style={{ display: "flex", gap: 4 }}>
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
                background: active ? T.accentSoft : "transparent",
                color: active ? T.accent : "var(--text-tertiary)",
                fontFamily: T.fontMono,
                fontSize: 10,
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

      <VoiceLibraryPicker
        currentVoiceId={voiceId}
        voices={voiceOptions}
        onChange={saveVoiceId}
      />
      {voiceError && (
        <div
          style={{
            padding: "8px 10px",
            background: "rgba(232,160,160,0.06)",
            border: "1px solid rgba(232,160,160,0.30)",
            color: "#E8A0A0",
            fontFamily: T.fontMono,
            fontSize: 11,
          }}
        >
          {voiceError}
        </div>
      )}

      <FieldLabel>voice prompt (TTS)</FieldLabel>
      <textarea
        value={voiceStyle?.voicePrompt ?? ""}
        onChange={(e) =>
          save({ ...(voiceStyle ?? {}), voicePrompt: e.target.value })
        }
        placeholder="older man, weathered by long travel; unhurried cadence; soft consonants"
        rows={2}
        style={textareaStyle}
      />
    </Section>
  );
}

function fmtSigned(n: number): string {
  if (n === 0) return "0.0";
  return (n > 0 ? "+" : "") + n.toFixed(1);
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
        gap: 6,
        padding: "10px 12px",
        background: T.panel,
        border: `1px solid ${T.border}`,
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
            fontSize: 10,
            color: T.muted,
            letterSpacing: "0.04em",
          }}
        >
          {label}
        </span>
        <span style={{ fontFamily: T.fontMono, fontSize: 10, color: T.muted }}>
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
        gap: 8,
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 8,
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
            gap: 6,
            padding: "3px 10px",
            background: T.accentSoft,
            border:
              "1px solid color-mix(in srgb, var(--accent-strong) 30%, transparent)",
            fontFamily: T.fontMono,
            fontSize: 9,
            letterSpacing: "0.18em",
            textTransform: "uppercase",
            color: T.accent,
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
          fontSize: 10,
          color: T.muted,
          letterSpacing: "0.04em",
        }}
      >
        {model.provider}
        {model.label ? ` · ${model.label}` : ""}
      </span>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
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
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      style={{
        padding: "9px 12px",
        border: `1px solid ${T.border}`,
        background: "var(--card)",
        color: T.fg,
        fontFamily: T.fontMono,
        fontSize: 12,
        width: "100%",
        cursor: "pointer",
      }}
    >
      {allowEmpty && <option value="">— inherit chat model —</option>}
      {models.map((m) => (
        <option key={m.id} value={m.id}>
          {m.id} · {m.provider}
        </option>
      ))}
    </select>
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
        gap: 10,
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "baseline",
        }}
      >
        <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
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
              fontSize: 11,
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
          height: 3,
          background: "var(--card-hover)",
          overflow: "hidden",
        }}
      >
        <div
          style={{
            width: `${pct}%`,
            height: "100%",
            background: T.accent,
          }}
        />
      </div>
      <span
        style={{
          fontFamily: T.fontMono,
          fontSize: 10,
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
          fontSize: 9,
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
        fontFamily: T.fontMono,
        fontSize: 10,
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
            style={{ fontFamily: T.fontMono, fontSize: 10, color: T.muted }}
          >
            browse library ↗
          </span>
        </Link>
        <span
          style={{
            fontFamily: T.fontMono,
            fontSize: 10,
            color: T.muted,
            lineHeight: 1.5,
            marginTop: 4,
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
        gap: 10,
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 8,
        }}
      >
        <Link
          href={`/wikis/${wiki.id}`}
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 10,
            color: T.fg,
            textDecoration: "none",
            fontFamily: T.fontHeading,
            fontSize: 14,
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
            gap: 6,
            flexShrink: 0,
          }}
        >
          <select
            value={binding.priority}
            onChange={(e) =>
              onPriorityChange(e.target.value as BindingPriority)
            }
            style={{
              padding: "3px 8px",
              border: `1px solid ${color.border}`,
              background: color.bg,
              color: color.fg,
              fontFamily: T.fontMono,
              fontSize: 10,
              letterSpacing: "0.10em",
              textTransform: "uppercase",
              cursor: "pointer",
            }}
          >
            {PRIORITY_OPTIONS.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
          <Toggle on={binding.isActive} onChange={onActiveChange} />
        </div>
      </div>
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: 12,
          fontFamily: T.fontMono,
          fontSize: 10,
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
        borderRadius: 999,
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
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
          {refusals.map((r) => (
            <span
              key={r}
              style={{
                padding: "3px 10px",
                background: T.dangerSoft,
                border:
                  "1px solid color-mix(in srgb, var(--danger) 30%, transparent)",
                fontFamily: T.fontMono,
                fontSize: 10,
                letterSpacing: "0.10em",
                textTransform: "uppercase",
                color: T.danger,
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
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
                  fontSize: 10,
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
            style={{
              ...inputStyle,
              width: 140,
              padding: "3px 8px",
              fontSize: 11,
            }}
          />
        </div>
        <span
          style={{
            fontFamily: T.fontBody,
            fontSize: 11,
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
              gap: 10,
            }}
          >
            <span
              style={{
                fontFamily: T.fontMono,
                fontSize: 10,
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
                fontSize: 12,
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
        fontSize: 12,
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
        gap: 12,
      }}
    >
      <div
        style={{ flex: 1, display: "flex", flexDirection: "column", gap: 6 }}
      >
        <span
          style={{
            fontFamily: T.fontMono,
            fontSize: 10,
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
          background: "var(--card)",
          border: `1px solid ${T.border}`,
          boxShadow: "0 24px 60px var(--shadow, rgba(0,0,0,0.40))",
          display: "flex",
          flexDirection: "column",
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
            gap: 12,
            borderBottom: `1px solid ${T.border}`,
          }}
        >
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: 6,
              minWidth: 0,
            }}
          >
            <span
              style={{
                fontFamily: T.fontMono,
                fontSize: 11,
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
                fontSize: 18,
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
                fontSize: 10,
                color: "var(--text-tertiary)",
                letterSpacing: "0.10em",
              }}
            >
              {view === "rendered"
                ? `for next session · current config of ${title.toLowerCase()}`
                : "abstract template · slot markers + conditionals"}
            </span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
            <span
              style={{
                fontFamily: T.fontMono,
                fontSize: 11,
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
                background: "transparent",
                color: "var(--text-tertiary)",
                cursor: "pointer",
                fontSize: 16,
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
            gap: 14,
          }}
        >
          <div
            style={{
              display: "inline-flex",
              padding: 0,
              border: `1px solid ${T.border}`,
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
                    fontSize: 11,
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
            style={{ fontFamily: T.fontMono, fontSize: 10, color: T.muted }}
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
            gap: 10,
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
              gap: 8,
              padding: "10px 4px 4px",
            }}
          >
            <span
              style={{
                fontFamily: T.fontMono,
                fontSize: 10,
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
            gap: 12,
          }}
        >
          <span
            style={{
              fontFamily: T.fontMono,
              fontSize: 10,
              color: T.muted,
              letterSpacing: "0.04em",
            }}
          >
            <KeyChip>⌘ C</KeyChip> {copied ? "copied" : "copies"} ·{" "}
            <KeyChip>esc</KeyChip> closes
          </span>
          <div style={{ display: "flex", gap: 8 }}>
            <button
              type="button"
              onClick={copyPrompt}
              style={{
                padding: "7px 16px",
                border: `1px solid ${T.border}`,
                background: "transparent",
                color: T.fg,
                fontFamily: T.fontHeading,
                fontSize: 12,
                fontWeight: 500,
                cursor: "pointer",
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
              }}
            >
              <span style={{ fontFamily: T.fontMono, fontSize: 11 }}>
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
                background: T.accent,
                color: "var(--background)",
                fontFamily: T.fontHeading,
                fontSize: 12,
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
        gap: 8,
        cursor: jumpable ? "pointer" : "default",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "baseline",
          justifyContent: "space-between",
          gap: 8,
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "baseline",
            gap: 8,
            minWidth: 0,
          }}
        >
          <span
            style={{ fontFamily: T.fontMono, fontSize: 11, color: T.muted }}
          >
            —
          </span>
          <span
            style={{
              fontFamily: T.fontMono,
              fontSize: 12,
              fontWeight: 600,
              color: T.fg,
            }}
          >
            {section.label}
          </span>
          <span
            style={{
              fontFamily: T.fontMono,
              fontSize: 10,
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
            gap: 10,
            flexShrink: 0,
          }}
        >
          <span
            style={{ fontFamily: T.fontMono, fontSize: 10, color: T.muted }}
          >
            {section.tokens} tokens
          </span>
          {jumpable && (
            <span
              style={{
                fontFamily: T.fontMono,
                fontSize: 10,
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
            fontSize: 12,
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
        borderRadius: 999,
        background: "var(--card-hover)",
        border: `1px solid ${T.border}`,
        fontFamily: T.fontMono,
        fontSize: 10,
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
        borderRadius: 4,
        border: `1px solid ${T.border}`,
        background: "var(--card-hover)",
        fontFamily: T.fontMono,
        fontSize: 9,
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
        fontSize: 10,
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
          fontSize: 12,
          color: T.muted,
          lineHeight: 1.5,
        }}
      >
        {children}
      </span>
    </div>
  );
}

const cardShell: React.CSSProperties = {
  background: T.panel,
  border: `1px solid ${T.border}`,
};

const inputStyle: React.CSSProperties = {
  padding: "9px 12px",
  border: `1px solid ${T.border}`,
  background: "var(--card)",
  color: T.fg,
  fontFamily: T.fontBody,
  fontSize: 13,
  width: "100%",
  outline: "none",
};

const textareaStyle: React.CSSProperties = {
  ...inputStyle,
  fontFamily: T.fontBody,
  fontSize: 13,
  lineHeight: 1.5,
  resize: "vertical",
};

const addButtonStyle: React.CSSProperties = {
  padding: "10px 14px",
  border: `1px solid ${T.border}`,
  background: "color-mix(in srgb, var(--accent-strong) 4%, transparent)",
  color: T.fg,
  fontFamily: T.fontBody,
  fontSize: 13,
  fontWeight: 500,
  cursor: "pointer",
  width: "100%",
  textAlign: "left",
};

const primaryButtonStyle: React.CSSProperties = {
  padding: "7px 16px",
  border: `1px solid ${T.accent}`,
  background: T.accent,
  color: "var(--background)",
  fontFamily: T.fontHeading,
  fontSize: 12,
  fontWeight: 600,
  cursor: "pointer",
};

const ghostButtonStyle: React.CSSProperties = {
  padding: "6px 12px",
  border: `1px solid ${T.border}`,
  background: "transparent",
  color: "var(--text-tertiary)",
  fontFamily: T.fontMono,
  fontSize: 10,
  letterSpacing: "0.14em",
  textTransform: "uppercase",
  cursor: "pointer",
};

const editLinkStyle: React.CSSProperties = {
  border: "none",
  background: "transparent",
  color: "var(--text-tertiary)",
  fontFamily: T.fontMono,
  fontSize: 10,
  letterSpacing: "0.10em",
  textTransform: "uppercase",
  cursor: "pointer",
  padding: 0,
};
