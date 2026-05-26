"use client";

import Link from "next/link";
import { useEffect, useState, useTransition } from "react";
import { useHeaderContent } from "@/components/header-context";
import {
  draftWorldFromPrompt,
  createWorldFromDraft,
  type WorldDraft,
} from "@/app/(authenticated)/worlds/actions";

const T = {
  fg: "var(--foreground)",
  muted: "var(--muted)",
  dim: "#5A6478",
  panel: "var(--panel)",
  border: "var(--border)",
  accent: "#8FD1CB",
  fontHeading: "'Space Grotesk', sans-serif",
  fontBody: "'Inter', sans-serif",
  fontMono: "var(--font-mono, 'JetBrains Mono', monospace)",
};

type Phase = "describe" | "review";

type StartingPoint = {
  label: string;
  color: string;
  prompt: string;
};

const STARTING_POINTS: StartingPoint[] = [
  {
    label: "Scripture",
    color: "#8FD1CB",
    prompt: "A voice-first dramatization of the Genesis 18 hospitality scene. The player is Abraham at the oaks of Mamre in late midday heat. Three visitors appear. The dialogue should feel grounded and ancient.",
  },
  {
    label: "History",
    color: "#A5B4FC",
    prompt: "Caesar's first morning after crossing the Rubicon. The player is Caesar. Officers hover. The weight of the decision settles in.",
  },
  {
    label: "Fiction",
    color: "#FBA7C0",
    prompt: "A Spanish galleon in 1715, three weeks out from Havana. The crew is contemplating mutiny. The player is the captain, newly aware of the whispers below decks.",
  },
  {
    label: "Training",
    color: "#F5C67A",
    prompt: "A Jane Street interview for a quant role. The player is the candidate. The interviewer probes a behavioral scenario that reveals how they handle conflict under pressure.",
  },
];

export function NewWorldForm() {
  const [phase, setPhase] = useState<Phase>("describe");
  const [prompt, setPrompt] = useState("");
  const [draft, setDraft] = useState<WorldDraft | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [drafting, startDrafting] = useTransition();
  const [creating, startCreating] = useTransition();

  const { setContent } = useHeaderContent();
  useEffect(() => {
    setContent(
      <div
        style={{
          display: "flex",
          alignItems: "center",
          width: "100%",
          minWidth: 0,
        }}
      >
        <Link
          href="/worlds"
          style={{
            display: "flex", alignItems: "center", justifyContent: "center",
            width: 28, height: 28, borderRadius: "var(--radius-sm)",
            border: `1px solid ${T.border}`, background: "transparent",
            color: T.muted, textDecoration: "none", marginRight: "var(--space-12)",
          }}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.25" strokeLinecap="round"><polyline points="15 18 9 12 15 6" /></svg>
        </Link>
        <h1 style={{
          fontSize: "var(--font-size-xl)", fontWeight: 700, color: T.fg,
          margin: 0, marginRight: "var(--space-12)", whiteSpace: "nowrap", fontFamily: T.fontHeading,
        }}>
          New World
        </h1>
        <div style={{ width: 1, height: 16, background: T.border, marginRight: "var(--space-12)" }} />
        <div style={{
          fontFamily: T.fontMono, fontSize: "var(--font-size-xs)", fontWeight: 500,
          letterSpacing: "0.12em", textTransform: "uppercase", color: T.dim,
        }}>
          Worlds · {phase === "describe" ? "Describe" : "Review draft"}
        </div>
        <div style={{ flex: 1 }} />
        <Link
          href="/worlds"
          style={{
            padding: "6px 14px", borderRadius: "var(--radius-sm)",
            border: `1px solid ${T.border}`, background: "transparent",
            color: T.fg, textDecoration: "none",
            fontFamily: T.fontBody, fontSize: "var(--font-size-base)", fontWeight: 500,
          }}
        >
          Cancel
        </Link>
      </div>,
    );
    return () => setContent(null);
  }, [setContent, phase]);

  function onDraft() {
    setError(null);
    startDrafting(async () => {
      const res = await draftWorldFromPrompt(prompt);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setDraft(res.data!);
      setPhase("review");
    });
  }

  function onCreate() {
    if (!draft) return;
    setError(null);
    startCreating(async () => {
      const res = await createWorldFromDraft({
        prompt,
        title: draft.title,
        slug: draft.slug,
        setting: draft.setting,
        premise: draft.premise,
        introNarration: draft.introNarration,
      });
      if (!res.ok) {
        setError(res.error);
      }
    });
  }

  return phase === "describe" ? (
    <DescribePhase
      prompt={prompt}
      setPrompt={setPrompt}
      onDraft={onDraft}
      drafting={drafting}
      error={error}
    />
  ) : (
    <ReviewPhase
      prompt={prompt}
      draft={draft!}
      setDraft={setDraft as (d: WorldDraft) => void}
      onBack={() => setPhase("describe")}
      onCreate={onCreate}
      creating={creating}
      error={error}
    />
  );
}

