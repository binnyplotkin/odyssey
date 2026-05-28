"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import type { VoiceProvider } from "@odyssey/db";
import { ConfirmModal } from "@odyssey/ui";
import { useHeaderContent } from "@/components/header-context";
import { Pathname } from "@/components/pathname";
import { resolveAvatarGradient } from "@/lib/avatar-gradients";
import { DEFAULT_AUDITION_PROMPT } from "@/lib/voices-prompts";
import type {
  VoiceAttemptRecord,
  VoiceDetailBindings,
  VoiceDetailData,
  VoicePreviewWithUrl,
} from "@/app/(authenticated)/voices/[slug]/page";

/* ── Tokens ───────────────────────────────────────────────────── */

const FONT_HEAD = "'Inter', system-ui, sans-serif";
const FONT_MONO = "'JetBrains Mono', ui-monospace, monospace";

const PROVIDER_LABELS: Record<VoiceProvider, string> = {
  pocket_tts: "POCKET",
  elevenlabs: "ELEVEN",
  openai: "OPENAI",
  cartesia: "CARTESIA",
};

const GENDER_OPTIONS = ["masc", "fem", "neutral", "other"] as const;

/** Fields editable via the page-level Edit / Save flow. Mirrors the
 * PATCH /api/voices/[id] body shape. `providerConfig` is replaced
 * wholesale (a jsonb blob whose shape depends on the provider) — the
 * Provider Config card builds the full object before staging it. */
type EditableVoiceFields = {
  name: string;
  slug: string;
  description: string | null;
  tags: string[];
  language: string | null;
  gender: string | null;
  license: string | null;
  attribution: string | null;
  providerConfig: Record<string, unknown>;
};

/* ── Component ────────────────────────────────────────────────── */

type Props = {
  voice: VoiceDetailData;
  bindings: VoiceDetailBindings;
  sourceUrl: string | null;
  embeddingUrl: string | null;
  previewUrl: string | null;
  previews: VoicePreviewWithUrl[];
  attempts: VoiceAttemptRecord[];
};

type ActionKind = "extract" | "delete" | "archive" | "unarchive";

