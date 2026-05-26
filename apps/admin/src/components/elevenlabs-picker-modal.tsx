"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useRouter } from "next/navigation";
import { createPortal } from "react-dom";
import type { ElevenLabsPreset } from "@/app/api/voices/elevenlabs/presets/route";

/* ── Tokens ─────────────────────────────────────────────────── */

const FONT_HEAD = "'Inter', system-ui, sans-serif";
const FONT_DISPLAY = "'Space Grotesk', system-ui, sans-serif";
const FONT_MONO = "'JetBrains Mono', ui-monospace, monospace";

/* ── Types ──────────────────────────────────────────────────── */

export type ElevenLabsPickerModalProps = {
  open: boolean;
  onClose: () => void;
  /** Optional callback when the user hits the "← Pick a different provider"
   * back link. If omitted, the link is hidden. */
  onBack?: () => void;
  /** Slugs currently in use — used to avoid collisions before the POST.
   * Receive a typed slug, return null if available or an error message. */
  existingSlugs?: string[];
};

type FetchState =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "loaded"; presets: ElevenLabsPreset[] }
  | { kind: "error"; message: string };

/* ── Component ──────────────────────────────────────────────── */

export function ElevenLabsPickerModal({
  open,
  onClose,
  onBack,
  existingSlugs = [],
}: ElevenLabsPickerModalProps) {
  const router = useRouter();
  const [state, setState] = useState<FetchState>({ kind: "idle" });
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [auditioningId, setAuditioningId] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [playProgress, setPlayProgress] = useState<{
    elapsed: number;
    duration: number;
  } | null>(null);

  // Form fields surface once a preset is selected.
  const [displayName, setDisplayName] = useState("");
  const [slug, setSlug] = useState("");
  const [tags, setTags] = useState<string[]>([]);
  const [tagDraft, setTagDraft] = useState("");
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // Fetch presets on open. Cached server-side (5min); /presets?refresh=1
  // forces a refetch but the picker doesn't expose that yet.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setState({ kind: "loading" });
    fetch("/api/voices/elevenlabs/presets")
      .then(async (r) => {
        const data = (await r.json()) as
          | { presets: ElevenLabsPreset[] }
          | { error: string };
        if (cancelled) return;
        if (!r.ok || "error" in data) {
          setState({
            kind: "error",
            message: "error" in data ? data.error : `HTTP ${r.status}`,
          });
          return;
        }
        setState({ kind: "loaded", presets: data.presets });
      })
      .catch((err) => {
        if (cancelled) return;
        setState({ kind: "error", message: (err as Error).message });
      });
    return () => {
      cancelled = true;
    };
  }, [open]);

  // Reset internal state when the modal closes so a re-open starts clean.
  useEffect(() => {
    if (open) return;
    setSelectedId(null);
    setAuditioningId(null);
    setSearch("");
    setDisplayName("");
    setSlug("");
    setTags([]);
    setTagDraft("");
    setSaveError(null);
    audioRef.current?.pause();
    audioRef.current = null;
    setPlayProgress(null);
  }, [open]);

  // Keyboard: Esc closes; Enter on form commits.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        if (!saving) onClose();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose, saving]);

  /* ── Selection + inherited fields ────────────────────────── */

  const selected = useMemo(() => {
    if (state.kind !== "loaded") return null;
    return state.presets.find((p) => p.voiceId === selectedId) ?? null;
  }, [state, selectedId]);

  useEffect(() => {
    if (!selected) return;
    // Initialize display name from ElevenLabs name; user can edit.
    setDisplayName(selected.name);
    const proposed = slugify(selected.name);
    setSlug(proposed);
    // Seed tags from labels (use_case + age + accent flavors). The picker
    // pre-fills these but they remain editable.
    setTags(
      Array.from(
        new Set(
          [selected.useCase, selected.age, selected.accent]
            .filter((t): t is string => Boolean(t))
            .map((t) => t.toLowerCase()),
        ),
      ),
    );
    setSaveError(null);
  }, [selected]);

  const filtered = useMemo(() => {
    if (state.kind !== "loaded") return [];
    const q = search.trim().toLowerCase();
    if (!q) return state.presets;
    return state.presets.filter((p) => {
      const hay = [
        p.name,
        p.description,
        p.gender,
        p.accent,
        p.age,
        p.useCase,
        p.language,
        Object.values(p.labels).join(" "),
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return hay.includes(q);
    });
  }, [state, search]);

  /* ── Audition playback ───────────────────────────────────── */

  const startAudition = useCallback(
    (preset: ElevenLabsPreset) => {
      if (!preset.previewUrl) return;
      // Stop previous if any.
      audioRef.current?.pause();
      const audio = new Audio(preset.previewUrl);
      audio.preload = "metadata";
      audio.addEventListener("timeupdate", () => {
        setPlayProgress({
          elapsed: audio.currentTime,
          duration: audio.duration || 0,
        });
      });
      audio.addEventListener("ended", () => {
        setAuditioningId(null);
        setPlayProgress(null);
      });
      audio.addEventListener("error", () => {
        setAuditioningId(null);
        setPlayProgress(null);
      });
      audio.play().catch(() => {
        setAuditioningId(null);
        setPlayProgress(null);
      });
      audioRef.current = audio;
      setAuditioningId(preset.voiceId);
    },
    [],
  );

  const stopAudition = useCallback(() => {
    audioRef.current?.pause();
    audioRef.current = null;
    setAuditioningId(null);
    setPlayProgress(null);
  }, []);

  /* ── Tag chip handlers ───────────────────────────────────── */

  const addTag = useCallback(() => {
    const clean = tagDraft.trim().toLowerCase();
    if (!clean) return;
    setTagDraft("");
    setTags((prev) => (prev.includes(clean) ? prev : [...prev, clean]));
  }, [tagDraft]);

  const removeTag = useCallback((tag: string) => {
    setTags((prev) => prev.filter((t) => t !== tag));
  }, []);

  /* ── Slug validation ─────────────────────────────────────── */

  const slugStatus = useMemo<"available" | "taken" | "invalid" | "empty">(() => {
    const trimmed = slug.trim().toLowerCase();
    if (!trimmed) return "empty";
    if (!/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(trimmed)) return "invalid";
    if (existingSlugs.includes(trimmed)) return "taken";
    return "available";
  }, [slug, existingSlugs]);

  /* ── Save ────────────────────────────────────────────────── */

  const submit = useCallback(async () => {
    if (!selected || saving) return;
    if (slugStatus !== "available") return;
    setSaving(true);
    setSaveError(null);
    try {
      audioRef.current?.pause();
      const res = await fetch("/api/voices", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          provider: "elevenlabs",
          name: displayName.trim() || selected.name,
          slug: slug.trim().toLowerCase(),
          tags,
          language: selected.language ?? null,
          gender: selected.gender ?? null,
          providerConfig: {
            voiceId: selected.voiceId,
          },
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      const data = (await res.json()) as { voice: { slug: string } };
      router.push(`/voices/${data.voice.slug}`);
      router.refresh();
    } catch (err) {
      setSaveError((err as Error).message);
    } finally {
      setSaving(false);
    }
  }, [selected, saving, slugStatus, displayName, slug, tags, router]);

  if (!open) return null;

  /* ── Render ──────────────────────────────────────────────── */

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="elevenlabs-picker-title"
      onClick={(e) => {
        if (e.target === e.currentTarget && !saving) onClose();
      }}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 1100,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "var(--space-24)",
        background: "var(--modal-backdrop)",
        backdropFilter: "blur(2px)",
      }}
    >
      <div
        style={{
          width: 560,
          maxWidth: "100%",
          display: "flex",
          flexDirection: "column",
          background: "var(--background)",
          border: "1px solid var(--border)",
          borderRadius: "var(--radius-xl)",
          boxShadow: "var(--elevation-panel)",
          maxHeight: "90vh",
          overflow: "hidden",
        }}
      >
        <Header onBack={onBack} onClose={onClose} disabled={saving} />
        <Tabs presetCount={state.kind === "loaded" ? state.presets.length : 0} />
        <div style={{ overflowY: "auto", flex: 1 }}>
          <BodyContent
            state={state}
            search={search}
            setSearch={setSearch}
            filtered={filtered}
            selectedId={selectedId}
            setSelectedId={setSelectedId}
            auditioningId={auditioningId}
            startAudition={startAudition}
            stopAudition={stopAudition}
          />
          {selected && (
            <InlineForm
              selected={selected}
              displayName={displayName}
              setDisplayName={setDisplayName}
              slug={slug}
              setSlug={setSlug}
              slugStatus={slugStatus}
              tags={tags}
              addTag={addTag}
              removeTag={removeTag}
              tagDraft={tagDraft}
              setTagDraft={setTagDraft}
            />
          )}
        </div>
        <Footer
          state={state}
          selected={selected}
          slugStatus={slugStatus}
          saving={saving}
          saveError={saveError}
          playProgress={playProgress}
          auditioningName={
            auditioningId && state.kind === "loaded"
              ? state.presets.find((p) => p.voiceId === auditioningId)?.name ??
                null
              : null
          }
          onCancel={onClose}
          onSubmit={submit}
        />
      </div>
    </div>,
    document.body,
  );
}

