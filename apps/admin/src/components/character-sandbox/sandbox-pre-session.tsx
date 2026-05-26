"use client";

import { type ReactNode, useEffect } from "react";
import type {
  SandboxBinding,
  SandboxCharacter,
} from "@/app/(authenticated)/characters/[slug]/sandbox/page";
import type { SandboxMode } from "../character-sandbox";

/**
 * SandboxPreSession - Paper "Sandbox · Pre-Session" direction.
 * A full-height centered character hero sits beside the fixed 420px
 * session-manifest rail. Keyboard: Cmd/Ctrl+Enter launches, Esc cancels.
 */

const FONT_HEAD = "'Inter', system-ui, sans-serif";
const FONT_MONO = "'JetBrains Mono', ui-monospace, monospace";
const ACCENT = "#8FD1CB";
const TEXT_PRIMARY = "#E8EAEC";
const TEXT_MUTED = "#6B7280";
const TEXT_VALUE = "#B8BCC8";
const DANGER = "#ef716b";

export function SandboxPreSession({
  character,
  bindings,
  activeModel,
  mode,
  sessionError,
  onModeChange,
  onStart,
  onCancel,
}: {
  character: SandboxCharacter;
  bindings: SandboxBinding[];
  activeModel: string;
  mode: SandboxMode;
  sessionError: string | null;
  onModeChange: (next: SandboxMode) => void;
  onStart: () => void;
  onCancel: () => void;
}) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        onStart();
      } else if (e.key === "Escape") {
        e.preventDefault();
        onCancel();
      }
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onStart, onCancel]);

  const traits =
    character.identity?.traits?.filter((trait) => trait.name.trim()) ?? [];
  const tones = character.voiceStyle?.tone?.filter((tone) => tone.trim()) ?? [];
  const brevity = character.voiceStyle?.brevity ?? null;
  const formality = character.voiceStyle?.register?.formality ?? 0;
  const warmth = character.voiceStyle?.register?.warmth ?? 0;
  const voiceOverride = character.brainModel?.voice?.model ?? null;
  const boundVoiceSlug = character.voiceSlug;
  const boundVoiceName = character.voiceName;
  const boundVoiceProvider = character.voiceProvider;
  const refusals = character.directive?.scope?.refuse ?? [];
  const nevers = character.directive?.never ?? [];
  const limitCount = refusals.length + nevers.length;
  const essence = character.identity?.essence?.trim();
  const hasIdentity = Boolean(essence) || traits.length > 0;
  const isEmpty =
    !activeModel &&
    !essence &&
    traits.length === 0 &&
    bindings.length === 0 &&
    !boundVoiceSlug;
  const avatarBg = character.image
    ? `center/cover no-repeat url("${character.image}")`
    : "linear-gradient(135deg, #5f573f 0%, #3f3c32 100%)";
  const initial =
    (character.title.trim() || character.slug).charAt(0).toUpperCase() || "?";

  return (
    <div
      style={{
        position: "relative",
        flex: 1,
        minHeight: 0,
        overflow: "hidden",
        display: "flex",
        background: "#0A0B0C",
      }}
    >
      <PaperHero
        character={character}
        avatarBg={avatarBg}
        initial={initial}
        essence={essence}
      />

      <PaperManifestRail
        character={character}
        bindings={bindings}
        activeModel={activeModel}
        mode={mode}
        sessionError={sessionError}
        onModeChange={onModeChange}
        onStart={onStart}
        traits={traits}
        tones={tones}
        brevity={brevity}
        formality={formality}
        warmth={warmth}
        voiceOverride={voiceOverride}
        boundVoiceSlug={boundVoiceSlug}
        boundVoiceName={boundVoiceName}
        boundVoiceProvider={boundVoiceProvider}
        refusals={refusals}
        nevers={nevers}
        limitCount={limitCount}
        hasIdentity={hasIdentity}
        isEmpty={isEmpty}
      />
    </div>
  );
}

