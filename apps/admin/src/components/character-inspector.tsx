"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import type { CharacterNodeData } from "@odyssey/db";
import {
  getCharacterInspectorData,
  updateCharacterNodeOverlay,
  unlinkCharacterFromWorld,
  type CharacterInspectorData,
} from "@/app/(authenticated)/worlds/[worldId]/editor/actions";

/* ── Paper 10NX-0 palette ─────────────────────────────────────
 * Specific hexes extracted from the Paper design file so the
 * inspector sits tonally alongside the canvas character chips.
 */
const T = {
  ground: "#0C0F16",
  panel: "#0D1118",
  worldBg: "#0B0E15",
  card: "#13161D",
  borderSoft: "#1A1E28",
  borderMid: "#1F232D",
  borderStrong: "#242934",
  textPrimary: "#E7EAF0",
  textSecondary: "#BFC6D4",
  muted: "#9CA5B6",
  mutedSoft: "#7C8494",
  mutedFaint: "#5B6272",
  pink: "#E8A0B5",
  mint: "#7AE5C5",
  mintInk: "#07201B",
  amber: "#E8B76A",
  purple: "#B496E6",
  danger: "#E36D76",
  dangerSoft: "#D87A8A",
  avatarInk: "#2A0E18",
  avatarGradient:
    "linear-gradient(135deg, #F4B5C7 0%, #C47B96 100%)",
  fontHeading: "'Space Grotesk', sans-serif",
  fontBody: "'Inter', sans-serif",
  fontMono: "'DM Mono', 'JetBrains Mono', monospace",
};

type Props = {
  worldId: string;
  /** The hydrated CharacterDefinition.id (= character slug). */
  characterSlug: string;
  onClose: () => void;
  /** Called after unlink so canvas can reload. */
  onUnlinked: () => void;
};

