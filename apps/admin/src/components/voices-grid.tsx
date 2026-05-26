"use client";

import { useRouter } from "next/navigation";
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  useTransition,
} from "react";
import { useHeaderContent } from "@/components/header-context";
import { SortMenu } from "@/components/sort-menu";
import { VoiceUploadDialog } from "@/components/voice-upload-dialog";
import { ProviderPickerModal } from "@/components/provider-picker-modal";
import { ElevenLabsPickerModal } from "@/components/elevenlabs-picker-modal";
import type { VoiceProvider, VoiceStatus } from "@odyssey/db";
import type { VoiceSummary } from "@/app/(authenticated)/voices/page";
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

/* Status palette. Ready maps to the brand accent (matches characters' "live"
 * pill). Processing borrows draft amber. Failed uses a desaturated coral
 * that lines up with the brand without competing with accent green. */
const STATUS_COLORS: Record<VoiceStatus, string> = {
  ready: "var(--accent-strong)",
  processing: "var(--status-draft)",
  failed: "var(--status-error)",
  uploaded: "var(--text-tertiary)",
};

const STATUS_LABELS: Record<VoiceStatus, string> = {
  ready: "ready",
  processing: "extracting",
  failed: "failed",
  uploaded: "uploaded",
};

const PROVIDER_LABELS: Record<VoiceProvider, string> = {
  pocket_tts: "POCKET",
  elevenlabs: "ELEVEN",
  openai: "OPENAI",
  cartesia: "CARTESIA",
};

/* ── Sort ─────────────────────────────────────────────────────── */

type SortKey = "recent" | "name";

const SORT_OPTIONS: { key: SortKey; label: string }[] = [
  { key: "recent", label: "Recently added" },
  { key: "name", label: "Name A–Z" },
];

function applySort(list: VoiceSummary[], sort: SortKey): VoiceSummary[] {
  const base = [...list];
  if (sort === "name") {
    return base.sort((a, b) => a.name.localeCompare(b.name));
  }
  return base.sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
  );
}

/* ── Formatting helpers ───────────────────────────────────────── */

function formatDuration(s: number | null): string {
  if (s == null) return "—";
  if (s < 60) return `${s.toFixed(1)}s`;
  const m = Math.floor(s / 60);
  const r = Math.round(s % 60);
  return `${m}m ${r}s`;
}

function formatSampleRate(hz: number | null): string {
  if (hz == null) return "—";
  return `${Math.round(hz / 1000)} kHz`;
}

function formatLastEvent(v: VoiceSummary): string {
  const iso =
    v.status === "ready" || v.status === "failed" ? v.updatedAt : v.createdAt;
  const ms = Date.now() - new Date(iso).getTime();
  const rel = relativeFromMs(ms);
  if (v.status === "ready") return `extracted · ${rel}`;
  if (v.status === "failed") return `failed · ${rel}`;
  if (v.status === "processing") return `extracting…`;
  return `uploaded · ${rel}`;
}

function relativeFromMs(ms: number): string {
  if (ms < 60_000) return "just now";
  const mins = Math.floor(ms / 60_000);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  const weeks = Math.floor(days / 7);
  return `${weeks}w ago`;
}

/* ── Empty-state helpers ───────────────────────────────────────── */

/* One of the three "01 / 02 / 03" cards rendered on the empty state.
 * Kept local to this file because it's only ever used here. */
