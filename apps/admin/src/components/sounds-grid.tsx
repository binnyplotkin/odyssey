"use client";

import { useRouter } from "next/navigation";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
} from "react";
import { useHeaderContent } from "@/components/header-context";
import { SortMenu } from "@/components/sort-menu";
import { SoundCreateDialog } from "@/components/sound-create-dialog";
import { ingestAudioBytes } from "@/lib/audio-ingest";
import {
  archiveSound,
  deleteSound,
  updateSoundMeta,
} from "@/app/(authenticated)/sounds/actions";
import type { SoundSummary } from "@/app/(authenticated)/sounds/page";
import type { AudioAssetStatus } from "@odyssey/db";
import {
  ConfirmModal,
  ContextMenu,
  ContextMenuTriggerButton,
  type ContextMenuItem,
} from "@odyssey/ui";

/* ── Theme tokens ─────────────────────────────────────────────── */

const FONT_HEAD = "'Inter', system-ui, sans-serif";
const FONT_MONO = "'JetBrains Mono', ui-monospace, monospace";
const ACCENT = "var(--accent-strong)";

const STATUS_COLORS: Record<AudioAssetStatus, string> = {
  ready: "var(--accent-strong)",
  uploaded: "var(--status-draft)",
  failed: "var(--status-error)",
};

const STATUS_LABELS: Record<AudioAssetStatus, string> = {
  ready: "ready",
  uploaded: "needs processing",
  failed: "failed",
};

/* ── Sort ─────────────────────────────────────────────────────── */

type SortKey = "recent" | "name";

const SORT_OPTIONS: { key: SortKey; label: string }[] = [
  { key: "recent", label: "Recently added" },
  { key: "name", label: "Name A–Z" },
];

function applySort(list: SoundSummary[], sort: SortKey): SoundSummary[] {
  const base = [...list];
  if (sort === "name") return base.sort((a, b) => a.name.localeCompare(b.name));
  return base.sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
  );
}

function formatDuration(s: number | null): string {
  if (s == null) return "—";
  if (s < 60) return `${s.toFixed(1)}s`;
  const m = Math.floor(s / 60);
  const r = Math.round(s % 60);
  return `${m}m ${r}s`;
}

/* ── Component ────────────────────────────────────────────────── */

type Props = { sounds: SoundSummary[] };

