"use client";

import { useState, useTransition } from "react";
import type { EraConfig } from "@odyssey/db";
import {
  deleteCharacter,
  rebuildCharacterEdges,
  resetCharacterData,
  updateCharacterEras,
} from "@/app/(authenticated)/characters/actions";
import { EraEditor } from "@/components/era-editor";

/* ── Tokens ────────────────────────────────────────────────────── */

const T = {
  fg: "var(--foreground)",
  muted: "var(--muted)",
  panel: "var(--panel)",
  border: "var(--border)",
  accent: "var(--accent-strong)",
  accentSoft: "var(--accent-soft)",
  cardHover: "var(--card-hover)",
  fontHeading: "'Space Grotesk', sans-serif",
  fontBody: "'Inter', sans-serif",
  fontMono: "var(--font-mono, 'JetBrains Mono', monospace)",
};

function hash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = ((h << 5) - h + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

const GRADIENTS = [
  "linear-gradient(135deg, #105A59 0%, #1a3a3a 50%, #0f2828 100%)",
  "linear-gradient(135deg, #3a1a1a 0%, #2a1018 50%, #1a0a12 100%)",
  "linear-gradient(135deg, #1a2a4a 0%, #101830 50%, #080e1a 100%)",
  "linear-gradient(135deg, #2a1a4a 0%, #1a1035 50%, #0f0a22 100%)",
  "linear-gradient(135deg, #3a2a1a 0%, #2a1a10 50%, #1a1008 100%)",
  "linear-gradient(135deg, #1a3a2a 0%, #0f2218 50%, #081510 100%)",
];

const AVATAR_GRADIENTS = [
  "linear-gradient(135deg, #8CE7D2 0%, #4FB8A8 100%)",
  "linear-gradient(135deg, #E8A0A0 0%, #B4635F 100%)",
  "linear-gradient(135deg, #A8C4E8 0%, #6B8AFF 100%)",
  "linear-gradient(135deg, #C7A5FF 0%, #8C6BE8 100%)",
  "linear-gradient(135deg, #E8B87A 0%, #B48447 100%)",
  "linear-gradient(135deg, #8AD09A 0%, #4F8D62 100%)",
];

function relative(iso: string | null): string {
  if (!iso) return "Never";
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  const weeks = Math.floor(days / 7);
  if (weeks < 4) return `${weeks}w ago`;
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

/* ── Props ─────────────────────────────────────────────────────── */

type Props = {
  character: {
    id: string;
    slug: string;
    title: string;
    summary: string | null;
    image: string | null;
    eras: EraConfig[];
  };
  stats: {
    pageCount: number;
    edgeCount: number;
    sourceCount: number;
    ingestionCount: number;
    lastIngestAt: string | null;
    status: "live" | "draft";
  };
  eventCountByEra: Record<string, number>;
  voiceIdentity: {
    slug: string;
    frontmatter: Record<string, unknown>;
  } | null;
};

export function CharacterOverview({ character, stats, eventCountByEra, voiceIdentity }: Props) {
  const gradient = GRADIENTS[hash(character.slug) % GRADIENTS.length];
  const avGradient = AVATAR_GRADIENTS[hash(character.slug) % AVATAR_GRADIENTS.length];

  return (
    <div style={{ display: "flex", flexDirection: "row", gap: 20 }}>
      <div style={{ display: "flex", flexDirection: "column", gap: 20, flex: "1 1 0", minWidth: 0 }}>
        <IdentityCard character={character} stats={stats} gradient={gradient} avGradient={avGradient} />
        <VoiceIdentityCard voice={voiceIdentity} characterSlug={character.slug} />
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 20, width: 420, flexShrink: 0 }}>
        <ErasCard characterId={character.id} eras={character.eras} eventCountByEra={eventCountByEra} />
        <DangerZoneCard characterId={character.id} characterTitle={character.title} />
      </div>
    </div>
  );
}

/* ── Identity card ─────────────────────────────────────────────── */

