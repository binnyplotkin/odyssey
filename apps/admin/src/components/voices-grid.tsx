"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useHeaderContent } from "@/components/header-context";
import { VoiceUploadDialog } from "@/components/voice-upload-dialog";
import type { VoiceStatus } from "@odyssey/db";
import type { VoiceSummary } from "@/app/(authenticated)/voices/page";

/* ── Theme tokens ─────────────────────────────────────────────── */

const FONT_HEAD = "'Inter', system-ui, sans-serif";
const FONT_MONO = "'JetBrains Mono', ui-monospace, monospace";
const ACCENT = "var(--accent-strong)";

/* Status palette. Ready maps to the brand accent (matches characters' "live"
 * pill). Processing borrows draft amber. Failed uses a desaturated coral
 * that lines up with the brand without competing with accent green. */
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

/* ── Sort ─────────────────────────────────────────────────────── */

type SortKey = "recent" | "name";

const SORT_OPTIONS: { key: SortKey; label: string }[] = [
  { key: "recent", label: "Recently added" },
  { key: "name", label: "Name A–Z" },
];

function applySort(list: VoiceSummary[], sort: SortKey): VoiceSummary[] {
  const base = [...list];
  if (sort === "name") {
    return base.sort((a, b) => a.name.localeCompare(b.name));
  }
  return base.sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
  );
}

/* ── Formatting helpers ───────────────────────────────────────── */

function formatDuration(s: number | null): string {
  if (s == null) return "—";
  if (s < 60) return `${s.toFixed(1)}s`;
  const m = Math.floor(s / 60);
  const r = Math.round(s % 60);
  return `${m}m ${r}s`;
}

function formatSampleRate(hz: number | null): string {
  if (hz == null) return "—";
  return `${Math.round(hz / 1000)} kHz`;
}

function formatLastEvent(v: VoiceSummary): string {
  const iso =
    v.status === "ready" || v.status === "failed" ? v.updatedAt : v.createdAt;
  const ms = Date.now() - new Date(iso).getTime();
  const rel = relativeFromMs(ms);
  if (v.status === "ready") return `extracted · ${rel}`;
  if (v.status === "failed") return `failed · ${rel}`;
  if (v.status === "processing") return `extracting…`;
  return `uploaded · ${rel}`;
}

