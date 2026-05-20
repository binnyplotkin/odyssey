"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useTransition,
} from "react";
import { useHeaderContent } from "@/components/header-context";
import { WikiTabBar, type WikiTabKey } from "./wiki-tab-bar";
import { updateWikiMeta } from "../actions";

const TEXT_MUTED = "var(--text-tertiary)";
const TEXT_FADED = "var(--text-placeholder)";
const TEXT_PRIMARY = "var(--text-primary)";
const BORDER = "var(--border)";
const ACCENT = "var(--accent-strong)";
const DANGER = "var(--danger)";
// Breadcrumb + title use the same mono face as the tab strip so the
// header reads as one cohesive terminal-style row.
const MONO = '"JetBrains Mono", monospace';

function activeTab(pathname: string, wikiId: string): WikiTabKey {
  const base = `/wikis/${wikiId}`;
  if (pathname === base) return "overview";
  if (pathname.startsWith(`${base}/wiki`)) return "pages";
  if (pathname.startsWith(`${base}/knowledge`)) return "knowledge";
  if (pathname.startsWith(`${base}/sources`)) return "sources";
  if (pathname.startsWith(`${base}/ingestion`)) return "ingestion";
  return "overview";
}

/**
 * Shared chrome for every /wikis/[id]/* route. Renders the wiki breadcrumb
 * on the left of the admin-shell header and the tab nav on the right. The
 * useEffect re-runs on pathname change so it wins against any child that
 * also calls setContent (effect order: child first, parent last).
 */
export function WikiChrome({
  wikiId,
  wikiTitle,
  children,
}: {
  wikiId: string;
  wikiTitle: string;
  children: React.ReactNode;
}) {
  const pathname = usePathname() ?? `/wikis/${wikiId}`;
  const { setContent, setFlush } = useHeaderContent();
  const tab = activeTab(pathname, wikiId);

  // Local override so optimistic renames show immediately and survive across
  // the revalidation round-trip. Reset whenever the wiki id changes.
  const [localTitle, setLocalTitle] = useState(wikiTitle);
  useEffect(() => {
    setLocalTitle(wikiTitle);
  }, [wikiId, wikiTitle]);

  useEffect(() => {
    setFlush(true);
    setContent(
      <WikiTopBar
        wikiId={wikiId}
        wikiTitle={localTitle}
        active={tab}
        onTitleChange={setLocalTitle}
      />,
    );
    return () => {
      setContent(null);
      setFlush(false);
    };
  }, [setContent, setFlush, wikiId, localTitle, pathname, tab]);

  return (
    <div
      style={{
        background: "var(--background)",
        color: "var(--text-primary)",
        fontFamily: '"Inter", system-ui, sans-serif',
        minHeight: "100%",
      }}
    >
      {children}
    </div>
  );
}

