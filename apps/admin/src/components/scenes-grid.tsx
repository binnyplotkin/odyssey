"use client";

import { useCallback, useEffect, useMemo, useState, useTransition } from "react";
import type { CSSProperties, FormEvent, KeyboardEvent } from "react";
import { useRouter } from "next/navigation";
import type { SceneSummary } from "@/app/(authenticated)/scenes/page";
import { createScene } from "@/app/(authenticated)/scenes/actions";
import { useHeaderContent } from "@/components/header-context";
import { SortMenu } from "@/components/sort-menu";

const FONT_HEAD = "'Inter', system-ui, sans-serif";
const FONT_MONO = "'JetBrains Mono', ui-monospace, monospace";
const ACCENT = "var(--accent-strong)";

type SortKey = "recent" | "title" | "cast";

const SORT_OPTIONS: { key: SortKey; label: string }[] = [
  { key: "recent", label: "Recently updated" },
  { key: "title", label: "Title A-Z" },
  { key: "cast", label: "Cast size" },
];

const STATUS_COLORS: Record<SceneSummary["status"], string> = {
  active: "var(--accent-strong)",
  draft: "var(--status-draft)",
  archived: "var(--text-tertiary)",
};

export function ScenesGrid({ scenes }: { scenes: SceneSummary[] }) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<SortKey>("recent");
  const [creating, setCreating] = useState(false);
  const [title, setTitle] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const handleNewSceneClick = useCallback(() => {
    setCreating((open) => !open);
    setError(null);
  }, []);

  const submit = useCallback(
    (event?: FormEvent) => {
      event?.preventDefault();
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
    },
    [title],
  );

  const visible = useMemo(
    () => scenes.filter((scene) => scene.status !== "archived"),
    [scenes],
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const base = q
      ? visible.filter(
          (scene) =>
            scene.title.toLowerCase().includes(q) ||
            scene.prompt.toLowerCase().includes(q) ||
            (scene.openingBeat ?? "").toLowerCase().includes(q),
        )
      : visible;
    return applySort(base, sort);
  }, [query, sort, visible]);

  const { setContent, setFlush } = useHeaderContent();
  useEffect(() => {
    setFlush(true);
    setContent(
      <div
        style={{
          height: "100%",
          flex: 1,
          minWidth: 0,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: "var(--space-8)",
        }}
      >
        <span
          style={{
            fontFamily: FONT_MONO,
            fontSize: "var(--font-size-sm)",
            letterSpacing: "0.18em",
            textTransform: "uppercase",
            color: "var(--text-tertiary)",
            whiteSpace: "nowrap",
          }}
        >
          SCENES
        </span>
        <div style={{ display: "inline-flex", alignItems: "center", gap: "var(--space-8)" }}>
          <RefreshButton />
          <button
            type="button"
            onClick={handleNewSceneClick}
            style={headerButtonStyle}
            disabled={pending}
          >
            {creating ? "close" : "+ new scene"}
          </button>
        </div>
      </div>,
    );
    return () => {
      setContent(null);
      setFlush(false);
    };
  }, [creating, handleNewSceneClick, pending, setContent, setFlush]);

  if (visible.length === 0) {
    return (
      <div
        style={{
          minHeight: "100%",
          background: "var(--background)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: "5rem 2rem",
        }}
      >
        <div
          style={{
            width: "min(560px, 100%)",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: "var(--space-18)",
            textAlign: "center",
          }}
        >
          <span
            style={{
              fontFamily: FONT_MONO,
              fontSize: "var(--font-size-sm)",
              letterSpacing: "0.18em",
              textTransform: "uppercase",
              color: ACCENT,
            }}
          >
            scenes empty
          </span>
          <h2
            style={{
              fontFamily: FONT_HEAD,
              fontSize: 36,
              fontWeight: 600,
              margin: 0,
              color: "var(--text-primary)",
            }}
          >
            No scenes yet
          </h2>
          <p
            style={{
              fontFamily: FONT_HEAD,
              fontSize: "var(--font-size-lg)",
              lineHeight: "24px",
              color: "var(--text-secondary)",
              margin: 0,
            }}
          >
            Create a scene to stage characters, opening beats, narration, and
            rehearsal runs from one workspace.
          </p>
          {creating ? (
            <CreateScenePanel
              title={title}
              error={error}
              pending={pending}
              onTitleChange={setTitle}
              onSubmit={submit}
              onCancel={() => setCreating(false)}
            />
          ) : (
            <button
              type="button"
              onClick={handleNewSceneClick}
              style={{ ...primaryButtonStyle, minHeight: 44 }}
            >
              + create your first scene
            </button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div
      style={{
        minHeight: "100%",
        background: "var(--background)",
        display: "flex",
        flexDirection: "column",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: "var(--space-16)",
          flexWrap: "wrap",
          padding: "24px 40px",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "var(--space-12)",
            flex: "1 1 420px",
            minWidth: 0,
          }}
        >
          <div
            style={{
              position: "relative",
              flex: "0 1 360px",
              minWidth: 240,
            }}
          >
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden
              style={{
                position: "absolute",
                left: 14,
                top: "50%",
                transform: "translateY(-50%)",
                color: "var(--text-tertiary)",
                pointerEvents: "none",
              }}
            >
              <circle cx="11" cy="11" r="8" />
              <path d="m21 21-4.3-4.3" />
            </svg>
            <input
              value={query}
              placeholder="Search scenes..."
              onChange={(event) => setQuery(event.target.value)}
              style={searchInputStyle}
            />
          </div>
          <span
            style={{
              fontFamily: FONT_MONO,
              fontSize: "var(--font-size-sm)",
              letterSpacing: "0.10em",
              textTransform: "uppercase",
              color: "var(--text-tertiary)",
              whiteSpace: "nowrap",
            }}
          >
            showing {filtered.length} of {visible.length}
          </span>
        </div>
        <SortMenu options={SORT_OPTIONS} sort={sort} onChange={setSort} />
      </div>

      {creating && (
        <div style={{ padding: "0 40px 24px" }}>
          <CreateScenePanel
            title={title}
            error={error}
            pending={pending}
            onTitleChange={setTitle}
            onSubmit={submit}
            onCancel={() => setCreating(false)}
          />
        </div>
      )}

      {filtered.length === 0 ? (
        <NoResults query={query} />
      ) : (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(360px, 1fr))",
            gap: "var(--space-16)",
            padding: "0 40px 56px",
          }}
        >
          {filtered.map((scene) => (
            <SceneCard key={scene.id} scene={scene} />
          ))}
        </div>
      )}
    </div>
  );
}

