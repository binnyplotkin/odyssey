"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { isValidVoiceSlug, slugifyVoiceName } from "@/lib/voice-slug";

/* ── Tokens ───────────────────────────────────────────────────── */

const FONT_HEAD = "'Inter', system-ui, sans-serif";
const FONT_MONO = "'JetBrains Mono', ui-monospace, monospace";

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

type DialogState =
  | { kind: "drop" }
  | { kind: "review"; file: File; objectUrl: string }
  | { kind: "creating"; file: File; objectUrl: string }
  | {
      kind: "extracting";
      file: File;
      objectUrl: string;
      voiceId: string;
      voiceSlug: string;
      startedAt: number;
    };

type Props = {
  open: boolean;
  onClose: () => void;
  /** Existing slugs in the library — used for the inline availability check
   * so the user gets immediate feedback instead of a 409 after submit. */
  existingSlugs: string[];
};

/* ── Component ────────────────────────────────────────────────── */

export function VoiceUploadDialog({ open, onClose, existingSlugs }: Props) {
  const router = useRouter();
  const [state, setState] = useState<DialogState>({ kind: "drop" });
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [slugTouched, setSlugTouched] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Reset everything when the dialog closes so re-opening starts fresh.
  useEffect(() => {
    if (!open) {
      setState({ kind: "drop" });
      setName("");
      setSlug("");
      setSlugTouched(false);
      setError(null);
    }
  }, [open]);

  // Free the object URL when the file changes or the dialog closes — leaking
  // blob URLs would hold the audio data in memory for the tab's lifetime.
  useEffect(() => {
    if (state.kind === "drop") return;
    return () => URL.revokeObjectURL(state.objectUrl);
  }, [state.kind === "drop" ? null : (state as { objectUrl: string }).objectUrl]);

  // Auto-derive the slug from the name unless the user has typed one explicitly.
  useEffect(() => {
    if (!slugTouched) setSlug(slugifyVoiceName(name));
  }, [name, slugTouched]);

  // Escape key dismisses the modal (only when not mid-flight).
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && state.kind !== "creating" && state.kind !== "extracting") {
        onClose();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, state.kind, onClose]);

  const slugAvailable = useMemo(() => {
    if (!slug) return null;
    if (!isValidVoiceSlug(slug)) return false;
    return !existingSlugs.includes(slug);
  }, [slug, existingSlugs]);

  const handleFileSelected = useCallback(
    (file: File) => {
      setError(null);
      if (file.size === 0) {
        setError("That file is empty.");
        return;
      }
      if (file.size > MAX_BYTES) {
        setError("File too large (max 20 MB).");
        return;
      }
      if (!ACCEPTED_MIME.has(file.type)) {
        setError(`Unsupported audio type: ${file.type || "<unknown>"}`);
        return;
      }
      const objectUrl = URL.createObjectURL(file);
      setState({ kind: "review", file, objectUrl });
      // Seed the name from the filename if the user hasn't already typed one.
      if (!name) {
        const base = file.name.replace(/\.[^.]+$/, "").replace(/[_-]+/g, " ");
        setName(base.slice(0, 80));
      }
    },
    [name],
  );

  const submit = useCallback(async () => {
    if (state.kind !== "review") return;
    if (!name.trim()) {
      setError("Voice name is required.");
      return;
    }
    if (!isValidVoiceSlug(slug)) {
      setError("Slug must be lowercase alphanumerics + hyphens.");
      return;
    }
    if (slugAvailable === false) {
      setError(`Slug "${slug}" is already taken.`);
      return;
    }
    setError(null);
    setState({ kind: "creating", file: state.file, objectUrl: state.objectUrl });

    // Step 1: create row + upload source clip.
    const form = new FormData();
    form.append("file", state.file);
    form.append("name", name.trim());
    form.append("slug", slug);
    const createRes = await fetch("/api/voices", { method: "POST", body: form });
    if (!createRes.ok) {
      const body = await createRes.json().catch(() => ({}));
      setError(body.error ?? `Upload failed (HTTP ${createRes.status})`);
      setState({ kind: "review", file: state.file, objectUrl: state.objectUrl });
      return;
    }
    const createBody = (await createRes.json()) as {
      voice: { id: string; slug: string };
    };

    // Step 2: kick extraction. /api/voices/[id]/extract is synchronous (up to
    // 180s) — the dialog stays in the "extracting" state until it returns.
    setState({
      kind: "extracting",
      file: state.file,
      objectUrl: state.objectUrl,
      voiceId: createBody.voice.id,
      voiceSlug: createBody.voice.slug,
      startedAt: Date.now(),
    });
    const extractRes = await fetch(`/api/voices/${createBody.voice.id}/extract`, {
      method: "POST",
    });
    if (!extractRes.ok) {
      const body = await extractRes.json().catch(() => ({}));
      setError(body.error ?? `Extraction failed (HTTP ${extractRes.status})`);
      // Don't tear the dialog down — the row exists, the user lands on the
      // detail page where they can retry. Close + redirect.
      onClose();
      router.push(`/voices/${createBody.voice.slug}`);
      router.refresh();
      return;
    }
    onClose();
    router.push(`/voices/${createBody.voice.slug}`);
    router.refresh();
  }, [state, name, slug, slugAvailable, router, onClose]);

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      onClick={(e) => {
        // Backdrop dismiss — only when not mid-flight.
        if (
          e.target === e.currentTarget &&
          state.kind !== "creating" &&
          state.kind !== "extracting"
        ) {
          onClose();
        }
      }}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.60)",
        backdropFilter: "blur(8px)",
        zIndex: 100,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 24,
      }}
    >
      <div
        style={{
          width: 520,
          maxWidth: "100%",
          background: "var(--background)",
          border: "1px solid var(--border)",
          boxShadow: "0 24px 80px rgba(0,0,0,0.50)",
          display: "flex",
          flexDirection: "column",
        }}
      >
        <DialogHeader state={state} onClose={onClose} />
        <div style={{ display: "flex", flexDirection: "column", gap: 24, padding: 28 }}>
          {state.kind === "drop" && (
            <DropContent onFileSelected={handleFileSelected} />
          )}
          {state.kind === "review" && (
            <ReviewContent file={state.file} objectUrl={state.objectUrl} />
          )}
          {(state.kind === "creating" || state.kind === "extracting") && (
            <ExtractingContent state={state} />
          )}

          {(state.kind === "drop" || state.kind === "review") && (
            <FieldsBlock
              name={name}
              setName={setName}
              slug={slug}
              setSlug={(v) => {
                setSlug(v);
                setSlugTouched(true);
              }}
              slugAvailable={slugAvailable}
              disabled={state.kind === "drop"}
            />
          )}

          {error && (
            <div
              style={{
                padding: "10px 14px",
                background: "rgba(232,160,160,0.06)",
                border: "1px solid rgba(232,160,160,0.30)",
                color: "#E8A0A0",
                fontFamily: FONT_MONO,
                fontSize: 12,
              }}
            >
              {error}
            </div>
          )}
        </div>
        <DialogFooter state={state} slugAvailable={slugAvailable} name={name} onSubmit={submit} />
      </div>
    </div>
  );
}

