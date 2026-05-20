"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { VoiceStatus } from "@odyssey/db";
import { useHeaderContent } from "@/components/header-context";
import { resolveAvatarGradient } from "@/lib/avatar-gradients";
import type {
  VoiceDetailBindings,
  VoiceDetailData,
} from "@/app/(authenticated)/voices/[slug]/page";

/* ── Tokens ───────────────────────────────────────────────────── */

const FONT_HEAD = "'Inter', system-ui, sans-serif";
const FONT_MONO = "'JetBrains Mono', ui-monospace, monospace";

const STATUS_COLORS: Record<VoiceStatus, string> = {
  ready: "var(--accent-strong)",
  processing: "#FACC15",
  failed: "#E8A0A0",
  uploaded: "var(--text-tertiary)",
};

const STATUS_LABELS: Record<VoiceStatus, string> = {
  ready: "ready",
  processing: "extracting",
  failed: "failed",
  uploaded: "uploaded",
};

/* ── Component ────────────────────────────────────────────────── */

type Props = {
  voice: VoiceDetailData;
  bindings: VoiceDetailBindings;
  sourceUrl: string | null;
  embeddingUrl: string | null;
  previewUrl: string | null;
};

export function VoiceDetail({
  voice,
  bindings,
  sourceUrl,
  embeddingUrl,
  previewUrl,
}: Props) {
  const router = useRouter();
  const [actionPending, setActionPending] = useState<
    "extract" | "delete" | null
  >(null);
  const [actionError, setActionError] = useState<string | null>(null);

  /* While processing, poll the server every 3s so the user sees the result
   * land without a manual refresh. router.refresh() re-runs the RSC and
   * re-hydrates this component with the new status. */
  useEffect(() => {
    if (voice.status !== "processing") return;
    const id = setInterval(() => router.refresh(), 3000);
    return () => clearInterval(id);
  }, [voice.status, router]);

  /* ── Header injection ─────────────────────────────────────── */

  const { setContent } = useHeaderContent();
  useEffect(() => {
    const color = STATUS_COLORS[voice.status];
    const label = STATUS_LABELS[voice.status];
    const stamp = relativeFromIso(
      voice.status === "processing" ? voice.updatedAt : voice.updatedAt,
    );
    setContent(
      <>
        <span
          style={{
            fontFamily: FONT_MONO,
            fontSize: 11,
            letterSpacing: "0.14em",
            textTransform: "uppercase",
            color: "var(--text-tertiary)",
            whiteSpace: "nowrap",
          }}
        >
          voices
        </span>
        <span
          style={{
            fontFamily: FONT_MONO,
            fontSize: 11,
            letterSpacing: "0.14em",
            textTransform: "uppercase",
            color: "var(--text-tertiary)",
          }}
        >
          /
        </span>
        <span
          style={{
            fontFamily: FONT_MONO,
            fontSize: 11,
            letterSpacing: "0.18em",
            textTransform: "uppercase",
            color: "var(--accent-strong)",
            whiteSpace: "nowrap",
          }}
        >
          {voice.slug}
        </span>
        <div style={{ flex: 1 }} />
        <span
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 8,
            fontFamily: FONT_MONO,
            fontSize: 11,
            letterSpacing: "0.14em",
            textTransform: "uppercase",
            color,
            whiteSpace: "nowrap",
          }}
        >
          <span
            aria-hidden
            style={{
              display: "inline-block",
              width: 6,
              height: 6,
              borderRadius: 999,
              background: color,
              boxShadow: `0 0 8px ${color}`,
            }}
          />
          {voice.status === "ready"
            ? `extracted · ${stamp}`
            : voice.status === "processing"
              ? `extracting…`
              : voice.status === "failed"
                ? `extraction failed · ${stamp}`
                : `uploaded · ${stamp}`}
        </span>
      </>,
    );
    return () => setContent(null);
  }, [setContent, voice.slug, voice.status, voice.updatedAt]);

  /* ── Actions ──────────────────────────────────────────────── */

  const triggerExtract = useCallback(async () => {
    setActionPending("extract");
    setActionError(null);
    try {
      const res = await fetch(`/api/voices/${voice.id}/extract`, {
        method: "POST",
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      router.refresh();
    } catch (err) {
      setActionError((err as Error).message);
    } finally {
      setActionPending(null);
    }
  }, [voice.id, router]);

  const triggerDelete = useCallback(async () => {
    if (
      !confirm(
        `Delete voice "${voice.name}"? This removes the source clip, embedding, and unbinds ${bindings.length} character${bindings.length === 1 ? "" : "s"}.`,
      )
    ) {
      return;
    }
    setActionPending("delete");
    setActionError(null);
    try {
      const res = await fetch(`/api/voices/${voice.id}`, { method: "DELETE" });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      router.push("/voices");
      router.refresh();
    } catch (err) {
      setActionError((err as Error).message);
      setActionPending(null);
    }
  }, [voice.id, voice.name, bindings.length, router]);

  /* ── Render ───────────────────────────────────────────────── */

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 32 }}>
      <PageHeader
        voice={voice}
        actionPending={actionPending}
        onExtract={triggerExtract}
        onDelete={triggerDelete}
      />
      {actionError && (
        <div
          style={{
            padding: "12px 16px",
            background: "rgba(232,160,160,0.06)",
            border: "1px solid rgba(232,160,160,0.30)",
            color: "#E8A0A0",
            fontFamily: FONT_MONO,
            fontSize: 12,
          }}
        >
          {actionError}
        </div>
      )}
      <div style={{ display: "flex", flexDirection: "row", gap: 20 }}>
        <SourceClipCard voice={voice} sourceUrl={sourceUrl} />
        <ExtractionPanel
          voice={voice}
          previewUrl={previewUrl}
          embeddingUrl={embeddingUrl}
          pending={actionPending === "extract"}
          onExtract={triggerExtract}
        />
      </div>
      <BindingsSection voice={voice} bindings={bindings} />
      <DangerZone
        voice={voice}
        actionPending={actionPending}
        onDelete={triggerDelete}
      />
    </div>
  );
}

