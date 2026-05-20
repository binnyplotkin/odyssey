"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  type CSSProperties,
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
} from "react";
import type { IngestionEvent, ModelId, PlanOp } from "@odyssey/wiki-ingest";
import type { WikiIngestionLogRecord, WikiSourceRecord } from "@odyssey/db";
import {
  ASCIIMatterCanvas,
  matterStateFromIngestion,
  type MatterActivation,
  type MatterIngestionInput,
  type MatterPhase,
} from "./ascii-matter";
import { PromptOverlay } from "./prompt-overlay";
import { MetadataEditor } from "./metadata-editor";
import { PipelineSection } from "./pipeline-section";
import { RunPreviewSection } from "./run-preview-section";
import {
  SourceComposer,
  type SourceMode,
  type SourcePreviewChunk,
} from "./source-composer";
import { StickyFooter, type StickyFooterState } from "./sticky-footer";
import { MissionControl } from "./mission-control";
import { OpsLog, type OpQueueRow } from "./ops-log";
import { LiveStream, type ActiveWriteSnapshot } from "./live-stream";
import { ResolvedSummary } from "./resolved-summary";
import { FailedRecovery } from "./failed-recovery";
import { estimateCost } from "@odyssey/wiki-ingest";
import { classifySource } from "../../../characters/actions";
import {
  previewPurgeWikiIngestionRun,
  purgeWikiIngestionRun,
} from "../../../wikis/actions";
import {
  PurgeConfirmModal,
  type PurgePreview,
} from "@/components/purge-confirm-modal";

/* ── Tokens ────────────────────────────────────────────────────── */

const T = {
  bg: "var(--background)",
  panel: "var(--card)",
  panelStrong: "var(--card)",
  border: "var(--border)",
  divider: "var(--divider)",
  fg: "var(--text-primary)",
  text: "var(--text-secondary)",
  muted: "var(--muted)",
  faded: "var(--text-tertiary)",
  ghost: "var(--text-placeholder)",
  accent: "var(--accent-strong)",
  accentSoft: "var(--accent-soft)",
  accentLine: "color-mix(in srgb, var(--accent-strong) 18%, transparent)",
  ok: "#4ADE80",
  okSoft: "rgba(74, 222, 128, 0.08)",
  amber: "#FACC15",
  amberSoft: "rgba(250, 204, 21, 0.08)",
  danger: "var(--danger)",
  dangerSoft: "rgba(248, 113, 113, 0.08)",
  dangerLine: "rgba(248, 113, 113, 0.25)",
  onAccent: "var(--background)",
  fontHead: "'Space Grotesk', system-ui, sans-serif",
  fontBody: "'Inter', system-ui, sans-serif",
  fontMono: "'JetBrains Mono', ui-monospace, monospace",
};

/* ── Types ─────────────────────────────────────────────────────── */

/**
 * Multi-line ghost shown behind the textarea when empty. Doubles as a
 * what-to-paste hint and matches the Paper artboard's preview state.
 */
const GHOST_SAMPLE = `22:1  And it came to pass after these things, that God did tempt
Abraham, and said unto him, Abraham: and he said, Behold, here I am.

22:2  And he said, Take now thy son, thine only son Isaac, whom thou
lovest, and get thee into the land of Moriah; and offer him there for
a burnt offering upon one of the mountains which I will tell thee of.`;

type SourceKind =
  | "primary"
  | "commentary"
  | "annotation"
  | "transcript"
  | "reference";

const CHUNK_TOKEN_BUDGET = 512;

function estimateTokensFromText(text: string) {
  return Math.round(text.length / 4);
}

function normalizeSourceWhitespace(input: string) {
  return input
    .replace(/\r\n?/g, "\n")
    .replace(/\u00a0/g, " ")
    .split("\n")
    .map((line) => line.replace(/\t/g, "  ").replace(/[ \f\v]+$/g, ""))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function splitLongTextAtBudget(text: string, charBudget: number): string[] {
  const out: string[] = [];
  let rest = text.trim();
  while (rest.length > charBudget) {
    const hard = rest.slice(0, charBudget);
    const breakAt = Math.max(
      hard.lastIndexOf("\n"),
      hard.lastIndexOf(". "),
      hard.lastIndexOf("; "),
      hard.lastIndexOf(", "),
      hard.lastIndexOf(" "),
    );
    const cut = breakAt > charBudget * 0.55 ? breakAt + 1 : charBudget;
    out.push(rest.slice(0, cut).trim());
    rest = rest.slice(cut).trim();
  }
  if (rest) out.push(rest);
  return out;
}

function buildSourcePreviewChunks(
  text: string,
  tokenBudget = CHUNK_TOKEN_BUDGET,
): SourcePreviewChunk[] {
  const body = text.trim();
  if (!body) return [];
  const charBudget = tokenBudget * 4;
  const paragraphs = body.split(/\n{2,}/).filter((part) => part.trim());
  const chunks: string[] = [];
  let current = "";

  const flush = () => {
    const trimmed = current.trim();
    if (trimmed) chunks.push(trimmed);
    current = "";
  };

  for (const paragraph of paragraphs) {
    const part = paragraph.trim();
    if (!part) continue;
    if (part.length > charBudget) {
      flush();
      chunks.push(...splitLongTextAtBudget(part, charBudget));
      continue;
    }
    const next = current ? `${current}\n\n${part}` : part;
    if (next.length > charBudget) {
      flush();
      current = part;
    } else {
      current = next;
    }
  }
  flush();

  return chunks.map((chunk, index) => ({
    index: index + 1,
    text: chunk,
    tokens: estimateTokensFromText(chunk),
    chars: chunk.length,
  }));
}

function useIsLightTheme() {
  const readTheme = useCallback(() => {
    if (typeof window === "undefined") return false;
    const explicit = document.documentElement.dataset.theme;
    if (explicit === "light") return true;
    if (explicit === "dark") return false;
    return window.matchMedia("(prefers-color-scheme: light)").matches;
  }, []);

  const [isLight, setIsLight] = useState(readTheme);

  useEffect(() => {
    const update = () => setIsLight(readTheme());
    update();

    const media = window.matchMedia("(prefers-color-scheme: light)");
    media.addEventListener("change", update);

    const observer = new MutationObserver(update);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-theme"],
    });

    return () => {
      media.removeEventListener("change", update);
      observer.disconnect();
    };
  }, [readTheme]);

  return isLight;
}

function lightMatterColor(color: string, phase: MatterPhase) {
  if (phase === "silent" || color.includes("248,113,113")) {
    return "rgba(153,27,27,1)";
  }
  if (color.includes("250,204,21")) {
    return "rgba(133,77,14,1)";
  }
  if (color.includes("74,222,128")) {
    return "rgba(22,101,52,1)";
  }
  return "rgba(5,83,75,1)";
}

function lightMatterBrightness(phase: MatterPhase) {
  switch (phase) {
    case "idle":
      return 0.9;
    case "silent":
      return 0.56;
    case "thinking":
      return 1.04;
    case "speaking":
      return 1.12;
    case "responding":
      return 1.02;
  }
}

function lightMatterTrail(phase: MatterPhase) {
  switch (phase) {
    case "idle":
      return 0.044;
    case "silent":
      return 0.07;
    case "thinking":
      return 0.055;
    case "speaking":
      return 0.058;
    case "responding":
      return 0.046;
  }
}

function lightMatterBaseField(phase: MatterPhase) {
  switch (phase) {
    case "idle":
      return 1.35;
    case "silent":
      return 0.9;
    case "thinking":
      return 1.18;
    case "speaking":
      return 1.12;
    case "responding":
      return 1.22;
  }
}

