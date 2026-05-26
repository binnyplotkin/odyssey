"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  AVATAR_GRADIENTS,
  AVATAR_GRADIENT_KEYS,
  resolveAvatarGradient,
  type AvatarGradientKey,
} from "@/lib/avatar-gradients";

/**
 * Modal for editing a character's thumbnail. Two modes:
 *   1. Pick a named gradient from the brand-derived library.
 *   2. Upload an image (PNG / JPEG / WEBP, ≤4 MB).
 *
 * Local state holds the "in-flight" choice. Save commits to the API; cancel
 * or Esc reverts. The parent supplies the current persisted state so the
 * overlay can render the resting selection on open.
 */

type Props = {
  characterId: string;
  slug: string;
  initialThumbnailColor: string | null;
  initialImage: string | null;
  initial: string;
  onClose: () => void;
  onSaved: (next: { image: string | null; thumbnailColor: string | null }) => void;
};

const T = {
  fg: "var(--foreground)",
  muted: "var(--muted)",
  panel: "var(--panel)",
  border: "var(--border)",
  accent: "var(--accent-strong)",
  accentSoft: "color-mix(in srgb, var(--accent-strong) 12%, transparent)",
  danger: "var(--danger)",
  fontHeading: "'Inter', system-ui, sans-serif",
  fontBody: "'Inter', sans-serif",
  fontMono: "'JetBrains Mono', ui-monospace, monospace",
} as const;

type Draft =
  | { kind: "color"; key: AvatarGradientKey }
  | { kind: "image"; previewUrl: string; file: File };

function draftFromPersisted(
  initialThumbnailColor: string | null,
  initialImage: string | null,
): Draft {
  if (initialImage) return { kind: "image", previewUrl: initialImage, file: new File([], "") };
  const key = (AVATAR_GRADIENT_KEYS as string[]).includes(initialThumbnailColor ?? "")
    ? (initialThumbnailColor as AvatarGradientKey)
    : "dune";
  return { kind: "color", key };
}