/* ── Page header ──────────────────────────────────────────────── */

function PageHeader({
  voice,
  actionPending,
  onExtract,
  onDelete,
}: {
  voice: VoiceDetailData;
  actionPending: "extract" | "delete" | null;
  onExtract: () => void;
  onDelete: () => void;
}) {
  const color = STATUS_COLORS[voice.status];
  const label = STATUS_LABELS[voice.status];

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "row",
        alignItems: "flex-end",
        justifyContent: "space-between",
        gap: 32,
      }}
    >
      <div style={{ display: "flex", flexDirection: "row", gap: 28, alignItems: "center" }}>
        <HeroTile status={voice.status} />
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <div
              style={{
                fontFamily: FONT_MONO,
                fontSize: 11,
                color: "var(--text-tertiary)",
                letterSpacing: "0.18em",
                textTransform: "uppercase",
              }}
            >
              VOICE
            </div>
            <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
              <span
                aria-hidden
                style={{
                  display: "inline-block",
                  width: 6,
                  height: 6,
                  borderRadius: 999,
                  background: color,
                  boxShadow: `0 0 8px ${color}`,
                }}
              />
              <span
                style={{
                  fontFamily: FONT_MONO,
                  fontSize: 9,
                  letterSpacing: "0.20em",
                  textTransform: "uppercase",
                  color,
                }}
              >
                {label}
              </span>
            </span>
          </div>
          <div style={{ display: "flex", alignItems: "baseline", gap: 14 }}>
            <div
              style={{
                fontFamily: FONT_HEAD,
                fontSize: 36,
                fontWeight: 600,
                lineHeight: "42px",
                color: "var(--text-primary)",
                letterSpacing: "-0.02em",
              }}
            >
              {voice.name}
            </div>
            <div
              style={{
                fontFamily: FONT_MONO,
                fontSize: 13,
                color: "var(--text-quaternary)",
              }}
            >
              {voice.slug}
            </div>
          </div>
          <div
            style={{
              fontFamily: FONT_HEAD,
              fontSize: 14,
              lineHeight: "21px",
              color: "var(--text-secondary)",
              maxWidth: 540,
            }}
          >
            {voice.description ?? "No description set yet."}
          </div>
        </div>
      </div>

      {/* Header actions vary by status. The most useful action is
       * promoted to the primary slot; destructive is always present. */}
      <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 10 }}>
        {voice.status === "failed" && (
          <PrimaryButton
            label="retry extraction"
            icon="refresh"
            pending={actionPending === "extract"}
            onClick={onExtract}
          />
        )}
        {voice.status === "uploaded" && voice.sourcePath && (
          <PrimaryButton
            label="extract embedding"
            icon="zap"
            pending={actionPending === "extract"}
            onClick={onExtract}
          />
        )}
        <SecondaryButton
          label="delete"
          icon="trash"
          tone="danger"
          pending={actionPending === "delete"}
          onClick={onDelete}
        />
      </div>
    </div>
  );
}

