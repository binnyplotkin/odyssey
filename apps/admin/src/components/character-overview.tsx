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
  "radial-gradient(circle at 18% 20%, color-mix(in srgb, var(--emissive-mint) 20%, transparent), transparent 32%), linear-gradient(135deg, var(--surface-2), var(--background))",
  "radial-gradient(circle at 72% 18%, var(--critical-fill), transparent 34%), linear-gradient(135deg, var(--surface-2), var(--background))",
  "radial-gradient(circle at 28% 18%, color-mix(in srgb, var(--signal-blue) 18%, transparent), transparent 34%), linear-gradient(135deg, var(--surface-2), var(--background))",
  "radial-gradient(circle at 68% 24%, color-mix(in srgb, var(--event-violet) 18%, transparent), transparent 34%), linear-gradient(135deg, var(--surface-2), var(--background))",
  "radial-gradient(circle at 18% 20%, color-mix(in srgb, var(--warning-amber) 16%, transparent), transparent 32%), linear-gradient(135deg, var(--surface-2), var(--background))",
  "radial-gradient(circle at 60% 18%, color-mix(in srgb, var(--status-live) 15%, transparent), transparent 34%), linear-gradient(135deg, var(--surface-2), var(--background))",
];

const AVATAR_GRADIENTS = [
  "linear-gradient(135deg, var(--emissive-mint) 0%, var(--active-teal) 100%)",
  "linear-gradient(135deg, color-mix(in srgb, var(--status-error) 65%, white) 0%, var(--status-error) 100%)",
  "linear-gradient(135deg, color-mix(in srgb, var(--signal-blue) 65%, white) 0%, var(--signal-blue) 100%)",
  "linear-gradient(135deg, color-mix(in srgb, var(--event-violet) 70%, white) 0%, var(--event-violet) 100%)",
  "linear-gradient(135deg, color-mix(in srgb, var(--warning-amber) 72%, white) 0%, var(--warning-amber) 100%)",
  "linear-gradient(135deg, color-mix(in srgb, var(--status-live) 70%, white) 0%, var(--status-live) 100%)",
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
    <div style={{ display: "flex", flexDirection: "row", gap: "var(--space-20)" }}>
      <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-20)", flex: "1 1 0", minWidth: 0 }}>
        <IdentityCard character={character} stats={stats} gradient={gradient} avGradient={avGradient} />
        <VoiceIdentityCard voice={voiceIdentity} characterSlug={character.slug} />
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-20)", width: 420, flexShrink: 0 }}>
        <KnowledgeGraphCard
          characterSlug={character.slug}
          pageCount={stats.pageCount}
          edgeCount={stats.edgeCount}
          lastIngestAt={stats.lastIngestAt}
        />
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
      <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-14)", padding: "16px 20px 20px 20px" }}>
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
            display: "flex", flexDirection: "column", gap: "var(--space-3)",
          }}>
            <span style={{
              display: "block",
              fontFamily: T.fontHeading, fontSize: "var(--font-size-3xl)", fontWeight: 700, color: T.fg, lineHeight: "26px",
              overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
            }}>
              {character.title}
            </span>
            <span style={{
              display: "block",
              fontFamily: T.fontBody, fontSize: "var(--font-size-md)", color: "rgba(255,255,255,0.55)", lineHeight: "17px",
              overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
            }}>
              {character.slug}
            </span>
          </div>
        </div>

        {character.summary && (
          <p style={{
            margin: 0,
            fontFamily: T.fontBody, fontSize: "var(--font-size-md)", lineHeight: "20px",
            color: "rgba(255,255,255,0.7)",
          }}>
            {character.summary}
          </p>
        )}

        <div style={{ display: "flex", alignItems: "center", gap: "var(--space-10)" }}>
          <a
            href={`/characters/${character.slug}/chat`}
            style={{
              textDecoration: "none",
              border: "1px solid var(--border-active)",
              background: "var(--accent-soft)",
              color: "var(--accent-strong)",
              padding: "6px 10px",
              borderRadius: "var(--radius-button, 12px)",
              fontFamily: T.fontMono,
              fontSize: "var(--font-size-xs)",
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
              border: "1px solid color-mix(in srgb, var(--emissive-mint) 34%, transparent)",
              background: "color-mix(in srgb, var(--emissive-mint) 12%, transparent)",
              color: "var(--emissive-mint)",
              padding: "6px 10px",
              borderRadius: "var(--radius-button, 12px)",
              fontFamily: T.fontMono,
              fontSize: "var(--font-size-xs)",
              letterSpacing: "0.06em",
              textTransform: "uppercase",
            }}
          >
            Speak
          </a>
        </div>

        <div style={{
          display: "flex", alignItems: "center", gap: 28, paddingTop: "var(--space-14)",
          borderTop: `1px solid ${T.border}`,
        }}>
          <Stat label="Pages" value={stats.pageCount} />
          <Stat label="Edges" value={stats.edgeCount} />
          <Stat label="Sources" value={stats.sourceCount} />
          <Stat label="Ingestions" value={stats.ingestionCount} />
          <div style={{ marginLeft: "auto", display: "flex", flexDirection: "column", gap: "var(--space-2)", alignItems: "flex-end" }}>
            <span style={{ fontFamily: T.fontHeading, fontSize: "var(--font-size-md)", fontWeight: 500, color: T.fg, lineHeight: "16px" }}>
              {relative(stats.lastIngestAt)}
            </span>
            <span style={{ fontFamily: T.fontMono, fontSize: "var(--font-size-2xs)", fontWeight: 500, color: T.muted, letterSpacing: "0.08em", textTransform: "uppercase" }}>
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
  const color = live ? "var(--status-live)" : "var(--status-draft)";
  return (
    <span style={{
      display: "inline-flex", alignItems: "center", gap: "var(--space-6)",
      padding: "4px 10px", borderRadius: "var(--radius-button, 12px)",
      background: live ? "color-mix(in srgb, var(--status-live) 12%, transparent)" : "color-mix(in srgb, var(--status-draft) 12%, transparent)",
      fontFamily: T.fontMono, fontSize: "var(--font-size-xs)", fontWeight: 700,
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
        <div style={{ display: "flex", alignItems: "center", gap: "var(--space-8)" }}>
          <span style={{ fontFamily: T.fontMono, fontSize: "var(--font-size-xs)", fontWeight: 500, color: T.muted, letterSpacing: "0.08em", textTransform: "uppercase" }}>
            Eras · {draft.length}
          </span>
          {timeless && savedSnapshot.length === 0 && (
            <span style={{
              padding: "1px 7px", borderRadius: "var(--radius-xs)",
              background: "color-mix(in srgb, var(--event-violet) 10%, transparent)",
              fontFamily: T.fontMono, fontSize: "var(--font-size-2xs)", fontWeight: 600, color: "var(--event-violet)",
              letterSpacing: "0.06em", textTransform: "uppercase",
            }}>
              Timeless
            </span>
          )}
        </div>
        {dirty && (
          <span style={{ fontFamily: T.fontMono, fontSize: "var(--font-size-xs)", color: "var(--status-draft)" }}>
            unsaved
          </span>
        )}
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-10)", padding: "14px 18px 16px 18px" }}>
        {savedSnapshot.length === 0 && draft.length === 0 && (
          <span style={{ fontFamily: T.fontBody, fontSize: "var(--font-size-base)", color: T.muted, lineHeight: "18px" }}>
            This character is <strong style={{ color: "var(--event-violet)" }}>timeless</strong> — no era configured. The curator won&apos;t time-gate their knowledge.{" "}
            Add eras below if you want to explore the character at different points in their life.
          </span>
        )}

        <EraEditor eras={draft} onChange={setDraft} eventCountByEra={eventCountByEra} dense />

        {error && (
          <div style={{
            padding: "8px 12px", borderRadius: "var(--radius-md)",
            background: "color-mix(in srgb, var(--status-error) 8%, transparent)", border: "1px solid color-mix(in srgb, var(--status-error) 25%, transparent)",
            color: "var(--status-error)", fontFamily: T.fontBody, fontSize: "var(--font-size-base)",
          }}>
            {error}
          </div>
        )}

        {dirty && (
          <div style={{ display: "flex", justifyContent: "flex-end", gap: "var(--space-8)", marginTop: "var(--space-4)" }}>
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

/* ── Knowledge Graph ───────────────────────────────────────────── */

const KG_EDGES_D =
  "M 140 64 L 200 56 M 200 56 L 262 74 M 262 74 L 300 106 M 200 56 L 172 106 " +
  "M 115 106 L 172 106 M 172 106 L 230 116 M 200 56 L 230 116 M 262 74 L 230 116 " +
  "M 230 116 L 292 142 M 172 106 L 148 150 M 148 150 L 206 154 M 230 116 L 206 154 " +
  "M 206 154 L 252 174 M 292 142 L 252 174 M 206 154 L 186 198 M 252 174 L 186 198 " +
  "M 118 178 L 148 150 M 118 178 L 186 198";

function KnowledgeGraphCard({
  characterSlug, pageCount, edgeCount, lastIngestAt,
}: {
  characterSlug: string;
  pageCount: number;
  edgeCount: number;
  lastIngestAt: string | null;
}) {
  const grownLabel = lastIngestAt ? `grown ${relative(lastIngestAt).toLowerCase()}` : "not yet grown";
  return (
    <a
      href={`/characters/${characterSlug}/knowledge`}
      style={{ ...cardShell, textDecoration: "none", color: "inherit" }}
    >
      <div style={{
        display: "flex", alignItems: "center", justifyContent: "space-between",
        padding: "12px 18px", borderBottom: `1px solid ${T.border}`,
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: "var(--space-8)" }}>
          <span style={{
            width: 8, height: 8, borderRadius: "50%", background: "var(--accent-strong)",
            boxShadow: "0 0 8px 0 color-mix(in srgb, var(--accent-strong) 55%, transparent)",
          }} />
          <span style={{
            fontFamily: T.fontMono, fontSize: "var(--font-size-xs)", fontWeight: 500, color: T.muted,
            letterSpacing: "0.08em", textTransform: "uppercase",
          }}>
            Knowledge Graph
          </span>
          <span style={{ fontFamily: T.fontBody, fontSize: "var(--font-size-sm)", color: T.muted }}>
            {pageCount} {pageCount === 1 ? "node" : "nodes"} · {edgeCount} {edgeCount === 1 ? "edge" : "edges"}
          </span>
        </div>
        <span style={{ fontFamily: T.fontBody, fontSize: "var(--font-size-sm)", color: "var(--accent-strong)" }}>
          Open →
        </span>
      </div>

      <div style={{
        display: "flex", alignItems: "center", justifyContent: "center",
        padding: "20px 14px 14px 14px", position: "relative", overflow: "clip",
      }}>
        <div style={{
          position: "absolute", top: "50%", left: "50%", width: "120%", height: 280,
          transform: "translate(-50%, -50%)",
          background:
            "radial-gradient(closest-side, color-mix(in srgb, var(--active-teal) 12%, transparent) 0%, color-mix(in srgb, var(--active-teal) 4%, transparent) 40%, transparent 70%)",
          pointerEvents: "none",
        }} />
        <svg
          viewBox="0 0 380 240"
          width="100%"
          style={{ display: "block", maxWidth: 360, position: "relative" }}
          aria-hidden
        >
          <g style={{
            animation: "kg-breathe 9s ease-in-out infinite",
            transformOrigin: "190px 130px",
            transformBox: "fill-box",
          }}>
            <path d={KG_EDGES_D} stroke="color-mix(in srgb, var(--active-teal) 32%, transparent)" strokeWidth={0.85} fill="none" />
            <circle cx={140} cy={64} r={4} fill="var(--accent-strong)" fillOpacity={0.92} />
            <circle cx={200} cy={56} r={6} fill="var(--accent-strong)" />
            <circle cx={262} cy={74} r={4} fill="var(--event-violet)" fillOpacity={0.9} />
            <circle cx={300} cy={106} r={3} fill="var(--accent-strong)" fillOpacity={0.8} />
            <circle cx={115} cy={106} r={3.5} fill="var(--accent-strong)" fillOpacity={0.8} />
            <circle cx={172} cy={106} r={4} fill="var(--accent-strong)" fillOpacity={0.92} />
            <circle cx={230} cy={116} r={5} fill="var(--accent-strong)" />
            <circle cx={292} cy={142} r={3} fill="var(--status-error)" fillOpacity={0.9} />
            <circle cx={148} cy={150} r={4} fill="var(--accent-strong)" fillOpacity={0.9} />
            <circle cx={206} cy={154} r={5} fill="var(--accent-strong)" />
            <circle cx={252} cy={174} r={4} fill="var(--accent-strong)" fillOpacity={0.9} />
            <circle cx={186} cy={198} r={3} fill="var(--accent-strong)" fillOpacity={0.8} />
            <circle cx={118} cy={178} r={3} fill="var(--event-violet)" fillOpacity={0.8} />
          </g>
        </svg>
        <style>{`
          @keyframes kg-breathe {
            0%, 100% { transform: scale(1) translate(0, 0); opacity: 0.95; }
            50% { transform: scale(1.02) translate(0, -1px); opacity: 1; }
          }
        `}</style>
      </div>

      <div style={{
        display: "flex", alignItems: "center", justifyContent: "space-between",
        padding: "10px 18px 12px 18px", borderTop: `1px solid ${T.border}`,
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: "var(--space-16)" }}>
          <KgLegendDot color="var(--accent-strong)" label="people" />
          <KgLegendDot color="var(--event-violet)" label="concepts" />
          <KgLegendDot color="var(--status-error)" label="events" />
        </div>
        <span style={{
          fontFamily: T.fontMono, fontSize: "var(--font-size-xs)", color: "rgba(255,255,255,0.4)", letterSpacing: "0.06em",
        }}>
          {grownLabel}
        </span>
      </div>
    </a>
  );
}

function KgLegendDot({ color, label }: { color: string; label: string }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: "var(--space-6)" }}>
      <span style={{ width: 6, height: 6, borderRadius: "50%", background: color, display: "block" }} />
      <span style={{ fontFamily: T.fontBody, fontSize: "var(--font-size-sm)", color: T.muted }}>{label}</span>
    </div>
  );
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
        <div style={{ display: "flex", alignItems: "center", gap: "var(--space-8)" }}>
          <span style={{ width: 8, height: 8, borderRadius: "50%", background: "var(--status-error)" }} />
          <span style={{ fontFamily: T.fontMono, fontSize: "var(--font-size-xs)", fontWeight: 500, color: T.muted, letterSpacing: "0.08em", textTransform: "uppercase" }}>
            Voice Identity
          </span>
          <span style={{ fontFamily: T.fontBody, fontSize: "var(--font-size-sm)", color: T.muted }}>runtime system prompt</span>
        </div>
        {voice && (
          <a
            href={`/characters/${characterSlug}/wiki/${voice.slug}?edit=1`}
            style={{ fontFamily: T.fontBody, fontSize: "var(--font-size-sm)", color: "var(--accent-strong)", textDecoration: "none" }}
          >
            Edit page →
          </a>
        )}
      </div>
      <div style={{ padding: "14px 18px 16px 18px" }}>
        {!voice ? (
          <span style={{ fontFamily: T.fontBody, fontSize: "var(--font-size-base)", color: T.muted, lineHeight: "18px" }}>
            No voice-identity page yet. One will be created during the first ingestion — or add it manually from the Wiki tab.
          </span>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-12)" }}>
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
  const tagBg = danger ? "color-mix(in srgb, var(--status-error) 12%, transparent)" : "color-mix(in srgb, var(--foreground) 6%, transparent)";
  const tagColor = danger ? "var(--status-error)" : "var(--text-secondary)";
  return (
    <div>
      <span style={{ fontFamily: T.fontMono, fontSize: "var(--font-size-2xs)", color: T.muted, letterSpacing: "0.08em", textTransform: "uppercase" }}>
        {label}
      </span>
      <div style={{ display: "flex", flexWrap: "wrap", gap: "var(--space-4)", marginTop: "var(--space-6)" }}>
        {values.map((v, i) => (
          <span key={i} style={{
            padding: "2px 8px", borderRadius: "var(--radius-xs)", background: tagBg,
            fontFamily: T.fontBody, fontSize: "var(--font-size-sm)", color: tagColor,
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
      background: "var(--card-material, var(--panel))",
      border: "1px solid color-mix(in srgb, var(--status-error) 20%, transparent)",
      borderRadius: "var(--radius-card, 18px)",
      boxShadow: "var(--elevation-card)",
      overflow: "clip",
    }}>
      <div style={{
        display: "flex", alignItems: "center", padding: "12px 18px",
        borderBottom: "1px solid color-mix(in srgb, var(--status-error) 8%, transparent)",
      }}>
        <span style={{
          fontFamily: T.fontMono, fontSize: "var(--font-size-xs)", fontWeight: 500, color: "var(--status-error)",
          letterSpacing: "0.08em", textTransform: "uppercase",
        }}>
          Danger zone
        </span>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-10)", padding: "14px 18px 16px 18px" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "var(--space-12)" }}>
          <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-1)" }}>
            <span style={{ fontFamily: T.fontBody, fontSize: "var(--font-size-base)", fontWeight: 500, color: T.fg }}>Rebuild edges</span>
            <span style={{ fontFamily: T.fontBody, fontSize: "var(--font-size-sm)", color: T.muted }}>
              {rebuildMsg ?? "Wipe + recompute the edge cache from page bodies."}
            </span>
          </div>
          <button type="button" onClick={doRebuild} disabled={pending} style={{ ...btnGhost, flexShrink: 0, opacity: pending ? 0.6 : 1 }}>
            {pending ? "…" : "Rebuild"}
          </button>
        </div>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "var(--space-12)" }}>
          <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-1)", minWidth: 0 }}>
            <span style={{ fontFamily: T.fontBody, fontSize: "var(--font-size-base)", fontWeight: 500, color: T.fg }}>Reset ingested data</span>
            <span style={{ fontFamily: T.fontBody, fontSize: "var(--font-size-sm)", color: T.muted, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {resetMsg ?? "Wipe pages, edges, sources, and runs. Keeps the character."}
            </span>
          </div>
          <button type="button" onClick={doReset} disabled={resetting} style={{ ...btnDanger, flexShrink: 0, opacity: resetting ? 0.6 : 1 }}>
            {resetting ? "…" : "Reset…"}
          </button>
        </div>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "var(--space-12)" }}>
          <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-1)" }}>
            <span style={{ fontFamily: T.fontBody, fontSize: "var(--font-size-base)", fontWeight: 500, color: T.fg }}>Delete character</span>
            <span style={{ fontFamily: T.fontBody, fontSize: "var(--font-size-sm)", color: T.muted }}>
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
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-2)" }}>
      <span style={{ fontFamily: T.fontHeading, fontSize: 20, fontWeight: 600, color: T.fg, lineHeight: "22px" }}>
        {value}
      </span>
      <span style={{ fontFamily: T.fontMono, fontSize: "var(--font-size-2xs)", fontWeight: 500, color: T.muted, letterSpacing: "0.08em", textTransform: "uppercase" }}>
        {label}
      </span>
    </div>
  );
}