function IdentityCard({
  character, stats, gradient, avGradient,
}: {
  character: Props["character"];
  stats: Props["stats"];
  gradient: string;
  avGradient: string;
}) {
  return (
    <div style={cardShell}>
      <div style={{
        position: "relative", height: 112,
        background: gradient,
      }}>
        <div style={{ position: "absolute", top: 14, right: 14 }}>
          <StatusPill status={stats.status} />
        </div>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 14, padding: "16px 20px 20px 20px" }}>
        {/* Avatar overlaps the gradient via a relative wrapper (see
            characters-grid.tsx for the source pattern). Avatar is absolutely
            positioned so title/slug alignment is independent of font metrics. */}
        <div style={{ position: "relative", marginTop: -44, minHeight: 64 }}>
          {character.image ? (
            <img
              src={character.image}
              alt={character.title}
              referrerPolicy="no-referrer"
              style={{
                position: "absolute", top: 13, left: 0,
                width: 64, height: 64, boxSizing: "border-box",
                borderRadius: "50%", objectFit: "cover",
                boxShadow: "0 0 0 3px var(--background)",
              }}
            />
          ) : (
            <div style={{
              position: "absolute", top: 13, left: 0,
              width: 64, height: 64, boxSizing: "border-box",
              borderRadius: "50%", background: avGradient,
              boxShadow: "0 0 0 3px var(--background)",
              display: "flex", alignItems: "center", justifyContent: "center",
            }}>
              <span style={{ fontFamily: T.fontHeading, fontSize: 26, fontWeight: 600, color: "#0C0E14", lineHeight: "28px" }}>
                {character.title.charAt(0).toUpperCase()}
              </span>
            </div>
          )}
          <div style={{
            paddingLeft: 86, // 64 avatar + 22 gap (matches grid card breathing room)
            paddingTop: 38,
            minWidth: 0,
            display: "flex", flexDirection: "column", gap: 3,
          }}>
            <span style={{
              display: "block",
              fontFamily: T.fontHeading, fontSize: 22, fontWeight: 700, color: T.fg, lineHeight: "26px",
              overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
            }}>
              {character.title}
            </span>
            <span style={{
              display: "block",
              fontFamily: T.fontBody, fontSize: 13, color: "rgba(255,255,255,0.55)", lineHeight: "17px",
              overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
            }}>
              {character.slug}
            </span>
          </div>
        </div>

        {character.summary && (
          <p style={{
            margin: 0,
            fontFamily: T.fontBody, fontSize: 13, lineHeight: "20px",
            color: "rgba(255,255,255,0.7)",
          }}>
            {character.summary}
          </p>
        )}

        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <a
            href={`/characters/${character.slug}/chat`}
            style={{
              textDecoration: "none",
              border: "1px solid rgba(140,231,210,0.35)",
              background: "rgba(140,231,210,0.08)",
              color: "#BFF5EF",
              padding: "6px 10px",
              borderRadius: 999,
              fontFamily: T.fontMono,
              fontSize: 10,
              letterSpacing: "0.06em",
              textTransform: "uppercase",
            }}
          >
            Open Chat
          </a>
          <a
            href={`/characters/${character.slug}/voice`}
            style={{
              textDecoration: "none",
              border: "1px solid rgba(191,245,239,0.46)",
              background: "rgba(143,209,203,0.16)",
              color: "#D5FFF8",
              padding: "6px 10px",
              borderRadius: 999,
              fontFamily: T.fontMono,
              fontSize: 10,
              letterSpacing: "0.06em",
              textTransform: "uppercase",
            }}
          >
            Speak
          </a>
        </div>

        <div style={{
          display: "flex", alignItems: "center", gap: 28, paddingTop: 14,
          borderTop: `1px solid ${T.border}`,
        }}>
          <Stat label="Wiki pages" value={stats.pageCount} />
          <Stat label="Edges" value={stats.edgeCount} />
          <Stat label="Sources" value={stats.sourceCount} />
          <Stat label="Ingestions" value={stats.ingestionCount} />
          <div style={{ marginLeft: "auto", display: "flex", flexDirection: "column", gap: 2, alignItems: "flex-end" }}>
            <span style={{ fontFamily: T.fontHeading, fontSize: 13, fontWeight: 500, color: T.fg, lineHeight: "16px" }}>
              {relative(stats.lastIngestAt)}
            </span>
            <span style={{ fontFamily: T.fontMono, fontSize: 9, fontWeight: 500, color: T.muted, letterSpacing: "0.08em", textTransform: "uppercase" }}>
              Last ingest
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