function HeroTile({ status }: { status: VoiceStatus }) {
  if (status === "failed") {
    return (
      <div
        style={{
          width: 112,
          height: 112,
          flexShrink: 0,
          background:
            "linear-gradient(135deg, #3a1a1a 0%, #2a1018 50%, #1a0a12 100%)",
          border: "1px solid rgba(232,160,160,0.30)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="#E8A0A0" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="10" />
          <line x1="12" y1="8" x2="12" y2="12" />
          <line x1="12" y1="16" x2="12.01" y2="16" />
        </svg>
      </div>
    );
  }
  if (!previewable(status)) {
    return (
      <div
        style={{
          width: 112,
          height: 112,
          flexShrink: 0,
          background: "var(--card)",
          border: "1px dashed rgba(255,255,255,0.18)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <Waveform color="rgba(255,255,255,0.30)" />
      </div>
    );
  }
  const tint =
    status === "processing"
      ? {
          bg: "linear-gradient(135deg, #3A2E10 0%, #261D08 50%, #1A1305 100%)",
          border: "rgba(250,204,21,0.30)",
          stroke: "#FACC15",
        }
      : {
          bg: "linear-gradient(135deg, #105A59 0%, #1a3a3a 50%, #0f2828 100%)",
          border: "rgba(140,231,210,0.22)",
          stroke: "var(--accent-strong)",
        };
  return (
    <div
      style={{
        width: 112,
        height: 112,
        flexShrink: 0,
        background: tint.bg,
        border: `1px solid ${tint.border}`,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <Waveform color={tint.stroke} />
    </div>
  );
}

function previewable(status: VoiceStatus): boolean {
  return status === "ready" || status === "processing";
}

function Waveform({ color }: { color: string }) {
  return (
    <svg width="64" height="46" viewBox="0 0 100 60" fill="none" stroke={color} strokeWidth="3" strokeLinecap="round">
      {[
        [6, 30, 30],
        [14, 22, 38],
        [22, 14, 46],
        [30, 8, 52],
        [38, 18, 42],
        [46, 6, 54],
        [54, 12, 48],
        [62, 20, 40],
        [70, 10, 50],
        [78, 24, 36],
        [86, 18, 42],
        [94, 28, 32],
      ].map(([x, y1, y2]) => (
        <line key={x} x1={x} y1={y1} x2={x} y2={y2} />
      ))}
    </svg>
  );
}

/* ── Source Clip card ─────────────────────────────────────────── */

function SourceClipCard({
  voice,
  sourceUrl,
}: {
  voice: VoiceDetailData;
  sourceUrl: string | null;
}) {
  // 'failed' source clips frequently have a meaningful reason — surface the
  // most common one (too short) inline. Other failure types fall back to a
  // generic warning chip.
  const tooShort = voice.status === "failed" && (voice.durationS ?? 0) < 10;

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 22,
        flex: 1,
        padding: 28,
        background: "var(--card)",
        border: "1px solid var(--border)",
      }}
    >
      <div style={{ display: "flex", flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <SectionLabel>— 01 / SOURCE CLIP</SectionLabel>
          <div style={{ display: "flex", alignItems: "baseline", gap: 12 }}>
            <SectionTitle>{voice.sourcePath ? "Uploaded recording" : "No clip uploaded"}</SectionTitle>
            {tooShort && (
              <span
                style={{
                  fontFamily: FONT_MONO,
                  fontSize: 11,
                  color: "#E8A0A0",
                  letterSpacing: "0.04em",
                }}
              >
                ⚠ too short
              </span>
            )}
          </div>
        </div>
      </div>

      {sourceUrl ? (
        <>
          <div
            style={{
              padding: 22,
              background: tooShort
                ? "rgba(232,160,160,0.03)"
                : "rgba(140,231,210,0.04)",
              border: `1px solid ${tooShort ? "rgba(232,160,160,0.18)" : "rgba(140,231,210,0.18)"}`,
            }}
          >
            <audio
              controls
              preload="metadata"
              src={sourceUrl}
              style={{ width: "100%" }}
            />
          </div>
          <MetaTable
            rows={[
              ["Duration", voice.durationS != null ? `${voice.durationS.toFixed(1)}s` : "—"],
              ["Sample rate", voice.sampleRate != null ? `${voice.sampleRate.toLocaleString()} Hz` : "—"],
              ["Bucket path", voice.sourcePath ?? "—"],
              ["Uploaded", relativeFromIso(voice.createdAt)],
            ]}
          />
        </>
      ) : (
        <DropZonePlaceholder />
      )}
    </div>
  );
}

function DropZonePlaceholder() {
  // v1: link to the Library page; real drop-upload lives in the upload
  // dialog (separate component, not built in this pass).
  return (
    <Link
      href="/voices"
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 16,
        padding: "56px 32px",
        background: "rgba(140,231,210,0.03)",
        border: "1.5px dashed rgba(140,231,210,0.30)",
        color: "var(--text-secondary)",
        textDecoration: "none",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          width: 56,
          height: 56,
          background: "rgba(140,231,210,0.08)",
          border: "1px solid rgba(140,231,210,0.18)",
        }}
      >
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="var(--accent-strong)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
          <polyline points="17 8 12 3 7 8" />
          <line x1="12" x2="12" y1="3" y2="15" />
        </svg>
      </div>
      <div style={{ fontFamily: FONT_HEAD, fontSize: 15, fontWeight: 600, color: "var(--text-primary)" }}>
        Upload a source clip
      </div>
      <div style={{ fontFamily: FONT_MONO, fontSize: 11, color: "var(--text-quaternary)", letterSpacing: "0.06em" }}>
        WAV · MP3 · M4A · up to 20 MB
      </div>
    </Link>
  );
}

/* ── Extraction Panel (right column) ──────────────────────────── */

function ExtractionPanel({
  voice,
  previewUrl,
  embeddingUrl,
  pending,
  onExtract,
}: {
  voice: VoiceDetailData;
  previewUrl: string | null;
  embeddingUrl: string | null;
  pending: boolean;
  onExtract: () => void;
}) {
  if (voice.status === "ready") {
    return <SmokeTestPanel voice={voice} previewUrl={previewUrl} embeddingUrl={embeddingUrl} />;
  }
  if (voice.status === "processing") {
    return <ProcessingPanel voice={voice} />;
  }
  if (voice.status === "failed") {
    return <FailedPanel voice={voice} />;
  }
  // 'uploaded' — clip is sitting in storage, extraction not yet triggered.
  return (
    <ReadyToExtractPanel voice={voice} pending={pending} onExtract={onExtract} />
  );
}

function SmokeTestPanel({
  voice,
  previewUrl,
  embeddingUrl,
}: {
  voice: VoiceDetailData;
  previewUrl: string | null;
  embeddingUrl: string | null;
}) {
  return (
    <div style={panelShell()}>
      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        <SectionLabel>— 02 / SMOKE TEST</SectionLabel>
        <SectionTitle>Synthesized sample</SectionTitle>
      </div>
      {previewUrl ? (
        <div
          style={{
            padding: 22,
            background: "rgba(255,255,255,0.03)",
            border: "1px solid var(--border)",
          }}
        >
          <audio controls preload="metadata" src={previewUrl} style={{ width: "100%" }} />
        </div>
      ) : (
        <div
          style={{
            padding: "24px 22px",
            background: "rgba(255,255,255,0.025)",
            border: "1px solid var(--border)",
            fontFamily: FONT_HEAD,
            fontSize: 12,
            color: "var(--text-secondary)",
          }}
        >
          Preview not generated yet — the voice can still be bound to characters.
        </div>
      )}
      <MetaTable
        rows={[
          ["Engine", "Pocket TTS · english_2026-01"],
          ["Embedding path", voice.embeddingPath ?? "—"],
          [
            "Embedding URL",
            embeddingUrl ? (
              <a
                key="dl"
                href={embeddingUrl}
                download
                style={{ color: "var(--accent-strong)", textDecoration: "none" }}
              >
                download .safetensors
              </a>
            ) : (
              "—"
            ),
          ],
          ["Extracted", relativeFromIso(voice.updatedAt)],
        ]}
      />
    </div>
  );
}

function ReadyToExtractPanel({
  voice,
  pending,
  onExtract,
}: {
  voice: VoiceDetailData;
  pending: boolean;
  onExtract: () => void;
}) {
  return (
    <div style={panelShell()}>
      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        <SectionLabel>— 02 / EXTRACTION</SectionLabel>
        <SectionTitle>Ready to extract</SectionTitle>
      </div>
      <div
        style={{
          padding: 28,
          background: "rgba(140,231,210,0.04)",
          border: "1px solid rgba(140,231,210,0.18)",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: 14,
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            width: 56,
            height: 56,
            background: "rgba(140,231,210,0.10)",
            border: "1px solid rgba(140,231,210,0.30)",
          }}
        >
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="var(--accent-strong)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
          </svg>
        </div>
        <div style={{ textAlign: "center", display: "flex", flexDirection: "column", gap: 4 }}>
          <div style={{ fontFamily: FONT_HEAD, fontSize: 15, fontWeight: 600, color: "var(--text-primary)" }}>
            Source uploaded — run extraction
          </div>
          <div style={{ fontFamily: FONT_HEAD, fontSize: 12, color: "var(--text-secondary)" }}>
            audio-rt will compute a Pocket TTS embedding (~15s on a warm container).
          </div>
        </div>
        <button
          type="button"
          onClick={onExtract}
          disabled={pending}
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 8,
            padding: "10px 18px",
            background: "var(--accent-strong)",
            border: "1px solid var(--accent-strong)",
            color: "var(--background)",
            fontFamily: FONT_HEAD,
            fontSize: 13,
            fontWeight: 600,
            cursor: pending ? "progress" : "pointer",
            opacity: pending ? 0.6 : 1,
          }}
        >
          {pending ? "starting…" : "extract embedding"}
        </button>
      </div>
    </div>
  );
}

function ProcessingPanel({ voice }: { voice: VoiceDetailData }) {
  // Elapsed is a derived value: updatedAt is set when status flipped to
  // 'processing', so subtracting from now gives "time since extraction
  // started" until the row updates again.
  const elapsedSec = Math.max(0, Math.floor((Date.now() - new Date(voice.updatedAt).getTime()) / 1000));

  return (
    <div
      style={{
        ...panelShell(),
        background: "rgba(250,204,21,0.025)",
        borderColor: "rgba(250,204,21,0.18)",
      }}
    >
      <div style={{ display: "flex", flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <SectionLabel style={{ color: "#FACC15" }}>— 02 / EXTRACTION</SectionLabel>
          <SectionTitle>Pocket TTS is working on it</SectionTitle>
        </div>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 4 }}>
          <span style={{ fontFamily: FONT_MONO, fontSize: 11, color: "var(--text-tertiary)", letterSpacing: "0.08em", textTransform: "uppercase" }}>
            elapsed
          </span>
          <span style={{ fontFamily: FONT_MONO, fontSize: 18, color: "#FACC15", letterSpacing: "0.02em" }}>
            {elapsedSec.toFixed(0)}s
          </span>
        </div>
      </div>
      <ProcessingStepLog />
      <div style={{ fontFamily: FONT_HEAD, fontSize: 12, color: "var(--text-secondary)" }}>
        Polling every 3s. If extraction takes longer than 60s the audio-rt
        container may have cold-started — check <code style={{ fontFamily: FONT_MONO, fontSize: 11, color: "var(--text-primary)" }}>/healthz</code>.
      </div>
    </div>
  );
}

function ProcessingStepLog() {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <StepRow state="done" title="Upload to voice-sources" sub="source clip captured" duration="—" />
      <StepRow state="done" title="Decode + VAD trim" sub="loudnorm + silence trim" duration="—" />
      <StepRow state="active" title="pocket-tts export-voice" sub="computing kvcache state" duration="…" />
      <StepRow state="pending" title="Upload .safetensors" sub="pending" duration="—" />
    </div>
  );
}