// Dot colors per kind — config consumed by the EnumMenu in MetadataEditor.
// Each kind gets its own hue so the dropdown reads at a glance.
const KINDS: { value: SourceKind; label: string; dot: string }[] = [
  { value: "primary", label: "primary", dot: "#8CE7D2" },
  { value: "commentary", label: "commentary", dot: "#A48CE7" },
  { value: "annotation", label: "annotation", dot: "#E78C8C" },
  { value: "transcript", label: "transcript", dot: "#E7CB8C" },
  { value: "reference", label: "reference", dot: "var(--text-placeholder)" },
];

function isSourceKind(value: unknown): value is SourceKind {
  return typeof value === "string" && KINDS.some((k) => k.value === value);
}

type RunPhase =
  | { phase: "idle" }
  | {
      phase: "live";
      runId: string | null;
      events: IngestionEvent[];
      startedAt: number;
    }
  | {
      phase: "resolved";
      events: IngestionEvent[];
      startedAt: number;
      finishedAt: number;
    }
  | {
      phase: "failed";
      events: IngestionEvent[];
      error: string;
      startedAt: number;
      finishedAt: number;
    };

type RunEventsResponse = {
  run: WikiIngestionLogRecord;
  events: Array<{
    seq: number;
    payload: IngestionEvent;
  }>;
  latestSeq: number;
};

type BrainState = {
  pageCount: number;
  edgeCount: number;
  sourceCount: number;
  runCount: number;
  successPct: number;
};

export type WikiIngestionViewProps = {
  characterId: string | null;
  wikiId: string;
  wikiTitle: string;
  brain: BrainState;
  sources: WikiSourceRecord[];
  runs: WikiIngestionLogRecord[];
  weekRuns: number;
  weekTokens: number;
  promptVersion?: string;
  promptTokens?: number;
  /** Effective ingestion prompt text — used by the overlay editor. */
  promptText: string;
  /** Optional custom name for the prompt. Null falls back to "{title} lens." */
  promptName?: string | null;
  /** True when the wiki has no override and is inheriting from the character. */
  promptInherited: boolean;
  /** Display name of the character whose prompt is being inherited (or own). */
  characterName: string;
};

/* ── Main component ────────────────────────────────────────────── */