/* ── Header ───────────────────────────────────────────────────── */

function DialogHeader({
  state,
  onClose,
}: {
  state: DialogState;
  onClose: () => void;
}) {
  const titles: Record<DialogState["kind"], string> = {
    drop: "New voice",
    review: "New voice",
    creating: "Uploading…",
    extracting: "Extracting embedding",
  };
  const subtitles: Record<DialogState["kind"], string> = {
    drop: "Drop a clip. We'll extract a Pocket TTS embedding.",
    review: "Review your clip, then extract.",
    creating: "Uploading source clip to Supabase…",
    extracting: "You can leave this modal — we'll save the result either way.",
  };
  const dismissable = state.kind !== "creating" && state.kind !== "extracting";

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "row",
        alignItems: "flex-start",
        justifyContent: "space-between",
        padding: "20px 28px",
        borderBottom: "1px solid var(--border)",
      }}
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        <div
          style={{
            fontFamily: FONT_HEAD,
            fontSize: 18,
            fontWeight: 600,
            color: "var(--text-primary)",
            letterSpacing: "-0.01em",
          }}
        >
          {titles[state.kind]}
        </div>
        <div style={{ fontFamily: FONT_HEAD, fontSize: 12, color: "var(--text-secondary)" }}>
          {subtitles[state.kind]}
        </div>
      </div>
      <button
        type="button"
        onClick={onClose}
        disabled={!dismissable}
        aria-label="Close"
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          width: 30,
          height: 30,
          background: "transparent",
          border: "1px solid var(--border)",
          color: "var(--text-tertiary)",
          cursor: dismissable ? "pointer" : "not-allowed",
          opacity: dismissable ? 1 : 0.4,
        }}
      >
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <line x1="18" x2="6" y1="6" y2="18" />
          <line x1="6" x2="18" y1="6" y2="18" />
        </svg>
      </button>
    </div>
  );
}