function FailedPanel({ voice }: { voice: VoiceDetailData }) {
  const raw = voice.statusError ?? "Extraction failed without a reported error message.";
  const summary = extractExceptionSummary(raw);
  const isMultiLine = raw.includes("\n");
  const [expanded, setExpanded] = useState(false);

  return (
    <div
      style={{
        ...panelShell(),
        background: "rgba(232,160,160,0.04)",
        borderColor: "rgba(232,160,160,0.20)",
      }}
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        <SectionLabel style={{ color: "#E8A0A0" }}>— 02 / EXTRACTION FAILED</SectionLabel>
        <SectionTitle>Pocket TTS rejected the clip</SectionTitle>
      </div>

      {/* Summary block — exception line plucked from the bottom of any
       * traceback, or the full string if it's short. Always visible. */}
      <div
        style={{
          display: "flex",
          flexDirection: "row",
          alignItems: "flex-start",
          gap: 14,
          padding: "18px 20px",
          background: "rgba(0,0,0,0.30)",
          borderLeft: "3px solid #E8A0A0",
        }}
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#E8A0A0" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ marginTop: 1, flexShrink: 0 }}>
          <circle cx="12" cy="12" r="10" />
          <line x1="12" y1="8" x2="12" y2="12" />
          <line x1="12" y1="16" x2="12.01" y2="16" />
        </svg>
        <div style={{ display: "flex", flexDirection: "column", gap: 4, flex: 1, minWidth: 0 }}>
          <div
            style={{
              fontFamily: FONT_MONO,
              fontSize: 13,
              lineHeight: "20px",
              color: "var(--text-primary)",
              wordBreak: "break-word",
            }}
          >
            {summary}
          </div>
          {isMultiLine && (
            <button
              type="button"
              onClick={() => setExpanded((e) => !e)}
              style={{
                alignSelf: "flex-start",
                padding: 0,
                background: "transparent",
                border: "none",
                color: "#E8A0A0",
                fontFamily: FONT_MONO,
                fontSize: 11,
                letterSpacing: "0.06em",
                cursor: "pointer",
                textDecoration: "underline",
                textDecorationColor: "rgba(232,160,160,0.40)",
              }}
            >
              {expanded ? "hide full traceback" : "show full traceback"}
            </button>
          )}
        </div>
      </div>

      {/* Full traceback — collapsible. Preserves whitespace + handles
       * long lines via horizontal scroll. Monospace + tabular-ish layout
       * lines up Rich's box-drawing characters cleanly. */}
      {expanded && (
        <pre
          style={{
            margin: 0,
            padding: "16px 20px",
            background: "rgba(0,0,0,0.40)",
            border: "1px solid rgba(232,160,160,0.12)",
            color: "var(--text-secondary)",
            fontFamily: FONT_MONO,
            fontSize: 11,
            lineHeight: "16px",
            whiteSpace: "pre",
            overflowX: "auto",
            maxHeight: 360,
            overflowY: "auto",
          }}
        >
          {raw}
        </pre>
      )}

      <div
        style={{
          display: "flex",
          flexDirection: "row",
          alignItems: "flex-start",
          gap: 12,
          padding: "14px 16px",
          background: "rgba(140,231,210,0.04)",
          border: "1px solid rgba(140,231,210,0.18)",
        }}
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--accent-strong)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ marginTop: 2, flexShrink: 0 }}>
          <path d="M9 18h6" />
          <path d="M10 22h4" />
          <path d="M12 2a7 7 0 0 0-4 12.74A4 4 0 0 1 9 18h6a4 4 0 0 1 1-3.26A7 7 0 0 0 12 2Z" />
        </svg>
        <div style={{ display: "flex", flexDirection: "column", gap: 4, flex: 1 }}>
          <span style={{ fontFamily: FONT_HEAD, fontSize: 13, fontWeight: 600, color: "var(--text-primary)" }}>
            What to do next
          </span>
          <span style={{ fontFamily: FONT_HEAD, fontSize: 12, lineHeight: "18px", color: "var(--text-secondary)" }}>
            Use <strong>retry extraction</strong> in the header if you think the failure was transient.
            For source-clip problems (too short, wrong format, multiple speakers), re-upload from the
            library and retry.
          </span>
        </div>
      </div>
    </div>
  );
}