function PaperHero({
  character,
  avatarBg,
  initial,
  essence,
}: {
  character: SandboxCharacter;
  avatarBg: string;
  initial: string;
  essence: string | undefined;
}) {
  return (
    <section
      aria-label={`${character.title} pre-session identity`}
      style={{
        flex: 1,
        minWidth: 0,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        paddingBlock: 60,
        paddingInline: 48,
        gap: "var(--space-24)",
      }}
    >
      <div
        style={{
          width: 128,
          height: 128,
          borderRadius: "var(--radius-xl)",
          background: avatarBg,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          flexShrink: 0,
          fontFamily: FONT_HEAD,
          fontSize: 60,
          fontWeight: 600,
          lineHeight: "95%",
          letterSpacing: "-0.04em",
          color: "rgba(231, 210, 140, 0.50)",
          overflow: "hidden",
        }}
      >
        {character.image ? null : initial}
      </div>
      <h1
        style={{
          margin: 0,
          maxWidth: 900,
          fontFamily: FONT_HEAD,
          fontSize: 88,
          fontWeight: 600,
          letterSpacing: "-0.04em",
          lineHeight: "95%",
          color: TEXT_PRIMARY,
          textAlign: "center",
        }}
      >
        {character.title}
      </h1>
      <p
        style={{
          margin: 0,
          maxWidth: 440,
          fontFamily: FONT_HEAD,
          fontSize: 15,
          fontStyle: "italic",
          lineHeight: "155%",
          color: TEXT_MUTED,
          textAlign: "center",
        }}
      >
        {essence ? `“${essence}”` : "No essence set."}
      </p>
    </section>
  );
}

type PaperManifestRailProps = {
  character: SandboxCharacter;
  bindings: SandboxBinding[];
  activeModel: string;
  mode: SandboxMode;
  sessionError: string | null;
  onModeChange: (next: SandboxMode) => void;
  onStart: () => void;
  traits: { name: string }[];
  tones: string[];
  brevity: string | null;
  formality: number;
  warmth: number;
  voiceOverride: string | null;
  boundVoiceSlug: string | null;
  boundVoiceName: string | null;
  boundVoiceProvider: string | null;
  refusals: string[];
  nevers: string[];
  limitCount: number;
  hasIdentity: boolean;
  isEmpty: boolean;
};