/* ── Footer ───────────────────────────────────────────────────── */

function DialogFooter({
  state,
  slugAvailable,
  name,
  onSubmit,
}: {
  state: DialogState;
  slugAvailable: boolean | null;
  name: string;
  onSubmit: () => void;
}) {
  if (state.kind === "creating" || state.kind === "extracting") return null;
  const canSubmit =
    state.kind === "review" && !!name.trim() && slugAvailable === true;
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
        padding: "16px 28px",
        borderTop: "1px solid var(--border)",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          fontFamily: FONT_HEAD,
          fontSize: 12,
          color: "var(--text-tertiary)",
        }}
      >
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="10" />
          <path d="M12 16v-4" />
          <path d="M12 8h.01" />
        </svg>
        <span>Pocket TTS uses only the first 30s</span>
      </div>
      <button
        type="button"
        onClick={onSubmit}
        disabled={!canSubmit}
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 7,
          padding: "9px 16px",
          background: canSubmit ? "var(--accent-strong)" : "rgba(255,255,255,0.04)",
          border: `1px solid ${canSubmit ? "var(--accent-strong)" : "var(--border)"}`,
          color: canSubmit ? "var(--background)" : "var(--text-quaternary)",
          fontFamily: FONT_HEAD,
          fontSize: 13,
          fontWeight: 600,
          cursor: canSubmit ? "pointer" : "not-allowed",
        }}
      >
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
          <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
        </svg>
        <span>upload + extract</span>
      </button>
    </div>
  );
}

/* ── Step 1: Drop ─────────────────────────────────────────────── */

function DropContent({ onFileSelected }: { onFileSelected: (f: File) => void }) {
  const [hovering, setHovering] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);

  return (
    <>
      <input
        ref={inputRef}
        type="file"
        accept="audio/*"
        style={{ display: "none" }}
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) onFileSelected(f);
        }}
      />
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setHovering(true);
        }}
        onDragLeave={() => setHovering(false)}
        onDrop={(e) => {
          e.preventDefault();
          setHovering(false);
          const f = e.dataTransfer.files?.[0];
          if (f) onFileSelected(f);
        }}
        onClick={() => inputRef.current?.click()}
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: 16,
          padding: "56px 32px",
          background: hovering
            ? "rgba(140,231,210,0.08)"
            : "rgba(140,231,210,0.03)",
          border: `1.5px dashed ${hovering ? "var(--accent-strong)" : "rgba(140,231,210,0.30)"}`,
          cursor: "pointer",
          transition: "background 100ms, border-color 100ms",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            width: 56,
            height: 56,
            background: "rgba(140,231,210,0.08)",
            border: "1px solid rgba(140,231,210,0.18)",
          }}
        >
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="var(--accent-strong)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
            <polyline points="17 8 12 3 7 8" />
            <line x1="12" x2="12" y1="3" y2="15" />
          </svg>
        </div>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 6 }}>
          <div style={{ fontFamily: FONT_HEAD, fontSize: 15, fontWeight: 600, color: "var(--text-primary)" }}>
            Drop your audio clip here
          </div>
          <div style={{ fontFamily: FONT_HEAD, fontSize: 13, color: "var(--text-secondary)" }}>
            or <span style={{ color: "var(--accent-strong)", textDecoration: "underline" }}>browse files</span>
          </div>
        </div>
        <div
          style={{
            fontFamily: FONT_MONO,
            fontSize: 11,
            color: "var(--text-quaternary)",
            letterSpacing: "0.06em",
          }}
        >
          WAV · MP3 · M4A · up to 20 MB
        </div>
      </div>
    </>
  );
}