/** Pull the exception line out of a Python traceback. Rich-formatted
 * tracebacks have box-drawing characters around each line; the actual
 * exception is the last non-empty line that matches `<Type>: <message>`.
 * Falls back to the first line of the input if no match. */
function extractExceptionSummary(raw: string): string {
  const lines = raw
    .split("\n")
    .map((l) => l.replace(/^[│╭╰─\s]+|[│╮╯─\s]+$/g, "").trim())
    .filter((l) => l.length > 0);
  // Walk from the bottom looking for an exception line. Common patterns:
  //   RuntimeError: insufficient audio
  //   ValueError: ...
  //   subprocess.CalledProcessError: ...
  for (let i = lines.length - 1; i >= 0; i--) {
    if (/^[\w.]+(Error|Exception|Warning):/.test(lines[i])) {
      return lines[i];
    }
  }
  // Fall back: first meaningful line. Strip the audio-rt HTTP envelope if
  // present so the user sees just the underlying message.
  const first = lines[0] ?? raw.trim();
  return first.replace(/^audio-rt \/export-voice \d+:\s*/, "");
}

/* ── Step row ─────────────────────────────────────────────────── */

function StepRow({
  state,
  title,
  sub,
  duration,
}: {
  state: "done" | "active" | "pending" | "failed";
  title: string;
  sub: string;
  duration: string;
}) {
  const styles =
    state === "done"
      ? { bg: "rgba(255,255,255,0.03)", border: "var(--border)", title: "var(--text-primary)", sub: "var(--text-tertiary)" }
      : state === "active"
        ? { bg: "rgba(250,204,21,0.06)", border: "rgba(250,204,21,0.30)", title: "var(--text-primary)", sub: "rgba(250,204,21,0.92)" }
        : state === "failed"
          ? { bg: "rgba(232,160,160,0.06)", border: "rgba(232,160,160,0.30)", title: "var(--text-primary)", sub: "rgba(232,160,160,0.92)" }
          : { bg: "transparent", border: "transparent", title: "var(--text-quaternary)", sub: "var(--text-quaternary)" };

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "row",
        alignItems: "center",
        gap: 14,
        padding: "14px 16px",
        background: styles.bg,
        border: state === "pending" ? "1px dashed var(--border)" : `1px solid ${styles.border}`,
      }}
    >
      <StepIcon state={state} />
      <div style={{ display: "flex", flexDirection: "column", gap: 3, flex: 1 }}>
        <span style={{ fontFamily: FONT_HEAD, fontSize: 13, fontWeight: 600, color: styles.title }}>
          {title}
        </span>
        <span style={{ fontFamily: FONT_MONO, fontSize: 11, color: styles.sub }}>{sub}</span>
      </div>
      <span style={{ fontFamily: FONT_MONO, fontSize: 11, color: styles.sub, letterSpacing: "0.04em" }}>
        {duration}
      </span>
    </div>
  );
}