/* ── Header ─────────────────────────────────────────────────── */

function Header({
  onBack,
  onClose,
  disabled,
}: {
  onBack?: () => void;
  onClose: () => void;
  disabled: boolean;
}) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "flex-start",
        justifyContent: "space-between",
        padding: "20px 22px 12px 22px",
        gap: "var(--space-12)",
      }}
    >
      <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-8)" }}>
        {onBack && (
          <button
            type="button"
            onClick={onBack}
            disabled={disabled}
            style={{
              display: "inline-flex",
              alignSelf: "flex-start",
              alignItems: "center",
              gap: "var(--space-5)",
              padding: "3px 8px",
              borderRadius: "var(--radius-sm)",
              background: "var(--ink-soft)",
              border: "1px solid var(--ink-fill)",
              color: "var(--text-secondary)",
              fontFamily: FONT_HEAD,
              fontSize: "var(--font-size-sm)",
              cursor: disabled ? "not-allowed" : "pointer",
            }}
          >
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="15 18 9 12 15 6" />
            </svg>
            Pick a different provider
          </button>
        )}
        <div
          id="elevenlabs-picker-title"
          style={{
            display: "flex",
            alignItems: "center",
            gap: "var(--space-10)",
            fontFamily: FONT_DISPLAY,
            fontSize: "var(--font-size-2xl)",
            fontWeight: 600,
            letterSpacing: "-0.01em",
            color: "var(--text-primary)",
          }}
        >
          + new ElevenLabs voice
          <span
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: "var(--space-5)",
              padding: "2px 8px",
              borderRadius: "var(--radius-pill)",
              border:
                "1px solid var(--accent-border)",
              background:
                "var(--accent-fill)",
              color: "var(--accent-strong)",
              fontFamily: FONT_MONO,
              fontSize: "var(--font-size-2xs)",
              fontWeight: 600,
              letterSpacing: "0.20em",
              textTransform: "uppercase",
            }}
          >
            <span
              style={{
                width: 5,
                height: 5,
                borderRadius: "var(--radius-pill)",
                background: "var(--accent-strong)",
              }}
            />
            ELEVEN
          </span>
        </div>
      </div>
      <button
        type="button"
        onClick={onClose}
        disabled={disabled}
        aria-label="Close"
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          width: 28,
          height: 28,
          borderRadius: "var(--radius-md)",
          border: "none",
          background: "transparent",
          color: "var(--text-tertiary)",
          cursor: disabled ? "not-allowed" : "pointer",
        }}
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
          <line x1="6" y1="6" x2="18" y2="18" />
          <line x1="18" y1="6" x2="6" y2="18" />
        </svg>
      </button>
    </div>
  );
}

