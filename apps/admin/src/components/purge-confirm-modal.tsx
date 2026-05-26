"use client";

import { useEffect, useState } from "react";

/**
 * Confirm modal for purge actions. Shows a "blast radius" panel with the
 * impact (source, orphan pages, cascading edges). Designed in Paper under
 * "Admin — Purge Confirm Modal" (artboard YY2-0).
 *
 * Context determines the eyebrow label + primary button text. Preview data
 * is passed in by the caller — this component does no fetching.
 */

const T = {
  fg: "#EDEEF3",
  fgDim: "rgba(237,238,243,0.82)",
  muted: "rgba(255,255,255,0.62)",
  mutedSoft: "rgba(255,255,255,0.48)",
  mutedFaint: "rgba(255,255,255,0.42)",
  panel: "#12141A",
  border: "rgba(255,255,255,0.08)",
  borderBtn: "rgba(255,255,255,0.10)",
  backdrop: "rgba(6,8,14,0.72)",
  danger: "#E89090",
  dangerText: "#F2B4B4",
  dangerBg12: "rgba(232,144,144,0.12)",
  dangerBg08: "rgba(232,144,144,0.08)",
  dangerBg04: "rgba(232,144,144,0.035)",
  dangerBg14: "rgba(232,144,144,0.14)",
  dangerBorder: "rgba(232,144,144,0.45)",
  dangerBorderSoft: "rgba(232,144,144,0.14)",
  dangerRowBorder: "rgba(232,144,144,0.06)",
  fontHeading: "'Space Grotesk', sans-serif",
  fontBody: "'Inter', sans-serif",
  fontMono: "var(--font-mono, 'JetBrains Mono', monospace)",
};

export type PurgeKind = "source" | "run";

export type PurgePreview = {
  source: { title: string; kind: string; hashPrefix: string } | null;
  /** Only meaningful for `run`: true when other runs share the same source. */
  sourceShared?: boolean;
  pagesRemoved: number;
  edgesRemoved: number;
};