export function WikiIngestionView({
  characterId,
  wikiId,
  wikiTitle,
  brain,
  sources,
  runs,
  weekRuns,
  weekTokens,
  promptVersion = "v3",
  promptTokens = 482,
  promptText,
  promptName = null,
  promptInherited,
  characterName,
}: WikiIngestionViewProps) {
  // Prompt label preference:
  //   1. The custom prompt name when the wiki has set one.
  //   2. Otherwise the character's name if we're inheriting their prompt.
  //   3. Otherwise the wiki title.
  const promptLabel =
    promptName?.trim() || (promptInherited ? characterName : wikiTitle);
  const router = useRouter();
  const [run, setRun] = useState<RunPhase>({ phase: "idle" });
  const [promptOpen, setPromptOpen] = useState(false);
  const [sourceSectionHeight, setSourceSectionHeight] = useState<number | null>(
    null,
  );
  const abortRef = useRef<AbortController | null>(null);
  const resumedRunRef = useRef<string | null>(null);

  // Composer form state — held at the page level so the sticky footer (a
  // sibling of the grid, full page width) can read `canRun` / `tokens` and
  // drive the Run action without needing to live inside ComposerCard.
  const [content, setContent] = useState("");
  const [title, setTitle] = useState("");
  const [kind, setKind] = useState<SourceKind>("primary");
  const [tags, setTags] = useState<string[]>([]);
  const [chunkPreviewEnabled, setChunkPreviewEnabled] = useState(false);
  const [normalizeWhitespace, setNormalizeWhitespace] = useState(true);
  const [model] = useState<ModelId>("claude-sonnet-4-5");

  const normalizedContent = useMemo(
    () => normalizeSourceWhitespace(content),
    [content],
  );
  const effectiveContent = normalizeWhitespace ? normalizedContent : content;
  const tokens = estimateTokensFromText(effectiveContent);
  const canRun = title.trim().length > 0 && effectiveContent.trim().length > 20;
  const previewChunks = useMemo(
    () => buildSourcePreviewChunks(effectiveContent),
    [effectiveContent],
  );
  const normalizedCharDelta = normalizedContent.length - content.length;

  const watchRun = useCallback(
    async (runId: string, startedAt: number, signal: AbortSignal) => {
      let latestSeq = 0;
      let events: IngestionEvent[] = [];

      while (!signal.aborted) {
        const res = await fetch(
          `/api/wiki/${wikiId}/ingest/runs/${runId}/events?after=${latestSeq}`,
          { signal, cache: "no-store" },
        );
        if (!res.ok) {
          const body = await res.text();
          throw new Error(`${res.status}: ${body.slice(0, 200)}`);
        }

        const body = (await res.json()) as RunEventsResponse;
        latestSeq = body.latestSeq;
        if (body.events.length > 0) {
          events = [...events, ...body.events.map((event) => event.payload)];
        }

        const finalEvent = events.findLast(
          (event) => event.type === "succeeded" || event.type === "failed",
        );
        if (finalEvent?.type === "succeeded" || body.run.status === "succeeded") {
          setRun({
            phase: "resolved",
            events,
            startedAt,
            finishedAt: body.run.finishedAt
              ? new Date(body.run.finishedAt).getTime()
              : Date.now(),
          });
          router.refresh();
          return;
        }
        if (finalEvent?.type === "failed" || body.run.status === "failed") {
          const error =
            finalEvent?.type === "failed"
              ? finalEvent.error
              : body.run.errorMessage ?? "Ingestion failed.";
          setRun({
            phase: "failed",
            events,
            error,
            startedAt,
            finishedAt: body.run.finishedAt
              ? new Date(body.run.finishedAt).getTime()
              : Date.now(),
          });
          router.refresh();
          return;
        }

        setRun({
          phase: "live",
          runId,
          events,
          startedAt,
        });

        await new Promise((resolve) => window.setTimeout(resolve, 1000));
      }
    },
    [router, wikiId],
  );

  const activePersistedRun = useMemo(
    () =>
      runs.find((item) => item.status === "queued" || item.status === "running") ??
      null,
    [runs],
  );

  useEffect(() => {
    if (!activePersistedRun || run.phase !== "idle") return;
    if (resumedRunRef.current === activePersistedRun.id) return;
    resumedRunRef.current = activePersistedRun.id;
    const controller = new AbortController();
    abortRef.current = controller;
    const startedAt = new Date(activePersistedRun.startedAt).getTime();
    setRun({
      phase: "live",
      runId: activePersistedRun.id,
      events: [],
      startedAt,
    });
    void watchRun(activePersistedRun.id, startedAt, controller.signal).catch((err) => {
      if (controller.signal.aborted) return;
      const msg = err instanceof Error ? err.message : String(err);
      setRun({
        phase: "failed",
        events: [],
        error: msg,
        startedAt,
        finishedAt: Date.now(),
      });
    });
    return () => controller.abort();
  }, [activePersistedRun, watchRun]);

  const draftKey = useMemo(
    () => `odyssey:wiki-ingestion-draft:${wikiId}`,
    [wikiId],
  );

  useEffect(() => {
    const raw = window.localStorage.getItem(draftKey);
    if (!raw) return;
    try {
      const draft = JSON.parse(raw) as Partial<ComposerDraft>;
      if (typeof draft.content === "string") setContent(draft.content);
      if (typeof draft.title === "string") setTitle(draft.title);
      if (isSourceKind(draft.kind)) setKind(draft.kind);
      if (typeof draft.chunkPreviewEnabled === "boolean") {
        setChunkPreviewEnabled(draft.chunkPreviewEnabled);
      }
      if (typeof draft.normalizeWhitespace === "boolean") {
        setNormalizeWhitespace(draft.normalizeWhitespace);
      }
      if (Array.isArray(draft.tags)) {
        setTags(
          draft.tags.filter((tag): tag is string => typeof tag === "string"),
        );
      }
    } catch {
      window.localStorage.removeItem(draftKey);
    }
  }, [draftKey]);

  const sourceById = useMemo(
    () => new Map(sources.map((s) => [s.id, s])),
    [sources],
  );

  // Ticks once per second while a run is live so the footer's elapsed /
  // spent / progress values stay fresh between SSE events (planning can
  // take 60-90s with no events emitted). The MissionControl panel in the
  // body re-renders frame-by-frame via MatterPanel's rAF loop, but the
  // footer's useMemo only re-runs on dep change, so we need an explicit
  // ticker for it.
  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => {
    if (run.phase !== "live") return;
    const id = window.setInterval(() => setNowMs(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [run.phase]);

  const footerTelemetry = useMemo(
    () => deriveFooterTelemetry(run, model, nowMs),
    [run, model, nowMs],
  );

  // Stats summary for the header / sidebar.
  const stats = useMemo(() => {
    const succeeded = runs.filter((r) => r.status === "succeeded").length;
    const successPct =
      runs.length === 0 ? 0 : Math.round((succeeded / runs.length) * 100);
    return {
      total: runs.length,
      week: weekRuns,
      weekTokens: weekTokens,
      success: successPct,
    };
  }, [runs, weekRuns, weekTokens]);

  const submitRun = useCallback(
    async (payload: ComposerPayload) => {
      const startedAt = Date.now();
      setRun({ phase: "live", runId: null, events: [], startedAt });

      const controller = new AbortController();
      abortRef.current = controller;

      try {
        const res = await fetch(`/api/wiki/${wikiId}/ingest`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
          signal: controller.signal,
        });
        if (!res.ok) {
          const body = await res.text();
          throw new Error(`${res.status}: ${body.slice(0, 200)}`);
        }
        const queued = (await res.json()) as { runId: string };
        setRun({ phase: "live", runId: queued.runId, events: [], startedAt });
        await watchRun(queued.runId, startedAt, controller.signal);
      } catch (err: unknown) {
        if (controller.signal.aborted) return;
        const msg = err instanceof Error ? err.message : String(err);
        setRun((prev) => ({
          phase: "failed",
          events: prev.phase === "live" ? prev.events : [],
          error: msg,
          startedAt: prev.phase === "live" ? prev.startedAt : startedAt,
          finishedAt: Date.now(),
        }));
      }
    },
    [watchRun, wikiId],
  );

  const dismissResult = useCallback(() => {
    setRun({ phase: "idle" });
    router.refresh();
  }, [router]);

  const cancelRun = useCallback(() => {
    abortRef.current?.abort();
    setRun({ phase: "idle" });
  }, []);

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        minHeight: "calc(100vh - 67px)",
        background: T.bg,
      }}
    >
      <div
        style={{
          display: "grid",
          // Composer is the per-run primary surface and should always get
          // the dominant share. Right column (matter + runs) is context —
          // kept narrow with a hard cap so it doesn't bloat on wide screens
          // and never crushes the composer on narrow ones.
          gridTemplateColumns: "minmax(0, 2fr) minmax(320px, 460px)",
          gap: 40,
          padding: "32px 32px 56px",
          alignItems: "flex-start",
        }}
      >
        <div style={{ minWidth: 0 }}>
          {run.phase === "idle" ? (
            <ComposerCard
              characterId={characterId}
              wikiId={wikiId}
              wikiTitle={wikiTitle}
              promptVersion={promptVersion}
              promptTokens={promptTokens}
              promptLabel={promptLabel}
              onConfigurePrompt={() => setPromptOpen(true)}
              onSourceSectionHeightChange={setSourceSectionHeight}
              title={title}
              onTitleChange={setTitle}
              content={content}
              onContentChange={setContent}
              effectiveContent={effectiveContent}
              kind={kind}
              onKindChange={setKind}
              tags={tags}
              onTagsChange={setTags}
              model={model}
              tokens={tokens}
              chunkPreviewEnabled={chunkPreviewEnabled}
              onChunkPreviewChange={setChunkPreviewEnabled}
              normalizeWhitespace={normalizeWhitespace}
              onNormalizeWhitespaceChange={setNormalizeWhitespace}
              previewChunks={previewChunks}
              normalizedCharDelta={normalizedCharDelta}
            />
          ) : run.phase === "live" ? (
            <LiveProgress run={run} />
          ) : run.phase === "resolved" ? (
            <ResolvedFromRun
              run={run}
              totalPagesBefore={brain?.pageCount ?? 0}
              onFeedAnother={dismissResult}
              onOpenKnowledge={() => router.push(`/wikis/${wikiId}/knowledge`)}
            />
          ) : (
            <FailedFromRun
              run={run}
              totalPagesBefore={brain?.pageCount ?? 0}
              onRetry={dismissResult}
              onDismiss={dismissResult}
            />
          )}
        </div>

        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 24,
            position: "sticky",
            top: 24,
            minWidth: 0,
          }}
        >
          <MatterPanel run={run} height={sourceSectionHeight} />
          {run.phase === "live" ? (
            <LiveStream
              events={run.events}
              startedAt={run.startedAt}
              activeWrite={deriveActiveWrite(run.events)}
            />
          ) : (
            <RecentRunsPanel
              wikiId={wikiId}
              runs={runs}
              sourceById={sourceById}
              stats={stats}
            />
          )}
        </div>
      </div>

      <StickyFooter
        state={footerStateFor(run.phase, canRun)}
        promptLabel={promptLabel}
        promptVersion={promptVersion}
        promptTokens={promptTokens}
        model={model}
        wikiTitle={wikiTitle}
        projectedCost={estimateCost(model, tokens, Math.round(tokens * 0.4))}
        projectedDurationSec={Math.max(3, Math.round(tokens / 2000))}
        projectedPages={Math.max(0, Math.ceil(Math.ceil(tokens / 512) * 0.5))}
        runningOpNum={footerTelemetry.runningOpNum}
        runningOpTotal={footerTelemetry.runningOpTotal}
        runningOpLabel={footerTelemetry.runningOpLabel}
        elapsedSec={footerTelemetry.elapsedSec}
        spentCost={footerTelemetry.spentCost}
        progressFraction={footerTelemetry.progressFraction}
        finalDurationSec={footerTelemetry.finalDurationSec}
        finalCost={footerTelemetry.finalCost}
        finalPages={footerTelemetry.finalPages}
        finalEdges={footerTelemetry.finalEdges}
        finalChunks={footerTelemetry.finalChunks}
        failedAtOpNum={footerTelemetry.failedAtOpNum}
        failedAtOpTotal={footerTelemetry.failedAtOpTotal}
        errorReason={footerTelemetry.errorReason}
        onRun={() => {
          window.localStorage.removeItem(draftKey);
          void submitRun({
            title,
            kind,
            tags,
            content: effectiveContent,
            model,
          });
        }}
        onCancel={cancelRun}
        onRetry={dismissResult}
        onRunAnother={dismissResult}
        onOpenWiki={() => router.push(`/wikis/${wikiId}`)}
        onReviewError={() => undefined}
        onEditPrompt={() => setPromptOpen(true)}
      />

      <PromptOverlay
        open={promptOpen}
        wikiId={wikiId}
        wikiTitle={wikiTitle}
        promptText={promptText}
        promptName={promptName}
        inheritedFromCharacter={promptInherited}
        characterName={characterName}
        onClose={() => setPromptOpen(false)}
        onPromptSaved={() => router.refresh()}
      />
    </div>
  );
}

/* ── Composer (idle / form) ─────────────────────────────────────── */

type ComposerPayload = {
  title: string;
  kind: SourceKind;
  tags: string[];
  content: string;
  model: ModelId;
};

type ComposerDraft = ComposerPayload & {
  chunkPreviewEnabled?: boolean;
  normalizeWhitespace?: boolean;
};

