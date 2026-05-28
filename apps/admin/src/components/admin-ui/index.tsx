"use client";

import {
  forwardRef,
  type ButtonHTMLAttributes,
  type CSSProperties,
  type HTMLAttributes,
  type ReactNode,
} from "react";

export const adminTokens = {
  bg: "var(--background)",
  sidebar: "var(--sidebar)",
  panel: "var(--surface-1)",
  panelStrong: "var(--surface-active)",
  card: "var(--material-card)",
  cardHover: "var(--surface-hover)",
  inputBg: "var(--control-bg)",
  inputBorder: "var(--control-border)",
  border: "var(--border)",
  borderMedium: "var(--border-medium)",
  borderActive: "var(--border-active)",
  divider: "var(--border-subtle)",
  fg: "var(--text-primary)",
  text: "var(--text-secondary)",
  muted: "var(--text-tertiary)",
  faded: "var(--text-quaternary)",
  ghost: "var(--text-placeholder)",
  accent: "var(--accent-strong)",
  accentSoft: "var(--accent-soft)",
  accentWash: "var(--accent-wash)",
  accentFill: "var(--accent-fill)",
  accentBorder: "var(--accent-border)",
  accentGlow: "var(--accent-glow)",
  onAccent: "var(--accent-on)",
  success: "var(--status-live)",
  processing: "var(--status-processing)",
  info: "var(--status-info)",
  warning: "var(--warning-amber)",
  danger: "var(--status-error)",
  dangerFill: "var(--critical-fill)",
  dangerBorder: "var(--critical-border)",
  fontBody: "var(--font-body, Inter), system-ui, sans-serif",
  fontDisplay: "var(--font-display, 'Space Grotesk'), system-ui, sans-serif",
  fontMono: "var(--font-mono, 'JetBrains Mono'), ui-monospace, monospace",
} as const;

export type AdminTone =
  | "default"
  | "accent"
  | "success"
  | "processing"
  | "warning"
  | "danger"
  | "muted";

const toneColor: Record<AdminTone, string> = {
  default: adminTokens.text,
  accent: adminTokens.accent,
  success: adminTokens.success,
  processing: adminTokens.processing,
  warning: adminTokens.warning,
  danger: adminTokens.danger,
  muted: adminTokens.muted,
};

const toneFill: Record<AdminTone, string> = {
  default: "var(--ink-soft)",
  accent: adminTokens.accentSoft,
  success: "color-mix(in srgb, var(--status-live) 12%, transparent)",
  processing: "color-mix(in srgb, var(--status-processing) 12%, transparent)",
  warning: "color-mix(in srgb, var(--warning-amber) 12%, transparent)",
  danger: adminTokens.dangerFill,
  muted: "var(--ink-wash)",
};

const toneBorder: Record<AdminTone, string> = {
  default: adminTokens.border,
  accent: adminTokens.accentBorder,
  success: "color-mix(in srgb, var(--status-live) 28%, transparent)",
  processing: "color-mix(in srgb, var(--status-processing) 28%, transparent)",
  warning: "color-mix(in srgb, var(--warning-amber) 28%, transparent)",
  danger: adminTokens.dangerBorder,
  muted: adminTokens.border,
};

export function AdminPageShell({
  children,
  minHeight = "calc(100vh - 48px)",
  style,
  ...props
}: HTMLAttributes<HTMLDivElement> & {
  minHeight?: CSSProperties["minHeight"];
}) {
  return (
    <div
      {...props}
      style={{
        display: "flex",
        flexDirection: "column",
        minHeight,
        background: adminTokens.bg,
        color: adminTokens.fg,
        fontFamily: adminTokens.fontBody,
        ...style,
      }}
    >
      {children}
    </div>
  );
}

export function AdminSplitLayout({
  main,
  rail,
  mainRatio = "minmax(0, 2.65fr)",
  railWidth = "minmax(280px, 380px)",
  gap = "var(--space-32)",
  padding = "var(--space-32) 40px 112px",
  stickyRail = true,
  style,
}: {
  main: ReactNode;
  rail?: ReactNode;
  mainRatio?: string;
  railWidth?: string;
  gap?: CSSProperties["gap"];
  padding?: CSSProperties["padding"];
  stickyRail?: boolean;
  style?: CSSProperties;
}) {
  return (
    <div
      style={{
        display: "grid",
        flex: "1 1 auto",
        gridTemplateColumns: rail
          ? `${mainRatio} ${railWidth}`
          : "minmax(0, 1fr)",
        gap,
        padding,
        alignItems: "flex-start",
        ...style,
      }}
    >
      <div style={{ minWidth: 0 }}>{main}</div>
      {rail && (
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: "var(--space-20)",
            position: stickyRail ? "sticky" : undefined,
            top: stickyRail ? 20 : undefined,
            minWidth: 0,
          }}
        >
          {rail}
        </div>
      )}
    </div>
  );
}

export const AdminRightRail = forwardRef<
  HTMLElement,
  HTMLAttributes<HTMLElement> & {
    width?: CSSProperties["width"];
  }
>(function AdminRightRail({ children, width = 420, style, ...props }, ref) {
  return (
    <aside
      ref={ref}
      {...props}
      style={{
        width,
        flexShrink: 0,
        position: "sticky",
        top: 0,
        alignSelf: "flex-start",
        height: "calc(100vh - 48px)",
        background: adminTokens.sidebar,
        borderLeft: "1px solid var(--ink-fill)",
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
        ...style,
      }}
    >
      {children}
    </aside>
  );
});

