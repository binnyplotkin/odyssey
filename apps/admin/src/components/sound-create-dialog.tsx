"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { isValidVoiceSlug, slugifyVoiceName } from "@/lib/voice-slug";
import { ingestAudioBytes, type IngestResult } from "@/lib/audio-ingest";

/* ── Tokens ───────────────────────────────────────────────────── */

const FONT_HEAD = "'Inter', system-ui, sans-serif";
const FONT_MONO = "'JetBrains Mono', ui-monospace, monospace";
const ACCENT = "var(--accent-strong)";

const ACCEPTED_MIME = new Set([
  "audio/wav",
  "audio/wave",
  "audio/x-wav",
  "audio/mpeg",
  "audio/mp3",
  "audio/mp4",
  "audio/x-m4a",
  "audio/webm",
  "audio/ogg",
]);
const MAX_BYTES = 20 * 1024 * 1024;

/* ── State machine ────────────────────────────────────────────── */

type Tab = "upload" | "generate";

/* Review state carries the ORIGINAL bytes (uploaded file or generated
 * mp3) plus the client-side ingest result (canonical 48k mono WAV +
 * metrics). Both go up on save. */
type Review = {
  originalFile: File;
  ingested: IngestResult;
  /** Object URL over the processed WAV for preview playback. */
  previewUrl: string;
  /** Set when the take came from the generate tab. */
  generationPrompt: string | null;
};

type Props = {
  open: boolean;
  onClose: () => void;
  /** Existing slugs — inline availability check instead of a 409 after submit. */
  existingSlugs: string[];
};