function relativeFromMs(ms: number): string {
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

/* ── Component ────────────────────────────────────────────────── */

type Props = { voices: VoiceSummary[] };

export function VoicesGrid({ voices }: Props) {
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<SortKey>("recent");
  const [uploadOpen, setUploadOpen] = useState(false);

  const existingSlugs = useMemo(() => voices.map((v) => v.slug), [voices]);

  const counts = useMemo(() => {
    const c = { all: voices.length, ready: 0, processing: 0, failed: 0 };
    for (const v of voices) {
      if (v.status === "ready") c.ready++;
      else if (v.status === "processing") c.processing++;
      else if (v.status === "failed") c.failed++;
    }
    return c;
  }, [voices]);

  const filtered = useMemo(() => {
    const base = !search.trim()
      ? voices
      : (() => {
          const q = search.trim().toLowerCase();
          return voices.filter(
            (v) =>
              v.name.toLowerCase().includes(q) ||
              v.slug.toLowerCase().includes(q) ||
              (v.description ?? "").toLowerCase().includes(q),
          );
        })();
    return applySort(base, sort);
  }, [voices, search, sort]);

  /* ── Header injection ───────────────────────────────────────── */

  const { setContent } = useHeaderContent();
  useEffect(() => {
    const status: string[] = [
      `${voices.length} voice${voices.length === 1 ? "" : "s"}`,
    ];
    if (counts.ready) status.push(`${counts.ready} ready`);
    if (counts.processing) status.push(`${counts.processing} extracting`);
    if (counts.failed) status.push(`${counts.failed} failed`);

    setContent(
      <>
        <span
          style={{
            fontFamily: FONT_MONO,
            fontSize: 11,
            letterSpacing: "0.18em",
            textTransform: "uppercase",
            color: ACCENT,
            marginRight: 14,
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
            whiteSpace: "nowrap",
          }}
        >
          {status.join(" · ")}
        </span>
        <div style={{ flex: 1 }} />
        <div style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
          <RefreshButton />
          <button
            type="button"
            onClick={() => setUploadOpen(true)}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              padding: "7px 16px",
              border: `1px solid ${ACCENT}`,
              background: ACCENT,
              color: "var(--background)",
              fontFamily: FONT_HEAD,
              fontSize: 12,
              fontWeight: 600,
              cursor: "pointer",
              whiteSpace: "nowrap",
            }}
          >
            + new voice
          </button>
        </div>
      </>,
    );
    return () => setContent(null);
  }, [setContent, voices.length, counts.ready, counts.processing, counts.failed]);

  /* ── Empty state ────────────────────────────────────────────── */

  if (voices.length === 0) {
    return (
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          padding: "5rem 2rem",
          gap: 18,
        }}
      >
        <span
          style={{
            fontFamily: FONT_MONO,
            fontSize: 11,
            letterSpacing: "0.18em",
            textTransform: "uppercase",
            color: ACCENT,
          }}
        >
          voices · empty
        </span>
        <h2
          style={{
            fontFamily: FONT_HEAD,
            fontSize: 36,
            fontWeight: 600,
            letterSpacing: "-0.02em",
            margin: 0,
            color: "var(--text-primary)",
          }}
        >
          No voices yet
        </h2>
        <p
          style={{
            fontFamily: FONT_HEAD,
            fontSize: 14,
            lineHeight: "22px",
            color: "var(--text-secondary)",
            margin: 0,
            maxWidth: 480,
            textAlign: "center",
          }}
        >
          A voice is a Pocket TTS embedding extracted from a short reference
          clip. Upload one to attach it to any character.
        </p>
        <button
          type="button"
          onClick={() => setUploadOpen(true)}
          style={{
            display: "inline-flex",
            alignItems: "center",
            padding: "12px 22px",
            border: `1px solid ${ACCENT}`,
            background: ACCENT,
            color: "var(--background)",
            fontFamily: FONT_HEAD,
            fontSize: 14,
            fontWeight: 600,
            cursor: "pointer",
          }}
        >
          + upload your first voice
        </button>
        <VoiceUploadDialog
          open={uploadOpen}
          onClose={() => setUploadOpen(false)}
          existingSlugs={existingSlugs}
        />
      </div>
    );
  }

  /* ── Populated state ────────────────────────────────────────── */

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
      {/* Toolbar — search + count + sort */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 16,
          flexWrap: "wrap",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              padding: "9px 14px",
              background: "var(--card)",
              border: "1px solid var(--border)",
              width: 360,
            }}
          >
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden>
              <circle
                cx="6"
                cy="6"
                r="4.5"
                stroke="var(--text-tertiary)"
                strokeWidth="1.5"
              />
              <line
                x1="9.5"
                y1="9.5"
                x2="12.5"
                y2="12.5"
                stroke="var(--text-tertiary)"
                strokeWidth="1.5"
                strokeLinecap="round"
              />
            </svg>
            <input
              type="text"
              placeholder="search voices…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              style={{
                flex: 1,
                border: "none",
                background: "transparent",
                outline: "none",
                fontSize: 13,
                color: "var(--text-primary)",
                fontFamily: FONT_HEAD,
              }}
            />
          </div>
          <span
            style={{
              fontFamily: FONT_MONO,
              fontSize: 11,
              letterSpacing: "0.14em",
              textTransform: "uppercase",
              color: "var(--text-tertiary)",
            }}
          >
            showing {filtered.length} of {voices.length}
          </span>
        </div>

        <SortMenu sort={sort} onChange={setSort} />
      </div>

      {/* Grid — auto-fill, min 380px per card (matches characters) */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(380px, 1fr))",
          gap: 16,
          width: "100%",
        }}
      >
        {filtered.map((v) => (
          <VoiceCard key={v.id} voice={v} />
        ))}
      </div>

      <VoiceUploadDialog
        open={uploadOpen}
        onClose={() => setUploadOpen(false)}
        existingSlugs={existingSlugs}
      />
    </div>
  );
}

/* ── Card ─────────────────────────────────────────────────────── */