function WikiTopBar({
  wikiId,
  wikiTitle,
  active,
  onTitleChange,
}: {
  wikiId: string;
  wikiTitle: string;
  active: WikiTabKey;
  onTitleChange: (next: string) => void;
}) {
  return (
    <div
      style={{
        // Stretch children to fill the header's full inner height so the
        // TabBar's active border-bottom lands flush with the header edge.
        // Breadcrumb content stays visually centered via its own
        // alignItems: center on the inner row.
        display: "flex",
        alignItems: "stretch",
        justifyContent: "space-between",
        gap: 16,
        width: "100%",
        alignSelf: "stretch",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <Link
            href="/wikis"
            style={{
              fontFamily: MONO,
              fontSize: 13,
              color: TEXT_MUTED,
              textDecoration: "none",
            }}
          >
            wikis
          </Link>
          <span style={{ fontFamily: MONO, fontSize: 13, color: TEXT_FADED }}>
            /
          </span>
          <EditableTitle
            wikiId={wikiId}
            title={wikiTitle}
            onTitleChange={onTitleChange}
          />
        </div>
      </div>
      <WikiTabBar wikiId={wikiId} active={active} />
    </div>
  );
}

function EditableTitle({
  wikiId,
  title,
  onTitleChange,
}: {
  wikiId: string;
  title: string;
  onTitleChange: (next: string) => void;
}) {
  const [draft, setDraft] = useState(title);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [hovered, setHovered] = useState(false);
  const [pending, startTransition] = useTransition();
  const inputRef = useRef<HTMLInputElement | null>(null);
  const measureRef = useRef<HTMLSpanElement | null>(null);
  const [inputWidth, setInputWidth] = useState<number>(0);

  useEffect(() => {
    if (!editing) setDraft(title);
  }, [editing, title]);

  useEffect(() => {
    if (!editing) return;
    requestAnimationFrame(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    });
  }, [editing]);

  function startEditing() {
    setDraft(title);
    setError(null);
    setEditing(true);
  }

  function cancel() {
    setDraft(title);
    setError(null);
    setEditing(false);
  }

  function commit() {
    const next = draft.trim();
    if (!next) {
      setError("Title cannot be empty");
      return;
    }
    if (next === title) {
      setError(null);
      setEditing(false);
      return;
    }
    const previous = title;
    onTitleChange(next); // optimistic
    startTransition(async () => {
      const res = await updateWikiMeta(wikiId, { title: next });
      if (!res.ok) {
        onTitleChange(previous);
        setDraft(previous);
        setError(res.error);
        return;
      }
      onTitleChange(res.data?.title ?? next);
      setDraft(res.data?.title ?? next);
      setError(null);
      setEditing(false);
    });
  }

  useLayoutEffect(() => {
    if (measureRef.current) {
      setInputWidth(measureRef.current.offsetWidth + 18);
    }
  }, [draft, title]);

  return (
    <span
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        position: "relative",
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        minWidth: 0,
      }}
    >
      <span
        ref={measureRef}
        aria-hidden
        style={{
          position: "absolute",
          visibility: "hidden",
          whiteSpace: "pre",
          fontFamily: MONO,
          fontSize: 13,
          fontWeight: 600,
        }}
      >
        {(editing ? draft : title).toLowerCase() || " "}
      </span>
      {editing ? (
        <>
          <input
            ref={inputRef}
            value={draft}
            onChange={(e) => {
              setDraft(e.target.value);
              if (error) setError(null);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                if (!pending) commit();
              } else if (e.key === "Escape") {
                e.preventDefault();
                cancel();
              }
            }}
            disabled={pending}
            spellCheck={false}
            style={{
              width: Math.max(64, inputWidth),
              height: 28,
              padding: "0 8px",
              fontFamily: MONO,
              fontSize: 13,
              fontWeight: 600,
              color: TEXT_PRIMARY,
              background: "var(--card)",
              border: `1px solid ${error ? DANGER : BORDER}`,
              outline: "none",
              textTransform: "lowercase",
            }}
          />
          <IconButton
            label="Save wiki name"
            onClick={commit}
            disabled={pending}
            tone="confirm"
          >
            <CheckIcon />
          </IconButton>
          <IconButton
            label="Cancel wiki name edit"
            onClick={cancel}
            disabled={pending}
          >
            <XIcon />
          </IconButton>
        </>
      ) : (
        <>
          <span
            style={{
              fontFamily: MONO,
              fontSize: 13,
              fontWeight: 600,
              color: TEXT_PRIMARY,
              textTransform: "lowercase",
              whiteSpace: "nowrap",
            }}
          >
            {title}
          </span>
          <IconButton
            label="Edit wiki name"
            onClick={startEditing}
            style={{
              opacity: hovered ? 1 : 0,
              pointerEvents: hovered ? "auto" : "none",
            }}
          >
            <EditIcon />
          </IconButton>
        </>
      )}
      {error && (
        <span
          style={{
            fontFamily: MONO,
            fontSize: 11,
            color: DANGER,
          }}
        >
          {error}
        </span>
      )}
    </span>
  );
}

function IconButton({
  label,
  onClick,
  children,
  disabled,
  tone = "default",
  style,
}: {
  label: string;
  onClick: () => void;
  children: React.ReactNode;
  disabled?: boolean;
  tone?: "default" | "confirm";
  style?: React.CSSProperties;
}) {
  const [hovered, setHovered] = useState(false);
  const color =
    tone === "confirm" ? ACCENT : hovered ? TEXT_PRIMARY : TEXT_FADED;

  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      disabled={disabled}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        width: 24,
        height: 24,
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        border: `1px solid ${hovered ? "var(--card-border)" : BORDER}`,
        background: hovered ? "var(--card-hover)" : "transparent",
        color,
        cursor: disabled ? "default" : "pointer",
        opacity: disabled ? 0.55 : 1,
        transition:
          "background 150ms, border-color 150ms, color 150ms, opacity 150ms",
        ...style,
      }}
    >
      {children}
    </button>
  );
}

function EditIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 16 16" fill="none">
      <path
        d="M9.8 3.1 12.9 6.2M2.7 13.3l3.2-.7 7.3-7.3a2.2 2.2 0 0 0-3.1-3.1L2.8 9.5l-.7 3.2a.5.5 0 0 0 .6.6Z"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
      <path
        d="m3 8.4 3.1 3.1L13 4.5"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function XIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
      <path
        d="M4.5 4.5 11.5 11.5M11.5 4.5 4.5 11.5"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