export function VoiceDetail({
  voice,
  bindings,
  sourceUrl,
  embeddingUrl,
  previewUrl,
  previews,
  attempts,
}: Props) {
  const router = useRouter();
  const [actionPending, setActionPending] = useState<ActionKind | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  /* Delete is the only action gated behind a confirm dialog. Archive
   * is reversible so it commits inline; everything else just runs. */
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);

  /* ── Page-level edit mode ─────────────────────────────────────
   * One Edit / Save / Cancel toggle drives every authorial field
   * on the voice row (name, slug, description + curation metadata).
   * Drafts accumulate locally; Save commits the diff in a single
   * PATCH. Cancel discards drafts and exits edit mode.
   *
   * Preview gallery + extraction journal remain independent flows —
   * they're CRUD on child tables, not edits to the voice row. */
  const [editing, setEditing] = useState(false);
  const [drafts, setDrafts] = useState<Partial<EditableVoiceFields>>({});
  const [savePending, setSavePending] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const setDraft = useCallback(
    <K extends keyof EditableVoiceFields>(
      key: K,
      value: EditableVoiceFields[K],
    ) => {
      setDrafts((d) => ({ ...d, [key]: value }));
    },
    [],
  );

  const getDraft = useCallback(
    <K extends keyof EditableVoiceFields>(
      key: K,
    ): EditableVoiceFields[K] => {
      if (key in drafts) {
        return drafts[key] as EditableVoiceFields[K];
      }
      return voice[key] as EditableVoiceFields[K];
    },
    [drafts, voice],
  );

  const cancelEdit = useCallback(() => {
    setDrafts({});
    setSaveError(null);
    setEditing(false);
  }, []);

  const saveEdit = useCallback(async () => {
    // Empty drafts = nothing changed; just exit edit mode.
    if (Object.keys(drafts).length === 0) {
      setEditing(false);
      return;
    }
    setSavePending(true);
    setSaveError(null);
    try {
      const res = await fetch(`/api/voices/${voice.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(drafts),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      // If the slug changed, the URL needs to follow.
      const newSlug = drafts.slug;
      setDrafts({});
      setEditing(false);
      if (typeof newSlug === "string" && newSlug !== voice.slug) {
        router.push(`/voices/${newSlug}`);
      } else {
        router.refresh();
      }
    } catch (err) {
      setSaveError((err as Error).message);
    } finally {
      setSavePending(false);
    }
  }, [drafts, voice.id, voice.slug, router]);

  /* While processing, poll the server every 3s so the user sees the result
   * land without a manual refresh. router.refresh() re-runs the RSC and
   * re-hydrates this component with the new status. */
  useEffect(() => {
    if (voice.status !== "processing") return;
    const id = setInterval(() => router.refresh(), 3000);
    return () => clearInterval(id);
  }, [voice.status, router]);

  /* Inline rename from the breadcrumb. Patches the `name` field directly
   * (slug stays put — the URL doesn't follow display-name changes here, the
   * same way it doesn't on /characters/[slug]). Hits the same PATCH route
   * the bulk-edit Save uses. */
  const renameVoice = useCallback(
    async (next: string) => {
      const res = await fetch(`/api/voices/${voice.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: next }),
      });
      if (!res.ok) return;
      router.refresh();
    },
    [voice.id, router],
  );

  /* ── Header injection ─────────────────────────────────────── */

  const { setContent } = useHeaderContent();
  useEffect(() => {
    setContent(
      <div
        style={{
          display: "flex",
          alignItems: "center",
          width: "100%",
          gap: "var(--space-16)",
        }}
      >
        <Pathname
          segments={[
            { label: "voices", href: "/voices" },
            {
              label: voice.name,
              href: `/voices/${voice.slug}`,
              tag: true,
              editable: {
                onRename: renameVoice,
                ariaLabel: "Voice name",
              },
            },
          ]}
        />
        <span
          style={{
            display: "inline-flex",
            alignItems: "center",
            padding: "2px 9px",
            borderRadius: "var(--radius-pill)",
            border: "1px solid var(--border)",
            fontFamily: FONT_MONO,
            fontSize: "var(--font-size-2xs)",
            fontWeight: 500,
            letterSpacing: "0.20em",
            textTransform: "uppercase",
            color: "var(--text-secondary)",
            whiteSpace: "nowrap",
          }}
          title={`Provider: ${voice.provider}`}
        >
          {PROVIDER_LABELS[voice.provider]}
        </span>
        <div style={{ flex: 1 }} />
        <HeaderEditControls
          editing={editing}
          savePending={savePending}
          onStartEdit={() => setEditing(true)}
          onSave={saveEdit}
          onCancel={cancelEdit}
        />
      </div>,
    );
    return () => setContent(null);
  }, [
    setContent,
    voice.slug,
    voice.name,
    voice.provider,
    editing,
    savePending,
    saveEdit,
    cancelEdit,
    renameVoice,
  ]);

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

  /* Refresh the audition preview clip. Always hits /preview, which
   * branches internally:
   *  - Pocket   → audio-rt /speak with the existing embedding (no
   *               re-extract, the .safetensors stays put)
   *  - Hosted   → provider TTS (ElevenLabs today)
   * Either way it's just the audio clip — to actually re-derive the
   * embedding, use the Re-extract row in the Danger Zone (Pocket only). */
  const triggerRegenerate = useCallback(async () => {
    setActionPending("extract");
    setActionError(null);
    try {
      const res = await fetch(`/api/voices/${voice.id}/preview`, {
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

  // Delete is gated behind the branded ConfirmModal — `triggerDelete`
  // just opens it; `confirmedDelete` does the actual destruction once
  // the user clicks through.
  const triggerDelete = useCallback(() => {
    setDeleteConfirmOpen(true);
  }, []);

  const confirmedDelete = useCallback(async () => {
    setActionPending("delete");
    setActionError(null);
    try {
      const res = await fetch(`/api/voices/${voice.id}`, { method: "DELETE" });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      // Don't bother closing the modal — we're navigating away.
      router.push("/voices");
      router.refresh();
    } catch (err) {
      setActionError((err as Error).message);
      setActionPending(null);
      setDeleteConfirmOpen(false);
    }
  }, [voice.id, router]);

  const triggerArchive = useCallback(async () => {
    setActionPending("archive");
    setActionError(null);
    try {
      const res = await fetch(`/api/voices/${voice.id}/archive`, {
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

  const triggerUnarchive = useCallback(async () => {
    setActionPending("unarchive");
    setActionError(null);
    try {
      const res = await fetch(`/api/voices/${voice.id}/archive`, {
        method: "DELETE",
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

  /* ── Render ───────────────────────────────────────────────── */

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: "var(--space-32)",
        // /voices routes opt out of the shell's default 2rem padding
        // (see admin-shell FLUSH_ROUTE_PREFIXES), so the detail page
        // sets its own gutters. Matches the voices-grid toolbar's 40px
        // horizontal padding for visual continuity between list →
        // detail, with extra bottom space so the audit footer doesn't
        // butt against the viewport edge.
        padding: "24px 40px 64px",
      }}
    >
      {voice.archivedAt && (
        <ArchivedBanner
          archivedAt={voice.archivedAt}
          pending={actionPending === "unarchive"}
          onUnarchive={triggerUnarchive}
        />
      )}
      <PageHeader
        voice={voice}
        actionPending={actionPending}
        onExtract={triggerExtract}
        editing={editing}
        getDraft={getDraft}
        setDraft={setDraft}
      />
      {(actionError || saveError) && (
        <div
          style={{
            padding: "12px 16px",
            background: "var(--critical-wash)",
            border: "1px solid var(--critical-border)",
            borderRadius: "var(--radius-md)",
            color: "var(--status-error)",
            fontFamily: FONT_MONO,
            fontSize: "var(--font-size-base)",
          }}
        >
          {saveError ?? actionError}
        </div>
      )}
      {/* Console split: main canvas (audition + source + takes +
          bindings + journal) on the left, sticky inspector rail on
          the right. The rail collapses under the main column on
          narrower viewports — see the @media check below. */}
      <div
        style={{
          display: "flex",
          gap: "var(--space-32)",
          alignItems: "flex-start",
          flexWrap: "wrap",
        }}
      >
        <main
          style={{
            flex: "1 1 640px",
            minWidth: 0,
            display: "flex",
            flexDirection: "column",
            gap: "var(--space-24)",
          }}
        >
          <ExtractionPanel
            voice={voice}
            previewUrl={previewUrl}
            embeddingUrl={embeddingUrl}
            pending={actionPending === "extract"}
            onExtract={triggerExtract}
            onRegenerate={triggerRegenerate}
            regenerating={actionPending === "extract"}
            regenerateError={actionError}
            attemptCount={attempts.length}
          />
          {voice.provider === "pocket_tts" && voice.status === "ready" && (
            <SourceClipStrip voice={voice} sourceUrl={sourceUrl} />
          )}
          <PreviewGallerySection
            voiceId={voice.id}
            previews={previews}
            onChanged={() => router.refresh()}
          />
          <BindingsSection voice={voice} bindings={bindings} />
          {voice.provider === "pocket_tts" && (
            <ExtractionJournalSection attempts={attempts} />
          )}
        </main>
        <aside
          style={{
            flex: "0 1 380px",
            minWidth: 320,
            position: "sticky",
            top: 80,
            display: "flex",
            flexDirection: "column",
            gap: "var(--space-16)",
          }}
        >
          {voice.provider === "pocket_tts" ? (
            <RailEngineCard voice={voice} embeddingUrl={embeddingUrl} />
          ) : (
            <ProviderConfigCard
              voice={voice}
              editing={editing}
              getDraft={getDraft}
              setDraft={setDraft}
            />
          )}
          <CurationSection
            voice={voice}
            editing={editing}
            getDraft={getDraft}
            setDraft={setDraft}
          />
          <RailAuditCard voice={voice} />
          <DangerZone
            voice={voice}
            actionPending={actionPending}
            onArchive={triggerArchive}
            onUnarchive={triggerUnarchive}
            onExtract={triggerExtract}
            onDelete={triggerDelete}
          />
        </aside>
      </div>
      <ConfirmModal
        open={deleteConfirmOpen}
        onClose={() => {
          if (actionPending !== "delete") setDeleteConfirmOpen(false);
        }}
        onConfirm={confirmedDelete}
        title={`Delete "${voice.name}"?`}
        subtitle="this can't be undone"
        description={
          <>
            Removes the source clip, embedding, and preview from Supabase,
            and unbinds{" "}
            <strong style={{ color: "var(--text-primary)" }}>
              {bindings.length} character{bindings.length === 1 ? "" : "s"}
            </strong>{" "}
            currently using this voice.
          </>
        }
        bullets={[
          "Source clip + embedding + preview deleted from storage",
          bindings.length > 0
            ? `${bindings.length} character${bindings.length === 1 ? "" : "s"} fall back to the default voice`
            : null,
          <>
            Slug{" "}
            <code
              style={{
                fontFamily:
                  "'JetBrains Mono', ui-monospace, monospace",
                fontSize: "var(--font-size-base)",
                color: "var(--text-primary)",
              }}
            >
              {voice.slug}
            </code>{" "}
            becomes available again
          </>,
        ].filter(Boolean) as React.ReactNode[]}
        hint="Prefer Archive for a reversible soft-delete — Library hides the voice but bound characters keep playing."
        confirmLabel="delete voice"
        tone="destructive"
        pending={actionPending === "delete"}
      />
    </div>
  );
}

/* ── Archived banner ──────────────────────────────────────────── */

function ArchivedBanner({
  archivedAt,
  pending,
  onUnarchive,
}: {
  archivedAt: string;
  pending: boolean;
  onUnarchive: () => void;
}) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: "var(--space-16)",
        padding: "14px 18px",
        background: "var(--critical-wash)",
        border: "1px solid var(--critical-border)",
        borderRadius: "var(--radius-md)",
      }}
    >
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--status-error)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <rect x="3" y="4" width="18" height="4" />
        <path d="M5 8v12h14V8" />
        <line x1="10" y1="12" x2="14" y2="12" />
      </svg>
      <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: "var(--space-2)" }}>
        <span style={{ fontFamily: FONT_HEAD, fontSize: "var(--font-size-md)", fontWeight: 600, color: "var(--text-primary)" }}>
          Archived {relativeFromIso(archivedAt)}
        </span>
        <span style={{ fontFamily: FONT_HEAD, fontSize: "var(--font-size-base)", color: "var(--text-secondary)" }}>
          Hidden from the library. Bound characters keep playing — unarchive any time to restore visibility.
        </span>
      </div>
      <button
        type="button"
        onClick={onUnarchive}
        disabled={pending}
        style={{
          padding: "7px 14px",
          background: "transparent",
          border: "1px solid color-mix(in srgb, var(--status-error) 40%, transparent)",
          color: "var(--status-error)",
          fontFamily: FONT_HEAD,
          fontSize: "var(--font-size-base)",
          fontWeight: 600,
          cursor: pending ? "progress" : "pointer",
          opacity: pending ? 0.6 : 1,
        }}
      >
        {pending ? "restoring…" : "unarchive"}
      </button>
    </div>
  );
}

/* ── Inline edit helpers ─────────────────────────────────────── */

async function patchVoice(
  id: string,
  body: Record<string, unknown>,
): Promise<void> {
  const res = await fetch(`/api/voices/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error ?? `HTTP ${res.status}`);
  }
}

/** Inline text editor — click the value to start editing, Enter or Save
 * blur the field, Esc cancels. Renders `display` as the at-rest view and
 * an <input>/<textarea> in editing mode. */
function InlineText({
  voiceId,
  field,
  value,
  placeholder,
  textStyle,
  containerStyle,
  multiline = false,
  onSaved,
  emptyDisplay,
  inputStyle,
  formatValue,
}: {
  voiceId: string;
  field: string;
  value: string | null;
  placeholder?: string;
  textStyle?: CSSProperties;
  containerStyle?: CSSProperties;
  multiline?: boolean;
  onSaved: () => void;
  emptyDisplay?: string;
  inputStyle?: CSSProperties;
  formatValue?: (raw: string) => string;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value ?? "");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement | HTMLTextAreaElement | null>(null);

  useEffect(() => {
    if (!editing) setDraft(value ?? "");
  }, [value, editing]);

  useEffect(() => {
    if (editing && inputRef.current) {
      inputRef.current.focus();
      if (inputRef.current instanceof HTMLInputElement) {
        inputRef.current.select();
      }
    }
  }, [editing]);

  const commit = useCallback(async () => {
    const formatted = formatValue ? formatValue(draft) : draft;
    const trimmed = formatted.trim();
    const original = value ?? "";
    // Send empty string as null (server interprets "" as clear) — except
    // for fields like name/slug where empty is invalid and the server
    // returns 400. We rely on the server to enforce that.
    if (trimmed === original.trim()) {
      setEditing(false);
      return;
    }
    setPending(true);
    setError(null);
    try {
      await patchVoice(voiceId, { [field]: trimmed === "" ? null : trimmed });
      setEditing(false);
      onSaved();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setPending(false);
    }
  }, [draft, value, voiceId, field, onSaved, formatValue]);

  const cancel = useCallback(() => {
    setDraft(value ?? "");
    setEditing(false);
    setError(null);
  }, [value]);

  if (editing) {
    const sharedStyle: CSSProperties = {
      flex: 1,
      minWidth: 0,
      border: "1px solid var(--accent-strong)",
      background: "var(--accent-wash)",
      color: "var(--text-primary)",
      padding: multiline ? "10px 12px" : "8px 12px",
      fontFamily: FONT_HEAD,
      fontSize: "var(--font-size-lg)",
      lineHeight: multiline ? "21px" : undefined,
      outline: "none",
      resize: multiline ? "vertical" : undefined,
      ...(inputStyle ?? {}),
    };
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-6)" }}>
        <div style={{ display: "flex", alignItems: "flex-start", gap: "var(--space-8)" }}>
          {multiline ? (
            <textarea
              ref={(el) => {
                inputRef.current = el;
              }}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Escape") cancel();
              }}
              rows={3}
              style={sharedStyle as CSSProperties}
              disabled={pending}
              placeholder={placeholder}
            />
          ) : (
            <input
              ref={(el) => {
                inputRef.current = el;
              }}
              type="text"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  void commit();
                }
                if (e.key === "Escape") cancel();
              }}
              style={sharedStyle as CSSProperties}
              disabled={pending}
              placeholder={placeholder}
            />
          )}
          <div style={{ display: "flex", gap: "var(--space-6)", flexShrink: 0 }}>
            <button
              type="button"
              onClick={() => void commit()}
              disabled={pending}
              style={{
                padding: "7px 12px",
                background: "var(--accent-strong)",
                color: "var(--background)",
                border: "1px solid var(--accent-strong)",
                fontFamily: FONT_HEAD,
                fontSize: "var(--font-size-base)",
                fontWeight: 600,
                cursor: pending ? "progress" : "pointer",
                opacity: pending ? 0.6 : 1,
              }}
            >
              {pending ? "saving…" : "save"}
            </button>
            <button
              type="button"
              onClick={cancel}
              disabled={pending}
              style={{
                padding: "7px 10px",
                background: "transparent",
                color: "var(--text-secondary)",
                border: "1px solid var(--border)",
                borderRadius: "var(--radius-md)",
                fontFamily: FONT_HEAD,
                fontSize: "var(--font-size-base)",
                cursor: "pointer",
              }}
            >
              cancel
            </button>
          </div>
        </div>
        {error && (
          <span style={{ fontFamily: FONT_MONO, fontSize: "var(--font-size-sm)", color: "var(--status-error)" }}>
            {error}
          </span>
        )}
      </div>
    );
  }

  const isEmpty = !value || value.trim() === "";
  return (
    <button
      type="button"
      onClick={() => setEditing(true)}
      style={{
        display: "flex",
        alignItems: "flex-start",
        gap: "var(--space-10)",
        background: "transparent",
        border: "1px solid transparent",
        padding: "6px 10px",
        textAlign: "left",
        cursor: "text",
        width: "100%",
        margin: "-6px -10px",
        transition: "background 120ms, border-color 120ms",
        ...(containerStyle ?? {}),
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.background = "color-mix(in srgb, var(--text-primary) 3%, transparent)";
        e.currentTarget.style.borderColor = "color-mix(in srgb, var(--text-primary) 8%, transparent)";
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = "transparent";
        e.currentTarget.style.borderColor = "transparent";
      }}
    >
      <span
        style={{
          flex: 1,
          minWidth: 0,
          fontFamily: FONT_HEAD,
          fontSize: "var(--font-size-lg)",
          lineHeight: "21px",
          color: isEmpty ? "var(--text-quaternary)" : "var(--text-secondary)",
          fontStyle: isEmpty ? "italic" : "normal",
          whiteSpace: "pre-wrap",
          wordBreak: "break-word",
          ...(textStyle ?? {}),
        }}
      >
        {isEmpty ? (emptyDisplay ?? placeholder ?? "Click to add…") : value}
      </span>
      <PencilGlyph />
    </button>
  );
}

function PencilGlyph() {
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        width: 14,
        height: 14,
        color: "var(--text-quaternary)",
        flexShrink: 0,
        marginTop: "var(--space-4)",
      }}
    >
      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M3 17.25V21h3.75l11-11-3.75-3.75-11 11Z" />
        <path d="m14.5 6.5 3 3" />
      </svg>
    </span>
  );
}

/* ── Header edit controls ─────────────────────────────────────
 *
 * Rendered into the root admin header via useHeaderContent. One
 * `edit` button toggles the whole page into edit mode; once
 * editing, swaps to `cancel` + `save`. */
function HeaderEditControls({
  editing,
  savePending,
  onStartEdit,
  onSave,
  onCancel,
}: {
  editing: boolean;
  savePending: boolean;
  onStartEdit: () => void;
  onSave: () => void;
  onCancel: () => void;
}) {
  if (!editing) {
    return (
      <button
        type="button"
        onClick={onStartEdit}
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: "var(--space-6)",
          padding: "5px 10px",
          background: "transparent",
          border: "1px solid var(--border)",
          borderRadius: "var(--radius-md)",
          color: "var(--text-secondary)",
          fontFamily: FONT_MONO,
          fontSize: "var(--font-size-sm)",
          fontWeight: 500,
          letterSpacing: "0.10em",
          textTransform: "uppercase",
          cursor: "pointer",
          whiteSpace: "nowrap",
        }}
      >
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M3 17.25V21h3.75l11-11-3.75-3.75-11 11Z" />
          <path d="m14.5 6.5 3 3" />
        </svg>
        edit
      </button>
    );
  }
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: "var(--space-8)" }}>
      <button
        type="button"
        onClick={onCancel}
        disabled={savePending}
        style={{
          padding: "5px 10px",
          background: "transparent",
          border: "1px solid var(--border)",
          borderRadius: "var(--radius-md)",
          color: "var(--text-secondary)",
          fontFamily: FONT_MONO,
          fontSize: "var(--font-size-sm)",
          fontWeight: 500,
          letterSpacing: "0.10em",
          textTransform: "uppercase",
          cursor: savePending ? "progress" : "pointer",
          opacity: savePending ? 0.6 : 1,
          whiteSpace: "nowrap",
        }}
      >
        cancel
      </button>
      <button
        type="button"
        onClick={onSave}
        disabled={savePending}
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: "var(--space-6)",
          padding: "5px 10px",
          background: "var(--accent-strong)",
          border: "1px solid var(--accent-strong)",
          borderRadius: "var(--radius-md)",
          color: "var(--background)",
          fontFamily: FONT_MONO,
          fontSize: "var(--font-size-sm)",
          fontWeight: 600,
          letterSpacing: "0.10em",
          textTransform: "uppercase",
          cursor: savePending ? "progress" : "pointer",
          opacity: savePending ? 0.6 : 1,
          whiteSpace: "nowrap",
        }}
      >
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="20 6 9 17 4 12" />
        </svg>
        {savePending ? "saving…" : "save"}
      </button>
    </span>
  );
}

/* ── Controlled editable fields ──────────────────────────────── */

function NameField({
  editing,
  value,
  onChange,
}: {
  editing: boolean;
  value: string;
  onChange: (v: string) => void;
}) {
  const displayStyle: CSSProperties = {
    fontFamily: FONT_HEAD,
    fontSize: 36,
    fontWeight: 600,
    lineHeight: "42px",
    color: "var(--text-primary)",
    letterSpacing: "-0.02em",
  };
  if (editing) {
    return (
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="Voice name"
        autoFocus
        style={{
          ...displayStyle,
          flex: "0 1 auto",
          minWidth: 0,
          padding: "2px 12px",
          background: "var(--accent-wash)",
          border: "1px solid var(--accent-strong)",
          borderRadius: "var(--radius-md)",
          outline: "none",
          fontSize: 30,
          lineHeight: "44px",
        }}
      />
    );
  }
  return <span style={displayStyle}>{value}</span>;
}

function SlugField({
  editing,
  value,
  onChange,
}: {
  editing: boolean;
  value: string;
  onChange: (v: string) => void;
}) {
  if (editing) {
    return (
      <div style={{ display: "inline-flex", alignItems: "center", gap: "var(--space-6)" }}>
        <span style={{ fontFamily: FONT_MONO, fontSize: "var(--font-size-md)", color: "var(--text-quaternary)" }}>
          /
        </span>
        <input
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value.toLowerCase())}
          placeholder="slug"
          style={{
            padding: "6px 10px",
            border: "1px solid var(--accent-strong)",
            borderRadius: "var(--radius-md)",
            background: "var(--accent-wash)",
            color: "var(--text-primary)",
            fontFamily: FONT_MONO,
            fontSize: "var(--font-size-md)",
            outline: "none",
            width: 200,
          }}
        />
      </div>
    );
  }
  return (
    <div style={{ display: "inline-flex", alignItems: "center", gap: "var(--space-6)" }}>
      <span style={{ fontFamily: FONT_MONO, fontSize: "var(--font-size-md)", color: "var(--text-quaternary)" }}>
        /
      </span>
      <span style={{ fontFamily: FONT_MONO, fontSize: "var(--font-size-md)", color: "var(--text-tertiary)" }}>
        {value}
      </span>
    </div>
  );
}

function DescriptionField({
  editing,
  value,
  onChange,
}: {
  editing: boolean;
  value: string | null;
  onChange: (v: string | null) => void;
}) {
  if (editing) {
    return (
      <textarea
        value={value ?? ""}
        onChange={(e) => onChange(e.target.value === "" ? null : e.target.value)}
        placeholder="Add a short description — voice character, tone, source"
        rows={3}
        style={{
          width: "100%",
          minWidth: 0,
          padding: "10px 14px",
          border: "1px solid var(--accent-strong)",
          borderRadius: "var(--radius-md)",
          background: "var(--accent-wash)",
          color: "var(--text-primary)",
          fontFamily: FONT_HEAD,
          fontSize: "var(--font-size-lg)",
          lineHeight: "21px",
          outline: "none",
          resize: "vertical",
        }}
      />
    );
  }
  const isEmpty = !value || value.trim() === "";
  return (
    <span
      style={{
        display: "block",
        fontFamily: FONT_HEAD,
        fontSize: "var(--font-size-lg)",
        lineHeight: "21px",
        color: isEmpty ? "var(--text-quaternary)" : "var(--text-secondary)",
        fontStyle: isEmpty ? "italic" : "normal",
        whiteSpace: "pre-wrap",
        wordBreak: "break-word",
      }}
    >
      {isEmpty ? "No description set yet." : value}
    </span>
  );
}

/* ── Page header ──────────────────────────────────────────────── */

/** Identity strip for the Console layout. The hero used to be a 112px
 * waveform tile next to the name; in the new design the *audio* is the
 * hero, so this strip is just the voice's identity inline:
 *
 *   VOICE · vc_01krw9s1nxnhq…           (mono eyebrow)
 *   Calliope  / calliope                (display name + slug chip)
 *   description text                    (or empty muted placeholder)
 *
 * Action buttons (retry extraction, extract embedding) still surface
 * on the right for non-ready statuses. */
function PageHeader({
  voice,
  actionPending,
  onExtract,
  editing,
  getDraft,
  setDraft,
}: {
  voice: VoiceDetailData;
  actionPending: ActionKind | null;
  onExtract: () => void;
  editing: boolean;
  getDraft: <K extends keyof EditableVoiceFields>(
    key: K,
  ) => EditableVoiceFields[K];
  setDraft: <K extends keyof EditableVoiceFields>(
    key: K,
    value: EditableVoiceFields[K],
  ) => void;
}) {
  const [idHovered, setIdHovered] = useState(false);
  const [copied, setCopied] = useState(false);
  const copyVoiceId = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(voice.id);
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch {
      // Clipboard access can fail in non-secure contexts; swallow silently.
    }
  }, [voice.id]);

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "row",
        alignItems: "flex-end",
        justifyContent: "space-between",
        gap: "var(--space-32)",
      }}
    >
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: "var(--space-10)",
          flex: 1,
          minWidth: 0,
        }}
      >
        <div
          onMouseEnter={() => setIdHovered(true)}
          onMouseLeave={() => setIdHovered(false)}
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: "var(--space-10)",
            fontFamily: FONT_MONO,
            fontSize: "var(--font-size-xs)",
            letterSpacing: "0.20em",
            textTransform: "uppercase",
            color: "var(--text-quaternary)",
          }}
        >
          <span>voice</span>
          <span
            aria-hidden
            style={{
              display: "inline-block",
              width: 3,
              height: 3,
              borderRadius: "var(--radius-pill)",
              background: "var(--text-quaternary)",
            }}
          />
          <span style={{ color: "var(--text-tertiary)" }}>{voice.id}</span>
          <button
            type="button"
            onClick={copyVoiceId}
            aria-label={copied ? "Voice ID copied" : "Copy voice ID"}
            style={{
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              width: 18,
              height: 18,
              padding: 0,
              borderRadius: "var(--radius-xs)",
              border: "none",
              background: "transparent",
              color: copied ? "var(--accent-strong)" : "var(--text-tertiary)",
              cursor: "pointer",
              opacity: idHovered || copied ? 1 : 0,
              transition: "opacity 120ms ease, color 120ms ease",
            }}
          >
            {copied ? (
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="20 6 9 17 4 12" />
              </svg>
            ) : (
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="9" y="9" width="13" height="13" rx="2" />
                <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
              </svg>
            )}
          </button>
        </div>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "var(--space-12)",
            flexWrap: "wrap",
          }}
        >
          <NameField
            editing={editing}
            value={getDraft("name")}
            onChange={(v) => setDraft("name", v)}
          />
          <SlugField
            editing={editing}
            value={getDraft("slug")}
            onChange={(v) => setDraft("slug", v)}
          />
        </div>
        <div style={{ width: "100%", maxWidth: 720 }}>
          <DescriptionField
            editing={editing}
            value={getDraft("description")}
            onChange={(v) => setDraft("description", v)}
          />
        </div>
      </div>

      <div
        style={{
          display: "flex",
          flexDirection: "row",
          alignItems: "center",
          gap: "var(--space-10)",
        }}
      >
        {voice.status === "failed" && !editing && (
          <PrimaryButton
            label="retry extraction"
            icon="refresh"
            pending={actionPending === "extract"}
            onClick={onExtract}
          />
        )}
        {voice.status === "uploaded" && voice.sourcePath && !editing && (
          <PrimaryButton
            label="extract embedding"
            icon="zap"
            pending={actionPending === "extract"}
            onClick={onExtract}
          />
        )}
      </div>
    </div>
  );
}

function SlugChip({
  voiceId,
  slug,
  onSaved,
}: {
  voiceId: string;
  slug: string;
  onSaved: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(slug);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!editing) setDraft(slug);
  }, [slug, editing]);

  const commit = useCallback(async () => {
    const trimmed = draft.trim().toLowerCase();
    if (!trimmed || trimmed === slug) {
      setDraft(slug);
      setEditing(false);
      return;
    }
    setPending(true);
    setError(null);
    try {
      await patchVoice(voiceId, { slug: trimmed });
      setEditing(false);
      onSaved();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setPending(false);
    }
  }, [draft, slug, voiceId, onSaved]);

  if (editing) {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-4)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "var(--space-6)" }}>
          <span style={{ fontFamily: FONT_MONO, color: "var(--text-quaternary)" }}>/</span>
          <input
            autoFocus
            type="text"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                void commit();
              }
              if (e.key === "Escape") {
                setDraft(slug);
                setEditing(false);
              }
            }}
            disabled={pending}
            style={{
              padding: "5px 10px",
              border: "1px solid var(--accent-strong)",
              background: "var(--accent-wash)",
              color: "var(--text-primary)",
              fontFamily: FONT_MONO,
              fontSize: "var(--font-size-md)",
              outline: "none",
              width: 220,
            }}
          />
          <button
            type="button"
            onClick={() => void commit()}
            disabled={pending}
            style={{
              padding: "5px 10px",
              background: "var(--accent-strong)",
              color: "var(--background)",
              border: "1px solid var(--accent-strong)",
              fontFamily: FONT_HEAD,
              fontSize: "var(--font-size-sm)",
              fontWeight: 600,
              cursor: pending ? "progress" : "pointer",
              opacity: pending ? 0.6 : 1,
            }}
          >
            {pending ? "saving…" : "save"}
          </button>
          <button
            type="button"
            onClick={() => {
              setDraft(slug);
              setEditing(false);
            }}
            disabled={pending}
            style={{
              padding: "5px 8px",
              background: "transparent",
              color: "var(--text-secondary)",
              border: "1px solid var(--border)",
              borderRadius: "var(--radius-sm)",
              fontFamily: FONT_HEAD,
              fontSize: "var(--font-size-sm)",
              cursor: "pointer",
            }}
          >
            cancel
          </button>
        </div>
        {error && (
          <span style={{ fontFamily: FONT_MONO, fontSize: "var(--font-size-sm)", color: "var(--status-error)" }}>
            {error}
          </span>
        )}
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={() => setEditing(true)}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: "var(--space-6)",
        padding: "5px 10px",
        border: "1px solid transparent",
        background: "transparent",
        cursor: "text",
        transition: "background 120ms, border-color 120ms",
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.background = "color-mix(in srgb, var(--text-primary) 3%, transparent)";
        e.currentTarget.style.borderColor = "color-mix(in srgb, var(--text-primary) 8%, transparent)";
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = "transparent";
        e.currentTarget.style.borderColor = "transparent";
      }}
    >
      <span style={{ fontFamily: FONT_MONO, fontSize: "var(--font-size-md)", color: "var(--text-quaternary)" }}>
        /
      </span>
      <span style={{ fontFamily: FONT_MONO, fontSize: "var(--font-size-md)", color: "var(--text-tertiary)" }}>
        {slug}
      </span>
      <PencilGlyph />
    </button>
  );
}

/* ── Audio player primitive ──────────────────────────────────
 *
 * Custom waveform player matching the §02 design spec. Replaces the
 * browser-default <audio controls> on the voice detail page so the
 * Source Clip + Smoke Test + Preview Gallery cards stay visually
 * coherent with the rest of the page chrome (mint accents, mono
 * meta, dark card surfaces).
 *
 *  - 44×44 round play button (mint when playing, neutral when paused)
 *  - 36 bars, deterministic heights from `seed`, mint to the left of
 *    the playhead and muted to the right
 *  - Click on the waveform to seek
 *  - Time stamp + optional caption on the right, both mono
 *
 * Heights are derived from a tiny hash of `seed` so the same clip
 * always renders the same waveform without us having to decode the
 * audio. Real PCM analysis is overkill here — we just need the bars
 * to be visually distinct between clips. */
const WAVEFORM_BAR_COUNT = 36;
const WAVEFORM_HEIGHT = 44;

function seededBarHeights(seed: string): number[] {
  // Cheap, deterministic 32-bit hash → bar heights between 12 and 40
  // px. Doesn't need to be cryptographic, just spread the values.
  let h = 0x811c9dc5;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  const heights: number[] = [];
  for (let i = 0; i < WAVEFORM_BAR_COUNT; i++) {
    h ^= h << 13;
    h ^= h >>> 17;
    h ^= h << 5;
    const norm = ((h >>> 0) % 1000) / 1000;
    heights.push(12 + Math.round(norm * 28));
  }
  return heights;
}

function formatTimestamp(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function WaveformPlayer({
  src,
  seed,
  caption,
  density = "default",
}: {
  src: string;
  /** Stable string used to derive the bar heights. Usually the
   * filename or bucket path — anything that uniquely identifies the
   * clip without needing to decode it. */
  seed: string;
  /** Small mono caption rendered under the timestamp ("first 30s
   * used", "cached preview", etc.). Optional. */
  caption?: string;
  /** Player size variant.
   *  - "hero"    : 68px mint play button + 68px waveform + 18px time.
   *                Used inside the Audition card; matches the §02
   *                Console-layout design. Renders on a darker inner
   *                box so the mint button reads against it.
   *  - "default" : 44px neutral play + 44px waveform + 13px time.
   *                Source Clip strip / Smoke Test fallback.
   *  - "compact" : 36px neutral play + 36px waveform. Preview Gallery
   *                take cards. */
  density?: "default" | "compact" | "hero";
}) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const trackRef = useRef<HTMLDivElement | null>(null);
  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);

  const heights = useMemo(() => seededBarHeights(seed), [seed]);
  const progress = duration > 0 ? currentTime / duration : 0;
  const isCompact = density === "compact";
  const isHero = density === "hero";

  // Audio events. We let the <audio> element drive truth — every
  // state change here mirrors what the element reports rather than
  // pre-empting it (avoids fighting with autoplay policies + buffer
  // gaps).
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    const onPlay = () => setPlaying(true);
    const onPauseOrEnd = () => setPlaying(false);
    const onTimeUpdate = () => setCurrentTime(audio.currentTime);
    const onLoadedMetadata = () =>
      setDuration(Number.isFinite(audio.duration) ? audio.duration : 0);
    audio.addEventListener("play", onPlay);
    audio.addEventListener("pause", onPauseOrEnd);
    audio.addEventListener("ended", onPauseOrEnd);
    audio.addEventListener("timeupdate", onTimeUpdate);
    audio.addEventListener("loadedmetadata", onLoadedMetadata);
    return () => {
      audio.removeEventListener("play", onPlay);
      audio.removeEventListener("pause", onPauseOrEnd);
      audio.removeEventListener("ended", onPauseOrEnd);
      audio.removeEventListener("timeupdate", onTimeUpdate);
      audio.removeEventListener("loadedmetadata", onLoadedMetadata);
    };
  }, []);

  const togglePlay = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) return;
    if (audio.paused) audio.play().catch(() => {});
    else audio.pause();
  }, []);

  const seekFromEvent = useCallback(
    (clientX: number) => {
      const audio = audioRef.current;
      const rect = trackRef.current?.getBoundingClientRect();
      if (!audio || !rect || duration <= 0) return;
      const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
      audio.currentTime = ratio * duration;
      setCurrentTime(audio.currentTime);
    },
    [duration],
  );

  const playSize = isHero ? 68 : isCompact ? 36 : 44;
  const trackHeight = isHero ? 68 : isCompact ? 36 : WAVEFORM_HEIGHT;
  const iconSize = isHero ? 22 : isCompact ? 11 : 14;
  const heroPlayBg = "var(--accent-strong)";
  const heroPlayGlow =
    "0 0 0 4px color-mix(in srgb, var(--accent-strong) 22%, transparent), 0 8px 32px var(--accent-border)";

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: "var(--space-12)",
        padding: isHero ? 22 : isCompact ? "12px 14px" : 22,
        background: isHero ? "color-mix(in srgb, var(--background) 40%, transparent)" : "color-mix(in srgb, var(--text-primary) 3%, transparent)",
        border: `1px solid ${isHero ? "var(--ink-fill)" : "var(--border)"}`,
        borderRadius: isHero ? "var(--radius-xl)" : "var(--radius-md)",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: isHero ? 22 : 14,
        }}
      >
        <button
          type="button"
          onClick={togglePlay}
          aria-label={playing ? "Pause" : "Play"}
          style={{
            flexShrink: 0,
            width: playSize,
            height: playSize,
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            borderRadius: "var(--radius-pill)",
            border: isHero
              ? "none"
              : `1px solid ${playing ? "var(--accent-strong)" : "var(--ink-line)"}`,
            background: isHero
              ? heroPlayBg
              : playing
                ? "color-mix(in srgb, var(--accent-strong) 22%, transparent)"
                : "var(--ink-fill)",
            boxShadow: isHero ? heroPlayGlow : "none",
            cursor: "pointer",
            transition: "background 120ms, border-color 120ms, box-shadow 120ms",
            padding: 0,
          }}
        >
          {playing ? (
            <svg
              width={iconSize}
              height={iconSize}
              viewBox="0 0 24 24"
              fill={isHero ? "var(--background)" : "var(--accent-strong)"}
              aria-hidden
            >
              <rect x="6" y="4" width="4" height="16" rx="1" />
              <rect x="14" y="4" width="4" height="16" rx="1" />
            </svg>
          ) : (
            <svg
              width={iconSize}
              height={iconSize}
              viewBox="0 0 24 24"
              fill={isHero ? "var(--background)" : "color-mix(in srgb, var(--text-primary) 86%, transparent)"}
              aria-hidden
              style={{ marginLeft: isHero ? 3 : 1 }}
            >
              <polygon points="6 3 22 12 6 21 6 3" />
            </svg>
          )}
        </button>
        <div
          ref={trackRef}
          role="slider"
          aria-label="Seek"
          aria-valuemin={0}
          aria-valuemax={duration || 0}
          aria-valuenow={currentTime}
          tabIndex={0}
          onClick={(e) => seekFromEvent(e.clientX)}
          onKeyDown={(e) => {
            const audio = audioRef.current;
            if (!audio || duration <= 0) return;
            if (e.key === "ArrowRight") {
              e.preventDefault();
              audio.currentTime = Math.min(duration, audio.currentTime + 1);
            } else if (e.key === "ArrowLeft") {
              e.preventDefault();
              audio.currentTime = Math.max(0, audio.currentTime - 1);
            } else if (e.key === " " || e.key === "Enter") {
              e.preventDefault();
              togglePlay();
            }
          }}
          style={{
            flex: 1,
            minWidth: 0,
            height: trackHeight,
            display: "flex",
            alignItems: "center",
            gap: "var(--space-2)",
            cursor: duration > 0 ? "pointer" : "default",
            outline: "none",
          }}
        >
          {heights.map((h, i) => {
            const filled = i / WAVEFORM_BAR_COUNT <= progress;
            return (
              <span
                key={i}
                style={{
                  flexShrink: 0,
                  width: isHero ? 3 : 3,
                  height: Math.round(h * (trackHeight / WAVEFORM_HEIGHT)),
                  borderRadius: "var(--radius-2xs)",
                  background: filled
                    ? "var(--accent-strong)"
                    : isHero
                      ? "color-mix(in srgb, var(--text-primary) 40%, transparent)"
                      : "color-mix(in srgb, var(--text-primary) 55%, transparent)",
                  transition: "background 80ms",
                }}
              />
            );
          })}
        </div>
        <div
          style={{
            flexShrink: 0,
            display: "flex",
            flexDirection: "column",
            alignItems: "flex-end",
            gap: "var(--space-2)",
          }}
        >
          <span
            style={{
              fontFamily: FONT_MONO,
              fontSize: isHero ? 18 : isCompact ? 11 : 13,
              letterSpacing: "0.02em",
              color: "var(--text-primary)",
            }}
          >
            {formatTimestamp(currentTime)}{" "}
            <span style={{ color: "var(--text-tertiary)" }}>/</span>{" "}
            {formatTimestamp(duration)}
          </span>
          {caption && (
            <span
              style={{
                fontFamily: FONT_MONO,
                fontSize: "var(--font-size-xs)",
                letterSpacing: "0.06em",
                color: "var(--text-quaternary)",
              }}
            >
              {caption}
            </span>
          )}
        </div>
      </div>
      <audio
        ref={audioRef}
        src={src}
        preload="metadata"
        style={{ display: "none" }}
      />
    </div>
  );
}


/* ── Provider Config card (hosted providers) ──────────────────
 *
 * §01 slot for non-Pocket voices. Hosted providers (ElevenLabs /
 * OpenAI / Cartesia) carry their settings as JSON on `providerConfig`
 * instead of going through an extraction pipeline, so this card is a
 * per-provider settings form. Mutations stage onto the page-level
 * `drafts.providerConfig` blob and ship in the same PATCH as name /
 * slug / description / curation edits. */

const PROVIDER_TITLES: Record<VoiceProvider, string> = {
  pocket_tts: "Pocket TTS",
  elevenlabs: "ElevenLabs",
  openai: "OpenAI",
  cartesia: "Cartesia",
};

const ELEVENLABS_MODELS = [
  "eleven_multilingual_v2",
  "eleven_turbo_v2_5",
  "eleven_flash_v2_5",
  "eleven_monolingual_v1",
] as const;

const OPENAI_VOICES = [
  "alloy",
  "echo",
  "fable",
  "onyx",
  "nova",
  "shimmer",
] as const;

const OPENAI_VOICE_BLURBS: Record<(typeof OPENAI_VOICES)[number], string> = {
  alloy: "Alloy — balanced, neutral. The default Built-in OpenAI voice.",
  echo: "Echo — bright, conversational. Built-in OpenAI voice.",
  fable: "Fable — warm, storyteller. Built-in OpenAI voice.",
  onyx: "Onyx — deeper, narrative-leaning. Built-in OpenAI voice, no extraction step.",
  nova: "Nova — younger, lifted. Built-in OpenAI voice.",
  shimmer: "Shimmer — soft, airy. Built-in OpenAI voice.",
};

function ProviderConfigCard({
  voice,
  editing,
  getDraft,
  setDraft,
}: {
  voice: VoiceDetailData;
  editing: boolean;
  getDraft: <K extends keyof EditableVoiceFields>(
    key: K,
  ) => EditableVoiceFields[K];
  setDraft: <K extends keyof EditableVoiceFields>(
    key: K,
    value: EditableVoiceFields[K],
  ) => void;
}) {
  // Source-of-truth for the form. `getDraft` returns the staged draft
  // if present, otherwise the persisted row's providerConfig. Every
  // field change builds a fresh object so React + Object.keys diffs in
  // `saveEdit` both pick up the mutation.
  const config = (getDraft("providerConfig") ??
    voice.providerConfig ??
    {}) as Record<string, unknown>;
  const updateConfig = useCallback(
    (patch: Record<string, unknown>) => {
      setDraft("providerConfig", { ...config, ...patch });
    },
    [config, setDraft],
  );

  return (
    <div style={railCardShell()}>
      <ConfigCardHeader provider={voice.provider} editing={editing} />
      {voice.provider === "elevenlabs" && (
        <ElevenLabsConfigBody
          config={config}
          editing={editing}
          update={updateConfig}
        />
      )}
      {voice.provider === "openai" && (
        <OpenAIConfigBody
          config={config}
          editing={editing}
          update={updateConfig}
        />
      )}
      {voice.provider === "cartesia" && (
        <CartesiaConfigBody
          config={config}
          editing={editing}
          update={updateConfig}
        />
      )}
      <ConfigInfoBanner />
    </div>
  );
}

/* ── Card chrome ──────────────────────────────────────────────── */

function ConfigCardHeader({
  provider,
  editing,
}: {
  provider: VoiceProvider;
  editing: boolean;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-6)" }}>
      <SectionLabel>PROVIDER CONFIG</SectionLabel>
      <div style={{ display: "flex", alignItems: "center", gap: "var(--space-12)" }}>
        <SectionTitle>{PROVIDER_TITLES[provider]} settings</SectionTitle>
        <ProviderTag>{PROVIDER_LABELS[provider]}</ProviderTag>
        {editing && <EditingPill />}
      </div>
    </div>
  );
}

function ProviderTag({ children }: { children: React.ReactNode }) {
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        padding: "2px 9px",
        borderRadius: "var(--radius-pill)",
        border: "1px solid color-mix(in srgb, var(--text-primary) 14%, transparent)",
        fontFamily: FONT_MONO,
        fontSize: "var(--font-size-2xs)",
        letterSpacing: "0.20em",
        textTransform: "uppercase",
        color: "var(--text-secondary)",
      }}
    >
      {children}
    </span>
  );
}

function EditingPill() {
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: "var(--space-5)",
        padding: "3px 9px",
        borderRadius: "var(--radius-pill)",
        border: "1px solid var(--accent-glow)",
        background: "color-mix(in srgb, var(--accent-strong) 12%, transparent)",
        fontFamily: FONT_MONO,
        fontSize: "var(--font-size-2xs)",
        fontWeight: 600,
        letterSpacing: "0.20em",
        textTransform: "uppercase",
        color: "var(--accent-strong)",
      }}
    >
      <span
        aria-hidden
        style={{
          display: "inline-block",
          width: 5,
          height: 5,
          borderRadius: "var(--radius-pill)",
          background: "var(--accent-strong)",
        }}
      />
      editing
    </span>
  );
}

function ConfigInfoBanner() {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "flex-start",
        gap: "var(--space-10)",
        padding: "12px 14px",
        background: "color-mix(in srgb, var(--accent-strong) 4%, transparent)",
        border: "1px solid color-mix(in srgb, var(--accent-strong) 18%, transparent)",
        borderRadius: "var(--radius-md)",
        fontFamily: FONT_HEAD,
        fontSize: "var(--font-size-base)",
        lineHeight: "18px",
        color: "var(--text-secondary)",
      }}
    >
      <svg
        width="14"
        height="14"
        viewBox="0 0 24 24"
        fill="none"
        stroke="var(--accent-strong)"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        style={{ flexShrink: 0, marginTop: "var(--space-2)" }}
      >
        <circle cx="12" cy="12" r="10" />
        <line x1="12" y1="16" x2="12" y2="12" />
        <line x1="12" y1="8" x2="12.01" y2="8" />
      </svg>
      <span>
        Hosted voices skip the extraction pipeline. Settings apply on the next
        synthesis call.
      </span>
    </div>
  );
}

/* ── Per-provider bodies ──────────────────────────────────────── */

function ElevenLabsConfigBody({
  config,
  editing,
  update,
}: {
  config: Record<string, unknown>;
  editing: boolean;
  update: (patch: Record<string, unknown>) => void;
}) {
  const voiceId = stringFrom(config.voiceId);
  const modelId = stringFrom(config.modelId) || "eleven_multilingual_v2";
  const stability = numberFrom(config.stability, 0.5);
  const similarityBoost = numberFrom(config.similarityBoost, 0.75);
  const style = numberFrom(config.style, 0);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 22 }}>
      <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-14)" }}>
        <ConfigTextField
          label="voice id"
          value={voiceId}
          editing={editing}
          onChange={(v) => update({ voiceId: v })}
          placeholder="21m00Tcm4TlvDq8ikWAM"
          mono
        />
        <ConfigDropdown
          label="model"
          value={modelId}
          editing={editing}
          options={ELEVENLABS_MODELS.map((m) => ({ label: m, value: m }))}
          onChange={(v) => update({ modelId: v })}
        />
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-14)" }}>
        <ConfigSlider
          label="stability"
          value={stability}
          editing={editing}
          onChange={(v) => update({ stability: v })}
          minLabel="0 · variable"
          maxLabel="1 · monotone"
        />
        <ConfigSlider
          label="similarity boost"
          value={similarityBoost}
          editing={editing}
          onChange={(v) => update({ similarityBoost: v })}
        />
        <ConfigSlider
          label="style"
          value={style}
          editing={editing}
          onChange={(v) => update({ style: v })}
        />
      </div>
    </div>
  );
}

function OpenAIConfigBody({
  config,
  editing,
  update,
}: {
  config: Record<string, unknown>;
  editing: boolean;
  update: (patch: Record<string, unknown>) => void;
}) {
  const current = stringFrom(config.voice) || "alloy";
  const safe = (OPENAI_VOICES as readonly string[]).includes(current)
    ? (current as (typeof OPENAI_VOICES)[number])
    : "alloy";
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-10)" }}>
      <ConfigFieldLabel>voice</ConfigFieldLabel>
      <SegmentedControl
        options={OPENAI_VOICES.map((v) => ({ label: v, value: v }))}
        value={safe}
        editing={editing}
        onChange={(v) => update({ voice: v })}
      />
      <div
        style={{
          fontFamily: FONT_HEAD,
          fontSize: "var(--font-size-base)",
          lineHeight: "18px",
          color: "var(--text-secondary)",
        }}
      >
        {OPENAI_VOICE_BLURBS[safe]}
      </div>
    </div>
  );
}

function CartesiaConfigBody({
  config,
  editing,
  update,
}: {
  config: Record<string, unknown>;
  editing: boolean;
  update: (patch: Record<string, unknown>) => void;
}) {
  const voiceId = stringFrom(config.voiceId);
  const modelId = stringFrom(config.modelId);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-18)" }}>
      <ConfigTextField
        label="voice id"
        value={voiceId}
        editing={editing}
        onChange={(v) => update({ voiceId: v })}
        placeholder="a0e99841-438c-4a64-b679-ae501e7d6091"
        mono
      />
      <ConfigTextField
        label="model"
        value={modelId}
        editing={editing}
        onChange={(v) => update({ modelId: v })}
        placeholder="sonic-english"
        mono
        trailingHint="optional"
      />
    </div>
  );
}

/* ── Form primitives ──────────────────────────────────────────── */

function stringFrom(v: unknown): string {
  return typeof v === "string" ? v : "";
}

function numberFrom(v: unknown, fallback: number): number {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string") {
    const parsed = Number(v);
    if (Number.isFinite(parsed)) return parsed;
  }
  return fallback;
}

function ConfigFieldLabel({
  children,
  trailingHint,
}: {
  children: React.ReactNode;
  trailingHint?: string;
}) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "baseline",
        justifyContent: "space-between",
        gap: "var(--space-12)",
      }}
    >
      <span
        style={{
          fontFamily: FONT_MONO,
          fontSize: "var(--font-size-xs)",
          letterSpacing: "0.16em",
          textTransform: "uppercase",
          color: "var(--text-secondary)",
        }}
      >
        {children}
      </span>
      {trailingHint && (
        <span
          style={{
            fontFamily: FONT_MONO,
            fontSize: "var(--font-size-xs)",
            letterSpacing: "0.1em",
            textTransform: "uppercase",
            color: "var(--text-quaternary)",
          }}
        >
          {trailingHint}
        </span>
      )}
    </div>
  );
}

/* Read-only chrome for inputs in non-editing mode + mint focus ring
 * for inputs in editing mode. Matches the §02 ElevenLabs Editing
 * variant exactly. */
function ConfigTextField({
  label,
  value,
  editing,
  onChange,
  placeholder,
  mono,
  flexGrow,
  trailingHint,
}: {
  label: string;
  value: string;
  editing: boolean;
  onChange: (v: string) => void;
  placeholder?: string;
  mono?: boolean;
  flexGrow?: number;
  trailingHint?: string;
}) {
  const [focused, setFocused] = useState(false);
  const family = mono ? FONT_MONO : FONT_HEAD;
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: "var(--space-8)",
        flexGrow,
        flexBasis: 0,
        minWidth: 0,
      }}
    >
      <ConfigFieldLabel trailingHint={trailingHint}>{label}</ConfigFieldLabel>
      {editing ? (
        <input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          placeholder={placeholder}
          spellCheck={false}
          style={{
            padding: "10px 14px",
            background: "color-mix(in srgb, var(--accent-strong) 4%, transparent)",
            border: `1px solid ${focused ? "var(--accent-strong)" : "var(--accent-glow)"}`,
            borderRadius: "var(--radius-md)",
            outline: "none",
            boxShadow: focused
              ? "var(--ring-shadow)"
              : "none",
            color: "var(--text-primary)",
            fontFamily: family,
            fontSize: "var(--font-size-md)",
            lineHeight: "16px",
            transition: "border-color 120ms, box-shadow 120ms",
          }}
        />
      ) : (
        <div
          style={{
            padding: "10px 14px",
            background: "var(--ink-wash)",
            border: "1px solid color-mix(in srgb, var(--text-primary) 8%, transparent)",
            borderRadius: "var(--radius-md)",
            color: value
              ? "var(--text-primary)"
              : "var(--text-quaternary)",
            fontFamily: family,
            fontSize: "var(--font-size-md)",
            lineHeight: "16px",
            minHeight: 16,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {value || placeholder || "—"}
        </div>
      )}
    </div>
  );
}

function ConfigDropdown({
  label,
  value,
  editing,
  options,
  onChange,
  flexGrow,
}: {
  label: string;
  value: string;
  editing: boolean;
  options: { label: string; value: string }[];
  onChange: (v: string) => void;
  flexGrow?: number;
}) {
  const [focused, setFocused] = useState(false);
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: "var(--space-8)",
        flexGrow,
        flexBasis: 0,
        minWidth: 0,
      }}
    >
      <ConfigFieldLabel>{label}</ConfigFieldLabel>
      {editing ? (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: "var(--space-10)",
            padding: "10px 14px",
            background:
              "color-mix(in srgb, var(--accent-strong) 4%, transparent)",
            border: `1px solid ${
              focused
                ? "var(--accent-strong)"
                : "var(--accent-glow)"
            }`,
            borderRadius: "var(--radius-md)",
            boxShadow: focused
              ? "var(--ring-shadow)"
              : "none",
            transition: "border-color 120ms, box-shadow 120ms",
            position: "relative",
            minWidth: 0,
          }}
        >
          <span
            style={{
              flex: 1,
              minWidth: 0,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
              fontFamily: FONT_MONO,
              fontSize: "var(--font-size-md)",
              lineHeight: "16px",
              color: "var(--text-primary)",
            }}
          >
            {value}
          </span>
          <ChevronDown />
          <select
            value={value}
            onChange={(e) => onChange(e.target.value)}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
            style={{
              position: "absolute",
              inset: 0,
              opacity: 0,
              cursor: "pointer",
            }}
          >
            {options.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>
      ) : (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: "var(--space-10)",
            padding: "10px 14px",
            background: "var(--ink-wash)",
            border: "1px solid var(--border-subtle)",
            borderRadius: "var(--radius-md)",
            fontFamily: FONT_MONO,
            fontSize: "var(--font-size-md)",
            lineHeight: "16px",
            color: "var(--text-primary)",
            minWidth: 0,
          }}
        >
          <span
            style={{
              flex: 1,
              minWidth: 0,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {value}
          </span>
          <ChevronDown muted />
        </div>
      )}
    </div>
  );
}

function ChevronDown({ muted }: { muted?: boolean }) {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 12 12"
      fill="none"
      style={{ flexShrink: 0 }}
      aria-hidden
    >
      <path
        d="M3 4.5L6 7.5L9 4.5"
        stroke={muted ? "var(--text-quaternary)" : "var(--accent-strong)"}
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/* Mint slider primitive per §05 of the design.
 *  - REST     : 14px thumb, mint border, plain right-aligned value text
 *  - ACTIVE   : 18px thumb, mint halo, value rendered as a mint pill,
 *               plus the optional min/max hint row beneath the track
 *  - DISABLED : 55% opacity, neutral grey fill, no mint at all
 * Active is keyed off pointerdown/focus/hover, so only the slider the
 * user is currently interacting with shows the heavier treatment. */
function ConfigSlider({
  label,
  value,
  editing,
  onChange,
  minLabel,
  maxLabel,
}: {
  label: string;
  value: number;
  editing: boolean;
  onChange: (v: number) => void;
  minLabel?: string;
  maxLabel?: string;
}) {
  const trackRef = useRef<HTMLDivElement | null>(null);
  const [dragging, setDragging] = useState(false);
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const active = editing && (dragging || hovered || focused);
  const clamped = Math.max(0, Math.min(1, value));
  const fillPct = `${(clamped * 100).toFixed(2)}%`;

  const setFromPointer = useCallback(
    (clientX: number) => {
      const rect = trackRef.current?.getBoundingClientRect();
      if (!rect) return;
      const next = (clientX - rect.left) / rect.width;
      onChange(Math.max(0, Math.min(1, Number(next.toFixed(3)))));
    },
    [onChange],
  );

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!editing) return;
    setDragging(true);
    e.currentTarget.setPointerCapture(e.pointerId);
    setFromPointer(e.clientX);
  };
  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!editing || !dragging) return;
    setFromPointer(e.clientX);
  };
  const onPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    setDragging(false);
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      /* capture may already be gone — ignore */
    }
  };
  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (!editing) return;
    const step = e.shiftKey ? 0.1 : 0.01;
    if (e.key === "ArrowRight" || e.key === "ArrowUp") {
      e.preventDefault();
      onChange(Number(Math.min(1, clamped + step).toFixed(3)));
    } else if (e.key === "ArrowLeft" || e.key === "ArrowDown") {
      e.preventDefault();
      onChange(Number(Math.max(0, clamped - step).toFixed(3)));
    } else if (e.key === "Home") {
      e.preventDefault();
      onChange(0);
    } else if (e.key === "End") {
      e.preventDefault();
      onChange(1);
    }
  };

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: "var(--space-8)",
        opacity: editing ? 1 : 0.55,
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
        }}
      >
        <span
          style={{
            fontFamily: FONT_MONO,
            fontSize: "var(--font-size-xs)",
            letterSpacing: "0.16em",
            textTransform: "uppercase",
            color: editing
              ? "var(--text-secondary)"
              : "var(--text-tertiary)",
          }}
        >
          {label}
        </span>
        {active ? (
          <span
            style={{
              display: "inline-flex",
              alignItems: "center",
              padding: "2px 8px",
              borderRadius: "var(--radius-pill)",
              background: "var(--accent-fill)",
              border: "1px solid var(--accent-border)",
              fontFamily: FONT_MONO,
              fontSize: "var(--font-size-sm)",
              fontWeight: 600,
              lineHeight: "14px",
              color: "var(--accent-strong)",
            }}
          >
            {clamped.toFixed(2)}
          </span>
        ) : (
          <span
            style={{
              fontFamily: FONT_MONO,
              fontSize: "var(--font-size-base)",
              color: "var(--text-primary)",
            }}
          >
            {clamped.toFixed(2)}
          </span>
        )}
      </div>
      <div
        ref={trackRef}
        role="slider"
        tabIndex={editing ? 0 : -1}
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={1}
        aria-valuenow={clamped}
        aria-disabled={!editing}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        onKeyDown={onKeyDown}
        style={{
          position: "relative",
          height: 4,
          background: editing ? "color-mix(in srgb, var(--text-primary) 8%, transparent)" : "var(--ink-fill)",
          borderRadius: "var(--radius-2xs)",
          cursor: editing ? "pointer" : "default",
          outline: "none",
          touchAction: "none",
        }}
      >
        <div
          style={{
            position: "absolute",
            inset: 0,
            width: fillPct,
            height: 4,
            borderRadius: "var(--radius-2xs)",
            background: editing ? "var(--accent-strong)" : "color-mix(in srgb, var(--text-primary) 30%, transparent)",
            boxShadow: active
              ? "0 0 8px var(--accent-glow)"
              : "none",
            transition: "box-shadow 120ms",
            pointerEvents: "none",
          }}
        />
        <div
          aria-hidden
          style={{
            position: "absolute",
            top: active ? -7 : -5,
            left: `calc(${fillPct} - ${active ? 9 : 7}px)`,
            width: active ? 18 : 14,
            height: active ? 18 : 14,
            borderRadius: "var(--radius-pill)",
            background: active ? "var(--accent-strong)" : "var(--background)",
            border: active
              ? "3px solid var(--background)"
              : `2px solid ${editing ? "var(--accent-strong)" : "color-mix(in srgb, var(--text-primary) 30%, transparent)"}`,
            boxShadow: active
              ? "0 0 0 var(--ring-width) var(--ring-color)"
              : "none",
            transition:
              "width 120ms, height 120ms, top 120ms, left 120ms, box-shadow 120ms",
            pointerEvents: "none",
          }}
        />
      </div>
      {active && (minLabel || maxLabel) && (
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            fontFamily: FONT_MONO,
            fontSize: "var(--font-size-2xs)",
            letterSpacing: "0.1em",
            color: "var(--text-quaternary)",
          }}
        >
          <span>{minLabel ?? ""}</span>
          <span>{maxLabel ?? ""}</span>
        </div>
      )}
    </div>
  );
}

/* 6-option pill row used by OpenAI's voice picker. Inactive segments
 * share thin dividers; the active segment paints over them with a
 * 1px mint border bleeding 1px outside the container in editing mode,
 * so the highlight reads as a separate chip rather than just a tint. */
function SegmentedControl({
  options,
  value,
  editing,
  onChange,
}: {
  options: { label: string; value: string }[];
  value: string;
  editing: boolean;
  onChange: (v: string) => void;
}) {
  return (
    <div
      role="radiogroup"
      style={{
        display: "flex",
        borderRadius: "var(--radius-md)",
        border: "1px solid var(--ink-line)",
        overflow: "hidden",
        position: "relative",
      }}
    >
      {options.map((opt, idx) => {
        const selected = opt.value === value;
        const isLast = idx === options.length - 1;
        const styles: CSSProperties = selected
          ? editing
            ? {
                margin: "-1px",
                background: "color-mix(in srgb, var(--accent-strong) 16%, transparent)",
                border: "1px solid var(--accent-strong)",
                borderRadius: "var(--radius-md)",
                color: "var(--accent-strong)",
                position: "relative",
                zIndex: 1,
              }
            : {
                background: "var(--accent-fill)",
                borderRight: isLast
                  ? "none"
                  : "1px solid var(--ink-line)",
                color: "var(--accent-strong)",
              }
          : {
              borderRight: isLast
                ? "none"
                : "1px solid var(--ink-line)",
              background: "transparent",
              color: "var(--text-secondary)",
            };
        return (
          <button
            key={opt.value}
            type="button"
            role="radio"
            aria-checked={selected}
            disabled={!editing}
            onClick={() => editing && onChange(opt.value)}
            style={{
              flex: 1,
              padding: "10px 0",
              fontFamily: FONT_MONO,
              fontSize: "var(--font-size-sm)",
              fontWeight: selected ? 500 : 400,
              letterSpacing: "0.12em",
              textTransform: "uppercase",
              textAlign: "center",
              cursor: editing ? "pointer" : "default",
              outline: "none",
              ...styles,
            }}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}

/* ── Source Clip card ─────────────────────────────────────────── */

/** Secondary hero strip for Pocket voices in `ready` state. Sits
 * directly under the Audition card and shows the original recording
 * with a compact inline header — filename, duration, Download — and
 * the default-density WaveformPlayer. The voice-level metadata that
 * used to live in a MetaTable here (sample rate, bucket path, uploaded
 * date) moves to the Engine block in the inspector rail. */
function SourceClipStrip({
  voice,
  sourceUrl,
}: {
  voice: VoiceDetailData;
  sourceUrl: string | null;
}) {
  if (!sourceUrl) return <DropZonePlaceholder />;
  const tooShort = voice.status === "failed" && (voice.durationS ?? 0) < 10;
  const filenameTail = (voice.sourcePath ?? "").split("/").pop();
  const durationLabel =
    voice.durationS != null ? `${voice.durationS.toFixed(1)}s` : null;
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: "var(--space-18)",
        padding: "var(--space-24)",
        background: "var(--ink-wash)",
        border: "1px solid color-mix(in srgb, var(--text-primary) 8%, transparent)",
        borderRadius: "var(--radius-3xl)",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: "var(--space-12)",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "var(--space-14)",
            minWidth: 0,
            flex: 1,
          }}
        >
          <span
            style={{
              fontFamily: FONT_MONO,
              fontSize: "var(--font-size-xs)",
              fontWeight: 600,
              letterSpacing: "0.20em",
              textTransform: "uppercase",
              color: "var(--text-secondary)",
            }}
          >
            source clip
          </span>
          <span
            aria-hidden
            style={{
              width: 28,
              height: 1,
              background: "var(--ink-line)",
            }}
          />
          <div
            style={{
              display: "flex",
              alignItems: "baseline",
              gap: "var(--space-10)",
              minWidth: 0,
            }}
          >
            <span
              style={{
                fontFamily: FONT_HEAD,
                fontSize: "var(--font-size-lg)",
                fontWeight: 600,
                color: "var(--text-primary)",
                whiteSpace: "nowrap",
              }}
            >
              Original recording
            </span>
            <span
              style={{
                fontFamily: FONT_MONO,
                fontSize: "var(--font-size-sm)",
                color: "var(--text-quaternary)",
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
                minWidth: 0,
              }}
            >
              {filenameTail ?? voice.sourcePath ?? "—"}
              {durationLabel ? ` · ${durationLabel}` : ""}
            </span>
            {tooShort && (
              <span
                style={{
                  fontFamily: FONT_MONO,
                  fontSize: "var(--font-size-sm)",
                  color: "var(--status-error)",
                  letterSpacing: "0.04em",
                  whiteSpace: "nowrap",
                }}
              >
                ⚠ too short
              </span>
            )}
          </div>
        </div>
        <DownloadButton href={sourceUrl} />
      </div>
      <WaveformPlayer
        src={sourceUrl}
        seed={voice.sourcePath ?? voice.id}
        caption={
          voice.durationS != null && voice.durationS > 30
            ? "first 30s used"
            : undefined
        }
      />
    </div>
  );
}

function DropZonePlaceholder() {
  return (
    <Link
      href="/voices"
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: "var(--space-16)",
        padding: "56px 32px",
        background: "color-mix(in srgb, var(--accent-strong) 3%, transparent)",
        border: "1.5px dashed var(--accent-border)",
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
          background: "color-mix(in srgb, var(--accent-strong) 8%, transparent)",
          border: "1px solid color-mix(in srgb, var(--accent-strong) 18%, transparent)",
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
      <div style={{ fontFamily: FONT_MONO, fontSize: "var(--font-size-sm)", color: "var(--text-quaternary)", letterSpacing: "0.06em" }}>
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
  onRegenerate,
  regenerating,
  regenerateError,
  attemptCount,
}: {
  voice: VoiceDetailData;
  previewUrl: string | null;
  embeddingUrl: string | null;
  pending: boolean;
  /** Used only on `uploaded` voices to kick off the Pocket extraction
   * pipeline (the "extract embedding" CTA) AND on `failed` voices for
   * the Retry CTA — both ultimately POST /extract. */
  onExtract: () => void;
  /** Used on `ready` voices to refresh the audition preview. Provider-
   * aware: hits /extract for Pocket, /preview for hosted. */
  onRegenerate: () => void;
  regenerating: boolean;
  regenerateError: string | null;
  /** Total attempts logged for this voice — used by the Failed panel
   * to label "attempt #N" inline with the error timestamp. */
  attemptCount: number;
}) {
  void embeddingUrl;
  if (voice.status === "ready") {
    return (
      <AuditionCard
        voice={voice}
        previewUrl={previewUrl}
        onRegenerate={onRegenerate}
        regenerating={regenerating}
        regenerateError={regenerateError}
      />
    );
  }
  if (voice.status === "processing") {
    return <ProcessingPanel voice={voice} />;
  }
  if (voice.status === "failed") {
    return (
      <FailedPanel
        voice={voice}
        attemptCount={attemptCount}
        retryPending={pending}
        onRetry={onExtract}
      />
    );
  }
  return (
    <ReadyToExtractPanel voice={voice} pending={pending} onExtract={onExtract} />
  );
}

/** Hero audition card for voices in `ready` state — replaces the old
 * "Smoke Test" card. The Audition surface IS the page hero: the prompt
 * is rendered as headline copy (26px Space Grotesk), the transport is
 * the §02 Console design with a 68px mint play button, and there's no
 * meta table — that all lives in the inspector rail.
 *
 * "Regenerate" still ships, but on hosted providers it's disabled with
 * a tooltip explaining the gap (no provider-side preview re-synthesis
 * endpoint yet — Pocket re-runs /extract). */
function AuditionCard({
  voice,
  previewUrl,
  onRegenerate,
  regenerating,
  regenerateError,
}: {
  voice: VoiceDetailData;
  previewUrl: string | null;
  onRegenerate: () => void;
  regenerating: boolean;
  regenerateError: string | null;
}) {
  // Pocket regenerates via /extract; ElevenLabs via /preview. OpenAI +
  // Cartesia don't have hosted preview synthesis wired up yet.
  const regenerateSupported =
    voice.provider === "pocket_tts" || voice.provider === "elevenlabs";
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: "var(--space-24)",
        padding: "var(--space-32)",
        background:
          "linear-gradient(135deg, color-mix(in srgb, var(--accent-strong) 5%, transparent) 0%, var(--ink-wash) 60%, var(--ink-wash) 100%)",
        border: "1px solid color-mix(in srgb, var(--accent-strong) 18%, transparent)",
        borderRadius: "var(--radius-3xl)",
      }}
    >
      <AuditionHeader
        onRegenerate={onRegenerate}
        regenerating={regenerating}
        regenerateSupported={regenerateSupported}
        hasPreview={previewUrl != null}
      />
      <PromptHeadline text={DEFAULT_AUDITION_PROMPT} />
      {previewUrl ? (
        <WaveformPlayer
          src={previewUrl}
          seed={voice.previewPath ?? `${voice.id}-preview`}
          density="hero"
          caption="cached preview"
        />
      ) : (
        <div
          style={{
            padding: "24px 22px",
            background: "color-mix(in srgb, var(--background) 40%, transparent)",
            border: "1px solid var(--ink-fill)",
            borderRadius: "var(--radius-xl)",
            fontFamily: FONT_HEAD,
            fontSize: "var(--font-size-md)",
            color: "var(--text-secondary)",
          }}
        >
          Preview not generated yet — the voice can still be bound to
          characters.
        </div>
      )}
      {regenerateError && (
        <div
          style={{
            padding: "10px 12px",
            background: "var(--critical-wash)",
            border: "1px solid var(--critical-border)",
            borderRadius: "var(--radius-md)",
            fontFamily: FONT_MONO,
            fontSize: "var(--font-size-base)",
            color: "var(--status-error)",
          }}
        >
          {regenerateError}
        </div>
      )}
    </div>
  );
}

function AuditionHeader({
  onRegenerate,
  regenerating,
  regenerateSupported,
  hasPreview,
}: {
  onRegenerate: () => void;
  regenerating: boolean;
  regenerateSupported: boolean;
  /** Whether a preview clip exists. Drives the button label
   * (Generate vs. Regenerate) and the eyebrow caption. */
  hasPreview: boolean;
}) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: "var(--space-12)",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: "var(--space-14)" }}>
        <span
          style={{
            fontFamily: FONT_MONO,
            fontSize: "var(--font-size-xs)",
            fontWeight: 600,
            letterSpacing: "0.20em",
            textTransform: "uppercase",
            color: "var(--accent-strong)",
          }}
        >
          audition
        </span>
        <span
          aria-hidden
          style={{
            width: 28,
            height: 1,
            background: "var(--accent-border)",
          }}
        />
        <span
          style={{
            fontFamily: FONT_MONO,
            fontSize: "var(--font-size-xs)",
            letterSpacing: "0.18em",
            textTransform: "uppercase",
            color: "var(--text-quaternary)",
          }}
        >
          {hasPreview ? "cached preview" : "no preview yet"}
        </span>
      </div>
      <RegenerateButton
        onClick={onRegenerate}
        pending={regenerating}
        disabled={!regenerateSupported}
        hasPreview={hasPreview}
        disabledHint="Preview generation for OpenAI + Cartesia is not wired up yet — ElevenLabs and Pocket are supported."
      />
    </div>
  );
}

function PromptHeadline({ text }: { text: string }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-10)" }}>
      <span
        style={{
          fontFamily: FONT_MONO,
          fontSize: "var(--font-size-xs)",
          letterSpacing: "0.18em",
          textTransform: "uppercase",
          color: "var(--text-quaternary)",
        }}
      >
        prompt
      </span>
      <span
        style={{
          fontFamily: "'Space Grotesk', system-ui, sans-serif",
          fontSize: 26,
          fontWeight: 400,
          lineHeight: "36px",
          letterSpacing: "-0.01em",
          color: "var(--text-primary)",
        }}
      >
        “{text}”
      </span>
    </div>
  );
}

function stringFromConfig(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const trimmed = v.trim();
  return trimmed ? trimmed : null;
}

function DownloadButton({ href }: { href: string }) {
  const [hovered, setHovered] = useState(false);
  return (
    <a
      href={href}
      download
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onFocus={() => setHovered(true)}
      onBlur={() => setHovered(false)}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 7,
        padding: "7px 12px",
        background: hovered
          ? "var(--accent-fill)"
          : "transparent",
        border: `1px solid ${hovered ? "var(--accent-strong)" : "var(--accent-border)"}`,
        borderRadius: "var(--radius-md)",
        color: "var(--accent-strong)",
        fontFamily: FONT_HEAD,
        fontSize: "var(--font-size-base)",
        fontWeight: 500,
        cursor: "pointer",
        textDecoration: "none",
        transition: "background 120ms, border-color 120ms",
      }}
    >
      <svg
        width="12"
        height="12"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden
      >
        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
        <polyline points="7 10 12 15 17 10" />
        <line x1="12" y1="15" x2="12" y2="3" />
      </svg>
      Download
    </a>
  );
}

function RegenerateButton({
  onClick,
  pending,
  disabled,
  disabledHint,
  hasPreview,
}: {
  onClick: () => void;
  pending: boolean;
  disabled: boolean;
  disabledHint?: string;
  /** Switches the visible verb. First-time generation reads as
   * "Generate" / "generating…"; refreshing an existing clip reads as
   * "Regenerate" / "regenerating…". */
  hasPreview: boolean;
}) {
  const [hovered, setHovered] = useState(false);
  const inert = disabled || pending;
  const bg = inert
    ? "color-mix(in srgb, var(--text-primary) 3%, transparent)"
    : hovered
      ? "var(--accent-fill)"
      : "transparent";
  const borderColor = inert
    ? "var(--border)"
    : hovered
      ? "var(--accent-strong)"
      : "var(--accent-border)";
  const color = inert
    ? "var(--text-quaternary)"
    : "var(--accent-strong)";
  const idleLabel = hasPreview ? "Regenerate" : "Generate";
  const pendingLabel = hasPreview ? "regenerating…" : "generating…";
  return (
    <button
      type="button"
      onClick={() => !inert && onClick()}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      disabled={inert}
      title={disabled && disabledHint ? disabledHint : undefined}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 7,
        padding: "7px 12px",
        background: bg,
        border: `1px solid ${borderColor}`,
        borderRadius: "var(--radius-md)",
        color,
        fontFamily: FONT_HEAD,
        fontSize: "var(--font-size-base)",
        fontWeight: 500,
        cursor: inert ? "not-allowed" : "pointer",
        transition: "background 120ms, border-color 120ms",
      }}
    >
      <RegenerateIcon spinning={pending} muted={inert} />
      {pending ? pendingLabel : idleLabel}
    </button>
  );
}

function RegenerateIcon({
  spinning,
  muted,
}: {
  spinning: boolean;
  muted: boolean;
}) {
  return (
    <>
      {spinning && (
        <style>{`@keyframes voice-regen-spin{from{transform:rotate(0)}to{transform:rotate(360deg)}}`}</style>
      )}
      <svg
        width="12"
        height="12"
        viewBox="0 0 24 24"
        fill="none"
        stroke={muted ? "var(--text-quaternary)" : "var(--accent-strong)"}
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        style={{
          animation: spinning ? "voice-regen-spin 800ms linear infinite" : "none",
        }}
        aria-hidden
      >
        <polyline points="23 4 23 10 17 10" />
        <polyline points="1 20 1 14 7 14" />
        <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10" />
        <path d="M20.49 15a9 9 0 0 1-14.85 3.36L1 14" />
      </svg>
    </>
  );
}

/** Hero for Pocket voices in `uploaded` state — the source clip is in
 * the bucket but extraction hasn't run. Mirrors the AuditionCard chrome
 * (mint tint, "AUDITION" eyebrow + caption header) so it slots into the
 * same hero position cleanly, with a single CTA in the middle of the
 * card driving the user to kick off pocket-tts. */
function ReadyToExtractPanel({
  voice,
  pending,
  onExtract,
}: {
  voice: VoiceDetailData;
  pending: boolean;
  onExtract: () => void;
}) {
  void voice;
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: "var(--space-24)",
        padding: "var(--space-32)",
        background:
          "linear-gradient(135deg, rgba(140,231,210,0.05) 0%, rgba(255,255,255,0.02) 60%, rgba(255,255,255,0.02) 100%)",
        border: "1px solid rgba(140,231,210,0.18)",
        borderRadius: "var(--radius-3xl)",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "var(--space-14)",
        }}
      >
        <span
          style={{
            fontFamily: FONT_MONO,
            fontSize: "var(--font-size-xs)",
            fontWeight: 600,
            letterSpacing: "0.20em",
            textTransform: "uppercase",
            color: "var(--accent-strong)",
          }}
        >
          audition
        </span>
        <span
          aria-hidden
          style={{
            width: 28,
            height: 1,
            background:
              "var(--accent-border)",
          }}
        />
        <span
          style={{
            fontFamily: FONT_MONO,
            fontSize: "var(--font-size-xs)",
            letterSpacing: "0.18em",
            textTransform: "uppercase",
            color: "var(--text-quaternary)",
          }}
        >
          no preview yet
        </span>
      </div>
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: "var(--space-20)",
          padding: "36px 24px",
        }}
      >
        <div
          aria-hidden
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            width: 72,
            height: 72,
            borderRadius: "var(--radius-pill)",
            background:
              "color-mix(in srgb, var(--accent-strong) 10%, transparent)",
            border:
              "1px solid var(--accent-border)",
          }}
        >
          <svg
            width="28"
            height="28"
            viewBox="0 0 24 24"
            fill="none"
            stroke="var(--accent-strong)"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
          </svg>
        </div>
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: "var(--space-8)",
            textAlign: "center",
          }}
        >
          <span
            style={{
              fontFamily: "'Space Grotesk', system-ui, sans-serif",
              fontSize: "var(--font-size-3xl)",
              fontWeight: 600,
              letterSpacing: "-0.01em",
              color: "var(--text-primary)",
            }}
          >
            Ready to extract
          </span>
          <span
            style={{
              maxWidth: 460,
              fontFamily: FONT_HEAD,
              fontSize: "var(--font-size-lg)",
              lineHeight: "22px",
              color: "var(--text-secondary)",
            }}
          >
            The source clip is uploaded. Run pocket-tts to compute the voice
            embedding — takes about 15 seconds and only uses the first 30s
            of audio.
          </span>
        </div>
        <ExtractCta pending={pending} onExtract={onExtract} />
      </div>
    </div>
  );
}

/** Mint-filled CTA with a glow ring — the same play-button treatment as
 * the AuditionCard's hero, repurposed for the "Extract embedding" action.
 * Disabled state collapses the glow + dims the fill. */
function ExtractCta({
  pending,
  onExtract,
}: {
  pending: boolean;
  onExtract: () => void;
}) {
  const [hovered, setHovered] = useState(false);
  const inert = pending;
  const bg = inert
    ? "rgba(255,255,255,0.06)"
    : hovered
      ? "color-mix(in srgb, var(--accent-strong) 88%, white 12%)"
      : "var(--accent-strong)";
  return (
    <button
      type="button"
      onClick={onExtract}
      disabled={pending}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onFocus={() => setHovered(true)}
      onBlur={() => setHovered(false)}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: "var(--space-8)",
        padding: "11px 22px",
        borderRadius: "var(--radius-md)",
        background: bg,
        border: "none",
        color: inert ? "var(--text-quaternary)" : "var(--background)",
        fontFamily: FONT_HEAD,
        fontSize: "var(--font-size-md)",
        fontWeight: 600,
        cursor: pending ? "progress" : "pointer",
        boxShadow: inert
          ? "none"
          : "var(--ring-shadow-selected), 0 8px 24px color-mix(in srgb, var(--accent-strong) 18%, transparent)",
        transition: "background 120ms, box-shadow 120ms",
      }}
    >
      <svg
        width="14"
        height="14"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.4"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden
      >
        <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
      </svg>
      {pending ? "starting…" : "Extract embedding"}
    </button>
  );
}

/** Hero for Pocket voices in `processing` state. Yellow-tinted card
 * with a 4-step pipeline showing what audio-rt is doing right now;
 * elapsed timer top-right; polling-footnote at the bottom. The whole
 * card refreshes every 3s via the page-level interval in VoiceDetail. */
function ProcessingPanel({ voice }: { voice: VoiceDetailData }) {
  const elapsedSec = Math.max(
    0,
    Math.floor((Date.now() - new Date(voice.updatedAt).getTime()) / 1000),
  );

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: "var(--space-24)",
        padding: "var(--space-32)",
        background:
          "linear-gradient(135deg, rgba(250,204,21,0.06) 0%, rgba(255,255,255,0.02) 60%, rgba(255,255,255,0.02) 100%)",
        border: "1px solid rgba(250,204,21,0.20)",
        borderRadius: "var(--radius-3xl)",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "flex-start",
          justifyContent: "space-between",
          gap: "var(--space-12)",
        }}
      >
        <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-8)" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "var(--space-14)" }}>
            <span
              style={{
                fontFamily: FONT_MONO,
                fontSize: "var(--font-size-xs)",
                fontWeight: 600,
                letterSpacing: "0.20em",
                textTransform: "uppercase",
                color: "var(--status-draft)",
              }}
            >
              extraction
            </span>
            <span
              aria-hidden
              style={{
                width: 28,
                height: 1,
                background: "rgba(250,204,21,0.30)",
              }}
            />
            <span
              style={{
                fontFamily: FONT_MONO,
                fontSize: "var(--font-size-xs)",
                letterSpacing: "0.18em",
                textTransform: "uppercase",
                color: "var(--text-quaternary)",
              }}
            >
              pocket-tts · audio-rt-production
            </span>
          </div>
          <span
            style={{
              fontFamily: "'Space Grotesk', system-ui, sans-serif",
              fontSize: "var(--font-size-3xl)",
              fontWeight: 600,
              letterSpacing: "-0.01em",
              color: "var(--text-primary)",
            }}
          >
            Pocket TTS is working on it
          </span>
        </div>
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "flex-end",
            gap: "var(--space-4)",
            flexShrink: 0,
          }}
        >
          <span
            style={{
              fontFamily: FONT_MONO,
              fontSize: "var(--font-size-xs)",
              letterSpacing: "0.18em",
              textTransform: "uppercase",
              color: "var(--text-quaternary)",
            }}
          >
            elapsed
          </span>
          <span
            style={{
              fontFamily: FONT_MONO,
              fontSize: "var(--font-size-3xl)",
              letterSpacing: "0.02em",
              color: "var(--status-draft)",
            }}
          >
            {elapsedSec.toFixed(0)}s
          </span>
        </div>
      </div>
      <ProcessingStepLog />
      <div
        style={{
          display: "flex",
          alignItems: "flex-start",
          gap: "var(--space-10)",
          padding: "12px 14px",
          background: "rgba(0,0,0,0.20)",
          border: "1px solid rgba(255,255,255,0.06)",
          borderRadius: "var(--radius-md)",
        }}
      >
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="var(--status-draft)"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          style={{ flexShrink: 0, marginTop: "var(--space-2)" }}
          aria-hidden
        >
          <circle cx="12" cy="12" r="10" />
          <line x1="12" y1="16" x2="12" y2="12" />
          <line x1="12" y1="8" x2="12.01" y2="8" />
        </svg>
        <span
          style={{
            fontFamily: FONT_HEAD,
            fontSize: "var(--font-size-base)",
            lineHeight: "18px",
            color: "var(--text-secondary)",
          }}
        >
          Polling every 3s. You can close this tab — the embedding lands on
          the row when it&apos;s done.
        </span>
      </div>
    </div>
  );
}

function ProcessingStepLog() {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-8)" }}>
      <StepRow
        state="done"
        title="Upload to voice-sources"
        sub="source clip captured"
        duration="0.4s"
      />
      <StepRow
        state="done"
        title="Decode + VAD trim"
        sub="loudnorm + silence trim"
        duration="1.8s"
      />
      <StepRow
        state="active"
        title="pocket-tts export-voice"
        sub="computing kvcache state…"
        duration="…"
      />
      <StepRow
        state="pending"
        title="Upload .safetensors"
        sub="pending — voice-embeddings"
        duration="—"
      />
    </div>
  );
}

/** Hero for Pocket voices in `failed` state. Red-tinted card with the
 * actual pocket-tts error in a mono block (left-bordered red), an
 * expandable traceback when the upstream error spans multiple lines,
 * and a recovery-tips block beneath. Retry CTA top-right kicks off a
 * fresh /extract — same handler the AuditionCard's Regenerate uses. */
function FailedPanel({
  voice,
  attemptCount,
  retryPending,
  onRetry,
}: {
  voice: VoiceDetailData;
  attemptCount: number;
  retryPending: boolean;
  onRetry: () => void;
}) {
  const raw =
    voice.statusError ?? "Extraction failed without a reported error message.";
  const summary = extractExceptionSummary(raw);
  const isMultiLine = raw.includes("\n");
  const [expanded, setExpanded] = useState(false);
  const tooShort = (voice.durationS ?? 0) < 6 && voice.durationS != null;

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 22,
        padding: "var(--space-32)",
        background:
          "linear-gradient(135deg, rgba(232,160,160,0.06) 0%, rgba(255,255,255,0.02) 60%, rgba(255,255,255,0.02) 100%)",
        border: "1px solid rgba(232,160,160,0.22)",
        borderRadius: "var(--radius-3xl)",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "flex-start",
          justifyContent: "space-between",
          gap: "var(--space-12)",
        }}
      >
        <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-8)", minWidth: 0, flex: 1 }}>
          <div style={{ display: "flex", alignItems: "center", gap: "var(--space-14)", flexWrap: "wrap" }}>
            <span
              style={{
                fontFamily: FONT_MONO,
                fontSize: "var(--font-size-xs)",
                fontWeight: 600,
                letterSpacing: "0.20em",
                textTransform: "uppercase",
                color: "var(--status-error)",
              }}
            >
              extraction failed
            </span>
            <span
              aria-hidden
              style={{
                width: 28,
                height: 1,
                background: "rgba(232,160,160,0.30)",
              }}
            />
            <span
              style={{
                fontFamily: FONT_MONO,
                fontSize: "var(--font-size-xs)",
                letterSpacing: "0.18em",
                textTransform: "uppercase",
                color: "var(--text-quaternary)",
              }}
            >
              {relativeFromIso(voice.updatedAt)}
              {attemptCount > 0 ? ` · attempt #${attemptCount}` : ""}
            </span>
          </div>
          <span
            style={{
              fontFamily: "'Space Grotesk', system-ui, sans-serif",
              fontSize: "var(--font-size-3xl)",
              fontWeight: 600,
              letterSpacing: "-0.01em",
              color: "var(--text-primary)",
            }}
          >
            Pocket TTS rejected the clip
          </span>
        </div>
        <RetryExtractionButton pending={retryPending} onClick={onRetry} />
      </div>
      <div
        style={{
          display: "flex",
          alignItems: "flex-start",
          gap: "var(--space-14)",
          padding: "18px 20px",
          background: "rgba(0,0,0,0.30)",
          borderRadius: "var(--radius-lg)",
          borderLeft: "3px solid var(--status-error)",
        }}
      >
        <svg
          width="18"
          height="18"
          viewBox="0 0 24 24"
          fill="none"
          stroke="var(--status-error)"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          style={{ flexShrink: 0, marginTop: "var(--space-2)" }}
          aria-hidden
        >
          <circle cx="12" cy="12" r="10" />
          <line x1="12" y1="8" x2="12" y2="12" />
          <line x1="12" y1="16" x2="12.01" y2="16" />
        </svg>
        <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-6)", minWidth: 0, flex: 1 }}>
          <span
            style={{
              fontFamily: FONT_MONO,
              fontSize: "var(--font-size-md)",
              lineHeight: "20px",
              color: "var(--text-primary)",
              wordBreak: "break-word",
            }}
          >
            {summary}
          </span>
          {isMultiLine && (
            <button
              type="button"
              onClick={() => setExpanded((e) => !e)}
              style={{
                alignSelf: "flex-start",
                display: "inline-flex",
                alignItems: "center",
                gap: "var(--space-6)",
                padding: 0,
                background: "transparent",
                border: "none",
                color: "var(--text-tertiary)",
                fontFamily: FONT_MONO,
                fontSize: "var(--font-size-xs)",
                letterSpacing: "0.10em",
                textTransform: "uppercase",
                cursor: "pointer",
              }}
            >
              {expanded ? "hide traceback" : "show traceback"}
              <svg
                width="9"
                height="9"
                viewBox="0 0 12 12"
                fill="none"
                aria-hidden
                style={{
                  transform: expanded ? "rotate(180deg)" : "rotate(0deg)",
                  transition: "transform 120ms",
                }}
              >
                <path
                  d="M3 4.5L6 7.5L9 4.5"
                  stroke="rgba(255,255,255,0.55)"
                  strokeWidth="1.6"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </button>
          )}
        </div>
      </div>
      {expanded && (
        <pre
          style={{
            margin: 0,
            padding: "16px 20px",
            background: "rgba(0,0,0,0.40)",
            border: "1px solid rgba(232,160,160,0.18)",
            borderRadius: "var(--radius-md)",
            color: "var(--text-secondary)",
            fontFamily: FONT_MONO,
            fontSize: "var(--font-size-sm)",
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
          flexDirection: "column",
          gap: "var(--space-6)",
          padding: "14px 16px",
          background: "rgba(255,255,255,0.02)",
          border: "1px solid rgba(255,255,255,0.06)",
          borderRadius: "var(--radius-md)",
        }}
      >
        <span
          style={{
            fontFamily: FONT_MONO,
            fontSize: "var(--font-size-xs)",
            letterSpacing: "0.18em",
            textTransform: "uppercase",
            color: "var(--text-secondary)",
          }}
        >
          try this
        </span>
        <span
          style={{
            fontFamily: FONT_HEAD,
            fontSize: "var(--font-size-md)",
            lineHeight: "20px",
            color: "var(--text-secondary)",
          }}
        >
          {tooShort
            ? "Upload a longer recording (6s minimum, ideally 15–30s) — pocket-tts needs enough audio to compute a stable kvcache state. Replace the source clip via the library, then retry."
            : "Click Retry extraction above if the failure looks transient. For source-clip issues (wrong format, multiple speakers, heavy background noise), re-upload from the library and try again."}
        </span>
      </div>
    </div>
  );
}

function RetryExtractionButton({
  pending,
  onClick,
}: {
  pending: boolean;
  onClick: () => void;
}) {
  const [hovered, setHovered] = useState(false);
  const inert = pending;
  return (
    <button
      type="button"
      onClick={() => !inert && onClick()}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onFocus={() => setHovered(true)}
      onBlur={() => setHovered(false)}
      disabled={inert}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 7,
        padding: "9px 16px",
        borderRadius: "var(--radius-md)",
        background: inert
          ? "rgba(255,255,255,0.03)"
          : hovered
            ? "rgba(232,160,160,0.14)"
            : "transparent",
        border: `1px solid ${inert ? "var(--border)" : hovered ? "#E8A0A0" : "rgba(232,160,160,0.40)"}`,
        color: inert ? "var(--text-quaternary)" : "#E8A0A0",
        fontFamily: FONT_HEAD,
        fontSize: "var(--font-size-base)",
        fontWeight: 600,
        cursor: inert ? "progress" : "pointer",
        whiteSpace: "nowrap",
        flexShrink: 0,
        transition: "background 120ms, border-color 120ms",
      }}
    >
      <svg
        width="12"
        height="12"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden
      >
        <polyline points="23 4 23 10 17 10" />
        <polyline points="1 20 1 14 7 14" />
        <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10" />
        <path d="M20.49 15a9 9 0 0 1-14.85 3.36L1 14" />
      </svg>
      {pending ? "retrying…" : "Retry extraction"}
    </button>
  );
}

function extractExceptionSummary(raw: string): string {
  const lines = raw
    .split("\n")
    .map((l) => l.replace(/^[│╭╰─\s]+|[│╮╯─\s]+$/g, "").trim())
    .filter((l) => l.length > 0);
  for (let i = lines.length - 1; i >= 0; i--) {
    if (/^[\w.]+(Error|Exception|Warning):/.test(lines[i])) {
      return lines[i];
    }
  }
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
      ? { bg: "color-mix(in srgb, var(--text-primary) 3%, transparent)", border: "var(--border)", title: "var(--text-primary)", sub: "var(--text-tertiary)" }
      : state === "active"
        ? { bg: "color-mix(in srgb, var(--status-draft) 6%, transparent)", border: "color-mix(in srgb, var(--status-draft) 30%, transparent)", title: "var(--text-primary)", sub: "color-mix(in srgb, var(--status-draft) 92%, transparent)" }
        : state === "failed"
          ? { bg: "var(--critical-wash)", border: "var(--critical-border)", title: "var(--text-primary)", sub: "color-mix(in srgb, var(--status-error) 92%, transparent)" }
          : { bg: "transparent", border: "transparent", title: "var(--text-quaternary)", sub: "var(--text-quaternary)" };

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "row",
        alignItems: "center",
        gap: "var(--space-12)",
        padding: "12px 14px",
        background: styles.bg,
        border: state === "pending" ? "1px dashed var(--border)" : `1px solid ${styles.border}`,
        borderRadius: "var(--radius-md)",
      }}
    >
      <StepIcon state={state} />
      <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-2)", flex: 1, minWidth: 0 }}>
        <span style={{ fontFamily: FONT_HEAD, fontSize: "var(--font-size-base)", fontWeight: 600, color: styles.title }}>
          {title}
        </span>
        <span style={{ fontFamily: FONT_MONO, fontSize: "var(--font-size-xs)", letterSpacing: "0.06em", color: styles.sub }}>{sub}</span>
      </div>
      <span style={{ fontFamily: FONT_MONO, fontSize: "var(--font-size-sm)", color: styles.sub, letterSpacing: "0.04em", flexShrink: 0 }}>
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
      <svg width="16" height="16" viewBox="0 0 24 24" fill="var(--status-error)" stroke="none">
        <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm5 13.59L15.59 17 12 13.41 8.41 17 7 15.59 10.59 12 7 8.41 8.41 7 12 10.59 15.59 7 17 8.41 13.41 12 17 15.59z" />
      </svg>
    );
  }
  if (state === "active") {
    return (
      <>
        <style>{`@keyframes voice-detail-spin{from{transform:rotate(0)}to{transform:rotate(360deg)}}`}</style>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--status-draft)" strokeWidth="2.5" strokeLinecap="round" style={{ animation: "voice-detail-spin 1.2s linear infinite", transformOrigin: "center" }}>
          <path d="M21 12a9 9 0 1 1-9-9" />
        </svg>
      </>
    );
  }
  return (
    <div style={{ width: 16, height: 16, display: "flex", alignItems: "center", justifyContent: "center" }}>
      <div style={{ width: 14, height: 14, borderRadius: "var(--radius-pill)", border: "1.5px solid color-mix(in srgb, var(--text-primary) 20%, transparent)" }} />
    </div>
  );
}

