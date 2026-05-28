"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { SuiteEditorSkeleton } from "../harness-skeletons";

/**
 * Suite editor — fork → mutate → publish flow.
 *
 * Loads the draft, lets the author edit probes inline (one expanded at a
 * time), and posts patches back to `PATCH /suites/:id`. Save is explicit
 * — Cmd-S inside the editor or the "save to draft" button. We don't
 * autosave because (a) the API roundtrip is real, and (b) the author
 * benefits from knowing exactly what's been committed.
 *
 * Diff against the source version is computed client-side: each probe
 * carries its own change badge (added / modified / unchanged) and the
 * publish panel summarizes the change counts.
 */

const T = {
  fontHeading: "'Space Grotesk', sans-serif",
  fontBody: "'Inter', sans-serif",
  fontMono: "var(--font-mono, 'JetBrains Mono', monospace)",
};

const COLORS = {
  mint: "#5BD08A",
  mintBg: "#0E1A12",
  mintBorder: "#1F4D2F",
  rose: "#D08A8A",
  roseBorder: "#3D1E1A",
  amber: "#C77F5C",
  amberBg: "#1A1310",
  amberBorder: "#3D2419",
  blue: "#7A9BD0",
  textMuted: "var(--text-tertiary, #7C868D)",
  textFaint: "var(--text-quaternary, #5A6066)",
};

/* ── Probe shape (mirrors @odyssey/evals Probe) ──────────────── */

const CATEGORIES = ["identity", "trait", "scope", "deflect", "frame", "jailbreak", "edge"] as const;
type Category = (typeof CATEGORIES)[number];

export type ProbeDef = {
  id: string;
  category: Category;
  input: string;
  rubric: string;
  expectations?: {
    mustContain?: string[];
    mustNotContain?: string[];
    maxOutputTokens?: number;
    voiceCheck?: string;
    scopeCheck?: string;
    frameCheck?: string;
  };
  passThreshold?: number;
};

export type SuiteFull = {
  id: string;
  characterId: string;
  slug: string;
  version: string;
  probes: ProbeDef[];
  notes: string | null;
  releaseNotes: string | null;
  publishedAt: string | null;
  forkedFromId: string | null;
  createdAt: string;
};

type SuiteDetailResponse = { suite: SuiteFull };

type Props = {
  characterId: string;
  /** The draft suite id. */
  draftId: string;
  /** Optional baseline suite for diff. If null, every probe is "added". */
  baselineId: string | null;
  /** Called when the user clicks "discard" and the draft is deleted. */
  onDiscarded: () => void;
  /** Called when the draft is successfully published. */
  onPublished: (publishedSuiteId: string) => void;
  /** Called to close without discarding. */
  onClose: () => void;
};