function VoiceCard({ voice }: { voice: VoiceSummary }) {
  const [hovered, setHovered] = useState(false);
  const isReady = voice.status === "ready";

  return (
    <Link
      href={`/voices/${voice.slug}`}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onFocus={() => setHovered(true)}
      onBlur={() => setHovered(false)}
      style={{
        display: "flex",
        flexDirection: "column",
        width: "100%",
        position: "relative",
        background: "var(--card)",
        border: `1px solid ${hovered ? "color-mix(in srgb, var(--accent-strong) 40%, transparent)" : "var(--border)"}`,
        textDecoration: "none",
        color: "inherit",
        transition: "border-color 120ms ease, background 120ms ease",
      }}
    >
      {/* Card head — waveform thumb + identity */}
      <div style={{ display: "flex", gap: 16, padding: "20px 22px 16px" }}>
        <WaveformThumb tinted={isReady} />
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 6,
            minWidth: 0,
            flex: 1,
          }}
        >
          <StatusPill status={voice.status} />
          <span
            style={{
              fontFamily: FONT_HEAD,
              fontSize: 22,
              fontWeight: 600,
              letterSpacing: "-0.01em",
              lineHeight: 1.1,
              color: "var(--text-primary)",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {voice.name}
          </span>
          <p
            style={{
              margin: 0,
              marginTop: 2,
              fontFamily: FONT_HEAD,
              fontSize: 12,
              lineHeight: "18px",
              color: "var(--text-secondary)",
              display: "-webkit-box",
              WebkitBoxOrient: "vertical",
              WebkitLineClamp: 2,
              overflow: "hidden",
              minHeight: 36,
            }}
          >
            {voice.status === "failed" && voice.statusError
              ? voice.statusError
              : (voice.description ?? "No description.")}
          </p>
        </div>
      </div>

      {/* Stat strip — 4 cells matching Characters pattern */}
      <div style={{ display: "flex", borderTop: "1px solid var(--divider)" }}>
        <StatCell
          label="duration"
          value={formatDuration(voice.durationS)}
          mono
          dim={voice.durationS == null}
        />
        <StatCell
          label="sample"
          value={formatSampleRate(voice.sampleRate)}
          mono
          dim={voice.sampleRate == null}
        />
        <StatCell
          label="bound"
          value={
            voice.boundCharacterCount === 0
              ? "—"
              : String(voice.boundCharacterCount)
          }
          accent={voice.boundCharacterCount > 0}
          dim={voice.boundCharacterCount === 0}
          last
        />
      </div>

      {/* Footer — slug + last event */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "10px 22px",
          borderTop: "1px solid var(--divider)",
        }}
      >
        <span
          style={{
            fontFamily: FONT_MONO,
            fontSize: 10,
            color: "var(--text-quaternary)",
          }}
        >
          {voice.slug}
        </span>
        <span
          style={{
            fontFamily: FONT_MONO,
            fontSize: 10,
            color:
              voice.status === "failed"
                ? STATUS_COLORS.failed
                : "var(--text-tertiary)",
          }}
        >
          {formatLastEvent(voice)}
        </span>
      </div>
    </Link>
  );
}

/* ── Sub-components ───────────────────────────────────────────── */

