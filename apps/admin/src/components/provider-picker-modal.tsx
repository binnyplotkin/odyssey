"use client";

import { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import type { VoiceProvider } from "@odyssey/db";

/* ── Tokens ─────────────────────────────────────────────────── */

const FONT_HEAD = "'Inter', system-ui, sans-serif";
const FONT_DISPLAY = "'Space Grotesk', system-ui, sans-serif";
const FONT_MONO = "'JetBrains Mono', ui-monospace, monospace";

/* ── Types ──────────────────────────────────────────────────── */

export type ProviderAvailability = {
  provider: VoiceProvider;
  configured: boolean;
  envKey: string | null;
};

type ProviderMeta = {
  title: string;
  blurb: string;
  pricing: string;
  modelHint: string;
  /** Doc URL surfaced on the NOT_CONFIGURED state next to the env-key hint. */
  docsUrl?: string;
};

const PROVIDER_META: Record<VoiceProvider, ProviderMeta> = {
  pocket_tts: {
    title: "Pocket TTS",
    blurb: "Clone from your audio. Self-hosted on Railway.",
    pricing: "Free",
    modelHint: "~15s extract",
  },
  elevenlabs: {
    title: "ElevenLabs",
    blurb: "Cloud-hosted. Preset library + voice cloning.",
    pricing: "~$0.18 / 1k chars",
    modelHint: "Flash v2.5",
    docsUrl: "https://elevenlabs.io/docs",
  },
  openai: {
    title: "OpenAI",
    blurb: "Six preset voices. No clone.",
    pricing: "~$0.15 / 1k chars",
    modelHint: "gpt-4o-mini-tts",
    docsUrl: "https://platform.openai.com/docs/guides/text-to-speech",
  },
  cartesia: {
    title: "Cartesia",
    blurb: "Lowest-latency cloud TTS. Preset library.",
    pricing: "~$0.10 / 1k chars",
    modelHint: "Sonic 2",
    docsUrl: "https://docs.cartesia.ai/",
  },
};

/** Order matches the brand-guide picker design: Pocket first (default
 * free path), then hosted in ascending price order. */
const PROVIDER_ORDER: VoiceProvider[] = [
  "pocket_tts",
  "elevenlabs",
  "openai",
  "cartesia",
];

/** Env-var name surfaced for each provider's "not configured" hint.
 * Mirrors the server response so we can render the tiles with full
 * content *before* the fetch lands — only the `configured` boolean
 * needs the network round-trip. */
const PROVIDER_ENV_KEY: Record<VoiceProvider, string | null> = {
  pocket_tts: null,
  elevenlabs: "ELEVENLABS_API_KEY",
  openai: "OPENAI_API_KEY",
  cartesia: "CARTESIA_API_KEY",
};

/** Module-scoped cache. `configured` is purely an env-var check on
 * the server, so its value is stable for the lifetime of the page.
 * The first picker-open does the fetch; later opens hydrate from
 * cache and skip the network entirely. */
let providersCache: ProviderAvailability[] | null = null;

export type ProviderPickerModalProps = {
  open: boolean;
  onClose: () => void;
  onPick: (provider: VoiceProvider) => void;
  /** Fires when the availability fetch reports exactly one configured
   * provider. The parent should close the picker and route directly to
   * that provider's form — avoiding the one-option picker UX. */
  onSmartDefault?: (provider: VoiceProvider) => void;
};

/* ── Component ──────────────────────────────────────────────── */

export function ProviderPickerModal({
  open,
  onClose,
  onPick,
  onSmartDefault,
}: ProviderPickerModalProps) {
  // Seed from the module cache so a second open is instant. On first
  // open this is null and we render an optimistic "checking" status on
  // each tile while the fetch resolves — tile content (title, blurb,
  // pricing) shows immediately since it's all static.
  const [providers, setProviders] = useState<ProviderAvailability[] | null>(
    providersCache,
  );
  const [loadError, setLoadError] = useState<string | null>(null);

  // Fetch availability on open if we don't have it cached yet. The
  // picker stays mounted on close, but the cache lives at module scope
  // so the network call only fires once per page lifetime.
  useEffect(() => {
    if (!open) return;
    if (providersCache) {
      // Already cached — still check for smart-default on this open.
      const configured = providersCache.filter((p) => p.configured);
      if (configured.length === 1 && onSmartDefault) {
        queueMicrotask(() => onSmartDefault(configured[0].provider));
      }
      return;
    }
    let cancelled = false;
    setLoadError(null);
    fetch("/api/voices/providers")
      .then((r) => r.json())
      .then((data: { providers: ProviderAvailability[] }) => {
        if (cancelled) return;
        providersCache = data.providers;
        setProviders(data.providers);
        // Smart default — if exactly one provider is configured, route
        // straight to its form instead of showing a one-option picker.
        // Defers to the next microtask so the parent state setter sees
        // a fresh tick (avoids a render-during-render warning).
        const configured = data.providers.filter((p) => p.configured);
        if (configured.length === 1 && onSmartDefault) {
          queueMicrotask(() => {
            if (!cancelled) onSmartDefault(configured[0].provider);
          });
        }
      })
      .catch((err) => {
        if (cancelled) return;
        setLoadError((err as Error).message);
      });
    return () => {
      cancelled = true;
    };
  }, [open, onSmartDefault]);

  // Keyboard: Esc closes.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  const handlePick = useCallback(
    (p: ProviderAvailability) => {
      if (!p.configured) return;
      onPick(p.provider);
    },
    [onPick],
  );

  if (!open) return null;

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="provider-picker-title"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 1100,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "var(--space-24)",
        background: "var(--modal-backdrop)",
        backdropFilter: "blur(2px)",
      }}
    >
      <div
        style={{
          width: 560,
          maxWidth: "100%",
          display: "flex",
          flexDirection: "column",
          background: "var(--background)",
          border: "1px solid var(--border)",
          borderRadius: "var(--radius-xl)",
          boxShadow: "var(--elevation-panel)",
        }}
      >
        {/* Header */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "20px 22px 18px 22px",
          }}
        >
          <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-4)" }}>
            <div
              id="provider-picker-title"
              style={{
                fontFamily: FONT_DISPLAY,
                fontSize: "var(--font-size-2xl)",
                fontWeight: 600,
                letterSpacing: "-0.01em",
                color: "var(--text-primary)",
              }}
            >
              + new voice
            </div>
            <div
              style={{
                fontFamily: FONT_HEAD,
                fontSize: "var(--font-size-base)",
                color: "var(--text-tertiary)",
              }}
            >
              Pick a provider to continue
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              width: 28,
              height: 28,
              borderRadius: "var(--radius-md)",
              border: "none",
              background: "transparent",
              color: "var(--text-tertiary)",
              cursor: "pointer",
            }}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <line x1="6" y1="6" x2="18" y2="18" />
              <line x1="18" y1="6" x2="6" y2="18" />
            </svg>
          </button>
        </div>

        {/* Tile Grid */}
        <div style={{ padding: "0 22px 18px 22px" }}>
          {loadError ? (
            <div
              style={{
                padding: "20px 16px",
                border:
                  "1px solid var(--critical-border)",
                background:
                  "var(--critical-wash)",
                borderRadius: "var(--radius-md)",
                fontFamily: FONT_MONO,
                fontSize: "var(--font-size-base)",
                color: "var(--status-error)",
              }}
            >
              {loadError}
            </div>
          ) : (
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "1fr 1fr",
                gap: "var(--space-12)",
              }}
            >
              {PROVIDER_ORDER.map((id) => {
                // Render tiles immediately. Until the fetch lands we
                // show a "checking" status pill on each tile — the rest
                // of the content (title, blurb, pricing, env-key hint)
                // is fully static and doesn't need to wait.
                const row: ProviderAvailability | null =
                  providers?.find((r) => r.provider === id) ?? null;
                return (
                  <ProviderTile
                    key={id}
                    provider={id}
                    row={row}
                    meta={PROVIDER_META[id]}
                    onPick={() => row && handlePick(row)}
                  />
                );
              })}
            </div>
          )}
        </div>

        {/* Footer hint */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "var(--space-8)",
            padding: "12px 22px 16px 22px",
            borderTop: "1px solid var(--border-subtle)",
            fontFamily: FONT_MONO,
            fontSize: "var(--font-size-sm)",
            color: "var(--text-quaternary)",
          }}
        >
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="10" />
            <line x1="12" y1="16" x2="12" y2="12" />
            <line x1="12" y1="8" x2="12.01" y2="8" />
          </svg>
          <span>
            Bound voices route by provider at synth time — characters can mix
            freely.
          </span>
        </div>
      </div>
    </div>,
    document.body,
  );
}

