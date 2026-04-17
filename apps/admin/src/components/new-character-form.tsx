"use client";

import Link from "next/link";
import { useEffect, useState, useTransition } from "react";
import { useHeaderContent } from "@/components/header-context";
import { createCharacter } from "@/app/(authenticated)/characters/actions";

const T = {
  fg: "var(--foreground)",
  muted: "var(--muted)",
  panel: "var(--panel)",
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
  const [ingestionPrompt, setIngestionPrompt] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  // Auto-derive slug from title until the user manually types in the slug field.
  useEffect(() => {
    if (!slugTouched) setSlug(slugify(title));
  }, [title, slugTouched]);

  const { setContent } = useHeaderContent();
  useEffect(() => {
    setContent(
      <>
        <Link
          href="/characters"
          style={{
            display: "flex", alignItems: "center", justifyContent: "center",
            width: 28, height: 28, borderRadius: 6,
            border: "1px solid var(--border)", background: "transparent",
            color: "var(--muted)", textDecoration: "none", marginRight: 12,
          }}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.25" strokeLinecap="round"><polyline points="15 18 9 12 15 6" /></svg>
        </Link>
        <h1 style={{
          fontSize: 16, fontWeight: 700, color: T.fg,
          marginTop: 0, marginRight: 12, marginBottom: 0, marginLeft: 0,
          whiteSpace: "nowrap", fontFamily: T.fontHeading,
        }}>
          New Character
        </h1>
        <div style={{ flex: 1 }} />
      </>,
    );
    return () => setContent(null);
  }, [setContent]);

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    start(async () => {
      const res = await createCharacter({ title, slug, summary, ingestionPrompt });
      if (!res.ok) setError(res.error);
      // On success the server action redirects; no further state needed.
    });
  }

  const canSubmit = title.trim().length > 0 && slug.trim().length > 0 && !pending;

  return (
    <form onSubmit={onSubmit} style={{ display: "flex", flexDirection: "column", gap: 20, maxWidth: 880 }}>
      <div style={{
        background: T.panel, border: `1px solid ${T.border}`,
        borderRadius: 14, overflow: "clip",
      }}>
        <div style={{ padding: "16px 20px", borderBottom: "1px solid var(--border)" }}>
          <div style={{
            fontFamily: T.fontMono, fontSize: 10, fontWeight: 500, color: T.muted,
            letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 4,
          }}>
            Identity
          </div>
          <div style={{ fontFamily: T.fontBody, fontSize: 12, color: T.muted }}>
            The character is global — one record reused across any number of worlds.
          </div>
        </div>

        <div style={{ padding: "18px 20px", display: "flex", flexDirection: "column", gap: 16 }}>
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

          <Field label="Slug" help="Immutable identifier used in wikilinks + URLs. Lowercase kebab-case.">
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
        borderRadius: 14, overflow: "clip",
      }}>
        <div style={{ padding: "16px 20px", borderBottom: "1px solid var(--border)" }}>
          <div style={{
            fontFamily: T.fontMono, fontSize: 10, fontWeight: 500, color: "#8CE7D2",
            letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 4,
          }}>
            Ingestion prompt · optional
          </div>
          <div style={{ fontFamily: T.fontBody, fontSize: 12, color: T.muted, lineHeight: 1.55 }}>
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
            fontFamily: T.fontMono, fontSize: 12, color: T.fg, lineHeight: "20px",
            boxSizing: "border-box",
          }}
        />
      </div>

      {error && (
        <div style={{
          padding: "10px 14px", borderRadius: 10,
          background: "rgba(232,144,144,0.08)", border: "1px solid rgba(232,144,144,0.3)",
          color: "#E89090", fontFamily: T.fontBody, fontSize: 13,
        }}>
          {error}
        </div>
      )}

      <div style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 10 }}>
        <Link
          href="/characters"
          style={{
            padding: "8px 16px", borderRadius: 10,
            border: "1px solid var(--border)", background: "transparent",
            color: T.muted, textDecoration: "none",
            fontFamily: T.fontBody, fontSize: 13, cursor: "pointer",
          }}
        >
          Cancel
        </Link>
        <button
          type="submit"
          disabled={!canSubmit}
          style={{
            padding: "8px 20px", borderRadius: 10, border: "none",
            background: canSubmit ? T.accent : "var(--card-hover)",
            color: canSubmit ? "var(--background)" : T.muted,
            fontFamily: T.fontBody, fontSize: 13, fontWeight: 600,
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
  width: "100%", padding: "9px 12px", borderRadius: 8,
  background: "var(--background)", border: "1px solid var(--border)",
  color: T.fg, outline: "none", fontFamily: T.fontBody, fontSize: 13,
  boxSizing: "border-box",
};

function Field({
  label, help, optional, children,
}: { label: string; help?: string; optional?: boolean; children: React.ReactNode }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
        <span style={{
          fontFamily: T.fontMono, fontSize: 10, fontWeight: 500, color: T.muted,
          letterSpacing: "0.08em", textTransform: "uppercase",
        }}>
          {label}{optional && " · optional"}
        </span>
        {help && (
          <span style={{ fontFamily: T.fontBody, fontSize: 11, color: T.muted }}>{help}</span>
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