export function EditThumbnailOverlay({
  characterId,
  slug,
  initialThumbnailColor,
  initialImage,
  initial,
  onClose,
  onSaved,
}: Props) {
  const [draft, setDraft] = useState<Draft>(() =>
    draftFromPersisted(initialThumbnailColor, initialImage),
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Server-side flag: when uploading, strip near-black pixels to alpha.
  // Off by default so photos with dark content survive unmodified.
  const [removeBlack, setRemoveBlack] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Held only so we can revoke the object URL on unmount or replacement —
  // never set from the persisted `initialImage` (those are real URLs).
  const objectUrlRef = useRef<string | null>(null);
  useEffect(() => () => {
    if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
  }, []);

  const pickColor = useCallback((key: AvatarGradientKey) => {
    setError(null);
    if (objectUrlRef.current) {
      URL.revokeObjectURL(objectUrlRef.current);
      objectUrlRef.current = null;
    }
    setDraft({ kind: "color", key });
  }, []);

  const pickFile = useCallback((file: File) => {
    setError(null);
    if (!file.type.startsWith("image/")) {
      setError("That doesn't look like an image — pick a PNG, JPEG, or WEBP.");
      return;
    }
    if (file.size > 4 * 1024 * 1024) {
      setError("File is over the 4 MB cap.");
      return;
    }
    if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
    const url = URL.createObjectURL(file);
    objectUrlRef.current = url;
    setDraft({ kind: "image", previewUrl: url, file });
  }, []);

  const onFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) pickFile(file);
    e.target.value = "";
  };

  const [dragOver, setDragOver] = useState(false);
  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files?.[0];
    if (file) pickFile(file);
  };

  const save = useCallback(async () => {
    setSaving(true);
    setError(null);
    try {
      let response: Response;
      if (draft.kind === "image" && draft.file.size > 0) {
        const form = new FormData();
        form.append("file", draft.file);
        if (removeBlack) form.append("removeBlackBackground", "true");
        response = await fetch(`/api/characters/${characterId}/thumbnail`, {
          method: "POST",
          body: form,
        });
      } else if (draft.kind === "color") {
        response = await fetch(`/api/characters/${characterId}/thumbnail`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ thumbnailColor: draft.key }),
        });
      } else {
        // Persisted image still in place, untouched — nothing to do.
        onClose();
        return;
      }
      if (!response.ok) {
        const data = (await response.json().catch(() => null)) as { error?: string } | null;
        throw new Error(data?.error ?? `request failed (${response.status})`);
      }
      const data = (await response.json()) as {
        character: { image: string | null; thumbnailColor: string | null };
      };
      onSaved({
        image: data.character.image,
        thumbnailColor: data.character.thumbnailColor,
      });
      onClose();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
      setSaving(false);
    }
  }, [characterId, draft, onClose, onSaved, removeBlack]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      } else if (e.key === "Enter" && !e.shiftKey && !saving) {
        e.preventDefault();
        void save();
      }
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose, save, saving]);

  // Live preview background — either the chosen gradient or the uploaded
  // image. When showing an image we layer it over var(--card-hover) (the
  // same tint the model pill uses in the canvas card) so transparent
  // pixels read against a calm card-surface tone rather than the panel.
  const previewBg =
    draft.kind === "image"
      ? `center/cover no-repeat url("${draft.previewUrl}"), var(--card-hover)`
      : AVATAR_GRADIENTS[draft.key];

  // Whether the avatar letter should render. With an image we hide it; with
  // a gradient we show the slug initial so the preview matches the canvas.
  const showInitial = draft.kind === "color";

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
        <div style={{
          padding: "18px 20px 14px",
          display: "flex",
          alignItems: "flex-start",
          justifyContent: "space-between",
          gap: "var(--space-12)",
        }}>
          <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-6)" }}>
            <span style={{ fontFamily: T.fontMono, fontSize: "var(--font-size-sm)", letterSpacing: "0.18em", textTransform: "uppercase", color: T.accent }}>
              thumbnail
            </span>
            <span style={{ fontFamily: T.fontHeading, fontSize: "var(--font-size-2xl)", fontWeight: 600, color: T.fg, letterSpacing: "-0.01em" }}>
              Edit thumbnail
            </span>
            <span style={{ fontFamily: T.fontMono, fontSize: "var(--font-size-xs)", color: "var(--text-tertiary)", letterSpacing: "0.10em" }}>
              preview updates as you choose · saves on confirm
            </span>
          </div>
          <button
            type="button"
            onClick={onClose}
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

        {/* Preview */}
        <div style={{
          margin: "0 22px",
          padding: "18px 20px",
          background: "var(--card-hover)",
          border: `1px solid ${T.border}`,
          display: "flex",
          alignItems: "center",
          gap: "var(--space-20)",
        }}>
          <div style={{ display: "flex", alignItems: "flex-end", gap: "var(--space-14)" }}>
            <PreviewAvatar size={64} bg={previewBg} showInitial={showInitial} initial={initial} fontSize={30} radius={0} />
            <PreviewAvatar size={30} bg={previewBg} showInitial={showInitial} initial={initial} fontSize={14} radius={0} />
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-4)", flex: 1 }}>
            <span style={{
              fontFamily: T.fontMono,
              fontSize: "var(--font-size-2xs)",
              color: T.muted,
              letterSpacing: "0.08em",
              textTransform: "uppercase",
            }}>
              preview
            </span>
            <span style={{ fontFamily: T.fontBody, fontSize: "var(--font-size-md)", color: T.fg, lineHeight: 1.5 }}>
              canvas card · sidebar · header crumb
            </span>
            <span style={{ fontFamily: T.fontMono, fontSize: "var(--font-size-xs)", color: T.muted, letterSpacing: "0.02em" }}>
              three surfaces share one thumbnail
            </span>
          </div>
        </div>

        {/* Color swatches */}
        <div style={{ padding: "18px 22px 6px", display: "flex", flexDirection: "column", gap: "var(--space-12)" }}>
          <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: "var(--space-8)" }}>
            <div style={{ display: "flex", alignItems: "baseline", gap: "var(--space-8)" }}>
              <span style={{ fontFamily: T.fontMono, fontSize: "var(--font-size-xs)", color: T.muted, letterSpacing: "0.04em" }}>color</span>
              <span style={{ fontFamily: T.fontMono, fontSize: "var(--font-size-2xs)", color: T.muted, opacity: 0.7 }}>
                {AVATAR_GRADIENT_KEYS.length} gradients · derived from the brand palette
              </span>
            </div>
            {draft.kind === "color" && (
              <span style={{ fontFamily: T.fontMono, fontSize: "var(--font-size-xs)", color: T.accent }}>
                {draft.key} · selected
              </span>
            )}
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: "var(--space-6)" }}>
            {AVATAR_GRADIENT_KEYS.map((key) => {
              const selected = draft.kind === "color" && draft.key === key;
              return (
                <button
                  key={key}
                  type="button"
                  onClick={() => pickColor(key)}
                  aria-pressed={selected}
                  aria-label={`Use ${key} gradient`}
                  title={key}
                  style={{
                    width: 92,
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "center",
                    gap: "var(--space-6)",
                    background: "transparent",
                    border: "none",
                    padding: 0,
                    cursor: "pointer",
                  }}
                >
                  <div style={{
                    width: 92,
                    height: 56,
                    background: AVATAR_GRADIENTS[key],
                    border: selected ? `1px solid ${T.accent}` : `1px solid ${T.border}`,
                    boxShadow: selected
                      ? `0 0 0 2px var(--accent-border)`
                      : "none",
                    position: "relative",
                  }}>
                    {selected && (
                      <div style={{
                        position: "absolute",
                        bottom: 4,
                        right: 4,
                        width: 16,
                        height: 16,
                        borderRadius: "50%",
                        background: T.accent,
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                      }}>
                        <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="#0C0E14" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                          <polyline points="20 6 9 17 4 12" />
                        </svg>
                      </div>
                    )}
                  </div>
                  <span style={{
                    fontFamily: T.fontMono,
                    fontSize: "var(--font-size-2xs)",
                    color: selected ? T.accent : T.muted,
                    letterSpacing: "0.04em",
                  }}>
                    {key}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Divider */}
        <div style={{ padding: "14px 22px 10px", display: "flex", alignItems: "center", gap: "var(--space-10)" }}>
          <div style={{ flex: 1, height: 1, background: T.border }} />
          <span style={{
            fontFamily: T.fontMono,
            fontSize: "var(--font-size-2xs)",
            color: T.muted,
            letterSpacing: "0.12em",
            textTransform: "uppercase",
          }}>
            or
          </span>
          <div style={{ flex: 1, height: 1, background: T.border }} />
        </div>

        {/* Upload zone */}
        <div style={{ padding: "0 22px 18px", display: "flex", flexDirection: "column", gap: "var(--space-10)" }}>
          <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: "var(--space-8)" }}>
            <div style={{ display: "flex", alignItems: "baseline", gap: "var(--space-8)" }}>
              <span style={{ fontFamily: T.fontMono, fontSize: "var(--font-size-xs)", color: T.muted, letterSpacing: "0.04em" }}>
                upload an image
              </span>
              <span style={{ fontFamily: T.fontMono, fontSize: "var(--font-size-2xs)", color: T.muted, opacity: 0.7 }}>
                square crop · 256px+ recommended
              </span>
            </div>
            <span style={{ fontFamily: T.fontMono, fontSize: "var(--font-size-xs)", color: T.muted, opacity: 0.7 }}>
              png · jpg · webp · ≤ 4 MB
            </span>
          </div>
          <div
            onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={onDrop}
            onClick={() => fileInputRef.current?.click()}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                fileInputRef.current?.click();
              }
            }}
            style={{
              padding: "28px 20px",
              background: dragOver
                ? "color-mix(in srgb, var(--accent-strong) 8%, transparent)"
                : "color-mix(in srgb, var(--accent-strong) 4%, transparent)",
              border: `1px dashed ${
                dragOver
                  ? T.accent
                  : "color-mix(in srgb, var(--accent-strong) 25%, transparent)"
              }`,
              cursor: "pointer",
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              gap: "var(--space-12)",
            }}
          >
            <input
              ref={fileInputRef}
              type="file"
              accept="image/png,image/jpeg,image/webp"
              onChange={onFileInput}
              style={{ display: "none" }}
              aria-hidden="true"
            />
            <div style={{
              width: 36,
              height: 36,
              borderRadius: "50%",
              background: "rgba(140,231,210,0.08)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={T.accent} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                <polyline points="17 8 12 3 7 8" />
                <line x1="12" y1="3" x2="12" y2="15" />
              </svg>
            </div>
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "var(--space-4)" }}>
              <span style={{ fontFamily: T.fontBody, fontSize: "var(--font-size-md)", color: T.fg, lineHeight: 1.4 }}>
                {draft.kind === "image" && draft.file.size > 0
                  ? <>Using <span style={{ color: T.accent }}>{draft.file.name}</span> — click to replace</>
                  : <>Drop an image here, or <span style={{ color: T.accent, textDecoration: "underline", textUnderlineOffset: 3 }}>browse files</span></>}
              </span>
              <span style={{ fontFamily: T.fontMono, fontSize: "var(--font-size-xs)", color: T.muted, letterSpacing: "0.02em" }}>
                replaces the color selection
              </span>
            </div>
          </div>
          {/* Post-processing toggle. Only relevant after a file is picked,
              so we hide it until then to keep the idle upload zone calm. */}
          {draft.kind === "image" && draft.file.size > 0 && (
            <label
              style={{
                display: "flex",
                alignItems: "center",
                gap: "var(--space-8)",
                cursor: "pointer",
                userSelect: "none",
                paddingTop: "var(--space-2)",
              }}
            >
              <input
                type="checkbox"
                checked={removeBlack}
                onChange={(e) => setRemoveBlack(e.target.checked)}
                style={{
                  width: 14,
                  height: 14,
                  accentColor: T.accent,
                  cursor: "pointer",
                  margin: 0,
                }}
              />
              <span style={{ fontFamily: T.fontBody, fontSize: "var(--font-size-base)", color: T.fg, lineHeight: 1.4 }}>
                Remove black background
              </span>
              <span style={{ fontFamily: T.fontMono, fontSize: "var(--font-size-xs)", color: T.muted, letterSpacing: "0.02em" }}>
                near-black pixels → transparent · output as PNG
              </span>
            </label>
          )}
          {error && (
            <span style={{ fontFamily: T.fontMono, fontSize: "var(--font-size-xs)", color: T.danger }}>
              {error}
            </span>
          )}
        </div>

        {/* Footer */}
        <div style={{
          padding: "12px 22px 14px",
          borderTop: `1px solid ${T.border}`,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: "var(--space-12)",
        }}>
          <span style={{ fontFamily: T.fontMono, fontSize: "var(--font-size-xs)", color: T.muted, letterSpacing: "0.04em" }}>
            <KeyChip>↵</KeyChip> saves · <KeyChip>esc</KeyChip> cancels
          </span>
          <div style={{ display: "flex", gap: "var(--space-8)" }}>
            <button
              type="button"
              onClick={onClose}
              disabled={saving}
              style={{
                padding: "7px 16px",
                border: `1px solid ${T.border}`,
                background: "transparent",
                color: T.fg,
                fontFamily: T.fontHeading,
                fontSize: "var(--font-size-base)",
                fontWeight: 500,
                cursor: saving ? "wait" : "pointer",
                opacity: saving ? 0.6 : 1,
              }}
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={save}
              disabled={saving}
              style={{
                padding: "7px 18px",
                border: `1px solid ${T.accent}`,
                background: T.accent,
                color: "var(--background)",
                fontFamily: T.fontHeading,
                fontSize: "var(--font-size-base)",
                fontWeight: 600,
                cursor: saving ? "wait" : "pointer",
                opacity: saving ? 0.7 : 1,
              }}
            >
              {saving ? "Saving…" : "Save thumbnail"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function PreviewAvatar({
  size, bg, showInitial, initial, fontSize, radius,
}: {
  size: number;
  bg: string;
  showInitial: boolean;
  initial: string;
  fontSize: number;
  radius: number;
}) {
  return (
    <div style={{
      width: size,
      height: size,
      borderRadius: radius,
      background: bg,
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      flexShrink: 0,
    }}>
      {showInitial && (
        <span style={{
          fontFamily: T.fontHeading,
          fontSize,
          fontWeight: 700,
          color: "rgba(12,14,20,0.78)",
          lineHeight: 1,
        }}>
          {initial}
        </span>
      )}
    </div>
  );
}

function KeyChip({ children }: { children: React.ReactNode }) {
  return (
    <span style={{
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
    }}>
      {children}
    </span>
  );
}

// Re-export the resolver so consuming surfaces don't import directly from
// the registry — this keeps the public surface area small.
export { resolveAvatarGradient };