function StatusPill({ status }: { status: "live" | "draft" }) {
  const live = status === "live";
  const color = live ? "#4ADE80" : "#FACC15";
  return (
    <span style={{
      display: "inline-flex", alignItems: "center", gap: 6,
      padding: "4px 10px", borderRadius: 999,
      background: live ? "rgba(74,222,128,0.12)" : "rgba(250,204,21,0.12)",
      fontFamily: T.fontMono, fontSize: 10, fontWeight: 700,
      color, letterSpacing: "0.08em",
    }}>
      <span style={{ width: 6, height: 6, borderRadius: "50%", background: color }} />
      {live ? "LIVE" : "DRAFT"}
    </span>
  );
}

/* ── Eras ──────────────────────────────────────────────────────── */

function ErasCard({
  characterId, eras, eventCountByEra,
}: {
  characterId: string;
  eras: EraConfig[];
  eventCountByEra: Record<string, number>;
}) {
  const initialSorted = [...eras].sort((a, b) => a.order - b.order);
  const [draft, setDraft] = useState<EraConfig[]>(initialSorted);
  const [savedSnapshot, setSavedSnapshot] = useState<EraConfig[]>(initialSorted);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  // Normalize comparison: dirty when draft differs from savedSnapshot.
  const dirty = !shallowEqEras(draft, savedSnapshot);

  const timeless = draft.length === 0;

  function save() {
    setError(null);
    start(async () => {
      const res = await updateCharacterEras(characterId, draft);
      if (!res.ok) {
        setError(res.error);
      } else {
        setSavedSnapshot(draft);
      }
    });
  }

  function discard() {
    setDraft(savedSnapshot);
    setError(null);
  }

  return (
    <div style={cardShell}>
      <div style={{
        display: "flex", alignItems: "center", justifyContent: "space-between",
        padding: "12px 18px", borderBottom: `1px solid ${T.border}`,
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontFamily: T.fontMono, fontSize: 10, fontWeight: 500, color: T.muted, letterSpacing: "0.08em", textTransform: "uppercase" }}>
            Eras · {draft.length}
          </span>
          {timeless && savedSnapshot.length === 0 && (
            <span style={{
              padding: "1px 7px", borderRadius: 4,
              background: "rgba(168,140,255,0.1)",
              fontFamily: T.fontMono, fontSize: 9, fontWeight: 600, color: "#A88CFF",
              letterSpacing: "0.06em", textTransform: "uppercase",
            }}>
              Timeless
            </span>
          )}
        </div>
        {dirty && (
          <span style={{ fontFamily: T.fontMono, fontSize: 10, color: "#FACC15" }}>
            unsaved
          </span>
        )}
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 10, padding: "14px 18px 16px 18px" }}>
        {savedSnapshot.length === 0 && draft.length === 0 && (
          <span style={{ fontFamily: T.fontBody, fontSize: 12, color: T.muted, lineHeight: "18px" }}>
            This character is <strong style={{ color: "#A88CFF" }}>timeless</strong> — no era configured. The curator won&apos;t time-gate their knowledge.{" "}
            Add eras below if you want to explore the character at different points in their life.
          </span>
        )}

        <EraEditor eras={draft} onChange={setDraft} eventCountByEra={eventCountByEra} dense />

        {error && (
          <div style={{
            padding: "8px 12px", borderRadius: 8,
            background: "rgba(232,144,144,0.08)", border: "1px solid rgba(232,144,144,0.25)",
            color: "#E89090", fontFamily: T.fontBody, fontSize: 12,
          }}>
            {error}
          </div>
        )}

        {dirty && (
          <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 4 }}>
            <button type="button" onClick={discard} disabled={pending} style={btnGhost}>
              Discard
            </button>
            <button
              type="button" onClick={save} disabled={pending}
              style={{ ...btnPrimary, opacity: pending ? 0.5 : 1, cursor: pending ? "not-allowed" : "pointer" }}
            >
              {pending ? "Saving…" : "Save eras"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function shallowEqEras(a: EraConfig[], b: EraConfig[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i].key !== b[i].key || a[i].title !== b[i].title || a[i].order !== b[i].order) {
      return false;
    }
  }
  return true;
}

/* ── Voice identity preview ────────────────────────────────────── */