/* ── Describe phase ───────────────────────────────────────── */

function DescribePhase({
  prompt, setPrompt, onDraft, drafting, error,
}: {
  prompt: string;
  setPrompt: (s: string) => void;
  onDraft: () => void;
  drafting: boolean;
  error: string | null;
}) {
  const canDraft = prompt.trim().length >= 10 && !drafting;
  const charCount = prompt.length;

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter" && canDraft) {
      e.preventDefault();
      onDraft();
    }
  }

  return (
    <div style={{
      maxWidth: 760, margin: "0 auto", display: "flex",
      flexDirection: "column", gap: "var(--space-24)", paddingTop: "var(--space-32)", fontFamily: T.fontBody,
    }}>
      {/* Hero */}
      <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-12)" }}>
        <span style={{
          display: "inline-flex", alignItems: "center", gap: "var(--space-6)", alignSelf: "flex-start",
          padding: "3px 10px 3px 8px", borderRadius: "var(--radius-pill)",
          background: "rgba(143, 209, 203, 0.10)",
          border: "1px solid rgba(143, 209, 203, 0.25)",
        }}>
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke={T.accent} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 3l1.5 4.5L18 9l-4.5 1.5L12 15l-1.5-4.5L6 9l4.5-1.5L12 3z" />
          </svg>
          <span style={{
            fontFamily: T.fontMono, fontSize: "var(--font-size-2xs)", fontWeight: 500,
            letterSpacing: "0.12em", textTransform: "uppercase", color: T.accent,
          }}>
            AI draft
          </span>
        </span>
        <h1 style={{
          fontFamily: T.fontHeading, fontSize: 44, fontWeight: 600,
          letterSpacing: "-0.025em", lineHeight: "48px", margin: 0, color: T.fg,
        }}>
          Describe your world.
        </h1>
        <p style={{
          fontFamily: T.fontBody, fontSize: 15, lineHeight: "24px", color: T.muted, margin: 0, maxWidth: 640,
        }}>
          Tell us what you have in mind — a scene, an era, a relationship, a question. Odyssey will draft the title, setting, premise, and intro narration. You can edit anything after.
        </p>
      </div>

      {/* Prompt card */}
      <div style={{
        display: "flex", flexDirection: "column",
        padding: "var(--space-20)", borderRadius: "var(--radius-2xl)",
        background: T.panel, border: `1px solid ${T.border}`,
        boxShadow: "0 0 0 6px rgba(143, 209, 203, 0.05)",
      }}>
        <textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder="e.g. A voice-first dramatization of the Genesis 18 hospitality scene. The player is Abraham at the oaks of Mamre…"
          rows={6}
          maxLength={2000}
          autoFocus
          style={{
            width: "100%", border: "none", outline: "none", resize: "vertical",
            padding: 0, background: "transparent", color: T.fg,
            fontFamily: T.fontBody, fontSize: "var(--font-size-lg)", lineHeight: "22px",
            boxSizing: "border-box", minHeight: 120,
          }}
        />
        <div style={{
          display: "flex", alignItems: "center", gap: "var(--space-12)",
          marginTop: "var(--space-18)", paddingTop: "var(--space-16)", borderTop: `1px solid ${T.border}`,
        }}>
          <div style={{
            display: "flex", alignItems: "center", gap: "var(--space-6)",
            fontFamily: T.fontBody, fontSize: "var(--font-size-base)", color: T.muted,
          }}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 20h9" /><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />
            </svg>
            Describe freely
          </div>
          <div style={{ flex: 1 }} />
          <div style={{
            fontFamily: T.fontMono, fontSize: "var(--font-size-sm)", color: T.dim,
          }}>
            <span style={{ color: charCount > 1800 ? "#F87171" : T.muted }}>{charCount}</span>
            <span style={{ color: T.dim }}> / 2000</span>
          </div>
          <button
            type="button"
            disabled={!canDraft}
            onClick={onDraft}
            style={{
              display: "inline-flex", alignItems: "center", gap: "var(--space-10)",
              padding: "8px 14px", borderRadius: "var(--radius-md)", border: "none",
              background: canDraft ? T.accent : "var(--card-hover)",
              color: canDraft ? "#0C0E14" : T.muted,
              fontFamily: T.fontBody, fontSize: "var(--font-size-md)", fontWeight: 600,
              cursor: canDraft ? "pointer" : "not-allowed",
            }}
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 3l1.5 4.5L18 9l-4.5 1.5L12 15l-1.5-4.5L6 9l4.5-1.5L12 3z" />
            </svg>
            {drafting ? "Drafting…" : "Draft with AI"}
            {!drafting && (
              <span style={{
                display: "inline-flex", alignItems: "center", gap: "var(--space-2)",
                padding: "2px 6px", borderRadius: "var(--radius-xs)",
                background: "rgba(12, 14, 20, 0.15)",
                fontFamily: T.fontMono, fontSize: "var(--font-size-xs)", fontWeight: 500,
                color: canDraft ? "rgba(12, 14, 20, 0.65)" : T.dim,
              }}>
                ⌘ Enter
              </span>
            )}
          </button>
        </div>
      </div>

      {error && <ErrorBlock message={error} />}

      {/* Starting points */}
      <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-10)" }}>
        <div style={{
          display: "flex", alignItems: "center", gap: "var(--space-8)",
          fontFamily: T.fontMono, fontSize: "var(--font-size-xs)", fontWeight: 500,
          letterSpacing: "0.12em", textTransform: "uppercase", color: T.dim,
        }}>
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 3l1.5 4.5L18 9l-4.5 1.5L12 15l-1.5-4.5L6 9l4.5-1.5L12 3z" />
          </svg>
          Or try a starting point
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: "var(--space-10)" }}>
          {STARTING_POINTS.map((sp) => (
            <button
              key={sp.label}
              type="button"
              onClick={() => setPrompt(sp.prompt)}
              style={{
                display: "inline-flex", alignItems: "center", gap: "var(--space-10)",
                padding: "8px 14px", borderRadius: "var(--radius-pill)",
                border: `1px solid ${T.border}`, background: T.panel,
                fontFamily: T.fontBody, fontSize: "var(--font-size-md)", color: T.muted,
                cursor: "pointer", textAlign: "left",
                maxWidth: 480,
              }}
            >
              <span style={{
                fontFamily: T.fontMono, fontSize: "var(--font-size-xs)", fontWeight: 500,
                letterSpacing: "0.08em", textTransform: "uppercase",
                color: sp.color,
              }}>
                {sp.label}
              </span>
              <span style={{
                overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                maxWidth: 360,
              }}>
                {sp.prompt.split(".")[0]}
              </span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

/* ── Review phase ─────────────────────────────────────────── */

function ReviewPhase({
  prompt, draft, setDraft, onBack, onCreate, creating, error,
}: {
  prompt: string;
  draft: WorldDraft;
  setDraft: (d: WorldDraft) => void;
  onBack: () => void;
  onCreate: () => void;
  creating: boolean;
  error: string | null;
}) {
  const canCreate =
    draft.title.trim().length > 0 &&
    draft.slug.trim().length > 0 &&
    draft.setting.trim().length > 0 &&
    draft.premise.trim().length > 0 &&
    draft.introNarration.trim().length > 0 &&
    !creating;

  return (
    <div style={{
      display: "grid", gridTemplateColumns: "minmax(0, 760px) minmax(0, 1fr)",
      gap: "var(--space-32)", paddingTop: "var(--space-24)", fontFamily: T.fontBody,
    }}>
      {/* Form column */}
      <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-20)" }}>
        {/* Prompt recap */}
        <div style={{
          display: "flex", flexDirection: "column", gap: "var(--space-12)",
          padding: "18px 20px", borderRadius: "var(--radius-xl)",
          background: T.panel, border: `1px solid ${T.border}`,
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: "var(--space-10)" }}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke={T.accent} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
              <path d="M12 3l1.5 4.5L18 9l-4.5 1.5L12 15l-1.5-4.5L6 9l4.5-1.5L12 3z" />
            </svg>
            <div style={{
              fontFamily: T.fontMono, fontSize: "var(--font-size-xs)", fontWeight: 500,
              letterSpacing: "0.12em", textTransform: "uppercase", color: T.dim,
            }}>
              Your prompt
            </div>
            <div style={{ flex: 1 }} />
            <button
              type="button"
              onClick={onBack}
              style={{
                display: "inline-flex", alignItems: "center", gap: "var(--space-6)",
                padding: "5px 10px", borderRadius: "var(--radius-sm)",
                border: `1px solid ${T.border}`, background: "transparent",
                fontFamily: T.fontBody, fontSize: "var(--font-size-sm)", fontWeight: 500, color: T.muted,
                cursor: "pointer",
              }}
            >
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M3 12a9 9 0 0 1 15-6.7L21 8" /><path d="M21 3v5h-5" />
              </svg>
              Edit prompt
            </button>
          </div>
          <div style={{
            fontFamily: T.fontBody, fontSize: "var(--font-size-md)", lineHeight: "20px", color: T.muted,
          }}>
            {prompt}
          </div>
        </div>

        {/* Drafted fields */}
        <div style={{
          display: "flex", flexDirection: "column",
          padding: "var(--space-24)", borderRadius: "var(--radius-xl)",
          background: T.panel, border: `1px solid ${T.border}`,
        }}>
          <div style={{
            display: "flex", alignItems: "center", gap: "var(--space-10)",
            paddingBottom: "var(--space-18)", borderBottom: `1px solid ${T.border}`,
          }}>
            <span style={{
              display: "inline-flex", alignItems: "center", gap: "var(--space-6)",
              padding: "3px 8px 3px 7px", borderRadius: "var(--radius-pill)",
              background: "rgba(143, 209, 203, 0.10)",
              border: "1px solid rgba(143, 209, 203, 0.25)",
            }}>
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke={T.accent} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 3l1.5 4.5L18 9l-4.5 1.5L12 15l-1.5-4.5L6 9l4.5-1.5L12 3z" />
              </svg>
              <span style={{
                fontFamily: T.fontMono, fontSize: "var(--font-size-2xs)", fontWeight: 500,
                letterSpacing: "0.12em", textTransform: "uppercase", color: T.accent,
              }}>
                Drafted
              </span>
            </span>
            <span style={{ fontFamily: T.fontBody, fontSize: "var(--font-size-md)", color: T.muted }}>
              Odyssey drafted 4 fields. Edit any value inline, then create the world.
            </span>
          </div>

          <FieldRow label="Title" bordered={false}>
            <input
              type="text"
              value={draft.title}
              onChange={(e) => setDraft({ ...draft, title: e.target.value })}
              style={{
                ...titleInputStyle,
                border: `1px solid rgba(143, 209, 203, 0.35)`,
                background: "rgba(143, 209, 203, 0.04)",
                boxShadow: "0 0 0 3px rgba(143, 209, 203, 0.06)",
              }}
            />
            <div style={{
              display: "flex", alignItems: "center", gap: "var(--space-8)", paddingTop: "var(--space-6)",
            }}>
              <span style={{ fontFamily: T.fontMono, fontSize: "var(--font-size-xs)", color: T.dim }}>SLUG</span>
              <input
                type="text"
                value={draft.slug}
                onChange={(e) => setDraft({ ...draft, slug: e.target.value })}
                style={{
                  flex: 1, border: "none", outline: "none",
                  padding: 0, background: "transparent",
                  fontFamily: T.fontMono, fontSize: "var(--font-size-sm)", color: T.muted,
                }}
              />
            </div>
          </FieldRow>

          <FieldRow label="Setting">
            <TextArea
              value={draft.setting}
              onChange={(v) => setDraft({ ...draft, setting: v })}
              rows={2}
            />
          </FieldRow>

          <FieldRow label="Premise">
            <TextArea
              value={draft.premise}
              onChange={(v) => setDraft({ ...draft, premise: v })}
              rows={3}
            />
          </FieldRow>

          <FieldRow label="Intro narration" last>
            <TextArea
              value={draft.introNarration}
              onChange={(v) => setDraft({ ...draft, introNarration: v })}
              rows={2}
              italic
            />
          </FieldRow>
        </div>

        {error && <ErrorBlock message={error} />}

        {/* Action bar */}
        <div style={{
          display: "flex", alignItems: "center", gap: "var(--space-12)", paddingTop: "var(--space-4)",
        }}>
          <div style={{ flex: 1 }} />
          <button
            type="button"
            disabled={!canCreate}
            onClick={onCreate}
            style={{
              display: "inline-flex", alignItems: "center", gap: "var(--space-10)",
              padding: "10px 18px", borderRadius: "var(--radius-md)",
              background: canCreate ? T.accent : "var(--card-hover)",
              color: canCreate ? "#0C0E14" : T.muted, border: "none",
              fontFamily: T.fontBody, fontSize: "var(--font-size-md)", fontWeight: 600,
              cursor: canCreate ? "pointer" : "not-allowed",
            }}
          >
            {creating ? "Creating…" : "Create world"}
            {!creating && (
              <span style={{
                display: "inline-flex", alignItems: "center", gap: "var(--space-2)",
                padding: "2px 5px", borderRadius: "var(--radius-xs)",
                background: "rgba(12, 14, 20, 0.15)",
                fontFamily: T.fontMono, fontSize: "var(--font-size-xs)", fontWeight: 500,
                color: canCreate ? "rgba(12, 14, 20, 0.65)" : T.dim,
              }}>
                ⌘ Enter
              </span>
            )}
          </button>
        </div>
      </div>

      {/* Preview column */}
      <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-16)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "var(--space-8)" }}>
          <span style={{
            fontFamily: T.fontMono, fontSize: "var(--font-size-xs)", fontWeight: 500,
            letterSpacing: "0.12em", textTransform: "uppercase", color: T.dim,
          }}>
            Live preview
          </span>
          <div style={{ flex: 1, height: 1, background: T.border }} />
        </div>

        <div style={{
          display: "flex", flexDirection: "column",
          borderRadius: "var(--radius-3xl)", border: `1px solid ${T.border}`,
          background: T.panel, overflow: "hidden",
        }}>
          <div style={{
            height: 180, padding: "20px", display: "flex", alignItems: "flex-end",
            background: "linear-gradient(135deg, #2B3848 0%, #1A2230 50%, #0F1520 100%)",
          }}>
            <span style={{
              display: "inline-flex", alignItems: "center", gap: "var(--space-6)",
              padding: "4px 10px", borderRadius: "var(--radius-pill)",
              background: "rgba(245, 198, 122, 0.14)",
              border: "1px solid rgba(245, 198, 122, 0.3)",
            }}>
              <span style={{ width: 6, height: 6, borderRadius: "var(--radius-pill)", background: "#F5C67A" }} />
              <span style={{
                fontFamily: T.fontMono, fontSize: "var(--font-size-xs)", fontWeight: 500,
                letterSpacing: "0.12em", textTransform: "uppercase", color: "#F5C67A",
              }}>
                Draft
              </span>
            </span>
          </div>
          <div style={{ padding: "var(--space-20)", display: "flex", flexDirection: "column", gap: "var(--space-12)" }}>
            <div style={{
              fontFamily: T.fontHeading, fontSize: "var(--font-size-3xl)", fontWeight: 600,
              letterSpacing: "-0.02em", color: T.fg,
            }}>
              {draft.title || "Untitled world"}
            </div>
            <div style={{
              fontFamily: T.fontBody, fontSize: "var(--font-size-md)", lineHeight: "20px", color: T.muted,
            }}>
              {draft.setting || "—"}
            </div>
          </div>
        </div>

        <div style={{
          display: "flex", flexDirection: "column", gap: "var(--space-6)",
          padding: "14px 16px", borderRadius: "var(--radius-lg)",
          background: "rgba(143, 209, 203, 0.04)",
          border: "1px solid rgba(143, 209, 203, 0.15)",
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: "var(--space-8)" }}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke={T.accent} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 3l1.5 4.5L18 9l-4.5 1.5L12 15l-1.5-4.5L6 9l4.5-1.5L12 3z" />
            </svg>
            <div style={{
              fontFamily: T.fontMono, fontSize: "var(--font-size-xs)", fontWeight: 500,
              letterSpacing: "0.12em", textTransform: "uppercase", color: T.accent,
            }}>
              After create
            </div>
          </div>
          <div style={{
            fontFamily: T.fontBody, fontSize: "var(--font-size-base)", lineHeight: "18px", color: T.muted,
          }}>
            You&rsquo;ll land on the world page where you can add characters, roles, and event templates.
          </div>
        </div>
      </div>
    </div>
  );
}