export function AdminPanel({
  children,
  padding = "var(--space-18)",
  interactive = false,
  style,
  ...props
}: HTMLAttributes<HTMLDivElement> & {
  padding?: CSSProperties["padding"];
  interactive?: boolean;
}) {
  return (
    <div
      {...props}
      style={{
        background: adminTokens.card,
        border: `1px solid ${adminTokens.border}`,
        borderRadius: "var(--radius-md)",
        padding,
        transition: interactive
          ? "background 140ms ease, border-color 140ms ease"
          : undefined,
        ...style,
      }}
    >
      {children}
    </div>
  );
}

export function AdminSection({
  title,
  eyebrow,
  trailing,
  children,
  style,
}: {
  title?: ReactNode;
  eyebrow?: ReactNode;
  trailing?: ReactNode;
  children: ReactNode;
  style?: CSSProperties;
}) {
  return (
    <section
      style={{
        display: "flex",
        flexDirection: "column",
        gap: "var(--space-12)",
        ...style,
      }}
    >
      {(title || eyebrow || trailing) && (
        <header
          style={{
            display: "flex",
            alignItems: "baseline",
            justifyContent: "space-between",
            gap: "var(--space-12)",
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "baseline",
              gap: "var(--space-8)",
              minWidth: 0,
            }}
          >
            {title && (
              <h3
                style={{
                  margin: 0,
                  color: adminTokens.fg,
                  fontFamily: adminTokens.fontBody,
                  fontSize: "var(--font-size-2xl)",
                  fontWeight: 600,
                  letterSpacing: 0,
                }}
              >
                {title}
              </h3>
            )}
            {eyebrow && <AdminKicker>{eyebrow}</AdminKicker>}
          </div>
          {trailing}
        </header>
      )}
      {children}
    </section>
  );
}

export function AdminKicker({
  children,
  tone = "accent",
  style,
}: {
  children: ReactNode;
  tone?: AdminTone;
  style?: CSSProperties;
}) {
  return (
    <span
      style={{
        color: toneColor[tone],
        fontFamily: adminTokens.fontMono,
        fontSize: "var(--font-size-xs)",
        letterSpacing: "0.16em",
        lineHeight: 1.2,
        textTransform: "uppercase",
        whiteSpace: "nowrap",
        ...style,
      }}
    >
      {children}
    </span>
  );
}

export function AdminStatusPill({
  children,
  tone = "default",
  dot = false,
  style,
}: {
  children: ReactNode;
  tone?: AdminTone;
  dot?: boolean;
  style?: CSSProperties;
}) {
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: "var(--space-6)",
        minHeight: 22,
        padding: "2px 8px",
        border: `1px solid ${toneBorder[tone]}`,
        borderRadius: "var(--radius-pill)",
        background: toneFill[tone],
        color: toneColor[tone],
        fontFamily: adminTokens.fontMono,
        fontSize: "var(--font-size-xs)",
        letterSpacing: "0.10em",
        lineHeight: 1.2,
        textTransform: "uppercase",
        whiteSpace: "nowrap",
        ...style,
      }}
    >
      {dot && (
        <span
          aria-hidden
          style={{
            width: 6,
            height: 6,
            borderRadius: "var(--radius-pill)",
            background: toneColor[tone],
            boxShadow:
              tone === "muted" || tone === "default"
                ? undefined
                : `0 0 8px ${toneColor[tone]}`,
            flexShrink: 0,
          }}
        />
      )}
      {children}
    </span>
  );
}

export function AdminButton({
  children,
  variant = "secondary",
  tone = "accent",
  style,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "ghost" | "danger";
  tone?: AdminTone;
}) {
  const isPrimary = variant === "primary";
  const isDanger = variant === "danger";
  const colorTone = isDanger ? "danger" : tone;
  return (
    <button
      type="button"
      {...props}
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        gap: "var(--space-8)",
        minHeight: 32,
        padding: "7px 12px",
        border: `1px solid ${
          isPrimary ? toneColor[colorTone] : toneBorder[colorTone]
        }`,
        borderRadius: "var(--radius-md)",
        background: isPrimary
          ? toneColor[colorTone]
          : variant === "ghost"
            ? "transparent"
            : toneFill[colorTone],
        color: isPrimary ? adminTokens.onAccent : toneColor[colorTone],
        cursor: props.disabled ? "not-allowed" : "pointer",
        fontFamily: adminTokens.fontBody,
        fontSize: "var(--font-size-base)",
        fontWeight: 600,
        lineHeight: 1,
        opacity: props.disabled ? 0.52 : 1,
        textDecoration: "none",
        whiteSpace: "nowrap",
        ...style,
      }}
    >
      {children}
    </button>
  );
}

export function AdminIconButton({
  children,
  label,
  tone = "muted",
  style,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  label: string;
  tone?: AdminTone;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      {...props}
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        width: 28,
        height: 28,
        padding: 0,
        border: `1px solid ${toneBorder[tone]}`,
        borderRadius: "var(--radius-md)",
        background: toneFill[tone],
        color: toneColor[tone],
        cursor: props.disabled ? "not-allowed" : "pointer",
        opacity: props.disabled ? 0.52 : 1,
        ...style,
      }}
    >
      {children}
    </button>
  );
}

export function AdminField({
  label,
  trailing,
  children,
  style,
}: {
  label: ReactNode;
  trailing?: ReactNode;
  children: ReactNode;
  style?: CSSProperties;
}) {
  return (
    <label
      style={{
        display: "flex",
        flexDirection: "column",
        gap: "var(--space-8)",
        minWidth: 0,
        ...style,
      }}
    >
      <span
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: "var(--space-8)",
          color: adminTokens.muted,
          fontFamily: adminTokens.fontMono,
          fontSize: "var(--font-size-xs)",
          letterSpacing: "0.12em",
          textTransform: "uppercase",
        }}
      >
        <span>{label}</span>
        {trailing}
      </span>
      {children}
    </label>
  );
}