/* ── Tile ───────────────────────────────────────────────────── */

function ProviderTile({
  provider,
  row,
  meta,
  onPick,
}: {
  provider: VoiceProvider;
  /** Null while the availability fetch is in flight on first open. */
  row: ProviderAvailability | null;
  meta: ProviderMeta;
  onPick: () => void;
}) {
  // While loading we render the tile dimmed and inert — same visual as
  // "not configured" but with a "checking" pill that morphs into
  // "ready" / "not configured" once the fetch resolves. Pocket TTS is
  // always configured (no key required) so it can render hot path even
  // before the fetch lands.
  const checking = row === null;
  const configured = checking
    ? provider === "pocket_tts"
    : row.configured;
  const envKey = row?.envKey ?? PROVIDER_ENV_KEY[provider];
  const [hovered, setHovered] = useState(false);
  // During `checking` we treat every tile as "presentationally bright"
  // (full text colour, no dimming) so the picker reads as instantly
  // populated — the pulsing pill is the only signal that we're still
  // resolving. Hover effects are suppressed since clicks are inert.
  const visuallyBright = configured || checking;
  const accentBorder =
    configured && hovered && !checking
      ? "color-mix(in srgb, var(--accent-strong) 50%, transparent)"
      : "var(--border-subtle)";
  const accentBg =
    configured && hovered && !checking
      ? "var(--accent-wash)"
      : "var(--ink-wash)";

  return (
    <button
      type="button"
      onClick={onPick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      disabled={!configured || checking}
      style={{
        display: "flex",
        flexDirection: "column",
        gap: "var(--space-10)",
        padding: "var(--space-16)",
        textAlign: "left",
        borderRadius: "var(--radius-xl)",
        border: `1px solid ${accentBorder}`,
        background: accentBg,
        cursor: configured ? "pointer" : "default",
        opacity: visuallyBright ? 1 : 0.85,
        transition: "background 120ms, border-color 120ms",
      }}
    >
      {/* Head */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: "var(--space-10)",
        }}
      >
        <div
          aria-hidden
          style={{
            width: 32,
            height: 32,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            borderRadius: "var(--radius-md)",
            background: visuallyBright
              ? "color-mix(in srgb, var(--accent-strong) 18%, transparent)"
              : "var(--ink-soft)",
            border: `1px solid ${
              visuallyBright
                ? "color-mix(in srgb, var(--accent-strong) 32%, transparent)"
                : "var(--border-subtle)"
            }`,
          }}
        >
          <svg width="14" height="10" viewBox="0 0 24 24" fill="none" stroke={visuallyBright ? "var(--accent-strong)" : "var(--text-quaternary)"} strokeWidth="2.4" strokeLinecap="round">
            <rect x="3" y="10" width="2" height="4" />
            <rect x="7" y="8" width="2" height="8" />
            <rect x="11" y="4" width="2" height="16" />
            <rect x="15" y="7" width="2" height="10" />
            <rect x="19" y="3" width="2" height="18" />
          </svg>
        </div>
        <StatusPill configured={configured} checking={checking} />
      </div>

      {/* Body */}
      <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-6)" }}>
        <div
          style={{
            fontFamily: FONT_DISPLAY,
            fontSize: 15,
            fontWeight: 600,
            letterSpacing: "-0.01em",
            color: visuallyBright
              ? "var(--text-primary)"
              : "var(--text-tertiary)",
          }}
        >
          {meta.title}
        </div>
        <div
          style={{
            fontFamily: FONT_HEAD,
            fontSize: "var(--font-size-base)",
            lineHeight: "18px",
            color: visuallyBright
              ? "var(--text-secondary)"
              : "var(--text-quaternary)",
            minHeight: 32,
          }}
        >
          {meta.blurb}
        </div>
      </div>

      {/* Foot */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginTop: "var(--space-4)",
          fontFamily: FONT_MONO,
          fontSize: "var(--font-size-xs)",
          color: visuallyBright
            ? "var(--text-tertiary)"
            : "var(--text-quaternary)",
        }}
      >
        {configured || checking ? (
          <>
            <span>{meta.pricing}</span>
            <span style={{ color: "var(--text-quaternary)" }}>
              {meta.modelHint}
            </span>
          </>
        ) : (
          <span
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: "var(--space-6)",
              flexWrap: "wrap",
            }}
          >
            <span style={{ color: "var(--text-quaternary)" }}>Set</span>
            <code
              style={{
                fontFamily: FONT_MONO,
                fontSize: "var(--font-size-xs)",
                color: "var(--text-tertiary)",
              }}
            >
              {envKey}
            </code>
            {meta.docsUrl && (
              <a
                href={meta.docsUrl}
                target="_blank"
                rel="noopener noreferrer"
                onClick={(e) => e.stopPropagation()}
                style={{
                  color: "var(--accent-strong)",
                  textDecoration: "none",
                }}
              >
                How to enable →
              </a>
            )}
          </span>
        )}
      </div>
    </button>
  );
}