/* ── 03 / Curation ────────────────────────────────────────────── */

/** Rail variant of the curation section. Same fields as before, but
 * laid out for a narrow column: Tags first (full width), Language +
 * Gender side-by-side, License + Attribution stacked full width.
 * Hooks into the page-level Edit/Save flow via getDraft/setDraft. */
function CurationSection({
  voice,
  editing,
  getDraft,
  setDraft,
}: {
  voice: VoiceDetailData;
  editing: boolean;
  getDraft: <K extends keyof EditableVoiceFields>(
    key: K,
  ) => EditableVoiceFields[K];
  setDraft: <K extends keyof EditableVoiceFields>(
    key: K,
    value: EditableVoiceFields[K],
  ) => void;
}) {
  void voice;
  return (
    <div style={railCardShell()}>
      <RailSectionHeader label="curation" title="Library metadata" />
      <TagsField
        editing={editing}
        tags={getDraft("tags")}
        onChange={(next) => setDraft("tags", next)}
      />
      <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-8)" }}>
        <FieldLabel hint="BCP-47">language</FieldLabel>
        <ControlledTextField
          editing={editing}
          value={getDraft("language")}
          onChange={(v) => setDraft("language", v)}
          placeholder="en-US"
        />
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-8)" }}>
        <FieldLabel hint="free-form">gender</FieldLabel>
        <GenderField
          editing={editing}
          value={getDraft("gender")}
          onChange={(v) => setDraft("gender", v)}
        />
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-8)" }}>
        <FieldLabel hint="how this clip may be used">license</FieldLabel>
        <ControlledTextField
          editing={editing}
          value={getDraft("license")}
          onChange={(v) => setDraft("license", v)}
          placeholder="internal"
        />
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-8)" }}>
        <FieldLabel hint="credit string · public-facing">attribution</FieldLabel>
        <ControlledTextField
          editing={editing}
          value={getDraft("attribution")}
          onChange={(v) => setDraft("attribution", v)}
          placeholder="Studio reading by …"
        />
      </div>
    </div>
  );
}