function StepIcon({ state }: { state: "done" | "active" | "pending" | "failed" }) {
  if (state === "done") {
    return (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="var(--accent-strong)" stroke="none">
        <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z" />
      </svg>
    );
  }
  if (state === "failed") {
    return (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="#E8A0A0" stroke="none">
        <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm5 13.59L15.59 17 12 13.41 8.41 17 7 15.59 10.59 12 7 8.41 8.41 7 12 10.59 15.59 7 17 8.41 13.41 12 17 15.59z" />
      </svg>
    );
  }
  if (state === "active") {
    return (
      <>
        <style>{`@keyframes voice-detail-spin{from{transform:rotate(0)}to{transform:rotate(360deg)}}`}</style>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#FACC15" strokeWidth="2.5" strokeLinecap="round" style={{ animation: "voice-detail-spin 1.2s linear infinite", transformOrigin: "center" }}>
          <path d="M21 12a9 9 0 1 1-9-9" />
        </svg>
      </>
    );
  }
  return (
    <div style={{ width: 16, height: 16, display: "flex", alignItems: "center", justifyContent: "center" }}>
      <div style={{ width: 14, height: 14, borderRadius: 999, border: "1.5px solid rgba(255,255,255,0.20)" }} />
    </div>
  );
}

/* ── Bindings ─────────────────────────────────────────────────── */