function ComposerCard({
  characterId,
  wikiId,
  wikiTitle,
  promptVersion,
  promptTokens,
  promptLabel,
  onConfigurePrompt,
  onSourceSectionHeightChange,
  title,
  onTitleChange,
  content,
  onContentChange,
  effectiveContent,
  kind,
  onKindChange,
  tags,
  onTagsChange,
  model,
  tokens,
  chunkPreviewEnabled,
  onChunkPreviewChange,
  normalizeWhitespace,
  onNormalizeWhitespaceChange,
  previewChunks,
  normalizedCharDelta,
}: {
  characterId: string | null;
  wikiId: string;
  wikiTitle: string;
  promptVersion: string;
  promptTokens: number;
  promptLabel: string;
  onConfigurePrompt: () => void;
  onSourceSectionHeightChange?: (height: number) => void;
  title: string;
  onTitleChange: (next: string) => void;
  content: string;
  onContentChange: (next: string) => void;
  effectiveContent: string;
  kind: SourceKind;
  onKindChange: (next: SourceKind) => void;
  tags: string[];
  onTagsChange: (next: string[]) => void;
  model: ModelId;
  tokens: number;
  chunkPreviewEnabled: boolean;
  onChunkPreviewChange: (next: boolean) => void;
  normalizeWhitespace: boolean;
  onNormalizeWhitespaceChange: (next: boolean) => void;
  previewChunks: SourcePreviewChunk[];
  normalizedCharDelta: number;
}) {
  void wikiId;
  const [contentMode, setContentMode] = useState<SourceMode>("paste");

  // Auto-classification: fires on paste when the form is still pristine.
  // Server action calls Haiku and returns { title, kind, tags }; the user
  // can edit or regenerate.
  const [classifying, setClassifying] = useState(false);
  const [classifiedBy, setClassifiedBy] = useState<"ai" | null>(null);
  const [classifyError, setClassifyError] = useState<string | null>(null);
  const classifyGenRef = useRef(0);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const sourceSectionRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!onSourceSectionHeightChange) return;
    const node = sourceSectionRef.current;
    if (!node) return;

    const syncHeight = () => {
      onSourceSectionHeightChange(
        Math.round(node.getBoundingClientRect().height),
      );
    };
    syncHeight();

    const ro = new ResizeObserver(syncHeight);
    ro.observe(node);
    return () => ro.disconnect();
  }, [onSourceSectionHeightChange]);

  function handlePaste() {
    if (classifying) return;
    if (title.trim() || tags.length > 0) return;
    // Read the textarea value *after* the browser's default paste lands,
    // so we classify the full pasted text rather than the stale value.
    requestAnimationFrame(() => {
      const rawText = textareaRef.current?.value ?? "";
      const text = normalizeWhitespace
        ? normalizeSourceWhitespace(rawText)
        : rawText;
      if (text.trim().length >= 500) void runClassify(text, "auto");
    });
  }

  const runClassify = useCallback(
    async (text: string, mode: "auto" | "regenerate") => {
      const body = text.trim();
      if (body.length < 80) return;
      if (!characterId) return;
      const gen = ++classifyGenRef.current;
      setClassifying(true);
      setClassifyError(null);
      try {
        const res = await classifySource(characterId, body);
        if (gen !== classifyGenRef.current) return;
        if (!res.ok) {
          setClassifyError(res.error);
          return;
        }
        if (!res.data) return;
        // Auto: only fill pristine fields. Regenerate: overwrite.
        if (mode === "regenerate" || !title.trim())
          onTitleChange(res.data.title);
        if (mode === "regenerate" || tags.length === 0)
          onTagsChange(res.data.tags);
        onKindChange(res.data.kind);
        setClassifiedBy("ai");
      } catch (err) {
        if (gen !== classifyGenRef.current) return;
        setClassifyError(err instanceof Error ? err.message : String(err));
      } finally {
        if (gen === classifyGenRef.current) setClassifying(false);
      }
    },
    [characterId, title, tags, onTitleChange, onKindChange, onTagsChange],
  );

  const canRun = title.trim().length > 0 && effectiveContent.trim().length > 20;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
      {/* Step 01 — Source */}
      <div ref={sourceSectionRef}>
        <SourceComposer
          mode={contentMode}
          onModeChange={setContentMode}
          value={content}
          onChange={onContentChange}
          onPaste={handlePaste}
          textareaRef={textareaRef}
          tokens={tokens}
          ghostSample={GHOST_SAMPLE}
          chunkPreviewEnabled={chunkPreviewEnabled}
          onChunkPreviewChange={onChunkPreviewChange}
          normalizeWhitespace={normalizeWhitespace}
          onNormalizeWhitespaceChange={onNormalizeWhitespaceChange}
          previewChunks={previewChunks}
          normalizedCharDelta={normalizedCharDelta}
        />
      </div>

      {/* Step 02 — Metadata */}
      <MetadataEditor<SourceKind>
        title={title}
        onTitleChange={onTitleChange}
        kind={kind}
        onKindChange={onKindChange}
        kindOptions={KINDS}
        tags={tags}
        onTagsChange={onTagsChange}
        classifying={classifying}
        classifiedBy={classifiedBy}
        classifyError={classifyError}
        canRegenerate={effectiveContent.trim().length >= 80}
        onRegenerate={() => void runClassify(effectiveContent, "regenerate")}
      />

      {/* Step 03 — Run preview (pipeline now lives in the sticky footer). */}
      <RunPreviewSection
        tokens={tokens}
        model={model}
        wikiTitle={wikiTitle}
        canRun={canRun}
      />
    </div>
  );
}

/* ── Live progress (replaces composer during run) ───────────────── */

function deriveOpQueue(events: IngestionEvent[]): OpQueueRow[] {
  // The full op list arrives in plan-complete (or grows as op-starts fire
  // before plan-complete in dry-run / partial states). Either way, we
  // reconcile by slug.
  const planEv = events.find((e) => e.type === "plan-complete");
  const planned: PlanOp[] = planEv?.type === "plan-complete" ? planEv.ops : [];

  const startedSlugs = new Set<string>();
  const completedBySlug = new Map<
    string,
    Extract<IngestionEvent, { type: "op-complete" }>
  >();
  const failedBySlug = new Map<
    string,
    Extract<IngestionEvent, { type: "op-failed" }>
  >();
  for (const ev of events) {
    if (ev.type === "op-start") startedSlugs.add(ev.op.slug);
    if (ev.type === "op-complete") completedBySlug.set(ev.op.slug, ev);
    if (ev.type === "op-failed") failedBySlug.set(ev.op.slug, ev);
  }

  // If plan-complete hasn't arrived yet, fall back to whatever op-starts
  // have been emitted so the user sees *something*.
  const ops =
    planned.length > 0
      ? planned
      : events
          .filter(
            (e): e is Extract<IngestionEvent, { type: "op-start" }> =>
              e.type === "op-start",
          )
          .map((e) => e.op);

  return ops.map<OpQueueRow>((op) => {
    const completed = completedBySlug.get(op.slug);
    if (completed) {
      return {
        state: "done",
        op,
        tokens: completed.tokens,
        edgesAdded: completed.edgesAdded,
      };
    }
    const failed = failedBySlug.get(op.slug);
    if (failed) {
      return { state: "failed", op, tokens: 0, error: failed.error };
    }
    if (startedSlugs.has(op.slug)) {
      return { state: "writing", op, tokens: 0 };
    }
    return { state: "queued", op };
  });
}