/* ── Tabs ───────────────────────────────────────────────────── */

function Tabs({ presetCount }: { presetCount: number }) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        padding: "0 22px",
        borderBottom: "1px solid var(--divider)",
      }}
    >
      <div
        role="tab"
        aria-selected="true"
        style={{
          display: "flex",
          alignItems: "center",
          gap: 7,
          padding: "10px 14px",
          borderBottom: "2px solid var(--accent-strong)",
          marginBottom: -1,
          fontFamily: FONT_HEAD,
          fontSize: 12.5,
          fontWeight: 500,
          color: "var(--text-primary)",
        }}
      >
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <rect x="3" y="3" width="18" height="18" rx="2" />
          <circle cx="12" cy="12" r="3" />
        </svg>
        Pick from preset library
        <span
          style={{
            display: "inline-block",
            padding: "1px 6px",
            borderRadius: "var(--radius-xs)",
            background: "var(--ink-fill)",
            fontFamily: FONT_MONO,
            fontSize: "var(--font-size-xs)",
            color: "var(--text-tertiary)",
          }}
        >
          {presetCount}
        </span>
      </div>
      <div
        role="tab"
        aria-disabled="true"
        title="Clone from audio — coming soon"
        style={{
          display: "flex",
          alignItems: "center",
          gap: 7,
          padding: "10px 14px",
          fontFamily: FONT_HEAD,
          fontSize: 12.5,
          color: "var(--text-tertiary)",
          opacity: 0.4,
          cursor: "not-allowed",
        }}
      >
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M21 12c0 4.97-4.03 9-9 9s-9-4.03-9-9 4.03-9 9-9" />
          <path d="M21 3v6h-6" />
        </svg>
        Clone from audio
        <span
          style={{
            display: "inline-flex",
            alignItems: "center",
            padding: "1px 6px",
            borderRadius: "var(--radius-pill)",
            border: "1px solid var(--ink-edge)",
            fontFamily: FONT_MONO,
            fontSize: "var(--font-size-3xs)",
            fontWeight: 500,
            letterSpacing: "0.18em",
            color: "var(--text-tertiary)",
          }}
        >
          SOON
        </span>
      </div>
    </div>
  );
}