function BindingsSection({
  voice,
  bindings,
}: {
  voice: VoiceDetailData;
  bindings: VoiceDetailBindings;
}) {
  const locked = voice.status !== "ready";

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
      <div style={{ display: "flex", flexDirection: "row", alignItems: "flex-end", justifyContent: "space-between" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <SectionLabel>— 03 / BINDINGS</SectionLabel>
          <SectionTitle>Characters using this voice</SectionTitle>
        </div>
        {locked && (
          <button
            disabled
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 7,
              padding: "8px 14px",
              background: "rgba(255,255,255,0.03)",
              border: "1px solid var(--border)",
              color: "var(--text-quaternary)",
              fontFamily: FONT_HEAD,
              fontSize: 12,
              fontWeight: 600,
              cursor: "not-allowed",
            }}
          >
            extract first
          </button>
        )}
      </div>

      {locked ? (
        <div
          style={{
            display: "flex",
            flexDirection: "row",
            alignItems: "center",
            gap: 16,
            padding: "24px 22px",
            background: "rgba(255,255,255,0.025)",
            border: "1px solid var(--border)",
          }}
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--text-quaternary)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="11" width="18" height="11" />
            <path d="M7 11V7a5 5 0 0 1 10 0v4" />
          </svg>
          <div style={{ display: "flex", flexDirection: "column", gap: 4, flex: 1 }}>
            <span style={{ fontFamily: FONT_HEAD, fontSize: 14, fontWeight: 500, color: "var(--text-secondary)" }}>
              Bindings unlock when extraction completes
            </span>
            <span style={{ fontFamily: FONT_HEAD, fontSize: 12, color: "var(--text-tertiary)" }}>
              The slug <code style={{ fontFamily: FONT_MONO, fontSize: 11, color: "var(--text-secondary)" }}>{voice.slug}</code> stays reserved while you fix the source.
            </span>
          </div>
        </div>
      ) : bindings.length === 0 ? (
        <div
          style={{
            padding: "24px 22px",
            background: "rgba(255,255,255,0.025)",
            border: "1px solid var(--border)",
            fontFamily: FONT_HEAD,
            fontSize: 13,
            color: "var(--text-secondary)",
          }}
        >
          No characters bound yet. Set this voice on a character via the Persona → Voice & Style panel.
        </div>
      ) : (
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            background: "var(--card)",
            border: "1px solid var(--border)",
          }}
        >
          {bindings.map((c, idx) => (
            <BindingRow key={c.id} character={c} isLast={idx === bindings.length - 1} />
          ))}
        </div>
      )}
    </div>
  );
}

function BindingRow({
  character,
  isLast,
}: {
  character: VoiceDetailBindings[number];
  isLast: boolean;
}) {
  const bg = character.image
    ? `center/cover no-repeat url("${character.image}"), var(--card-hover)`
    : resolveAvatarGradient(character.thumbnailColor, character.slug);
  return (
    <Link
      href={`/characters/${character.slug}`}
      style={{
        display: "flex",
        flexDirection: "row",
        alignItems: "center",
        gap: 18,
        padding: "16px 22px",
        borderBottom: isLast ? "none" : "1px solid var(--divider)",
        textDecoration: "none",
        color: "inherit",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          width: 44,
          height: 44,
          flexShrink: 0,
          background: bg,
          color: "rgba(0,0,0,0.85)",
          fontFamily: FONT_HEAD,
          fontSize: 18,
          fontWeight: 600,
        }}
      >
        {!character.image && character.title.charAt(0).toUpperCase()}
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 4, flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ fontFamily: FONT_HEAD, fontSize: 16, fontWeight: 500, color: "var(--text-primary)" }}>
            {character.title}
          </span>
          <span style={{ fontFamily: FONT_MONO, fontSize: 11, color: "var(--text-quaternary)", letterSpacing: "0.04em" }}>
            {character.slug}
          </span>
        </div>
        {character.summary && (
          <div style={{ fontFamily: FONT_HEAD, fontSize: 13, lineHeight: "18px", color: "var(--text-secondary)" }}>
            {character.summary}
          </div>
        )}
      </div>
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="var(--text-tertiary)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M7 17 17 7" />
        <path d="M7 7h10v10" />
      </svg>
    </Link>
  );
}

/* ── Danger Zone ──────────────────────────────────────────────── */