function LiveProgress({ run }: { run: Extract<RunPhase, { phase: "live" }> }) {
  const planEv = run.events.find((e) => e.type === "plan-complete");
  const loadedIndexEv = run.events.find(
    (e): e is Extract<IngestionEvent, { type: "loaded-index" }> =>
      e.type === "loaded-index",
  );
  const isPlanning = !planEv;
  const isLoadingIndex = !loadedIndexEv;
  const contradictions =
    planEv?.type === "plan-complete" ? planEv.contradictionCount : 0;

  const queue = deriveOpQueue(run.events);
  const opsTotal = queue.length;
  const opsDone = queue.filter((r) => r.state === "done").length;
  const inFlightIndex = queue.findIndex((r) => r.state === "writing");
  const currentIndex = inFlightIndex >= 0 ? inFlightIndex : opsDone - 1;
  const opsCreate = queue.filter((r) => r.op.action === "create").length;
  const opsUpdate = queue.filter((r) => r.op.action === "update").length;

  const tokensUsed = run.events.reduce(
    (acc, ev) => acc + (ev.type === "op-complete" ? ev.tokens : 0),
    0,
  );
  const elapsedMs = Date.now() - run.startedAt;
  // Naive ETA: if N/M done in T seconds, remaining = (M-N) * (T/N).
  const etaSec =
    opsDone > 0 && opsTotal > 0
      ? Math.max(
          1,
          Math.round(((opsTotal - opsDone) * (elapsedMs / opsDone)) / 1000),
        )
      : null;

  // Live telemetry derivations for MissionControl. Sparkline = tokens
  // consumed per completed op (no per-event timestamp available yet, so
  // we plot the op-by-op shape rather than a true time series). Rate is
  // the simple running average over the whole run; we can refine to a
  // rolling window once events carry timestamps.
  const opCompletes = run.events.filter(
    (e): e is Extract<IngestionEvent, { type: "op-complete" }> =>
      e.type === "op-complete",
  );
  const pagesAdded = opCompletes.filter((e) => e.op.action === "create").length;
  const edgesAddedLive = opCompletes.reduce((acc, e) => acc + e.edgesAdded, 0);
  const elapsedSec = Math.max(0.001, elapsedMs / 1000);
  const tokensPerSec = opCompletes.length > 0 ? tokensUsed / elapsedSec : null;
  const sparklineSamples = opCompletes.slice(-20).map((e) => e.tokens);
  const writingRow = queue.find((r) => r.state === "writing");
  const currentOpLabel = writingRow
    ? `${writingRow.op.action} · ${writingRow.op.title}`
    : isLoadingIndex
      ? "loading context · reading existing pages"
      : isPlanning
        ? loadedIndexEv
          ? `planning · ${loadedIndexEv.pageCount} pages, ${loadedIndexEv.edgeCount} edges`
          : "planning · analyzing context"
        : null;
  const currentOpStage = writingRow
    ? writingRow.op.action === "create"
      ? "writing → pages"
      : "updating → pages"
    : isPlanning && !isLoadingIndex
      ? "planning → ops"
      : null;
  const startedEv = run.events.find(
    (e): e is Extract<IngestionEvent, { type: "started" }> =>
      e.type === "started",
  );
  const liveModel = startedEv?.model ?? null;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 32 }}>
      {/* Status pill */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 12,
          fontFamily: T.fontMono,
          fontSize: 11,
          letterSpacing: "0.18em",
          textTransform: "uppercase",
        }}
      >
        <span
          style={{
            width: 7,
            height: 7,
            borderRadius: "50%",
            background: T.amber,
            boxShadow: `0 0 8px ${T.amber}CC`,
            animation: "ingestion-pulse 1.2s ease-in-out infinite",
          }}
        />
        <span style={{ color: T.amber, fontWeight: 500 }}>
          {isLoadingIndex
            ? "loading context"
            : isPlanning
              ? "planning"
              : "ingesting"}
        </span>
        <span style={{ color: T.faded }}>
          {isLoadingIndex || isPlanning
            ? " · streaming"
            : ` · op ${currentIndex >= 0 ? currentIndex + 1 : opsDone || 1} of ${opsTotal || "—"} · streaming`}
        </span>
      </div>

      {/* 01 · plan — mission-control telemetry board */}
      <MissionControl
        opsTotal={opsTotal}
        opsDone={opsDone}
        opsCreate={opsCreate}
        opsUpdate={opsUpdate}
        pagesAdded={pagesAdded}
        edgesAdded={edgesAddedLive}
        tokensUsed={tokensUsed}
        tokensPerSec={tokensPerSec}
        sparklineSamples={sparklineSamples}
        contradictions={contradictions}
        currentOpLabel={currentOpLabel}
        model={liveModel}
        currentOpStage={currentOpStage}
        elapsedMs={elapsedMs}
        etaSec={etaSec}
      />

      {/* 02 · ops — terminal log */}
      <OpsLog queue={queue} opsDone={opsDone} opsTotal={opsTotal} />

      {/* Pipeline, tokens-used, spend, writes-to, and the cancel button
          all live in the sticky footer's running state now — no need to
          duplicate them in the body. */}
    </div>
  );
}

/* ── Failed ─────────────────────────────────────────────────────── */

function FailedFromRun({
  run,
  totalPagesBefore,
  onRetry,
  onDismiss,
}: {
  run: Extract<RunPhase, { phase: "failed" }>;
  totalPagesBefore: number;
  onRetry: () => void;
  onDismiss: () => void;
}) {
  const opsDone = run.events.filter((e) => e.type === "op-complete").length;
  const planEv = run.events.find(
    (e): e is Extract<IngestionEvent, { type: "plan-complete" }> =>
      e.type === "plan-complete",
  );
  const opsTotal = planEv?.opCount ?? 0;

  const completes = run.events.filter(
    (e): e is Extract<IngestionEvent, { type: "op-complete" }> =>
      e.type === "op-complete",
  );
  const pagesAdded = completes.filter((e) => e.op.action === "create").length;
  const edgesAdded = completes.reduce((acc, e) => acc + e.edgesAdded, 0);

  const completeTokens = completes.reduce((acc, e) => acc + e.tokens, 0);
  const planTokens = planEv?.tokens ?? 0;
  const failedEv = run.events.find(
    (e): e is Extract<IngestionEvent, { type: "failed" }> =>
      e.type === "failed",
  );
  const tokensUsed = failedEv?.tokensUsed ?? completeTokens + planTokens;

  const opFailed = run.events.find(
    (e): e is Extract<IngestionEvent, { type: "op-failed" }> =>
      e.type === "op-failed",
  );
  const failingSlug = opFailed?.op.slug;

  const durationSec = Math.max(0, (run.finishedAt - run.startedAt) / 1000);

  return (
    <FailedRecovery
      opsDone={opsDone}
      opsTotal={opsTotal}
      failingSlug={failingSlug}
      error={run.error}
      durationSec={durationSec}
      pagesAdded={pagesAdded}
      edgesAdded={edgesAdded}
      tokensUsed={tokensUsed}
      totalPages={totalPagesBefore + pagesAdded}
      onRetry={onRetry}
      onDismiss={onDismiss}
    />
  );
}

/* ── Matter panel (contained canvas) ────────────────────────────── */