/* ── Body ───────────────────────────────────────────────────── */

function BodyContent({
  state,
  search,
  setSearch,
  filtered,
  selectedId,
  setSelectedId,
  auditioningId,
  startAudition,
  stopAudition,
}: {
  state: FetchState;
  search: string;
  setSearch: (v: string) => void;
  filtered: ElevenLabsPreset[];
  selectedId: string | null;
  setSelectedId: (id: string | null) => void;
  auditioningId: string | null;
  startAudition: (p: ElevenLabsPreset) => void;
  stopAudition: () => void;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", padding: "16px 22px", gap: "var(--space-16)" }}>
      <SearchInput
        value={search}
        onChange={setSearch}
        placeholder={
          state.kind === "loading"
            ? "Loading presets from ElevenLabs…"
            : "Search by name, accent, gender…"
        }
        countLabel={
          state.kind === "loaded"
            ? `${filtered.length}${search ? ` of ${state.presets.length}` : ""} voices`
            : state.kind === "loading"
              ? "Fetching…"
              : ""
        }
      />

      {state.kind === "error" ? (
        <ErrorPanel message={state.message} />
      ) : state.kind !== "loaded" ? (
        <SkeletonRows />
      ) : state.presets.length === 0 ? (
        <EmptyPanel
          title="No voices in your ElevenLabs library yet"
          body="Add some in the ElevenLabs dashboard, or come back when you have one."
        />
      ) : filtered.length === 0 ? (
        <EmptyPanel
          title={`No voices match "${search}"`}
          body="Try a broader search."
        />
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-6)" }}>
          {filtered.map((preset) => (
            <PresetRow
              key={preset.voiceId}
              preset={preset}
              selected={preset.voiceId === selectedId}
              auditioning={preset.voiceId === auditioningId}
              onSelect={() => setSelectedId(preset.voiceId)}
              onAudition={() => {
                if (preset.voiceId === auditioningId) stopAudition();
                else startAudition(preset);
              }}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function SearchInput({
  value,
  onChange,
  placeholder,
  countLabel,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  countLabel: string;
}) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: "var(--space-10)",
        padding: "0 14px",
        height: 36,
        borderRadius: "var(--radius-md)",
        background: "var(--input-bg)",
        border: "1px solid var(--input-border)",
      }}
    >
      <svg width="13" height="13" viewBox="0 0 14 14" fill="none">
        <circle cx="6" cy="6" r="4" stroke="var(--text-tertiary)" strokeWidth="1.5" />
        <line x1="9" y1="9" x2="12.5" y2="12.5" stroke="var(--text-tertiary)" strokeWidth="1.5" strokeLinecap="round" />
      </svg>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        style={{
          flex: 1,
          minWidth: 0,
          background: "transparent",
          border: "none",
          outline: "none",
          color: "var(--text-primary)",
          fontFamily: FONT_HEAD,
          fontSize: "var(--font-size-md)",
        }}
      />
      {countLabel && (
        <span
          style={{
            fontFamily: FONT_MONO,
            fontSize: "var(--font-size-xs)",
            color: "var(--text-quaternary)",
            whiteSpace: "nowrap",
          }}
        >
          {countLabel}
        </span>
      )}
    </div>
  );
}

function PresetRow({
  preset,
  selected,
  auditioning,
  onSelect,
  onAudition,
}: {
  preset: ElevenLabsPreset;
  selected: boolean;
  auditioning: boolean;
  onSelect: () => void;
  onAudition: () => void;
}) {
  const accentBorder = selected
    ? "color-mix(in srgb, var(--accent-strong) 50%, transparent)"
    : "var(--border)";
  const accentBg = selected
    ? "color-mix(in srgb, var(--accent-strong) 8%, transparent)"
    : "var(--ink-wash)";

  return (
    <div
      onClick={onSelect}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onSelect();
        }
      }}
      style={{
        display: "flex",
        alignItems: "center",
        gap: "var(--space-12)",
        padding: "10px 12px",
        borderRadius: "var(--radius-md)",
        background: accentBg,
        border: `1px solid ${accentBorder}`,
        cursor: "pointer",
        transition: "background 120ms, border-color 120ms",
      }}
    >
      <Avatar letter={preset.name.charAt(0)} />
      <div
        style={{
          flex: 1,
          minWidth: 0,
          display: "flex",
          flexDirection: "column",
          gap: "var(--space-3)",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "var(--space-8)" }}>
          <span
            style={{
              fontFamily: FONT_HEAD,
              fontSize: "var(--font-size-lg)",
              fontWeight: 600,
              color: "var(--text-primary)",
            }}
          >
            {preset.name}
          </span>
          <CategoryBadge category={preset.category} />
        </div>
        <div
          style={{
            fontFamily: FONT_MONO,
            fontSize: "var(--font-size-sm)",
            color: "var(--text-tertiary)",
            display: "flex",
            gap: "var(--space-6)",
            flexWrap: "wrap",
          }}
        >
          {[preset.language, preset.gender, preset.accent, preset.age, preset.useCase]
            .filter((v): v is string => Boolean(v))
            .map((part, i, arr) => (
              <span key={`${part}-${i}`}>
                {part}
                {i < arr.length - 1 && (
                  <span style={{ marginLeft: "var(--space-6)", color: "var(--text-quaternary)" }}>·</span>
                )}
              </span>
            ))}
        </div>
      </div>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onAudition();
        }}
        aria-label={auditioning ? "Pause audition" : "Play audition"}
        disabled={!preset.previewUrl}
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          width: 28,
          height: 28,
          borderRadius: "var(--radius-md)",
          border: `1px solid ${auditioning ? "var(--accent-strong)" : "var(--border)"}`,
          background: auditioning
            ? "var(--accent-strong)"
            : "var(--ink-soft)",
          color: auditioning ? "var(--background)" : "var(--text-secondary)",
          cursor: preset.previewUrl ? "pointer" : "not-allowed",
          opacity: preset.previewUrl ? 1 : 0.4,
          flexShrink: 0,
        }}
      >
        {auditioning ? (
          <svg width="10" height="10" viewBox="0 0 10 10" fill="currentColor">
            <rect x="2" y="1" width="2" height="8" />
            <rect x="6" y="1" width="2" height="8" />
          </svg>
        ) : (
          <svg width="10" height="10" viewBox="0 0 10 10" fill="currentColor">
            <path d="M2.5 1.5 v7 l6 -3.5 z" />
          </svg>
        )}
      </button>
      <SelectedRadio selected={selected} />
    </div>
  );
}