function ControlledTextField({
  editing,
  value,
  onChange,
  placeholder,
}: {
  editing: boolean;
  value: string | null;
  onChange: (v: string | null) => void;
  placeholder: string;
}) {
  if (editing) {
    return (
      <input
        type="text"
        value={value ?? ""}
        onChange={(e) => onChange(e.target.value === "" ? null : e.target.value)}
        placeholder={placeholder}
        style={{
          padding: "10px 14px",
          border: "1px solid var(--accent-strong)",
          borderRadius: "var(--radius-md)",
          background: "var(--accent-wash)",
          color: "var(--text-primary)",
          fontFamily: FONT_MONO,
          fontSize: "var(--font-size-md)",
          outline: "none",
        }}
      />
    );
  }
  const isEmpty = !value || value.trim() === "";
  return (
    <div
      style={{
        padding: "10px 14px",
        border: "1px solid var(--border)",
        borderRadius: "var(--radius-md)",
        background: "var(--ink-wash)",
        color: isEmpty ? "var(--text-quaternary)" : "var(--text-primary)",
        fontFamily: FONT_MONO,
        fontSize: "var(--font-size-md)",
      }}
    >
      {isEmpty ? "—" : value}
    </div>
  );
}

function FieldLabel({
  children,
  hint,
}: {
  children: React.ReactNode;
  hint?: string;
}) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: "var(--space-12)" }}>
      <span
        style={{
          fontFamily: FONT_MONO,
          fontSize: "var(--font-size-xs)",
          letterSpacing: "0.16em",
          textTransform: "uppercase",
          color: "var(--text-tertiary)",
        }}
      >
        {children}
      </span>
      <span style={{ flex: 1, height: 1, background: "var(--border-subtle)" }} />
      {hint && (
        <span
          style={{
            fontFamily: FONT_MONO,
            fontSize: "var(--font-size-xs)",
            color: "var(--text-quaternary)",
          }}
        >
          {hint}
        </span>
      )}
    </div>
  );
}