function MatterPanel({
  run,
  height,
}: {
  run: RunPhase;
  height: number | null;
}) {
  // Convert the view-local RunPhase into the canvas's MatterIngestionInput
  // shape (a near-1:1 mirror, kept as a separate type so ascii-matter.tsx
  // stays decoupled from this file).
  const ingestion: MatterIngestionInput =
    run.phase === "idle"
      ? { phase: "idle" }
      : run.phase === "live"
        ? {
            phase: "live",
            events: run.events,
            startedAt: run.startedAt,
          }
        : {
            phase: run.phase,
            events: run.events,
            startedAt: run.startedAt,
            finishedAt: run.finishedAt,
          };
  const state = matterStateFromIngestion(ingestion);
  const activeActivationMode = run.phase === "live" ? "particles" : "off";
  const activations = useMemo(() => matterActivationsFromRun(run), [run]);
  const isLightTheme = useIsLightTheme();
  const canvasColor = isLightTheme
    ? lightMatterColor(state.color, state.phase)
    : state.color;

  return (
    <div
      style={{
        position: "relative",
        height: height ?? 360,
        border: `1px solid ${T.border}`,
        boxSizing: "border-box",
        // Keep the corner markers visible outside the frame, but isolate
        // the animated field in its own clipped layer below.
        overflow: "visible",
      }}
    >
      <div
        aria-hidden
        style={{
          position: "absolute",
          inset: -1,
          overflow: "hidden",
          pointerEvents: "none",
        }}
      >
        <ASCIIMatterCanvas
          phase={state.phase}
          mode={state.mode}
          energy={state.energy}
          amplitude={state.amplitude}
          pulseAt={state.pulseAt}
          color={canvasColor}
          baseFieldColor={isLightTheme ? "rgba(86, 96, 101, 1)" : undefined}
          baseFieldStrength={
            isLightTheme ? lightMatterBaseField(state.phase) : undefined
          }
          activations={activations}
          activationMode={activeActivationMode}
          surfaceTone={isLightTheme ? "light" : "dark"}
          brightnessOverride={
            isLightTheme ? lightMatterBrightness(state.phase) : undefined
          }
          trailOverride={
            isLightTheme ? lightMatterTrail(state.phase) : undefined
          }
          maskThreshold={isLightTheme ? 0.045 : undefined}
          style={{
            inset: -2,
            width: "calc(100% + 4px)",
            height: "calc(100% + 4px)",
          }}
        />
      </div>
      {(["top-left", "top-right", "bottom-left", "bottom-right"] as const).map(
        (corner) => (
          <span
            key={corner}
            aria-hidden
            style={{
              position: "absolute",
              zIndex: 2,
              pointerEvents: "none",
              fontFamily: T.fontMono,
              fontSize: 13,
              lineHeight: 1,
              color: T.accent,
              opacity: 0.72,
              ...(corner.includes("top") ? { top: -7 } : { bottom: -7 }),
              ...(corner.includes("left") ? { left: -4 } : { right: -4 }),
            }}
          >
            +
          </span>
        ),
      )}
    </div>
  );
}

function matterActivationsFromRun(run: RunPhase): MatterActivation[] {
  if (run.phase === "idle") return [];

  const activations: MatterActivation[] = [];
  run.events.forEach((ev, index) => {
    const idBase = `${run.startedAt}:${index}:${ev.type}`;
    switch (ev.type) {
      case "planning":
        activations.push({
          id: idBase,
          kind: "planning",
          strength: 0.48,
          radius: 0.36,
          durationMs: 2600,
        });
        break;
      case "plan-complete":
        activations.push({
          id: idBase,
          kind: ev.contradictionCount > 0 ? "contradiction" : "planning",
          strength: ev.contradictionCount > 0 ? 1 : 0.7,
          radius: ev.contradictionCount > 0 ? 0.26 : 0.42,
          durationMs: ev.contradictionCount > 0 ? 4600 : 3200,
        });
        break;
      case "op-start":
        activations.push({
          id: `${idBase}:${ev.op.slug}`,
          kind: ev.op.type,
          strength: ev.op.action === "create" ? 0.78 : 0.66,
          radius: 0.24,
          durationMs: 3600,
        });
        break;
      case "op-complete":
        activations.push({
          id: `${idBase}:${ev.op.slug}`,
          kind: ev.op.type,
          strength: 0.92,
          radius: 0.3,
          durationMs: 4200,
        });
        if (ev.edgesAdded > 0 || ev.edgesRemoved > 0) {
          activations.push({
            id: `${idBase}:${ev.op.slug}:edges`,
            kind: "edge",
            strength: Math.min(
              1.1,
              0.55 + (ev.edgesAdded + ev.edgesRemoved) * 0.08,
            ),
            radius: 0.34,
            durationMs: 3600,
          });
        }
        break;
      case "op-failed":
        activations.push({
          id: `${idBase}:${ev.op.slug}`,
          kind: "failed",
          strength: 1.15,
          radius: 0.22,
          durationMs: 5200,
        });
        break;
      case "edges-reconciled":
        activations.push({
          id: idBase,
          kind: "edge",
          strength: Math.min(1, 0.52 + (ev.added + ev.removed) * 0.04),
          radius: 0.38,
          durationMs: 3400,
        });
        break;
      case "succeeded":
        activations.push({
          id: idBase,
          kind: ev.result.contradictionsFound > 0 ? "contradiction" : "success",
          strength: ev.result.contradictionsFound > 0 ? 0.95 : 0.9,
          radius: 0.46,
          durationMs: 4800,
        });
        break;
      case "failed":
        activations.push({
          id: idBase,
          kind: "failed",
          strength: 1.18,
          radius: 0.26,
          durationMs: 5600,
        });
        break;
      case "started":
      case "queued":
      case "loaded-index":
        break;
    }
  });

  return activations;
}

/* ── Resolved-summary derivation wrapper ───────────────────────── */

function ResolvedFromRun({
  run,
  totalPagesBefore,
  onFeedAnother,
  onOpenKnowledge,
}: {
  run: Extract<RunPhase, { phase: "resolved" }>;
  totalPagesBefore: number;
  onFeedAnother: () => void;
  onOpenKnowledge: () => void;
}) {
  const succEv = run.events.find(
    (e): e is Extract<IngestionEvent, { type: "succeeded" }> =>
      e.type === "succeeded",
  );
  const result = succEv?.result ?? null;
  const durationSec = Math.max(0, (run.finishedAt - run.startedAt) / 1000);
  const pagesCreated = result?.pagesCreated ?? 0;
  return (
    <ResolvedSummary
      pagesCreated={pagesCreated}
      pagesUpdated={result?.pagesUpdated ?? 0}
      edgesAdded={result?.edgesAdded ?? 0}
      tokensUsed={result?.tokensUsed ?? 0}
      durationSec={durationSec}
      totalPages={totalPagesBefore + pagesCreated}
      onOpenKnowledge={onOpenKnowledge}
      onFeedAnother={onFeedAnother}
    />
  );
}

/* ── Active-write derivation for LiveStream ────────────────────── */

function deriveActiveWrite(
  events: IngestionEvent[],
): ActiveWriteSnapshot | null {
  const planEv = events.find(
    (e): e is Extract<IngestionEvent, { type: "plan-complete" }> =>
      e.type === "plan-complete",
  );
  if (!planEv) return null;

  // Find the slug currently being written: latest op-start without a
  // matching op-complete.
  const completedSlugs = new Set(
    events
      .filter(
        (e): e is Extract<IngestionEvent, { type: "op-complete" }> =>
          e.type === "op-complete",
      )
      .map((e) => e.op.slug),
  );
  let activeStart: Extract<IngestionEvent, { type: "op-start" }> | null = null;
  for (const ev of events) {
    if (ev.type === "op-start" && !completedSlugs.has(ev.op.slug)) {
      activeStart = ev;
    }
  }
  if (!activeStart) return null;

  // Per-op tokens accumulate across op-complete deltas; while a slug is
  // in flight we have no direct counter, so we proxy with elapsed-time-
  // adjusted total. Cheap and good enough for the running-state UI.
  const opCompletes = events.filter(
    (e): e is Extract<IngestionEvent, { type: "op-complete" }> =>
      e.type === "op-complete",
  );
  const tokensCompletedAvg =
    opCompletes.length > 0
      ? Math.round(
          opCompletes.reduce((acc, e) => acc + e.tokens, 0) /
            opCompletes.length,
        )
      : 0;

  return {
    op: activeStart.op,
    indexInPlan: activeStart.index + 1,
    totalOps: activeStart.total,
    tokensStreamed: tokensCompletedAvg,
  };
}

/* ── Footer state derivation ───────────────────────────────────── */

function footerStateFor(
  phase: RunPhase["phase"],
  canRun: boolean,
): StickyFooterState {
  if (phase === "idle") return canRun ? "ready" : "idle";
  if (phase === "live") return "running";
  if (phase === "resolved") return "complete";
  return "failed";
}