function Avatar({ letter }: { letter: string }) {
  return (
    <div
      style={{
        width: 32,
        height: 32,
        flexShrink: 0,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        borderRadius: "var(--radius-md)",
        background: "color-mix(in srgb, var(--accent-strong) 8%, transparent)",
        border: "1px solid color-mix(in srgb, var(--accent-strong) 18%, transparent)",
        fontFamily: FONT_DISPLAY,
        fontSize: "var(--font-size-lg)",
        fontWeight: 600,
        color: "var(--accent-strong)",
      }}
    >
      {letter.toUpperCase()}
    </div>
  );
}

function CategoryBadge({ category }: { category: string }) {
  const isCloned = category === "cloned" || category === "professional";
  const isGenerated = category === "generated";
  const label = isCloned
    ? "CLONED · YOURS"
    : isGenerated
      ? "GENERATED"
      : "PREMADE";
  const color = isCloned
    ? "var(--status-draft)"
    : isGenerated
      ? "var(--text-tertiary)"
      : "var(--text-tertiary)";
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        padding: "1px 6px",
        borderRadius: "var(--radius-xs)",
        border: `1px solid ${
          isCloned
            ? "color-mix(in srgb, var(--status-draft) 30%, transparent)"
            : "var(--ink-line)"
        }`,
        background: isCloned
          ? "color-mix(in srgb, var(--status-draft) 10%, transparent)"
          : "var(--ink-soft)",
        fontFamily: FONT_MONO,
        fontSize: "var(--font-size-2xs)",
        fontWeight: 600,
        letterSpacing: "0.10em",
        color,
      }}
    >
      {label}
    </span>
  );
}

function SelectedRadio({ selected }: { selected: boolean }) {
  return (
    <div
      style={{
        width: 18,
        height: 18,
        flexShrink: 0,
        borderRadius: "var(--radius-pill)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: selected ? "var(--accent-strong)" : "transparent",
        border: `1.5px solid ${selected ? "var(--accent-strong)" : "var(--ink-edge)"}`,
      }}
    >
      {selected && (
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="var(--background)" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="20 6 9 17 4 12" />
        </svg>
      )}
    </div>
  );
}