function VoiceIdentityCard({
  voice, characterSlug,
}: { voice: Props["voiceIdentity"]; characterSlug: string }) {
  return (
    <div style={cardShell}>
      <div style={{
        display: "flex", alignItems: "center", justifyContent: "space-between",
        padding: "12px 18px", borderBottom: `1px solid ${T.border}`,
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ width: 8, height: 8, borderRadius: "50%", background: "#E879A0" }} />
          <span style={{ fontFamily: T.fontMono, fontSize: 10, fontWeight: 500, color: T.muted, letterSpacing: "0.08em", textTransform: "uppercase" }}>
            Voice Identity
          </span>
          <span style={{ fontFamily: T.fontBody, fontSize: 11, color: T.muted }}>runtime system prompt</span>
        </div>
        {voice && (
          <a
            href={`/characters/${characterSlug}/wiki/${voice.slug}?edit=1`}
            style={{ fontFamily: T.fontBody, fontSize: 11, color: "#8CE7D2", textDecoration: "none" }}
          >
            Edit page →
          </a>
        )}
      </div>
      <div style={{ padding: "14px 18px 16px 18px" }}>
        {!voice ? (
          <span style={{ fontFamily: T.fontBody, fontSize: 12, color: T.muted, lineHeight: "18px" }}>
            No voice-identity page yet. One will be created during the first ingestion — or add it manually from the Wiki tab.
          </span>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <VoiceField label="Speech patterns" values={pickArr(voice.frontmatter, "speechPatterns")} />
            <VoiceField label="Beliefs" values={pickArr(voice.frontmatter, "beliefs")} />
            <VoiceField label="Taboos" values={pickArr(voice.frontmatter, "taboos")} danger />
          </div>
        )}
      </div>
    </div>
  );
}

function VoiceField({ label, values, danger }: { label: string; values: string[]; danger?: boolean }) {
  if (values.length === 0) return null;
  const tagBg = danger ? "rgba(232,144,144,0.12)" : "rgba(255,255,255,0.06)";
  const tagColor = danger ? "#E89090" : "rgba(255,255,255,0.7)";
  return (
    <div>
      <span style={{ fontFamily: T.fontMono, fontSize: 9, color: T.muted, letterSpacing: "0.08em", textTransform: "uppercase" }}>
        {label}
      </span>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginTop: 6 }}>
        {values.map((v, i) => (
          <span key={i} style={{
            padding: "2px 8px", borderRadius: 4, background: tagBg,
            fontFamily: T.fontBody, fontSize: 11, color: tagColor,
          }}>
            {v}
          </span>
        ))}
      </div>
    </div>
  );
}

function pickArr(fm: Record<string, unknown>, key: string): string[] {
  const v = fm[key];
  if (!Array.isArray(v)) return [];
  return v.filter((x): x is string => typeof x === "string");
}

/* ── Danger zone ───────────────────────────────────────────────── */