export function SoundsGrid({ sounds }: Props) {
  const router = useRouter();
  const [search, setSearch] = useState("");
  const [tagFilter, setTagFilter] = useState<string | null>(null);
  const [sort, setSort] = useState<SortKey>("recent");
  const [createOpen, setCreateOpen] = useState(false);
  const [editing, setEditing] = useState<SoundSummary | null>(null);
  const [pendingDelete, setPendingDelete] = useState<SoundSummary | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  /* One shared Audio element for preview playback so cards never play
   * over one another. */
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [playingId, setPlayingId] = useState<string | null>(null);

  const togglePlay = useCallback((sound: SoundSummary) => {
    let el = audioRef.current;
    if (!el) {
      el = new Audio();
      audioRef.current = el;
    }
    if (playingId === sound.id) {
      el.pause();
      el.src = "";
      setPlayingId(null);
      return;
    }
    el.pause();
    el.src = `/api/sounds/${sound.id}/stream`;
    el.loop = sound.loopable;
    el.onended = () => setPlayingId(null);
    void el.play().catch(() => setPlayingId(null));
    setPlayingId(sound.id);
  }, [playingId]);

  // Stop playback when leaving the page.
  useEffect(() => {
    return () => {
      audioRef.current?.pause();
    };
  }, []);

  /* Re-ingest an asset whose processed WAV is missing (seeded/migrated
   * rows): fetch the source bytes, run the client ingest pass, attach. */
  const [processingId, setProcessingId] = useState<string | null>(null);
  const processSound = useCallback(
    async (sound: SoundSummary) => {
      setProcessingId(sound.id);
      try {
        const res = await fetch(`/api/sounds/${sound.id}/stream?variant=source`);
        if (!res.ok) throw new Error(`source unavailable (HTTP ${res.status})`);
        const ingested = await ingestAudioBytes(await res.arrayBuffer());
        const form = new FormData();
        form.append("assetId", sound.id);
        form.append(
          "processed",
          new File([ingested.processedWavBytes as BlobPart], `${sound.slug}.wav`, {
            type: "audio/wav",
          }),
        );
        form.append("durationS", String(ingested.durationS));
        form.append("rmsDb", String(ingested.rmsDb));
        form.append("peakDb", String(ingested.peakDb));
        const save = await fetch("/api/sounds", { method: "POST", body: form });
        if (!save.ok) {
          const body = await save.json().catch(() => ({}));
          throw new Error(body.error ?? `HTTP ${save.status}`);
        }
        router.refresh();
      } catch (err) {
        setToast(`Process failed: ${(err as Error).message}`);
      } finally {
        setProcessingId(null);
      }
    },
    [router],
  );

  const onConfirmDelete = useCallback(async () => {
    if (!pendingDelete) return;
    setDeleting(true);
    const result = await deleteSound(pendingDelete.id);
    setDeleting(false);
    if (!result.ok) {
      setToast(result.error);
      return;
    }
    setPendingDelete(null);
    router.refresh();
  }, [pendingDelete, router]);

  const onArchive = useCallback(
    async (sound: SoundSummary) => {
      const result = await archiveSound(sound.id);
      if (!result.ok) setToast(result.error);
      else router.refresh();
    },
    [router],
  );

  const existingSlugs = useMemo(() => sounds.map((s) => s.slug), [sounds]);

  const allTags = useMemo(() => {
    const set = new Set<string>();
    for (const s of sounds) for (const t of s.tags) set.add(t);
    return [...set].sort();
  }, [sounds]);

  const filtered = useMemo(() => {
    let base = sounds;
    if (tagFilter) base = base.filter((s) => s.tags.includes(tagFilter));
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      base = base.filter(
        (s) =>
          s.name.toLowerCase().includes(q) ||
          s.slug.toLowerCase().includes(q) ||
          (s.description ?? "").toLowerCase().includes(q) ||
          s.tags.some((t) => t.toLowerCase().includes(q)),
      );
    }
    return applySort(base, sort);
  }, [sounds, search, tagFilter, sort]);

  /* ── Header injection ───────────────────────────────────────── */

  const { setContent, setFlush } = useHeaderContent();
  useEffect(() => {
    setFlush(true);
    setContent(
      <div
        style={{
          height: "100%",
          flex: 1,
          minWidth: 0,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: "var(--space-8)",
        }}
      >
        <span
          style={{
            fontFamily: FONT_MONO,
            fontSize: "var(--font-size-sm)",
            letterSpacing: "0.18em",
            textTransform: "uppercase",
            color: "var(--text-tertiary)",
            whiteSpace: "nowrap",
          }}
        >
          SOUNDS
        </span>
        <NewSoundButton onClick={() => setCreateOpen(true)} />
      </div>,
    );
    return () => {
      setContent(null);
      setFlush(false);
    };
  }, [setContent, setFlush]);

  /* ── Empty state ────────────────────────────────────────────── */

  if (sounds.length === 0) {
    return (
      <div
        style={{
          minHeight: "100%",
          background: "var(--background)",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          padding: "96px 32px",
          gap: 24,
        }}
      >
        <div
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: "var(--space-8)",
            fontFamily: FONT_MONO,
            fontSize: "var(--font-size-sm)",
            letterSpacing: "0.18em",
            textTransform: "uppercase",
            color: ACCENT,
          }}
        >
          <span
            style={{
              width: 6,
              height: 6,
              borderRadius: "50%",
              background: ACCENT,
              boxShadow: `0 0 8px ${ACCENT}`,
            }}
          />
          Enviro Sounds · Ready to populate
        </div>
        <h2
          style={{
            fontFamily: FONT_HEAD,
            fontSize: 44,
            fontWeight: 600,
            letterSpacing: "-0.02em",
            margin: 0,
            color: "var(--text-primary)",
            textAlign: "center",
          }}
        >
          Your enviro sounds library is empty
        </h2>
        <p
          style={{
            fontFamily: FONT_HEAD,
            fontSize: "var(--font-size-lg)",
            lineHeight: "22px",
            color: "var(--text-secondary)",
            margin: 0,
            maxWidth: 560,
            textAlign: "center",
          }}
        >
          Upload ambience beds and one-shot effects — or generate them from a
          prompt — then place them in scenes as audio nodes for the director
          to cue.
        </p>
        <button
          type="button"
          onClick={() => setCreateOpen(true)}
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: "var(--space-8)",
            padding: "12px 22px",
            borderRadius: "var(--radius-pill)",
            border: "none",
            background: ACCENT,
            color: "var(--background)",
            fontFamily: FONT_HEAD,
            fontSize: "var(--font-size-lg)",
            fontWeight: 600,
            cursor: "pointer",
          }}
        >
          + Add your first enviro sound
        </button>
        <SoundCreateDialog
          open={createOpen}
          onClose={() => setCreateOpen(false)}
          existingSlugs={existingSlugs}
        />
      </div>
    );
  }

  /* ── Populated state ────────────────────────────────────────── */

  return (
    <div
      style={{
        minHeight: "100%",
        background: "var(--background)",
        display: "flex",
        flexDirection: "column",
      }}
    >
      {/* Toolbar — search + tag filter + count + sort */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: "var(--space-16)",
          flexWrap: "wrap",
          padding: "24px 40px",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "var(--space-16)",
            flex: "1 1 490px",
            flexWrap: "wrap",
            minWidth: 0,
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: "var(--space-10)",
              padding: "9px 16px",
              background: "var(--control-bg)",
              border: "1px solid var(--control-border)",
              borderRadius: "var(--radius-pill)",
              width: 360,
              maxWidth: "100%",
              flex: "0 1 360px",
            }}
          >
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden>
              <circle cx="6" cy="6" r="4.5" stroke="var(--text-tertiary)" strokeWidth="1.5" />
              <line
                x1="9.5"
                y1="9.5"
                x2="12.5"
                y2="12.5"
                stroke="var(--text-tertiary)"
                strokeWidth="1.5"
                strokeLinecap="round"
              />
            </svg>
            <input
              type="text"
              placeholder="search enviro sounds..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              style={{
                flex: 1,
                border: "none",
                background: "transparent",
                outline: "none",
                fontSize: "var(--font-size-md)",
                color: "var(--text-primary)",
                fontFamily: FONT_HEAD,
              }}
            />
          </div>
          <span
            style={{
              fontFamily: FONT_MONO,
              fontSize: "var(--font-size-sm)",
              letterSpacing: "0.14em",
              textTransform: "uppercase",
              color: "var(--text-tertiary)",
            }}
          >
            showing {filtered.length} of {sounds.length}
          </span>
        </div>
        <SortMenu options={SORT_OPTIONS} sort={sort} onChange={setSort} />
      </div>

      {/* Tag filter chips */}
      {allTags.length > 0 && (
        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            gap: "var(--space-6)",
            padding: "0 40px 20px",
          }}
        >
          {allTags.map((tag) => {
            const active = tagFilter === tag;
            return (
              <button
                key={tag}
                type="button"
                onClick={() => setTagFilter(active ? null : tag)}
                style={{
                  padding: "4px 12px",
                  borderRadius: "var(--radius-pill)",
                  border: `1px solid ${active ? ACCENT : "var(--ink-line)"}`,
                  background: active
                    ? "color-mix(in srgb, var(--accent-strong) 14%, transparent)"
                    : "transparent",
                  color: active ? ACCENT : "var(--text-secondary)",
                  fontFamily: FONT_MONO,
                  fontSize: "var(--font-size-xs)",
                  letterSpacing: "0.06em",
                  cursor: "pointer",
                }}
              >
                {tag}
              </button>
            );
          })}
        </div>
      )}

      {/* Grid */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(360px, 1fr))",
          gap: "var(--space-16)",
          width: "100%",
          padding: "0 40px 56px",
        }}
      >
        {filtered.map((s) => (
          <SoundCard
            key={s.id}
            sound={s}
            playing={playingId === s.id}
            processing={processingId === s.id}
            onTogglePlay={() => togglePlay(s)}
            onProcess={() => void processSound(s)}
            onEdit={() => setEditing(s)}
            onArchive={() => void onArchive(s)}
            onRequestDelete={() => setPendingDelete(s)}
          />
        ))}
      </div>

      <SoundCreateDialog
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        existingSlugs={existingSlugs}
      />

      {editing && (
        <SoundEditModal
          sound={editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            router.refresh();
          }}
          onError={(msg) => setToast(msg)}
        />
      )}

      <ConfirmModal
        open={pendingDelete !== null}
        onClose={() => {
          if (!deleting) setPendingDelete(null);
        }}
        onConfirm={onConfirmDelete}
        title="Delete sound?"
        subtitle="cannot be undone"
        tone="destructive"
        pending={deleting}
        confirmLabel="delete sound"
        description={
          pendingDelete ? (
            <>
              You&rsquo;re about to delete{" "}
              <strong style={{ color: "var(--text-primary)" }}>
                {pendingDelete.name}
              </strong>{" "}
              <span
                style={{
                  fontFamily: FONT_MONO,
                  fontSize: "var(--font-size-sm)",
                  color: "var(--text-tertiary)",
                }}
              >
                /{pendingDelete.slug}
              </span>
              .
            </>
          ) : null
        }
        bullets={[
          "Source + processed audio will be removed from Supabase.",
          "Scene audio nodes referencing this sound will stop resolving.",
        ]}
        hint={
          <>
            Prefer{" "}
            <strong style={{ color: "var(--accent-strong)" }}>Archive</strong> —
            soft-delete that keeps scene references playable.
          </>
        }
      />

      {toast && (
        <div
          role="alert"
          onClick={() => setToast(null)}
          style={{
            position: "fixed",
            bottom: 24,
            right: 24,
            zIndex: 1200,
            padding: "12px 16px",
            background: "color-mix(in srgb, var(--status-error) 12%, transparent)",
            border: "1px solid color-mix(in srgb, var(--status-error) 40%, transparent)",
            color: "var(--status-error)",
            fontFamily: FONT_MONO,
            fontSize: "var(--font-size-base)",
            cursor: "pointer",
          }}
        >
          {toast}
        </div>
      )}
    </div>
  );
}