export function PurgeConfirmModal({
  open,
  kind,
  preview,
  loading,
  pending,
  error,
  onCancel,
  onConfirm,
}: {
  open: boolean;
  kind: PurgeKind;
  preview: PurgePreview | null;
  loading: boolean;
  pending: boolean;
  error: string | null;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  // Escape-to-cancel.
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape" && !pending) onCancel();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, pending, onCancel]);

  if (!open) return null;

  const eyebrow = kind === "run" ? "Purge ingestion" : "Purge source";
  const title = kind === "run" ? "Purge this ingestion run?" : "Purge this source?";
  const subtitle =
    kind === "run"
      ? "The run, its source, and any pages whose only provenance was this source will be permanently removed. Pages backed by other sources keep."
      : "This source and any pages whose only provenance was this source will be permanently removed. Pages backed by other sources keep.";
  const confirmLabel = kind === "run" ? "Purge run" : "Purge source";

  const sourceShared = kind === "run" && preview?.sourceShared === true;
  const sourceLineTitle = preview?.source
    ? `Source · ${preview.source.title}`
    : "Source · (unknown)";
  const sourceLineMeta = preview?.source
    ? `${preview.source.kind} · sha ${preview.source.hashPrefix}`
    : "no source linked";
  const sourceCount = preview?.source && !sourceShared ? 1 : 0;
  const pagesCount = preview?.pagesRemoved ?? 0;
  const edgesCount = preview?.edgesRemoved ?? 0;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="purge-modal-title"
      onMouseDown={(e) => {
        // Click-outside cancels, but only when clicking the backdrop itself.
        if (e.target === e.currentTarget && !pending) onCancel();
      }}
      style={{
        position: "fixed", inset: 0, zIndex: 1000,
        display: "flex", alignItems: "center", justifyContent: "center",
        padding: "var(--space-16)",
        backgroundColor: T.backdrop,
        backdropFilter: "blur(3px)",
        WebkitBackdropFilter: "blur(3px)",
        animation: "purgeFade 140ms ease-out",
      }}
    >
      <style>{`
        @keyframes purgeFade { from { opacity: 0 } to { opacity: 1 } }
        @keyframes purgeRise { from { opacity: 0; transform: translateY(6px) scale(0.985) } to { opacity: 1; transform: none } }
      `}</style>
      <div
        style={{
          width: 520, maxWidth: "100%",
          background: T.panel,
          border: `1px solid ${T.border}`,
          borderRadius: "var(--radius-3xl)",
          boxShadow: "var(--elevation-panel)",
          overflow: "hidden",
          animation: "purgeRise 180ms cubic-bezier(0.22, 1, 0.36, 1)",
        }}
      >
        {/* Header */}
        <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-10)", padding: "24px 24px 20px 24px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "var(--space-8)" }}>
            <span style={{
              display: "flex", alignItems: "center", justifyContent: "center",
              width: 22, height: 22, borderRadius: "var(--radius-sm)",
              background: T.dangerBg12, flexShrink: 0,
            }}>
              <TrashIcon size={11} stroke={T.danger} strokeWidth={2.4} />
            </span>
            <span style={{
              fontFamily: T.fontMono, fontSize: "var(--font-size-xs)", fontWeight: 600,
              color: T.danger, letterSpacing: "0.12em", textTransform: "uppercase",
            }}>
              {eyebrow}
            </span>
          </div>
          <div
            id="purge-modal-title"
            style={{
              fontFamily: T.fontHeading, fontSize: "var(--font-size-3xl)", fontWeight: 600,
              color: T.fg, lineHeight: "28px", letterSpacing: "-0.005em",
            }}
          >
            {title}
          </div>
          <div style={{
            fontFamily: T.fontBody, fontSize: "var(--font-size-md)", color: T.muted, lineHeight: "20px",
          }}>
            {subtitle}
          </div>
        </div>

        {/* Blast radius panel */}
        <div style={{
          display: "flex", flexDirection: "column",
          margin: "0 24px",
          border: `1px solid ${T.dangerBorderSoft}`,
          borderRadius: "var(--radius-xl)",
          background: T.dangerBg04,
          overflow: "hidden",
        }}>
          <div style={{
            display: "flex", alignItems: "center", justifyContent: "space-between",
            padding: "10px 16px",
            borderBottom: "1px solid rgba(232,144,144,0.10)",
          }}>
            <span style={{
              fontFamily: T.fontMono, fontSize: 9.5, fontWeight: 500,
              color: "rgba(232,144,144,0.75)",
              letterSpacing: "0.14em", textTransform: "uppercase",
            }}>
              Blast radius
            </span>
            <span style={{ fontFamily: T.fontBody, fontSize: "var(--font-size-sm)", color: "rgba(255,255,255,0.45)" }}>
              {loading ? "computing…" : "cannot be undone"}
            </span>
          </div>

          <BlastRow
            icon={<FileIcon size={11} stroke={T.danger} />}
            iconBg={T.dangerBg12}
            title={sourceLineTitle}
            meta={sourceShared ? "shared with another run — kept" : sourceLineMeta}
            count={sourceCount}
            countDim={sourceCount === 0}
            bordered
            muted={sourceShared}
          />
          <BlastRow
            icon={<PagesIcon size={11} stroke={T.danger} />}
            iconBg={T.dangerBg12}
            title="Orphan wiki pages"
            meta="pages with no other provenance"
            count={pagesCount}
            countDim={pagesCount === 0}
            bordered
          />
          <BlastRow
            icon={<EdgeIcon size={11} stroke="rgba(232,144,144,0.75)" />}
            iconBg={T.dangerBg08}
            title="Edges off orphans"
            meta="cascade automatically"
            count={edgesCount}
            countDim
            muted
          />
        </div>

        {error && (
          <div style={{
            margin: "14px 24px 0 24px",
            padding: "10px 14px",
            borderRadius: "var(--radius-lg)",
            background: T.dangerBg08,
            border: "1px solid rgba(232,144,144,0.20)",
            fontFamily: T.fontBody, fontSize: "var(--font-size-base)", color: T.dangerText,
          }}>
            {error}
          </div>
        )}

        {/* Footer */}
        <div style={{
          display: "flex", alignItems: "center", justifyContent: "flex-end",
          gap: "var(--space-8)", padding: "18px 24px 22px 24px",
        }}>
          <button
            type="button"
            onClick={onCancel}
            disabled={pending}
            style={{
              padding: "8px 16px", borderRadius: "var(--radius-md)",
              border: `1px solid ${T.borderBtn}`,
              background: "transparent",
              color: "rgba(237,238,243,0.85)",
              fontFamily: T.fontBody, fontSize: 12.5, fontWeight: 500,
              cursor: pending ? "not-allowed" : "pointer",
              opacity: pending ? 0.6 : 1,
            }}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={pending || loading}
            style={{
              display: "flex", alignItems: "center", gap: 7,
              padding: "8px 16px", borderRadius: "var(--radius-md)",
              border: `1px solid ${T.dangerBorder}`,
              background: T.dangerBg14,
              color: T.dangerText,
              fontFamily: T.fontBody, fontSize: 12.5, fontWeight: 600,
              cursor: pending || loading ? "not-allowed" : "pointer",
              opacity: pending || loading ? 0.6 : 1,
            }}
          >
            <TrashIcon size={11} stroke={T.dangerText} strokeWidth={2.2} />
            <span>{pending ? "Purging…" : confirmLabel}</span>
          </button>
        </div>
      </div>
    </div>
  );
}