type FooterTelemetry = {
  runningOpNum?: number;
  runningOpTotal?: number;
  runningOpLabel?: string;
  elapsedSec?: number;
  spentCost?: number;
  progressFraction?: number;
  finalDurationSec?: number;
  finalCost?: number;
  finalPages?: number;
  finalEdges?: number;
  finalChunks?: number;
  failedAtOpNum?: number;
  failedAtOpTotal?: number;
  errorReason?: string;
};

// Sum input/output tokens directly from events. The pipeline forwards
// both halves on plan-complete and op-complete, so no split-heuristic is
// needed for cost estimation.
function sumTokens(events: IngestionEvent[]): {
  input: number;
  output: number;
  total: number;
} {
  let input = 0;
  let output = 0;
  for (const ev of events) {
    if (ev.type === "plan-complete" || ev.type === "op-complete") {
      input += ev.inputTokens;
      output += ev.outputTokens;
    }
  }
  return { input, output, total: input + output };
}

function deriveFooterTelemetry(
  run: RunPhase,
  model: ModelId,
  nowMs: number,
): FooterTelemetry {
  if (run.phase === "idle") return {};

  if (run.phase === "live") {
    const queue = deriveOpQueue(run.events);
    const opsTotal = queue.length;
    const opsDone = queue.filter((r) => r.state === "done").length;
    const writingRow = queue.find((r) => r.state === "writing");
    const writingIndex = queue.findIndex((r) => r.state === "writing");
    const planEv = run.events.find((e) => e.type === "plan-complete");
    const isPlanning = !planEv;
    const currentNum =
      writingIndex >= 0 ? writingIndex + 1 : Math.min(opsTotal, opsDone + 1);
    const { input, output } = sumTokens(run.events);
    const elapsedSec = (nowMs - run.startedAt) / 1000;
    const progressFraction =
      opsTotal > 0 ? (opsDone + (writingRow ? 0.5 : 0)) / opsTotal : 0;

    return {
      runningOpNum: isPlanning ? 0 : currentNum,
      runningOpTotal: opsTotal,
      runningOpLabel: isPlanning
        ? "planning · analyzing context…"
        : writingRow
          ? `${writingRow.op.action} · ${writingRow.op.slug}`
          : undefined,
      elapsedSec,
      spentCost: estimateCost(model, input, output),
      progressFraction,
    };
  }

  if (run.phase === "resolved") {
    const succ = run.events.find(
      (e): e is Extract<IngestionEvent, { type: "succeeded" }> =>
        e.type === "succeeded",
    );
    const result = succ?.result ?? null;
    const opsDone = run.events.filter((e) => e.type === "op-complete").length;
    return {
      finalDurationSec: (run.finishedAt - run.startedAt) / 1000,
      finalCost: estimateCost(
        model,
        result?.inputTokens ?? 0,
        result?.outputTokens ?? 0,
      ),
      finalPages: result?.pagesCreated ?? 0,
      finalEdges: result?.edgesAdded ?? 0,
      finalChunks: opsDone,
    };
  }

  // failed
  const planEv = run.events.find(
    (e): e is Extract<IngestionEvent, { type: "plan-complete" }> =>
      e.type === "plan-complete",
  );
  const opsTotal = planEv?.opCount ?? 0;
  const opsDone = run.events.filter((e) => e.type === "op-complete").length;
  return {
    failedAtOpNum: Math.min(opsDone + 1, Math.max(opsTotal, opsDone + 1)),
    failedAtOpTotal: opsTotal,
    errorReason: run.error,
  };
}

/* ── Recent runs panel ──────────────────────────────────────────── */

function RecentRunsPanel({
  wikiId,
  runs,
  sourceById,
  stats,
}: {
  wikiId: string;
  runs: WikiIngestionLogRecord[];
  sourceById: Map<string, WikiSourceRecord>;
  stats: { total: number; week: number; weekTokens: number; success: number };
}) {
  const router = useRouter();
  const [purgeRunId, setPurgeRunId] = useState<string | null>(null);
  const [purgeOpen, setPurgeOpen] = useState(false);
  const [purgePreview, setPurgePreview] = useState<PurgePreview | null>(null);
  const [purgeLoading, setPurgeLoading] = useState(false);
  const [purgeError, setPurgeError] = useState<string | null>(null);
  const [purgePending, startPurge] = useTransition();

  const openPurge = async (run: WikiIngestionLogRecord) => {
    setPurgeRunId(run.id);
    setPurgeOpen(true);
    setPurgePreview(null);
    setPurgeError(null);
    setPurgeLoading(true);
    const result = await previewPurgeWikiIngestionRun(wikiId, run.id);
    setPurgeLoading(false);
    if (result.ok) setPurgePreview(result.data ?? null);
    else setPurgeError(result.error);
  };

  const confirmPurge = () => {
    if (!purgeRunId) return;
    setPurgeError(null);
    startPurge(async () => {
      const result = await purgeWikiIngestionRun(wikiId, purgeRunId);
      if (!result.ok) {
        setPurgeError(result.error);
        return;
      }
      setPurgeOpen(false);
      setPurgeRunId(null);
      setPurgePreview(null);
      router.refresh();
    });
  };

  const cells: Array<{
    label: string;
    value: string | number;
    tone?: "ok" | "amber" | "error";
  }> = [
    { label: "Total runs", value: stats.total },
    { label: "This week", value: stats.week },
    { label: "Tokens · 7d", value: formatTokens(stats.weekTokens) },
    {
      label: "Success",
      value: `${stats.success}%`,
      tone:
        stats.success >= 80 ? "ok" : stats.success >= 50 ? "amber" : "error",
    },
  ];
  return (
    // No outer card — Paper renders Recent Runs as a vertical stack with
    // the stat strip and each run row carrying their own borders. Matches
    // 648-0 in the artboard.
    <section style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <style>{RUN_ROW_HOVER_CSS}</style>
      <header
        style={{
          display: "flex",
          alignItems: "baseline",
          justifyContent: "space-between",
        }}
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <span
            style={{
              fontFamily: T.fontMono,
              fontSize: 10,
              letterSpacing: "0.14em",
              textTransform: "uppercase",
              color: T.faded,
            }}
          >
            run log
          </span>
          <h3
            style={{
              margin: 0,
              fontFamily: T.fontHead,
              fontSize: 20,
              fontWeight: 500,
              color: T.fg,
              letterSpacing: "-0.01em",
            }}
          >
            Recent runs
          </h3>
        </div>
        <span style={{ fontFamily: T.fontMono, fontSize: 11, color: T.faded }}>
          {Math.min(5, runs.length)} of {runs.length} ↗
        </span>
      </header>

      {/* Stat strip — sharp-cornered card with vertical dividers between cells. */}
      <div
        style={{
          display: "flex",
          border: `1px solid ${T.border}`,
          overflow: "hidden",
        }}
      >
        {cells.map((c, i) => (
          <div
            key={c.label}
            style={{
              flex: 1,
              display: "flex",
              flexDirection: "column",
              justifyContent: "flex-end",
              gap: 4,
              padding: "18px 16px",
              borderRight:
                i < cells.length - 1 ? `1px solid ${T.divider}` : "none",
            }}
          >
            <Stat label={c.label} value={c.value} tone={c.tone} />
          </div>
        ))}
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {runs.slice(0, 5).map((r) => (
          <RunRow
            key={r.id}
            wikiId={wikiId}
            run={r}
            source={r.sourceId ? (sourceById.get(r.sourceId) ?? null) : null}
            onOpenPurge={() => openPurge(r)}
            purgePending={purgePending && purgeRunId === r.id}
          />
        ))}
      </div>
      <PurgeConfirmModal
        open={purgeOpen}
        kind="run"
        preview={purgePreview}
        loading={purgeLoading}
        pending={purgePending}
        error={purgeError}
        onCancel={() => {
          if (!purgePending) setPurgeOpen(false);
        }}
        onConfirm={confirmPurge}
      />
    </section>
  );
}