/* ── Small components ─────────────────────────────────────── */

function FieldRow({
  label, children, last, bordered = true,
}: {
  label: string;
  children: React.ReactNode;
  last?: boolean;
  bordered?: boolean;
}) {
  return (
    <div style={{
      display: "flex", flexDirection: "column", gap: "var(--space-8)",
      padding: "20px 0",
      borderBottom: last || !bordered ? "none" : `1px solid ${T.border}`,
    }}>
      <div style={{
        fontFamily: T.fontMono, fontSize: "var(--font-size-xs)", fontWeight: 500,
        letterSpacing: "0.12em", textTransform: "uppercase", color: T.dim,
      }}>
        {label}
      </div>
      {children}
    </div>
  );
}

function TextArea({
  value, onChange, rows, italic,
}: {
  value: string;
  onChange: (v: string) => void;
  rows: number;
  italic?: boolean;
}) {
  return (
    <textarea
      value={value}
      onChange={(e) => onChange(e.target.value)}
      rows={rows}
      style={{
        width: "100%", padding: "12px 14px", borderRadius: "var(--radius-md)",
        border: `1px solid ${T.border}`, background: "rgba(255, 255, 255, 0.015)",
        color: T.fg, fontFamily: T.fontBody, fontSize: "var(--font-size-lg)", lineHeight: "22px",
        fontStyle: italic ? "italic" : "normal",
        outline: "none", resize: "vertical", boxSizing: "border-box",
      }}
    />
  );
}

const titleInputStyle: React.CSSProperties = {
  width: "100%", padding: "10px 12px", borderRadius: "var(--radius-md)",
  border: `1px solid ${T.border}`, background: "rgba(255, 255, 255, 0.015)",
  color: T.fg, outline: "none",
  fontFamily: T.fontHeading, fontSize: "var(--font-size-3xl)", fontWeight: 600,
  letterSpacing: "-0.02em", boxSizing: "border-box",
};

function ErrorBlock({ message }: { message: string }) {
  return (
    <div style={{
      padding: "10px 14px", borderRadius: "var(--radius-lg)",
      background: "rgba(248, 113, 113, 0.08)",
      border: "1px solid rgba(248, 113, 113, 0.3)",
      color: "#F87171", fontFamily: T.fontBody, fontSize: "var(--font-size-md)",
    }}>
      {message}
    </div>
  );
}