function SkeletonRows() {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-6)" }}>
      {[0, 1, 2, 3].map((i) => (
        <div
          key={i}
          style={{
            height: 58,
            borderRadius: "var(--radius-md)",
            background: "var(--ink-wash)",
            border: "1px solid var(--ink-soft)",
          }}
        />
      ))}
    </div>
  );
}

function EmptyPanel({ title, body }: { title: string; body: string }) {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: "var(--space-6)",
        padding: "24px 16px",
        borderRadius: "var(--radius-md)",
        background: "var(--ink-wash)",
        border: "1px solid var(--border)",
        textAlign: "center",
        alignItems: "center",
      }}
    >
      <div
        style={{
          fontFamily: FONT_HEAD,
          fontSize: "var(--font-size-md)",
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

function ErrorPanel({ message }: { message: string }) {
  return (
    <div
      style={{
        padding: "12px 14px",
        borderRadius: "var(--radius-md)",
        background: "var(--critical-wash)",
        border: "1px solid var(--critical-border)",
        color: "var(--status-error)",
        fontFamily: FONT_MONO,
        fontSize: "var(--font-size-base)",
      }}
    >
      {message}
    </div>
  );
}

/* ── Inline Form ────────────────────────────────────────────── */

function InlineForm({
  selected,
  displayName,
  setDisplayName,
  slug,
  setSlug,
  slugStatus,
  tags,
  addTag,
  removeTag,
  tagDraft,
  setTagDraft,
}: {
  selected: ElevenLabsPreset;
  displayName: string;
  setDisplayName: (v: string) => void;
  slug: string;
  setSlug: (v: string) => void;
  slugStatus: "available" | "taken" | "invalid" | "empty";
  tags: string[];
  addTag: () => void;
  removeTag: (tag: string) => void;
  tagDraft: string;
  setTagDraft: (v: string) => void;
}) {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: "var(--space-14)",
        padding: "16px 22px",
        borderTop: "1px solid var(--divider)",
      }}
    >
      <div
        style={{
          fontFamily: FONT_MONO,
          fontSize: "var(--font-size-xs)",
          letterSpacing: "0.18em",
          textTransform: "uppercase",
          color: "var(--text-tertiary)",
        }}
      >
        Customize {selected.name} for your library
      </div>

      <div style={{ display: "flex", gap: "var(--space-14)" }}>
        <FieldColumn label="Display name">
          <TextInput value={displayName} onChange={setDisplayName} />
        </FieldColumn>
        <FieldColumn
          label="Slug"
          hint={<SlugHint status={slugStatus} />}
        >
          <TextInput
            value={slug}
            onChange={(v) => setSlug(v.toLowerCase())}
            mono
            invalid={slugStatus === "taken" || slugStatus === "invalid"}
          />
        </FieldColumn>
      </div>

      <FieldColumn
        label="Tags"
        hint={
          <span
            style={{
              fontFamily: FONT_MONO,
              fontSize: "var(--font-size-2xs)",
              color: "var(--text-quaternary)",
            }}
          >
            Pre-filled from ElevenLabs labels · editable
          </span>
        }
      >
        <TagsInput
          tags={tags}
          addTag={addTag}
          removeTag={removeTag}
          draft={tagDraft}
          setDraft={setTagDraft}
        />
      </FieldColumn>

      <InheritedRow selected={selected} />
    </div>
  );
}

function FieldColumn({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: "var(--space-6)" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "var(--space-8)" }}>
        <span
          style={{
            fontFamily: FONT_HEAD,
            fontSize: "var(--font-size-sm)",
            color: "var(--text-tertiary)",
          }}
        >
          {label}
        </span>
        {hint}
      </div>
      {children}
    </div>
  );
}

function TextInput({
  value,
  onChange,
  mono = false,
  invalid = false,
}: {
  value: string;
  onChange: (v: string) => void;
  mono?: boolean;
  invalid?: boolean;
}) {
  return (
    <input
      type="text"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      style={{
        padding: "8px 12px",
        height: 36,
        borderRadius: "var(--radius-md)",
        border: `1px solid ${invalid ? "color-mix(in srgb, var(--status-error) 40%, transparent)" : "var(--border)"}`,
        background: "var(--input-bg)",
        color: "var(--text-primary)",
        fontFamily: mono ? FONT_MONO : FONT_HEAD,
        fontSize: mono ? 12 : 13,
        outline: "none",
      }}
    />
  );
}