function WaveformThumb({ tinted }: { tinted: boolean }) {
  return (
    <div
      style={{
        width: 88,
        height: 88,
        flexShrink: 0,
        background:
          "linear-gradient(135deg, #105A59 0%, #1a3a3a 50%, #0f2828 100%)",
        border: `1px solid ${tinted ? "color-mix(in srgb, var(--accent-strong) 22%, transparent)" : "var(--border)"}`,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
      aria-hidden
    >
      <svg
        width="48"
        height="34"
        viewBox="0 0 100 60"
        fill="none"
        stroke="var(--accent-strong)"
        strokeWidth="3"
        strokeLinecap="round"
      >
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
    </div>
  );
}

function StatusPill({ status }: { status: VoiceStatus }) {
  const color = STATUS_COLORS[status];
  const label = STATUS_LABELS[status];
  const isActive = status === "ready" || status === "processing";
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
      <span
        aria-hidden
        style={{
          display: "inline-block",
          width: 6,
          height: 6,
          borderRadius: 999,
          background: color,
          boxShadow: isActive ? `0 0 8px ${color}` : undefined,
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
  );
}

function StatCell({
  label,
  value,
  mono,
  accent,
  dim,
  last,
}: {
  label: string;
  value: string;
  mono?: boolean;
  accent?: boolean;
  dim?: boolean;
  last?: boolean;
}) {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 4,
        padding: "12px 16px",
        flex: 1,
        minWidth: 0,
        borderRight: last ? "none" : "1px solid var(--divider)",
      }}
    >
      <span
        style={{
          fontFamily: FONT_MONO,
          fontSize: 9,
          letterSpacing: "0.18em",
          textTransform: "uppercase",
          color: "var(--text-tertiary)",
        }}
      >
        {label}
      </span>
      <span
        style={{
          fontFamily: accent ? FONT_HEAD : FONT_MONO,
          fontSize: accent ? 14 : 11,
          fontWeight: accent ? 600 : 400,
          letterSpacing: accent ? "-0.01em" : "normal",
          color: dim
            ? "var(--text-quaternary)"
            : accent
              ? ACCENT
              : "var(--text-secondary)",
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
      >
        {value}
      </span>
    </div>
  );
}

/* ── Refresh button ───────────────────────────────────────────── */

function RefreshButton() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  return (
    <>
      <style>{`@keyframes voices-refresh-spin{from{transform:rotate(0)}to{transform:rotate(360deg)}}`}</style>
      <button
        type="button"
        onClick={() => startTransition(() => router.refresh())}
        disabled={pending}
        aria-label={pending ? "Refreshing" : "Refresh"}
        title="Refresh"
        style={{
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          width: 30,
          height: 28,
          padding: 0,
          border: "1px solid var(--border)",
          background: "transparent",
          color: "var(--text-tertiary)",
          cursor: pending ? "progress" : "pointer",
          opacity: pending ? 0.75 : 1,
        }}
      >
        <svg
          width="13"
          height="13"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          style={{
            animation: pending
              ? "voices-refresh-spin 800ms linear infinite"
              : undefined,
            transformOrigin: "center",
          }}
        >
          <path d="M3 12a9 9 0 0 1 15-6.7L21 8" />
          <path d="M21 3v5h-5" />
          <path d="M21 12a9 9 0 0 1-15 6.7L3 16" />
          <path d="M3 21v-5h5" />
        </svg>
      </button>
    </>
  );
}

/* ── Sort menu ────────────────────────────────────────────────── */

function SortMenu({
  sort,
  onChange,
}: {
  sort: SortKey;
  onChange: (next: SortKey) => void;
}) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    const esc = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", handler);
      document.removeEventListener("keydown", esc);
    };
  }, [open]);

  const current = SORT_OPTIONS.find((o) => o.key === sort) ?? SORT_OPTIONS[0];

  return (
    <div ref={wrapRef} style={{ position: "relative" }}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="listbox"
        aria-expanded={open}
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 8,
          padding: "8px 14px",
          border: "1px solid var(--border)",
          background: "transparent",
          color: "var(--text-primary)",
          cursor: "pointer",
          fontFamily: FONT_MONO,
          fontSize: 11,
          letterSpacing: "0.10em",
          textTransform: "uppercase",
        }}
      >
        <span style={{ color: "var(--text-tertiary)" }}>sort</span>
        <span style={{ color: "var(--text-primary)" }}>{current.label}</span>
        <span
          style={{
            color: "var(--text-tertiary)",
            fontSize: 9,
            transform: open ? "rotate(180deg)" : "none",
            transition: "transform 120ms",
          }}
        >
          ▾
        </span>
      </button>

      {open && (
        <div
          role="listbox"
          style={{
            position: "absolute",
            top: "calc(100% + 6px)",
            right: 0,
            minWidth: 220,
            padding: 4,
            background: "var(--card)",
            border: "1px solid var(--border)",
            boxShadow: "0 8px 28px rgba(0,0,0,0.35)",
            zIndex: 10,
            display: "flex",
            flexDirection: "column",
            gap: 2,
          }}
        >
          {SORT_OPTIONS.map((opt) => {
            const active = opt.key === sort;
            return (
              <button
                key={opt.key}
                type="button"
                role="option"
                aria-selected={active}
                onClick={() => {
                  onChange(opt.key);
                  setOpen(false);
                }}
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  width: "100%",
                  textAlign: "left",
                  padding: "8px 10px",
                  border: "none",
                  background: active
                    ? "color-mix(in srgb, var(--accent-strong) 10%, transparent)"
                    : "transparent",
                  color: active ? ACCENT : "var(--text-primary)",
                  fontFamily: FONT_HEAD,
                  fontSize: 13,
                  fontWeight: active ? 500 : 400,
                  cursor: "pointer",
                }}
              >
                <span>{opt.label}</span>
                {active && (
                  <svg
                    width="12"
                    height="12"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden
                  >
                    <path d="M5 12l5 5L20 7" />
                  </svg>
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