function StatusPill({
  configured,
  checking = false,
}: {
  configured: boolean;
  /** True while the availability fetch is still in flight. Renders a
   * subtle pulsing "checking" pill so the tile reads as alive rather
   * than mislabelling itself ready or not-configured prematurely. */
  checking?: boolean;
}) {
  const color = checking
    ? "var(--text-quaternary)"
    : configured
      ? "var(--accent-strong)"
      : "var(--text-quaternary)";
  const label = checking ? "checking" : configured ? "ready" : "not configured";
  return (
    <>
      {checking && (
        <style>{`@keyframes provider-pill-pulse{0%,100%{opacity:0.55}50%{opacity:1}}`}</style>
      )}
      <span
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: "var(--space-6)",
          padding: "2px 8px",
          borderRadius: "var(--radius-pill)",
          border: `1px solid ${configured && !checking ? "var(--accent-border)" : "var(--ink-line)"}`,
          background:
            configured && !checking
              ? "var(--accent-fill)"
              : "transparent",
          fontFamily: FONT_MONO,
          fontSize: "var(--font-size-2xs)",
          fontWeight: 600,
          letterSpacing: "0.18em",
          textTransform: "uppercase",
          color,
          animation: checking
            ? "provider-pill-pulse 1100ms ease-in-out infinite"
            : "none",
        }}
      >
        <span
          style={{
            width: 5,
            height: 5,
            borderRadius: "var(--radius-pill)",
            background: color,
          }}
        />
        {label}
      </span>
    </>
  );
}
