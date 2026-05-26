"use client";

import { type ReactNode } from "react";
import type {
  SandboxBinding,
  SandboxCharacter,
} from "@/app/(authenticated)/characters/[slug]/sandbox/page";
import type { SandboxTurn } from "../character-sandbox";

/**
 * SandboxConfigSidebar — the live "what the model sees" config snapshot
 * pinned to the right edge. Each section is a derivation of the character's
 * persisted config (Identity / Voice / Mind / Knowledge / Limits) so the
 * author can verify the prompt envelope while running the sandbox.
 *
 * Sections render section-by-section so dropping a config piece
 * (e.g. no voice style yet) yields an "empty" status pill instead of a
 * collapsed surface.
 */

const FONT_HEAD = "'Inter', system-ui, sans-serif";
const FONT_MONO = "'JetBrains Mono', ui-monospace, monospace";
const ACCENT = "var(--accent-strong)";
const DANGER = "var(--danger)";

export function SandboxConfigSidebar({
  character,
  bindings,
  activeModel,
  lastTurn,
  savedTurnIds,
  onSaveExample,
}: {
  character: SandboxCharacter;
  bindings: SandboxBinding[];
  activeModel: string;
  lastTurn: SandboxTurn | null;
  savedTurnIds: Set<string>;
  onSaveExample: (characterTurnId: string) => void;
}) {
  const essence = character.identity?.essence ?? "";
  const traits =
    character.identity?.traits?.filter((t) => t.name.trim()) ?? [];
  const tones = character.voiceStyle?.tone?.filter((t) => t.trim()) ?? [];
  const brevity = character.voiceStyle?.brevity ?? null;
  const formality = character.voiceStyle?.register?.formality ?? 0;
  const warmth = character.voiceStyle?.register?.warmth ?? 0;
  const voiceOverride = character.brainModel?.voice?.model ?? null;
  const refusals = character.directive?.scope?.refuse ?? [];
  const nevers = character.directive?.never ?? [];

  const identityStatus: SectionStatus =
    essence || traits.length > 0 ? "set" : "empty";
  const voiceStatus: SectionStatus =
    tones.length > 0 || brevity != null ? "set" : "empty";
  const mindStatus: SectionStatus = activeModel ? "set" : "empty";
  const knowledgeStatus: SectionStatus =
    bindings.length > 0 ? "set" : "empty";
  const limitsStatus: SectionStatus =
    refusals.length > 0 || nevers.length > 0 ? "set" : "empty";

  const lastFacts = lastTurn?.factsRecalled ?? 0;

  return (
    <aside
      style={{
        width: 360,
        flexShrink: 0,
        borderLeft: "1px solid var(--border)",
        background: "var(--background)",
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
      }}
    >
      <header
        style={{
          padding: "20px 24px 16px",
          borderBottom: "1px solid var(--border)",
          display: "flex",
          flexDirection: "column",
          gap: "var(--space-6)",
        }}
      >
        <span
          style={{
            fontFamily: FONT_MONO,
            fontSize: "var(--font-size-sm)",
            letterSpacing: "0.18em",
            textTransform: "uppercase",
            color: ACCENT,
          }}
        >
          config snapshot
        </span>
        <span
          style={{
            fontFamily: FONT_MONO,
            fontSize: "var(--font-size-xs)",
            letterSpacing: "0.10em",
            color: "var(--text-tertiary)",
          }}
        >
          what the model sees · live
        </span>
      </header>

      <div
        style={{
          flex: 1,
          minHeight: 0,
          overflow: "auto",
          padding: "20px 24px",
          display: "flex",
          flexDirection: "column",
          gap: "var(--space-24)",
        }}
      >
        <Section label="identity" status={identityStatus}>
          {essence ? (
            <p
              style={{
                margin: 0,
                fontFamily: FONT_HEAD,
                fontSize: "var(--font-size-md)",
                lineHeight: "20px",
                color: "var(--text-secondary)",
              }}
            >
              {essence}
            </p>
          ) : (
            <Hint>no essence written yet</Hint>
          )}
          {traits.length > 0 && (
            <div
              style={{
                display: "flex",
                flexWrap: "wrap",
                gap: "var(--space-8)",
                paddingTop: "var(--space-4)",
              }}
            >
              {traits.map((t) => (
                <MintChip key={t.name}>{t.name}</MintChip>
              ))}
            </div>
          )}
        </Section>

        <Section label="voice & style" status={voiceStatus}>
          {tones.length > 0 ? (
            <div style={{ display: "flex", flexWrap: "wrap", gap: "var(--space-6)" }}>
              {tones.map((t) => (
                <NeutralChip key={t}>{t}</NeutralChip>
              ))}
            </div>
          ) : (
            <Hint>no tones</Hint>
          )}
          <div
            style={{
              display: "flex",
              gap: "var(--space-12)",
              fontFamily: FONT_MONO,
              fontSize: "var(--font-size-xs)",
              color: "var(--text-tertiary)",
              letterSpacing: "0.06em",
              paddingTop: "var(--space-2)",
            }}
          >
            {brevity && <span>brevity {brevity}</span>}
            <span>
              formality{" "}
              <span style={{ color: "var(--text-secondary)" }}>
                {fmtSigned(formality)}
              </span>
            </span>
            <span>
              warmth{" "}
              <span style={{ color: "var(--text-secondary)" }}>
                {fmtSigned(warmth)}
              </span>
            </span>
          </div>
        </Section>

        <Section label="mind" status={mindStatus}>
          <span
            style={{
              fontFamily: FONT_MONO,
              fontSize: "var(--font-size-base)",
              color: "var(--text-primary)",
            }}
          >
            {activeModel}
          </span>
          {voiceOverride && (
            <span
              style={{
                fontFamily: FONT_MONO,
                fontSize: "var(--font-size-xs)",
                letterSpacing: "0.10em",
                color: "var(--text-tertiary)",
              }}
            >
              voice override · {voiceOverride}
            </span>
          )}
        </Section>

        <Section
          label="knowledge · per turn"
          statusLabel={
            knowledgeStatus === "empty"
              ? "none"
              : lastFacts > 0
                ? `${lastFacts} hits`
                : `${bindings.length} bound`
          }
          status={knowledgeStatus}
        >
          {bindings.length === 0 ? (
            <Hint>no wikis bound</Hint>
          ) : lastFacts > 0 ? (
            <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-8)" }}>
              {/* Mock recalled-fact cards until real per-turn retrieval is
                  wired into the sandbox. Order is presentational only. */}
              <RetrievedFactCard
                slug="ur-of-the-chaldees"
                snippet="Birthplace of Abraham. Departed by divine call (Gen 11:31)."
              />
              {lastFacts > 1 && (
                <RetrievedFactCard
                  slug="the-call-at-haran"
                  snippet={
                    '"Get thee out of thy country" — the voice that initiated migration.'
                  }
                />
              )}
            </div>
          ) : (
            <Hint>no facts recalled on last turn</Hint>
          )}
        </Section>

        <Section
          label="limits"
          statusLabel={
            refusals.length + nevers.length === 0
              ? "none"
              : `${refusals.length + nevers.length} rules`
          }
          status={limitsStatus}
        >
          {refusals.length === 0 && nevers.length === 0 ? (
            <Hint>no limits set</Hint>
          ) : (
            <div style={{ display: "flex", flexWrap: "wrap", gap: "var(--space-6)" }}>
              {refusals.map((r) => (
                <DangerChip key={`refuse-${r}`}>refuse: {r}</DangerChip>
              ))}
              {nevers.map((r) => (
                <DangerChip key={`never-${r}`}>never: {r}</DangerChip>
              ))}
            </div>
          )}
        </Section>
      </div>

      <footer
        style={{
          padding: "16px 24px",
          borderTop: "1px solid var(--border)",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          flexShrink: 0,
        }}
      >
        <span
          style={{
            fontFamily: FONT_MONO,
            fontSize: "var(--font-size-xs)",
            letterSpacing: "0.14em",
            textTransform: "uppercase",
            color: "var(--text-tertiary)",
          }}
        >
          {lastTurn ? `last turn · ${turnAgo(lastTurn)}` : "no turns yet"}
        </span>
        <button
          type="button"
          disabled={
            !lastTurn ||
            lastTurn.speaker !== "character" ||
            lastTurn.inFlight ||
            savedTurnIds.has(lastTurn.id)
          }
          onClick={() => lastTurn && onSaveExample(lastTurn.id)}
          style={{
            padding: "7px 14px",
            border:
              lastTurn && savedTurnIds.has(lastTurn.id)
                ? "1px solid color-mix(in srgb, var(--accent-strong) 60%, transparent)"
                : "1px solid color-mix(in srgb, var(--accent-strong) 35%, transparent)",
            background:
              lastTurn && savedTurnIds.has(lastTurn.id)
                ? "color-mix(in srgb, var(--accent-strong) 18%, transparent)"
                : "transparent",
            color: ACCENT,
            fontFamily: FONT_MONO,
            fontSize: "var(--font-size-xs)",
            letterSpacing: "0.14em",
            textTransform: "uppercase",
            cursor:
              !lastTurn ||
              lastTurn.speaker !== "character" ||
              lastTurn.inFlight
                ? "not-allowed"
                : "pointer",
            opacity:
              !lastTurn || lastTurn.speaker !== "character"
                ? 0.5
                : 1,
          }}
        >
          {lastTurn && savedTurnIds.has(lastTurn.id)
            ? "✓ saved as example"
            : "+ save as example"}
        </button>
      </footer>
    </aside>
  );
}