function applySort(list: SceneSummary[], sort: SortKey): SceneSummary[] {
  const base = [...list];
  if (sort === "title") {
    return base.sort((a, b) => a.title.localeCompare(b.title));
  }
  if (sort === "cast") {
    return base.sort((a, b) => b.characterCount - a.characterCount);
  }
  return base.sort(
    (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
  );
}

function RefreshButton() {
  const router = useRouter();
  return (
    <button
      type="button"
      aria-label="Refresh scenes"
      title="Refresh"
      onClick={() => router.refresh()}
      style={{
        width: 36,
        height: 36,
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        border: "1px solid var(--control-border)",
        borderRadius: "var(--radius-pill)",
        background: "var(--control-bg)",
        color: "var(--text-secondary)",
        cursor: "pointer",
      }}
    >
      <svg
        width="15"
        height="15"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden
      >
        <path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16" />
        <path d="M3 21v-5h5" />
        <path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8" />
        <path d="M16 8h5V3" />
      </svg>
    </button>
  );
}

function CreateScenePanel({
  title,
  error,
  pending,
  onTitleChange,
  onSubmit,
  onCancel,
}: {
  title: string;
  error: string | null;
  pending: boolean;
  onTitleChange: (next: string) => void;
  onSubmit: (event?: FormEvent) => void;
  onCancel: () => void;
}) {
  return (
    <form
      onSubmit={onSubmit}
      style={{
        width: "min(560px, 100%)",
        display: "flex",
        flexDirection: "column",
        gap: "var(--space-12)",
        padding: "var(--space-18)",
        border: "1px solid var(--border-subtle)",
        borderRadius: "var(--radius-xl)",
        background: "var(--material-card)",
      }}
    >
      <input
        autoFocus
        value={title}
        placeholder="Scene title"
        onChange={(event) => onTitleChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Escape") onCancel();
        }}
        style={textInputStyle}
      />
      {error && (
        <span
          style={{
            color: "var(--status-error)",
            fontFamily: FONT_HEAD,
            fontSize: "var(--font-size-sm)",
          }}
        >
          {error}
        </span>
      )}
      <div style={{ display: "flex", gap: "var(--space-8)", flexWrap: "wrap" }}>
        <button type="submit" disabled={pending} style={primaryButtonStyle}>
          {pending ? "Creating..." : "Create"}
        </button>
        <button type="button" onClick={onCancel} style={secondaryButtonStyle}>
          Cancel
        </button>
      </div>
    </form>
  );
}