export function CharacterInspector({ worldId, characterSlug, onClose, onUnlinked }: Props) {
  const [data, setData] = useState<CharacterInspectorData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const [draft, setDraft] = useState<{ label: string; data: CharacterNodeData }>({
    label: "",
    data: {},
  });
  const [, startSave] = useTransition();
  const [saving, setSaving] = useState(false);
  const [, startUnlink] = useTransition();
  const [unlinking, setUnlinking] = useState(false);

  const baselineRef = useRef<{ label: string; data: CharacterNodeData }>({ label: "", data: {} });

  const load = () => {
    setLoading(true);
    setError(null);
    getCharacterInspectorData(worldId, characterSlug).then((res) => {
      setLoading(false);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setData(res.data!);
      const nodeData = (res.data!.node.data as CharacterNodeData | undefined) ?? {};
      const next = { label: res.data!.node.label, data: nodeData };
      setDraft(next);
      baselineRef.current = JSON.parse(JSON.stringify(next));
    });
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [worldId, characterSlug]);

  const dirty = useMemo(() => {
    const base = baselineRef.current;
    return (
      draft.label !== base.label ||
      JSON.stringify(draft.data) !== JSON.stringify(base.data)
    );
  }, [draft]);

  function patchData(partial: Partial<CharacterNodeData>) {
    setDraft((d) => ({ ...d, data: { ...d.data, ...partial } }));
  }

  function patchOverrides(partial: Record<string, unknown>) {
    setDraft((d) => ({
      ...d,
      data: {
        ...d.data,
        overrides: { ...(d.data.overrides ?? {}), ...partial },
      },
    }));
  }

  function handleSave() {
    if (!data || !dirty) return;
    setSaving(true);
    setError(null);
    startSave(async () => {
      const res = await updateCharacterNodeOverlay(worldId, data.node.id, {
        label: draft.label,
        data: draft.data,
      });
      setSaving(false);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      baselineRef.current = JSON.parse(JSON.stringify(draft));
      setData((d) => (d ? { ...d, node: res.data!.node } : d));
    });
  }

  function handleRevert() {
    setDraft(JSON.parse(JSON.stringify(baselineRef.current)));
  }

  function handleUnlink() {
    if (!data) return;
    if (!window.confirm(`Remove ${data.character.title} from this world? The global character record stays; only this world's overlay + connections are removed.`)) {
      return;
    }
    setUnlinking(true);
    setError(null);
    startUnlink(async () => {
      const res = await unlinkCharacterFromWorld(worldId, data.node.id);
      setUnlinking(false);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      onUnlinked();
    });
  }

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape" && !saving && !unlinking) {
        onClose();
        return;
      }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        if (dirty && !saving) handleSave();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dirty, saving, unlinking]);

  if (loading) {
    return (
      <div style={{ padding: 24, color: T.mutedSoft, fontFamily: T.fontBody, fontSize: 13 }}>
        Loading character…
      </div>
    );
  }

  if (!data) {
    return (
      <div style={{ padding: 24, color: T.danger, fontFamily: T.fontBody, fontSize: 13 }}>
        {error ?? "Character not found."}
      </div>
    );
  }

  const { character, node, edges, libraryCounts } = data;

  const scores =
    (draft.data.overrides?.emotionalBaselineScores as BaselineScores | undefined) ??
    parseBaselineString(draft.data.emotionalBaseline);

  const motivationsList =
    (draft.data.overrides?.motivationsList as string[] | undefined) ??
    splitMotivationsString(draft.data.motivations);

  return (
    <div style={{
      display: "flex", flexDirection: "column", background: T.ground,
      height: "100%", overflow: "hidden",
    }}>
      {/* ── Rail Header ───────────────────────────────────────── */}
      <div style={{
        display: "flex", flexDirection: "column", gap: 14,
        padding: "20px 22px 18px",
        background: T.panel,
        borderBottom: `1px solid ${T.borderSoft}`,
      }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <EyebrowRow dot={T.pink} color={T.mutedFaint}>Selected · Character</EyebrowRow>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <IconBox label="More">⋯</IconBox>
            <IconBox label="Close inspector" onClick={onClose}>×</IconBox>
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <CharacterAvatar title={character.title} image={character.image} />
          <div style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0 }}>
            <div style={{
              fontFamily: T.fontHeading, fontSize: 19, fontWeight: 500,
              color: T.textPrimary, lineHeight: "24px", letterSpacing: "-0.01em",
              overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
            }}>
              {character.title}
            </div>
            <div style={{
              fontFamily: T.fontMono, fontSize: 11, color: T.mutedSoft,
              lineHeight: "14px",
              overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
            }}>
              → characters.{character.slug}
            </div>
          </div>
        </div>
      </div>

      {/* ── Scrollable body ───────────────────────────────────── */}
      <div style={{ flex: 1, overflowY: "auto" }}>
        {/* Global Section */}
        <Section
          dotColor={T.mint}
          eyebrow="Global · read-only"
          eyebrowColor={T.mutedSoft}
          padding="20px 22px 22px"
          gap={14}
          eyebrowRight={
            <a
              href={`/characters/${character.slug}`}
              target="_blank"
              rel="noopener noreferrer"
              style={{
                fontFamily: T.fontBody, fontSize: 11, fontWeight: 500,
                color: T.mint, textDecoration: "none",
              }}
            >
              Open in /characters →
            </a>
          }
        >
          {character.summary && (
            <p style={{
              fontFamily: T.fontBody, fontSize: 13, color: T.textSecondary,
              lineHeight: "20px", margin: 0,
            }}>
              {character.summary}
            </p>
          )}
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            {character.eras.slice(0, 4).map((era) => (
              <TagChip key={era.key} tone="era">{era.title}</TagChip>
            ))}
            <TagChip tone="neutral">
              {libraryCounts.worlds === 1 ? "1 world" : `${libraryCounts.worlds} worlds`}
            </TagChip>
          </div>
        </Section>

        {/* World Overlay Section */}
        <Section
          dotColor={T.amber}
          eyebrow="This world · editable"
          eyebrowColor={T.amber}
          background={T.worldBg}
          padding="22px 22px 24px"
          gap={18}
          eyebrowRight={dirty ? <UnsavedPill /> : null}
        >
          <FieldText
            label="Display name"
            value={draft.label}
            onChange={(v) => setDraft((d) => ({ ...d, label: v }))}
            placeholder={character.title}
          />
          <FieldText
            label="Role in world"
            value={draft.data.roleInWorld ?? ""}
            onChange={(v) => patchData({ roleInWorld: v || undefined })}
            placeholder="e.g. host · patriarch"
          />
          <FieldText
            label="Archetype"
            value={draft.data.archetype ?? ""}
            onChange={(v) => patchData({ archetype: v || undefined })}
            placeholder="e.g. the wanderer"
          />
          <BaselineEditor
            scores={scores}
            onChange={(next) => {
              patchOverrides({ emotionalBaselineScores: next });
              patchData({ emotionalBaseline: serializeBaseline(next) });
            }}
          />
          <MotivationsEditor
            list={motivationsList}
            onChange={(next) => {
              patchOverrides({ motivationsList: next });
              patchData({ motivations: next.join("; ") || undefined });
            }}
          />
          <FieldTextarea
            label="Speaking style"
            overrideTag={draft.data.speakingStyle ? "Overrides global" : null}
            value={draft.data.speakingStyle ?? ""}
            onChange={(v) => patchData({ speakingStyle: v || undefined })}
            placeholder="Tone, rhythm, distinctive phrases."
            minHeight={60}
          />
          <BehaviorTriggersEditor
            triggers={draft.data.behaviorTriggers ?? []}
            onChange={(bt) => patchData({ behaviorTriggers: bt.length === 0 ? undefined : bt })}
          />
        </Section>

        {/* Connections Section */}
        <Section
          dotColor={T.muted}
          eyebrow="Connections"
          eyebrowColor={T.mutedSoft}
          padding="20px 22px 22px"
          gap={12}
          eyebrowRight={
            <span style={{ fontFamily: T.fontMono, fontSize: 10, color: T.mutedFaint, letterSpacing: "0.02em" }}>
              {edges.length} {edges.length === 1 ? "edge" : "edges"}
            </span>
          }
        >
          {edges.length === 0 ? (
            <p style={{ fontFamily: T.fontBody, fontSize: 12, color: T.mutedSoft, margin: 0 }}>
              No edges yet. Connect this character to places or events to define context.
            </p>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              {edges.map(({ edge, direction, otherNode }) => (
                <ConnectionRow
                  key={edge.id}
                  kind={edge.kind}
                  direction={direction}
                  otherLabel={otherNode?.label ?? "(unknown)"}
                  otherKind={otherNode?.kind}
                />
              ))}
            </div>
          )}
        </Section>
      </div>

      {/* ── Actions Footer ────────────────────────────────────── */}
      <div style={{
        display: "flex", flexDirection: "column", gap: 14,
        padding: "18px 22px 20px",
        background: T.panel,
        borderTop: `1px solid ${T.borderSoft}`,
      }}>
        {error && (
          <div style={{
            fontFamily: T.fontBody, fontSize: 11, color: T.amber,
            padding: "6px 10px", borderRadius: 6,
            background: "rgba(232,183,106,0.10)", border: `1px solid rgba(232,183,106,0.35)`,
          }}>
            {error}
          </div>
        )}
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <button
            type="button"
            onClick={handleSave}
            disabled={!dirty || saving}
            style={{
              flex: 1, padding: "10px 12px", borderRadius: 8, border: "none",
              background: dirty ? T.mint : "rgba(122,229,197,0.25)",
              color: dirty ? T.mintInk : "rgba(7,32,27,0.50)",
              fontFamily: T.fontBody, fontSize: 13, fontWeight: 500, lineHeight: "16px",
              cursor: dirty && !saving ? "pointer" : "default",
            }}
          >
            {saving ? "Saving…" : "Save overlay"}
          </button>
          <button
            type="button"
            onClick={handleRevert}
            disabled={!dirty || saving}
            style={{
              padding: "10px 14px", borderRadius: 8,
              background: "transparent", border: `1px solid ${T.borderStrong}`,
              color: dirty ? T.muted : T.mutedFaint,
              fontFamily: T.fontBody, fontSize: 12, fontWeight: 500, lineHeight: "16px",
              cursor: dirty && !saving ? "pointer" : "default",
            }}
          >
            Revert
          </button>
        </div>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <span style={{ fontFamily: T.fontMono, fontSize: 10, color: T.mutedFaint, lineHeight: "12px" }}>
            world_nodes.updated_at · {node.updatedAt ? relativeTime(node.updatedAt) : "never"}
          </span>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <button
              type="button"
              onClick={handleUnlink}
              disabled={unlinking}
              style={{
                border: "none", background: "transparent", padding: 0,
                color: T.muted, fontFamily: T.fontBody, fontSize: 11, fontWeight: 500, lineHeight: "14px",
                cursor: unlinking ? "default" : "pointer",
              }}
            >
              {unlinking ? "Unlinking…" : "Unlink"}
            </button>
            <button
              type="button"
              onClick={handleUnlink}
              disabled={unlinking}
              style={{
                border: "none", background: "transparent", padding: 0,
                color: T.dangerSoft, fontFamily: T.fontBody, fontSize: 11, fontWeight: 500, lineHeight: "14px",
                cursor: unlinking ? "default" : "pointer",
              }}
            >
              Delete node
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ── Layout helpers ──────────────────────────────────────── */