function SlugHint({
  status,
}: {
  status: "available" | "taken" | "invalid" | "empty";
}) {
  if (status === "available") {
    return (
      <span
        style={{
          fontFamily: FONT_MONO,
          fontSize: "var(--font-size-xs)",
          fontWeight: 600,
          letterSpacing: "0.10em",
          textTransform: "uppercase",
          color: "var(--accent-strong)",
        }}
      >
        ✓ available
      </span>
    );
  }
  if (status === "taken") {
    return (
      <span
        style={{
          fontFamily: FONT_MONO,
          fontSize: "var(--font-size-xs)",
          color: "var(--status-error)",
        }}
      >
        taken
      </span>
    );
  }
  if (status === "invalid") {
    return (
      <span
        style={{
          fontFamily: FONT_MONO,
          fontSize: "var(--font-size-xs)",
          color: "var(--status-error)",
        }}
      >
        invalid format
      </span>
    );
  }
  return (
    <span
      style={{
        fontFamily: FONT_MONO,
        fontSize: "var(--font-size-xs)",
        color: "var(--text-quaternary)",
      }}
    >
      required
    </span>
  );
}

function TagsInput({
  tags,
  addTag,
  removeTag,
  draft,
  setDraft,
}: {
  tags: string[];
  addTag: () => void;
  removeTag: (tag: string) => void;
  draft: string;
  setDraft: (v: string) => void;
}) {
  return (
    <div
      style={{
        display: "flex",
        flexWrap: "wrap",
        gap: "var(--space-6)",
        alignItems: "center",
        padding: "var(--space-8)",
        borderRadius: "var(--radius-md)",
        border: "1px solid var(--border)",
        background: "var(--input-bg)",
        minHeight: 36,
      }}
    >
      {tags.map((t) => (
        <span
          key={t}
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: "var(--space-6)",
            padding: "3px 8px",
            borderRadius: "var(--radius-pill)",
            border:
              "1px solid var(--accent-border)",
            background:
              "var(--accent-fill)",
            color: "var(--accent-strong)",
            fontFamily: FONT_MONO,
            fontSize: "var(--font-size-sm)",
            fontWeight: 600,
          }}
        >
          {t}
          <button
            type="button"
            aria-label={`remove ${t}`}
            onClick={() => removeTag(t)}
            style={{
              background: "transparent",
              border: "none",
              color: "var(--accent-strong)",
              opacity: 0.7,
              cursor: "pointer",
              padding: 0,
              fontSize: "var(--font-size-sm)",
              lineHeight: 1,
            }}
          >
            ×
          </button>
        </span>
      ))}
      <input
        type="text"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === ",") {
            e.preventDefault();
            addTag();
          }
        }}
        onBlur={addTag}
        placeholder="+ add tag"
        style={{
          flex: 1,
          minWidth: 80,
          padding: "3px 6px",
          background: "transparent",
          border: "none",
          color: "var(--text-secondary)",
          fontFamily: FONT_MONO,
          fontSize: "var(--font-size-sm)",
          outline: "none",
        }}
      />
    </div>
  );
}

function InheritedRow({ selected }: { selected: ElevenLabsPreset }) {
  const chips = [
    selected.language && `${selected.language}`,
    selected.gender,
    `11labs:${selected.voiceId.slice(0, 7)}…`,
  ].filter((v): v is string => Boolean(v));
  return (
    <div style={{ display: "flex", alignItems: "center", gap: "var(--space-10)", flexWrap: "wrap" }}>
      <span
        style={{
          fontFamily: FONT_MONO,
          fontSize: "var(--font-size-xs)",
          letterSpacing: "0.18em",
          textTransform: "uppercase",
          color: "var(--text-tertiary)",
        }}
      >
        Inherited
      </span>
      {chips.map((chip, i) => (
        <span
          key={i}
          style={{
            display: "inline-flex",
            alignItems: "center",
            padding: "2px 8px",
            borderRadius: "var(--radius-pill)",
            border: "1px solid var(--border)",
            fontFamily: FONT_MONO,
            fontSize: "var(--font-size-xs)",
            color: "var(--text-tertiary)",
          }}
        >
          {chip}
        </span>
      ))}
    </div>
  );
}

/* ── Footer ─────────────────────────────────────────────────── */