/**
 * Idle + hover bg/border live in CSS classes (not inline) so the
 * `:hover` pseudo-class can override them. Inline `style` always wins
 * over stylesheet rules by specificity, which would silently swallow the
 * hover. Hover commits to the Odyssey accent for an unmistakable signal
 * in both themes.
 */
const RUN_ROW_HOVER_CSS = `
  .ingestion-run-row {
    background: var(--card);
    border: 1px solid var(--border);
  }
  .ingestion-run-row:hover {
    background: var(--accent-soft);
    border-color: var(--accent);
  }
  .ingestion-run-row-failed {
    background: color-mix(in srgb, var(--danger) 8%, transparent);
    border: 1px solid color-mix(in srgb, var(--danger) 25%, transparent);
  }
  .ingestion-run-row-failed:hover {
    background: color-mix(in srgb, var(--danger) 16%, transparent);
    border-color: var(--danger);
  }
`;

function RunRow({
  wikiId,
  run,
  source,
  onOpenPurge,
  purgePending,
}: {
  wikiId: string;
  run: WikiIngestionLogRecord;
  source: WikiSourceRecord | null;
  onOpenPurge: () => void;
  purgePending: boolean;
}) {
  const ok = run.status === "succeeded";
  const failed = run.status === "failed";
  const running = run.status === "running" || run.status === "queued";
  const finishedAt = run.finishedAt ?? run.startedAt;
  const href = run.sourceId
    ? `/wikis/${wikiId}/sources/${run.sourceId}?run=${run.id}`
    : `/wikis/${wikiId}/ingestion`;
  return (
    <div
      className={failed ? "ingestion-run-row-failed" : "ingestion-run-row"}
      style={{
        display: "flex",
        alignItems: "stretch",
        justifyContent: "space-between",
        gap: 12,
        padding: "18px 20px",
        color: "inherit",
        transition: "border-color 120ms ease, background 120ms ease",
      }}
    >
      <Link
        href={href}
        style={{
          display: "flex",
          flex: 1,
          minWidth: 0,
          flexDirection: "column",
          gap: 10,
          textDecoration: "none",
          color: "inherit",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
            <RunIcon ok={ok} failed={failed} running={running} />
            <span
              style={{
                fontFamily: T.fontBody,
                fontSize: 13,
                color: T.fg,
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {source?.title ?? "(inline)"}
            </span>
          </div>
          <span style={{ fontFamily: T.fontMono, fontSize: 11, color: T.faded }}>
            {relativeShort(finishedAt)}
          </span>
        </div>
        <div
          style={{
            fontFamily: T.fontMono,
            fontSize: 11,
            color: failed ? T.danger : T.muted,
            display: "flex",
            gap: 10,
            flexWrap: "wrap",
          }}
        >
          <span>{run.model ?? "—"}</span>
          <span style={{ opacity: 0.3 }}>·</span>
          {failed ? (
            <span>{run.errorMessage ?? "halted"}</span>
          ) : (
            <>
              <span style={{ color: T.ok }}>+{run.pagesCreated} pages</span>
              <span style={{ color: T.ok }}>+{run.edgesAdded} edges</span>
              <span style={{ opacity: 0.3 }}>·</span>
              <span>{formatTokens(run.tokensUsed)}</span>
            </>
          )}
        </div>
      </Link>
      <button
        type="button"
        onClick={onOpenPurge}
        disabled={purgePending}
        title="Purge this run"
        style={{
          alignSelf: "center",
          padding: "6px 10px",
          borderRadius: 6,
          border: `1px solid ${T.dangerLine}`,
          background: "transparent",
          color: T.danger,
          fontFamily: T.fontBody,
          fontSize: 11,
          cursor: purgePending ? "not-allowed" : "pointer",
          opacity: purgePending ? 0.5 : 1,
        }}
      >
        {purgePending ? "…" : "Purge"}
      </button>
    </div>
  );
}

function RunIcon({
  ok,
  failed,
  running,
}: {
  ok: boolean;
  failed: boolean;
  running: boolean;
}) {
  const size = 16;
  const color = ok ? T.ok : failed ? T.danger : T.amber;
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        width: size,
        height: size,
        borderRadius: "50%",
        background: `${color}22`,
        border: `1px solid ${color}66`,
      }}
    >
      {ok && (
        <svg
          width="8"
          height="8"
          viewBox="0 0 12 12"
          fill="none"
          stroke={color}
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <polyline points="3 6 5 8 9 4" />
        </svg>
      )}
      {failed && (
        <svg
          width="8"
          height="8"
          viewBox="0 0 12 12"
          fill="none"
          stroke={color}
          strokeWidth="2"
          strokeLinecap="round"
        >
          <line x1="3" y1="3" x2="9" y2="9" />
          <line x1="9" y1="3" x2="3" y2="9" />
        </svg>
      )}
      {running && (
        <span
          style={{
            width: 6,
            height: 6,
            borderRadius: "50%",
            background: color,
            animation: "ingestion-pulse 1.2s ease-in-out infinite",
          }}
        />
      )}
    </span>
  );
}

function relativeShort(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function formatTokens(n: number): string {
  if (n < 1000) return `${n}`;
  return `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}k`;
}

/* ── Atoms ──────────────────────────────────────────────────────── */

function StepLabel({ num, children }: { num: string; children: ReactNode }) {
  return (
    <span
      style={{
        fontFamily: T.fontMono,
        fontSize: 11,
        letterSpacing: "0.18em",
        textTransform: "uppercase",
        color: T.accent,
      }}
    >
      {num} · {children}
    </span>
  );
}

function Metric({
  label,
  value,
  valueColor,
}: {
  label: string;
  value: string;
  valueColor?: string;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
      <span
        style={{
          fontSize: 10,
          letterSpacing: "0.14em",
          textTransform: "uppercase",
          color: T.faded,
        }}
      >
        {label}
      </span>
      <span style={{ color: valueColor ?? T.fg }}>{value}</span>
    </div>
  );
}

function Stat({
  label,
  value,
  tone,
}: {
  label: string;
  value: string | number;
  tone?: "ok" | "amber" | "error";
}) {
  const color =
    tone === "ok"
      ? T.ok
      : tone === "amber"
        ? T.amber
        : tone === "error"
          ? T.danger
          : T.fg;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <span
        style={{
          fontFamily: T.fontHead,
          fontSize: 26,
          fontWeight: 500,
          letterSpacing: "-0.02em",
          color,
          lineHeight: 1,
        }}
      >
        {value}
      </span>
      <span
        style={{
          fontFamily: T.fontMono,
          fontSize: 10,
          letterSpacing: "0.14em",
          textTransform: "uppercase",
          color: T.faded,
        }}
      >
        {label}
      </span>
    </div>
  );
}

function PrimaryButton({
  onClick,
  disabled,
  children,
}: {
  onClick: () => void;
  disabled?: boolean;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 10,
        padding: "11px 22px",
        background: disabled ? T.accentSoft : T.accent,
        color: T.onAccent,
        border: "none",
        borderRadius: 10,
        fontFamily: T.fontMono,
        fontSize: 13,
        fontWeight: 500,
        cursor: disabled ? "not-allowed" : "pointer",
      }}
    >
      {children}
    </button>
  );
}

function GhostButton({
  onClick,
  children,
}: {
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        padding: "11px 18px",
        background: "transparent",
        color: T.text,
        border: `1px solid ${T.border}`,
        borderRadius: 10,
        fontFamily: T.fontMono,
        fontSize: 13,
        cursor: "pointer",
      }}
    >
      {children}
    </button>
  );
}

function PlusIcon() {
  return (
    <svg width="11" height="11" viewBox="0 0 11 11" fill="none">
      <path
        d="M5.5 1V10M1 5.5H10"
        stroke={T.onAccent}
        strokeWidth="1.6"
        strokeLinecap="round"
      />
    </svg>
  );
}