function SimpleTextField({
  voiceId,
  field,
  value,
  placeholder,
  onSaved,
}: {
  voiceId: string;
  field: string;
  value: string | null;
  placeholder: string;
  onSaved: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value ?? "");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!editing) setDraft(value ?? "");
  }, [value, editing]);

  const commit = useCallback(async () => {
    const trimmed = draft.trim();
    if (trimmed === (value ?? "").trim()) {
      setEditing(false);
      return;
    }
    setPending(true);
    setError(null);
    try {
      await patchVoice(voiceId, { [field]: trimmed === "" ? null : trimmed });
      setEditing(false);
      onSaved();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setPending(false);
    }
  }, [draft, value, voiceId, field, onSaved]);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-4)" }}>
      <div style={{ display: "flex", alignItems: "center", gap: "var(--space-8)" }}>
        <input
          type="text"
          value={editing ? draft : value ?? ""}
          placeholder={placeholder}
          onFocus={() => setEditing(true)}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={() => void commit()}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              (e.target as HTMLInputElement).blur();
            }
            if (e.key === "Escape") {
              setDraft(value ?? "");
              setEditing(false);
              (e.target as HTMLInputElement).blur();
            }
          }}
          disabled={pending}
          style={{
            flex: 1,
            padding: "10px 14px",
            border: `1px solid ${editing ? "var(--accent-strong)" : "var(--border)"}`,
            borderRadius: "var(--radius-md)",
            background: "var(--ink-wash)",
            color: "var(--text-primary)",
            fontFamily: FONT_MONO,
            fontSize: "var(--font-size-md)",
            outline: "none",
            transition: "border-color 120ms",
          }}
        />
        {pending && (
          <span style={{ fontFamily: FONT_MONO, fontSize: "var(--font-size-xs)", color: "var(--text-tertiary)" }}>
            saving…
          </span>
        )}
      </div>
      {error && (
        <span style={{ fontFamily: FONT_MONO, fontSize: "var(--font-size-sm)", color: "var(--status-error)" }}>
          {error}
        </span>
      )}
    </div>
  );
}