/* ── Card ─────────────────────────────────────────────────────── */

function SoundCard({
  sound,
  playing,
  processing,
  onTogglePlay,
  onProcess,
  onEdit,
  onArchive,
  onRequestDelete,
}: {
  sound: SoundSummary;
  playing: boolean;
  processing: boolean;
  onTogglePlay: () => void;
  onProcess: () => void;
  onEdit: () => void;
  onArchive: () => void;
  onRequestDelete: () => void;
}) {
  const [hovered, setHovered] = useState(false);

  const items: ContextMenuItem[] = useMemo(
    () => [
      {
        kind: "item",
        id: "edit",
        label: "Edit",
        onSelect: onEdit,
      },
      {
        kind: "item",
        id: "copy-slug",
        label: "Copy slug",
        onSelect: () => {
          void navigator.clipboard?.writeText(sound.slug).catch(() => null);
        },
      },
      ...(sound.status !== "ready"
        ? ([
            {
              kind: "item" as const,
              id: "process",
              label: processing ? "Processing…" : "Process",
              onSelect: onProcess,
            },
          ])
        : []),
      { kind: "divider", id: "d1" },
      {
        kind: "item",
        id: "archive",
        label: "Archive",
        onSelect: onArchive,
      },
      {
        kind: "item",
        id: "delete",
        label: "Delete",
        tone: "destructive",
        onSelect: onRequestDelete,
      },
    ],
    [sound.slug, sound.status, processing, onEdit, onProcess, onArchive, onRequestDelete],
  );

  return (
    <ContextMenu items={items}>
      <div
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        style={{
          display: "flex",
          flexDirection: "column",
          minHeight: 180,
          position: "relative",
          padding: "var(--space-18)",
          gap: "var(--space-12)",
          borderRadius: "var(--radius-2xl)",
          background: "var(--material-card)",
          border: `1px solid ${hovered ? "var(--accent-glow)" : "var(--border-subtle)"}`,
          transition: "border-color 120ms ease",
        }}
      >
        {/* Top row: play button + identity + status */}
        <div style={{ display: "flex", alignItems: "center", gap: "var(--space-12)" }}>
          <PlayButton
            playing={playing}
            disabled={sound.status === "failed"}
            onClick={onTogglePlay}
          />
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: "var(--space-3)",
              flex: 1,
              minWidth: 0,
            }}
          >
            <span
              style={{
                fontFamily: FONT_HEAD,
                fontSize: "var(--font-size-xl)",
                fontWeight: 600,
                letterSpacing: "-0.01em",
                lineHeight: 1.15,
                color: "var(--text-primary)",
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {sound.name}
            </span>
            <span
              style={{
                fontFamily: FONT_MONO,
                fontSize: "var(--font-size-xs)",
                letterSpacing: "0.04em",
                color: "var(--text-tertiary)",
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {sound.slug}
              {sound.durationS != null && ` · ${formatDuration(sound.durationS)}`}
              {sound.loopable && " · loop"}
            </span>
          </div>
          {sound.status !== "ready" && (
            <span
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: "var(--space-6)",
              }}
            >
              <span
                aria-hidden
                style={{
                  display: "inline-block",
                  width: 6,
                  height: 6,
                  borderRadius: "var(--radius-pill)",
                  background: STATUS_COLORS[sound.status],
                }}
              />
              <span
                style={{
                  fontFamily: FONT_MONO,
                  fontSize: "var(--font-size-2xs)",
                  letterSpacing: "0.14em",
                  textTransform: "uppercase",
                  color: STATUS_COLORS[sound.status],
                  whiteSpace: "nowrap",
                }}
              >
                {processing ? "processing…" : STATUS_LABELS[sound.status]}
              </span>
            </span>
          )}
        </div>

        {/* Description */}
        {sound.description && (
          <p
            style={{
              margin: 0,
              fontFamily: FONT_HEAD,
              fontSize: "var(--font-size-base)",
              lineHeight: "18px",
              color: "var(--text-secondary)",
              display: "-webkit-box",
              WebkitBoxOrient: "vertical",
              WebkitLineClamp: 2,
              overflow: "hidden",
            }}
          >
            {sound.description}
          </p>
        )}

        {/* Tags */}
        {sound.tags.length > 0 && (
          <div style={{ display: "flex", flexWrap: "wrap", gap: "var(--space-6)" }}>
            {sound.tags.slice(0, 6).map((t) => (
              <span
                key={t}
                style={{
                  padding: "2px 8px",
                  borderRadius: "var(--radius-sm)",
                  background: "var(--ink-soft)",
                  fontFamily: FONT_MONO,
                  fontSize: "var(--font-size-xs)",
                  color: "var(--text-secondary)",
                  whiteSpace: "nowrap",
                }}
              >
                {t}
              </span>
            ))}
          </div>
        )}

        {/* Footer: source badge + menu */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            paddingTop: "var(--space-10)",
            marginTop: "auto",
            borderTop: "1px solid var(--ink-soft)",
          }}
        >
          <span
            style={{
              display: "inline-flex",
              alignItems: "center",
              padding: "2px 8px",
              borderRadius: "var(--radius-sm)",
              border: "1px solid var(--ink-line)",
              fontFamily: FONT_MONO,
              fontSize: "var(--font-size-2xs)",
              fontWeight: 500,
              letterSpacing: "0.18em",
              color: "var(--text-tertiary)",
              whiteSpace: "nowrap",
            }}
            title={
              sound.source === "elevenlabs_sfx"
                ? `Generated: ${sound.generationPrompt ?? ""}`
                : "Uploaded file"
            }
          >
            {sound.source === "elevenlabs_sfx" ? "ELEVEN SFX" : "UPLOAD"}
          </span>
          <ContextMenu
            items={items}
            renderTrigger={({ onClick, open }) => (
              <ContextMenuTriggerButton
                onClick={onClick}
                open={open}
                ariaLabel={`${sound.name} actions`}
              />
            )}
          />
        </div>
      </div>
    </ContextMenu>
  );
}