function EmptyStepCard({
  n,
  title,
  body,
  glyph,
}: {
  n: string;
  title: string;
  body: string;
  glyph: React.ReactNode;
}) {
  return (
    <div
      style={{
        flex: "0 1 232px",
        padding: "16px 16px 18px",
        background: "var(--card)",
        border: "1px solid var(--card-border)",
        borderRadius: "var(--radius-xl)",
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
        }}
      >
        <span
          style={{
            fontFamily: FONT_MONO,
            fontSize: "var(--font-size-sm)",
            letterSpacing: "0.12em",
            color: "var(--text-tertiary)",
          }}
        >
          {n}
        </span>
        <span
          style={{
            color: "var(--text-secondary)",
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          {glyph}
        </span>
      </div>
      <div
        style={{
          fontFamily: FONT_HEAD,
          fontSize: "var(--font-size-lg)",
          fontWeight: 600,
          color: "var(--text-primary)",
        }}
      >
        {title}
      </div>
      <div
        style={{
          fontFamily: FONT_HEAD,
          fontSize: "var(--font-size-base)",
          lineHeight: "18px",
          color: "var(--text-secondary)",
        }}
      >
        {body}
      </div>
    </div>
  );
}

/* ── Component ────────────────────────────────────────────────── */

type Props = { voices: VoiceSummary[] };

export function VoicesGrid({ voices }: Props) {
  const router = useRouter();
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<SortKey>("recent");
  const [uploadOpen, setUploadOpen] = useState(false);
  const [providerPickerOpen, setProviderPickerOpen] = useState(false);
  const [elevenLabsPickerOpen, setElevenLabsPickerOpen] = useState(false);

  /* "+ new voice" — open the picker immediately so the overlay paints in
   * the same frame as the click. The picker itself fetches
   * /api/voices/providers and, when only Pocket is configured, signals
   * `onSmartDefault` so we can swap to the Pocket upload dialog without
   * showing a one-option picker. Awaiting the fetch before opening
   * anything (the previous approach) cost a 200–500ms blank-screen
   * latency on every click. */
  const handleNewVoiceClick = useCallback(() => {
    setProviderPickerOpen(true);
  }, []);

  const handleProviderPick = useCallback((provider: VoiceProvider) => {
    setProviderPickerOpen(false);
    if (provider === "pocket_tts") {
      setUploadOpen(true);
    } else if (provider === "elevenlabs") {
      setElevenLabsPickerOpen(true);
    } else {
      // OpenAI and Cartesia forms aren't built yet — surface a polite
      // notice rather than silently no-op'ing.
      window.alert(
        `${provider} voices aren't supported yet — coming soon.`,
      );
    }
  }, []);

  /* If the picker's availability fetch reports only Pocket configured,
   * close the picker and open the Pocket upload dialog directly. */
  const handleSmartDefault = useCallback((provider: VoiceProvider) => {
    setProviderPickerOpen(false);
    if (provider === "pocket_tts") setUploadOpen(true);
    else if (provider === "elevenlabs") setElevenLabsPickerOpen(true);
  }, []);

  /* Track the voice queued for deletion. Modal opens when non-null; we
   * keep the full row in state so we can render the name + bind count
   * in the confirmation body without an extra fetch. */
  const [pendingDelete, setPendingDelete] = useState<VoiceSummary | null>(
    null,
  );
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const onConfirmDelete = useCallback(async () => {
    if (!pendingDelete) return;
    setDeleting(true);
    setDeleteError(null);
    try {
      const res = await fetch(`/api/voices/${pendingDelete.id}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      setPendingDelete(null);
      router.refresh();
    } catch (err) {
      setDeleteError((err as Error).message);
    } finally {
      setDeleting(false);
    }
  }, [pendingDelete, router]);

  const onArchive = useCallback(
    async (voice: VoiceSummary) => {
      try {
        const res = await fetch(`/api/voices/${voice.id}/archive`, {
          method: "POST",
        });
        if (!res.ok) return;
        router.refresh();
      } catch {
        /* best-effort */
      }
    },
    [router],
  );

  const existingSlugs = useMemo(() => voices.map((v) => v.slug), [voices]);

  const filtered = useMemo(() => {
    const base = !search.trim()
      ? voices
      : (() => {
          const q = search.trim().toLowerCase();
          return voices.filter(
            (v) =>
              v.name.toLowerCase().includes(q) ||
              v.slug.toLowerCase().includes(q) ||
              (v.description ?? "").toLowerCase().includes(q),
          );
        })();
    return applySort(base, sort);
  }, [voices, search, sort]);

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
          VOICES
        </span>
        <div style={{ display: "inline-flex", alignItems: "center", gap: "var(--space-8)" }}>
          {voices.length > 0 && <RefreshButton />}
          <NewVoiceButton onClick={handleNewVoiceClick} />
        </div>
      </div>,
    );
    return () => {
      setContent(null);
      setFlush(false);
    };
  }, [setContent, setFlush, voices.length]);

  /* ── Empty state ────────────────────────────────────────────── */

  if (voices.length === 0) {
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
          gap: 28,
        }}
      >
        {/* Status tag. Mirrors the "voices · ready to populate" copy in the
            design — sets expectation that the page is functional, just unfilled. */}
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
          Voices · Ready to populate
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
          Your voice library is empty
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
          Upload a short reference clip and Pocket TTS will extract a speaker
          embedding any character in your worlds can bind to.
        </p>

        {/* Three step cards — Upload → Extract → Bind. Each card carries the
            number, an inline glyph, title, and a one-line "what it takes" hint. */}
        <div
          style={{
            display: "flex",
            gap: "var(--space-14)",
            paddingTop: "var(--space-12)",
            flexWrap: "wrap",
            justifyContent: "center",
            maxWidth: 760,
          }}
        >
          <EmptyStepCard
            n="01"
            title="Upload a clip"
            body="10–30 seconds of clean speech, one speaker, minimal background."
            glyph={
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                <path
                  d="M7 9V2M3.5 5.5L7 2L10.5 5.5"
                  stroke="currentColor"
                  strokeWidth="1.3"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
                <path
                  d="M2 10v1.5A.5.5 0 0 0 2.5 12h9a.5.5 0 0 0 .5-.5V10"
                  stroke="currentColor"
                  strokeWidth="1.3"
                  strokeLinecap="round"
                />
              </svg>
            }
          />
          <EmptyStepCard
            n="02"
            title="Extract embedding"
            body="Pocket TTS computes a kvcache state — about 15 seconds on a warm container."
            glyph={
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                <path
                  d="M7.5 1L3 8h3.5L6 13l5-7.5H7.5L7.5 1Z"
                  stroke="currentColor"
                  strokeWidth="1.2"
                  strokeLinejoin="round"
                  fill="none"
                />
              </svg>
            }
          />
          <EmptyStepCard
            n="03"
            title="Bind to characters"
            body="Pick the voice on any character's Persona panel — sessions pick up the change instantly."
            glyph={
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                <path
                  d="M5.5 8.5L8.5 5.5M6 4L7.5 2.5a2.5 2.5 0 0 1 3.5 3.5L9.5 7.5M4.5 6.5L3 8a2.5 2.5 0 0 0 3.5 3.5L8 10"
                  stroke="currentColor"
                  strokeWidth="1.2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  fill="none"
                />
              </svg>
            }
          />
        </div>

        <button
          type="button"
          onClick={handleNewVoiceClick}
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
            marginTop: "var(--space-4)",
          }}
        >
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
            <path
              d="M7 11V2M3.5 5.5L7 2L10.5 5.5"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
          Upload your first voice
        </button>

        {/* Spec line — quiet footer matching the design. Calls out accepted
            formats + size cap + the active extraction engine so the user knows
            what the upload dialog is going to ask for. */}
        <div
          style={{
            display: "flex",
            gap: "var(--space-14)",
            paddingTop: "var(--space-8)",
            fontFamily: FONT_MONO,
            fontSize: "var(--font-size-xs)",
            letterSpacing: "0.14em",
            textTransform: "uppercase",
            color: "var(--text-tertiary)",
          }}
        >
          <span>Formats wav · mp3 · m4a</span>
          <span style={{ opacity: 0.4 }}>·</span>
          <span>Max 20 MB</span>
          <span style={{ opacity: 0.4 }}>·</span>
          <span>Engine Pocket TTS 2.1</span>
        </div>

        <VoiceUploadDialog
          open={uploadOpen}
          onClose={() => setUploadOpen(false)}
          existingSlugs={existingSlugs}
        />
        <ProviderPickerModal
          open={providerPickerOpen}
          onClose={() => setProviderPickerOpen(false)}
          onPick={handleProviderPick}
          onSmartDefault={handleSmartDefault}
        />
        <ElevenLabsPickerModal
          open={elevenLabsPickerOpen}
          onClose={() => setElevenLabsPickerOpen(false)}
          onBack={() => {
            setElevenLabsPickerOpen(false);
            setProviderPickerOpen(true);
          }}
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
      {/* Toolbar — search + count + sort */}
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
              background: "var(--input-bg)",
              border: "1px solid var(--input-border)",
              borderRadius: "var(--radius-pill)",
              width: 360,
              maxWidth: "100%",
              flex: "0 1 360px",
            }}
          >
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden>
              <circle
                cx="6"
                cy="6"
                r="4.5"
                stroke="var(--text-tertiary)"
                strokeWidth="1.5"
              />
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
              placeholder="search voices…"
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
            showing {filtered.length} of {voices.length}
          </span>
        </div>

        <SortMenu options={SORT_OPTIONS} sort={sort} onChange={setSort} />
      </div>

      {/* Grid — auto-fill columns at a 360px minimum track. Native
       * `align-items: stretch` equalizes card heights within each row, and
       * tracks reflow responsively: 4 cols ≳1640px, 3 cols ≳1240, 2 cols
       * ≳840, 1 col below. */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(360px, 1fr))",
          gap: "var(--space-16)",
          width: "100%",
          padding: "0 40px 56px",
        }}
      >
        {filtered.map((v) => (
          <VoiceCard
            key={v.id}
            voice={v}
            onRequestDelete={() => setPendingDelete(v)}
            onArchive={() => onArchive(v)}
          />
        ))}
      </div>

      <VoiceUploadDialog
        open={uploadOpen}
        onClose={() => setUploadOpen(false)}
        existingSlugs={existingSlugs}
      />
      <ProviderPickerModal
        open={providerPickerOpen}
        onClose={() => setProviderPickerOpen(false)}
        onPick={handleProviderPick}
        onSmartDefault={handleSmartDefault}
      />
      <ElevenLabsPickerModal
        open={elevenLabsPickerOpen}
        onClose={() => setElevenLabsPickerOpen(false)}
        onBack={() => {
          setElevenLabsPickerOpen(false);
          setProviderPickerOpen(true);
        }}
        existingSlugs={existingSlugs}
      />

      <ConfirmModal
        open={pendingDelete !== null}
        onClose={() => {
          if (!deleting) {
            setPendingDelete(null);
            setDeleteError(null);
          }
        }}
        onConfirm={onConfirmDelete}
        title="Delete voice?"
        subtitle="cannot be undone"
        tone="destructive"
        pending={deleting}
        confirmLabel="delete voice"
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
        bullets={
          pendingDelete
            ? [
                "Source clip + embedding will be removed from Supabase.",
                <>
                  <strong style={{ color: "var(--text-primary)" }}>
                    {pendingDelete.boundCharacterCount} character
                    {pendingDelete.boundCharacterCount === 1 ? "" : "s"}
                  </strong>{" "}
                  using this voice will fall back to the default.
                </>,
                <>
                  The slug{" "}
                  <span
                    style={{
                      fontFamily: FONT_MONO,
                      color: "var(--text-primary)",
                    }}
                  >
                    {pendingDelete.slug}
                  </span>{" "}
                  becomes available for reuse.
                </>,
              ]
            : []
        }
        hint={
          <>
            Prefer{" "}
            <strong style={{ color: "var(--accent-strong)" }}>Archive</strong> —
            soft-delete that keeps bindings intact and can be undone any time.
          </>
        }
      />

      {deleteError && (
        <div
          role="alert"
          style={{
            position: "fixed",
            bottom: 24,
            right: 24,
            zIndex: 1200,
            padding: "12px 16px",
            background:
              "color-mix(in srgb, var(--status-error) 12%, transparent)",
            border:
              "1px solid color-mix(in srgb, var(--status-error) 40%, transparent)",
            color: "var(--status-error)",
            fontFamily: FONT_MONO,
            fontSize: "var(--font-size-base)",
          }}
        >
          {deleteError}
        </div>
      )}
    </div>
  );
}

/* ── Card ─────────────────────────────────────────────────────── */

function VoiceCard({
  voice,
  onRequestDelete,
  onArchive,
}: {
  voice: VoiceSummary;
  onRequestDelete: () => void;
  onArchive: () => void;
}) {
  const router = useRouter();
  const [hovered, setHovered] = useState(false);

  const items: ContextMenuItem[] = useMemo(
    () => [
      {
        kind: "item",
        id: "open",
        label: "Open",
        icon: <Icon name="open" />,
        onSelect: () => router.push(`/voices/${voice.slug}`),
      },
      {
        kind: "item",
        id: "edit",
        label: "Edit",
        icon: <Icon name="edit" />,
        onSelect: () => router.push(`/voices/${voice.slug}`),
      },
      {
        kind: "item",
        id: "copy-slug",
        label: "Copy slug",
        icon: <Icon name="copy" />,
        onSelect: () => {
          void navigator.clipboard?.writeText(voice.slug).catch(() => null);
        },
      },
      {
        kind: "item",
        id: "open-tab",
        label: "Open in new tab",
        icon: <Icon name="external" />,
        onSelect: () =>
          window.open(`/voices/${voice.slug}`, "_blank", "noopener,noreferrer"),
      },
      { kind: "divider", id: "d1" },
      {
        kind: "item",
        id: "archive",
        label: "Archive",
        icon: <Icon name="archive" />,
        onSelect: onArchive,
      },
      { kind: "divider", id: "d2" },
      {
        kind: "item",
        id: "delete",
        label: "Delete",
        icon: <Icon name="trash" />,
        shortcut: "⌫",
        tone: "destructive",
        onSelect: onRequestDelete,
      },
    ],
    [router, voice.slug, onArchive, onRequestDelete],
  );

  return (
    <ContextMenu items={items}>
      <div
        onClick={(e) => {
          // Cmd/Ctrl-click → open in new tab (matches the menu item).
          if (e.metaKey || e.ctrlKey) {
            e.preventDefault();
            window.open(
              `/voices/${voice.slug}`,
              "_blank",
              "noopener,noreferrer",
            );
            return;
          }
          router.push(`/voices/${voice.slug}`);
        }}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        role="link"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === "Enter") router.push(`/voices/${voice.slug}`);
        }}
        style={{
          display: "flex",
          flexDirection: "column",
          minHeight: 280,
          position: "relative",
          padding: "var(--space-18)",
          gap: "var(--space-14)",
          borderRadius: "var(--radius-2xl)",
          background: "var(--card)",
          border: `1px solid ${hovered ? "var(--accent-glow)" : "var(--card-border)"}`,
          color: "inherit",
          cursor: "pointer",
          transition: "border-color 120ms ease, background 120ms ease",
        }}
      >
        {/* ── Top row: mini wave + identity + status pill ──────────── */}
        <div style={{ display: "flex", alignItems: "center", gap: "var(--space-12)" }}>
          <MiniWaveformThumb status={voice.status} />
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
                fontSize: "var(--font-size-2xl)",
                fontWeight: 600,
                letterSpacing: "-0.01em",
                lineHeight: 1.15,
                color: "var(--text-primary)",
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {voice.name}
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
              {voice.slug}
              {voice.durationS != null &&
                ` · ${formatDuration(voice.durationS)}`}
              {voice.sampleRate != null &&
                ` · ${formatSampleRate(voice.sampleRate)}`}
            </span>
          </div>
          {/* Only render the status pill for in-flight or error states.
           * "ready" is implicit (it's the dominant case), and the
           * BindingsBlock/UnboundBlock below already speaks for it. */}
          {voice.status !== "ready" && <StatusPill status={voice.status} />}
        </div>

        {/* ── Description (skipped for failed — the error block speaks for it) */}
        {voice.description && voice.status !== "failed" && (
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
            {voice.description}
          </p>
        )}

        {/* ── State-specific middle block ──────────────────────────── */}
        {voice.status === "ready" && voice.boundCharacterCount > 0 && (
          <BindingsBlock
            count={voice.boundCharacterCount}
            characters={voice.boundCharacters}
          />
        )}
        {voice.status === "ready" && voice.boundCharacterCount === 0 && (
          <UnboundBlock />
        )}
        {(voice.status === "processing" || voice.status === "uploaded") && (
          <ProcessingBlock status={voice.status} updatedAt={voice.updatedAt} />
        )}
        {voice.status === "failed" && (
          <FailedBlock
            statusError={voice.statusError}
            description={voice.description}
            onRetry={(e) => {
              e.stopPropagation();
              router.push(`/voices/${voice.slug}`);
            }}
            onReplace={(e) => {
              e.stopPropagation();
              router.push(`/voices/${voice.slug}`);
            }}
          />
        )}

        {/* ── Footer: provider badge + play + 3-dot menu ────────────
         * `marginTop: auto` pins this row to the bottom of the card so
         * that when neighbors stretch the row to a taller card's height
         * (Margaret Hale's Processing block, Lot's Failed block), the
         * footer stays at the floor instead of floating mid-card with
         * dead space below it. */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            paddingTop: "var(--space-10)",
            marginTop: "auto",
            borderTop:
              "1px solid var(--ink-soft)",
          }}
        >
          <span
            style={{
              display: "inline-flex",
              alignItems: "center",
              padding: "2px 8px",
              borderRadius: "var(--radius-sm)",
              border:
                "1px solid var(--ink-line)",
              fontFamily: FONT_MONO,
              fontSize: "var(--font-size-2xs)",
              fontWeight: 500,
              letterSpacing: "0.18em",
              color: "var(--text-tertiary)",
              whiteSpace: "nowrap",
            }}
            title={`Provider: ${voice.provider}`}
          >
            {PROVIDER_LABELS[voice.provider]}
          </span>
          <div onClick={(e) => e.stopPropagation()}>
            <ContextMenu
              items={items}
              renderTrigger={({ onClick, open }) => (
                <ContextMenuTriggerButton
                  onClick={onClick}
                  open={open}
                  ariaLabel={`${voice.name} actions`}
                />
              )}
            />
          </div>
        </div>
      </div>
    </ContextMenu>
  );
}

/* ── Icons ────────────────────────────────────────────────────── */

function Icon({ name }: { name: "open" | "edit" | "copy" | "external" | "archive" | "trash" }) {
  const common = {
    width: 12,
    height: 12,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 2,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
  };
  switch (name) {
    case "open":
      return (
        <svg {...common}>
          <path d="M5 12h14" />
          <path d="M13 5l7 7-7 7" />
        </svg>
      );
    case "edit":
      return (
        <svg {...common}>
          <path d="M3 17.25V21h3.75l11-11-3.75-3.75-11 11Z" />
          <path d="m14.5 6.5 3 3" />
        </svg>
      );
    case "copy":
      return (
        <svg {...common}>
          <rect x="9" y="9" width="13" height="13" />
          <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
        </svg>
      );
    case "external":
      return (
        <svg {...common}>
          <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
          <polyline points="15 3 21 3 21 9" />
          <line x1="10" y1="14" x2="21" y2="3" />
        </svg>
      );
    case "archive":
      return (
        <svg {...common}>
          <rect x="2" y="3" width="20" height="5" />
          <path d="M4 8v13h16V8" />
          <line x1="10" y1="12" x2="14" y2="12" />
        </svg>
      );
    case "trash":
      return (
        <svg {...common}>
          <path d="M3 6h18" />
          <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" />
          <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
        </svg>
      );
  }
}

/* ── Sub-components ───────────────────────────────────────────── */

/* Smaller, square waveform tile rendered in the top row of the D card.
 * Status drives the bar color so the card communicates state before you
 * read the pill. */
function MiniWaveformThumb({ status }: { status: VoiceStatus }) {
  const color =
    status === "ready"
      ? "var(--accent-strong)"
      : status === "processing" || status === "uploaded"
        ? "var(--status-draft)"
        : status === "failed"
          ? "var(--status-error)"
          : "var(--text-tertiary)";
  return (
    <div
      style={{
        width: 38,
        height: 38,
        flexShrink: 0,
        borderRadius: "var(--radius-md)",
        background:
          "var(--ink-fill)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        color,
      }}
      aria-hidden
    >
      <svg width="22" height="22" viewBox="0 0 22 22" fill="none">
        {[
          [1, 9, 4],
          [4, 7, 8],
          [7, 3, 16],
          [10, 6, 10],
          [13, 2, 18],
          [16, 7, 8],
          [19, 9, 4],
        ].map(([x, y, h], i) => (
          <rect
            key={x}
            x={x}
            y={y}
            width="1.5"
            height={h}
            rx="0.6"
            fill="currentColor"
            opacity={i === 2 || i === 4 ? 1 : 0.7}
          />
        ))}
      </svg>
    </div>
  );
}

/* Avatar stack + name pills for the BOUND TO block. Capped at 2 visible
 * items + a "+N" overflow indicator when there are more than 3 bindings,
 * so a heavy-reuse voice (think shared narrator) doesn't push the card
 * height around. */
function BindingsBlock({
  count,
  characters,
}: {
  count: number;
  characters: VoiceSummary["boundCharacters"];
}) {
  const overflow = count > 3;
  const visible = overflow ? characters.slice(0, 2) : characters.slice(0, count);
  const overflowN = count - visible.length;

  return (
    <div
      style={{
        // `flex: 1` so this block expands to fill row height when a neighbor
        // card (Processing/Failed) pushes the row taller — matches design
        // where the Bindings block grows from 90px → 124px in tall rows.
        flex: 1,
        display: "flex",
        flexDirection: "column",
        gap: "var(--space-10)",
        padding: "var(--space-14)",
        background:
          "var(--ink-wash)",
        border:
          "1px solid var(--ink-soft)",
        borderRadius: "var(--radius-lg)",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: "var(--space-12)",
        }}
      >
        <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-2)" }}>
          <span
            style={{
              fontFamily: FONT_MONO,
              fontSize: "var(--font-size-2xs)",
              letterSpacing: "0.12em",
              textTransform: "uppercase",
              color: "var(--text-tertiary)",
            }}
          >
            Bound to
          </span>
          <span
            style={{
              fontFamily: FONT_HEAD,
              fontSize: "var(--font-size-md)",
              fontWeight: 500,
              color: "var(--text-primary)",
            }}
          >
            {count} character{count === 1 ? "" : "s"}
          </span>
        </div>
        <div style={{ display: "flex", alignItems: "center" }}>
          {visible.map((c, i) => (
            <CharacterAvatar
              key={c.id}
              title={c.title}
              color={c.thumbnailColor}
              offset={i > 0}
            />
          ))}
          {overflowN > 0 && (
            <OverflowAvatar n={overflowN} offset={visible.length > 0} />
          )}
        </div>
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: "var(--space-6)" }}>
        {visible.map((c) => (
          <span
            key={c.id}
            style={{
              padding: "3px 8px",
              borderRadius: "var(--radius-sm)",
              background:
                "var(--ink-soft)",
              fontFamily: FONT_HEAD,
              fontSize: "var(--font-size-sm)",
              color: "var(--text-secondary)",
              whiteSpace: "nowrap",
            }}
          >
            {c.title}
          </span>
        ))}
        {overflowN > 0 && (
          <span
            style={{
              padding: "3px 8px",
              borderRadius: "var(--radius-sm)",
              background:
                "var(--ink-soft)",
              fontFamily: FONT_HEAD,
              fontSize: "var(--font-size-sm)",
              color: "var(--text-secondary)",
            }}
          >
            +{overflowN}
          </span>
        )}
      </div>
    </div>
  );
}

function CharacterAvatar({
  title,
  color,
  offset,
}: {
  title: string;
  color: string | null;
  offset: boolean;
}) {
  const initial = (title.trim()[0] ?? "?").toUpperCase();
  const bg = color ?? "color-mix(in srgb, var(--accent-strong) 18%, transparent)";
  return (
    <div
      style={{
        width: 24,
        height: 24,
        borderRadius: "50%",
        background: bg,
        border: "2px solid var(--background, #0A0A0A)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontFamily: FONT_HEAD,
        fontSize: "var(--font-size-xs)",
        fontWeight: 600,
        color: "color-mix(in white 80%, transparent)",
        marginLeft: offset ? -8 : 0,
      }}
      title={title}
    >
      {initial}
    </div>
  );
}

function OverflowAvatar({ n, offset }: { n: number; offset: boolean }) {
  return (
    <div
      style={{
        minWidth: 24,
        height: 24,
        padding: "0 6px",
        borderRadius: "var(--radius-pill)",
        background:
          "var(--ink-line)",
        border: "2px solid var(--background, #0A0A0A)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontFamily: FONT_HEAD,
        fontSize: "var(--font-size-2xs)",
        fontWeight: 600,
        color: "var(--text-secondary)",
        marginLeft: offset ? -8 : 0,
      }}
      title={`+${n} more bound character${n === 1 ? "" : "s"}`}
    >
      +{n}
    </div>
  );
}

/* Empty bindings state — voice is `ready` but no character has been
 * bound to it yet. Shown with a dashed border to read as "slot waiting
 * to be filled" and a Bind CTA that routes to the detail page. */
function UnboundBlock() {
  return (
    <div
      style={{
        // `flex: 1` lets the dashed slot stretch to fill the card height
        // when neighbors in the same row push the card taller (e.g. a
        // Processing block). Without this the unbound block stays
        // intrinsic and leaves dead space above the footer.
        flex: 1,
        display: "flex",
        flexDirection: "column",
        gap: "var(--space-2)",
        padding: "var(--space-14)",
        background:
          "var(--ink-wash)",
        border:
          "1px dashed var(--ink-line)",
        borderRadius: "var(--radius-lg)",
      }}
    >
      <span
        style={{
          fontFamily: FONT_MONO,
          fontSize: "var(--font-size-2xs)",
          letterSpacing: "0.12em",
          textTransform: "uppercase",
          color: "var(--text-tertiary)",
        }}
      >
        Unbound
      </span>
    </div>
  );
}

/* Processing / awaiting-extraction state. `processing` = audio-rt running
 * /export-voice. `uploaded` = sitting in storage with no extraction
 * attempted yet. We render an indeterminate animated bar instead of a
 * fake progress %, since audio-rt doesn't surface a real signal — the
 * user just sees "this is happening, give it a moment". */
function ProcessingBlock({
  status,
  updatedAt,
}: {
  status: "processing" | "uploaded";
  updatedAt: string;
}) {
  const headlineLabel = status === "processing" ? "Processing" : "Awaiting";
  const sub =
    status === "processing"
      ? "Embedding extraction"
      : "Waiting to extract";
  const started = relativeFromMs(Date.now() - new Date(updatedAt).getTime());
  return (
    <div
      style={{
        // Fill remaining row height when neighbor cards are taller.
        flex: 1,
        display: "flex",
        flexDirection: "column",
        gap: "var(--space-10)",
        padding: "var(--space-14)",
        background: "color-mix(in srgb, var(--status-draft) 6%, transparent)",
        border:
          "1px solid color-mix(in srgb, var(--status-draft) 18%, transparent)",
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
        <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-2)" }}>
          <span
            style={{
              fontFamily: FONT_MONO,
              fontSize: "var(--font-size-2xs)",
              letterSpacing: "0.12em",
              textTransform: "uppercase",
              color: "var(--status-draft)",
            }}
          >
            {headlineLabel}
          </span>
          <span
            style={{
              fontFamily: FONT_HEAD,
              fontSize: "var(--font-size-md)",
              fontWeight: 500,
              color: "var(--text-primary)",
            }}
          >
            {sub}
          </span>
        </div>
        <div style={{ display: "flex", gap: "var(--space-4)", alignItems: "center" }}>
          {[0, 1, 2].map((i) => (
            <span
              key={i}
              style={{
                width: 5,
                height: 5,
                borderRadius: "50%",
                background: "var(--status-draft)",
                opacity: i === 0 ? 1 : i === 1 ? 0.65 : 0.3,
                boxShadow:
                  i === 0
                    ? "0 0 6px color-mix(in srgb, var(--status-draft) 55%, transparent)"
                    : undefined,
              }}
            />
          ))}
        </div>
      </div>
      {/* Indeterminate animated bar. The keyframes are scoped to the
       * class name so they don't collide with other styles on the page. */}
      <div
        style={{
          position: "relative",
          height: 3,
          borderRadius: "var(--radius-pill)",
          background: "var(--ink-fill)",
          overflow: "hidden",
        }}
      >
        <style>{`
          @keyframes voices-card-indeterminate {
            0%   { transform: translateX(-100%); }
            100% { transform: translateX(280%); }
          }
        `}</style>
        <span
          style={{
            position: "absolute",
            inset: 0,
            width: "38%",
            background:
              "linear-gradient(90deg, color-mix(in srgb, var(--status-draft) 40%, transparent) 0%, var(--status-draft) 100%)",
            borderRadius: "var(--radius-pill)",
            boxShadow:
              "0 0 8px color-mix(in srgb, var(--status-draft) 45%, transparent)",
            animation: "voices-card-indeterminate 1.6s ease-in-out infinite",
          }}
        />
      </div>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          fontFamily: FONT_MONO,
          fontSize: "var(--font-size-xs)",
          letterSpacing: "0.04em",
          color: "var(--text-secondary)",
        }}
      >
        <span>Started {started}</span>
        <span style={{ color: "var(--status-draft)" }}>—</span>
      </div>
    </div>
  );
}

/* Failed extraction state. We parse `statusError` to surface a code-like
 * prefix (e.g. SOURCE_TOO_SHORT, EXTRACTION_TIMEOUT) so the card reads
 * as a structured error rather than a raw exception message. Retry &
 * Replace source CTAs both route to the detail page where the actual
 * extract / replace actions live. */
function FailedBlock({
  statusError,
  description,
  onRetry,
  onReplace,
}: {
  statusError: string | null;
  description: string | null;
  onRetry: (e: React.MouseEvent) => void;
  onReplace: (e: React.MouseEvent) => void;
}) {
  const parsed = parseStatusError(statusError);
  return (
    <div
      style={{
        // Fill remaining row height when neighbor cards are taller.
        flex: 1,
        display: "flex",
        flexDirection: "column",
        gap: "var(--space-10)",
        padding: "var(--space-14)",
        background: "var(--critical-wash)",
        border:
          "1px solid color-mix(in srgb, var(--status-error) 20%, transparent)",
        borderRadius: "var(--radius-lg)",
      }}
    >
      <div style={{ display: "flex", alignItems: "flex-start", gap: "var(--space-10)" }}>
        <div
          style={{
            width: 22,
            height: 22,
            flexShrink: 0,
            borderRadius: "50%",
            background: "color-mix(in srgb, var(--status-error) 18%, transparent)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            marginTop: "var(--space-1)",
          }}
        >
          <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
            <path
              d="M5 2V6 M5 8V8.01"
              stroke="var(--status-error)"
              strokeWidth="1.4"
              strokeLinecap="round"
            />
          </svg>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-3)", flex: 1 }}>
          <span
            style={{
              fontFamily: FONT_MONO,
              fontSize: "var(--font-size-2xs)",
              letterSpacing: "0.12em",
              textTransform: "uppercase",
              color: "var(--status-error)",
            }}
          >
            Extraction failed
          </span>
          <span
            style={{
              fontFamily: FONT_HEAD,
              fontSize: "var(--font-size-base)",
              lineHeight: "17px",
              color: "var(--text-secondary)",
              display: "-webkit-box",
              WebkitBoxOrient: "vertical",
              WebkitLineClamp: 2,
              overflow: "hidden",
            }}
          >
            {parsed.message ?? description ?? "audio-rt returned an error."}
            {parsed.code && (
              <>
                {" "}
                —{" "}
                <span style={{ fontFamily: FONT_MONO, color: "var(--status-error)" }}>
                  {parsed.code}
                </span>
              </>
            )}
          </span>
        </div>
      </div>
      <div
        style={{
          display: "flex",
          gap: "var(--space-6)",
          paddingTop: "var(--space-4)",
          borderTop:
            "1px solid color-mix(in srgb, var(--status-error) 10%, transparent)",
        }}
      >
        <button
          type="button"
          onClick={onRetry}
          style={{
            flex: 1,
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            gap: "var(--space-6)",
            padding: "6px 10px",
            borderRadius: "var(--radius-md)",
            background: "color-mix(in srgb, var(--status-error) 10%, transparent)",
            border:
              "1px solid color-mix(in srgb, var(--status-error) 24%, transparent)",
            color: "var(--status-error)",
            fontFamily: FONT_HEAD,
            fontSize: "var(--font-size-sm)",
            fontWeight: 500,
            cursor: "pointer",
          }}
        >
          <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
            <path
              d="M9 4 V2 H7 M1 6 V8 H3"
              stroke="currentColor"
              strokeWidth="1"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            <path
              d="M2 3 A3 3 0 0 1 8 5 M8 7 A3 3 0 0 1 2 5"
              stroke="currentColor"
              strokeWidth="1"
              fill="none"
              strokeLinecap="round"
            />
          </svg>
          Retry
        </button>
        <button
          type="button"
          onClick={onReplace}
          style={{
            flex: 1,
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            gap: "var(--space-6)",
            padding: "6px 10px",
            borderRadius: "var(--radius-md)",
            background:
              "var(--ink-soft)",
            border:
              "1px solid color-mix(in srgb, var(--text-primary) 8%, transparent)",
            color: "var(--text-secondary)",
            fontFamily: FONT_HEAD,
            fontSize: "var(--font-size-sm)",
            fontWeight: 500,
            cursor: "pointer",
          }}
        >
          <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
            <path
              d="M5 1V7 M2 4L5 7L8 4"
              stroke="currentColor"
              strokeWidth="1"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            <path
              d="M1 9H9"
              stroke="currentColor"
              strokeWidth="1"
              strokeLinecap="round"
            />
          </svg>
          Replace source
        </button>
      </div>
    </div>
  );
}

/* Pull a code-like prefix out of a raw error string. audio-rt errors
 * often look like "SOURCE_TOO_SHORT: clip must be ≥10s" or
 * "EXTRACTION_TIMEOUT after 180s" — we want to surface the code as a
 * monospace chip and the rest as descriptive text. Falls back to
 * returning the raw message when no code pattern is detectable. */
function parseStatusError(raw: string | null): {
  code: string | null;
  message: string | null;
} {
  if (!raw) return { code: null, message: null };
  // Match leading SCREAMING_SNAKE_CASE up to 48 chars, optionally followed
  // by ": ", "—", or " after ".
  const m = raw.match(/^([A-Z][A-Z0-9_]{2,47})(?:\s*[:—]\s*|\s+(?=after\b))(.*)$/);
  if (m) return { code: m[1], message: m[2].trim() || null };
  return { code: null, message: raw };
}

function StatusPill({ status }: { status: VoiceStatus }) {
  const color = STATUS_COLORS[status];
  const label = STATUS_LABELS[status];
  const isActive = status === "ready" || status === "processing";
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: "var(--space-8)" }}>
      <span
        aria-hidden
        style={{
          display: "inline-block",
          width: 6,
          height: 6,
          borderRadius: "var(--radius-pill)",
          background: color,
          boxShadow: isActive ? `0 0 8px ${color}` : undefined,
        }}
      />
      <span
        style={{
          fontFamily: FONT_MONO,
          fontSize: "var(--font-size-2xs)",
          letterSpacing: "0.20em",
          textTransform: "uppercase",
          color,
        }}
      >
        {label}
      </span>
    </span>
  );
}

/* ── + new voice button ──────────────────────────────────────── */

/* Mint-filled primary CTA. Brightens on hover/focus via a color-mix
 * blend so the button keeps its mint identity but reads as "lighter /
 * interactive," and gains a 3px mint-tint glow ring for affordance. */
function NewVoiceButton({ onClick }: { onClick: () => void }) {
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
        boxShadow: hovered
          ? "var(--ring-shadow-selected)"
          : "none",
      }}
    >
      + new voice
    </button>
  );
}

/* ── Refresh button ───────────────────────────────────────────── */

function RefreshButton() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  return (
    <>
      <style>{`@keyframes voices-refresh-spin{from{transform:rotate(0)}to{transform:rotate(360deg)}}`}</style>
      <button
        type="button"
        onClick={() => startTransition(() => router.refresh())}
        disabled={pending}
        aria-label={pending ? "Refreshing" : "Refresh"}
        title="Refresh"
        style={{
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          width: 30,
          height: 28,
          padding: 0,
          border: "1px solid color-mix(in srgb, var(--text-primary) 8%, transparent)",
          borderRadius: "var(--radius-pill)",
          background: "transparent",
          color: "var(--text-tertiary)",
          cursor: pending ? "progress" : "pointer",
          opacity: pending ? 0.75 : 1,
        }}
      >
        <svg
          width="13"
          height="13"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          style={{
            animation: pending
              ? "voices-refresh-spin 800ms linear infinite"
              : undefined,
            transformOrigin: "center",
          }}
        >
          <path d="M3 12a9 9 0 0 1 15-6.7L21 8" />
          <path d="M21 3v5h-5" />
          <path d="M21 12a9 9 0 0 1-15 6.7L3 16" />
          <path d="M3 21v-5h5" />
        </svg>
      </button>
    </>
  );
}