function GenderField({
  editing,
  value,
  onChange,
}: {
  editing: boolean;
  value: string | null;
  onChange: (v: string | null) => void;
}) {
  return (
    <div
      style={{
        display: "flex",
        border: "1px solid var(--border)",
        borderRadius: "var(--radius-md)",
        overflow: "hidden",
      }}
    >
      {GENDER_OPTIONS.map((opt, idx) => {
        const selected = value === opt;
        const disabled = !editing;
        const isLast = idx === GENDER_OPTIONS.length - 1;
        return (
          <button
            key={opt}
            type="button"
            onClick={() => {
              if (disabled) return;
              onChange(selected ? null : opt);
            }}
            disabled={disabled}
            style={{
              flex: 1,
              minWidth: 0,
              padding: "10px 6px",
              border: "none",
              borderRight: isLast ? "none" : "1px solid var(--border)",
              background: selected ? "var(--accent-fill)" : "transparent",
              color: selected ? "var(--accent-strong)" : "var(--text-tertiary)",
              fontFamily: FONT_MONO,
              fontSize: "var(--font-size-xs)",
              fontWeight: selected ? 500 : 400,
              letterSpacing: "0.10em",
              textTransform: "uppercase",
              cursor: disabled ? "default" : "pointer",
              opacity: disabled && !selected ? 0.55 : 1,
              transition: "background 120ms, color 120ms",
            }}
          >
            {opt}
          </button>
        );
      })}
    </div>
  );
}

function TagsField({
  editing,
  tags,
  onChange,
}: {
  editing: boolean;
  tags: string[];
  onChange: (next: string[]) => void;
}) {
  const [draft, setDraft] = useState("");

  const addTag = useCallback(() => {
    const clean = draft.trim().toLowerCase();
    if (!clean) return;
    setDraft("");
    if (tags.includes(clean)) return;
    onChange([...tags, clean]);
  }, [draft, tags, onChange]);

  const removeTag = useCallback(
    (tag: string) => {
      onChange(tags.filter((t) => t !== tag));
    },
    [tags, onChange],
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-10)" }}>
      <FieldLabel hint={`${tags.length} of any · text[]`}>tags</FieldLabel>
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: "var(--space-8)",
          alignItems: "center",
          padding: "10px 12px",
          border: `1px solid ${editing ? "var(--accent-strong)" : "var(--border)"}`,
          borderRadius: "var(--radius-md)",
          background: editing ? "color-mix(in srgb, var(--accent-strong) 4%, transparent)" : "var(--ink-wash)",
        }}
      >
        {tags.length === 0 && !editing && (
          <span style={{ color: "var(--text-quaternary)", fontFamily: FONT_MONO, fontSize: "var(--font-size-sm)", fontStyle: "italic" }}>
            No tags yet
          </span>
        )}
        {tags.map((tag) => (
          <span
            key={tag}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: "var(--space-6)",
              padding: "4px 9px 4px 10px",
              border: "1px solid var(--accent-border)",
              borderRadius: "var(--radius-sm)",
              background: "var(--accent-fill)",
              color: "var(--accent-strong)",
              fontFamily: FONT_MONO,
              fontSize: "var(--font-size-sm)",
              fontWeight: 600,
              letterSpacing: "0.05em",
            }}
          >
            {tag}
            {editing && (
              <button
                type="button"
                aria-label={`remove tag ${tag}`}
                onClick={() => removeTag(tag)}
                style={{
                  background: "transparent",
                  border: "none",
                  color: "var(--accent-strong)",
                  opacity: 0.6,
                  cursor: "pointer",
                  padding: 0,
                  fontSize: "var(--font-size-base)",
                  lineHeight: 1,
                }}
              >
                ×
              </button>
            )}
          </span>
        ))}
        {editing && (
        <input
          type="text"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === ",") {
              e.preventDefault();
              addTag();
            }
            if (e.key === "Backspace" && draft === "" && tags.length > 0) {
              e.preventDefault();
              removeTag(tags[tags.length - 1]);
            }
          }}
          onBlur={addTag}
          placeholder="+ add tag…"
          style={{
            flex: 1,
            minWidth: 120,
            padding: "4px 6px",
            background: "transparent",
            border: "none",
            color: "var(--text-secondary)",
            fontFamily: FONT_MONO,
            fontSize: "var(--font-size-sm)",
            outline: "none",
          }}
        />
        )}
      </div>
    </div>
  );
}

/* ── 04 / Preview Gallery ─────────────────────────────────────── */

function PreviewGallerySection({
  voiceId,
  previews,
  onChanged,
}: {
  voiceId: string;
  previews: VoicePreviewWithUrl[];
  onChanged: () => void;
}) {
  const [adding, setAdding] = useState(false);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-18)" }}>
      <div style={{ display: "flex", flexDirection: "row", alignItems: "flex-end", justifyContent: "space-between" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-4)" }}>
          <SectionLabel>PREVIEW GALLERY</SectionLabel>
          <SectionTitle>Additional takes</SectionTitle>
        </div>
        <button
          type="button"
          onClick={() => setAdding((v) => !v)}
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 7,
            padding: "8px 14px",
            background: "transparent",
            border: "1px solid var(--accent-border)",
            borderRadius: "var(--radius-md)",
            color: "var(--accent-strong)",
            fontFamily: FONT_HEAD,
            fontSize: "var(--font-size-base)",
            fontWeight: 600,
            cursor: "pointer",
          }}
        >
          {adding ? "× cancel" : "+ Add take"}
        </button>
      </div>

      {adding && (
        <AddTakeForm
          voiceId={voiceId}
          onAdded={() => {
            setAdding(false);
            onChanged();
          }}
          onCancel={() => setAdding(false)}
        />
      )}

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))",
          gap: "var(--space-16)",
        }}
      >
        {previews.map((p) => (
          <TakeCard key={p.id} preview={p} onRemoved={onChanged} />
        ))}
        {!adding && <AddTakeTile onClick={() => setAdding(true)} />}
      </div>
    </div>
  );
}