function DangerZone({
  voice,
  actionPending,
  onDelete,
}: {
  voice: VoiceDetailData;
  actionPending: "extract" | "delete" | null;
  onDelete: () => void;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        <SectionLabel>— 04 / DANGER ZONE</SectionLabel>
        <SectionTitle>Destructive actions</SectionTitle>
      </div>
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          background: "rgba(232,160,160,0.03)",
          border: "1px solid rgba(232,160,160,0.18)",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 18, padding: "18px 22px" }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 4, flex: 1 }}>
            <span style={{ fontFamily: FONT_HEAD, fontSize: 14, fontWeight: 600, color: "var(--text-primary)" }}>
              Delete voice
            </span>
            <span style={{ fontFamily: FONT_HEAD, fontSize: 12, color: "var(--text-secondary)" }}>
              {voice.status === "processing"
                ? "Cancels extraction, removes the source clip, and deletes the row. The slug becomes available again."
                : voice.status === "failed"
                  ? `Removes the failed clip and clears the row. The slug ${voice.slug} becomes available again.`
                  : "Removes the source clip and embedding from Supabase, deletes the row, and unbinds any characters using it."}
            </span>
          </div>
          <button
            type="button"
            onClick={onDelete}
            disabled={actionPending === "delete"}
            style={{
              padding: "8px 14px",
              border: "1px solid rgba(232,160,160,0.30)",
              background: "transparent",
              color: "#E8A0A0",
              fontFamily: FONT_HEAD,
              fontSize: 12,
              fontWeight: 600,
              cursor: actionPending === "delete" ? "progress" : "pointer",
              whiteSpace: "nowrap",
              opacity: actionPending === "delete" ? 0.6 : 1,
            }}
          >
            {actionPending === "delete" ? "deleting…" : "delete voice"}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ── Buttons + atoms ──────────────────────────────────────────── */

function PrimaryButton({
  label,
  icon,
  pending,
  onClick,
}: {
  label: string;
  icon: "refresh" | "zap";
  pending: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={pending}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 7,
        padding: "8px 14px",
        background: "var(--accent-strong)",
        border: "1px solid var(--accent-strong)",
        color: "var(--background)",
        fontFamily: FONT_HEAD,
        fontSize: 12,
        fontWeight: 600,
        cursor: pending ? "progress" : "pointer",
        opacity: pending ? 0.6 : 1,
      }}
    >
      {icon === "refresh" ? (
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
          <path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8" />
          <path d="M21 3v5h-5" />
        </svg>
      ) : (
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
          <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
        </svg>
      )}
      <span>{pending ? "starting…" : label}</span>
    </button>
  );
}

function SecondaryButton({
  label,
  icon,
  tone,
  pending,
  onClick,
}: {
  label: string;
  icon: "trash";
  tone: "neutral" | "danger";
  pending: boolean;
  onClick: () => void;
}) {
  const color = tone === "danger" ? "#E8A0A0" : "var(--text-secondary)";
  const border = tone === "danger" ? "rgba(232,160,160,0.30)" : "var(--border)";
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={pending}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 7,
        padding: "8px 14px",
        background: "transparent",
        border: `1px solid ${border}`,
        color,
        fontFamily: FONT_HEAD,
        fontSize: 12,
        fontWeight: 600,
        cursor: pending ? "progress" : "pointer",
        opacity: pending ? 0.6 : 1,
      }}
    >
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M3 6h18" />
        <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" />
        <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
      </svg>
      <span>{label}</span>
    </button>
  );
}

function MetaTable({
  rows,
}: {
  rows: Array<[string, React.ReactNode]>;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      {rows.map(([label, value], idx) => (
        <div
          key={label}
          style={{
            display: "flex",
            flexDirection: "row",
            justifyContent: "space-between",
            padding: "11px 0",
            borderBottom: idx === rows.length - 1 ? "none" : "1px solid var(--divider)",
            gap: 16,
          }}
        >
          <span style={{ fontFamily: FONT_HEAD, fontSize: 12, color: "var(--text-tertiary)" }}>
            {label}
          </span>
          <span
            style={{
              fontFamily: FONT_MONO,
              fontSize: 12,
              color: "var(--text-primary)",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
              maxWidth: "60%",
              textAlign: "right",
            }}
          >
            {value ?? "—"}
          </span>
        </div>
      ))}
    </div>
  );
}

function SectionLabel({
  children,
  style,
}: {
  children: React.ReactNode;
  style?: React.CSSProperties;
}) {
  return (
    <div
      style={{
        fontFamily: FONT_MONO,
        fontSize: 11,
        color: "var(--text-tertiary)",
        letterSpacing: "0.18em",
        textTransform: "uppercase",
        ...style,
      }}
    >
      {children}
    </div>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        fontFamily: FONT_HEAD,
        fontSize: 16,
        fontWeight: 600,
        color: "var(--text-primary)",
        letterSpacing: "-0.01em",
      }}
    >
      {children}
    </div>
  );
}

function panelShell(): React.CSSProperties {
  return {
    display: "flex",
    flexDirection: "column",
    gap: 22,
    flex: 1,
    padding: 28,
    background: "var(--card)",
    border: "1px solid var(--border)",
  };
}

/* ── Helpers ──────────────────────────────────────────────────── */

function relativeFromIso(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 60_000) return "just now";
  const mins = Math.floor(ms / 60_000);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  const weeks = Math.floor(days / 7);
  return `${weeks}w ago`;
}