/* ── Section primitives ───────────────────────────────────────── */

type SectionStatus = "set" | "empty";

function Section({
  label,
  status,
  statusLabel,
  children,
}: {
  label: string;
  status: SectionStatus;
  statusLabel?: string;
  children: ReactNode;
}) {
  return (
    <section style={{ display: "flex", flexDirection: "column", gap: "var(--space-8)" }}>
      <header
        style={{
          display: "flex",
          alignItems: "baseline",
          justifyContent: "space-between",
        }}
      >
        <span
          style={{
            fontFamily: FONT_MONO,
            fontSize: "var(--font-size-2xs)",
            letterSpacing: "0.20em",
            textTransform: "uppercase",
            color: "var(--text-tertiary)",
          }}
        >
          {label}
        </span>
        <StatusPill status={status} statusLabel={statusLabel} />
      </header>
      {children}
    </section>
  );
}

function StatusPill({
  status,
  statusLabel,
}: {
  status: SectionStatus;
  statusLabel?: string;
}) {
  const isSet = status === "set";
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: "var(--space-6)",
        fontFamily: FONT_MONO,
        fontSize: "var(--font-size-2xs)",
        letterSpacing: "0.18em",
        textTransform: "uppercase",
        color: isSet ? ACCENT : "var(--text-tertiary)",
      }}
    >
      <span
        style={{
          width: 6,
          height: 6,
          borderRadius: "50%",
          background: isSet ? ACCENT : "var(--text-quaternary)",
          boxShadow: isSet ? `0 0 8px ${ACCENT}` : undefined,
        }}
      />
      {statusLabel ?? (isSet ? "set" : "empty")}
    </span>
  );
}