/* Final tile in the gallery grid. Mirrors the dashed/ghost slot from
 * the design — clicking it opens the inline AddTakeForm above the
 * grid. Hidden while the form is open so the user has one focal CTA. */
function AddTakeTile({ onClick }: { onClick: () => void }) {
  const [hovered, setHovered] = useState(false);
  const accent = hovered
    ? "var(--accent-strong)"
    : "color-mix(in srgb, var(--accent-strong) 36%, transparent)";
  return (
    <button
      type="button"
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onFocus={() => setHovered(true)}
      onBlur={() => setHovered(false)}
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: "var(--space-8)",
        minHeight: 156,
        padding: "var(--space-20)",
        background: hovered
          ? "color-mix(in srgb, var(--accent-strong) 5%, transparent)"
          : "transparent",
        border: `1px dashed ${accent}`,
        borderRadius: "var(--radius-xl)",
        color: hovered ? "var(--accent-strong)" : "var(--text-secondary)",
        fontFamily: FONT_HEAD,
        cursor: "pointer",
        transition: "background 120ms, border-color 120ms, color 120ms",
      }}
    >
      <svg
        width="20"
        height="20"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden
      >
        <line x1="12" y1="5" x2="12" y2="19" />
        <line x1="5" y1="12" x2="19" y2="12" />
      </svg>
      <span style={{ fontSize: "var(--font-size-md)", fontWeight: 600 }}>Add take</span>
      <span
        style={{
          fontFamily: FONT_MONO,
          fontSize: "var(--font-size-xs)",
          letterSpacing: "0.14em",
          textTransform: "uppercase",
          color: "var(--text-tertiary)",
        }}
      >
        upload or synthesize
      </span>
    </button>
  );
}

/** Synthesize a new alt-take for a voice. The user gives the take a
 * label (e.g. "calm reading") and a prompt; the server hits the
 * voice's configured provider TTS, uploads the resulting audio to
 * `takes/{voiceId}/<slug>-<ts>.<ext>`, and creates the preview row.
 *
 * The synth round-trip is the slow part — ElevenLabs ~1s, Pocket
 * ~3–5s. We show a spinning "synthesizing…" state on the button and
 * disable the form during the call. */
function AddTakeForm({
  voiceId,
  onAdded,
  onCancel,
}: {
  voiceId: string;
  onAdded: () => void;
  onCancel: () => void;
}) {
  const [label, setLabel] = useState("");
  const [prompt, setPrompt] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = useCallback(async () => {
    setPending(true);
    setError(null);
    try {
      const res = await fetch(`/api/voices/${voiceId}/previews`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ label: label.trim(), prompt: prompt.trim() }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error ?? `HTTP ${res.status}`);
      }
      onAdded();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setPending(false);
    }
  }, [label, prompt, voiceId, onAdded]);

  const disabled = pending || !label.trim() || !prompt.trim();

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: "var(--space-14)",
        padding: 22,
        background: "color-mix(in srgb, var(--accent-strong) 4%, transparent)",
        border: "1px solid color-mix(in srgb, var(--accent-strong) 18%, transparent)",
        borderRadius: "var(--radius-xl)",
      }}
    >
      <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-6)" }}>
        <span
          style={{
            fontFamily: FONT_MONO,
            fontSize: "var(--font-size-xs)",
            letterSpacing: "0.18em",
            textTransform: "uppercase",
            color: "var(--text-secondary)",
          }}
        >
          label
        </span>
        <input
          type="text"
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          placeholder="calm reading, energetic, whisper…"
          disabled={pending}
          maxLength={60}
          autoFocus
          style={{
            padding: "10px 14px",
            border: "1px solid var(--border)",
            borderRadius: "var(--radius-md)",
            background: "var(--ink-wash)",
            color: "var(--text-primary)",
            fontFamily: FONT_HEAD,
            fontSize: "var(--font-size-md)",
            outline: "none",
          }}
        />
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-6)" }}>
        <div
          style={{
            display: "flex",
            alignItems: "baseline",
            justifyContent: "space-between",
            gap: "var(--space-12)",
          }}
        >
          <span
            style={{
              fontFamily: FONT_MONO,
              fontSize: "var(--font-size-xs)",
              letterSpacing: "0.18em",
              textTransform: "uppercase",
              color: "var(--text-secondary)",
            }}
          >
            prompt
          </span>
          <span
            style={{
              fontFamily: FONT_MONO,
              fontSize: "var(--font-size-xs)",
              letterSpacing: "0.10em",
              color: "var(--text-quaternary)",
            }}
          >
            {prompt.trim().length} / 600
          </span>
        </div>
        <textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder={`What should the voice say? Default: "${DEFAULT_AUDITION_PROMPT}"`}
          disabled={pending}
          rows={3}
          maxLength={600}
          style={{
            padding: "10px 14px",
            border: "1px solid var(--border)",
            borderRadius: "var(--radius-md)",
            background: "var(--ink-wash)",
            color: "var(--text-primary)",
            fontFamily: FONT_HEAD,
            fontSize: "var(--font-size-md)",
            lineHeight: "20px",
            outline: "none",
            resize: "vertical",
            minHeight: 64,
          }}
        />
      </div>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: "var(--space-12)",
        }}
      >
        <span
          style={{
            fontFamily: FONT_MONO,
            fontSize: "var(--font-size-xs)",
            letterSpacing: "0.10em",
            color: "var(--text-quaternary)",
            lineHeight: "14px",
          }}
        >
          Synthesizes via the voice's configured provider — ElevenLabs &
          Pocket only today.
        </span>
        <div style={{ display: "flex", gap: "var(--space-8)", flexShrink: 0 }}>
          <button
            type="button"
            onClick={onCancel}
            disabled={pending}
            style={{
              padding: "8px 14px",
              background: "transparent",
              color: "var(--text-secondary)",
              border: "1px solid var(--border)",
              borderRadius: "var(--radius-md)",
              fontFamily: FONT_HEAD,
              fontSize: "var(--font-size-base)",
              cursor: "pointer",
            }}
          >
            cancel
          </button>
          <button
            type="button"
            onClick={() => void submit()}
            disabled={disabled}
            style={{
              padding: "8px 14px",
              background: "var(--accent-strong)",
              color: "var(--background)",
              border: "1px solid var(--accent-strong)",
              borderRadius: "var(--radius-md)",
              fontFamily: FONT_HEAD,
              fontSize: "var(--font-size-base)",
              fontWeight: 600,
              cursor: disabled ? "not-allowed" : "pointer",
              opacity: disabled ? 0.6 : 1,
            }}
          >
            {pending ? "synthesizing…" : "synthesize take"}
          </button>
        </div>
      </div>
      {error && (
        <div
          style={{
            padding: "8px 12px",
            background: "var(--critical-wash)",
            border: "1px solid var(--critical-border)",
            borderRadius: "var(--radius-md)",
            fontFamily: FONT_MONO,
            fontSize: "var(--font-size-sm)",
            color: "var(--status-error)",
          }}
        >
          {error}
        </div>
      )}
    </div>
  );
}

function TakeCard({
  preview,
  onRemoved,
}: {
  preview: VoicePreviewWithUrl;
  onRemoved: () => void;
}) {
  const [pending, setPending] = useState(false);
  const remove = useCallback(async () => {
    if (!confirm(`Remove take "${preview.label}"?`)) return;
    setPending(true);
    try {
      const res = await fetch(
        `/api/voices/${preview.voiceId}/previews/${preview.id}`,
        { method: "DELETE" },
      );
      if (res.ok) onRemoved();
    } finally {
      setPending(false);
    }
  }, [preview, onRemoved]);

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: "var(--space-14)",
        padding: "var(--space-18)",
        background: "var(--material-card)",
        border: "1px solid var(--border)",
        borderRadius: "var(--radius-xl)",
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "var(--space-12)" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-6)", minWidth: 0, flex: 1 }}>
          <span style={{ fontFamily: FONT_HEAD, fontSize: "var(--font-size-lg)", fontWeight: 600, color: "var(--text-primary)" }}>
            {preview.label}
          </span>
          {preview.prompt && (
            <span
              title={preview.prompt}
              style={{
                fontFamily: FONT_HEAD,
                fontSize: "var(--font-size-base)",
                lineHeight: "18px",
                color: "var(--text-secondary)",
                display: "-webkit-box",
                WebkitLineClamp: 2,
                WebkitBoxOrient: "vertical",
                overflow: "hidden",
                textOverflow: "ellipsis",
                wordBreak: "break-word",
              }}
            >
              “{preview.prompt}”
            </span>
          )}
        </div>
        <button
          type="button"
          onClick={() => void remove()}
          disabled={pending}
          aria-label="remove take"
          style={{
            flexShrink: 0,
            width: 26,
            height: 26,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            borderRadius: "var(--radius-pill)",
            background: "transparent",
            border: "1px solid var(--border)",
            color: "var(--text-tertiary)",
            cursor: pending ? "progress" : "pointer",
            opacity: pending ? 0.6 : 1,
          }}
        >
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
      </div>
      {preview.playbackUrl ? (
        <WaveformPlayer
          src={preview.playbackUrl}
          seed={preview.path}
          density="compact"
        />
      ) : (
        <div
          style={{
            padding: "var(--space-12)",
            fontFamily: FONT_MONO,
            fontSize: "var(--font-size-sm)",
            color: "var(--text-tertiary)",
            background: "var(--ink-wash)",
            border: "1px solid var(--border)",
            borderRadius: "var(--radius-md)",
          }}
        >
          unable to sign playback URL
        </div>
      )}
      <span
        style={{
          fontFamily: FONT_MONO,
          fontSize: "var(--font-size-xs)",
          letterSpacing: "0.05em",
          color: "var(--text-quaternary)",
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
      >
        {preview.path}
      </span>
    </div>
  );
}

/* ── 05 / Bindings ────────────────────────────────────────────── */

/* Bindings are owned by the character (voiceId lives on the character
 * row), so this surface is read-only. To bind/unbind, edit the character
 * via the Persona → Voice & Style panel. */
function BindingsSection({
  voice,
  bindings,
}: {
  voice: VoiceDetailData;
  bindings: VoiceDetailBindings;
}) {
  // Hosted voices are always "ready"; Pocket voices need extraction to
  // complete before they can be bound (the voice id may still be
  // unstable mid-pipeline).
  const locked = voice.status !== "ready";

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-18)" }}>
      <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-4)" }}>
        <SectionLabel>BINDINGS</SectionLabel>
        <SectionTitle>Characters using this voice</SectionTitle>
      </div>

      {locked ? (
        <div
          style={{
            display: "flex",
            flexDirection: "row",
            alignItems: "center",
            gap: "var(--space-16)",
            padding: "24px 22px",
            background: "color-mix(in srgb, var(--text-primary) 2.5%, transparent)",
            border: "1px solid var(--border)",
            borderRadius: "var(--radius-xl)",
          }}
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--text-quaternary)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="11" width="18" height="11" />
            <path d="M7 11V7a5 5 0 0 1 10 0v4" />
          </svg>
          <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-4)", flex: 1 }}>
            <span style={{ fontFamily: FONT_HEAD, fontSize: "var(--font-size-lg)", fontWeight: 500, color: "var(--text-secondary)" }}>
              Bindings unlock when extraction completes
            </span>
            <span style={{ fontFamily: FONT_HEAD, fontSize: "var(--font-size-base)", color: "var(--text-tertiary)" }}>
              The slug <code style={{ fontFamily: FONT_MONO, fontSize: "var(--font-size-sm)", color: "var(--text-secondary)" }}>{voice.slug}</code> stays reserved while you fix the source.
            </span>
          </div>
        </div>
      ) : bindings.length === 0 ? (
        <div
          style={{
            padding: "24px 22px",
            background: "color-mix(in srgb, var(--text-primary) 2.5%, transparent)",
            border: "1px solid var(--border)",
            borderRadius: "var(--radius-xl)",
            fontFamily: FONT_HEAD,
            fontSize: "var(--font-size-md)",
            color: "var(--text-secondary)",
          }}
        >
          No characters bound yet. Bind from the character via Persona → Voice & Style.
        </div>
      ) : (
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            background: "var(--material-card)",
            border: "1px solid var(--border)",
            borderRadius: "var(--radius-xl)",
            overflow: "hidden",
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
    ? `center/cover no-repeat url("${character.image}"), var(--surface-hover)`
    : resolveAvatarGradient(character.thumbnailColor, character.slug);
  return (
    <Link
      href={`/characters/${character.slug}`}
      style={{
        display: "flex",
        flexDirection: "row",
        alignItems: "center",
        gap: "var(--space-18)",
        padding: "16px 22px",
        borderBottom: isLast ? "none" : "1px solid var(--border-subtle)",
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
          color: "var(--text-primary)",
          fontFamily: FONT_HEAD,
          fontSize: "var(--font-size-2xl)",
          fontWeight: 600,
        }}
      >
        {!character.image && character.title.charAt(0).toUpperCase()}
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-4)", flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: "var(--space-10)" }}>
          <span style={{ fontFamily: FONT_HEAD, fontSize: "var(--font-size-xl)", fontWeight: 500, color: "var(--text-primary)" }}>
            {character.title}
          </span>
          <span style={{ fontFamily: FONT_MONO, fontSize: "var(--font-size-sm)", color: "var(--text-quaternary)", letterSpacing: "0.04em" }}>
            {character.slug}
          </span>
        </div>
        {character.summary && (
          <div style={{ fontFamily: FONT_HEAD, fontSize: "var(--font-size-md)", lineHeight: "18px", color: "var(--text-secondary)" }}>
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

/* ── 06 / Extraction Journal ──────────────────────────────────── */

function ExtractionJournalSection({
  attempts,
}: {
  attempts: VoiceAttemptRecord[];
}) {
  const summary = useMemo(() => {
    const failures = attempts.filter((a) => a.status === "failed").length;
    return `${attempts.length} attempt${attempts.length === 1 ? "" : "s"} · ${failures} failure${failures === 1 ? "" : "s"}`;
  }, [attempts]);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-18)" }}>
      <div style={{ display: "flex", flexDirection: "row", alignItems: "flex-end", justifyContent: "space-between" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-4)" }}>
          <SectionLabel>EXTRACTION JOURNAL</SectionLabel>
          <SectionTitle>Past extractions</SectionTitle>
        </div>
        <span
          style={{
            fontFamily: FONT_MONO,
            fontSize: "var(--font-size-sm)",
            color: "var(--text-tertiary)",
            letterSpacing: "0.12em",
          }}
        >
          {summary}
        </span>
      </div>

      {attempts.length === 0 ? (
        <div
          style={{
            padding: "24px 22px",
            background: "color-mix(in srgb, var(--text-primary) 3%, transparent)",
            border: "1px solid var(--border)",
            fontFamily: FONT_HEAD,
            fontSize: "var(--font-size-md)",
            color: "var(--text-secondary)",
          }}
        >
          No extractions logged yet. Each run records here, including failures.
        </div>
      ) : (
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            background: "var(--material-card)",
            border: "1px solid var(--border)",
            borderRadius: "var(--radius-xl)",
            overflow: "hidden",
          }}
        >
          <JournalHeadRow />
          {attempts.map((a, idx) => (
            <JournalRow
              key={a.id}
              attempt={a}
              isLast={idx === attempts.length - 1}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function JournalHeadRow() {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        padding: "14px 22px",
        borderBottom: "1px solid var(--border-subtle)",
        fontFamily: FONT_MONO,
        fontSize: "var(--font-size-xs)",
        letterSpacing: "0.16em",
        textTransform: "uppercase",
        color: "var(--text-tertiary)",
      }}
    >
      <span style={{ width: 70, flexShrink: 0 }}>attempt</span>
      <span style={{ width: 110, flexShrink: 0 }}>status</span>
      <span style={{ width: 220, flexShrink: 0 }}>started</span>
      <span style={{ width: 110, flexShrink: 0 }}>duration</span>
      <span style={{ flex: 1 }}>error</span>
    </div>
  );
}

function JournalRow({
  attempt,
  isLast,
}: {
  attempt: VoiceAttemptRecord;
  isLast: boolean;
}) {
  const color =
    attempt.status === "succeeded"
      ? "var(--accent-strong)"
      : attempt.status === "failed"
        ? "var(--status-error)"
        : "var(--status-draft)";
  const label =
    attempt.status === "succeeded"
      ? "ready"
      : attempt.status === "failed"
        ? "failed"
        : "running";
  const durationS =
    attempt.finishedAt != null
      ? (new Date(attempt.finishedAt).getTime() - new Date(attempt.startedAt).getTime()) / 1000
      : null;

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        padding: "14px 22px",
        borderBottom: isLast ? "none" : "1px solid var(--border-subtle)",
        fontFamily: FONT_MONO,
        fontSize: "var(--font-size-base)",
        color: "var(--text-secondary)",
      }}
    >
      <span style={{ width: 70, flexShrink: 0, color: "var(--text-primary)", fontWeight: 600 }}>
        #{attempt.attemptNumber}
      </span>
      <span style={{ width: 110, flexShrink: 0 }}>
        <span
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: "var(--space-6)",
            padding: "3px 9px",
            border: `1px solid color-mix(in srgb, ${color} 35%, transparent)`,
            background: `color-mix(in srgb, ${color} 10%, transparent)`,
            color,
            fontSize: "var(--font-size-xs)",
            letterSpacing: "0.10em",
            textTransform: "uppercase",
            fontWeight: 600,
          }}
        >
          <span style={{ width: 5, height: 5, borderRadius: "var(--radius-pill)", background: color }} />
          {label}
        </span>
      </span>
      <span style={{ width: 220, flexShrink: 0 }}>{formatAbsoluteIso(attempt.startedAt)}</span>
      <span style={{ width: 110, flexShrink: 0 }}>
        {durationS != null ? `${durationS.toFixed(1)}s` : "—"}
      </span>
      <span style={{ flex: 1, color: attempt.error ? "var(--status-error)" : "var(--text-quaternary)", fontSize: "var(--font-size-sm)" }}>
        {attempt.error ?? "—"}
      </span>
    </div>
  );
}