const cardShell: React.CSSProperties = {
  display: "flex", flexDirection: "column",
  background: "var(--card-material, var(--panel))",
  border: "1px solid var(--border-subtle, var(--border))",
  borderRadius: "var(--radius-card, 18px)",
  boxShadow: "var(--elevation-card)",
  overflow: "clip",
};

const btnGhost: React.CSSProperties = {
  padding: "5px 12px", borderRadius: "var(--radius-button, 12px)",
  border: "1px solid var(--input-border)", background: "var(--input-bg)",
  color: "var(--foreground)", fontFamily: T.fontBody, fontSize: "var(--font-size-sm)", cursor: "pointer",
};

const btnPrimary: React.CSSProperties = {
  padding: "6px 16px", borderRadius: "var(--radius-button, 12px)", border: "none",
  background: "var(--emissive-mint)", color: "#07100E",
  fontFamily: T.fontBody, fontSize: "var(--font-size-base)", fontWeight: 600, cursor: "pointer",
};

const btnDanger: React.CSSProperties = {
  padding: "5px 12px", borderRadius: "var(--radius-button, 12px)",
  border: "1px solid var(--critical-border)",
  background: "color-mix(in srgb, var(--status-error) 4%, transparent)", color: "var(--status-error)",
  fontFamily: T.fontBody, fontSize: "var(--font-size-sm)", cursor: "pointer",
};
