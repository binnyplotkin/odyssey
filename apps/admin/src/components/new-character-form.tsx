"use client";

import Link from "next/link";
import { useEffect, useState, useTransition } from "react";
import type { EraConfig } from "@odyssey/db";
import { useHeaderContent } from "@/components/header-context";
import { createCharacter } from "@/app/(authenticated)/characters/actions";
import { EraEditor } from "@/components/era-editor";

const T = {
  fg: "var(--foreground)",
  muted: "var(--text-tertiary)",
  panel: "var(--surface-1)",
  border: "var(--border)",
  accent: "var(--accent-strong)",
  accentSoft: "var(--accent-soft)",
  fontHeading: "'Space Grotesk', sans-serif",
  fontBody: "'Inter', sans-serif",
  fontMono: "var(--font-mono, 'JetBrains Mono', monospace)",
};

function slugify(s: string): string {
  return s
    .toLowerCase()
    .trim()
    .replace(/['']/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
}

export function NewCharacterForm() {
  const [title, setTitle] = useState("");
  const [slug, setSlug] = useState("");
  const [slugTouched, setSlugTouched] = useState(false);
  const [summary, setSummary] = useState("");
  const [brief, setBrief] = useState("");
  const [ingestionPrompt, setIngestionPrompt] = useState("");
  const [eras, setEras] = useState<EraConfig[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  // Auto-derive slug from title until the user manually types in the slug field.
  useEffect(() => {
    if (!slugTouched) setSlug(slugify(title));
  }, [title, slugTouched]);

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
          href="/characters"
          style={{
            display: "flex", alignItems: "center", justifyContent: "center",
            width: 28, height: 28, borderRadius: "var(--radius-sm)",
            border: "1px solid var(--border)", background: "transparent",
            color: "var(--text-tertiary)", textDecoration: "none", marginRight: "var(--space-12)",
          }}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.25" strokeLinecap="round"><polyline points="15 18 9 12 15 6" /></svg>
        </Link>
        <h1 style={{
          fontSize: "var(--font-size-xl)", fontWeight: 700, color: T.fg,
          marginTop: 0, marginRight: "var(--space-12)", marginBottom: 0, marginLeft: 0,
          whiteSpace: "nowrap", fontFamily: T.fontHeading,
        }}>
          New Character
        </h1>
        <div style={{ flex: 1 }} />
      </div>,
    );
    return () => setContent(null);
  }, [setContent]);

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    start(async () => {
      const res = await createCharacter({ title, slug, summary, brief, ingestionPrompt, eras });
      if (!res.ok) setError(res.error);
      // On success the server action redirects; no further state needed.
    });
  }

  const canSubmit = title.trim().length > 0 && slug.trim().length > 0 && !pending;

  return (
    <form onSubmit={onSubmit} style={{ display: "flex", flexDirection: "column", gap: "var(--space-20)", maxWidth: 880 }}>
      <div style={{
        background: T.panel, border: `1px solid ${T.border}`,
        borderRadius: "var(--radius-2xl)", overflow: "clip",
      }}>
        <div style={{ padding: "16px 20px", borderBottom: "1px solid var(--border)" }}>
          <div style={{
            fontFamily: T.fontMono, fontSize: "var(--font-size-xs)", fontWeight: 500, color: T.muted,
            letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: "var(--space-4)",
          }}>
            Identity
          </div>
          <div style={{ fontFamily: T.fontBody, fontSize: "var(--font-size-base)", color: T.muted }}>
            The character is global — one record reused across any number of worlds.
          </div>
        </div>

        <div style={{ padding: "18px 20px", display: "flex", flexDirection: "column", gap: "var(--space-16)" }}>
          <Field label="Title" help="Human-facing. Renameable.">
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. Abraham"
              autoFocus
              style={inputStyle}
            />
          </Field>

          <Field label="Slug" help="Immutable identifier used in [[links]] and URLs. Lowercase kebab-case.">
            <input
              type="text"
              value={slug}
              onChange={(e) => { setSlug(e.target.value); setSlugTouched(true); }}
              placeholder="abraham"
              style={{ ...inputStyle, fontFamily: T.fontMono }}
            />
          </Field>

          <Field label="Summary" help="One-liner shown in lists." optional>
            <input
              type="text"
              value={summary}
              onChange={(e) => setSummary(e.target.value)}
              placeholder="e.g. The first patriarch"
              style={inputStyle}
            />
          </Field>
        </div>
      </div>

      <div style={{
        background: T.panel, border: `1px solid ${T.border}`,
        borderRadius: "var(--radius-2xl)", overflow: "clip",
      }}>
        <div style={{ padding: "16px 20px", borderBottom: "1px solid var(--border)" }}>
          <div style={{
            fontFamily: T.fontMono, fontSize: "var(--font-size-xs)", fontWeight: 500, color: T.muted,
            letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: "var(--space-4)",
          }}>
            Who is this character? · optional
          </div>
          <div style={{ fontFamily: T.fontBody, fontSize: "var(--font-size-base)", color: T.muted, lineHeight: 1.55 }}>
            Explain them in your own words — their world, what shaped them, what
            they care about. Seeds the generated ingestion prompt, so writing it
            here means you never have to hand-craft the prompt below.
          </div>
        </div>

        <textarea
          value={brief}
          onChange={(e) => setBrief(e.target.value)}
          placeholder="e.g. Abraham is the first patriarch of Genesis, called from Ur to Canaan on a divine promise. He is defined by covenant faith tested by long waiting — the promise of a son against decades of childlessness..."
          rows={6}
          style={{
            width: "100%", border: "none", outline: "none", resize: "vertical",
            padding: "16px 20px", background: "transparent",
            fontFamily: T.fontBody, fontSize: "var(--font-size-base)", color: T.fg, lineHeight: "22px",
            boxSizing: "border-box",
          }}
        />
      </div>

      <div style={{
        background: T.panel, border: `1px solid ${T.border}`,
        borderRadius: "var(--radius-2xl)", overflow: "clip",
      }}>
        <div style={{ padding: "16px 20px", borderBottom: "1px solid var(--border)" }}>
          <div style={{
            fontFamily: T.fontMono, fontSize: "var(--font-size-xs)", fontWeight: 500, color: T.muted,
            letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: "var(--space-4)",
          }}>
            Eras · optional
          </div>
          <div style={{ fontFamily: T.fontBody, fontSize: "var(--font-size-base)", color: T.muted, lineHeight: 1.55 }}>
            Named periods in the character's life, used for timeline-aware page filtering. Leave empty for timeless characters.
          </div>
        </div>
        <div style={{ padding: "14px 20px 18px 20px" }}>
          <EraEditor eras={eras} onChange={setEras} />
        </div>
      </div>

      <div style={{
        background: T.panel, border: `1px solid ${T.border}`,
        borderRadius: "var(--radius-2xl)", overflow: "clip",
      }}>
        <div style={{ padding: "16px 20px", borderBottom: "1px solid var(--border)" }}>
          <div style={{
            fontFamily: T.fontMono, fontSize: "var(--font-size-xs)", fontWeight: 500, color: "#8FD1CB",
            letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: "var(--space-4)",
          }}>
            Ingestion prompt · optional
          </div>
          <div style={{ fontFamily: T.fontBody, fontSize: "var(--font-size-base)", color: T.muted, lineHeight: 1.55 }}>
            The single domain knob. Injected into every compile run so the generic engine interprets sources through this character's tradition. You can skip this now and edit it later from the Overview tab.
          </div>
        </div>

        <textarea
          value={ingestionPrompt}
          onChange={(e) => setIngestionPrompt(e.target.value)}
          placeholder={placeholderPrompt}
          rows={10}
          style={{
            width: "100%", border: "none", outline: "none", resize: "vertical",
            padding: "16px 20px", background: "transparent",
            fontFamily: T.fontMono, fontSize: "var(--font-size-base)", color: T.fg, lineHeight: "20px",
            boxSizing: "border-box",
          }}
        />
      </div>

      {error && (
        <div style={{
          padding: "10px 14px", borderRadius: "var(--radius-lg)",
          background: "rgba(232,144,144,0.08)", border: "1px solid rgba(232,144,144,0.3)",
          color: "#E89090", fontFamily: T.fontBody, fontSize: "var(--font-size-md)",
        }}>
          {error}
        </div>
      )}

      <div style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", gap: "var(--space-10)" }}>
        <Link
          href="/characters"
          style={{
            padding: "8px 16px", borderRadius: "var(--radius-lg)",
            border: "1px solid var(--border)", background: "transparent",
            color: T.muted, textDecoration: "none",
            fontFamily: T.fontBody, fontSize: "var(--font-size-md)", cursor: "pointer",
          }}
        >
          Cancel
        </Link>
        <button
          type="submit"
          disabled={!canSubmit}
          style={{
            padding: "8px 20px", borderRadius: "var(--radius-lg)", border: "none",
            background: canSubmit ? T.accent : "var(--surface-hover)",
            color: canSubmit ? "var(--background)" : T.muted,
            fontFamily: T.fontBody, fontSize: "var(--font-size-md)", fontWeight: 600,
            cursor: canSubmit ? "pointer" : "not-allowed",
          }}
        >
          {pending ? "Creating…" : "Create character"}
        </button>
      </div>
    </form>
  );
}

const inputStyle: React.CSSProperties = {
  width: "100%", padding: "9px 12px", borderRadius: "var(--radius-md)",
  background: "var(--background)", border: "1px solid var(--border)",
  color: T.fg, outline: "none", fontFamily: T.fontBody, fontSize: "var(--font-size-md)",
  boxSizing: "border-box",
};

function Field({
  label, help, optional, children,
}: { label: string; help?: string; optional?: boolean; children: React.ReactNode }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-6)" }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: "var(--space-8)" }}>
        <span style={{
          fontFamily: T.fontMono, fontSize: "var(--font-size-xs)", fontWeight: 500, color: T.muted,
          letterSpacing: "0.08em", textTransform: "uppercase",
        }}>
          {label}{optional && " · optional"}
        </span>
        {help && (
          <span style={{ fontFamily: T.fontBody, fontSize: "var(--font-size-sm)", color: T.muted }}>{help}</span>
        )}
      </div>
      {children}
    </div>
  );
}

const placeholderPrompt = `You are compiling source material into <Name>'s knowledge graph.

<Name> is … (tradition, period, key themes).

Treat … as primary. Treat … as commentary.

Central entities to always link: …

Voice: …`;