/* ── Step 2: Review ───────────────────────────────────────────── */

function ReviewContent({ file, objectUrl }: { file: File; objectUrl: string }) {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 14,
        padding: 20,
        background: "rgba(140,231,210,0.04)",
        border: "1px solid rgba(140,231,210,0.18)",
      }}
    >
      <audio controls preload="metadata" src={objectUrl} style={{ width: "100%" }} />
      <div
        style={{
          display: "flex",
          flexDirection: "row",
          alignItems: "center",
          paddingTop: 12,
          borderTop: "1px solid rgba(140,231,210,0.10)",
          gap: 12,
        }}
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 2, flex: 1, minWidth: 0 }}>
          <div
            style={{
              fontFamily: FONT_MONO,
              fontSize: 11,
              color: "var(--text-primary)",
              letterSpacing: "0.02em",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {file.name}
          </div>
          <div style={{ fontFamily: FONT_HEAD, fontSize: 11, color: "var(--text-tertiary)" }}>
            {(file.size / (1024 * 1024)).toFixed(2)} MB · {file.type || "audio"}
          </div>
        </div>
      </div>
    </div>
  );
}

/* ── Step 3: Extracting ───────────────────────────────────────── */

function ExtractingContent({
  state,
}: {
  state: Extract<DialogState, { kind: "creating" } | { kind: "extracting" }>;
}) {
  const elapsedSec =
    state.kind === "extracting"
      ? Math.floor((Date.now() - state.startedAt) / 1000)
      : 0;

  return (
    <>
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: 18,
          padding: "32px 24px",
          background: "rgba(250,204,21,0.04)",
          border: "1px solid rgba(250,204,21,0.18)",
        }}
      >
        <SpinnerSquare />
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 6 }}>
          <div style={{ fontFamily: FONT_HEAD, fontSize: 15, fontWeight: 600, color: "var(--text-primary)" }}>
            {state.kind === "creating" ? "Uploading source clip" : "Computing voice embedding"}
          </div>
          <div style={{ fontFamily: FONT_HEAD, fontSize: 12, color: "var(--text-secondary)" }}>
            {state.kind === "creating"
              ? "voice-sources bucket"
              : `Pocket TTS · audio-rt-production · ${elapsedSec}s elapsed`}
          </div>
        </div>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <StepRow
          done={true}
          label="Upload to voice-sources"
          sub={`${state.file.name} · ${(state.file.size / (1024 * 1024)).toFixed(2)} MB`}
        />
        <StepRow
          done={state.kind === "extracting"}
          active={state.kind === "creating"}
          label="Create voice row"
          sub="Supabase Postgres"
        />
        <StepRow
          done={false}
          active={state.kind === "extracting"}
          label="pocket-tts export-voice"
          sub={state.kind === "extracting" ? "computing kvcache state…" : "pending"}
        />
        <StepRow
          done={false}
          active={false}
          label="Upload .safetensors"
          sub="pending — voice-embeddings"
        />
      </div>
    </>
  );
}

function SpinnerSquare() {
  return (
    <>
      <style>{`@keyframes voice-upload-spin{from{transform:rotate(0)}to{transform:rotate(360deg)}}`}</style>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          width: 56,
          height: 56,
          background: "rgba(250,204,21,0.10)",
          border: "1px solid rgba(250,204,21,0.30)",
        }}
      >
        <svg
          width="24"
          height="24"
          viewBox="0 0 24 24"
          fill="none"
          stroke="#FACC15"
          strokeWidth="2.4"
          strokeLinecap="round"
          style={{
            animation: "voice-upload-spin 1.2s linear infinite",
            transformOrigin: "center",
          }}
        >
          <path d="M21 12a9 9 0 1 1-9-9" />
        </svg>
      </div>
    </>
  );
}