function Footer({
  state,
  selected,
  slugStatus,
  saving,
  saveError,
  playProgress,
  auditioningName,
  onCancel,
  onSubmit,
}: {
  state: FetchState;
  selected: ElevenLabsPreset | null;
  slugStatus: "available" | "taken" | "invalid" | "empty";
  saving: boolean;
  saveError: string | null;
  playProgress: { elapsed: number; duration: number } | null;
  auditioningName: string | null;
  onCancel: () => void;
  onSubmit: () => void;
}) {
  const statusLine = useMemo(() => {
    if (saveError) return saveError;
    if (state.kind === "loading") return "Connecting to ElevenLabs";
    if (state.kind === "error") return "Failed to load presets";
    if (auditioningName && playProgress) {
      return `Playing ${auditioningName} · ${formatTime(playProgress.elapsed)} / ${formatTime(playProgress.duration)}`;
    }
    if (selected && slugStatus === "available") {
      return `Will be added as '${selected.name.toLowerCase()}' · ready immediately`;
    }
    return "Pick a voice to continue";
  }, [
    saveError,
    state.kind,
    auditioningName,
    playProgress,
    selected,
    slugStatus,
  ]);

  const canSave = Boolean(selected) && slugStatus === "available" && !saving;

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: "var(--space-12)",
        padding: "12px 22px",
        borderTop: "1px solid var(--divider)",
      }}
    >
      <span
        style={{
          fontFamily: FONT_MONO,
          fontSize: "var(--font-size-sm)",
          color: saveError ? "var(--status-error)" : "var(--text-tertiary)",
          flex: 1,
          minWidth: 0,
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
      >
        {statusLine}
      </span>
      <div style={{ display: "flex", gap: "var(--space-8)", flexShrink: 0 }}>
        <SecondaryButton onClick={onCancel} disabled={saving}>
          Cancel
        </SecondaryButton>
        <PrimaryButton onClick={onSubmit} disabled={!canSave}>
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="20 6 9 17 4 12" />
          </svg>
          {saving ? "Adding…" : selected ? `Add ${selected.name}` : "Add voice"}
        </PrimaryButton>
      </div>
    </div>
  );
}

/* ── Footer buttons ─────────────────────────────────────────── */

function PrimaryButton({
  onClick,
  disabled,
  children,
}: {
  onClick: () => void;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  const [hovered, setHovered] = useState(false);
  const bg = disabled
    ? "var(--ink-soft)"
    : hovered
      ? "color-mix(in srgb, var(--accent-strong) 88%, white 12%)"
      : "var(--accent-strong)";
  const border = disabled
    ? "var(--ink-line)"
    : hovered
      ? "color-mix(in srgb, var(--accent-strong) 88%, white 12%)"
      : "var(--accent-strong)";
  return (
    <button
      type="button"
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onFocus={() => setHovered(true)}
      onBlur={() => setHovered(false)}
      disabled={disabled}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: "var(--space-6)",
        padding: "8px 16px",
        height: 32,
        borderRadius: "var(--radius-md)",
        background: bg,
        border: `1px solid ${border}`,
        color: disabled ? "var(--text-quaternary)" : "var(--background)",
        fontFamily: FONT_HEAD,
        fontSize: "var(--font-size-base)",
        fontWeight: 600,
        cursor: disabled ? "not-allowed" : "pointer",
        transition: "background 120ms ease, border-color 120ms ease",
        boxShadow:
          !disabled && hovered
            ? "var(--ring-shadow-selected)"
            : "none",
      }}
    >
      {children}
    </button>
  );
}

function SecondaryButton({
  onClick,
  disabled,
  children,
}: {
  onClick: () => void;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  const [hovered, setHovered] = useState(false);
  return (
    <button
      type="button"
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      disabled={disabled}
      style={{
        padding: "8px 16px",
        height: 32,
        borderRadius: "var(--radius-md)",
        background: hovered && !disabled
          ? "var(--ink-soft)"
          : "transparent",
        border: `1px solid ${hovered && !disabled ? "var(--ink-edge)" : "var(--border)"}`,
        color: "var(--text-primary)",
        fontFamily: FONT_HEAD,
        fontSize: "var(--font-size-base)",
        fontWeight: 500,
        cursor: disabled ? "not-allowed" : "pointer",
        transition: "background 120ms ease, border-color 120ms ease",
      }}
    >
      {children}
    </button>
  );
}

/* ── Helpers ────────────────────────────────────────────────── */

function slugify(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 63);
}

function formatTime(s: number): string {
  if (!Number.isFinite(s)) return "0:00";
  const mins = Math.floor(s / 60);
  const secs = Math.floor(s % 60);
  return `${mins}:${secs.toString().padStart(2, "0")}`;
}
