"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { SceneSummary } from "@/app/(authenticated)/scenes/page";
import { createScene } from "@/app/(authenticated)/scenes/actions";
import {
  AdminButton,
  AdminKicker,
  AdminPanel,
  AdminStatusPill,
  adminTokens,
  type AdminTone,
} from "@/components/admin-ui";

const STATUS_TONE: Record<SceneSummary["status"], AdminTone> = {
  active: "success",
  draft: "muted",
  archived: "default",
};

export function ScenesGrid({ scenes }: { scenes: SceneSummary[] }) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [creating, setCreating] = useState(false);
  const [title, setTitle] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const visible = scenes.filter((s) => s.status !== "archived");
    if (!q) return visible;
    return visible.filter(
      (s) =>
        s.title.toLowerCase().includes(q) ||
        (s.prompt ?? "").toLowerCase().includes(q),
    );
  }, [scenes, query]);

  function submit() {
    const trimmed = title.trim();
    if (!trimmed) {
      setError("Title is required.");
      return;
    }
    setError(null);
    start(async () => {
      const res = await createScene({ title: trimmed });
      if (!res.ok) setError(res.error);
      // On success the action redirects to /scenes/[id].
    });
  }

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: "var(--space-24)",
        padding: "var(--space-32) 40px 96px",
        background: adminTokens.bg,
        color: adminTokens.fg,
        fontFamily: adminTokens.fontBody,
        minHeight: "calc(100vh - 48px)",
      }}
    >
      <header
        style={{
          display: "flex",
          alignItems: "flex-end",
          justifyContent: "space-between",
          gap: "var(--space-16)",
        }}
      >
        <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-8)" }}>
          <AdminKicker>Studio</AdminKicker>
          <h1
            style={{
              margin: 0,
              fontFamily: adminTokens.fontDisplay,
              fontSize: "var(--font-size-3xl)",
              fontWeight: 600,
            }}
          >
            Scenes
          </h1>
        </div>
        <AdminButton variant="primary" onClick={() => setCreating((v) => !v)}>
          New scene
        </AdminButton>
      </header>

      {creating && (
        <AdminPanel style={{ display: "flex", flexDirection: "column", gap: "var(--space-12)" }}>
          <input
            autoFocus
            value={title}
            placeholder="Scene title (e.g. Abraham's Tent)"
            onChange={(e) => setTitle(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") submit();
              if (e.key === "Escape") setCreating(false);
            }}
            style={inputStyle}
          />
          {error && (
            <span style={{ color: adminTokens.danger, fontSize: "var(--font-size-sm)" }}>
              {error}
            </span>
          )}
          <div style={{ display: "flex", gap: "var(--space-8)" }}>
            <AdminButton variant="primary" onClick={submit} disabled={pending}>
              {pending ? "Creating…" : "Create"}
            </AdminButton>
            <AdminButton variant="ghost" onClick={() => setCreating(false)}>
              Cancel
            </AdminButton>
          </div>
        </AdminPanel>
      )}

      <input
        value={query}
        placeholder="Search scenes…"
        onChange={(e) => setQuery(e.target.value)}
        style={{ ...inputStyle, maxWidth: 360 }}
      />

      {filtered.length === 0 ? (
        <p style={{ color: adminTokens.muted }}>
          No scenes yet. Create one to start composing a multi-character scene.
        </p>
      ) : (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))",
            gap: "var(--space-16)",
          }}
        >
          {filtered.map((scene) => (
            <Link
              key={scene.id}
              href={`/scenes/${scene.id}`}
              style={{ textDecoration: "none", color: "inherit" }}
            >
              <AdminPanel
                interactive
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: "var(--space-10)",
                  minHeight: 132,
                  cursor: "pointer",
                }}
              >
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    gap: "var(--space-8)",
                  }}
                >
                  <span style={{ fontWeight: 600, fontSize: "var(--font-size-lg)" }}>
                    {scene.title}
                  </span>
                  <AdminStatusPill tone={STATUS_TONE[scene.status]} dot>
                    {scene.status}
                  </AdminStatusPill>
                </div>
                <p
                  style={{
                    margin: 0,
                    color: adminTokens.muted,
                    fontSize: "var(--font-size-sm)",
                    display: "-webkit-box",
                    WebkitLineClamp: 2,
                    WebkitBoxOrient: "vertical",
                    overflow: "hidden",
                  }}
                >
                  {scene.openingBeat || scene.prompt || "No opening beat set."}
                </p>
                <span
                  style={{
                    marginTop: "auto",
                    color: adminTokens.faded,
                    fontFamily: adminTokens.fontMono,
                    fontSize: "var(--font-size-xs)",
                    letterSpacing: "0.08em",
                  }}
                >
                  {scene.characterCount} character{scene.characterCount === 1 ? "" : "s"}
                </span>
              </AdminPanel>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

const inputStyle = {
  height: 36,
  padding: "0 12px",
  background: adminTokens.inputBg,
  border: `1px solid ${adminTokens.inputBorder}`,
  borderRadius: "var(--radius-md)",
  color: adminTokens.fg,
  fontFamily: adminTokens.fontBody,
  fontSize: "var(--font-size-base)",
  outline: "none",
} as const;