function Section({
  dotColor,
  eyebrow,
  eyebrowColor,
  eyebrowRight,
  children,
  background,
  padding = "18px 22px",
  gap = 12,
}: {
  dotColor: string;
  eyebrow: string;
  eyebrowColor?: string;
  eyebrowRight?: React.ReactNode;
  children: React.ReactNode;
  background?: string;
  padding?: string;
  gap?: number;
}) {
  return (
    <div style={{
      display: "flex", flexDirection: "column", gap,
      padding,
      background,
      borderBottom: `1px solid ${T.borderSoft}`,
    }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <EyebrowRow dot={dotColor} color={eyebrowColor ?? T.mutedSoft}>{eyebrow}</EyebrowRow>
        {eyebrowRight}
      </div>
      {children}
    </div>
  );
}

function EyebrowRow({ dot, color, children }: { dot: string; color: string; children: React.ReactNode }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
      <span style={{ width: 6, height: 6, borderRadius: 999, background: dot }} />
      <span style={{
        fontFamily: T.fontMono, fontSize: 10, color,
        letterSpacing: "0.18em", textTransform: "uppercase", lineHeight: "12px",
      }}>
        {children}
      </span>
    </div>
  );
}

function IconBox({ children, onClick, label }: { children: React.ReactNode; onClick?: () => void; label: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      style={{
        width: 26, height: 26, borderRadius: 6,
        border: `1px solid ${T.borderMid}`, background: "transparent",
        color: T.mutedSoft, cursor: onClick ? "pointer" : "default",
        fontFamily: T.fontBody, fontSize: 13, lineHeight: 1,
        display: "flex", alignItems: "center", justifyContent: "center",
      }}
    >
      {children}
    </button>
  );
}