/* ── 07 / Danger Zone ─────────────────────────────────────────── */

/** Rail variant of the Danger Zone. Collapsed by default — a single
 * red strip with the warning icon, "DANGER ZONE" label, and a comma-
 * separated subtitle ("Re-extract · Archive · Delete") — so the
 * destructive actions don't dominate the rail in the common case.
 * Expanded, it reveals the full row stack with their copy + buttons. */
function DangerZone({
  voice,
  actionPending,
  onArchive,
  onUnarchive,
  onExtract,
  onDelete,
}: {
  voice: VoiceDetailData;
  actionPending: ActionKind | null;
  onArchive: () => void;
  onUnarchive: () => void;
  onExtract: () => void;
  onDelete: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  // Order matches the rail subtitle so the meta line and expanded rows
  // share the same story: re-extract is Pocket-only, archive/unarchive
  // toggles by current state, delete is always last.
  const showReExtract =
    voice.provider === "pocket_tts" && voice.sourcePath != null;
  const archiveLabel = voice.archivedAt ? "Unarchive" : "Archive";
  const summary = [
    showReExtract ? "Re-extract" : null,
    archiveLabel,
    "Delete",
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        background: "color-mix(in srgb, var(--status-error) 4%, transparent)",
        border: "1px solid color-mix(in srgb, var(--status-error) 18%, transparent)",
        borderRadius: "var(--radius-xl)",
        overflow: "hidden",
      }}
    >
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: "var(--space-10)",
          padding: "14px 22px",
          background: "transparent",
          border: "none",
          textAlign: "left",
          cursor: "pointer",
          color: "inherit",
        }}
      >
        <span style={{ display: "inline-flex", alignItems: "center", gap: "var(--space-10)" }}>
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="var(--status-error)"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden
          >
            <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
            <line x1="12" y1="9" x2="12" y2="13" />
            <line x1="12" y1="17" x2="12.01" y2="17" />
          </svg>
          <span
            style={{
              fontFamily: FONT_MONO,
              fontSize: "var(--font-size-xs)",
              fontWeight: 600,
              letterSpacing: "0.20em",
              textTransform: "uppercase",
              color: "var(--status-error)",
            }}
          >
            danger zone
          </span>
          <span
            style={{
              fontFamily: FONT_HEAD,
              fontSize: "var(--font-size-base)",
              color: "var(--text-secondary)",
            }}
          >
            {summary}
          </span>
        </span>
        <span
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: "var(--space-4)",
            padding: "4px 10px",
            border: "1px solid var(--critical-border)",
            borderRadius: "var(--radius-sm)",
            fontFamily: FONT_MONO,
            fontSize: "var(--font-size-xs)",
            letterSpacing: "0.14em",
            textTransform: "uppercase",
            color: "var(--status-error)",
          }}
        >
          {expanded ? "collapse" : "expand"}
          <svg
            width="10"
            height="10"
            viewBox="0 0 12 12"
            fill="none"
            aria-hidden
            style={{
              transform: expanded ? "rotate(180deg)" : "rotate(0deg)",
              transition: "transform 120ms",
            }}
          >
            <path
              d="M3 4.5L6 7.5L9 4.5"
              stroke="var(--status-error)"
              strokeWidth="1.6"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </span>
      </button>
      {expanded && (
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            borderTop: "1px solid color-mix(in srgb, var(--status-error) 18%, transparent)",
          }}
        >
          {showReExtract && (
            <DangerRow
              title="Re-extract embedding"
              body="Rerun pocket-tts on the source clip. Bound characters keep using the cached state until audio-rt picks up the new file."
              button={{
                label: actionPending === "extract" ? "starting…" : "re-extract",
                tone: "neutral",
                pending: actionPending === "extract",
                onClick: onExtract,
              }}
              divider
            />
          )}
          {voice.archivedAt ? (
            <DangerRow
              title="Unarchive voice"
              body="Restore visibility in the library. Bindings and storage are untouched."
              button={{
                label:
                  actionPending === "unarchive" ? "restoring…" : "unarchive",
                tone: "neutral",
                pending: actionPending === "unarchive",
                onClick: onUnarchive,
              }}
              divider
            />
          ) : (
            <DangerRow
              title="Archive voice"
              body="Soft-delete — sets archivedAt. Library hides this voice but bound characters keep playing. Unarchive any time."
              button={{
                label:
                  actionPending === "archive" ? "archiving…" : "archive",
                tone: "neutral",
                pending: actionPending === "archive",
                onClick: onArchive,
              }}
              divider
            />
          )}
          <DangerRow
            title="Delete voice"
            body={
              voice.status === "processing"
                ? "Cancels extraction, removes the source clip, and deletes the row. The slug becomes available again."
                : voice.status === "failed"
                  ? `Removes the failed clip and clears the row. The slug ${voice.slug} becomes available again.`
                  : "Removes the source clip and embedding from Supabase, deletes the row, and unbinds any characters using it."
            }
            button={{
              label: actionPending === "delete" ? "deleting…" : "delete voice",
              tone: "danger",
              pending: actionPending === "delete",
              onClick: onDelete,
            }}
          />
        </div>
      )}
    </div>
  );
}

function DangerRow({
  title,
  body,
  button,
  divider = false,
}: {
  title: string;
  body: string;
  button: {
    label: string;
    tone: "neutral" | "danger";
    pending: boolean;
    onClick: () => void;
  };
  divider?: boolean;
}) {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: "var(--space-12)",
        padding: "16px 22px",
        borderBottom: divider ? "1px solid color-mix(in srgb, var(--status-error) 12%, transparent)" : "none",
      }}
    >
      <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-4)" }}>
        <span
          style={{
            fontFamily: FONT_HEAD,
            fontSize: "var(--font-size-md)",
            fontWeight: 600,
            color: "var(--text-primary)",
          }}
        >
          {title}
        </span>
        <span
          style={{
            fontFamily: FONT_HEAD,
            fontSize: "var(--font-size-base)",
            lineHeight: "18px",
            color: "var(--text-secondary)",
          }}
        >
          {body}
        </span>
      </div>
      <div style={{ display: "flex", justifyContent: "flex-end" }}>
        <DangerRowButton
          label={button.label}
          tone={button.tone}
          pending={button.pending}
          onClick={button.onClick}
        />
      </div>
    </div>
  );
}

/** Pill-shaped button used by every row in the expanded Danger Zone.
 * Two tones — `neutral` (re-extract, archive) and `danger` (delete) —
 * both with hover treatments that match the rest of the page chrome:
 * neutral hovers toward mint, danger toward a soft-red fill. */
function DangerRowButton({
  label,
  tone,
  pending,
  onClick,
}: {
  label: string;
  tone: "neutral" | "danger";
  pending: boolean;
  onClick: () => void;
}) {
  const [hovered, setHovered] = useState(false);
  const inert = pending;
  const idleBorder =
    tone === "danger"
      ? "var(--critical-border)"
      : "var(--accent-border)";
  const hoverBorder = tone === "danger" ? "var(--status-error)" : "var(--accent-strong)";
  const idleColor = tone === "danger" ? "var(--status-error)" : "var(--accent-strong)";
  const hoverBg =
    tone === "danger"
      ? "var(--critical-fill)"
      : "var(--accent-fill)";
  return (
    <button
      type="button"
      onClick={() => !inert && onClick()}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onFocus={() => setHovered(true)}
      onBlur={() => setHovered(false)}
      disabled={inert}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: "var(--space-6)",
        padding: "7px 14px",
        borderRadius: "var(--radius-md)",
        background: inert
          ? "color-mix(in srgb, var(--text-primary) 3%, transparent)"
          : hovered
            ? hoverBg
            : "transparent",
        border: `1px solid ${inert ? "var(--border)" : hovered ? hoverBorder : idleBorder}`,
        color: inert ? "var(--text-quaternary)" : idleColor,
        fontFamily: FONT_HEAD,
        fontSize: "var(--font-size-base)",
        fontWeight: 600,
        cursor: inert ? "progress" : "pointer",
        whiteSpace: "nowrap",
        transition: "background 120ms, border-color 120ms",
      }}
    >
      {label}
    </button>
  );
}

/* ── Audit footer ─────────────────────────────────────────────── */

/** Rail variant of the audit info. Replaces the old full-width footer
 * at the bottom of the page. Three rows: created, updated, id —
 * each with a mono uppercase label on the left and the value
 * right-aligned. Author attributions render as small "/ binny" tags
 * inline with the timestamps. */
function RailAuditCard({ voice }: { voice: VoiceDetailData }) {
  const idShort =
    voice.id.length > 28 ? `${voice.id.slice(0, 26)}…` : voice.id;
  return (
    <div style={railCardShell()}>
      <div style={{ display: "flex", alignItems: "center", gap: "var(--space-12)" }}>
        <span
          style={{
            fontFamily: FONT_MONO,
            fontSize: "var(--font-size-xs)",
            fontWeight: 600,
            letterSpacing: "0.20em",
            textTransform: "uppercase",
            color: "var(--text-secondary)",
          }}
        >
          audit
        </span>
        <span
          aria-hidden
          style={{
            flex: 1,
            height: 1,
            background: "var(--ink-fill)",
          }}
        />
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-10)" }}>
        <AuditRow
          label="created"
          value={formatAbsoluteIso(voice.createdAt)}
          author={voice.createdBy}
        />
        <AuditRow
          label="updated"
          value={formatAbsoluteIso(voice.updatedAt)}
          author={voice.updatedBy}
        />
        <AuditRow label="id" value={idShort} mono />
      </div>
    </div>
  );
}

function AuditRow({
  label,
  value,
  author,
  mono,
}: {
  label: string;
  value: string;
  author?: string | null;
  mono?: boolean;
}) {
  void mono;
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: "var(--space-12)",
      }}
    >
      <span
        style={{
          fontFamily: FONT_MONO,
          fontSize: "var(--font-size-xs)",
          letterSpacing: "0.14em",
          textTransform: "uppercase",
          color: "var(--text-quaternary)",
        }}
      >
        {label}
      </span>
      <div style={{ display: "inline-flex", alignItems: "center", gap: "var(--space-8)" }}>
        <span
          style={{
            fontFamily: FONT_MONO,
            fontSize: "var(--font-size-sm)",
            color: "var(--text-primary)",
          }}
        >
          {value}
        </span>
        {author && (
          <span
            style={{
              fontFamily: FONT_MONO,
              fontSize: "var(--font-size-xs)",
              color: "var(--text-quaternary)",
            }}
          >
            / {author}
          </span>
        )}
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
        fontSize: "var(--font-size-base)",
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
  const color = tone === "danger" ? "var(--status-error)" : "var(--text-secondary)";
  const border = tone === "danger" ? "var(--critical-border)" : "var(--border)";
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
        fontSize: "var(--font-size-base)",
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
        fontSize: "var(--font-size-sm)",
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
        fontSize: "var(--font-size-xl)",
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
    background: "var(--material-card)",
    border: "1px solid var(--border)",
    borderRadius: "var(--radius-xl)",
  };
}

/* ── Inspector Rail primitives ────────────────────────────────
 *
 * The Console layout splits the page into a main canvas (audition +
 * source + takes + bindings) and a sticky right rail for everything
 * editable that isn't audio: provider config, curation, audit, danger.
 * Rail blocks share the same chrome — 22px padding, 18px gap, dark
 * neutral surface, 12px radius — so they read as a cohesive stack. */
function railCardShell(): React.CSSProperties {
  return {
    display: "flex",
    flexDirection: "column",
    gap: "var(--space-18)",
    padding: 22,
    background: "var(--ink-wash)",
    border: "1px solid color-mix(in srgb, var(--text-primary) 8%, transparent)",
    borderRadius: "var(--radius-xl)",
  };
}

function RailSectionHeader({
  label,
  title,
  trailing,
}: {
  /** Mono uppercase eyebrow (e.g. "engine", "curation"). */
  label: string;
  /** Optional inline title that reads alongside the label
   * (e.g. "Pocket TTS"). */
  title?: string;
  /** Optional right-aligned content — a provider tag, an editing pill,
   * a count. */
  trailing?: React.ReactNode;
}) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: "var(--space-12)",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: "var(--space-10)" }}>
        <span
          style={{
            fontFamily: FONT_MONO,
            fontSize: "var(--font-size-xs)",
            fontWeight: 600,
            letterSpacing: "0.20em",
            textTransform: "uppercase",
            color: "var(--accent-strong)",
          }}
        >
          {label}
        </span>
        {title && (
          <span
            style={{
              fontFamily: "'Space Grotesk', system-ui, sans-serif",
              fontSize: 15,
              fontWeight: 600,
              letterSpacing: "-0.01em",
              color: "var(--text-primary)",
            }}
          >
            {title}
          </span>
        )}
      </div>
      {trailing}
    </div>
  );
}

function RailFieldLabel({
  children,
  hint,
}: {
  children: React.ReactNode;
  hint?: string;
}) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "baseline",
        justifyContent: "space-between",
        gap: "var(--space-12)",
      }}
    >
      <span
        style={{
          fontFamily: FONT_MONO,
          fontSize: "var(--font-size-xs)",
          letterSpacing: "0.16em",
          textTransform: "uppercase",
          color: "var(--text-secondary)",
        }}
      >
        {children}
      </span>
      {hint && (
        <span
          style={{
            fontFamily: FONT_MONO,
            fontSize: "var(--font-size-xs)",
            letterSpacing: "0.10em",
            color: "var(--text-quaternary)",
          }}
        >
          {hint}
        </span>
      )}
    </div>
  );
}

function RailReadoutBox({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        padding: "8px 11px",
        background: "var(--ink-wash)",
        border: "1px solid color-mix(in srgb, var(--text-primary) 8%, transparent)",
        borderRadius: "var(--radius-md)",
        fontFamily: FONT_MONO,
        fontSize: "var(--font-size-base)",
        color: "var(--text-primary)",
        overflow: "hidden",
        textOverflow: "ellipsis",
        whiteSpace: "nowrap",
      }}
    >
      {children}
    </div>
  );
}

function RailInlineRow({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: "var(--space-12)",
      }}
    >
      <span
        style={{
          fontFamily: FONT_MONO,
          fontSize: "var(--font-size-xs)",
          letterSpacing: "0.16em",
          textTransform: "uppercase",
          color: "var(--text-secondary)",
        }}
      >
        {label}
      </span>
      <span
        style={{
          fontFamily: FONT_MONO,
          fontSize: "var(--font-size-base)",
          color: "var(--text-primary)",
        }}
      >
        {children}
      </span>
    </div>
  );
}

/* ── Rail · Engine (Pocket) ─────────────────────────────────── */

/** Replaces the old §02 SmokeTest MetaTable for Pocket voices. Pocket
 * has no per-call knobs to tune — the relevant facts are the engine
 * version, the embedding artifact, and how long the extraction took.
 * Includes a Download .safetensors button so the bound embedding is
 * one click away. */
function RailEngineCard({
  voice,
  embeddingUrl,
}: {
  voice: VoiceDetailData;
  embeddingUrl: string | null;
}) {
  const config = voice.providerConfig ?? {};
  const model = stringFromConfig(config.modelId) ?? "english_2026-01";
  const hasEmbedding = voice.embeddingPath != null;
  // Embedding readout reflects the row's actual state — we don't know
  // the .safetensors size client-side so we don't fake it. State-keyed:
  //   ready      → "extracted · .safetensors"
  //   processing → "computing…"
  //   failed     → "— · attempt failed"
  //   uploaded   → "— · not extracted yet"
  const embeddingLine = hasEmbedding
    ? "extracted · .safetensors"
    : voice.status === "processing"
      ? "computing…"
      : voice.status === "failed"
        ? "— · attempt failed"
        : "— · not extracted yet";
  const extractTime = hasEmbedding
    ? voice.durationS != null
      ? `${voice.durationS.toFixed(1)}s`
      : "—"
    : voice.status === "processing"
      ? "running…"
      : "—";
  const sampleRate =
    voice.sampleRate != null
      ? `${voice.sampleRate.toLocaleString()} Hz`
      : "—";
  const bucketPath = hasEmbedding
    ? voice.embeddingPath!
    : voice.status === "processing"
      ? "voice-embeddings/… (pending)"
      : "—";
  return (
    <div style={railCardShell()}>
      <RailSectionHeader
        label="engine"
        title="Pocket TTS"
        trailing={<RailProviderTag>POCKET</RailProviderTag>}
      />
      <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-6)" }}>
        <RailFieldLabel>model</RailFieldLabel>
        <RailReadoutBox>{model}</RailReadoutBox>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-6)" }}>
        <RailFieldLabel>embedding</RailFieldLabel>
        <RailReadoutBox>{embeddingLine}</RailReadoutBox>
      </div>
      <RailInlineRow label="extract time">{extractTime}</RailInlineRow>
      <RailInlineRow label="sample rate">
        {voice.sampleRate != null ? (
          <>
            {sampleRate}{" "}
            <span style={{ color: "var(--text-quaternary)" }}>· mono</span>
          </>
        ) : (
          "—"
        )}
      </RailInlineRow>
      <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-6)" }}>
        <RailFieldLabel>bucket path</RailFieldLabel>
        <RailReadoutBox>{bucketPath}</RailReadoutBox>
      </div>
      {hasEmbedding && embeddingUrl && (
        <a
          href={embeddingUrl}
          download
          style={{
            display: "inline-flex",
            alignSelf: "flex-start",
            alignItems: "center",
            gap: "var(--space-6)",
            padding: "6px 12px",
            background: "transparent",
            border:
              "1px solid var(--accent-border)",
            borderRadius: "var(--radius-md)",
            color: "var(--accent-strong)",
            fontFamily: FONT_HEAD,
            fontSize: "var(--font-size-base)",
            fontWeight: 500,
            textDecoration: "none",
          }}
        >
          <svg
            width="11"
            height="11"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden
          >
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
            <polyline points="7 10 12 15 17 10" />
            <line x1="12" y1="15" x2="12" y2="3" />
          </svg>
          Download .safetensors
        </a>
      )}
    </div>
  );
}

function RailProviderTag({ children }: { children: React.ReactNode }) {
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        padding: "2px 9px",
        borderRadius: "var(--radius-pill)",
        border: "1px solid color-mix(in srgb, var(--text-primary) 14%, transparent)",
        fontFamily: FONT_MONO,
        fontSize: "var(--font-size-2xs)",
        letterSpacing: "0.20em",
        textTransform: "uppercase",
        color: "var(--text-secondary)",
      }}
    >
      {children}
    </span>
  );
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

function formatAbsoluteIso(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => n.toString().padStart(2, "0");
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} · ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())} UTC`;
}