function SceneCard({ scene }: { scene: SceneSummary }) {
  const router = useRouter();
  const [hovered, setHovered] = useState(false);
  const path = `/scenes/${scene.id}`;
  const description =
    scene.openingBeat?.trim() || scene.prompt.trim() || "No opening beat set.";

  const openScene = () => router.push(path);
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      openScene();
    }
  };

  return (
    <div
      role="link"
      tabIndex={0}
      onClick={openScene}
      onKeyDown={onKeyDown}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        minHeight: 280,
        padding: "var(--space-18)",
        borderRadius: "var(--radius-2xl)",
        border: hovered
          ? "1px solid color-mix(in srgb, var(--accent-strong) 42%, var(--border-subtle))"
          : "1px solid var(--border-subtle)",
        background: "var(--material-card)",
        boxShadow: hovered ? "0 18px 50px var(--shadow)" : "none",
        cursor: "pointer",
        display: "flex",
        flexDirection: "column",
        gap: "var(--space-14)",
        transition: "border-color 160ms ease, box-shadow 160ms ease, transform 160ms ease",
        transform: hovered ? "translateY(-1px)" : "translateY(0)",
        outline: "none",
      }}
    >
      <div style={{ display: "flex", gap: "var(--space-14)", minWidth: 0 }}>
        <SceneGlyph scene={scene} />
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: "var(--space-6)",
            minWidth: 0,
            flex: 1,
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "flex-start",
              justifyContent: "space-between",
              gap: "var(--space-10)",
            }}
          >
            <h3
              style={{
                margin: 0,
                color: "var(--text-primary)",
                fontFamily: FONT_HEAD,
                fontSize: "var(--font-size-xl)",
                fontWeight: 600,
                lineHeight: "24px",
                overflowWrap: "anywhere",
              }}
            >
              {scene.title}
            </h3>
            <StatusDot status={scene.status} />
          </div>
          <span
            style={{
              color: "var(--text-tertiary)",
              fontFamily: FONT_MONO,
              fontSize: "var(--font-size-xs)",
              letterSpacing: "0.10em",
              textTransform: "uppercase",
            }}
          >
            updated {formatShortDate(scene.updatedAt)}
          </span>
        </div>
      </div>

      <p
        style={{
          margin: 0,
          color: "var(--text-secondary)",
          fontFamily: FONT_HEAD,
          fontSize: "var(--font-size-base)",
          lineHeight: "20px",
          display: "-webkit-box",
          WebkitLineClamp: 4,
          WebkitBoxOrient: "vertical",
          overflow: "hidden",
        }}
      >
        {description}
      </p>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
          gap: "var(--space-8)",
          marginTop: "auto",
        }}
      >
        <SceneStat
          label="cast"
          value={`${scene.characterCount}`}
          detail={scene.characterCount === 1 ? "character" : "characters"}
        />
        <SceneStat label="state" value={scene.status} detail="scene" />
        <SceneStat
          label="beat"
          value={scene.openingBeat ? "set" : "empty"}
          detail="opening"
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
            display: "inline-flex",
            alignItems: "center",
            gap: "var(--space-8)",
            color: STATUS_COLORS[scene.status],
            fontFamily: FONT_MONO,
            fontSize: "var(--font-size-sm)",
            letterSpacing: "0.12em",
            textTransform: "uppercase",
          }}
        >
          <span
            aria-hidden
            style={{
              width: 6,
              height: 6,
              borderRadius: "50%",
              background: "currentColor",
            }}
          />
          {scene.status}
        </span>
        <button
          type="button"
          aria-label={`Open ${scene.title}`}
          title="Open scene"
          onClick={(event) => {
            event.stopPropagation();
            openScene();
          }}
          style={iconButtonStyle}
        >
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden
          >
            <path d="M7 17 17 7" />
            <path d="M7 7h10v10" />
          </svg>
        </button>
      </div>
    </div>
  );
}

function SceneGlyph({ scene }: { scene: SceneSummary }) {
  const hue = hueFromString(`${scene.id}:${scene.title}`);
  return (
    <div
      aria-hidden
      style={{
        flex: "0 0 54px",
        width: 54,
        height: 54,
        borderRadius: "var(--radius-xl)",
        border: "1px solid var(--border-subtle)",
        background: [
          `linear-gradient(135deg, hsl(${hue} 54% 42% / 0.95), hsl(${(hue + 54) % 360} 48% 28% / 0.95))`,
          "radial-gradient(circle at 28% 28%, rgb(255 255 255 / 0.24), transparent 34%)",
        ].join(", "),
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        color: "white",
      }}
    >
      <svg
        width="24"
        height="24"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M4 5h16" />
        <path d="M5 9h14" />
        <path d="M7 13h10" />
        <path d="M9 17h6" />
      </svg>
    </div>
  );
}