function UnsavedPill() {
  return (
    <div style={{
      display: "inline-flex", alignItems: "center", gap: 6,
      padding: "3px 8px", borderRadius: 999,
      background: "rgba(232,183,106,0.10)", border: "1px solid rgba(232,183,106,0.24)",
    }}>
      <span style={{ width: 6, height: 6, borderRadius: 999, background: T.amber }} />
      <span style={{
        fontFamily: T.fontBody, fontSize: 10, fontWeight: 500,
        color: T.amber, letterSpacing: "0.06em", textTransform: "uppercase",
      }}>
        Unsaved
      </span>
    </div>
  );
}

/* ── Field primitives ────────────────────────────────────── */

function FieldText({
  label,
  value,
  onChange,
  placeholder,
  mono,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  mono?: boolean;
}) {
  return (
    <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <FieldLabel>{label}</FieldLabel>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        style={{
          padding: "9px 12px", borderRadius: 8,
          background: T.card, border: `1px solid ${T.borderStrong}`,
          color: T.textPrimary,
          fontFamily: mono ? T.fontMono : T.fontBody,
          fontSize: 13, lineHeight: "16px", outline: "none",
        }}
      />
    </label>
  );
}

function FieldTextarea({
  label,
  value,
  onChange,
  placeholder,
  overrideTag,
  minHeight,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  overrideTag?: string | null;
  minHeight?: number;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <FieldLabel>{label}</FieldLabel>
        {overrideTag && (
          <span style={{
            fontFamily: T.fontBody, fontSize: 9, fontWeight: 500,
            color: T.amber, letterSpacing: "0.08em", textTransform: "uppercase",
          }}>
            {overrideTag}
          </span>
        )}
      </div>
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        rows={3}
        style={{
          padding: "9px 12px", borderRadius: 8,
          background: T.card, border: `1px solid ${T.borderStrong}`,
          color: T.textPrimary,
          fontFamily: T.fontBody, fontSize: 12, lineHeight: "18px", outline: "none",
          resize: "vertical",
          minHeight: minHeight ?? undefined,
        }}
      />
    </div>
  );
}