/* ── Row ───────────────────────────────────────────────────────── */

function BlastRow({
  icon, iconBg, title, meta, count, countDim, bordered, muted,
}: {
  icon: React.ReactNode;
  iconBg: string;
  title: string;
  meta: string;
  count: number;
  countDim?: boolean;
  bordered?: boolean;
  muted?: boolean;
}) {
  return (
    <div style={{
      display: "flex", alignItems: "center", gap: "var(--space-12)",
      padding: "12px 16px",
      borderBottom: bordered ? `1px solid ${T.dangerRowBorder}` : "none",
    }}>
      <span style={{
        width: 22, height: 22, borderRadius: "var(--radius-sm)", background: iconBg,
        display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
      }}>
        {icon}
      </span>
      <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-1)", flex: 1, minWidth: 0 }}>
        <span style={{
          fontFamily: T.fontBody, fontSize: "var(--font-size-md)", fontWeight: 500,
          color: muted ? T.fgDim : T.fg, lineHeight: "18px",
          overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
        }}>
          {title}
        </span>
        <span style={{
          fontFamily: T.fontBody, fontSize: "var(--font-size-sm)",
          color: muted ? T.mutedFaint : T.mutedSoft, lineHeight: "16px",
        }}>
          {meta}
        </span>
      </div>
      <span style={{
        fontFamily: T.fontHeading, fontSize: 15, fontWeight: 600,
        color: countDim ? "rgba(232,144,144,0.45)" : T.danger,
        lineHeight: "20px", flexShrink: 0,
      }}>
        {count}
      </span>
    </div>
  );
}

/* ── Icons ─────────────────────────────────────────────────────── */

function TrashIcon({ size, stroke, strokeWidth = 2 }: { size: number; stroke: string; strokeWidth?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={stroke} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 6h18" />
      <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
      <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
    </svg>
  );
}

function FileIcon({ size, stroke }: { size: number; stroke: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={stroke} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <polyline points="14 2 14 8 20 8" />
    </svg>
  );
}

function PagesIcon({ size, stroke }: { size: number; stroke: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={stroke} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <path d="M3 9h18" />
      <path d="M9 3v18" />
    </svg>
  );
}

function EdgeIcon({ size, stroke }: { size: number; stroke: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={stroke} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <circle cx="6" cy="6" r="2.5" />
      <circle cx="18" cy="18" r="2.5" />
      <path d="M8 8l8 8" />
    </svg>
  );
}