function PlayButton({
  playing,
  disabled,
  onClick,
}: {
  playing: boolean;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={playing ? "Pause" : "Play"}
      style={{
        width: 38,
        height: 38,
        flexShrink: 0,
        borderRadius: "var(--radius-md)",
        border: "none",
        background: playing
          ? "color-mix(in srgb, var(--accent-strong) 20%, transparent)"
          : "var(--ink-fill)",
        color: playing ? ACCENT : "var(--text-secondary)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.5 : 1,
      }}
    >
      {playing ? (
        <svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor">
          <rect x="2" y="1.5" width="3" height="9" rx="0.8" />
          <rect x="7" y="1.5" width="3" height="9" rx="0.8" />
        </svg>
      ) : (
        <svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor">
          <path d="M3 1.5v9l7.5-4.5L3 1.5Z" />
        </svg>
      )}
    </button>
  );
}

/* ── Edit modal ───────────────────────────────────────────────── */

function SoundEditModal({
  sound,
  onClose,
  onSaved,
  onError,
}: {
  sound: SoundSummary;
  onClose: () => void;
  onSaved: () => void;
  onError: (msg: string) => void;
}) {
  const [name, setName] = useState(sound.name);
  const [description, setDescription] = useState(sound.description ?? "");
  const [tags, setTags] = useState(sound.tags.join(", "));
  const [loopable, setLoopable] = useState(sound.loopable);
  const [saving, startSaving] = useTransition();

  const save = () => {
    startSaving(async () => {
      const result = await updateSoundMeta(sound.id, {
        name,
        description,
        tags: tags.split(",").map((t) => t.trim()).filter(Boolean),
        loopable,
      });
      if (!result.ok) onError(result.error);
      else onSaved();
    });
  };

  const fieldStyle: React.CSSProperties = {
    width: "100%",
    padding: "9px 12px",
    background: "var(--control-bg)",
    border: "1px solid var(--control-border)",
    borderRadius: "var(--radius-md)",
    color: "var(--text-primary)",
    fontFamily: FONT_HEAD,
    fontSize: "var(--font-size-md)",
    outline: "none",
  };
  const labelStyle: React.CSSProperties = {
    fontFamily: FONT_MONO,
    fontSize: "var(--font-size-2xs)",
    letterSpacing: "0.14em",
    textTransform: "uppercase",
    color: "var(--text-tertiary)",
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      onClick={(e) => {
        if (e.target === e.currentTarget && !saving) onClose();
      }}
      style={{
        position: "fixed",
        inset: 0,
        background: "var(--modal-backdrop)",
        backdropFilter: "blur(8px)",
        zIndex: 100,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "var(--space-24)",
      }}
    >
      <div
        style={{
          width: 480,
          maxWidth: "100%",
          background: "var(--background)",
          border: "1px solid var(--border)",
          borderRadius: "var(--radius-xl)",
          boxShadow: "var(--elevation-panel)",
          display: "flex",
          flexDirection: "column",
          gap: "var(--space-16)",
          padding: 28,
        }}
      >
        <span
          style={{
            fontFamily: FONT_MONO,
            fontSize: "var(--font-size-sm)",
            letterSpacing: "0.18em",
            textTransform: "uppercase",
            color: "var(--text-tertiary)",
          }}
        >
          Edit sound · {sound.slug}
        </span>

        <label style={{ display: "flex", flexDirection: "column", gap: "var(--space-6)" }}>
          <span style={labelStyle}>Name</span>
          <input value={name} onChange={(e) => setName(e.target.value)} style={fieldStyle} />
        </label>

        <label style={{ display: "flex", flexDirection: "column", gap: "var(--space-6)" }}>
          <span style={labelStyle}>Description (what the director reads)</span>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={3}
            placeholder="e.g. low desert wind, sparse, lonely"
            style={{ ...fieldStyle, resize: "vertical" }}
          />
        </label>

        <label style={{ display: "flex", flexDirection: "column", gap: "var(--space-6)" }}>
          <span style={labelStyle}>Tags (comma-separated)</span>
          <input
            value={tags}
            onChange={(e) => setTags(e.target.value)}
            placeholder="ambience, desert, night"
            style={fieldStyle}
          />
        </label>

        <label
          style={{
            display: "flex",
            alignItems: "center",
            gap: "var(--space-8)",
            fontFamily: FONT_HEAD,
            fontSize: "var(--font-size-md)",
            color: "var(--text-secondary)",
            cursor: "pointer",
          }}
        >
          <input
            type="checkbox"
            checked={loopable}
            onChange={(e) => setLoopable(e.target.checked)}
          />
          Loops seamlessly (ambience bed)
        </label>

        <div style={{ display: "flex", justifyContent: "flex-end", gap: "var(--space-8)" }}>
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            style={{
              padding: "8px 16px",
              borderRadius: "var(--radius-pill)",
              border: "1px solid var(--ink-line)",
              background: "transparent",
              color: "var(--text-secondary)",
              fontFamily: FONT_HEAD,
              fontSize: "var(--font-size-md)",
              cursor: "pointer",
            }}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={save}
            disabled={saving}
            style={{
              padding: "8px 18px",
              borderRadius: "var(--radius-pill)",
              border: "none",
              background: ACCENT,
              color: "var(--background)",
              fontFamily: FONT_HEAD,
              fontSize: "var(--font-size-md)",
              fontWeight: 600,
              cursor: saving ? "progress" : "pointer",
              opacity: saving ? 0.7 : 1,
            }}
          >
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ── + new sound button ──────────────────────────────────────── */

function NewSoundButton({ onClick }: { onClick: () => void }) {
  const [hovered, setHovered] = useState(false);
  const bg = hovered
    ? "color-mix(in srgb, var(--accent-strong) 88%, white 12%)"
    : ACCENT;
  return (
    <button
      type="button"
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onFocus={() => setHovered(true)}
      onBlur={() => setHovered(false)}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: "var(--space-6)",
        padding: "7px 16px",
        border: `1px solid ${bg}`,
        borderRadius: "var(--radius-pill)",
        background: bg,
        color: "var(--background)",
        fontFamily: FONT_HEAD,
        fontSize: "var(--font-size-base)",
        fontWeight: 600,
        cursor: "pointer",
        whiteSpace: "nowrap",
        transition: "background 120ms ease, border-color 120ms ease",
        boxShadow: hovered ? "var(--ring-shadow-selected)" : "none",
      }}
    >
      + new sound
    </button>
  );
}