function FieldLabel({ children }: { children: React.ReactNode }) {
  return (
    <span style={{
      fontFamily: T.fontBody, fontSize: 10, fontWeight: 500,
      color: T.mutedSoft, letterSpacing: "0.14em", textTransform: "uppercase", lineHeight: "12px",
    }}>
      {children}
    </span>
  );
}

/* ── Emotional baseline editor ───────────────────────────── */

type BaselineScores = { hope?: number; loyalty?: number; fear?: number; anger?: number };

const BASELINE_ROWS: Array<{ key: keyof BaselineScores; label: string; tone: "mint" | "amber" }> = [
  { key: "hope",    label: "hope",    tone: "mint" },
  { key: "loyalty", label: "loyalty", tone: "mint" },
  { key: "fear",    label: "fear",    tone: "amber" },
  { key: "anger",   label: "anger",   tone: "amber" },
];

function BaselineEditor({
  scores,
  onChange,
}: {
  scores: BaselineScores;
  onChange: (next: BaselineScores) => void;
}) {
  function set(key: keyof BaselineScores, raw: string) {
    const n = Number(raw);
    const clamped = Math.max(0, Math.min(100, Number.isFinite(n) ? Math.round(n) : 0));
    onChange({ ...scores, [key]: clamped });
  }
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <FieldLabel>Emotional baseline</FieldLabel>
      <div style={{
        display: "flex", flexDirection: "column", gap: 8,
        padding: "12px", borderRadius: 8,
        background: T.card, border: `1px solid ${T.borderStrong}`,
      }}>
        {BASELINE_ROWS.map(({ key, label, tone }) => {
          const v = Math.max(0, Math.min(100, Math.round(scores[key] ?? 0)));
          const fill = tone === "mint" ? T.mint : T.amber;
          return (
            <div key={key} style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <span style={{
                width: 72, fontFamily: T.fontMono, fontSize: 11, color: T.muted, lineHeight: "14px",
              }}>
                {label}
              </span>
              <div style={{
                flex: 1, height: 4, borderRadius: 999,
                background: T.borderMid, position: "relative", overflow: "hidden",
              }}>
                <div style={{
                  position: "absolute", left: 0, top: 0, bottom: 0,
                  width: `${v}%`, background: fill, borderRadius: 999,
                }} />
              </div>
              <input
                type="number"
                min={0}
                max={100}
                value={Number.isFinite(scores[key] as number) ? (scores[key] as number) : 0}
                onChange={(e) => set(key, e.target.value)}
                style={{
                  width: 40, textAlign: "right",
                  background: "transparent", border: "none", outline: "none",
                  color: T.textPrimary, fontFamily: T.fontMono, fontSize: 11, lineHeight: "14px",
                  padding: 0,
                }}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ── Motivations list editor ─────────────────────────────── */

function MotivationsEditor({
  list,
  onChange,
}: {
  list: string[];
  onChange: (next: string[]) => void;
}) {
  function update(idx: number, value: string) {
    onChange(list.map((v, i) => (i === idx ? value : v)));
  }
  function remove(idx: number) {
    onChange(list.filter((_, i) => i !== idx));
  }
  function add() {
    onChange([...list, ""]);
  }
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <FieldLabel>Motivations</FieldLabel>
        <AddButton onClick={add} />
      </div>
      {list.length === 0 && (
        <span style={{ fontFamily: T.fontBody, fontSize: 11, color: T.mutedFaint }}>
          None yet. Drives the engine&apos;s goal-seeking behavior.
        </span>
      )}
      {list.map((entry, i) => (
        <div
          key={i}
          style={{
            display: "flex", alignItems: "center", gap: 8,
            padding: "9px 12px", borderRadius: 8,
            background: T.card, border: `1px solid ${T.borderStrong}`,
          }}
        >
          <span style={{
            width: 18, height: 18, borderRadius: 999, flexShrink: 0,
            background: "rgba(232,160,181,0.10)", color: T.pink,
            fontFamily: T.fontMono, fontSize: 10, lineHeight: "18px",
            display: "flex", alignItems: "center", justifyContent: "center",
          }}>
            {i + 1}
          </span>
          <input
            type="text"
            value={entry}
            onChange={(e) => update(i, e.target.value)}
            placeholder="Bear a child"
            style={{
              flex: 1, border: "none", background: "transparent", outline: "none",
              color: T.textPrimary, fontFamily: T.fontBody, fontSize: 12, lineHeight: "18px",
              padding: 0,
            }}
          />
          <button
            type="button"
            onClick={() => remove(i)}
            aria-label="Remove motivation"
            style={{
              border: "none", background: "transparent", color: T.mutedFaint,
              cursor: "pointer", fontFamily: T.fontBody, fontSize: 14, padding: "0 2px",
            }}
          >
            ×
          </button>
        </div>
      ))}
    </div>
  );
}

/* ── Behavior triggers editor ────────────────────────────── */

function BehaviorTriggersEditor({
  triggers,
  onChange,
}: {
  triggers: NonNullable<CharacterNodeData["behaviorTriggers"]>;
  onChange: (next: NonNullable<CharacterNodeData["behaviorTriggers"]>) => void;
}) {
  function update(idx: number, patch: Partial<{ condition: string; behavior: string }>) {
    onChange(triggers.map((t, i) => (i === idx ? { ...t, ...patch } : t)));
  }
  function remove(idx: number) {
    onChange(triggers.filter((_, i) => i !== idx));
  }
  function add() {
    onChange([...triggers, { condition: "", behavior: "" }]);
  }
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <FieldLabel>Behavior triggers</FieldLabel>
        <AddButton onClick={add} />
      </div>
      {triggers.length === 0 ? (
        <span style={{ fontFamily: T.fontBody, fontSize: 11, color: T.mutedFaint }}>
          None yet. Define conditions that alter this character&apos;s response.
        </span>
      ) : (
        <div style={{
          display: "flex", flexDirection: "column",
          padding: "10px 12px", borderRadius: 8, gap: 6,
          background: T.card, border: `1px solid ${T.borderStrong}`,
        }}>
          {triggers.map((t, i) => (
            <div key={i} style={{
              display: "flex", flexDirection: "column", gap: 4,
              paddingBottom: i < triggers.length - 1 ? 6 : 0,
              borderBottom: i < triggers.length - 1 ? `1px solid ${T.borderMid}` : "none",
            }}>
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <span style={{
                  fontFamily: T.fontMono, fontSize: 10, color: T.mint,
                  letterSpacing: "0.02em", flexShrink: 0,
                }}>
                  if ·
                </span>
                <input
                  type="text"
                  value={t.condition}
                  onChange={(e) => update(i, { condition: e.target.value })}
                  placeholder="visitor mentions prophecy"
                  style={{
                    flex: 1, border: "none", background: "transparent", outline: "none",
                    color: T.mint, fontFamily: T.fontMono, fontSize: 10, lineHeight: "14px",
                    padding: 0, letterSpacing: "0.02em",
                  }}
                />
                <button
                  type="button"
                  onClick={() => remove(i)}
                  aria-label="Remove trigger"
                  style={{
                    border: "none", background: "transparent", color: T.mutedFaint,
                    cursor: "pointer", fontFamily: T.fontBody, fontSize: 13, padding: "0 2px",
                  }}
                >
                  ×
                </button>
              </div>
              <div style={{ display: "flex", alignItems: "flex-start", gap: 6 }}>
                <span style={{
                  fontFamily: T.fontBody, fontSize: 12, color: T.mutedSoft,
                  lineHeight: "17px", flexShrink: 0,
                }}>
                  then
                </span>
                <input
                  type="text"
                  value={t.behavior}
                  onChange={(e) => update(i, { behavior: e.target.value })}
                  placeholder="laugh softly and offer another cup"
                  style={{
                    flex: 1, border: "none", background: "transparent", outline: "none",
                    color: T.textPrimary, fontFamily: T.fontBody, fontSize: 12, lineHeight: "17px",
                    padding: 0,
                  }}
                />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function AddButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        border: "none", background: "transparent", padding: 0,
        color: T.mint, fontFamily: T.fontBody, fontSize: 11, fontWeight: 500,
        cursor: "pointer", letterSpacing: "0.02em",
      }}
    >
      + Add
    </button>
  );
}

/* ── Connection row ──────────────────────────────────────── */

function ConnectionRow({
  kind,
  direction,
  otherLabel,
  otherKind,
}: {
  kind: string;
  direction: "out" | "in";
  otherLabel: string;
  otherKind?: string;
}) {
  const tone = kindTone(kind);
  return (
    <div style={{
      display: "flex", alignItems: "center", gap: 10,
      padding: "9px 12px", borderRadius: 8,
      background: T.card, border: `1px solid ${T.borderMid}`,
    }}>
      <span style={{
        padding: "2px 7px", borderRadius: 4,
        background: tone.bg, border: `1px solid ${tone.border}`,
        fontFamily: T.fontMono, fontSize: 9, color: tone.fg, letterSpacing: "0.02em",
        flexShrink: 0,
      }}>
        {kind}
      </span>
      <span style={{
        flex: 1, minWidth: 0,
        fontFamily: T.fontBody, fontSize: 12, color: T.textPrimary, lineHeight: "16px",
        overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
      }}>
        {direction === "out" ? "→" : "←"} {otherLabel}
      </span>
      {otherKind && (
        <span style={{
          fontFamily: T.fontMono, fontSize: 10, color: T.mutedFaint,
          flexShrink: 0,
        }}>
          {otherKind}
        </span>
      )}
    </div>
  );
}

function kindTone(kind: string): { bg: string; border: string; fg: string } {
  switch (kind) {
    case "knows":
      return { bg: "rgba(122,229,197,0.08)", border: "rgba(122,229,197,0.20)", fg: T.mint };
    case "happens_at":
      return { bg: "rgba(232,183,106,0.08)", border: "rgba(232,183,106,0.20)", fg: T.amber };
    case "involves":
      return { bg: "rgba(180,150,230,0.08)", border: "rgba(180,150,230,0.20)", fg: T.purple };
    default:
      return { bg: "rgba(156,165,182,0.06)", border: "rgba(156,165,182,0.16)", fg: T.muted };
  }
}

/* ── Tag chip (global zone) ──────────────────────────────── */

function TagChip({ tone, children }: { tone: "era" | "neutral"; children: React.ReactNode }) {
  const palette =
    tone === "era"
      ? { bg: "rgba(232,160,181,0.08)", border: "rgba(232,160,181,0.20)", fg: T.pink }
      : { bg: T.card, border: T.borderMid, fg: T.muted };
  return (
    <span style={{
      padding: "4px 8px", borderRadius: 6,
      background: palette.bg, border: `1px solid ${palette.border}`,
      fontFamily: T.fontMono, fontSize: 10, color: palette.fg, letterSpacing: "0.04em",
      lineHeight: "12px",
    }}>
      {children}
    </span>
  );
}

/* ── Avatar ──────────────────────────────────────────────── */

function CharacterAvatar({ title, image }: { title: string; image: string | null }) {
  const initials = title
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase())
    .join("");
  if (image) {
    return (
      <div style={{ position: "relative", width: 52, height: 52, flexShrink: 0 }}>
        <img
          src={image}
          alt=""
          style={{
            width: 52, height: 52, borderRadius: 12,
            objectFit: "cover", display: "block",
          }}
        />
        <LinkDot />
      </div>
    );
  }
  return (
    <div style={{ position: "relative", width: 52, height: 52, flexShrink: 0 }}>
      <div
        style={{
          width: 52, height: 52, borderRadius: 12,
          background: T.avatarGradient,
          display: "flex", alignItems: "center", justifyContent: "center",
          fontFamily: T.fontHeading, fontSize: 22, fontWeight: 500,
          color: T.avatarInk, lineHeight: "28px",
        }}
      >
        {initials}
      </div>
      <LinkDot />
    </div>
  );
}

function LinkDot() {
  return (
    <span style={{
      position: "absolute", right: -3, bottom: -3,
      width: 14, height: 14, borderRadius: 999,
      background: T.mint, border: `2.5px solid ${T.panel}`,
    }} />
  );
}

/* ── Parsers / serializers ───────────────────────────────── */

function parseBaselineString(s: string | undefined): BaselineScores {
  if (!s) return {};
  const out: BaselineScores = {};
  for (const part of s.split(/[,;]/)) {
    const m = part.trim().match(/^(hope|loyalty|fear|anger)\s*[:=]\s*(\d+)/i);
    if (!m) continue;
    const key = m[1]!.toLowerCase() as keyof BaselineScores;
    out[key] = Math.max(0, Math.min(100, parseInt(m[2]!, 10)));
  }
  return out;
}

function serializeBaseline(s: BaselineScores): string | undefined {
  const parts: string[] = [];
  for (const k of ["hope", "loyalty", "fear", "anger"] as const) {
    const v = s[k];
    if (typeof v === "number") parts.push(`${k}:${v}`);
  }
  return parts.length ? parts.join(", ") : undefined;
}

function splitMotivationsString(s: string | undefined): string[] {
  if (!s) return [];
  return s
    .split(/[\n;]/)
    .map((x) => x.trim())
    .filter(Boolean);
}

/* ── Time ────────────────────────────────────────────────── */

function relativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  const now = Date.now();
  const diff = Math.max(0, now - then);
  const s = Math.floor(diff / 1000);
  if (s < 60) return "just now";
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d}d ago`;
  const mo = Math.floor(d / 30);
  return `${mo}mo ago`;
}
