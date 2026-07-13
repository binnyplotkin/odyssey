"use client";

import { type ReactNode, useEffect } from "react";
import { Play } from "react-feather";
import type {
  SandboxBinding,
  SandboxCharacter,
} from "@/app/(authenticated)/characters/[slug]/sandbox/page";

/**
 * SandboxPreSession - cinematic entrance with a glass session manifest.
 * Keyboard: Cmd/Ctrl+Enter launches, Esc cancels.
 */

const FONT_HEAD = "'Inter', system-ui, sans-serif";
const FONT_MONO = "'JetBrains Mono', ui-monospace, monospace";
const ACCENT = "var(--accent-strong)";
const TEXT_MUTED = "var(--text-tertiary)";
const DANGER = "var(--status-error)";

export function SandboxPreSession({
  character,
  bindings,
  activeModel,
  sessionError,
  onStart,
  onCancel,
}: {
  character: SandboxCharacter;
  bindings: SandboxBinding[];
  activeModel: string;
  sessionError: string | null;
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
  return (
    <div
      style={{
        position: "relative",
        isolation: "isolate",
        flex: 1,
        minHeight: 0,
        overflow: "hidden",
        display: "flex",
        backgroundColor: "#050b0c",
        backgroundImage:
          'url("/session-entry-video/kawabunga-intro-poster.jpg?v=1")',
        backgroundPosition: "center",
        backgroundRepeat: "no-repeat",
        backgroundSize: "cover",
      }}
    >
      <PaperHero character={character} />

      <PaperManifestRail
        character={character}
        bindings={bindings}
        activeModel={activeModel}
        sessionError={sessionError}
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
}: {
  character: SandboxCharacter;
}) {
  return (
    <section
      aria-label={`${character.title} session entrance`}
      style={{
        position: "relative",
        zIndex: 0,
        flex: 1,
        minWidth: 0,
        overflow: "hidden",
      }}
    />
  );
}

type PaperManifestRailProps = {
  character: SandboxCharacter;
  bindings: SandboxBinding[];
  activeModel: string;
  sessionError: string | null;
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
  sessionError,
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
        position: "relative",
        zIndex: 100,
        width: "clamp(380px, 29vw, 420px)",
        minHeight: 0,
        flexShrink: 0,
        display: "flex",
        flexDirection: "column",
        margin: 14,
        marginLeft: 0,
        overflow: "hidden",
        border: "1px solid rgba(184, 244, 238, 0.2)",
        borderRadius: 8,
        background:
          "linear-gradient(180deg, rgba(8, 18, 19, 0.78), rgba(5, 12, 14, 0.62))",
        backdropFilter: "blur(26px) saturate(138%)",
        WebkitBackdropFilter: "blur(26px) saturate(138%)",
        boxShadow:
          "-24px 0 64px rgba(0, 0, 0, 0.34), inset 1px 0 rgba(220, 255, 251, 0.08), inset 0 1px rgba(255, 255, 255, 0.05)",
      }}
    >
      <style>{GLASS_MANIFEST_CSS}</style>
      <header
        style={{
          padding: "26px 28px 20px",
          display: "flex",
          flexDirection: "column",
          gap: "var(--space-8)",
          background:
            "linear-gradient(180deg, rgba(218, 255, 250, 0.055), rgba(218, 255, 250, 0))",
          borderBottom: "1px solid rgba(199, 245, 240, 0.12)",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
          }}
        >
          <span
            aria-hidden
            style={{
              width: 7,
              height: 7,
              borderRadius: "50%",
              background: ACCENT,
              boxShadow: "0 0 14px var(--accent-glow)",
            }}
          />
          <span
            style={{
              fontFamily: FONT_MONO,
              fontSize: "var(--font-size-xs)",
              letterSpacing: "0.2em",
              lineHeight: "14px",
              textTransform: "uppercase",
              color: ACCENT,
            }}
          >
            session manifest
          </span>
        </div>
        <span
          style={{
            fontFamily: FONT_HEAD,
            fontSize: 30,
            fontWeight: 600,
            letterSpacing: 0,
            lineHeight: "34px",
            color: "rgba(245, 251, 250, 0.94)",
            textShadow: "0 2px 20px rgba(0, 0, 0, 0.28)",
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
            color: "rgba(205, 222, 220, 0.54)",
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
          paddingBlock: "var(--space-4)",
          paddingInline: 28,
          background: "rgba(0, 0, 0, 0.04)",
        }}
      >
        <ManifestRailRow
          label="identity"
          status={hasIdentity ? "set" : "not set"}
          tone={hasIdentity ? "accent" : "muted"}
        >
          {traits.length > 0 ? (
            <ManifestRailValue>
              {traits.map((trait) => trait.name).join(" · ")}
            </ManifestRailValue>
          ) : (
            <ManifestRailHint>no traits</ManifestRailHint>
          )}
        </ManifestRailRow>

        <ManifestRailRow
          label="voice"
          status={boundVoiceSlug ? "bound" : "not bound"}
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
              {boundVoiceName ?? boundVoiceSlug} ·{" "}
              {boundVoiceProvider ?? "unknown"}
            </ManifestRailHint>
          ) : null}
        </ManifestRailRow>

        <ManifestRailRow
          label="mind"
          status={activeModel ? "routed" : "not set"}
          tone={activeModel ? "accent" : "muted"}
        >
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
            bindings
              .slice(0, 2)
              .map((binding) => (
                <ManifestRailValue key={binding.slug}>
                  {binding.slug}
                </ManifestRailValue>
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
      </div>

      <footer
        style={{
          position: "relative",
          zIndex: 101,
          padding: "20px 28px 28px",
          display: "flex",
          flexDirection: "column",
          gap: "var(--space-14)",
          background:
            "linear-gradient(180deg, rgba(4, 11, 13, 0.18), rgba(4, 10, 12, 0.52))",
          borderTop: "1px solid rgba(199, 245, 240, 0.12)",
        }}
      >
        {sessionError ? (
          <div
            role="alert"
            style={{
              border: "1px solid var(--critical-border)",
              borderRadius: "var(--radius-md)",
              padding: "12px 14px",
              background: "var(--critical-wash)",
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
          className="session-launch-button"
          style={{
            width: "100%",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: "var(--space-12)",
            padding: "18px 22px",
            borderRadius: "var(--radius-pill)",
            border: "1px solid rgba(220, 255, 251, 0.54)",
            background: "rgba(136, 216, 208, 0.96)",
            color: "var(--accent-on)",
            fontFamily: FONT_MONO,
            fontSize: "var(--font-size-md)",
            fontWeight: 700,
            letterSpacing: "0.26em",
            lineHeight: "16px",
            textTransform: "uppercase",
            cursor: "pointer",
            opacity: isEmpty ? 0.82 : 1,
            boxShadow:
              "0 12px 30px rgba(40, 151, 143, 0.2), inset 0 1px rgba(255, 255, 255, 0.45)",
          }}
        >
          <Play size={14} fill="currentColor" aria-hidden />
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
          ⌘ ↵ to launch&nbsp;&nbsp;·&nbsp;&nbsp;esc to cancel
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
        borderBottom: "1px solid rgba(206, 245, 240, 0.09)",
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
          color: "rgba(203, 220, 218, 0.5)",
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
              display: "inline-flex",
              alignItems: "center",
              gap: 7,
            }}
          >
            {tone !== "muted" ? (
              <span
                aria-hidden
                style={{
                  width: 5,
                  height: 5,
                  borderRadius: "50%",
                  background: statusColor,
                  boxShadow:
                    tone === "accent"
                      ? "0 0 10px var(--accent-glow)"
                      : undefined,
                }}
              />
            ) : null}
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
        color:
          tone === "danger" ? DANGER : "rgba(226, 236, 234, 0.76)",
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
        color: "rgba(193, 211, 208, 0.48)",
      }}
    >
      {children}
    </span>
  );
}

function fmtSigned(n: number): string {
  if (n === 0) return "0.0";
  return (n > 0 ? "+" : "") + n.toFixed(1);
}

const GLASS_MANIFEST_CSS = `
.session-launch-button {
  transition: transform 160ms ease, box-shadow 160ms ease, background 160ms ease;
}
.session-launch-button:hover {
  transform: translateY(-1px);
  background: rgba(154, 229, 222, 1) !important;
  box-shadow: 0 16px 38px rgba(40, 151, 143, 0.28), inset 0 1px rgba(255, 255, 255, 0.52) !important;
}
.session-launch-button:active {
  transform: translateY(0);
}
.session-launch-button:focus-visible {
  outline: 2px solid rgba(184, 244, 238, 0.9);
  outline-offset: 3px;
}
`;
