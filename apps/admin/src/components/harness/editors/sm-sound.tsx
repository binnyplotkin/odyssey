"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { CharacterSoundDesign } from "@odyssey/db";
import {
  SoundLibraryPicker,
  type PickerSound,
} from "@/components/sound-library-picker";
import type { HarnessCharacter } from "../harness-types";

/**
 * sm-sound — Sound design (stage manager). Phase-4 scope: the character's
 * SANDBOX soundscape — an ambience bed bound by library slug + a gain
 * trim. Applies when the character runs outside a scene (character
 * sandbox / char-… voice rooms); a real scene's placed beds always win.
 *
 * Channel-level knobs (world master gain, duck depth) are deliberately
 * NOT here — they're host-level env vars on the voice-agent
 * (VOICE_AGENT_WORLD_GAIN_DB / _DUCK_DB).
 */

const T = {
  fontBody: "'Inter', sans-serif",
  fontMono: "var(--font-mono, 'JetBrains Mono', monospace)",
};

type SaveState =
  | { status: "idle" }
  | { status: "saving" }
  | { status: "saved"; at: number }
  | { status: "error"; message: string };

type Props = {
  character: HarnessCharacter;
  activeTab?: string;
};

export function SMSound({ character }: Props) {
  // This editor is a quick-bind surface for the DEFAULT BED only. The
  // full node list (one-shots, positions) lives on the character canvas;
  // saves here rewrite the default-bed entry and pass every other entry
  // through untouched. Note: the harness layout provides soundDesign in
  // the canonical list shape (character-store normalizes legacy rows).
  const otherSounds = useMemo(() => {
    const all = character.soundDesign?.sounds ?? [];
    const defaultBed =
      all.find((s) => s.role === "bed" && s.isDefault) ??
      all.find((s) => s.role === "bed");
    return all.filter((s) => s !== defaultBed);
  }, [character.soundDesign]);

  const initial = useMemo(() => {
    const all = character.soundDesign?.sounds ?? [];
    const defaultBed =
      all.find((s) => s.role === "bed" && s.isDefault) ??
      all.find((s) => s.role === "bed");
    return {
      ambienceSlug: defaultBed?.slug ?? null,
      gainDb: defaultBed?.gainDb ?? 0,
    };
  }, [character.soundDesign]);

  const [ambienceSlug, setAmbienceSlug] = useState<string | null>(initial.ambienceSlug);
  const [gainDb, setGainDb] = useState<number>(initial.gainDb);
  const [save, setSave] = useState<SaveState>({ status: "idle" });

  // Library — loaded client-side; ready assets only.
  const [sounds, setSounds] = useState<PickerSound[]>([]);
  const [libraryError, setLibraryError] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    fetch("/api/sounds")
      .then((r) => r.json())
      .then((data: { sounds: PickerSound[] }) => {
        if (cancelled) return;
        setSounds((data.sounds ?? []).filter((s) => s.status === "ready"));
      })
      .catch(() => {
        if (!cancelled) setLibraryError("Could not load the sound library.");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const isDirty = useMemo(
    () => ambienceSlug !== initial.ambienceSlug || gainDb !== initial.gainDb,
    [ambienceSlug, gainDb, initial],
  );

  const onSave = useCallback(async () => {
    setSave({ status: "saving" });
    try {
      const asset = ambienceSlug ? sounds.find((s) => s.slug === ambienceSlug) : null;
      const bedEntry = ambienceSlug
        ? [
            {
              slug: ambienceSlug,
              role: "bed" as const,
              name: asset?.name ?? ambienceSlug,
              description: asset?.description ?? null,
              ...(gainDb !== 0 ? { gainDb } : {}),
              isDefault: true,
            },
          ]
        : [];
      const nextSounds = [...bedEntry, ...otherSounds];
      const soundDesign: CharacterSoundDesign | null = nextSounds.length
        ? { sounds: nextSounds }
        : null;
      const res = await fetch(`/api/characters/${character.id}/sound-design`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ soundDesign }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      setSave({ status: "saved", at: Date.now() });
      window.dispatchEvent(new CustomEvent("harness:sound-design-saved"));
    } catch (err) {
      setSave({
        status: "error",
        message: err instanceof Error ? err.message : "save failed",
      });
    }
  }, [ambienceSlug, gainDb, character.id, sounds, otherSounds]);

  return (
    <div
      style={{
        padding: "24px 32px 48px",
        display: "flex",
        flexDirection: "column",
        gap: "var(--space-16)",
        maxWidth: 720,
      }}
    >
      {/* Save bar */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: "var(--space-12)",
        }}
      >
        <span
          style={{
            fontFamily: T.fontMono,
            fontSize: "var(--font-size-sm)",
            letterSpacing: "0.08em",
            color:
              save.status === "error"
                ? "var(--status-error)"
                : isDirty
                  ? "var(--status-draft)"
                  : "var(--text-tertiary)",
          }}
        >
          {save.status === "saving"
            ? "saving…"
            : save.status === "error"
              ? `save failed — ${save.message}`
              : isDirty
                ? "unsaved changes"
                : save.status === "saved"
                  ? "saved"
                  : "in sync"}
        </span>
        <button
          type="button"
          onClick={() => void onSave()}
          disabled={!isDirty || save.status === "saving"}
          style={{
            padding: "8px 18px",
            borderRadius: "var(--radius-pill)",
            border: "none",
            background: isDirty ? "var(--accent-strong)" : "var(--ink-soft)",
            color: isDirty ? "var(--background)" : "var(--text-tertiary)",
            fontFamily: T.fontBody,
            fontSize: "var(--font-size-md)",
            fontWeight: 600,
            cursor: isDirty ? "pointer" : "default",
          }}
        >
          {save.status === "saving" ? "Saving…" : "Save"}
        </button>
      </div>

      {/* Ambience bed card */}
      <section
        style={{
          display: "flex",
          flexDirection: "column",
          gap: "var(--space-14)",
          padding: "var(--space-18)",
          borderRadius: "var(--radius-2xl)",
          background: "var(--material-card)",
          border: "1px solid var(--border-subtle)",
        }}
      >
        <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-4)" }}>
          <span
            style={{
              fontFamily: T.fontMono,
              fontSize: "var(--font-size-2xs)",
              letterSpacing: "0.14em",
              textTransform: "uppercase",
              color: "var(--text-tertiary)",
            }}
          >
            sandbox soundscape
          </span>
          <h3
            style={{
              margin: 0,
              fontFamily: T.fontBody,
              fontSize: "var(--font-size-xl)",
              fontWeight: 600,
              color: "var(--text-primary)",
            }}
          >
            Ambience bed
          </h3>
          <p
            style={{
              margin: 0,
              fontFamily: T.fontBody,
              fontSize: "var(--font-size-base)",
              lineHeight: "19px",
              color: "var(--text-secondary)",
            }}
          >
            Plays behind {character.title} in the character sandbox and{" "}
            <span style={{ fontFamily: T.fontMono, fontSize: "var(--font-size-sm)" }}>
              char-…
            </span>{" "}
            voice rooms. In a real scene, the scene&apos;s own placed beds take over.
          </p>
        </div>

        <SoundLibraryPicker
          currentSlug={ambienceSlug}
          sounds={sounds}
          onChange={setAmbienceSlug}
        />
        {libraryError && (
          <span
            style={{
              fontFamily: T.fontMono,
              fontSize: "var(--font-size-xs)",
              color: "var(--status-error)",
            }}
          >
            {libraryError}
          </span>
        )}

        {/* Gain trim */}
        {ambienceSlug && (
          <label style={{ display: "flex", flexDirection: "column", gap: "var(--space-6)", maxWidth: 260 }}>
            <span
              style={{
                fontFamily: T.fontMono,
                fontSize: "var(--font-size-sm)",
                letterSpacing: "0.10em",
                color: "var(--text-tertiary)",
              }}
            >
              gain trim ·{" "}
              <span style={{ color: "var(--text-secondary)" }}>
                {gainDb > 0 ? `+${gainDb}` : gainDb} dB
              </span>
            </span>
            <input
              type="range"
              min={-24}
              max={12}
              step={1}
              value={gainDb}
              onChange={(e) => setGainDb(Number(e.target.value))}
            />
            <span
              style={{
                fontFamily: T.fontBody,
                fontSize: "var(--font-size-sm)",
                color: "var(--text-tertiary)",
                lineHeight: "16px",
              }}
            >
              On top of the asset&apos;s normalized level. 0 dB = as ingested.
            </span>
          </label>
        )}
      </section>

      {/* Host-level knobs note */}
      <p
        style={{
          margin: 0,
          fontFamily: T.fontMono,
          fontSize: "var(--font-size-xs)",
          letterSpacing: "0.04em",
          lineHeight: "18px",
          color: "var(--text-quaternary)",
        }}
      >
        This binds the DEFAULT BED only. One-shots (and node layout) are placed on
        the character page canvas. Channel-level controls (world master gain, duck
        depth under the voice) are host env vars on the voice agent —
        VOICE_AGENT_WORLD_GAIN_DB / VOICE_AGENT_WORLD_DUCK_DB.
      </p>
    </div>
  );
}
