"use client";

import { useState } from "react";
import type {
  WorldDefinition,
  CharacterDefinition,
  GroupDefinition,
  RoleDefinition,
  EventTemplate,
  RelationshipDefinition,
  MetricDefinition,
  EventCategoryDefinition,
} from "@odyssey/types";
import type { EditorNode, EntityType } from "./world-editor";

/* ── Types ────────────────────────────────────────────────── */

type Props = {
  node: EditorNode;
  world: WorldDefinition;
  errors: { nodeId: string; message: string }[];
  onUpdateCharacter: (charId: string, updater: (c: CharacterDefinition) => CharacterDefinition) => void;
  onUpdateGroup: (groupId: string, updater: (g: GroupDefinition) => GroupDefinition) => void;
  onUpdateRole: (roleId: string, updater: (r: RoleDefinition) => RoleDefinition) => void;
  onUpdateEvent: (eventId: string, updater: (e: EventTemplate) => EventTemplate) => void;
  onUpdateRelationship: (relId: string, updater: (r: RelationshipDefinition) => RelationshipDefinition) => void;
  onUpdateWorld: (updater: (w: WorldDefinition) => WorldDefinition) => void;
  onDelete: (entityType: EntityType, entityId: string) => void;
  onClose: () => void;
};

type CharacterTab = "identity" | "emotions" | "voice" | "details" | "behavior" | "relations";
type WorldTab = "core" | "norms" | "safety" | "narrator" | "metrics" | "categories" | "difficulty";

/* ── Shared styles ────────────────────────────────────────── */

const panelRoot: React.CSSProperties = {
  width: 360,
  flexShrink: 0,
  background: "var(--panel)",
  border: "1px solid var(--border)",
  borderRadius: "var(--radius-xl)",
  overflow: "auto",
  display: "flex",
  flexDirection: "column",
};

const headerStyle: React.CSSProperties = {
  padding: "1rem",
  borderBottom: "1px solid var(--border)",
  display: "flex",
  alignItems: "center",
  gap: "0.5rem",
};

const bodyStyle: React.CSSProperties = {
  padding: "1rem",
  flex: 1,
  overflow: "auto",
  display: "flex",
  flexDirection: "column",
  gap: "0.875rem",
};

const labelStyle: React.CSSProperties = {
  fontFamily: "var(--font-mono)",
  fontSize: "0.6rem",
  fontWeight: 600,
  letterSpacing: "0.12em",
  textTransform: "uppercase",
  color: "var(--muted)",
  marginBottom: "0.25rem",
};

const inputStyle: React.CSSProperties = {
  width: "100%",
  padding: "0.5rem 0.625rem",
  borderRadius: "var(--radius-md)",
  border: "1px solid var(--border)",
  background: "var(--background)",
  color: "var(--foreground)",
  fontSize: "0.8125rem",
  outline: "none",
};

const textareaStyle: React.CSSProperties = {
  ...inputStyle,
  minHeight: "4rem",
  resize: "vertical",
  lineHeight: 1.5,
};

const selectStyle: React.CSSProperties = {
  ...inputStyle,
};

const tabBarStyle: React.CSSProperties = {
  display: "flex",
  flexWrap: "wrap",
  gap: "0.125rem",
  padding: "0 1rem",
  borderBottom: "1px solid var(--border)",
};

function TabButton({ active, label, onClick }: { active: boolean; label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        padding: "0.5rem 0.75rem",
        border: "none",
        borderBottom: active ? "2px solid var(--accent)" : "2px solid transparent",
        background: "transparent",
        color: active ? "var(--accent-strong)" : "var(--muted)",
        fontSize: "0.75rem",
        fontWeight: active ? 600 : 400,
        cursor: "pointer",
        transition: "color 150ms",
      }}
    >
      {label}
    </button>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div style={labelStyle}>{label}</div>
      {children}
    </div>
  );
}

function RangeField({
  label,
  value,
  onChange,
  min = 0,
  max = 100,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  min?: number;
  max?: number;
}) {
  return (
    <div>
      <div style={{ ...labelStyle, display: "flex", justifyContent: "space-between" }}>
        <span>{label}</span>
        <span style={{ color: "var(--foreground)", fontFamily: "inherit" }}>{value}</span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        style={{ width: "100%", accentColor: "var(--accent)" }}
      />
    </div>
  );
}