export function SoundCreateDialog({ open, onClose, existingSlugs }: Props) {
  const router = useRouter();
  const [tab, setTab] = useState<Tab>("upload");
  const [review, setReview] = useState<Review | null>(null);
  const [busy, setBusy] = useState<null | "ingesting" | "generating" | "saving">(
    null,
  );
  const [error, setError] = useState<string | null>(null);

  // Fields
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [slugTouched, setSlugTouched] = useState(false);
  const [description, setDescription] = useState("");
  const [tags, setTags] = useState("");
  const [loopable, setLoopable] = useState(false);

  // Generate tab
  const [prompt, setPrompt] = useState("");
  const [genDuration, setGenDuration] = useState("");
  const [genLoop, setGenLoop] = useState(false);

  // Reset on close so re-opening starts fresh.
  useEffect(() => {
    if (!open) {
      setTab("upload");
      setReview(null);
      setBusy(null);
      setError(null);
      setName("");
      setSlug("");
      setSlugTouched(false);
      setDescription("");
      setTags("");
      setLoopable(false);
      setPrompt("");
      setGenDuration("");
      setGenLoop(false);
    }
  }, [open]);

  // Free the preview object URL when the take changes / dialog closes.
  useEffect(() => {
    if (!review) return;
    return () => URL.revokeObjectURL(review.previewUrl);
  }, [review]);

  useEffect(() => {
    if (!slugTouched) setSlug(slugifyVoiceName(name));
  }, [name, slugTouched]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !busy) onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, busy, onClose]);

  const slugAvailable = useMemo(() => {
    if (!slug) return null;
    if (!isValidVoiceSlug(slug)) return false;
    return !existingSlugs.includes(slug);
  }, [slug, existingSlugs]);

  /* ── Upload path ────────────────────────────────────────────── */

  const handleFileSelected = useCallback(
    async (file: File) => {
      setError(null);
      if (file.size === 0) return setError("That file is empty.");
      if (file.size > MAX_BYTES) return setError("File too large (max 20 MB).");
      if (file.type && !ACCEPTED_MIME.has(file.type)) {
        return setError(`Unsupported audio type: ${file.type || "<unknown>"}`);
      }
      setBusy("ingesting");
      try {
        const ingested = await ingestAudioBytes(await file.arrayBuffer());
        setReview({
          originalFile: file,
          ingested,
          previewUrl: URL.createObjectURL(
            new Blob([ingested.processedWavBytes as BlobPart], { type: "audio/wav" }),
          ),
          generationPrompt: null,
        });
        if (!name) {
          const base = file.name.replace(/\.[^.]+$/, "").replace(/[_-]+/g, " ");
          setName(base.slice(0, 80));
        }
      } catch (err) {
        setError(`Could not decode that file: ${(err as Error).message}`);
      } finally {
        setBusy(null);
      }
    },
    [name],
  );

  /* ── Generate path ──────────────────────────────────────────── */

  const handleGenerate = useCallback(async () => {
    setError(null);
    if (prompt.trim().length < 3) {
      return setError("Describe the sound in a few words first.");
    }
    setBusy("generating");
    try {
      const durationSeconds = genDuration ? Number(genDuration) : undefined;
      const res = await fetch("/api/sounds/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt: prompt.trim(),
          ...(durationSeconds && Number.isFinite(durationSeconds)
            ? { durationSeconds }
            : {}),
          ...(genLoop ? { loop: true } : {}),
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      const bytes = Uint8Array.from(atob(body.audioBase64 as string), (c) =>
        c.charCodeAt(0),
      );
      const originalFile = new File([bytes as BlobPart], "generated.mp3", {
        type: (body.contentType as string) || "audio/mpeg",
      });
      const ingested = await ingestAudioBytes(bytes.buffer as ArrayBuffer);
      setReview({
        originalFile,
        ingested,
        previewUrl: URL.createObjectURL(
          new Blob([ingested.processedWavBytes as BlobPart], { type: "audio/wav" }),
        ),
        generationPrompt: prompt.trim(),
      });
      if (!name) setName(prompt.trim().slice(0, 80));
      if (genLoop) setLoopable(true);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(null);
    }
  }, [prompt, genDuration, genLoop, name]);

  /* ── Save ───────────────────────────────────────────────────── */

  const save = useCallback(async () => {
    if (!review) return;
    if (!name.trim()) return setError("Name is required.");
    if (!isValidVoiceSlug(slug)) {
      return setError("Slug must be lowercase alphanumerics + hyphens.");
    }
    if (slugAvailable === false) {
      return setError(`Slug "${slug}" is already taken.`);
    }
    setError(null);
    setBusy("saving");
    try {
      const form = new FormData();
      form.append("file", review.originalFile);
      form.append(
        "processed",
        new File([review.ingested.processedWavBytes as BlobPart], `${slug}.wav`, {
          type: "audio/wav",
        }),
      );
      form.append("name", name.trim());
      form.append("slug", slug);
      form.append("description", description.trim());
      form.append(
        "tags",
        JSON.stringify(tags.split(",").map((t) => t.trim()).filter(Boolean)),
      );
      form.append("loopable", loopable ? "true" : "false");
      form.append(
        "source",
        review.generationPrompt ? "elevenlabs_sfx" : "upload",
      );
      if (review.generationPrompt) {
        form.append("generationPrompt", review.generationPrompt);
      }
      form.append("durationS", String(review.ingested.durationS));
      form.append("rmsDb", String(review.ingested.rmsDb));
      form.append("peakDb", String(review.ingested.peakDb));

      const res = await fetch("/api/sounds", { method: "POST", body: form });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      onClose();
      router.refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(null);
    }
  }, [
    review,
    name,
    slug,
    slugAvailable,
    description,
    tags,
    loopable,
    onClose,
    router,
  ]);

  if (!open) return null;

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
    boxSizing: "border-box",
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
        if (e.target === e.currentTarget && !busy) onClose();
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
          width: 560,
          maxWidth: "100%",
          maxHeight: "90vh",
          overflowY: "auto",
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
        {/* Header + tabs */}
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
              letterSpacing: "0.18em",
              textTransform: "uppercase",
              color: "var(--text-tertiary)",
            }}
          >
            New sound
          </span>
          <button
            type="button"
            onClick={() => !busy && onClose()}
            aria-label="Close"
            style={{
              border: "none",
              background: "transparent",
              color: "var(--text-tertiary)",
              cursor: "pointer",
              fontSize: 18,
              lineHeight: 1,
            }}
          >
            ×
          </button>
        </div>

        {!review && (
          <div style={{ display: "flex", gap: "var(--space-6)" }}>
            {(["upload", "generate"] as const).map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => {
                  setTab(t);
                  setError(null);
                }}
                style={{
                  padding: "6px 14px",
                  borderRadius: "var(--radius-pill)",
                  border: `1px solid ${tab === t ? ACCENT : "var(--ink-line)"}`,
                  background:
                    tab === t
                      ? "color-mix(in srgb, var(--accent-strong) 14%, transparent)"
                      : "transparent",
                  color: tab === t ? ACCENT : "var(--text-secondary)",
                  fontFamily: FONT_HEAD,
                  fontSize: "var(--font-size-md)",
                  fontWeight: 500,
                  cursor: "pointer",
                }}
              >
                {t === "upload" ? "Upload" : "Generate"}
              </button>
            ))}
          </div>
        )}

        {/* ── Take acquisition ─────────────────────────────────── */}
        {!review && tab === "upload" && (
          <DropZone
            busy={busy === "ingesting"}
            onFileSelected={(f) => void handleFileSelected(f)}
          />
        )}

        {!review && tab === "generate" && (
          <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-12)" }}>
            <label style={{ display: "flex", flexDirection: "column", gap: "var(--space-6)" }}>
              <span style={labelStyle}>Describe the sound</span>
              <textarea
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                rows={3}
                placeholder="e.g. a log collapses in a campfire, sparks scatter"
                style={{ ...fieldStyle, resize: "vertical" }}
              />
            </label>
            <div style={{ display: "flex", gap: "var(--space-12)", alignItems: "center" }}>
              <label
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: "var(--space-6)",
                  width: 140,
                }}
              >
                <span style={labelStyle}>Duration (s, optional)</span>
                <input
                  value={genDuration}
                  onChange={(e) => setGenDuration(e.target.value)}
                  placeholder="auto"
                  inputMode="decimal"
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
                  marginTop: 18,
                }}
              >
                <input
                  type="checkbox"
                  checked={genLoop}
                  onChange={(e) => setGenLoop(e.target.checked)}
                />
                Seamless loop (ambience bed)
              </label>
            </div>
            <button
              type="button"
              onClick={() => void handleGenerate()}
              disabled={busy === "generating"}
              style={{
                alignSelf: "flex-start",
                padding: "9px 18px",
                borderRadius: "var(--radius-pill)",
                border: "none",
                background: ACCENT,
                color: "var(--background)",
                fontFamily: FONT_HEAD,
                fontSize: "var(--font-size-md)",
                fontWeight: 600,
                cursor: busy === "generating" ? "progress" : "pointer",
                opacity: busy === "generating" ? 0.7 : 1,
              }}
            >
              {busy === "generating" ? "Generating…" : "Generate"}
            </button>
          </div>
        )}

        {/* ── Review ───────────────────────────────────────────── */}
        {review && (
          <>
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                gap: "var(--space-8)",
                padding: "var(--space-14)",
                background: "var(--ink-wash)",
                border: "1px solid var(--ink-soft)",
                borderRadius: "var(--radius-lg)",
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
                    fontFamily: FONT_MONO,
                    fontSize: "var(--font-size-2xs)",
                    letterSpacing: "0.14em",
                    textTransform: "uppercase",
                    color: ACCENT,
                  }}
                >
                  {review.generationPrompt ? "Generated take" : "Processed"}
                </span>
                <span
                  style={{
                    fontFamily: FONT_MONO,
                    fontSize: "var(--font-size-xs)",
                    color: "var(--text-tertiary)",
                  }}
                >
                  {review.ingested.durationS.toFixed(1)}s · 48 kHz mono ·{" "}
                  {review.ingested.rmsDb.toFixed(1)} dB RMS ·{" "}
                  {review.ingested.peakDb.toFixed(1)} dB peak
                </span>
              </div>
              <audio
                controls
                src={review.previewUrl}
                loop={loopable}
                style={{ width: "100%", height: 36 }}
              />
              <div style={{ display: "flex", gap: "var(--space-8)" }}>
                <button
                  type="button"
                  onClick={() => {
                    setReview(null);
                    setError(null);
                  }}
                  style={{
                    padding: "5px 12px",
                    borderRadius: "var(--radius-pill)",
                    border: "1px solid var(--ink-line)",
                    background: "transparent",
                    color: "var(--text-secondary)",
                    fontFamily: FONT_HEAD,
                    fontSize: "var(--font-size-sm)",
                    cursor: "pointer",
                  }}
                >
                  {review.generationPrompt ? "Regenerate / different take" : "Choose another file"}
                </button>
              </div>
            </div>

            {/* Fields */}
            <label style={{ display: "flex", flexDirection: "column", gap: "var(--space-6)" }}>
              <span style={labelStyle}>Name</span>
              <input value={name} onChange={(e) => setName(e.target.value)} style={fieldStyle} />
            </label>
            <label style={{ display: "flex", flexDirection: "column", gap: "var(--space-6)" }}>
              <span style={labelStyle}>
                Slug{" "}
                {slugAvailable === false && (
                  <span style={{ color: "var(--status-error)" }}>· taken/invalid</span>
                )}
              </span>
              <input
                value={slug}
                onChange={(e) => {
                  setSlug(e.target.value);
                  setSlugTouched(true);
                }}
                style={{ ...fieldStyle, fontFamily: FONT_MONO }}
              />
            </label>
            <label style={{ display: "flex", flexDirection: "column", gap: "var(--space-6)" }}>
              <span style={labelStyle}>Description (what the director reads)</span>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={2}
                placeholder="e.g. low desert wind, sparse, lonely"
                style={{ ...fieldStyle, resize: "vertical" }}
              />
            </label>
            <div style={{ display: "flex", gap: "var(--space-12)", alignItems: "flex-end" }}>
              <label
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: "var(--space-6)",
                  flex: 1,
                }}
              >
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
                  paddingBottom: 9,
                  whiteSpace: "nowrap",
                }}
              >
                <input
                  type="checkbox"
                  checked={loopable}
                  onChange={(e) => setLoopable(e.target.checked)}
                />
                Loops
              </label>
            </div>

            <div style={{ display: "flex", justifyContent: "flex-end", gap: "var(--space-8)" }}>
              <button
                type="button"
                onClick={() => !busy && onClose()}
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
                onClick={() => void save()}
                disabled={busy === "saving"}
                style={{
                  padding: "8px 20px",
                  borderRadius: "var(--radius-pill)",
                  border: "none",
                  background: ACCENT,
                  color: "var(--background)",
                  fontFamily: FONT_HEAD,
                  fontSize: "var(--font-size-md)",
                  fontWeight: 600,
                  cursor: busy === "saving" ? "progress" : "pointer",
                  opacity: busy === "saving" ? 0.7 : 1,
                }}
              >
                {busy === "saving" ? "Saving…" : "Save to library"}
              </button>
            </div>
          </>
        )}

        {error && (
          <div
            style={{
              padding: "10px 14px",
              background: "var(--critical-wash)",
              border: "1px solid var(--critical-border)",
              borderRadius: "var(--radius-md)",
              color: "var(--status-error)",
              fontFamily: FONT_HEAD,
              fontSize: "var(--font-size-md)",
            }}
          >
            {error}
          </div>
        )}
      </div>
    </div>
  );
}