function SceneStat({
  label,
  value,
  detail,
}: {
  label: string;
  value: string;
  detail: string;
}) {
  return (
    <div
      style={{
        minWidth: 0,
        padding: "10px 12px",
        borderRadius: "var(--radius-lg)",
        border: "1px solid var(--border-subtle)",
        background: "color-mix(in srgb, var(--text-primary) 4%, transparent)",
        display: "flex",
        flexDirection: "column",
        gap: "var(--space-4)",
      }}
    >
      <span
        style={{
          color: "var(--text-tertiary)",
          fontFamily: FONT_MONO,
          fontSize: "var(--font-size-2xs)",
          letterSpacing: "0.14em",
          textTransform: "uppercase",
        }}
      >
        {label}
      </span>
      <span
        style={{
          color: "var(--text-primary)",
          fontFamily: FONT_HEAD,
          fontSize: "var(--font-size-md)",
          fontWeight: 600,
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
      >
        {value}
      </span>
      <span
        style={{
          color: "var(--text-tertiary)",
          fontFamily: FONT_HEAD,
          fontSize: "var(--font-size-xs)",
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
      >
        {detail}
      </span>
    </div>
  );
}

function StatusDot({ status }: { status: SceneSummary["status"] }) {
  return (
    <span
      title={status}
      aria-label={status}
      style={{
        flex: "0 0 auto",
        width: 10,
        height: 10,
        marginTop: 7,
        borderRadius: "50%",
        background: STATUS_COLORS[status],
        boxShadow: `0 0 0 4px color-mix(in srgb, ${STATUS_COLORS[status]} 16%, transparent)`,
      }}
    />
  );
}

function NoResults({ query }: { query: string }) {
  return (
    <div
      style={{
        padding: "80px 40px",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: "var(--space-8)",
        color: "var(--text-secondary)",
        fontFamily: FONT_HEAD,
      }}
    >
      <span
        style={{
          fontFamily: FONT_MONO,
          fontSize: "var(--font-size-sm)",
          letterSpacing: "0.14em",
          textTransform: "uppercase",
          color: "var(--text-tertiary)",
        }}
      >
        no matches
      </span>
      <p style={{ margin: 0 }}>
        No scenes match {query.trim() ? `"${query.trim()}"` : "the current filter"}.
      </p>
    </div>
  );
}

function hueFromString(value: string): number {
  let hash = 0;
  for (let i = 0; i < value.length; i += 1) {
    hash = (hash * 31 + value.charCodeAt(i)) % 360;
  }
  return hash;
}

function formatShortDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "unknown";
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
  }).format(date);
}

const headerButtonStyle: CSSProperties = {
  height: 36,
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  padding: "0 14px",
  border: "1px solid color-mix(in srgb, var(--accent-strong) 44%, transparent)",
  borderRadius: "var(--radius-pill)",
  background: "color-mix(in srgb, var(--accent-strong) 14%, transparent)",
  color: ACCENT,
  fontFamily: FONT_MONO,
  fontSize: "var(--font-size-sm)",
  letterSpacing: "0.10em",
  textTransform: "uppercase",
  cursor: "pointer",
};

const primaryButtonStyle: CSSProperties = {
  minHeight: 38,
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  padding: "0 16px",
  border: "1px solid color-mix(in srgb, var(--accent-strong) 44%, transparent)",
  borderRadius: "var(--radius-pill)",
  background: "color-mix(in srgb, var(--accent-strong) 16%, transparent)",
  color: ACCENT,
  fontFamily: FONT_MONO,
  fontSize: "var(--font-size-sm)",
  letterSpacing: "0.10em",
  textTransform: "uppercase",
  cursor: "pointer",
};

const secondaryButtonStyle: CSSProperties = {
  minHeight: 38,
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  padding: "0 16px",
  border: "1px solid var(--control-border)",
  borderRadius: "var(--radius-pill)",
  background: "var(--control-bg)",
  color: "var(--text-secondary)",
  fontFamily: FONT_MONO,
  fontSize: "var(--font-size-sm)",
  letterSpacing: "0.10em",
  textTransform: "uppercase",
  cursor: "pointer",
};

const iconButtonStyle: CSSProperties = {
  flex: "0 0 auto",
  width: 34,
  height: 34,
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  border: "1px solid var(--control-border)",
  borderRadius: "var(--radius-pill)",
  background: "var(--control-bg)",
  color: "var(--text-secondary)",
  cursor: "pointer",
};

const searchInputStyle: CSSProperties = {
  width: "100%",
  height: 38,
  padding: "0 14px 0 42px",
  border: "1px solid var(--control-border)",
  borderRadius: "var(--radius-pill)",
  background: "var(--control-bg)",
  color: "var(--text-primary)",
  fontFamily: FONT_HEAD,
  fontSize: "var(--font-size-base)",
  outline: "none",
};

const textInputStyle: CSSProperties = {
  height: 40,
  padding: "0 12px",
  border: "1px solid var(--control-border)",
  borderRadius: "var(--radius-md)",
  background: "var(--control-bg)",
  color: "var(--text-primary)",
  fontFamily: FONT_HEAD,
  fontSize: "var(--font-size-base)",
  outline: "none",
};