function StringListEditor({
  label,
  items,
  onChange,
}: {
  label: string;
  items: string[];
  onChange: (items: string[]) => void;
}) {
  return (
    <div>
      <div style={{ ...labelStyle, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <span>{label}</span>
        <button
          type="button"
          onClick={() => onChange([...items, ""])}
          style={{
            border: "none",
            background: "transparent",
            color: "var(--accent)",
            cursor: "pointer",
            fontSize: "0.75rem",
            fontWeight: 600,
          }}
        >
          + Add
        </button>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: "0.375rem" }}>
        {items.map((item, i) => (
          <div key={i} style={{ display: "flex", gap: "0.25rem" }}>
            <input
              value={item}
              onChange={(e) => {
                const next = [...items];
                next[i] = e.target.value;
                onChange(next);
              }}
              style={{ ...inputStyle, flex: 1 }}
            />
            <button
              type="button"
              onClick={() => onChange(items.filter((_, j) => j !== i))}
              style={{
                border: "1px solid var(--border)",
                background: "transparent",
                color: "var(--danger)",
                cursor: "pointer",
                borderRadius: "var(--radius-sm)",
                padding: "0 0.5rem",
                fontSize: "0.75rem",
              }}
            >
              &times;
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ── Entity panels ────────────────────────────────────────── */

function CharacterPanel({
  char,
  world,
  onUpdate,
}: {
  char: CharacterDefinition;
  world: WorldDefinition;
  onUpdate: (updater: (c: CharacterDefinition) => CharacterDefinition) => void;
}) {
  const [tab, setTab] = useState<CharacterTab>("identity");

  return (
    <>
      <div style={tabBarStyle}>
        <TabButton active={tab === "identity"} label="Identity" onClick={() => setTab("identity")} />
        <TabButton active={tab === "emotions"} label="Emotions" onClick={() => setTab("emotions")} />
        <TabButton active={tab === "voice"} label="Voice" onClick={() => setTab("voice")} />
        <TabButton active={tab === "details"} label="Details" onClick={() => setTab("details")} />
        <TabButton active={tab === "behavior"} label="Behavior" onClick={() => setTab("behavior")} />
        <TabButton active={tab === "relations"} label="Relations" onClick={() => setTab("relations")} />
      </div>
      <div style={bodyStyle}>
        {tab === "identity" && (
          <>
            <Field label="Name">
              <input
                value={char.name}
                onChange={(e) => onUpdate((c) => ({ ...c, name: e.target.value }))}
                style={inputStyle}
              />
            </Field>
            <Field label="Title">
              <input
                value={char.title}
                onChange={(e) => onUpdate((c) => ({ ...c, title: e.target.value }))}
                style={inputStyle}
              />
            </Field>
            <Field label="Archetype">
              <input
                value={char.archetype}
                onChange={(e) => onUpdate((c) => ({ ...c, archetype: e.target.value }))}
                style={inputStyle}
              />
            </Field>
            <Field label="Group">
              <select
                value={char.groupId}
                onChange={(e) => onUpdate((c) => ({ ...c, groupId: e.target.value }))}
                style={selectStyle}
              >
                {world.groups.map((g) => (
                  <option key={g.id} value={g.id}>{g.name}</option>
                ))}
              </select>
            </Field>
            <StringListEditor
              label="Motivations"
              items={char.motivations}
              onChange={(motivations) => onUpdate((c) => ({ ...c, motivations }))}
            />
          </>
        )}

        {tab === "emotions" && (
          <>
            <RangeField
              label="Anger"
              value={char.emotionalBaseline.anger}
              onChange={(v) => onUpdate((c) => ({ ...c, emotionalBaseline: { ...c.emotionalBaseline, anger: v } }))}
            />
            <RangeField
              label="Fear"
              value={char.emotionalBaseline.fear}
              onChange={(v) => onUpdate((c) => ({ ...c, emotionalBaseline: { ...c.emotionalBaseline, fear: v } }))}
            />
            <RangeField
              label="Hope"
              value={char.emotionalBaseline.hope}
              onChange={(v) => onUpdate((c) => ({ ...c, emotionalBaseline: { ...c.emotionalBaseline, hope: v } }))}
            />
            <RangeField
              label="Loyalty"
              value={char.emotionalBaseline.loyalty}
              onChange={(v) => onUpdate((c) => ({ ...c, emotionalBaseline: { ...c.emotionalBaseline, loyalty: v } }))}
            />
            <RangeField
              label="Volatility"
              value={char.emotionalBaseline.volatility ?? 50}
              onChange={(v) => onUpdate((c) => ({ ...c, emotionalBaseline: { ...c.emotionalBaseline, volatility: v } }))}
            />
          </>
        )}

        {tab === "voice" && (
          <>
            <Field label="Speaking Style">
              <textarea
                value={char.speakingStyle}
                onChange={(e) => onUpdate((c) => ({ ...c, speakingStyle: e.target.value }))}
                style={textareaStyle}
              />
            </Field>
            <Field label="Voice Provider">
              <select
                value={char.voice?.provider ?? ""}
                onChange={(e) => {
                  const provider = e.target.value as "elevenlabs" | "openai" | "";
                  if (!provider) {
                    onUpdate((c) => {
                      const { voice: _, ...rest } = c;
                      return rest as CharacterDefinition;
                    });
                  } else {
                    onUpdate((c) => ({
                      ...c,
                      voice: { provider, voiceId: c.voice?.voiceId ?? "", label: c.voice?.label },
                    }));
                  }
                }}
                style={selectStyle}
              >
                <option value="">None</option>
                <option value="elevenlabs">ElevenLabs</option>
                <option value="openai">OpenAI</option>
              </select>
            </Field>
            {char.voice && (
              <>
                <Field label="Voice ID">
                  <input
                    value={char.voice.voiceId}
                    onChange={(e) =>
                      onUpdate((c) =>
                        c.voice ? { ...c, voice: { ...c.voice, voiceId: e.target.value } } : c,
                      )
                    }
                    style={inputStyle}
                  />
                </Field>
                <Field label="Voice Label">
                  <input
                    value={char.voice.label ?? ""}
                    onChange={(e) =>
                      onUpdate((c) =>
                        c.voice ? { ...c, voice: { ...c.voice, label: e.target.value || undefined } } : c,
                      )
                    }
                    style={inputStyle}
                    placeholder="Optional display name"
                  />
                </Field>
              </>
            )}
          </>
        )}

        {tab === "details" && (
          <>
            <Field label="Backstory">
              <textarea
                value={char.backstory ?? ""}
                onChange={(e) => onUpdate((c) => ({ ...c, backstory: e.target.value || undefined }))}
                style={textareaStyle}
                placeholder="Hidden history for LLM context (not shown to player)"
              />
            </Field>
            <Field label="Visual Description">
              <textarea
                value={char.visualDescription ?? ""}
                onChange={(e) => onUpdate((c) => ({ ...c, visualDescription: e.target.value || undefined }))}
                style={textareaStyle}
                placeholder="Appearance cues for narration"
              />
            </Field>
            <Field label="Death Condition">
              <input
                value={char.deathCondition ?? ""}
                onChange={(e) => onUpdate((c) => ({ ...c, deathCondition: e.target.value || undefined }))}
                style={inputStyle}
                placeholder="When can this character be removed?"
              />
            </Field>
            <StringListEditor
              label="Tags"
              items={char.tags ?? []}
              onChange={(tags) => onUpdate((c) => ({ ...c, tags }))}
            />
            <StringListEditor
              label="Knowledge Domains"
              items={char.knowledgeDomains ?? []}
              onChange={(knowledgeDomains) => onUpdate((c) => ({ ...c, knowledgeDomains }))}
            />
            <StringListEditor
              label="Dialogue Examples"
              items={char.dialogueExamples ?? []}
              onChange={(dialogueExamples) => onUpdate((c) => ({ ...c, dialogueExamples }))}
            />
            <StringListEditor
              label="Secrets"
              items={char.secrets ?? []}
              onChange={(secrets) => onUpdate((c) => ({ ...c, secrets }))}
            />
          </>
        )}

        {tab === "behavior" && (
          <>
            <p style={{ fontSize: "0.75rem", color: "var(--muted)", marginBottom: "0.5rem" }}>
              Behavior triggers define conditional personality shifts evaluated each turn.
            </p>
            {(char.behaviorTriggers ?? []).map((bt, i) => (
              <div key={i} style={{
                padding: "0.75rem", borderRadius: "var(--radius-md)",
                border: "1px solid var(--border)", background: "var(--background)", marginBottom: "0.5rem",
              }}>
                <Field label="Condition">
                  <input
                    value={bt.condition}
                    onChange={(e) => onUpdate((c) => ({
                      ...c,
                      behaviorTriggers: (c.behaviorTriggers ?? []).map((b, j) =>
                        j === i ? { ...b, condition: e.target.value } : b),
                    }))}
                    style={inputStyle}
                    placeholder='e.g. "loyalty < 40"'
                  />
                </Field>
                <Field label="Behavior">
                  <textarea
                    value={bt.behavior}
                    onChange={(e) => onUpdate((c) => ({
                      ...c,
                      behaviorTriggers: (c.behaviorTriggers ?? []).map((b, j) =>
                        j === i ? { ...b, behavior: e.target.value } : b),
                    }))}
                    style={textareaStyle}
                  />
                </Field>
                <button
                  onClick={() => onUpdate((c) => ({
                    ...c,
                    behaviorTriggers: (c.behaviorTriggers ?? []).filter((_, j) => j !== i),
                  }))}
                  style={{ fontSize: "0.7rem", color: "#FF5A5A", background: "none", border: "none", cursor: "pointer", marginTop: "0.25rem" }}
                >
                  Remove
                </button>
              </div>
            ))}
            <button
              onClick={() => onUpdate((c) => ({
                ...c,
                behaviorTriggers: [...(c.behaviorTriggers ?? []), { condition: "", behavior: "" }],
              }))}
              style={{ fontSize: "0.75rem", color: "var(--accent)", background: "none", border: "1px solid var(--border)", borderRadius: "var(--radius-sm)", padding: "0.375rem 0.75rem", cursor: "pointer" }}
            >
              + Add Trigger
            </button>

            <div style={{ marginTop: "1rem" }}>
              <p style={{ fontSize: "0.75rem", color: "var(--muted)", marginBottom: "0.5rem", fontWeight: 600 }}>NPC Relationships</p>
              {(char.npcRelationships ?? []).map((rel, i) => (
                <div key={i} style={{
                  padding: "0.75rem", borderRadius: "var(--radius-md)",
                  border: "1px solid var(--border)", background: "var(--background)", marginBottom: "0.5rem",
                }}>
                  <Field label="Target">
                    <select
                      value={rel.targetCharacterId}
                      onChange={(e) => onUpdate((c) => ({
                        ...c,
                        npcRelationships: (c.npcRelationships ?? []).map((r, j) =>
                          j === i ? { ...r, targetCharacterId: e.target.value } : r),
                      }))}
                      style={selectStyle}
                    >
                      <option value="">Select character</option>
                      {world.characters.filter((c) => c.id !== char.id).map((c) => (
                        <option key={c.id} value={c.id}>{c.name}</option>
                      ))}
                    </select>
                  </Field>
                  <Field label="Attitude">
                    <input
                      value={rel.attitude}
                      onChange={(e) => onUpdate((c) => ({
                        ...c,
                        npcRelationships: (c.npcRelationships ?? []).map((r, j) =>
                          j === i ? { ...r, attitude: e.target.value } : r),
                      }))}
                      style={inputStyle}
                      placeholder='e.g. "distrusts"'
                    />
                  </Field>
                  <Field label="Context">
                    <input
                      value={rel.context ?? ""}
                      onChange={(e) => onUpdate((c) => ({
                        ...c,
                        npcRelationships: (c.npcRelationships ?? []).map((r, j) =>
                          j === i ? { ...r, context: e.target.value || undefined } : r),
                      }))}
                      style={inputStyle}
                      placeholder="Optional reason"
                    />
                  </Field>
                  <button
                    onClick={() => onUpdate((c) => ({
                      ...c,
                      npcRelationships: (c.npcRelationships ?? []).filter((_, j) => j !== i),
                    }))}
                    style={{ fontSize: "0.7rem", color: "#FF5A5A", background: "none", border: "none", cursor: "pointer", marginTop: "0.25rem" }}
                  >
                    Remove
                  </button>
                </div>
              ))}
              <button
                onClick={() => onUpdate((c) => ({
                  ...c,
                  npcRelationships: [...(c.npcRelationships ?? []), { targetCharacterId: "", attitude: "" }],
                }))}
                style={{ fontSize: "0.75rem", color: "var(--accent)", background: "none", border: "1px solid var(--border)", borderRadius: "var(--radius-sm)", padding: "0.375rem 0.75rem", cursor: "pointer" }}
              >
                + Add NPC Relationship
              </button>
            </div>
          </>
        )}

        {tab === "relations" && (() => {
          const relationships = world.initialState.relationships;
          const charRelation = relationships[char.id];
          if (!charRelation) {
            return <p style={{ fontSize: "0.8125rem", color: "var(--muted)" }}>No relationship data for this character.</p>;
          }

          return (
            <>
              {world.characters.filter((c) => c.id !== char.id).map((other) => {
                const otherRelation = relationships[other.id];
                if (!otherRelation) return null;
                const group = world.groups.find((g) => g.id === other.groupId);

                return (
                  <div key={other.id} style={{
                    padding: "0.75rem",
                    borderRadius: "var(--radius-md)",
                    border: "1px solid var(--border)",
                    background: "var(--background)",
                  }}>
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "0.5rem" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: "0.375rem" }}>
                        <span style={{ width: 7, height: 7, borderRadius: "50%", background: "#5B8DEF" }} />
                        <span style={{ fontSize: "0.8125rem", fontWeight: 600 }}>{other.name}</span>
                      </div>
                      {group && (
                        <span style={{
                          fontSize: "0.6rem", padding: "0.0625rem 0.375rem", borderRadius: "var(--radius-xs)",
                          background: "rgba(109,184,137,0.15)", color: "#6FBF88", fontWeight: 500,
                        }}>
                          {group.name}
                        </span>
                      )}
                    </div>
                    <RangeField label="Trust" value={otherRelation.trust}
                      onChange={(v) => onUpdate(() => char)} // read-only for now — relationships are on initialState
                    />
                    <RangeField label="Fear" value={otherRelation.fear}
                      onChange={(v) => onUpdate(() => char)}
                    />
                    <RangeField label="Loyalty" value={otherRelation.loyalty}
                      onChange={(v) => onUpdate(() => char)}
                    />
                    {otherRelation.recentMemory.length > 0 && (
                      <div style={{ marginTop: "0.375rem" }}>
                        <div style={{ ...labelStyle, marginBottom: "0.25rem" }}>Recent Memory</div>
                        {otherRelation.recentMemory.map((mem, i) => (
                          <p key={i} style={{ fontSize: "0.75rem", color: "var(--muted)", lineHeight: 1.4, paddingLeft: "0.5rem", borderLeft: "2px solid var(--border)", marginBottom: "0.25rem" }}>
                            {mem}
                          </p>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </>
          );
        })()}
      </div>
    </>
  );
}

type GroupTab = "identity" | "dynamics" | "narrative" | "relations";

function GroupPanel({
  group,
  world,
  onUpdate,
}: {
  group: GroupDefinition;
  world: WorldDefinition;
  onUpdate: (updater: (g: GroupDefinition) => GroupDefinition) => void;
}) {
  const [tab, setTab] = useState<GroupTab>("identity");

  return (
    <div style={bodyStyle}>
      <div style={{ display: "flex", gap: "0.25rem", marginBottom: "0.75rem", flexWrap: "wrap" }}>
        {(["identity", "dynamics", "narrative", "relations"] as GroupTab[]).map((t) => (
          <TabButton key={t} label={t.charAt(0).toUpperCase() + t.slice(1)} active={tab === t} onClick={() => setTab(t)} />
        ))}
      </div>

      {tab === "identity" && (
        <>
          <Field label="Name">
            <input value={group.name} onChange={(e) => onUpdate((g) => ({ ...g, name: e.target.value }))} style={inputStyle} />
          </Field>
          <Field label="Description">
            <textarea value={group.description} onChange={(e) => onUpdate((g) => ({ ...g, description: e.target.value }))} style={textareaStyle} />
          </Field>
          <Field label="Leader">
            <select
              value={group.leaderId ?? ""}
              onChange={(e) => onUpdate((g) => ({ ...g, leaderId: e.target.value || undefined }))}
              style={selectStyle}
            >
              <option value="">None</option>
              {world.characters.map((c) => (
                <option key={c.id} value={c.id}>{c.name} — {c.title}</option>
              ))}
            </select>
          </Field>
          <Field label="Power Type">
            <select
              value={group.powerType ?? ""}
              onChange={(e) => onUpdate((g) => ({ ...g, powerType: (e.target.value || undefined) as GroupDefinition["powerType"] }))}
              style={selectStyle}
            >
              <option value="">None</option>
              <option value="military">Military</option>
              <option value="economic">Economic</option>
              <option value="religious">Religious</option>
              <option value="political">Political</option>
              <option value="popular">Popular</option>
            </select>
          </Field>
          <StringListEditor label="Tags" items={group.tags ?? []} onChange={(items) => onUpdate((g) => ({ ...g, tags: items }))} />
        </>
      )}

      {tab === "dynamics" && (
        <>
          <RangeField label="Influence" value={group.influence} onChange={(v) => onUpdate((g) => ({ ...g, influence: v }))} />
          <RangeField label="Volatility" value={group.volatility ?? 50} onChange={(v) => onUpdate((g) => ({ ...g, volatility: v }))} />
          <RangeField label="Cohesion" value={group.cohesion ?? 50} onChange={(v) => onUpdate((g) => ({ ...g, cohesion: v }))} />
          <Field label="Disposition">
            <select
              value={group.disposition}
              onChange={(e) => onUpdate((g) => ({ ...g, disposition: e.target.value as GroupDefinition["disposition"] }))}
              style={selectStyle}
            >
              <option value="supportive">Supportive</option>
              <option value="neutral">Neutral</option>
              <option value="hostile">Hostile</option>
              <option value="volatile">Volatile</option>
            </select>
          </Field>
          <div style={{ ...labelStyle, marginTop: "0.5rem" }}>Disposition Triggers</div>
          {(group.dispositionTriggers ?? []).map((dt, i) => (
            <div key={i} style={{ display: "flex", gap: "0.25rem", alignItems: "flex-start", marginBottom: "0.25rem" }}>
              <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: "0.25rem" }}>
                <input
                  value={dt.condition}
                  placeholder="e.g. influence < 30"
                  onChange={(e) => onUpdate((g) => {
                    const triggers = [...(g.dispositionTriggers ?? [])];
                    triggers[i] = { ...triggers[i], condition: e.target.value };
                    return { ...g, dispositionTriggers: triggers };
                  })}
                  style={inputStyle}
                />
                <select
                  value={dt.dispositionShift}
                  onChange={(e) => onUpdate((g) => {
                    const triggers = [...(g.dispositionTriggers ?? [])];
                    triggers[i] = { ...triggers[i], dispositionShift: e.target.value as GroupDefinition["disposition"] };
                    return { ...g, dispositionTriggers: triggers };
                  })}
                  style={selectStyle}
                >
                  <option value="supportive">→ Supportive</option>
                  <option value="neutral">→ Neutral</option>
                  <option value="hostile">→ Hostile</option>
                  <option value="volatile">→ Volatile</option>
                </select>
              </div>
              <button type="button" onClick={() => onUpdate((g) => ({ ...g, dispositionTriggers: (g.dispositionTriggers ?? []).filter((_, j) => j !== i) }))} style={{ border: "none", background: "transparent", color: "var(--danger)", cursor: "pointer", fontSize: "0.8rem", padding: "0.25rem" }}>×</button>
            </div>
          ))}
          <button type="button" onClick={() => onUpdate((g) => ({ ...g, dispositionTriggers: [...(g.dispositionTriggers ?? []), { condition: "", dispositionShift: "hostile" as const }] }))} style={{ border: "none", background: "transparent", color: "var(--accent)", cursor: "pointer", fontSize: "0.8rem", padding: "0.25rem" }}>+ Add Trigger</button>
          <StringListEditor label="Goals" items={group.goals ?? []} onChange={(items) => onUpdate((g) => ({ ...g, goals: items }))} />
          <StringListEditor label="Demands" items={group.demands ?? []} onChange={(items) => onUpdate((g) => ({ ...g, demands: items }))} />
        </>
      )}

      {tab === "narrative" && (
        <>
          <Field label="Backstory">
            <textarea value={group.backstory ?? ""} onChange={(e) => onUpdate((g) => ({ ...g, backstory: e.target.value || undefined }))} style={textareaStyle} />
          </Field>
          <Field label="Collective Voice">
            <textarea value={group.collectiveVoice ?? ""} onChange={(e) => onUpdate((g) => ({ ...g, collectiveVoice: e.target.value || undefined }))} style={textareaStyle} />
          </Field>
          <Field label="Visual Identity">
            <input value={group.visualIdentity ?? ""} onChange={(e) => onUpdate((g) => ({ ...g, visualIdentity: e.target.value || undefined }))} style={inputStyle} />
          </Field>
          <StringListEditor label="Assets" items={group.assets ?? []} onChange={(items) => onUpdate((g) => ({ ...g, assets: items }))} />
          <Field label="Collapse Condition">
            <input value={group.collapseCondition ?? ""} onChange={(e) => onUpdate((g) => ({ ...g, collapseCondition: e.target.value || undefined }))} style={inputStyle} />
          </Field>
        </>
      )}

      {tab === "relations" && (
        <>
          <div style={labelStyle}>Group Relationships</div>
          {(group.groupRelationships ?? []).map((rel, i) => (
            <div key={i} style={{ display: "flex", flexDirection: "column", gap: "0.25rem", marginBottom: "0.5rem", padding: "0.5rem", background: "var(--card)", borderRadius: "var(--radius-xs)" }}>
              <select
                value={rel.targetGroupId}
                onChange={(e) => onUpdate((g) => {
                  const rels = [...(g.groupRelationships ?? [])];
                  rels[i] = { ...rels[i], targetGroupId: e.target.value };
                  return { ...g, groupRelationships: rels };
                })}
                style={selectStyle}
              >
                <option value="">Select group…</option>
                {world.groups.filter((gr) => gr.id !== group.id).map((gr) => (
                  <option key={gr.id} value={gr.id}>{gr.name}</option>
                ))}
              </select>
              <input
                value={rel.attitude}
                placeholder="Attitude (e.g. distrusts)"
                onChange={(e) => onUpdate((g) => {
                  const rels = [...(g.groupRelationships ?? [])];
                  rels[i] = { ...rels[i], attitude: e.target.value };
                  return { ...g, groupRelationships: rels };
                })}
                style={inputStyle}
              />
              <input
                value={rel.context ?? ""}
                placeholder="Context (optional)"
                onChange={(e) => onUpdate((g) => {
                  const rels = [...(g.groupRelationships ?? [])];
                  rels[i] = { ...rels[i], context: e.target.value || undefined };
                  return { ...g, groupRelationships: rels };
                })}
                style={inputStyle}
              />
              <button type="button" onClick={() => onUpdate((g) => ({ ...g, groupRelationships: (g.groupRelationships ?? []).filter((_, j) => j !== i) }))} style={{ border: "none", background: "transparent", color: "var(--danger)", cursor: "pointer", fontSize: "0.8rem", padding: "0.25rem" }}>Remove</button>
            </div>
          ))}
          <button type="button" onClick={() => onUpdate((g) => ({ ...g, groupRelationships: [...(g.groupRelationships ?? []), { targetGroupId: "", attitude: "" }] }))} style={{ border: "none", background: "transparent", color: "var(--accent)", cursor: "pointer", fontSize: "0.8rem", padding: "0.25rem" }}>+ Add Relationship</button>
        </>
      )}
    </div>
  );
}

type RoleTab = "identity" | "authority" | "relations" | "objectives";

const AUTHORITY_OPTIONS = ["military", "economic", "judicial", "religious", "diplomatic", "domestic", "political"] as const;
const DIFFICULTY_OPTIONS = ["beginner", "standard", "advanced", "expert"] as const;
const STANCE_OPTIONS = ["allied", "neutral", "opposed"] as const;

function RolePanel({
  role,
  world,
  onUpdate,
}: {
  role: RoleDefinition;
  world: WorldDefinition;
  onUpdate: (updater: (r: RoleDefinition) => RoleDefinition) => void;
}) {
  const [tab, setTab] = useState<RoleTab>("identity");

  return (
    <div style={bodyStyle}>
      <div style={{ display: "flex", gap: "0.25rem", marginBottom: "0.75rem", flexWrap: "wrap" }}>
        {(["identity", "authority", "relations", "objectives"] as RoleTab[]).map((t) => (
          <TabButton key={t} label={t.charAt(0).toUpperCase() + t.slice(1)} active={tab === t} onClick={() => setTab(t)} />
        ))}
      </div>

      {tab === "identity" && (
        <>
          <Field label="Title">
            <input value={role.title} onChange={(e) => onUpdate((r) => ({ ...r, title: e.target.value }))} style={inputStyle} />
          </Field>
          <Field label="Summary">
            <textarea value={role.summary} onChange={(e) => onUpdate((r) => ({ ...r, summary: e.target.value }))} style={textareaStyle} />
          </Field>
          <Field label="Backstory">
            <textarea value={role.backstory ?? ""} onChange={(e) => onUpdate((r) => ({ ...r, backstory: e.target.value || undefined }))} style={textareaStyle} />
          </Field>
          <Field label="Legitimacy">
            <textarea value={role.legitimacy ?? ""} onChange={(e) => onUpdate((r) => ({ ...r, legitimacy: e.target.value || undefined }))} style={textareaStyle} />
          </Field>
          <Field label="Speaking Style">
            <input value={role.speakingStyle ?? ""} onChange={(e) => onUpdate((r) => ({ ...r, speakingStyle: e.target.value || undefined }))} style={inputStyle} />
          </Field>
          <Field label="Visual Identity">
            <input value={role.visualIdentity ?? ""} onChange={(e) => onUpdate((r) => ({ ...r, visualIdentity: e.target.value || undefined }))} style={inputStyle} />
          </Field>
          <StringListEditor label="Responsibilities" items={role.responsibilities} onChange={(responsibilities) => onUpdate((r) => ({ ...r, responsibilities }))} />
          <StringListEditor label="Tags" items={role.tags ?? []} onChange={(items) => onUpdate((r) => ({ ...r, tags: items }))} />
        </>
      )}

      {tab === "authority" && (
        <>
          <div style={labelStyle}>Authority Domains</div>
          <div style={{ display: "flex", gap: "0.25rem", flexWrap: "wrap", marginBottom: "0.5rem" }}>
            {AUTHORITY_OPTIONS.map((a) => {
              const active = (role.authority ?? []).includes(a);
              return (
                <button
                  key={a}
                  type="button"
                  onClick={() => onUpdate((r) => {
                    const current = r.authority ?? [];
                    return { ...r, authority: active ? current.filter((x) => x !== a) : [...current, a] };
                  })}
                  style={{ border: "none", padding: "0.3rem 0.6rem", borderRadius: "var(--radius-xs)", fontSize: "0.75rem", cursor: "pointer", whiteSpace: "nowrap" as const, background: active ? "rgba(226,165,90,0.15)" : "var(--divider)", color: active ? "#F0F0F0" : "var(--muted)", fontWeight: active ? 600 : 400 }}
                >
                  {a}
                </button>
              );
            })}
          </div>
          <Field label="Difficulty">
            <select
              value={role.difficultyHint ?? ""}
              onChange={(e) => onUpdate((r) => ({ ...r, difficultyHint: (e.target.value || undefined) as RoleDefinition["difficultyHint"] }))}
              style={selectStyle}
            >
              <option value="">None</option>
              {DIFFICULTY_OPTIONS.map((d) => (
                <option key={d} value={d}>{d.charAt(0).toUpperCase() + d.slice(1)}</option>
              ))}
            </select>
          </Field>
          <StringListEditor label="Constraints" items={role.constraints ?? []} onChange={(items) => onUpdate((r) => ({ ...r, constraints: items }))} />
          <div style={labelStyle}>Visible Metrics</div>
          <div style={{ display: "flex", gap: "0.25rem", flexWrap: "wrap", marginBottom: "0.5rem" }}>
            {(world.metrics ?? []).map((m) => {
              const active = (role.visibleMetrics ?? []).includes(m.id);
              return (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => onUpdate((r) => {
                    const current = r.visibleMetrics ?? [];
                    return { ...r, visibleMetrics: active ? current.filter((x) => x !== m.id) : [...current, m.id] };
                  })}
                  style={{ border: "none", padding: "0.3rem 0.6rem", borderRadius: "var(--radius-xs)", fontSize: "0.75rem", cursor: "pointer", whiteSpace: "nowrap" as const, background: active ? "rgba(226,165,90,0.15)" : "var(--divider)", color: active ? "#F0F0F0" : "var(--muted)", fontWeight: active ? 600 : 400 }}
                >
                  {m.label}
                </button>
              );
            })}
          </div>
          <div style={{ fontSize: "0.7rem", color: "var(--muted)" }}>Select which metrics this role can see. Leave empty for all.</div>
        </>
      )}

      {tab === "relations" && (
        <>
          <div style={labelStyle}>Group Alignments</div>
          {(role.groupAlignments ?? []).map((al, i) => (
            <div key={i} style={{ display: "flex", gap: "0.25rem", alignItems: "center", marginBottom: "0.25rem" }}>
              <select
                value={al.groupId}
                onChange={(e) => onUpdate((r) => {
                  const aligns = [...(r.groupAlignments ?? [])];
                  aligns[i] = { ...aligns[i], groupId: e.target.value };
                  return { ...r, groupAlignments: aligns };
                })}
                style={{ ...selectStyle, flex: 1 }}
              >
                <option value="">Select group…</option>
                {world.groups.map((g) => (
                  <option key={g.id} value={g.id}>{g.name}</option>
                ))}
              </select>
              <select
                value={al.stance}
                onChange={(e) => onUpdate((r) => {
                  const aligns = [...(r.groupAlignments ?? [])];
                  aligns[i] = { ...aligns[i], stance: e.target.value as "allied" | "neutral" | "opposed" };
                  return { ...r, groupAlignments: aligns };
                })}
                style={{ ...selectStyle, width: 90, flexShrink: 0 }}
              >
                {STANCE_OPTIONS.map((s) => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
              <button type="button" onClick={() => onUpdate((r) => ({ ...r, groupAlignments: (r.groupAlignments ?? []).filter((_, j) => j !== i) }))} style={{ border: "none", background: "transparent", color: "var(--danger)", cursor: "pointer", fontSize: "0.8rem", padding: "0.25rem" }}>×</button>
            </div>
          ))}
          <button type="button" onClick={() => onUpdate((r) => ({ ...r, groupAlignments: [...(r.groupAlignments ?? []), { groupId: "", stance: "neutral" as const }] }))} style={{ border: "none", background: "transparent", color: "var(--accent)", cursor: "pointer", fontSize: "0.8rem", padding: "0.25rem" }}>+ Add alignment</button>

          <div style={{ ...labelStyle, marginTop: "0.75rem" }}>Inner Circle</div>
          {world.characters.map((c) => {
            const active = (role.innerCircle ?? []).includes(c.id);
            return (
              <div key={c.id} style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginBottom: "0.25rem" }}>
                <input
                  type="checkbox"
                  checked={active}
                  onChange={() => onUpdate((r) => {
                    const current = r.innerCircle ?? [];
                    return { ...r, innerCircle: active ? current.filter((x) => x !== c.id) : [...current, c.id] };
                  })}
                />
                <span style={{ fontSize: "0.8rem" }}>{c.name}</span>
                <span style={{ fontSize: "0.7rem", color: "var(--muted)" }}>{c.title}</span>
              </div>
            );
          })}

          <StringListEditor label="Vulnerabilities" items={role.vulnerabilities ?? []} onChange={(items) => onUpdate((r) => ({ ...r, vulnerabilities: items }))} />
        </>
      )}

      {tab === "objectives" && (
        <>
          <StringListEditor label="Goals" items={role.goals ?? []} onChange={(items) => onUpdate((r) => ({ ...r, goals: items }))} />
          <Field label="Onboarding Narration">
            <textarea value={role.onboardingNarration ?? ""} onChange={(e) => onUpdate((r) => ({ ...r, onboardingNarration: e.target.value || undefined }))} style={{ ...textareaStyle, minHeight: "5rem" }} />
          </Field>
          <Field label="Success Condition">
            <textarea value={role.successCondition ?? ""} onChange={(e) => onUpdate((r) => ({ ...r, successCondition: e.target.value || undefined }))} style={textareaStyle} />
          </Field>
          <Field label="Failure Condition">
            <textarea value={role.failureCondition ?? ""} onChange={(e) => onUpdate((r) => ({ ...r, failureCondition: e.target.value || undefined }))} style={textareaStyle} />
          </Field>
        </>
      )}
    </div>
  );
}

const TONE_OPTIONS = ["tense", "somber", "urgent", "celebratory", "conspiratorial", "intimate"] as const;
const GROUP_METRIC_OPTIONS = ["influence", "cohesion", "volatility"] as const;
const METRIC_DIRECTION_OPTIONS = ["increase", "decrease"] as const;
const METRIC_MAGNITUDE_OPTIONS = ["small", "medium", "large"] as const;

type EventTab = "core" | "triggers" | "context" | "outcomes";

function EventPanel({
  event,
  world,
  onUpdate,
}: {
  event: EventTemplate;
  world: WorldDefinition;
  onUpdate: (updater: (e: EventTemplate) => EventTemplate) => void;
}) {
  const [tab, setTab] = useState<EventTab>("core");

  return (
    <>
      <div style={tabBarStyle}>
        <TabButton active={tab === "core"} label="Core" onClick={() => setTab("core")} />
        <TabButton active={tab === "triggers"} label="Triggers" onClick={() => setTab("triggers")} />
        <TabButton active={tab === "context"} label="Context" onClick={() => setTab("context")} />
        <TabButton active={tab === "outcomes"} label="Outcomes" onClick={() => setTab("outcomes")} />
      </div>
      <div style={bodyStyle}>
        {tab === "core" && (
          <>
            <Field label="Title">
              <input
                value={event.title}
                onChange={(e) => onUpdate((ev) => ({ ...ev, title: e.target.value }))}
                style={inputStyle}
              />
            </Field>
            <Field label="Category">
              <select
                value={event.category}
                onChange={(e) => onUpdate((ev) => ({ ...ev, category: e.target.value }))}
                style={selectStyle}
              >
                {(world.eventCategories ?? [
                  { id: "politics", label: "Politics" },
                  { id: "economy", label: "Economy" },
                  { id: "military", label: "Military" },
                  { id: "morality", label: "Morality" },
                  { id: "personal", label: "Personal" },
                ]).map((cat) => (
                  <option key={cat.id} value={cat.id}>{cat.label}</option>
                ))}
              </select>
            </Field>
            <Field label="Summary">
              <textarea
                value={event.summary}
                onChange={(e) => onUpdate((ev) => ({ ...ev, summary: e.target.value }))}
                style={textareaStyle}
              />
            </Field>
            <RangeField
              label="Urgency"
              value={event.urgency}
              onChange={(v) => onUpdate((ev) => ({ ...ev, urgency: v }))}
            />
            <Field label="Narrator Prompt">
              <textarea
                value={event.narratorPrompt}
                onChange={(e) => onUpdate((ev) => ({ ...ev, narratorPrompt: e.target.value }))}
                style={{ ...textareaStyle, minHeight: "5rem" }}
              />
            </Field>
            <StringListEditor
              label="Stakes"
              items={event.stakes}
              onChange={(stakes) => onUpdate((ev) => ({ ...ev, stakes }))}
            />
            {/* Actor selection */}
            <div style={{ borderTop: "1px solid var(--border)", paddingTop: "0.75rem" }}>
              <div style={labelStyle}>Actors</div>
              <div style={{ display: "flex", flexDirection: "column", gap: "0.375rem", marginTop: "0.375rem" }}>
                {world.characters.map((char) => {
                  const isActor = event.actorIds.includes(char.id);
                  return (
                    <label
                      key={char.id}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: "0.5rem",
                        fontSize: "0.8125rem",
                        cursor: "pointer",
                        padding: "0.25rem 0",
                      }}
                    >
                      <input
                        type="checkbox"
                        checked={isActor}
                        onChange={() =>
                          onUpdate((ev) => ({
                            ...ev,
                            actorIds: isActor
                              ? ev.actorIds.filter((id) => id !== char.id)
                              : [...ev.actorIds, char.id],
                          }))
                        }
                        style={{ accentColor: "var(--accent)" }}
                      />
                      {char.name}
                      <span style={{ color: "var(--muted)", fontSize: "0.7rem" }}>{char.title}</span>
                    </label>
                  );
                })}
              </div>
            </div>
            <StringListEditor
              label="Tags"
              items={event.tags ?? []}
              onChange={(tags) => onUpdate((ev) => ({ ...ev, tags }))}
            />
          </>
        )}

        {tab === "triggers" && (
          <>
            {/* Metric trigger conditions */}
            <div>
              <div style={{ ...labelStyle, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span>Metric Conditions</span>
                <button
                  type="button"
                  onClick={() =>
                    onUpdate((ev) => ({
                      ...ev,
                      triggerConditions: [
                        ...(ev.triggerConditions ?? []),
                        { metricId: world.metrics?.[0]?.id ?? "stability", condition: "below" as const, threshold: 50 },
                      ],
                    }))
                  }
                  style={{ border: "none", background: "transparent", color: "var(--accent)", cursor: "pointer", fontSize: "0.75rem", fontWeight: 600 }}
                >
                  + Add
                </button>
              </div>
              {(event.triggerConditions ?? []).map((tc, i) => (
                <div key={i} style={{ display: "flex", gap: "0.375rem", alignItems: "center", marginTop: "0.375rem" }}>
                  <select
                    value={tc.metricId}
                    onChange={(e) =>
                      onUpdate((ev) => ({
                        ...ev,
                        triggerConditions: (ev.triggerConditions ?? []).map((c, j) =>
                          j === i ? { ...c, metricId: e.target.value } : c,
                        ),
                      }))
                    }
                    style={{ ...selectStyle, flex: 1 }}
                  >
                    {(world.metrics ?? []).map((m) => (
                      <option key={m.id} value={m.id}>{m.label}</option>
                    ))}
                  </select>
                  <select
                    value={tc.condition}
                    onChange={(e) =>
                      onUpdate((ev) => ({
                        ...ev,
                        triggerConditions: (ev.triggerConditions ?? []).map((c, j) =>
                          j === i ? { ...c, condition: e.target.value as "above" | "below" } : c,
                        ),
                      }))
                    }
                    style={{ ...selectStyle, width: "5rem", flex: "none" }}
                  >
                    <option value="above">Above</option>
                    <option value="below">Below</option>
                  </select>
                  <input
                    type="number" min={0} max={100} value={tc.threshold}
                    onChange={(e) =>
                      onUpdate((ev) => ({
                        ...ev,
                        triggerConditions: (ev.triggerConditions ?? []).map((c, j) =>
                          j === i ? { ...c, threshold: Number(e.target.value) } : c,
                        ),
                      }))
                    }
                    style={{ ...inputStyle, width: "3.5rem", flex: "none" }}
                  />
                  <button
                    type="button"
                    onClick={() => onUpdate((ev) => ({ ...ev, triggerConditions: (ev.triggerConditions ?? []).filter((_, j) => j !== i) }))}
                    style={{ border: "1px solid var(--border)", background: "transparent", color: "var(--danger)", cursor: "pointer", borderRadius: "var(--radius-sm)", padding: "0 0.5rem", fontSize: "0.75rem", flex: "none" }}
                  >
                    &times;
                  </button>
                </div>
              ))}
            </div>

            {/* Group conditions */}
            <div style={{ borderTop: "1px solid var(--border)", paddingTop: "0.75rem" }}>
              <div style={{ ...labelStyle, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span>Group Conditions</span>
                <button
                  type="button"
                  onClick={() =>
                    onUpdate((ev) => ({
                      ...ev,
                      groupConditions: [
                        ...(ev.groupConditions ?? []),
                        { groupId: world.groups[0]?.id ?? "", metric: "influence" as const, condition: "below" as const, threshold: 50 },
                      ],
                    }))
                  }
                  style={{ border: "none", background: "transparent", color: "var(--accent)", cursor: "pointer", fontSize: "0.75rem", fontWeight: 600 }}
                >
                  + Add
                </button>
              </div>
              {(event.groupConditions ?? []).map((gc, i) => (
                <div key={i} style={{ display: "flex", gap: "0.375rem", alignItems: "center", marginTop: "0.375rem" }}>
                  <select
                    value={gc.groupId}
                    onChange={(e) =>
                      onUpdate((ev) => ({
                        ...ev,
                        groupConditions: (ev.groupConditions ?? []).map((c, j) =>
                          j === i ? { ...c, groupId: e.target.value } : c,
                        ),
                      }))
                    }
                    style={{ ...selectStyle, flex: 1 }}
                  >
                    {world.groups.map((g) => (
                      <option key={g.id} value={g.id}>{g.name}</option>
                    ))}
                  </select>
                  <select
                    value={gc.metric}
                    onChange={(e) =>
                      onUpdate((ev) => ({
                        ...ev,
                        groupConditions: (ev.groupConditions ?? []).map((c, j) =>
                          j === i ? { ...c, metric: e.target.value as "influence" | "cohesion" | "volatility" } : c,
                        ),
                      }))
                    }
                    style={{ ...selectStyle, width: "5.5rem", flex: "none" }}
                  >
                    {GROUP_METRIC_OPTIONS.map((m) => (
                      <option key={m} value={m}>{m}</option>
                    ))}
                  </select>
                  <select
                    value={gc.condition}
                    onChange={(e) =>
                      onUpdate((ev) => ({
                        ...ev,
                        groupConditions: (ev.groupConditions ?? []).map((c, j) =>
                          j === i ? { ...c, condition: e.target.value as "above" | "below" } : c,
                        ),
                      }))
                    }
                    style={{ ...selectStyle, width: "4.5rem", flex: "none" }}
                  >
                    <option value="above">Above</option>
                    <option value="below">Below</option>
                  </select>
                  <input
                    type="number" min={0} max={100} value={gc.threshold}
                    onChange={(e) =>
                      onUpdate((ev) => ({
                        ...ev,
                        groupConditions: (ev.groupConditions ?? []).map((c, j) =>
                          j === i ? { ...c, threshold: Number(e.target.value) } : c,
                        ),
                      }))
                    }
                    style={{ ...inputStyle, width: "3.5rem", flex: "none" }}
                  />
                  <button
                    type="button"
                    onClick={() => onUpdate((ev) => ({ ...ev, groupConditions: (ev.groupConditions ?? []).filter((_, j) => j !== i) }))}
                    style={{ border: "1px solid var(--border)", background: "transparent", color: "var(--danger)", cursor: "pointer", borderRadius: "var(--radius-sm)", padding: "0 0.5rem", fontSize: "0.75rem", flex: "none" }}
                  >
                    &times;
                  </button>
                </div>
              ))}
            </div>

            {/* Turn range */}
            <div style={{ borderTop: "1px solid var(--border)", paddingTop: "0.75rem", display: "flex", gap: "0.75rem" }}>
              <Field label="Min Turn">
                <input
                  type="number" min={0}
                  value={event.turnRange?.min ?? ""}
                  onChange={(e) => {
                    const v = e.target.value === "" ? undefined : Number(e.target.value);
                    onUpdate((ev) => ({
                      ...ev,
                      turnRange: v !== undefined ? { min: v, max: ev.turnRange?.max ?? 999 } : undefined,
                    }));
                  }}
                  style={inputStyle}
                  placeholder="0"
                />
              </Field>
              <Field label="Max Turn">
                <input
                  type="number" min={0}
                  value={event.turnRange?.max ?? ""}
                  onChange={(e) => {
                    const v = e.target.value === "" ? undefined : Number(e.target.value);
                    onUpdate((ev) => ({
                      ...ev,
                      turnRange: v !== undefined ? { min: ev.turnRange?.min ?? 0, max: v } : undefined,
                    }));
                  }}
                  style={inputStyle}
                  placeholder="999"
                />
              </Field>
            </div>

            {/* Prerequisites */}
            <div style={{ borderTop: "1px solid var(--border)", paddingTop: "0.75rem" }}>
              <div style={{ ...labelStyle, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span>Prerequisite Events</span>
                <button
                  type="button"
                  onClick={() => {
                    const available = world.eventTemplates.filter((e) => e.id !== event.id && !(event.prerequisiteEventIds ?? []).includes(e.id));
                    if (available.length === 0) return;
                    onUpdate((ev) => ({ ...ev, prerequisiteEventIds: [...(ev.prerequisiteEventIds ?? []), available[0].id] }));
                  }}
                  style={{ border: "none", background: "transparent", color: "var(--accent)", cursor: "pointer", fontSize: "0.75rem", fontWeight: 600 }}
                >
                  + Add
                </button>
              </div>
              {(event.prerequisiteEventIds ?? []).map((pid, i) => {
                const prereqEvent = world.eventTemplates.find((e) => e.id === pid);
                return (
                  <div key={i} style={{ display: "flex", gap: "0.375rem", alignItems: "center", marginTop: "0.375rem" }}>
                    <select
                      value={pid}
                      onChange={(e) =>
                        onUpdate((ev) => ({
                          ...ev,
                          prerequisiteEventIds: (ev.prerequisiteEventIds ?? []).map((id, j) => j === i ? e.target.value : id),
                        }))
                      }
                      style={{ ...selectStyle, flex: 1 }}
                    >
                      {world.eventTemplates.filter((e) => e.id !== event.id).map((e) => (
                        <option key={e.id} value={e.id}>{e.title}</option>
                      ))}
                    </select>
                    <button
                      type="button"
                      onClick={() => onUpdate((ev) => ({ ...ev, prerequisiteEventIds: (ev.prerequisiteEventIds ?? []).filter((_, j) => j !== i) }))}
                      style={{ border: "1px solid var(--border)", background: "transparent", color: "var(--danger)", cursor: "pointer", borderRadius: "var(--radius-sm)", padding: "0 0.5rem", fontSize: "0.75rem", flex: "none" }}
                    >
                      &times;
                    </button>
                  </div>
                );
              })}
            </div>

            {/* Temporal controls */}
            <div style={{ borderTop: "1px solid var(--border)", paddingTop: "0.75rem", display: "flex", gap: "0.5rem" }}>
              <Field label="Cooldown">
                <input
                  type="number" min={0}
                  value={event.cooldownTurns ?? ""}
                  onChange={(e) => onUpdate((ev) => ({ ...ev, cooldownTurns: e.target.value === "" ? undefined : Number(e.target.value) }))}
                  style={inputStyle}
                  placeholder="—"
                />
              </Field>
              <Field label="Max Occurs">
                <input
                  type="number" min={1}
                  value={event.maxOccurrences ?? ""}
                  onChange={(e) => onUpdate((ev) => ({ ...ev, maxOccurrences: e.target.value === "" ? undefined : Number(e.target.value) }))}
                  style={inputStyle}
                  placeholder="—"
                />
              </Field>
              <Field label="Expires">
                <input
                  type="number" min={1}
                  value={event.expiresAfterTurns ?? ""}
                  onChange={(e) => onUpdate((ev) => ({ ...ev, expiresAfterTurns: e.target.value === "" ? undefined : Number(e.target.value) }))}
                  style={inputStyle}
                  placeholder="—"
                />
              </Field>
            </div>

            {/* Mutual exclusion */}
            <div style={{ borderTop: "1px solid var(--border)", paddingTop: "0.75rem" }}>
              <div style={{ ...labelStyle, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span>Mutually Exclusive With</span>
                <button
                  type="button"
                  onClick={() => {
                    const available = world.eventTemplates.filter((e) => e.id !== event.id && !(event.mutuallyExclusiveWith ?? []).includes(e.id));
                    if (available.length === 0) return;
                    onUpdate((ev) => ({ ...ev, mutuallyExclusiveWith: [...(ev.mutuallyExclusiveWith ?? []), available[0].id] }));
                  }}
                  style={{ border: "none", background: "transparent", color: "var(--accent)", cursor: "pointer", fontSize: "0.75rem", fontWeight: 600 }}
                >
                  + Add
                </button>
              </div>
              {(event.mutuallyExclusiveWith ?? []).map((eid, i) => (
                <div key={i} style={{ display: "flex", gap: "0.375rem", alignItems: "center", marginTop: "0.375rem" }}>
                  <select
                    value={eid}
                    onChange={(e) =>
                      onUpdate((ev) => ({
                        ...ev,
                        mutuallyExclusiveWith: (ev.mutuallyExclusiveWith ?? []).map((id, j) => j === i ? e.target.value : id),
                      }))
                    }
                    style={{ ...selectStyle, flex: 1 }}
                  >
                    {world.eventTemplates.filter((e) => e.id !== event.id).map((e) => (
                      <option key={e.id} value={e.id}>{e.title}</option>
                    ))}
                  </select>
                  <button
                    type="button"
                    onClick={() => onUpdate((ev) => ({ ...ev, mutuallyExclusiveWith: (ev.mutuallyExclusiveWith ?? []).filter((_, j) => j !== i) }))}
                    style={{ border: "1px solid var(--border)", background: "transparent", color: "var(--danger)", cursor: "pointer", borderRadius: "var(--radius-sm)", padding: "0 0.5rem", fontSize: "0.75rem", flex: "none" }}
                  >
                    &times;
                  </button>
                </div>
              ))}
            </div>

            {/* Weight */}
            <RangeField
              label="Weight"
              value={Math.round((event.weight ?? 1) * 20)}
              onChange={(v) => onUpdate((ev) => ({ ...ev, weight: Math.max(0, v / 20) }))}
            />
            <p style={{ fontSize: "0.7rem", color: "var(--muted)", marginTop: "-0.5rem" }}>
              Higher weight = more likely to be selected (current: {event.weight ?? 1})
            </p>
          </>
        )}

        {tab === "context" && (
          <>
            <Field label="Tone">
              <div style={{ display: "flex", flexWrap: "wrap", gap: "0.375rem" }}>
                {TONE_OPTIONS.map((t) => (
                  <button
                    key={t}
                    type="button"
                    onClick={() => onUpdate((ev) => ({ ...ev, tone: ev.tone === t ? undefined : t }))}
                    style={{
                      padding: "0.3rem 0.6rem",
                      borderRadius: "var(--radius-3xl)",
                      border: "none",
                      fontSize: "0.75rem",
                      fontWeight: event.tone === t ? 600 : 400,
                      background: event.tone === t ? "var(--accent)" : "var(--bg-elevated)",
                      color: event.tone === t ? "#fff" : "var(--muted)",
                      cursor: "pointer",
                    }}
                  >
                    {t}
                  </button>
                ))}
              </div>
            </Field>
            <Field label="Location">
              <input
                value={event.location ?? ""}
                onChange={(e) => onUpdate((ev) => ({ ...ev, location: e.target.value || undefined }))}
                style={inputStyle}
                placeholder="e.g. The rain-soaked throne room"
              />
            </Field>
            <Field label="Backstory">
              <textarea
                value={event.backstory ?? ""}
                onChange={(e) => onUpdate((ev) => ({ ...ev, backstory: e.target.value || undefined }))}
                style={textareaStyle}
                placeholder="Context that shaped this event..."
              />
            </Field>

            {/* Involved groups */}
            <div style={{ borderTop: "1px solid var(--border)", paddingTop: "0.75rem" }}>
              <div style={labelStyle}>Involved Groups</div>
              <div style={{ display: "flex", flexDirection: "column", gap: "0.375rem", marginTop: "0.375rem" }}>
                {world.groups.map((group) => {
                  const isInvolved = (event.involvedGroupIds ?? []).includes(group.id);
                  return (
                    <label
                      key={group.id}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: "0.5rem",
                        fontSize: "0.8125rem",
                        cursor: "pointer",
                        padding: "0.25rem 0",
                      }}
                    >
                      <input
                        type="checkbox"
                        checked={isInvolved}
                        onChange={() =>
                          onUpdate((ev) => ({
                            ...ev,
                            involvedGroupIds: isInvolved
                              ? (ev.involvedGroupIds ?? []).filter((id) => id !== group.id)
                              : [...(ev.involvedGroupIds ?? []), group.id],
                          }))
                        }
                        style={{ accentColor: "#6FBF88" }}
                      />
                      {group.name}
                    </label>
                  );
                })}
              </div>
            </div>

            <StringListEditor
              label="Suggested Approaches"
              items={event.suggestedApproaches ?? []}
              onChange={(approaches) => onUpdate((ev) => ({ ...ev, suggestedApproaches: approaches.length ? approaches : undefined }))}
            />
          </>
        )}

        {tab === "outcomes" && (
          <>
            {/* Metric hints */}
            <div>
              <div style={{ ...labelStyle, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span>Metric Hints</span>
                <button
                  type="button"
                  onClick={() =>
                    onUpdate((ev) => ({
                      ...ev,
                      metricHints: [
                        ...(ev.metricHints ?? []),
                        { metricId: world.metrics?.[0]?.id ?? "stability", direction: "decrease" as const, magnitude: "medium" as const },
                      ],
                    }))
                  }
                  style={{ border: "none", background: "transparent", color: "var(--accent)", cursor: "pointer", fontSize: "0.75rem", fontWeight: 600 }}
                >
                  + Add
                </button>
              </div>
              <p style={{ fontSize: "0.7rem", color: "var(--muted)", marginBottom: "0.375rem" }}>
                Guides the LLM on expected metric shifts
              </p>
              {(event.metricHints ?? []).map((mh, i) => (
                <div key={i} style={{ display: "flex", gap: "0.375rem", alignItems: "center", marginTop: "0.375rem" }}>
                  <select
                    value={mh.metricId}
                    onChange={(e) =>
                      onUpdate((ev) => ({
                        ...ev,
                        metricHints: (ev.metricHints ?? []).map((h, j) =>
                          j === i ? { ...h, metricId: e.target.value } : h,
                        ),
                      }))
                    }
                    style={{ ...selectStyle, flex: 1 }}
                  >
                    {(world.metrics ?? []).map((m) => (
                      <option key={m.id} value={m.id}>{m.label}</option>
                    ))}
                  </select>
                  <select
                    value={mh.direction}
                    onChange={(e) =>
                      onUpdate((ev) => ({
                        ...ev,
                        metricHints: (ev.metricHints ?? []).map((h, j) =>
                          j === i ? { ...h, direction: e.target.value as "increase" | "decrease" } : h,
                        ),
                      }))
                    }
                    style={{ ...selectStyle, width: "5.5rem", flex: "none" }}
                  >
                    {METRIC_DIRECTION_OPTIONS.map((d) => (
                      <option key={d} value={d}>{d}</option>
                    ))}
                  </select>
                  <select
                    value={mh.magnitude}
                    onChange={(e) =>
                      onUpdate((ev) => ({
                        ...ev,
                        metricHints: (ev.metricHints ?? []).map((h, j) =>
                          j === i ? { ...h, magnitude: e.target.value as "small" | "medium" | "large" } : h,
                        ),
                      }))
                    }
                    style={{ ...selectStyle, width: "5rem", flex: "none" }}
                  >
                    {METRIC_MAGNITUDE_OPTIONS.map((m) => (
                      <option key={m} value={m}>{m}</option>
                    ))}
                  </select>
                  <button
                    type="button"
                    onClick={() => onUpdate((ev) => ({ ...ev, metricHints: (ev.metricHints ?? []).filter((_, j) => j !== i) }))}
                    style={{ border: "1px solid var(--border)", background: "transparent", color: "var(--danger)", cursor: "pointer", borderRadius: "var(--radius-sm)", padding: "0 0.5rem", fontSize: "0.75rem", flex: "none" }}
                  >
                    &times;
                  </button>
                </div>
              ))}
            </div>

            {/* Escalation event */}
            <div style={{ borderTop: "1px solid var(--border)", paddingTop: "0.75rem" }}>
              <Field label="Escalation Event">
                <select
                  value={event.escalationEventId ?? ""}
                  onChange={(e) => onUpdate((ev) => ({ ...ev, escalationEventId: e.target.value || undefined }))}
                  style={selectStyle}
                >
                  <option value="">None</option>
                  {world.eventTemplates.filter((e) => e.id !== event.id).map((e) => (
                    <option key={e.id} value={e.id}>{e.title}</option>
                  ))}
                </select>
              </Field>
            </div>

            {/* Resolution narration */}
            <Field label="Resolution Narration">
              <textarea
                value={event.resolutionNarration ?? ""}
                onChange={(e) => onUpdate((ev) => ({ ...ev, resolutionNarration: e.target.value || undefined }))}
                style={textareaStyle}
                placeholder="Describe how this event wraps up..."
              />
            </Field>
          </>
        )}
      </div>
    </>
  );
}

function RelationshipPanel({
  rel,
  world,
  onUpdate,
}: {
  rel: RelationshipDefinition;
  world: WorldDefinition;
  onUpdate: (updater: (r: RelationshipDefinition) => RelationshipDefinition) => void;
}) {
  return (
    <div style={bodyStyle}>
      {/* Participants */}
      <Field label="Source Character">
        <select
          value={rel.sourceCharacterId}
          onChange={(e) => onUpdate((r) => ({ ...r, sourceCharacterId: e.target.value }))}
          style={selectStyle}
        >
          {world.characters.map((c) => (
            <option key={c.id} value={c.id}>{c.name} — {c.title}</option>
          ))}
          {world.roles.map((r) => (
            <option key={r.id} value={r.id}>{r.title} (role)</option>
          ))}
        </select>
      </Field>
      <Field label="Target Character">
        <select
          value={rel.targetCharacterId}
          onChange={(e) => onUpdate((r) => ({ ...r, targetCharacterId: e.target.value }))}
          style={selectStyle}
        >
          {world.characters.map((c) => (
            <option key={c.id} value={c.id}>{c.name} — {c.title}</option>
          ))}
        </select>
      </Field>

      {/* Metrics */}
      <div style={{ borderTop: "1px solid var(--border)", paddingTop: "0.75rem" }}>
        <div style={labelStyle}>Relationship Metrics</div>
        <RangeField
          label="Trust"
          value={rel.metrics.trust}
          onChange={(v) => onUpdate((r) => ({ ...r, metrics: { ...r.metrics, trust: v } }))}
        />
        <RangeField
          label="Fear"
          value={rel.metrics.fear}
          onChange={(v) => onUpdate((r) => ({ ...r, metrics: { ...r.metrics, fear: v } }))}
        />
        <RangeField
          label="Loyalty"
          value={rel.metrics.loyalty}
          onChange={(v) => onUpdate((r) => ({ ...r, metrics: { ...r.metrics, loyalty: v } }))}
        />
        <RangeField
          label="Respect"
          value={rel.metrics.respect}
          onChange={(v) => onUpdate((r) => ({ ...r, metrics: { ...r.metrics, respect: v } }))}
        />
      </div>

      {/* Dynamics */}
      <div style={{ borderTop: "1px solid var(--border)", paddingTop: "0.75rem" }}>
        <div style={labelStyle}>Dynamics</div>
        <Field label="Tone">
          <input
            value={rel.tone ?? ""}
            onChange={(e) => onUpdate((r) => ({ ...r, tone: e.target.value || undefined }))}
            style={inputStyle}
            placeholder="e.g. formal-advisory, courtly-adversarial"
          />
        </Field>
        <StringListEditor
          label="Stance"
          items={rel.stance ?? []}
          onChange={(stance) => onUpdate((r) => ({ ...r, stance }))}
        />
      </div>

      {/* Memory */}
      <div style={{ borderTop: "1px solid var(--border)", paddingTop: "0.75rem" }}>
        <StringListEditor
          label="Recent Memory"
          items={rel.recentMemory}
          onChange={(recentMemory) => onUpdate((r) => ({ ...r, recentMemory }))}
        />
      </div>
    </div>
  );
}

function WorldCorePanel({
  world,
  onUpdate,
}: {
  world: WorldDefinition;
  onUpdate: (updater: (w: WorldDefinition) => WorldDefinition) => void;
}) {
  const [tab, setTab] = useState<WorldTab>("core");

  return (
    <>
      <div style={tabBarStyle}>
        <TabButton active={tab === "core"} label="Core" onClick={() => setTab("core")} />
        <TabButton active={tab === "narrator"} label="Narrator" onClick={() => setTab("narrator")} />
        <TabButton active={tab === "metrics"} label="Metrics" onClick={() => setTab("metrics")} />
        <TabButton active={tab === "categories"} label="Categories" onClick={() => setTab("categories")} />
        <TabButton active={tab === "norms"} label="Norms" onClick={() => setTab("norms")} />
        <TabButton active={tab === "difficulty"} label="Difficulty" onClick={() => setTab("difficulty")} />
        <TabButton active={tab === "safety"} label="Safety" onClick={() => setTab("safety")} />
      </div>
      <div style={bodyStyle}>
        {tab === "core" && (
          <>
            <Field label="Title">
              <input
                value={world.title}
                onChange={(e) => onUpdate((w) => ({ ...w, title: e.target.value }))}
                style={inputStyle}
              />
            </Field>
            <Field label="Setting">
              <textarea
                value={world.setting}
                onChange={(e) => onUpdate((w) => ({ ...w, setting: e.target.value }))}
                style={textareaStyle}
              />
            </Field>
            <Field label="Premise">
              <textarea
                value={world.premise}
                onChange={(e) => onUpdate((w) => ({ ...w, premise: e.target.value }))}
                style={textareaStyle}
              />
            </Field>
            <Field label="Intro Narration">
              <textarea
                value={world.introNarration}
                onChange={(e) => onUpdate((w) => ({ ...w, introNarration: e.target.value }))}
                style={{ ...textareaStyle, minHeight: "6rem" }}
              />
            </Field>
          </>
        )}

        {tab === "norms" && (
          <>
            <StringListEditor
              label="Norms"
              items={world.norms}
              onChange={(norms) => onUpdate((w) => ({ ...w, norms }))}
            />
            <StringListEditor
              label="Power Structures"
              items={world.powerStructures}
              onChange={(powerStructures) => onUpdate((w) => ({ ...w, powerStructures }))}
            />
            <StringListEditor
              label="Tonal Constraints"
              items={world.tonalConstraints}
              onChange={(tonalConstraints) => onUpdate((w) => ({ ...w, tonalConstraints }))}
            />
          </>
        )}

        {tab === "narrator" && (
          <>
            <Field label="Perspective">
              <select
                value={world.narratorConfig?.perspective ?? "second"}
                onChange={(e) =>
                  onUpdate((w) => ({
                    ...w,
                    narratorConfig: {
                      perspective: e.target.value as "first" | "second" | "third" | "omniscient",
                      tense: w.narratorConfig?.tense ?? "present",
                      style: w.narratorConfig?.style ?? "",
                    },
                  }))
                }
                style={selectStyle}
              >
                <option value="first">First Person</option>
                <option value="second">Second Person</option>
                <option value="third">Third Person</option>
                <option value="omniscient">Omniscient</option>
              </select>
            </Field>
            <Field label="Tense">
              <select
                value={world.narratorConfig?.tense ?? "present"}
                onChange={(e) =>
                  onUpdate((w) => ({
                    ...w,
                    narratorConfig: {
                      perspective: w.narratorConfig?.perspective ?? "second",
                      tense: e.target.value as "present" | "past",
                      style: w.narratorConfig?.style ?? "",
                    },
                  }))
                }
                style={selectStyle}
              >
                <option value="present">Present</option>
                <option value="past">Past</option>
              </select>
            </Field>
            <Field label="Style">
              <textarea
                value={world.narratorConfig?.style ?? ""}
                onChange={(e) =>
                  onUpdate((w) => ({
                    ...w,
                    narratorConfig: {
                      perspective: w.narratorConfig?.perspective ?? "second",
                      tense: w.narratorConfig?.tense ?? "present",
                      style: e.target.value,
                    },
                  }))
                }
                style={textareaStyle}
                placeholder="e.g. immediate, severe, intimate"
              />
            </Field>
          </>
        )}

        {tab === "metrics" && (
          <>
            <div style={{ ...labelStyle, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span>Metric Definitions</span>
              <button
                type="button"
                onClick={() =>
                  onUpdate((w) => ({
                    ...w,
                    metrics: [
                      ...(w.metrics ?? []),
                      { id: `metric-${Date.now()}`, label: "New Metric", initialValue: 50, direction: "higher-better" as const },
                    ],
                  }))
                }
                style={{
                  border: "none",
                  background: "transparent",
                  color: "var(--accent)",
                  cursor: "pointer",
                  fontSize: "0.75rem",
                  fontWeight: 600,
                }}
              >
                + Add
              </button>
            </div>
            {(world.metrics ?? []).map((metric, i) => (
              <div
                key={metric.id}
                style={{
                  padding: "0.75rem",
                  borderRadius: "var(--radius-md)",
                  border: "1px solid var(--border)",
                  background: "var(--background)",
                  display: "flex",
                  flexDirection: "column",
                  gap: "0.5rem",
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <span style={{ fontSize: "0.75rem", fontWeight: 600 }}>{metric.label}</span>
                  <button
                    type="button"
                    onClick={() =>
                      onUpdate((w) => ({
                        ...w,
                        metrics: (w.metrics ?? []).filter((_, j) => j !== i),
                      }))
                    }
                    style={{
                      border: "1px solid var(--border)",
                      background: "transparent",
                      color: "var(--danger)",
                      cursor: "pointer",
                      borderRadius: "var(--radius-sm)",
                      padding: "0 0.5rem",
                      fontSize: "0.75rem",
                    }}
                  >
                    &times;
                  </button>
                </div>
                <Field label="ID">
                  <input
                    value={metric.id}
                    onChange={(e) =>
                      onUpdate((w) => ({
                        ...w,
                        metrics: (w.metrics ?? []).map((m, j) => (j === i ? { ...m, id: e.target.value } : m)),
                      }))
                    }
                    style={inputStyle}
                  />
                </Field>
                <Field label="Label">
                  <input
                    value={metric.label}
                    onChange={(e) =>
                      onUpdate((w) => ({
                        ...w,
                        metrics: (w.metrics ?? []).map((m, j) => (j === i ? { ...m, label: e.target.value } : m)),
                      }))
                    }
                    style={inputStyle}
                  />
                </Field>
                <Field label="Description">
                  <input
                    value={metric.description ?? ""}
                    onChange={(e) =>
                      onUpdate((w) => ({
                        ...w,
                        metrics: (w.metrics ?? []).map((m, j) => (j === i ? { ...m, description: e.target.value || undefined } : m)),
                      }))
                    }
                    style={inputStyle}
                    placeholder="Optional"
                  />
                </Field>
                <RangeField
                  label="Initial Value"
                  value={metric.initialValue}
                  onChange={(v) =>
                    onUpdate((w) => ({
                      ...w,
                      metrics: (w.metrics ?? []).map((m, j) => (j === i ? { ...m, initialValue: v } : m)),
                    }))
                  }
                />
                <Field label="Direction">
                  <select
                    value={metric.direction}
                    onChange={(e) =>
                      onUpdate((w) => ({
                        ...w,
                        metrics: (w.metrics ?? []).map((m, j) =>
                          j === i ? { ...m, direction: e.target.value as "higher-better" | "lower-better" } : m,
                        ),
                      }))
                    }
                    style={selectStyle}
                  >
                    <option value="higher-better">Higher is better</option>
                    <option value="lower-better">Lower is better</option>
                  </select>
                </Field>
              </div>
            ))}
          </>
        )}

        {tab === "categories" && (
          <>
            <div style={{ ...labelStyle, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span>Event Categories</span>
              <button
                type="button"
                onClick={() =>
                  onUpdate((w) => ({
                    ...w,
                    eventCategories: [
                      ...(w.eventCategories ?? []),
                      { id: `cat-${Date.now()}`, label: "New Category" },
                    ],
                  }))
                }
                style={{
                  border: "none",
                  background: "transparent",
                  color: "var(--accent)",
                  cursor: "pointer",
                  fontSize: "0.75rem",
                  fontWeight: 600,
                }}
              >
                + Add
              </button>
            </div>
            {(world.eventCategories ?? []).map((cat, i) => (
              <div
                key={cat.id}
                style={{
                  padding: "0.75rem",
                  borderRadius: "var(--radius-md)",
                  border: "1px solid var(--border)",
                  background: "var(--background)",
                  display: "flex",
                  flexDirection: "column",
                  gap: "0.5rem",
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <span style={{ fontSize: "0.75rem", fontWeight: 600 }}>{cat.label}</span>
                  <button
                    type="button"
                    onClick={() =>
                      onUpdate((w) => ({
                        ...w,
                        eventCategories: (w.eventCategories ?? []).filter((_, j) => j !== i),
                      }))
                    }
                    style={{
                      border: "1px solid var(--border)",
                      background: "transparent",
                      color: "var(--danger)",
                      cursor: "pointer",
                      borderRadius: "var(--radius-sm)",
                      padding: "0 0.5rem",
                      fontSize: "0.75rem",
                    }}
                  >
                    &times;
                  </button>
                </div>
                <Field label="ID">
                  <input
                    value={cat.id}
                    onChange={(e) =>
                      onUpdate((w) => ({
                        ...w,
                        eventCategories: (w.eventCategories ?? []).map((c, j) => (j === i ? { ...c, id: e.target.value } : c)),
                      }))
                    }
                    style={inputStyle}
                  />
                </Field>
                <Field label="Label">
                  <input
                    value={cat.label}
                    onChange={(e) =>
                      onUpdate((w) => ({
                        ...w,
                        eventCategories: (w.eventCategories ?? []).map((c, j) => (j === i ? { ...c, label: e.target.value } : c)),
                      }))
                    }
                    style={inputStyle}
                  />
                </Field>
                <Field label="Description">
                  <input
                    value={cat.description ?? ""}
                    onChange={(e) =>
                      onUpdate((w) => ({
                        ...w,
                        eventCategories: (w.eventCategories ?? []).map((c, j) =>
                          j === i ? { ...c, description: e.target.value || undefined } : c,
                        ),
                      }))
                    }
                    style={inputStyle}
                    placeholder="Optional"
                  />
                </Field>
              </div>
            ))}
          </>
        )}

        {tab === "difficulty" && (
          <>
            <Field label="Difficulty Level">
              <select
                value={world.difficulty?.level ?? "medium"}
                onChange={(e) =>
                  onUpdate((w) => ({
                    ...w,
                    difficulty: {
                      level: e.target.value as "easy" | "medium" | "hard" | "senior" | "extreme",
                      adaptive: w.difficulty?.adaptive ?? false,
                    },
                  }))
                }
                style={selectStyle}
              >
                <option value="easy">Easy</option>
                <option value="medium">Medium</option>
                <option value="hard">Hard</option>
                <option value="senior">Senior</option>
                <option value="extreme">Extreme</option>
              </select>
            </Field>
            <div>
              <label
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "0.5rem",
                  fontSize: "0.8125rem",
                  cursor: "pointer",
                }}
              >
                <input
                  type="checkbox"
                  checked={world.difficulty?.adaptive ?? false}
                  onChange={(e) =>
                    onUpdate((w) => ({
                      ...w,
                      difficulty: {
                        level: w.difficulty?.level ?? "medium",
                        adaptive: e.target.checked,
                      },
                    }))
                  }
                  style={{ accentColor: "var(--accent)" }}
                />
                Adaptive Difficulty
              </label>
              <p style={{ fontSize: "0.7rem", color: "var(--muted)", marginTop: "0.25rem" }}>
                When enabled, difficulty adjusts based on player performance.
              </p>
            </div>
          </>
        )}

        {tab === "safety" && (
          <>
            <StringListEditor
              label="Historical Themes"
              items={world.safetyProfile.historicalThemes}
              onChange={(historicalThemes) =>
                onUpdate((w) => ({ ...w, safetyProfile: { ...w.safetyProfile, historicalThemes } }))
              }
            />
            <StringListEditor
              label="Disallowed Content"
              items={world.safetyProfile.disallowedContent}
              onChange={(disallowedContent) =>
                onUpdate((w) => ({ ...w, safetyProfile: { ...w.safetyProfile, disallowedContent } }))
              }
            />
          </>
        )}
      </div>
    </>
  );
}

function InitialStatePanel({
  world,
  onUpdate,
}: {
  world: WorldDefinition;
  onUpdate: (updater: (w: WorldDefinition) => WorldDefinition) => void;
}) {
  const state = world.initialState;

  const metrics = world.metrics ?? [
    { id: "stability", label: "Stability", initialValue: 50, direction: "higher-better" as const },
    { id: "morale", label: "Morale", initialValue: 50, direction: "higher-better" as const },
    { id: "resources", label: "Resources", initialValue: 50, direction: "higher-better" as const },
    { id: "pressure", label: "Pressure", initialValue: 50, direction: "lower-better" as const },
  ];

  return (
    <div style={bodyStyle}>
      <div style={labelStyle}>Metric Values</div>
      {metrics.map((metric) => (
        <RangeField
          key={metric.id}
          label={metric.label}
          value={state.metricValues?.[metric.id] ?? (state as Record<string, unknown>)[metric.id] as number ?? 50}
          onChange={(v) =>
            onUpdate((w) => ({
              ...w,
              initialState: {
                ...w.initialState,
                metricValues: { ...w.initialState.metricValues, [metric.id]: v },
                // Also write legacy flat field for backward compat
                ...(["stability", "morale", "resources", "pressure"].includes(metric.id) ? { [metric.id]: v } : {}),
              },
            }))
          }
        />
      ))}

      {/* Group influence */}
      <div style={{ borderTop: "1px solid var(--border)", paddingTop: "0.75rem" }}>
        <div style={labelStyle}>Group Influence</div>
        {Object.entries(state.groupInfluence).map(([groupId, value]) => {
          const group = world.groups.find((g) => g.id === groupId);
          return (
            <RangeField
              key={groupId}
              label={group?.name ?? groupId}
              value={value}
              onChange={(v) =>
                onUpdate((w) => ({
                  ...w,
                  initialState: {
                    ...w.initialState,
                    groupInfluence: { ...w.initialState.groupInfluence, [groupId]: v },
                  },
                }))
              }
            />
          );
        })}
      </div>

      {/* Character states */}
      <div style={{ borderTop: "1px solid var(--border)", paddingTop: "0.75rem" }}>
        <div style={labelStyle}>Character Emotional States</div>
        {Object.entries(state.characterStates).map(([charId, charState]) => {
          const char = world.characters.find((c) => c.id === charId);
          return (
            <div key={charId} style={{ marginTop: "0.5rem" }}>
              <div style={{ fontSize: "0.75rem", fontWeight: 600, marginBottom: "0.375rem" }}>
                {char?.name ?? charId}
              </div>
              {(["anger", "fear", "hope", "loyalty"] as const).map((emotion) => (
                <RangeField
                  key={emotion}
                  label={emotion}
                  value={charState[emotion]}
                  onChange={(v) =>
                    onUpdate((w) => ({
                      ...w,
                      initialState: {
                        ...w.initialState,
                        characterStates: {
                          ...w.initialState.characterStates,
                          [charId]: { ...w.initialState.characterStates[charId], [emotion]: v },
                        },
                      },
                    }))
                  }
                />
              ))}
            </div>
          );
        })}
      </div>

      {/* v2: Relationship Respect */}
      <div style={{ borderTop: "1px solid var(--border)", paddingTop: "0.75rem" }}>
        <div style={labelStyle}>Relationship Respect <span style={{ fontSize: "0.6rem", color: "#8DF0C8", marginLeft: "0.25rem" }}>v2</span></div>
        {Object.entries(state.relationships).map(([charId, rel]) => {
          const char = world.characters.find((c) => c.id === charId);
          return (
            <RangeField
              key={charId}
              label={char?.name ?? charId}
              value={rel.respect ?? 50}
              onChange={(v) =>
                onUpdate((w) => ({
                  ...w,
                  initialState: {
                    ...w.initialState,
                    relationships: {
                      ...w.initialState.relationships,
                      [charId]: { ...w.initialState.relationships[charId], respect: v },
                    },
                  },
                }))
              }
            />
          );
        })}
      </div>
    </div>
  );
}

/* ── Main panel component ─────────────────────────────────── */

const NODE_COLORS: Record<EntityType, string> = {
  world: "#C4956A",
  character: "#5B8DEF",
  group: "#6FBF88",
  role: "#E2A55A",
  event: "#8B6FC0",
  state: "#FF5A5A",
  relationship: "#D94F7A",
};

const ENTITY_LABELS: Record<EntityType, string> = {
  world: "World Core",
  character: "Character",
  group: "Group",
  role: "Role",
  event: "Event",
  state: "Initial State",
  relationship: "Relationship",
};

export function WorldEditorPanel({
  node,
  world,
  errors,
  onUpdateCharacter,
  onUpdateGroup,
  onUpdateRole,
  onUpdateEvent,
  onUpdateRelationship,
  onUpdateWorld,
  onDelete,
  onClose,
}: Props) {
  const canDelete = node.entityType !== "world" && node.entityType !== "state";

  return (
    <div style={panelRoot}>
      {/* Header */}
      <div style={headerStyle}>
        <span style={{
          width: 10,
          height: 10,
          borderRadius: "50%",
          background: NODE_COLORS[node.entityType],
          flexShrink: 0,
        }} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: "0.875rem", fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {node.label}
          </div>
          <div style={{ fontSize: "0.65rem", color: NODE_COLORS[node.entityType], fontWeight: 600, letterSpacing: "0.1em", textTransform: "uppercase" }}>
            {ENTITY_LABELS[node.entityType]}
          </div>
        </div>

        {canDelete && (
          <button
            type="button"
            onClick={() => onDelete(node.entityType, node.entityId)}
            style={{
              border: "1px solid var(--border)",
              background: "transparent",
              color: "var(--danger)",
              cursor: "pointer",
              borderRadius: "var(--radius-sm)",
              padding: "0.25rem 0.5rem",
              fontSize: "0.7rem",
              fontWeight: 600,
            }}
          >
            Delete
          </button>
        )}

        <button
          type="button"
          onClick={onClose}
          style={{
            border: "none",
            background: "transparent",
            color: "var(--muted)",
            cursor: "pointer",
            fontSize: "1.25rem",
            lineHeight: 1,
            padding: "0 0.25rem",
          }}
        >
          &times;
        </button>
      </div>

      {/* Validation errors */}
      {errors.length > 0 && (
        <div style={{ padding: "0.5rem 1rem", background: "rgba(239,91,91,0.08)", borderBottom: "1px solid var(--border)" }}>
          {errors.map((err, i) => (
            <div key={i} style={{ fontSize: "0.75rem", color: "#FF5A5A", lineHeight: 1.5 }}>
              {err.message}
            </div>
          ))}
        </div>
      )}

      {/* Entity-specific panel */}
      {node.entityType === "character" && (() => {
        const char = world.characters.find((c) => c.id === node.entityId);
        return char ? (
          <CharacterPanel
            char={char}
            world={world}
            onUpdate={(updater) => onUpdateCharacter(char.id, updater)}
          />
        ) : null;
      })()}

      {node.entityType === "group" && (() => {
        const group = world.groups.find((g) => g.id === node.entityId);
        return group ? (
          <GroupPanel
            group={group}
            world={world}
            onUpdate={(updater) => onUpdateGroup(group.id, updater)}
          />
        ) : null;
      })()}

      {node.entityType === "role" && (() => {
        const role = world.roles.find((r) => r.id === node.entityId);
        return role ? (
          <RolePanel
            role={role}
            world={world}
            onUpdate={(updater) => onUpdateRole(role.id, updater)}
          />
        ) : null;
      })()}

      {node.entityType === "event" && (() => {
        const event = world.eventTemplates.find((e) => e.id === node.entityId);
        return event ? (
          <EventPanel
            event={event}
            world={world}
            onUpdate={(updater) => onUpdateEvent(event.id, updater)}
          />
        ) : null;
      })()}

      {node.entityType === "relationship" && (() => {
        const rel = (world.relationships ?? []).find((r) => r.id === node.entityId);
        return rel ? (
          <RelationshipPanel
            rel={rel}
            world={world}
            onUpdate={(updater) => onUpdateRelationship(rel.id, updater)}
          />
        ) : null;
      })()}

      {node.entityType === "world" && (
        <WorldCorePanel world={world} onUpdate={onUpdateWorld} />
      )}

      {node.entityType === "state" && (
        <InitialStatePanel world={world} onUpdate={onUpdateWorld} />
      )}
    </div>
  );
}