/* ── Drop zone ────────────────────────────────────────────────── */

function DropZone({
  busy,
  onFileSelected,
}: {
  busy: boolean;
  onFileSelected: (file: File) => void;
}) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [dragOver, setDragOver] = useState(false);

  return (
    <div
      onClick={() => !busy && inputRef.current?.click()}
      onDragOver={(e) => {
        e.preventDefault();
        setDragOver(true);
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragOver(false);
        const file = e.dataTransfer.files?.[0];
        if (file && !busy) onFileSelected(file);
      }}
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: "var(--space-8)",
        padding: "40px 20px",
        border: `1.5px dashed ${dragOver ? ACCENT : "var(--ink-line)"}`,
        borderRadius: "var(--radius-lg)",
        background: dragOver
          ? "color-mix(in srgb, var(--accent-strong) 6%, transparent)"
          : "var(--ink-wash)",
        cursor: busy ? "progress" : "pointer",
        textAlign: "center",
      }}
    >
      <input
        ref={inputRef}
        type="file"
        accept="audio/*"
        hidden
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) onFileSelected(file);
          e.target.value = "";
        }}
      />
      <span
        style={{
          fontFamily: FONT_HEAD,
          fontSize: "var(--font-size-lg)",
          fontWeight: 500,
          color: "var(--text-primary)",
        }}
      >
        {busy ? "Processing…" : "Drop an audio file or click to browse"}
      </span>
      <span
        style={{
          fontFamily: FONT_MONO,
          fontSize: "var(--font-size-xs)",
          letterSpacing: "0.1em",
          textTransform: "uppercase",
          color: "var(--text-tertiary)",
        }}
      >
        wav · mp3 · m4a · ogg — max 20 MB — normalized to 48 kHz mono
      </span>
    </div>
  );
}