function MintChip({ children }: { children: ReactNode }) {
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: "var(--space-6)",
        padding: "3px 10px",
        background: "color-mix(in srgb, var(--accent-strong) 12%, transparent)",
        border:
          "1px solid var(--accent-border)",
        fontFamily: FONT_MONO,
        fontSize: "var(--font-size-xs)",
        letterSpacing: "0.10em",
        textTransform: "uppercase",
        color: ACCENT,
      }}
    >
      {children}
    </span>
  );
}

function NeutralChip({ children }: { children: ReactNode }) {
  return (
    <span
      style={{
        padding: "3px 10px",
        background: "var(--card-hover)",
        border: "1px solid var(--border)",
        fontFamily: FONT_MONO,
        fontSize: "var(--font-size-xs)",
        color: "var(--text-secondary)",
      }}
    >
      {children}
    </span>
  );
}

function DangerChip({ children }: { children: ReactNode }) {
  return (
    <span
      style={{
        padding: "3px 10px",
        background: `color-mix(in srgb, ${DANGER} 10%, transparent)`,
        border: `1px solid color-mix(in srgb, ${DANGER} 28%, transparent)`,
        fontFamily: FONT_MONO,
        fontSize: "var(--font-size-xs)",
        letterSpacing: "0.08em",
        textTransform: "uppercase",
        color: DANGER,
      }}
    >
      {children}
    </span>
  );
}

function RetrievedFactCard({
  slug,
  snippet,
}: {
  slug: string;
  snippet: string;
}) {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: "var(--space-4)",
        padding: "10px 12px",
        background: "color-mix(in srgb, var(--accent-strong) 4%, transparent)",
        border:
          "1px solid color-mix(in srgb, var(--accent-strong) 18%, transparent)",
      }}
    >
      <span
        style={{
          fontFamily: FONT_MONO,
          fontSize: "var(--font-size-xs)",
          letterSpacing: "0.08em",
          color: ACCENT,
        }}
      >
        → {slug}
      </span>
      <span
        style={{
          fontFamily: FONT_HEAD,
          fontSize: "var(--font-size-sm)",
          color: "var(--text-secondary)",
          lineHeight: 1.5,
        }}
      >
        {snippet}
      </span>
    </div>
  );
}

function Hint({ children }: { children: ReactNode }) {
  return (
    <span
      style={{
        fontFamily: FONT_MONO,
        fontSize: "var(--font-size-sm)",
        color: "var(--text-quaternary)",
        letterSpacing: "0.04em",
      }}
    >
      {children}
    </span>
  );
}

/* ── Helpers ──────────────────────────────────────────────────── */

function fmtSigned(n: number): string {
  if (n === 0) return "0.0";
  return (n > 0 ? "+" : "") + n.toFixed(1);
}

function turnAgo(turn: SandboxTurn): string {
  // Rough relative — based on stored timestampMs which is offset from session
  // start. Render as "Xs ago" since the strip already gives absolute clock.
  return `${Math.round(turn.timestampMs / 1000)}s in`;
}