function PaperManifestRail({
  character,
  bindings,
  activeModel,
  mode,
  sessionError,
  onModeChange,
  onStart,
  traits,
  tones,
  brevity,
  formality,
  warmth,
  voiceOverride,
  boundVoiceSlug,
  boundVoiceName,
  boundVoiceProvider,
  refusals,
  nevers,
  limitCount,
  hasIdentity,
  isEmpty,
}: PaperManifestRailProps) {
  return (
    <aside
      aria-label="Session manifest"
      style={{
        width: 420,
        flexShrink: 0,
        display: "flex",
        flexDirection: "column",
        background: "#0B0C0D",
        borderLeft: "1px solid rgba(255,255,255,0.10)",
      }}
    >
      <header
        style={{
          padding: "24px 28px 16px",
          display: "flex",
          flexDirection: "column",
          gap: "var(--space-8)",
          borderBottom: "1px solid rgba(255,255,255,0.08)",
        }}
      >
        <span
          style={{
            fontFamily: FONT_MONO,
            fontSize: "var(--font-size-sm)",
            letterSpacing: "0.22em",
            lineHeight: "14px",
            textTransform: "uppercase",
            color: "#8CE7D2",
          }}
        >
          session manifest
        </span>
        <span
          style={{
            fontFamily: FONT_HEAD,
            fontSize: "var(--font-size-4xl)",
            fontWeight: 600,
            letterSpacing: "-0.02em",
            lineHeight: "30px",
            color: TEXT_PRIMARY,
          }}
        >
          v0.3.7 · latest
        </span>
        <span
          style={{
            fontFamily: FONT_MONO,
            fontSize: "var(--font-size-xs)",
            letterSpacing: "0.10em",
            lineHeight: "12px",
            color: TEXT_MUTED,
          }}
        >
          saved just now · {character.slug}
        </span>
      </header>

      <div
        style={{
          flex: 1,
          minHeight: 0,
          overflow: "hidden",
          paddingBlock: "var(--space-6)",
          paddingInline: 28,
        }}
      >
        <ManifestRailRow
          label="identity"
          status={hasIdentity ? "● set" : "not set"}
          tone={hasIdentity ? "accent" : "muted"}
        >
          {traits.length > 0 ? (
            <ManifestRailValue>{traits.map((trait) => trait.name).join(" · ")}</ManifestRailValue>
          ) : (
            <ManifestRailHint>no traits</ManifestRailHint>
          )}
        </ManifestRailRow>

        <ManifestRailRow
          label="voice"
          status={boundVoiceSlug ? "● bound" : "not bound"}
          tone={boundVoiceSlug ? "accent" : "muted"}
        >
          {tones.length > 0 ? (
            <ManifestRailValue>{tones.join(" · ")}</ManifestRailValue>
          ) : (
            <ManifestRailHint>no tones</ManifestRailHint>
          )}
          <ManifestRailHint>
            brevity {brevity ?? "unset"} · form {fmtSigned(formality)} · warmth{" "}
            {fmtSigned(warmth)}
          </ManifestRailHint>
          {boundVoiceSlug ? (
            <ManifestRailHint>
              {boundVoiceName ?? boundVoiceSlug} · {boundVoiceProvider ?? "unknown"}
            </ManifestRailHint>
          ) : null}
        </ManifestRailRow>

        <ManifestRailRow label="mind" status={activeModel ? "● routed" : "not set"} tone={activeModel ? "accent" : "muted"}>
          <ManifestRailValue>{activeModel || "no model set"}</ManifestRailValue>
          <ManifestRailHint>
            voice ▸ {voiceOverride ?? (activeModel || "default")}
          </ManifestRailHint>
        </ManifestRailRow>

        <ManifestRailRow
          label="knowledge"
          status={bindings.length > 0 ? `${bindings.length} bound` : "none"}
          tone={bindings.length > 0 ? "accent" : "muted"}
        >
          {bindings.length === 0 ? (
            <ManifestRailHint>no wikis bound</ManifestRailHint>
          ) : (
            bindings.slice(0, 2).map((binding) => (
              <ManifestRailValue key={binding.slug}>{binding.slug}</ManifestRailValue>
            ))
          )}
          {bindings.length > 2 ? (
            <ManifestRailHint>+ {bindings.length - 2} more</ManifestRailHint>
          ) : null}
        </ManifestRailRow>

        <ManifestRailRow
          label="limits"
          status={
            limitCount > 0
              ? `${limitCount} ${limitCount === 1 ? "rule" : "rules"}`
              : "clear"
          }
          tone={limitCount > 0 ? "danger" : "muted"}
        >
          {limitCount === 0 ? (
            <ManifestRailHint>no limits</ManifestRailHint>
          ) : (
            <>
              {refusals.slice(0, 1).map((refusal) => (
                <ManifestRailValue key={`refuse-${refusal}`} tone="danger">
                  refuse: {refusal}
                </ManifestRailValue>
              ))}
              {nevers.slice(0, 1).map((never) => (
                <ManifestRailValue key={`never-${never}`} tone="danger">
                  never: {never}
                </ManifestRailValue>
              ))}
            </>
          )}
        </ManifestRailRow>

        <ManifestModeRow mode={mode} onChange={onModeChange} />
      </div>

      <footer
        style={{
          padding: "20px 28px 28px",
          display: "flex",
          flexDirection: "column",
          gap: "var(--space-14)",
        }}
      >
        {sessionError ? (
          <div
            role="alert"
            style={{
              border: "1px solid rgba(239,113,107,0.42)",
              borderRadius: "var(--radius-md)",
              padding: "12px 14px",
              background: "rgba(239,113,107,0.08)",
              color: DANGER,
              fontFamily: FONT_MONO,
              fontSize: "var(--font-size-xs)",
              lineHeight: "18px",
            }}
          >
            Session could not start: {sessionError}
          </div>
        ) : null}
        <button
          type="button"
          onClick={onStart}
          style={{
            width: "100%",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: "var(--space-12)",
            padding: "18px 22px",
            borderRadius: "var(--radius-pill)",
            border: "none",
            background: ACCENT,
            color: "#0A0B0C",
            fontFamily: FONT_MONO,
            fontSize: "var(--font-size-md)",
            fontWeight: 700,
            letterSpacing: "0.26em",
            lineHeight: "16px",
            textTransform: "uppercase",
            cursor: "pointer",
            opacity: isEmpty ? 0.82 : 1,
          }}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="#0A0B0C" aria-hidden>
            <path d="M8 5v14l11-7z" />
          </svg>
          start session
        </button>
        <span
          style={{
            fontFamily: FONT_MONO,
            fontSize: "var(--font-size-xs)",
            letterSpacing: "0.14em",
            lineHeight: "12px",
            textAlign: "center",
            textTransform: "uppercase",
            color: TEXT_MUTED,
          }}
        >
          ⌘ ↵ to launch · esc to cancel
        </span>
      </footer>
    </aside>
  );
}