function DangerZoneCard({ characterId, characterTitle }: { characterId: string; characterTitle: string }) {
  const [rebuildMsg, setRebuildMsg] = useState<string | null>(null);
  const [resetMsg, setResetMsg] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const [resetting, startReset] = useTransition();
  const [deleting, startDelete] = useTransition();

  function doRebuild() {
    setRebuildMsg(null);
    start(async () => {
      const res = await rebuildCharacterEdges(characterId);
      if (res.ok && res.data) setRebuildMsg(`Rebuilt: +${res.data.added} / −${res.data.removed}`);
      else if (!res.ok) setRebuildMsg(`Error: ${res.error}`);
    });
  }

  function doReset() {
    const confirmed = window.confirm(
      `Reset all ingested data for "${characterTitle}"?\n\nDeletes every wiki page, edge, source, and ingestion run. The character row itself is kept. Cannot be undone.`,
    );
    if (!confirmed) return;
    setResetMsg(null);
    startReset(async () => {
      const res = await resetCharacterData(characterId);
      if (res.ok && res.data) {
        const d = res.data;
        setResetMsg(
          `Cleared: ${d.pagesRemoved} pages, ${d.edgesRemoved} edges, ${d.sourcesRemoved} sources, ${d.runsRemoved} runs`,
        );
      } else if (!res.ok) {
        setResetMsg(`Error: ${res.error}`);
      }
    });
  }

  function doDelete() {
    const confirmed = window.confirm(`Delete "${characterTitle}"?\n\nThis cascades the wiki, edges, sources, and ingestion runs. Cannot be undone.`);
    if (!confirmed) return;
    startDelete(async () => {
      const res = await deleteCharacter(characterId);
      if (!res.ok) alert(res.error);
      // On success server action redirects.
    });
  }

  return (
    <div style={{
      background: T.panel, border: "1px solid rgba(232,144,144,0.2)",
      borderRadius: 14, overflow: "clip",
    }}>
      <div style={{
        display: "flex", alignItems: "center", padding: "12px 18px",
        borderBottom: "1px solid rgba(232,144,144,0.08)",
      }}>
        <span style={{
          fontFamily: T.fontMono, fontSize: 10, fontWeight: 500, color: "#E89090",
          letterSpacing: "0.08em", textTransform: "uppercase",
        }}>
          Danger zone
        </span>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 10, padding: "14px 18px 16px 18px" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 1 }}>
            <span style={{ fontFamily: T.fontBody, fontSize: 12, fontWeight: 500, color: T.fg }}>Rebuild edges</span>
            <span style={{ fontFamily: T.fontBody, fontSize: 11, color: T.muted }}>
              {rebuildMsg ?? "Wipe + recompute the edge cache from page bodies."}
            </span>
          </div>
          <button type="button" onClick={doRebuild} disabled={pending} style={{ ...btnGhost, flexShrink: 0, opacity: pending ? 0.6 : 1 }}>
            {pending ? "…" : "Rebuild"}
          </button>
        </div>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 1, minWidth: 0 }}>
            <span style={{ fontFamily: T.fontBody, fontSize: 12, fontWeight: 500, color: T.fg }}>Reset ingested data</span>
            <span style={{ fontFamily: T.fontBody, fontSize: 11, color: T.muted, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {resetMsg ?? "Wipe pages, edges, sources, and runs. Keeps the character."}
            </span>
          </div>
          <button type="button" onClick={doReset} disabled={resetting} style={{ ...btnDanger, flexShrink: 0, opacity: resetting ? 0.6 : 1 }}>
            {resetting ? "…" : "Reset…"}
          </button>
        </div>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 1 }}>
            <span style={{ fontFamily: T.fontBody, fontSize: 12, fontWeight: 500, color: T.fg }}>Delete character</span>
            <span style={{ fontFamily: T.fontBody, fontSize: 11, color: T.muted }}>
              Cascades wiki, edges, sources, sessions.
            </span>
          </div>
          <button type="button" onClick={doDelete} disabled={deleting} style={{ ...btnDanger, flexShrink: 0, opacity: deleting ? 0.6 : 1 }}>
            {deleting ? "…" : "Delete…"}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ── Small atoms ───────────────────────────────────────────────── */

function Stat({ label, value }: { label: string; value: number | string }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
      <span style={{ fontFamily: T.fontHeading, fontSize: 20, fontWeight: 600, color: T.fg, lineHeight: "22px" }}>
        {value}
      </span>
      <span style={{ fontFamily: T.fontMono, fontSize: 9, fontWeight: 500, color: T.muted, letterSpacing: "0.08em", textTransform: "uppercase" }}>
        {label}
      </span>
    </div>
  );
}

const cardShell: React.CSSProperties = {
  display: "flex", flexDirection: "column",
  background: T.panel, border: `1px solid ${T.border}`,
  borderRadius: 14, overflow: "clip",
};

const btnGhost: React.CSSProperties = {
  padding: "5px 12px", borderRadius: 8,
  border: "1px solid var(--border)", background: "transparent",
  color: "var(--foreground)", fontFamily: T.fontBody, fontSize: 11, cursor: "pointer",
};

const btnPrimary: React.CSSProperties = {
  padding: "6px 16px", borderRadius: 8, border: "none",
  background: T.accent, color: "var(--background)",
  fontFamily: T.fontBody, fontSize: 12, fontWeight: 600, cursor: "pointer",
};

const btnDanger: React.CSSProperties = {
  padding: "5px 12px", borderRadius: 8,
  border: "1px solid rgba(232,144,144,0.3)",
  background: "rgba(232,144,144,0.04)", color: "#E89090",
  fontFamily: T.fontBody, fontSize: 11, cursor: "pointer",
};
