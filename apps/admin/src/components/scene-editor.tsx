"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type {
  SceneLibraryCharacter,
  SceneRosterEntry,
} from "@/app/(authenticated)/scenes/[sceneId]/page";
import {
  addCharacterToScene,
  archiveScene,
  removeSceneNode,
  updateSceneConfig,
} from "@/app/(authenticated)/scenes/actions";
import {
  AdminButton,
  AdminField,
  AdminKicker,
  AdminPanel,
  AdminSection,
  AdminStatusPill,
  adminTokens,
} from "@/components/admin-ui";
import { VoiceLibraryPicker, type PickerVoice } from "@/components/voice-library-picker";

type SceneEditorProps = {
  scene: {
    id: string;
    title: string;
    prompt: string;
    status: "draft" | "active" | "archived";
    openingBeat: string;
    defaultAmbience: string | null;
    narratorVoiceId: string | null;
  };
  roster: SceneRosterEntry[];
  libraryCharacters: SceneLibraryCharacter[];
};

export function SceneEditor({ scene, roster, libraryCharacters }: SceneEditorProps) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [saved, setSaved] = useState(false);

  const [title, setTitle] = useState(scene.title);
  const [prompt, setPrompt] = useState(scene.prompt);
  const [status, setStatus] = useState(scene.status);
  const [openingBeat, setOpeningBeat] = useState(scene.openingBeat);
  const [defaultAmbience, setDefaultAmbience] = useState(scene.defaultAmbience ?? "");
  const [narratorVoiceId, setNarratorVoiceId] = useState(scene.narratorVoiceId);

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

  const rosterCharacterIds = useMemo(
    () => new Set(roster.map((r) => r.characterId)),
    [roster],
  );
  const addableCharacters = useMemo(
    () => libraryCharacters.filter((c) => !rosterCharacterIds.has(c.id)),
    [libraryCharacters, rosterCharacterIds],
  );

  function saveConfig() {
    setSaved(false);
    start(async () => {
      await updateSceneConfig(scene.id, {
        title: title.trim(),
        prompt,
        status,
        openingBeat,
        defaultAmbience: defaultAmbience.trim() || null,
        narratorVoiceId,
      });
      setSaved(true);
      router.refresh();
    });
  }

  function addCharacter(characterId: string) {
    if (!characterId) return;
    start(async () => {
      await addCharacterToScene(scene.id, characterId);
      router.refresh();
    });
  }

  function removeCharacter(nodeId: string) {
    start(async () => {
      await removeSceneNode(scene.id, nodeId);
      router.refresh();
    });
  }

  function archive() {
    if (!confirm("Archive this scene? It will be hidden from the list.")) return;
    start(async () => {
      await archiveScene(scene.id);
      router.push("/scenes");
    });
  }

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: "var(--space-24)",
        padding: "var(--space-32) 40px 96px",
        maxWidth: 880,
        background: adminTokens.bg,
        color: adminTokens.fg,
        fontFamily: adminTokens.fontBody,
        minHeight: "calc(100vh - 48px)",
      }}
    >
      <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-8)" }}>
        <Link
          href="/scenes"
          style={{
            color: adminTokens.muted,
            fontFamily: adminTokens.fontMono,
            fontSize: "var(--font-size-xs)",
            letterSpacing: "0.12em",
            textTransform: "uppercase",
            textDecoration: "none",
          }}
        >
          ← Scenes
        </Link>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: "var(--space-12)",
          }}
        >
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            style={{
              ...inputStyle,
              fontFamily: adminTokens.fontDisplay,
              fontSize: "var(--font-size-2xl)",
              fontWeight: 600,
              height: 44,
              flex: 1,
            }}
          />
          <AdminStatusPill tone={status === "active" ? "success" : "muted"} dot>
            {status}
          </AdminStatusPill>
          <Link href={`/scenes/${scene.id}/sandbox`} style={{ textDecoration: "none" }}>
            <AdminButton variant="primary">Rehearse →</AdminButton>
          </Link>
        </div>
      </div>

      <AdminSection title="Configuration" eyebrow="Orchestrator">
        <AdminPanel style={{ display: "flex", flexDirection: "column", gap: "var(--space-16)" }}>
          <AdminField label="Description / premise">
            <textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              rows={3}
              placeholder="1–3 sentences the orchestrator reads to understand the setting."
              style={{ ...inputStyle, height: "auto", padding: "10px 12px", resize: "vertical" }}
            />
          </AdminField>

          <AdminField label="Opening beat">
            <input
              value={openingBeat}
              onChange={(e) => setOpeningBeat(e.target.value)}
              placeholder="The beat the scene opens on."
              style={inputStyle}
            />
          </AdminField>

          <AdminField label="Default ambience (optional)">
            <input
              value={defaultAmbience}
              onChange={(e) => setDefaultAmbience(e.target.value)}
              placeholder="Ambience track id, or leave blank for silence."
              style={inputStyle}
            />
          </AdminField>

          <AdminField label="Narrator voice">
            <VoiceLibraryPicker
              currentVoiceId={narratorVoiceId}
              voices={voiceOptions}
              onChange={(next) => setNarratorVoiceId(next)}
            />
          </AdminField>

          <AdminField label="Status">
            <select
              value={status}
              onChange={(e) => setStatus(e.target.value as typeof status)}
              style={{ ...inputStyle, cursor: "pointer" }}
            >
              <option value="draft">draft</option>
              <option value="active">active</option>
              <option value="archived">archived</option>
            </select>
          </AdminField>

          <div style={{ display: "flex", alignItems: "center", gap: "var(--space-12)" }}>
            <AdminButton variant="primary" onClick={saveConfig} disabled={pending}>
              {pending ? "Saving…" : "Save changes"}
            </AdminButton>
            {saved && !pending && (
              <span style={{ color: adminTokens.success, fontSize: "var(--font-size-sm)" }}>
                Saved.
              </span>
            )}
          </div>
        </AdminPanel>
      </AdminSection>

      <AdminSection
        title="Cast"
        eyebrow={`${roster.length} character${roster.length === 1 ? "" : "s"}`}
      >
        <AdminPanel style={{ display: "flex", flexDirection: "column", gap: "var(--space-12)" }}>
          {roster.length === 0 ? (
            <p style={{ margin: 0, color: adminTokens.muted, fontSize: "var(--font-size-sm)" }}>
              No characters yet. The orchestrator needs at least two to run a
              multi-character scene.
            </p>
          ) : (
            <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: "var(--space-8)" }}>
              {roster.map((entry) => (
                <li
                  key={entry.nodeId}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    gap: "var(--space-12)",
                    padding: "8px 12px",
                    background: adminTokens.panel,
                    border: `1px solid ${adminTokens.border}`,
                    borderRadius: "var(--radius-md)",
                  }}
                >
                  <span style={{ fontWeight: 500 }}>{entry.label}</span>
                  <AdminButton
                    variant="ghost"
                    tone="danger"
                    onClick={() => removeCharacter(entry.nodeId)}
                    disabled={pending}
                  >
                    Remove
                  </AdminButton>
                </li>
              ))}
            </ul>
          )}

          {addableCharacters.length > 0 && (
            <div style={{ display: "flex", alignItems: "center", gap: "var(--space-8)" }}>
              <AdminKicker tone="muted">Add</AdminKicker>
              <select
                defaultValue=""
                onChange={(e) => {
                  addCharacter(e.target.value);
                  e.target.value = "";
                }}
                disabled={pending}
                style={{ ...inputStyle, cursor: "pointer", maxWidth: 320 }}
              >
                <option value="" disabled>
                  Add a character…
                </option>
                {addableCharacters.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.title}
                  </option>
                ))}
              </select>
            </div>
          )}
        </AdminPanel>
      </AdminSection>

      <div>
        <AdminButton variant="ghost" tone="danger" onClick={archive} disabled={pending}>
          Archive scene
        </AdminButton>
      </div>
    </div>
  );
}

const inputStyle = {
  height: 36,
  width: "100%",
  padding: "0 12px",
  background: adminTokens.inputBg,
  border: `1px solid ${adminTokens.inputBorder}`,
  borderRadius: "var(--radius-md)",
  color: adminTokens.fg,
  fontFamily: adminTokens.fontBody,
  fontSize: "var(--font-size-base)",
  outline: "none",
} as const;