function ManifestRailRow({
  label,
  status,
  tone = "muted",
  children,
}: {
  label: string;
  status?: string;
  tone?: "accent" | "danger" | "muted";
  children: ReactNode;
}) {
  const statusColor =
    tone === "accent" ? ACCENT : tone === "danger" ? DANGER : TEXT_MUTED;

  return (
    <div
      style={{
        display: "flex",
        justifyContent: "space-between",
        gap: "var(--space-12)",
        paddingBlock: "var(--space-14)",
        borderBottom: "1px solid rgba(255,255,255,0.04)",
      }}
    >
      <span
        style={{
          flexShrink: 0,
          fontFamily: FONT_MONO,
          fontSize: "var(--font-size-xs)",
          letterSpacing: "0.20em",
          lineHeight: "12px",
          textTransform: "uppercase",
          color: TEXT_MUTED,
        }}
      >
        {label}
      </span>
      <div
        style={{
          minWidth: 0,
          display: "flex",
          flexDirection: "column",
          alignItems: "flex-end",
          gap: "var(--space-4)",
          textAlign: "right",
        }}
      >
        {children}
        {status ? (
          <span
            style={{
              fontFamily: FONT_MONO,
              fontSize: "var(--font-size-2xs)",
              letterSpacing: "0.18em",
              lineHeight: "12px",
              textTransform: "uppercase",
              color: statusColor,
            }}
          >
            {status}
          </span>
        ) : null}
      </div>
    </div>
  );
}

function ManifestRailValue({
  children,
  tone = "default",
}: {
  children: ReactNode;
  tone?: "default" | "danger";
}) {
  return (
    <span
      style={{
        maxWidth: 232,
        overflow: "hidden",
        textOverflow: "ellipsis",
        whiteSpace: "nowrap",
        fontFamily: FONT_MONO,
        fontSize: "var(--font-size-sm)",
        lineHeight: "14px",
        color: tone === "danger" ? DANGER : TEXT_VALUE,
      }}
    >
      {children}
    </span>
  );
}

function ManifestRailHint({ children }: { children: ReactNode }) {
  return (
    <span
      style={{
        maxWidth: 232,
        overflow: "hidden",
        textOverflow: "ellipsis",
        whiteSpace: "nowrap",
        fontFamily: FONT_MONO,
        fontSize: "var(--font-size-2xs)",
        letterSpacing: "0.06em",
        lineHeight: "12px",
        color: TEXT_MUTED,
      }}
    >
      {children}
    </span>
  );
}

function ManifestModeRow({
  mode,
  onChange,
}: {
  mode: SandboxMode;
  onChange: (next: SandboxMode) => void;
}) {
  return (
    <div
      style={{
        display: "flex",
        justifyContent: "space-between",
        gap: "var(--space-12)",
        marginTop: "var(--space-8)",
        paddingTop: "var(--space-24)",
        paddingBottom: "var(--space-14)",
        borderTop: "1px solid rgba(255,255,255,0.08)",
        borderBottom: "1px solid rgba(255,255,255,0.04)",
      }}
    >
      <span
        style={{
          flexShrink: 0,
          fontFamily: FONT_MONO,
          fontSize: "var(--font-size-xs)",
          letterSpacing: "0.20em",
          lineHeight: "12px",
          textTransform: "uppercase",
          color: TEXT_MUTED,
        }}
      >
        mode
      </span>
      <div style={{ display: "inline-flex", alignItems: "center", gap: "var(--space-8)" }}>
        <ModePill active={mode === "voice"} onClick={() => onChange("voice")}>
          voice
        </ModePill>
        <ModePill active={mode === "chat"} onClick={() => onChange("chat")}>
          chat
        </ModePill>
      </div>
    </div>
  );
}

function ModePill({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "6px 14px",
        borderRadius: "var(--radius-pill)",
        border: active ? `1px solid ${ACCENT}` : "1px solid rgba(255,255,255,0.08)",
        background: active ? "rgba(143,209,203,0.10)" : "transparent",
        color: active ? ACCENT : TEXT_MUTED,
        fontFamily: FONT_MONO,
        fontSize: "var(--font-size-xs)",
        fontWeight: active ? 600 : 400,
        letterSpacing: "0.18em",
        lineHeight: "12px",
        textTransform: "uppercase",
        cursor: "pointer",
      }}
    >
      {children}
    </button>
  );
}

function fmtSigned(n: number): string {
  if (n === 0) return "0.0";
  return (n > 0 ? "+" : "") + n.toFixed(1);
}