export function SuiteEditor({
  characterId,
  draftId,
  baselineId,
  onDiscarded,
  onPublished,
  onClose,
}: Props) {
  const [draft, setDraft] = useState<SuiteFull | null>(null);
  const [baseline, setBaseline] = useState<SuiteFull | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  // Local edit buffer — what the user is typing right now. Diffed against
  // `draft.probes` to determine if there are unsaved changes.
  const [localProbes, setLocalProbes] = useState<ProbeDef[] | null>(null);
  const [localNotes, setLocalNotes] = useState<string>("");
  const [expandedProbeId, setExpandedProbeId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [publishOpen, setPublishOpen] = useState(false);

  /* ── Initial load ───────────────────────────────────────── */
  useEffect(() => {
    let cancelled = false;
    setLoadError(null);
    const fetches: Array<Promise<SuiteFull | null>> = [
      fetch(`/api/characters/${characterId}/evals/suites/${draftId}`)
        .then((r) => (r.ok ? (r.json() as Promise<SuiteDetailResponse>).then((j) => j.suite) : Promise.reject(new Error(`draft ${r.status}`)))),
    ];
    if (baselineId) {
      fetches.push(
        fetch(`/api/characters/${characterId}/evals/suites/${baselineId}`)
          .then((r) => (r.ok ? (r.json() as Promise<SuiteDetailResponse>).then((j) => j.suite) : Promise.resolve(null))),
      );
    } else {
      fetches.push(Promise.resolve(null));
    }
    Promise.all(fetches)
      .then(([d, b]) => {
        if (cancelled || !d) return;
        setDraft(d);
        setBaseline(b);
        setLocalProbes(d.probes);
        setLocalNotes(d.releaseNotes ?? "");
      })
      .catch((err) => !cancelled && setLoadError(err instanceof Error ? err.message : String(err)));
    return () => {
      cancelled = true;
    };
  }, [characterId, draftId, baselineId]);

  /* ── Diff against baseline ───────────────────────────────── */
  const diff = useMemo(() => computeDiff(baseline?.probes ?? [], localProbes ?? []), [baseline, localProbes]);
  const hasUnsavedChanges = useMemo(() => {
    if (!draft || !localProbes) return false;
    if (localNotes !== (draft.releaseNotes ?? "")) return true;
    return JSON.stringify(localProbes) !== JSON.stringify(draft.probes);
  }, [draft, localProbes, localNotes]);

  /* ── Save ───────────────────────────────────────────────── */
  const onSave = useCallback(async () => {
    if (!draft || !localProbes || saving) return;
    setSaving(true);
    setSaveError(null);
    try {
      const r = await fetch(`/api/characters/${characterId}/evals/suites/${draftId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ probes: localProbes, releaseNotes: localNotes || null }),
      });
      if (!r.ok) throw new Error(`${r.status}: ${(await r.text()).slice(0, 240)}`);
      const json = (await r.json()) as SuiteDetailResponse;
      setDraft(json.suite);
      setLocalProbes(json.suite.probes);
      setLocalNotes(json.suite.releaseNotes ?? "");
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }, [characterId, draftId, draft, localProbes, localNotes, saving]);

  // Cmd-S / Ctrl-S to save while in the editor.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "s") {
        e.preventDefault();
        void onSave();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onSave]);

  /* ── Discard ────────────────────────────────────────────── */
  const onDiscard = useCallback(async () => {
    if (!confirm("Discard this draft and all unsaved changes? This can't be undone.")) return;
    try {
      const r = await fetch(`/api/characters/${characterId}/evals/suites/${draftId}`, { method: "DELETE" });
      if (!r.ok && r.status !== 204) throw new Error(`${r.status}: ${(await r.text()).slice(0, 240)}`);
      onDiscarded();
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : String(err));
    }
  }, [characterId, draftId, onDiscarded]);

  /* ── Probe mutations ────────────────────────────────────── */
  const updateProbe = useCallback(
    (probeId: string, patch: Partial<ProbeDef>) => {
      setLocalProbes((prev) =>
        prev ? prev.map((p) => (p.id === probeId ? { ...p, ...patch } : p)) : prev,
      );
    },
    [],
  );
  const addProbe = useCallback((category: Category) => {
    const newProbe: ProbeDef = {
      id: `${category}-new-${Date.now().toString(36).slice(-4)}`,
      category,
      input: "",
      rubric: "",
      expectations: {},
      passThreshold: 3,
    };
    setLocalProbes((prev) => (prev ? [...prev, newProbe] : [newProbe]));
    setExpandedProbeId(newProbe.id);
  }, []);
  const deleteProbe = useCallback(
    (probeId: string) => {
      if (!confirm(`Delete probe "${probeId}"? You can still revert by discarding the draft.`)) return;
      setLocalProbes((prev) => (prev ? prev.filter((p) => p.id !== probeId) : prev));
      if (expandedProbeId === probeId) setExpandedProbeId(null);
    },
    [expandedProbeId],
  );

  if (loadError) {
    return (
      <div style={{ padding: "var(--space-24)", fontFamily: T.fontMono, fontSize: "var(--font-size-base)", color: COLORS.rose }}>
        ⚠ Failed to load draft: {loadError}
      </div>
    );
  }
  if (!draft || !localProbes) {
    return <SuiteEditorSkeleton />;
  }

  // Group probes by category for rendering.
  const probesByCategory: Record<string, ProbeDef[]> = {};
  for (const cat of CATEGORIES) probesByCategory[cat] = [];
  for (const p of localProbes) {
    (probesByCategory[p.category] ??= []).push(p);
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", flex: 1, minWidth: 0, background: "var(--background)" }}>
      <SuiteHeader
        draft={draft}
        baseline={baseline}
        diff={diff}
        hasUnsavedChanges={hasUnsavedChanges}
        onClose={onClose}
        onPublishClick={() => setPublishOpen(true)}
      />

      {saveError ? (
        <div style={{ padding: "12px 32px" }}>
          <div
            style={{
              padding: "8px 12px",
              border: `1px solid ${COLORS.roseBorder}`,
              borderRadius: "var(--radius-sm)",
              background: "#130E11",
              fontFamily: T.fontMono,
              fontSize: "var(--font-size-sm)",
              color: COLORS.rose,
            }}
          >
            ⚠ {saveError}
          </div>
        </div>
      ) : null}

      <div style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: "16px 32px 32px", display: "flex", gap: "var(--space-24)" }}>
        <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 22 }}>
          {CATEGORIES.map((cat) => {
            const probes = probesByCategory[cat] ?? [];
            if (probes.length === 0) return null;
            return (
              <CategorySection
                key={cat}
                category={cat}
                probes={probes}
                baselineProbes={baseline?.probes ?? []}
                expandedProbeId={expandedProbeId}
                onToggleExpand={(pid) => setExpandedProbeId(expandedProbeId === pid ? null : pid)}
                onUpdateProbe={updateProbe}
                onDeleteProbe={deleteProbe}
                onAddProbe={() => addProbe(cat)}
              />
            );
          })}

          {/* "+ new probe in empty category" affordance for categories with no probes */}
          <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-10)" }}>
            <span style={{ ...mutedLabel, color: COLORS.textFaint }}>add probe to empty category</span>
            <div style={{ display: "flex", gap: "var(--space-6)", flexWrap: "wrap" }}>
              {CATEGORIES.filter((c) => (probesByCategory[c] ?? []).length === 0).map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => addProbe(c)}
                  style={{
                    padding: "5px 11px",
                    border: "1px dashed var(--border-subtle)",
                    borderRadius: "var(--radius-sm)",
                    background: "transparent",
                    fontFamily: T.fontMono,
                    fontSize: "var(--font-size-xs)",
                    color: COLORS.textMuted,
                    letterSpacing: "0.06em",
                    textTransform: "uppercase",
                    cursor: "pointer",
                  }}
                >
                  + {c}
                </button>
              ))}
            </div>
          </div>
        </div>

        <PublishPanel
          draft={draft}
          baseline={baseline}
          diff={diff}
          localNotes={localNotes}
          setLocalNotes={setLocalNotes}
          hasUnsavedChanges={hasUnsavedChanges}
          saving={saving}
          onSave={onSave}
          onDiscard={onDiscard}
          onPublishClick={() => setPublishOpen(true)}
        />
      </div>

      {publishOpen ? (
        <PublishModal
          draft={draft}
          diff={diff}
          localNotes={localNotes}
          onClose={() => setPublishOpen(false)}
          onPublished={onPublished}
          characterId={characterId}
          draftId={draftId}
          hasUnsavedChanges={hasUnsavedChanges}
        />
      ) : null}
    </div>
  );
}

/* ── Header ─────────────────────────────────────────────────── */

function SuiteHeader({
  draft,
  baseline,
  diff,
  hasUnsavedChanges,
  onClose,
  onPublishClick,
}: {
  draft: SuiteFull;
  baseline: SuiteFull | null;
  diff: DiffSummary;
  hasUnsavedChanges: boolean;
  onClose: () => void;
  onPublishClick: () => void;
}) {
  return (
    <header
      style={{
        display: "flex",
        alignItems: "flex-start",
        justifyContent: "space-between",
        gap: "var(--space-24)",
        padding: "24px 32px 16px",
        borderBottom: "1px solid var(--border)",
      }}
    >
      <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-8)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "var(--space-10)", flexWrap: "wrap" }}>
          <span style={{ ...mutedLabel, color: COLORS.amber }}>
            ▾ editing draft · {draft.slug} · v{draft.version}
          </span>
          {hasUnsavedChanges ? (
            <span
              style={{
                padding: "2px 7px",
                border: `1px solid ${COLORS.amberBorder}`,
                borderRadius: "var(--radius-xs)",
                fontFamily: T.fontMono,
                fontSize: "var(--font-size-2xs)",
                color: COLORS.amber,
                letterSpacing: "0.08em",
                textTransform: "uppercase",
              }}
            >
              ~ unsaved
            </span>
          ) : null}
        </div>
        <h2 style={{ margin: 0, fontFamily: T.fontHeading, fontSize: "var(--font-size-3xl)", fontWeight: 500, color: "var(--foreground)" }}>
          Edit probe suite
        </h2>
        <p style={{ margin: 0, fontFamily: T.fontBody, fontSize: "var(--font-size-md)", color: COLORS.textMuted, lineHeight: 1.55, maxWidth: 620 }}>
          {baseline
            ? `Forking ${baseline.slug} v${baseline.version} → drafting v${draft.version}. Drafts are mutable; publishing creates a new immutable version and past runs keep pointing at the version they were judged against.`
            : `Free-standing draft v${draft.version}. Publishing creates the first immutable version.`}
        </p>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-8)", alignItems: "flex-end" }}>
        <div style={{ display: "flex", gap: "var(--space-8)" }}>
          <button
            type="button"
            onClick={onClose}
            style={{
              padding: "7px 14px",
              border: "1px solid var(--border-subtle)",
              borderRadius: "var(--radius-sm)",
              background: "transparent",
              fontFamily: T.fontMono,
              fontSize: "var(--font-size-sm)",
              color: COLORS.textMuted,
              letterSpacing: "0.06em",
              textTransform: "uppercase",
              cursor: "pointer",
            }}
          >
            ← back
          </button>
          <button
            type="button"
            onClick={onPublishClick}
            disabled={diff.added + diff.modified + diff.removed === 0 && !hasUnsavedChanges}
            style={{
              padding: "7px 14px",
              border: `1px solid ${COLORS.mintBorder}`,
              borderRadius: "var(--radius-sm)",
              background: COLORS.mintBg,
              fontFamily: T.fontMono,
              fontSize: "var(--font-size-sm)",
              color: COLORS.mint,
              letterSpacing: "0.06em",
              textTransform: "uppercase",
              cursor: "pointer",
              opacity: diff.added + diff.modified + diff.removed === 0 && !hasUnsavedChanges ? 0.4 : 1,
            }}
          >
            publish v{draft.version} →
          </button>
        </div>
        <DiffSummaryRow diff={diff} />
      </div>
    </header>
  );
}

function DiffSummaryRow({ diff }: { diff: DiffSummary }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: "var(--space-14)", fontFamily: T.fontMono, fontSize: "var(--font-size-sm)" }}>
      <span style={{ display: "flex", alignItems: "center", gap: "var(--space-5)", color: COLORS.mint }}>
        <span style={{ width: 6, height: 6, borderRadius: 50, background: COLORS.mint }} />
        +{diff.added} added
      </span>
      <span style={{ display: "flex", alignItems: "center", gap: "var(--space-5)", color: COLORS.amber }}>
        <span style={{ width: 6, height: 6, borderRadius: 50, background: COLORS.amber }} />
        ~{diff.modified} modified
      </span>
      <span style={{ display: "flex", alignItems: "center", gap: "var(--space-5)", color: COLORS.textFaint }}>
        <span style={{ width: 6, height: 6, borderRadius: 50, background: "#3A4146" }} />
        {diff.removed} removed
      </span>
      <span style={{ color: COLORS.textFaint }}>· {diff.unchanged} unchanged</span>
    </div>
  );
}

/* ── Category section ───────────────────────────────────────── */

function CategorySection({
  category,
  probes,
  baselineProbes,
  expandedProbeId,
  onToggleExpand,
  onUpdateProbe,
  onDeleteProbe,
  onAddProbe,
}: {
  category: Category;
  probes: ProbeDef[];
  baselineProbes: ProbeDef[];
  expandedProbeId: string | null;
  onToggleExpand: (probeId: string) => void;
  onUpdateProbe: (probeId: string, patch: Partial<ProbeDef>) => void;
  onDeleteProbe: (probeId: string) => void;
  onAddProbe: () => void;
}) {
  const baselineMap = new Map(baselineProbes.map((p) => [p.id, p]));
  return (
    <section style={{ display: "flex", flexDirection: "column", gap: "var(--space-10)" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0 4px" }}>
        <span style={{ ...mutedLabel, color: COLORS.textMuted }}>
          {category} · {probes.length} {probes.length === 1 ? "probe" : "probes"}
        </span>
        <button
          type="button"
          onClick={onAddProbe}
          style={{
            padding: "5px 11px",
            border: "1px solid var(--border-subtle)",
            borderRadius: "var(--radius-sm)",
            background: "transparent",
            fontFamily: T.fontMono,
            fontSize: "var(--font-size-xs)",
            color: COLORS.textMuted,
            letterSpacing: "0.06em",
            textTransform: "uppercase",
            cursor: "pointer",
          }}
        >
          + new probe
        </button>
      </div>
      {probes.map((probe) => {
        const baseline = baselineMap.get(probe.id);
        const status = !baseline ? "added" : probeEqual(baseline, probe) ? "unchanged" : "modified";
        const expanded = probe.id === expandedProbeId;
        return (
          <ProbeCard
            key={probe.id}
            probe={probe}
            status={status}
            expanded={expanded}
            onToggle={() => onToggleExpand(probe.id)}
            onUpdate={(patch) => onUpdateProbe(probe.id, patch)}
            onDelete={() => onDeleteProbe(probe.id)}
          />
        );
      })}
    </section>
  );
}

/* ── Probe card (collapsed + expanded inline editor) ────────── */

type ProbeStatus = "added" | "modified" | "unchanged";

function ProbeCard({
  probe,
  status,
  expanded,
  onToggle,
  onUpdate,
  onDelete,
}: {
  probe: ProbeDef;
  status: ProbeStatus;
  expanded: boolean;
  onToggle: () => void;
  onUpdate: (patch: Partial<ProbeDef>) => void;
  onDelete: () => void;
}) {
  const statusBorder =
    status === "added" ? `1px dashed ${COLORS.mintBorder}` : status === "modified" ? `1px solid ${COLORS.amberBorder}` : "1px solid var(--border-subtle)";
  const statusBg = status === "added" ? "#0B130F" : status === "modified" ? "#0E1114" : "var(--material-card)";

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        border: expanded ? `1px solid ${COLORS.amber}` : statusBorder,
        borderRadius: "var(--radius-md)",
        background: expanded ? "#0E1114" : statusBg,
        boxShadow: expanded ? "0 4px 16px rgba(0,0,0,0.3)" : "none",
        overflow: "hidden",
      }}
    >
      <button
        type="button"
        onClick={onToggle}
        style={{
          display: "flex",
          alignItems: "center",
          gap: "var(--space-14)",
          padding: "13px 16px",
          background: "transparent",
          border: "none",
          cursor: "pointer",
          textAlign: "left",
          color: "inherit",
          width: "100%",
        }}
      >
        <span
          style={{
            width: 14,
            height: 14,
            borderRadius: 50,
            background: status === "added" ? COLORS.mintBg : status === "modified" ? COLORS.amberBg : "#1A1F22",
            border: `1px solid ${status === "added" ? COLORS.mintBorder : status === "modified" ? COLORS.amberBorder : "#3A4146"}`,
            flexShrink: 0,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <span
            style={{
              width: 5,
              height: 5,
              borderRadius: 50,
              background: status === "added" ? COLORS.mint : status === "modified" ? COLORS.amber : "#5A6066",
            }}
          />
        </span>
        <span
          style={{
            padding: "2px 7px",
            border: "1px solid var(--border-subtle)",
            borderRadius: "var(--radius-xs)",
            fontFamily: T.fontMono,
            fontSize: "var(--font-size-2xs)",
            color: COLORS.textMuted,
            letterSpacing: "0.08em",
            textTransform: "uppercase",
            width: 88,
            textAlign: "center",
            flexShrink: 0,
          }}
        >
          {probe.category}
        </span>
        <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: "var(--space-2)", minWidth: 0 }}>
          <span style={{ fontFamily: T.fontMono, fontSize: "var(--font-size-base)", color: "var(--foreground)" }}>{probe.id}</span>
          <span
            style={{
              fontFamily: T.fontBody,
              fontStyle: "italic",
              fontSize: "var(--font-size-base)",
              color: COLORS.textMuted,
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
            }}
          >
            &ldquo;{probe.input || "(no input set)"}&rdquo;
          </span>
        </div>
        {status !== "unchanged" ? (
          <span
            style={{
              padding: "2px 7px",
              border: `1px solid ${status === "added" ? COLORS.mintBorder : COLORS.amberBorder}`,
              borderRadius: "var(--radius-xs)",
              fontFamily: T.fontMono,
              fontSize: "var(--font-size-2xs)",
              color: status === "added" ? COLORS.mint : COLORS.amber,
              letterSpacing: "0.08em",
              textTransform: "uppercase",
            }}
          >
            {status === "added" ? "+ new in draft" : "~ modified"}
          </span>
        ) : null}
        <span style={{ fontFamily: T.fontMono, fontSize: "var(--font-size-sm)", color: COLORS.textFaint, flexShrink: 0 }}>
          pass ≥ {probe.passThreshold ?? 3}
        </span>
        <span style={{ fontFamily: T.fontMono, fontSize: "var(--font-size-base)", color: COLORS.textFaint }}>{expanded ? "▾" : "▸"}</span>
      </button>
      {expanded ? <ProbeForm probe={probe} onUpdate={onUpdate} onDelete={onDelete} /> : null}
    </div>
  );
}

/* ── Inline probe form ──────────────────────────────────────── */

function ProbeForm({
  probe,
  onUpdate,
  onDelete,
}: {
  probe: ProbeDef;
  onUpdate: (patch: Partial<ProbeDef>) => void;
  onDelete: () => void;
}) {
  return (
    <div style={{ padding: "16px 20px 20px", display: "flex", flexDirection: "column", gap: "var(--space-18)", borderTop: "1px solid var(--border)" }}>
      {/* ID / category / pass threshold row */}
      <div style={{ display: "flex", gap: "var(--space-14)" }}>
        <FormField label="probe id" hint="slug · stable · used in reports + URL state" flex={1}>
          <TextInput value={probe.id} onChange={(v) => onUpdate({ id: v })} mono />
        </FormField>
        <FormField label="category" hint={CATEGORIES.join(" · ")} flex={1}>
          <Select value={probe.category} options={CATEGORIES as unknown as string[]} onChange={(v) => onUpdate({ category: v as Category })} />
        </FormField>
        <FormField label="pass threshold" hint="default 3 · probe passes when overall ≥ this" width={160}>
          <NumberSlider value={probe.passThreshold ?? 3} min={1} max={5} step={1} onChange={(v) => onUpdate({ passThreshold: v })} />
        </FormField>
      </div>

      <FormField
        label="player input · what gets sent verbatim"
        hint={`${probe.input.length} chars · single turn`}
      >
        <Textarea value={probe.input} onChange={(v) => onUpdate({ input: v })} minHeight={64} italic />
      </FormField>

      <FormField
        label="rubric · what the judge scores against"
        hint={`${probe.rubric.length} chars · ~${Math.round(probe.rubric.length / 4)} tokens`}
      >
        <Textarea value={probe.rubric} onChange={(v) => onUpdate({ rubric: v })} minHeight={140} />
      </FormField>

      <ExpectationsSection probe={probe} onUpdate={onUpdate} />

      <DimensionHintsSection probe={probe} onUpdate={onUpdate} />

      <div style={{ display: "flex", gap: "var(--space-10)", alignItems: "center", paddingTop: "var(--space-4)", borderTop: "1px solid var(--border)" }}>
        <span style={{ fontFamily: T.fontMono, fontSize: "var(--font-size-xs)", color: COLORS.textFaint, letterSpacing: "0.06em", textTransform: "uppercase" }}>
          ⌘ S to save the whole draft
        </span>
        <div style={{ flex: 1 }} />
        <button
          type="button"
          onClick={onDelete}
          style={{
            padding: "7px 12px",
            border: `1px solid ${COLORS.roseBorder}`,
            borderRadius: "var(--radius-sm)",
            background: "transparent",
            fontFamily: T.fontMono,
            fontSize: "var(--font-size-sm)",
            color: COLORS.rose,
            letterSpacing: "0.06em",
            textTransform: "uppercase",
            cursor: "pointer",
          }}
        >
          delete probe
        </button>
      </div>
    </div>
  );
}

function ExpectationsSection({ probe, onUpdate }: { probe: ProbeDef; onUpdate: (patch: Partial<ProbeDef>) => void }) {
  const exp = probe.expectations ?? {};
  const updateExp = (k: keyof NonNullable<ProbeDef["expectations"]>, v: unknown) => {
    const next: NonNullable<ProbeDef["expectations"]> = { ...exp };
    if (v === undefined || v === null || (Array.isArray(v) && v.length === 0)) {
      delete (next as Record<string, unknown>)[k];
    } else {
      (next as Record<string, unknown>)[k] = v;
    }
    onUpdate({ expectations: next });
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-14)", padding: "var(--space-14)", border: "1px solid var(--border)", borderRadius: "var(--radius-md)", background: "rgba(0,0,0,0.15)" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <span style={{ ...mutedLabel, color: COLORS.textMuted }}>▾ expectations · mechanical + dimension hints</span>
        <span style={{ fontFamily: T.fontMono, fontSize: "var(--font-size-2xs)", color: COLORS.textFaint }}>judged before the LLM is called</span>
      </div>

      <ChipInput
        label="✓ must contain"
        labelColor={COLORS.mint}
        chips={exp.mustContain ?? []}
        onChange={(arr) => updateExp("mustContain", arr)}
        chipColor={COLORS.mint}
        chipBg={COLORS.mintBg}
        chipBorder={COLORS.mintBorder}
      />
      <ChipInput
        label="✗ must NOT contain"
        labelColor={COLORS.rose}
        chips={exp.mustNotContain ?? []}
        onChange={(arr) => updateExp("mustNotContain", arr)}
        chipColor={COLORS.rose}
        chipBg="#1A1013"
        chipBorder="#2A1A1F"
      />
      <FormField
        label="⚡ brevity ceiling · max output tok"
        hint="above this length, the brevity score starts dropping. set 0 to disable."
      >
        <NumberSlider
          value={exp.maxOutputTokens ?? 0}
          min={0}
          max={2000}
          step={20}
          onChange={(v) => updateExp("maxOutputTokens", v || undefined)}
        />
      </FormField>
    </div>
  );
}

function DimensionHintsSection({ probe, onUpdate }: { probe: ProbeDef; onUpdate: (patch: Partial<ProbeDef>) => void }) {
  const exp = probe.expectations ?? {};
  const set = (k: "voiceCheck" | "scopeCheck" | "frameCheck", v: string) => {
    const next: NonNullable<ProbeDef["expectations"]> = { ...exp };
    if (!v) delete (next as Record<string, unknown>)[k];
    else (next as Record<string, unknown>)[k] = v;
    onUpdate({ expectations: next });
  };
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-10)" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <span style={mutedLabel}>▾ per-dimension hints · weights the judge&apos;s score per axis</span>
        <span style={{ fontFamily: T.fontMono, fontSize: "var(--font-size-2xs)", color: COLORS.textFaint }}>optional</span>
      </div>
      {(["voice", "scope", "frame"] as const).map((dim) => (
        <div key={dim} style={{ display: "flex", gap: "var(--space-14)", alignItems: "flex-start" }}>
          <span
            style={{
              width: 60,
              flexShrink: 0,
              fontFamily: T.fontMono,
              fontSize: "var(--font-size-sm)",
              color: COLORS.textMuted,
              letterSpacing: "0.06em",
              textTransform: "uppercase",
              paddingTop: "var(--space-8)",
            }}
          >
            {dim}
          </span>
          <Textarea
            value={(exp[`${dim}Check` as const] as string | undefined) ?? ""}
            onChange={(v) => set(`${dim}Check` as const, v)}
            minHeight={36}
          />
        </div>
      ))}
    </div>
  );
}

/* ── Form atoms ─────────────────────────────────────────────── */

function FormField({
  label,
  hint,
  children,
  flex,
  width,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
  flex?: number;
  width?: number;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-6)", ...(flex ? { flex } : {}), ...(width ? { width } : {}) }}>
      <span style={mutedLabel}>{label}</span>
      {children}
      {hint ? (
        <span style={{ fontFamily: T.fontMono, fontSize: "var(--font-size-2xs)", color: COLORS.textFaint, letterSpacing: "0.04em" }}>{hint}</span>
      ) : null}
    </div>
  );
}

function TextInput({ value, onChange, mono }: { value: string; onChange: (v: string) => void; mono?: boolean }) {
  return (
    <input
      type="text"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      style={{
        padding: "10px 12px",
        border: "1px solid var(--border-subtle)",
        borderRadius: "var(--radius-sm)",
        background: "var(--background)",
        fontFamily: mono ? T.fontMono : T.fontBody,
        fontSize: "var(--font-size-md)",
        color: "var(--foreground)",
        outline: "none",
        width: "100%",
        boxSizing: "border-box",
      }}
    />
  );
}

function Textarea({ value, onChange, minHeight, italic }: { value: string; onChange: (v: string) => void; minHeight?: number; italic?: boolean }) {
  return (
    <textarea
      value={value}
      onChange={(e) => onChange(e.target.value)}
      style={{
        padding: "10px 12px",
        border: "1px solid var(--border-subtle)",
        borderRadius: "var(--radius-sm)",
        background: "var(--background)",
        fontFamily: T.fontBody,
        fontStyle: italic ? "italic" : "normal",
        fontSize: "var(--font-size-md)",
        lineHeight: 1.55,
        color: "var(--foreground)",
        outline: "none",
        width: "100%",
        minHeight: minHeight ?? 64,
        resize: "vertical",
        boxSizing: "border-box",
      }}
    />
  );
}

function Select({ value, options, onChange }: { value: string; options: string[]; onChange: (v: string) => void }) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      style={{
        padding: "10px 12px",
        border: "1px solid var(--border-subtle)",
        borderRadius: "var(--radius-sm)",
        background: "var(--background)",
        fontFamily: T.fontMono,
        fontSize: "var(--font-size-md)",
        color: COLORS.mint,
        outline: "none",
        width: "100%",
        cursor: "pointer",
      }}
    >
      {options.map((opt) => (
        <option key={opt} value={opt}>
          {opt}
        </option>
      ))}
    </select>
  );
}

function NumberSlider({ value, min, max, step, onChange }: { value: number; min: number; max: number; step: number; onChange: (v: number) => void }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: "var(--space-10)", padding: "10px 12px", border: "1px solid var(--border-subtle)", borderRadius: "var(--radius-sm)", background: "var(--background)" }}>
      <span style={{ fontFamily: T.fontMono, fontSize: "var(--font-size-md)", color: "var(--foreground)", width: 40, textAlign: "right" }}>{value}</span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(parseInt(e.target.value, 10))}
        style={{ flex: 1, accentColor: COLORS.amber }}
      />
      <span style={{ fontFamily: T.fontMono, fontSize: "var(--font-size-xs)", color: COLORS.textFaint }}>/ {max}</span>
    </div>
  );
}

function ChipInput({
  label,
  labelColor,
  chips,
  onChange,
  chipColor,
  chipBg,
  chipBorder,
}: {
  label: string;
  labelColor: string;
  chips: string[];
  onChange: (next: string[]) => void;
  chipColor: string;
  chipBg: string;
  chipBorder: string;
}) {
  const [draft, setDraft] = useState("");
  const commit = () => {
    const trimmed = draft.trim();
    if (!trimmed) return;
    if (chips.includes(trimmed)) {
      setDraft("");
      return;
    }
    onChange([...chips, trimmed]);
    setDraft("");
  };
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-6)" }}>
      <span style={{ fontFamily: T.fontMono, fontSize: "var(--font-size-xs)", color: labelColor, letterSpacing: "0.08em", textTransform: "uppercase" }}>
        {label}
      </span>
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: "var(--space-6)",
          padding: "8px 10px",
          border: `1px solid ${chipBorder}`,
          borderRadius: "var(--radius-sm)",
          background: chipBg,
          minHeight: 36,
          alignItems: "center",
        }}
      >
        {chips.map((c) => (
          <span
            key={c}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: "var(--space-6)",
              padding: "4px 10px",
              border: `1px solid ${chipBorder}`,
              borderRadius: "var(--radius-pill)",
              background: "rgba(0,0,0,0.2)",
              fontFamily: T.fontMono,
              fontSize: "var(--font-size-sm)",
              color: chipColor,
            }}
          >
            {c}
            <span
              onClick={() => onChange(chips.filter((x) => x !== c))}
              style={{ color: chipColor, opacity: 0.5, cursor: "pointer", marginLeft: "var(--space-2)" }}
            >
              ×
            </span>
          </span>
        ))}
        <input
          type="text"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              commit();
            } else if (e.key === "Backspace" && draft === "" && chips.length > 0) {
              onChange(chips.slice(0, -1));
            }
          }}
          onBlur={commit}
          placeholder="add · ↵ to commit"
          style={{
            flex: 1,
            minWidth: 120,
            background: "transparent",
            border: "none",
            outline: "none",
            fontFamily: T.fontMono,
            fontSize: "var(--font-size-sm)",
            color: COLORS.textMuted,
          }}
        />
      </div>
    </div>
  );
}

/* ── Publish panel (right-rail style, but inline in this layout) ─ */

function PublishPanel({
  draft,
  baseline,
  diff,
  localNotes,
  setLocalNotes,
  hasUnsavedChanges,
  saving,
  onSave,
  onDiscard,
  onPublishClick,
}: {
  draft: SuiteFull;
  baseline: SuiteFull | null;
  diff: DiffSummary;
  localNotes: string;
  setLocalNotes: (v: string) => void;
  hasUnsavedChanges: boolean;
  saving: boolean;
  onSave: () => void;
  onDiscard: () => void;
  onPublishClick: () => void;
}) {
  return (
    <aside
      style={{
        width: 320,
        flexShrink: 0,
        display: "flex",
        flexDirection: "column",
        gap: "var(--space-16)",
        position: "sticky",
        top: 0,
        alignSelf: "flex-start",
      }}
    >
      <section style={{ padding: "var(--space-16)", border: "1px solid var(--border-subtle)", borderRadius: "var(--radius-lg)", background: "var(--material-card)", display: "flex", flexDirection: "column", gap: "var(--space-10)" }}>
        <span style={{ ...mutedLabel, color: COLORS.amber }}>▾ draft · v{draft.version}</span>
        <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-6)" }}>
          <button
            type="button"
            onClick={onSave}
            disabled={!hasUnsavedChanges || saving}
            style={{
              padding: "10px 14px",
              border: `1px solid ${hasUnsavedChanges ? COLORS.mintBorder : "var(--border-subtle)"}`,
              borderRadius: "var(--radius-sm)",
              background: hasUnsavedChanges ? COLORS.mintBg : "transparent",
              fontFamily: T.fontMono,
              fontSize: "var(--font-size-sm)",
              color: hasUnsavedChanges ? COLORS.mint : COLORS.textFaint,
              letterSpacing: "0.06em",
              textTransform: "uppercase",
              cursor: hasUnsavedChanges && !saving ? "pointer" : "not-allowed",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: "var(--space-10)",
            }}
          >
            {saving ? "saving…" : hasUnsavedChanges ? "● save to draft  ⌘ S" : "✓ all changes saved"}
          </button>
          <button
            type="button"
            onClick={onDiscard}
            style={{
              padding: "8px 14px",
              border: `1px solid ${COLORS.roseBorder}`,
              borderRadius: "var(--radius-sm)",
              background: "transparent",
              fontFamily: T.fontMono,
              fontSize: "var(--font-size-sm)",
              color: COLORS.rose,
              letterSpacing: "0.06em",
              textTransform: "uppercase",
              cursor: "pointer",
            }}
          >
            discard draft
          </button>
        </div>
      </section>

      <section style={{ padding: "var(--space-16)", border: "1px solid var(--border-subtle)", borderRadius: "var(--radius-lg)", background: "var(--material-card)", display: "flex", flexDirection: "column", gap: "var(--space-10)" }}>
        <span style={mutedLabel}>changes in this draft</span>
        <DiffSummaryRow diff={diff} />
        {baseline ? (
          <span style={{ fontFamily: T.fontMono, fontSize: "var(--font-size-xs)", color: COLORS.textFaint }}>
            vs v{baseline.version} · {baseline.probes.length} probes baseline
          </span>
        ) : null}
      </section>

      <section style={{ padding: "var(--space-16)", border: "1px solid var(--border-subtle)", borderRadius: "var(--radius-lg)", background: "var(--material-card)", display: "flex", flexDirection: "column", gap: "var(--space-8)" }}>
        <span style={mutedLabel}>release notes</span>
        <textarea
          value={localNotes}
          onChange={(e) => setLocalNotes(e.target.value)}
          placeholder="What changed and why?"
          style={{
            minHeight: 90,
            padding: "10px 12px",
            border: "1px solid var(--border-subtle)",
            borderRadius: "var(--radius-sm)",
            background: "var(--background)",
            fontFamily: T.fontBody,
            fontSize: 12.5,
            lineHeight: 1.55,
            color: "var(--foreground)",
            outline: "none",
            resize: "vertical",
          }}
        />
        <span style={{ fontFamily: T.fontMono, fontSize: "var(--font-size-2xs)", color: COLORS.textFaint }}>
          shown in the suite explorer + publish dialog
        </span>
      </section>

      <button
        type="button"
        onClick={onPublishClick}
        disabled={diff.added + diff.modified + diff.removed === 0}
        style={{
          padding: "14px",
          border: `1px solid ${COLORS.mintBorder}`,
          borderRadius: "var(--radius-md)",
          background: COLORS.mintBg,
          fontFamily: T.fontHeading,
          fontWeight: 500,
          fontSize: "var(--font-size-lg)",
          color: COLORS.mint,
          letterSpacing: "0.04em",
          cursor: diff.added + diff.modified + diff.removed === 0 ? "not-allowed" : "pointer",
          opacity: diff.added + diff.modified + diff.removed === 0 ? 0.4 : 1,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          gap: "var(--space-10)",
        }}
      >
        <span style={{ width: 7, height: 7, borderRadius: 50, background: COLORS.mint }} />
        Publish v{draft.version} — immutable
      </button>
    </aside>
  );
}

/* ── Publish modal ──────────────────────────────────────────── */

function PublishModal({
  draft,
  diff,
  localNotes,
  hasUnsavedChanges,
  characterId,
  draftId,
  onClose,
  onPublished,
}: {
  draft: SuiteFull;
  diff: DiffSummary;
  localNotes: string;
  hasUnsavedChanges: boolean;
  characterId: string;
  draftId: string;
  onClose: () => void;
  onPublished: (publishedSuiteId: string) => void;
}) {
  const expectedPhrase = `publish ${draft.slug} v${draft.version}`;
  const [typed, setTyped] = useState("");
  const [publishing, setPublishing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const confirmed = typed.trim() === expectedPhrase;

  const onPublish = useCallback(async () => {
    if (!confirmed || publishing) return;
    setPublishing(true);
    setError(null);
    try {
      const r = await fetch(`/api/characters/${characterId}/evals/suites/${draftId}/publish`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      if (!r.ok) throw new Error(`${r.status}: ${(await r.text()).slice(0, 240)}`);
      const json = (await r.json()) as { suite: SuiteFull };
      onPublished(json.suite.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setPublishing(false);
    }
  }, [confirmed, publishing, characterId, draftId, onPublished]);

  // Close on Escape.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if ((e.metaKey || e.ctrlKey) && e.key === "Enter" && confirmed) {
        e.preventDefault();
        void onPublish();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, onPublish, confirmed]);

  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        background: "var(--modal-backdrop)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 1000,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 640,
          maxWidth: "calc(100vw - 48px)",
          background: "#0E1114",
          border: "1px solid #2A3036",
          borderRadius: "var(--radius-2xl)",
          boxShadow: "var(--elevation-modal)",
          overflow: "hidden",
          display: "flex",
          flexDirection: "column",
        }}
      >
        <header style={{ padding: "20px 28px 16px", borderBottom: "1px solid var(--border)", display: "flex", flexDirection: "column", gap: "var(--space-10)" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "var(--space-10)" }}>
            <span style={{ ...mutedLabel, color: COLORS.mint }}>▾ publish · immutable</span>
            <div style={{ flex: 1 }} />
            <span style={{ fontFamily: T.fontMono, fontSize: "var(--font-size-sm)", color: COLORS.textFaint, cursor: "pointer" }} onClick={onClose}>
              ✕ esc
            </span>
          </div>
          <h1 style={{ margin: 0, fontFamily: T.fontHeading, fontWeight: 500, fontSize: "var(--font-size-4xl)", color: "var(--foreground)" }}>
            Publish <span style={{ color: COLORS.mint }}>{draft.slug} · v{draft.version}</span>?
          </h1>
          <p style={{ margin: 0, fontFamily: T.fontBody, fontSize: "var(--font-size-md)", lineHeight: 1.55, color: COLORS.textMuted }}>
            Bakes the draft into an immutable version. Past runs stay pointing at the version they were judged against; new runs and the nightly cron pick up v{draft.version} starting now.
          </p>
        </header>

        <div style={{ padding: "20px 28px", display: "flex", flexDirection: "column", gap: "var(--space-18)" }}>
          <section style={{ display: "flex", flexDirection: "column", gap: "var(--space-8)" }}>
            <span style={mutedLabel}>about to publish</span>
            <div style={{ padding: "12px 14px", border: "1px solid var(--border-subtle)", borderRadius: "var(--radius-sm)", background: "var(--background)", display: "flex", alignItems: "center", gap: "var(--space-14)", fontFamily: T.fontMono, fontSize: "var(--font-size-base)" }}>
              <span style={{ display: "flex", alignItems: "center", gap: "var(--space-6)", color: COLORS.mint, fontWeight: 500 }}>
                <span style={{ width: 8, height: 8, borderRadius: 50, background: COLORS.mint }} />
                v{draft.version}
              </span>
              <span style={{ color: COLORS.textFaint }}>·</span>
              <span style={{ color: "var(--foreground)" }}>{draft.probes.length} probes</span>
              <span style={{ color: COLORS.textFaint }}>·</span>
              <DiffSummaryRow diff={diff} />
            </div>
          </section>

          {localNotes ? (
            <section style={{ display: "flex", flexDirection: "column", gap: "var(--space-8)" }}>
              <span style={mutedLabel}>release notes</span>
              <div style={{ padding: "10px 12px", border: "1px solid var(--border-subtle)", borderRadius: "var(--radius-sm)", background: "var(--background)", fontFamily: T.fontBody, fontSize: 12.5, color: "var(--foreground)", lineHeight: 1.55 }}>
                {localNotes}
              </div>
            </section>
          ) : null}

          {hasUnsavedChanges ? (
            <div style={{ padding: "10px 12px", border: `1px solid ${COLORS.amberBorder}`, borderRadius: "var(--radius-sm)", background: "#13100E", fontFamily: T.fontMono, fontSize: "var(--font-size-sm)", color: COLORS.amber }}>
              ⚠ you have unsaved changes — save the draft before publishing
            </div>
          ) : null}
        </div>

        <div style={{ padding: "16px 28px", borderTop: "1px solid var(--border)", background: "rgba(0,0,0,0.15)", display: "flex", flexDirection: "column", gap: "var(--space-8)" }}>
          <span style={{ ...mutedLabel, color: COLORS.textFaint }}>
            type <strong style={{ color: "var(--foreground)" }}>{expectedPhrase}</strong> to confirm
          </span>
          <input
            autoFocus
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            style={{
              padding: "11px 14px",
              border: `1px solid ${confirmed ? COLORS.mintBorder : "var(--border-subtle)"}`,
              borderRadius: "var(--radius-sm)",
              background: confirmed ? COLORS.mintBg : "var(--background)",
              fontFamily: T.fontMono,
              fontSize: "var(--font-size-md)",
              color: confirmed ? COLORS.mint : "var(--foreground)",
              outline: "none",
            }}
          />
          <span style={{ fontFamily: T.fontMono, fontSize: "var(--font-size-2xs)", color: COLORS.textFaint }}>
            irreversible safety check · prevents accidental publish
          </span>
        </div>

        {error ? (
          <div style={{ padding: "0 28px 12px" }}>
            <div style={{ padding: "8px 12px", border: `1px solid ${COLORS.roseBorder}`, borderRadius: "var(--radius-sm)", background: "#130E11", fontFamily: T.fontMono, fontSize: "var(--font-size-sm)", color: COLORS.rose }}>
              ⚠ {error}
            </div>
          </div>
        ) : null}

        <div style={{ padding: "16px 28px", borderTop: "1px solid var(--border)", display: "flex", alignItems: "center", gap: "var(--space-10)" }}>
          <button
            type="button"
            onClick={onClose}
            style={{
              padding: "10px 16px",
              border: "1px solid var(--border-subtle)",
              borderRadius: "var(--radius-sm)",
              background: "transparent",
              fontFamily: T.fontMono,
              fontSize: "var(--font-size-sm)",
              color: COLORS.textMuted,
              letterSpacing: "0.06em",
              textTransform: "uppercase",
              cursor: "pointer",
            }}
          >
            cancel · keep editing
          </button>
          <div style={{ flex: 1 }} />
          <button
            type="button"
            onClick={onPublish}
            disabled={!confirmed || publishing || hasUnsavedChanges}
            style={{
              padding: "10px 18px",
              border: `1px solid ${COLORS.mintBorder}`,
              borderRadius: "var(--radius-sm)",
              background: confirmed && !hasUnsavedChanges ? COLORS.mintBg : "transparent",
              fontFamily: T.fontHeading,
              fontWeight: 500,
              fontSize: "var(--font-size-md)",
              color: confirmed && !hasUnsavedChanges ? COLORS.mint : COLORS.textFaint,
              letterSpacing: "0.04em",
              cursor: confirmed && !hasUnsavedChanges ? "pointer" : "not-allowed",
              display: "flex",
              alignItems: "center",
              gap: "var(--space-10)",
              opacity: confirmed && !hasUnsavedChanges ? 1 : 0.5,
            }}
          >
            <span style={{ width: 7, height: 7, borderRadius: 50, background: COLORS.mint }} />
            {publishing ? "publishing…" : `Publish v${draft.version}`}
            <span style={{ fontFamily: T.fontMono, fontSize: "var(--font-size-2xs)", opacity: 0.7, letterSpacing: "0.08em", marginLeft: "var(--space-4)" }}>⌘⏎</span>
          </button>
        </div>
      </div>
    </div>
  );
}

/* ── Diff helpers ───────────────────────────────────────────── */

type DiffSummary = { added: number; modified: number; removed: number; unchanged: number };

function computeDiff(baseline: ProbeDef[], draft: ProbeDef[]): DiffSummary {
  const baselineMap = new Map(baseline.map((p) => [p.id, p]));
  const draftMap = new Map(draft.map((p) => [p.id, p]));
  let added = 0;
  let modified = 0;
  let unchanged = 0;
  for (const p of draft) {
    const b = baselineMap.get(p.id);
    if (!b) added++;
    else if (probeEqual(b, p)) unchanged++;
    else modified++;
  }
  let removed = 0;
  for (const p of baseline) {
    if (!draftMap.has(p.id)) removed++;
  }
  return { added, modified, removed, unchanged };
}

/** Deep equality on the fields that determine a probe's behavior. Order
 * within arrays matters here — we treat `["a","b"]` and `["b","a"]` as
 * different chip lists. */
function probeEqual(a: ProbeDef, b: ProbeDef): boolean {
  return JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));
}
function canonical(p: ProbeDef): unknown {
  const exp = p.expectations ?? {};
  return {
    id: p.id,
    category: p.category,
    input: p.input,
    rubric: p.rubric,
    passThreshold: p.passThreshold ?? 3,
    expectations: {
      mustContain: exp.mustContain ?? [],
      mustNotContain: exp.mustNotContain ?? [],
      maxOutputTokens: exp.maxOutputTokens ?? null,
      voiceCheck: exp.voiceCheck ?? "",
      scopeCheck: exp.scopeCheck ?? "",
      frameCheck: exp.frameCheck ?? "",
    },
  };
}

/* ── Shared styles ──────────────────────────────────────────── */

const mutedLabel: React.CSSProperties = {
  fontFamily: T.fontMono,
  fontSize: "var(--font-size-xs)",
  color: COLORS.textFaint,
  letterSpacing: "0.1em",
  textTransform: "uppercase",
};