function StepRow({
  done,
  active,
  label,
  sub,
}: {
  done: boolean;
  active?: boolean;
  label: string;
  sub: string;
}) {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "row",
        alignItems: "center",
        gap: 12,
        padding: "10px 12px",
        background: active
          ? "rgba(250,204,21,0.05)"
          : done
            ? "rgba(255,255,255,0.025)"
            : "transparent",
        border: `1px ${done || active ? "solid" : "dashed"} ${
          active
            ? "rgba(250,204,21,0.30)"
            : done
              ? "var(--border)"
              : "rgba(255,255,255,0.06)"
        }`,
      }}
    >
      {done ? (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="var(--accent-strong)" stroke="none">
          <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z" />
        </svg>
      ) : active ? (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#FACC15" strokeWidth="2.5" strokeLinecap="round" style={{ animation: "voice-upload-spin 1.2s linear infinite", transformOrigin: "center" }}>
          <path d="M21 12a9 9 0 1 1-9-9" />
        </svg>
      ) : (
        <div style={{ width: 12, height: 12, borderRadius: 999, border: "1.5px solid rgba(255,255,255,0.20)" }} />
      )}
      <div style={{ display: "flex", flexDirection: "column", gap: 2, flex: 1 }}>
        <span
          style={{
            fontFamily: FONT_HEAD,
            fontSize: 12,
            fontWeight: 600,
            color: active ? "var(--text-primary)" : done ? "var(--text-primary)" : "var(--text-quaternary)",
          }}
        >
          {label}
        </span>
        <span
          style={{
            fontFamily: FONT_MONO,
            fontSize: 10,
            color: active ? "rgba(250,204,21,0.92)" : "var(--text-tertiary)",
          }}
        >
          {sub}
        </span>
      </div>
    </div>
  );
}

/* ── Form fields ──────────────────────────────────────────────── */

function FieldsBlock({
  name,
  setName,
  slug,
  setSlug,
  slugAvailable,
  disabled,
}: {
  name: string;
  setName: (v: string) => void;
  slug: string;
  setSlug: (v: string) => void;
  slugAvailable: boolean | null;
  disabled: boolean;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <Field label="VOICE NAME">
        <input
          type="text"
          placeholder="e.g. Margaret Hale"
          value={name}
          onChange={(e) => setName(e.target.value)}
          disabled={disabled}
          style={{
            width: "100%",
            padding: "10px 12px",
            background: "rgba(0,0,0,0.30)",
            border: "1px solid var(--border)",
            color: "var(--text-primary)",
            fontFamily: FONT_HEAD,
            fontSize: 14,
            outline: "none",
            opacity: disabled ? 0.5 : 1,
          }}
        />
      </Field>
      <Field
        label="SLUG"
        hint={
          slug && slugAvailable === true
            ? { text: "✓ available", color: "var(--accent-strong)" }
            : slug && slugAvailable === false
              ? { text: "✗ taken or invalid", color: "#E8A0A0" }
              : { text: "auto from name", color: "var(--text-quaternary)" }
        }
      >
        <input
          type="text"
          placeholder="margaret-hale"
          value={slug}
          onChange={(e) => setSlug(e.target.value.toLowerCase())}
          disabled={disabled}
          style={{
            width: "100%",
            padding: "10px 12px",
            background: "rgba(0,0,0,0.30)",
            border: `1px solid ${
              slug && slugAvailable === true
                ? "rgba(140,231,210,0.40)"
                : slug && slugAvailable === false
                  ? "rgba(232,160,160,0.40)"
                  : "var(--border)"
            }`,
            color: "var(--text-primary)",
            fontFamily: FONT_MONO,
            fontSize: 13,
            outline: "none",
            opacity: disabled ? 0.5 : 1,
          }}
        />
      </Field>
    </div>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: { text: string; color: string };
  children: React.ReactNode;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <span
          style={{
            fontFamily: FONT_MONO,
            fontSize: 10,
            color: "var(--text-tertiary)",
            letterSpacing: "0.14em",
            textTransform: "uppercase",
          }}
        >
          {label}
        </span>
        {hint && (
          <span style={{ fontFamily: FONT_MONO, fontSize: 10, color: hint.color, letterSpacing: "0.06em" }}>
            {hint.text}
          </span>
        )}
      </div>
      {children}
    </div>
  );
}
