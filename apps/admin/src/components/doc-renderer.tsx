import { MDXRemote } from "next-mdx-remote/rsc";
import remarkGfm from "remark-gfm";
import { Ticket } from "./mdx/ticket";
import { Feature } from "./mdx/feature";
import { Status } from "./mdx/status";
import { Callout } from "./mdx/callout";
import { Milestone } from "./mdx/milestone";
import { Workstream } from "./mdx/workstream";
import { Timeline } from "./mdx/timeline";

const CARD_GRADIENTS = [
  "linear-gradient(135deg, #0a2e1f 0%, #1a5c3a 50%, #071f14 100%)",
  "linear-gradient(135deg, #0b1a3a 0%, #153060 50%, #060f26 100%)",
  "linear-gradient(135deg, #2a1a0a 0%, #4a2e12 50%, #1a0f04 100%)",
  "linear-gradient(135deg, #1a0a2e 0%, #2e145a 50%, #14082a 100%)",
  "linear-gradient(135deg, #2e0a12 0%, #501828 50%, #260a14 100%)",
  "linear-gradient(135deg, #0f2a12 0%, #1e5420 50%, #0c2414 100%)",
];

/* ── Helpers ────────────────────────────────────────────────── */

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

type TocEntry = { label: string; slug: string };

function extractToc(content: string): TocEntry[] {
  const lines = content.split("\n");
  const entries: TocEntry[] = [];
  for (const line of lines) {
    const match = line.match(/^## (.+)$/);
    if (match) {
      const label = match[1].trim();
      entries.push({ label, slug: slugify(label) });
    }
  }
  return entries;
}

/* ── Heading components with anchor IDs ────────────────────── */

function H1({ children, ...props }: React.ComponentProps<"h1">) {
  const text = typeof children === "string" ? children : "";
  return <h1 id={slugify(text)} {...props}>{children}</h1>;
}

function H2({ children, ...props }: React.ComponentProps<"h2">) {
  const text = typeof children === "string" ? children : "";
  return <h2 id={slugify(text)} {...props}>{children}</h2>;
}

function H3({ children, ...props }: React.ComponentProps<"h3">) {
  const text = typeof children === "string" ? children : "";
  return <h3 id={slugify(text)} {...props}>{children}</h3>;
}

const components = {
  Ticket,
  Feature,
  Status,
  Callout,
  Milestone,
  Workstream,
  Timeline,
  h1: H1,
  h2: H2,
  h3: H3,
};

/* ── Component ─────────────────────────────────────────────── */

type DocRendererProps = {
  content: string;
  title?: string;
  subtitle?: string;
  gradientIndex?: number;
  updatedAt?: string;
};

export function DocRenderer({ content, title, subtitle, gradientIndex = 0, updatedAt }: DocRendererProps) {
  const formattedDate = updatedAt
    ? new Date(updatedAt).toLocaleDateString("en-US", {
        year: "numeric",
        month: "long",
        day: "numeric",
      })
    : undefined;

  const gradient = CARD_GRADIENTS[gradientIndex % CARD_GRADIENTS.length];
  const toc = extractToc(content);

  return (
    <div className="doc-page">
      {/* Hero + TOC row */}
      {title && (
        <div className="doc-hero-row">
          <header className="doc-hero" style={{ background: gradient }}>
            <div className="doc-hero-content">
              {formattedDate && <span className="doc-hero-date">{formattedDate}</span>}
              <h1 className="doc-hero-title">{title}</h1>
              {subtitle && <p className="doc-hero-subtitle">{subtitle}</p>}
            </div>
          </header>

          {toc.length > 0 && (
            <nav className="doc-toc">
              <div className="doc-toc-label">Contents</div>
              <ul className="doc-toc-list">
                {toc.map((entry) => (
                  <li key={entry.slug}>
                    <a href={`#${entry.slug}`}>{entry.label}</a>
                  </li>
                ))}
              </ul>
            </nav>
          )}
        </div>
      )}

      {/* Article body */}
      <article className="doc-renderer">
        <MDXRemote
          source={content}
          components={components}
          options={{ mdxOptions: { remarkPlugins: [remarkGfm] } }}
        />
      </article>

      <DocStyles />
    </div>
  );
}

function DocStyles() {
  return (
    <style>{`
      .doc-page {
        width: 100%;
        display: flex;
        flex-direction: column;
        gap: 0;
      }

      /* ── Hero + TOC row ─────────────────────────────── */
      .doc-hero-row {
        display: flex;
        flex-direction: row;
        gap: 20px;
        align-items: stretch;
      }
      .doc-hero {
        position: relative;
        border-radius: 14px;
        overflow: hidden;
        min-height: 320px;
        display: flex;
        flex-direction: column;
        justify-content: flex-end;
        flex: 1;
        min-width: 0;
      }
      .doc-hero-content {
        position: relative;
        padding: 48px 48px;
        display: flex;
        flex-direction: column;
        gap: 16px;
      }
      .doc-hero-date {
        font-size: 0.8125rem;
        font-weight: 700;
        color: rgba(255,255,255,0.55);
        letter-spacing: 0.015em;
      }
      .doc-hero-title {
        font-size: clamp(2rem, 5vw, 3.5rem);
        font-weight: 600;
        color: #fff;
        margin-top: 0;
        margin-right: 0;
        margin-bottom: 0;
        margin-left: 0;
        line-height: 1.1;
        letter-spacing: -0.02em;
        text-wrap: balance;
      }
      .doc-hero-subtitle {
        font-size: 1.0625rem;
        line-height: 1.7;
        color: rgba(255,255,255,0.7);
        margin-top: 0;
        margin-right: 0;
        margin-bottom: 0;
        margin-left: 0;
        max-width: 640px;
      }

      /* ── Table of contents ──────────────────────────── */
      .doc-toc {
        width: 240px;
        flex-shrink: 0;
        background: var(--material-card);
        border: 1px solid var(--border-subtle);
        border-radius: 14px;
        padding: 24px;
        display: flex;
        flex-direction: column;
        gap: 12px;
        overflow-y: auto;
      }
      .doc-toc-label {
        font-size: 0.6875rem;
        font-weight: 600;
        text-transform: uppercase;
        letter-spacing: 0.06em;
        color: var(--accent, #8fd1cb);
      }
      .doc-toc-list {
        list-style: none;
        margin-top: 0;
        margin-right: 0;
        margin-bottom: 0;
        margin-left: 0;
        padding: 0;
        display: flex;
        flex-direction: column;
        gap: 2px;
      }
      .doc-toc-list li a {
        display: block;
        padding: 5px 8px;
        border-radius: 6px;
        font-size: 0.75rem;
        line-height: 1.4;
        color: var(--text-tertiary);
        text-decoration: none;
        transition: background 150ms, color 150ms;
      }
      .doc-toc-list li a:hover {
        background: rgba(255,255,255,0.06);
        color: var(--text-primary);
      }

      /* ── Article body ────────────────────────────── */
      .doc-renderer {
        max-width: 722px;
        margin-top: 0;
        margin-right: auto;
        margin-bottom: 0;
        margin-left: auto;
        padding: 48px 0;
        color: var(--text-secondary);
        line-height: 1.78;
        font-size: 1.0625rem;
      }
      .doc-renderer h1 {
        font-size: 2rem;
        font-weight: 600;
        color: var(--text-primary);
        margin-top: 60px;
        margin-right: 0;
        margin-bottom: 16px;
        margin-left: 0;
        letter-spacing: -0.02em;
        line-height: 1.2;
        text-wrap: balance;
        scroll-margin-top: 80px;
      }
      .doc-renderer h2 {
        font-size: 1.5rem;
        font-weight: 600;
        color: var(--text-primary);
        margin-top: 60px;
        margin-right: 0;
        margin-bottom: 16px;
        margin-left: 0;
        padding-bottom: 0;
        border-bottom: none;
        letter-spacing: -0.01em;
        line-height: 1.3;
        text-wrap: balance;
        scroll-margin-top: 80px;
      }
      .doc-renderer h3 {
        font-size: 1.125rem;
        font-weight: 600;
        color: var(--text-primary);
        margin-top: 40px;
        margin-right: 0;
        margin-bottom: 12px;
        margin-left: 0;
        line-height: 1.4;
        scroll-margin-top: 80px;
      }
      .doc-renderer p {
        margin-top: 0;
        margin-right: 0;
        margin-bottom: 24px;
        margin-left: 0;
      }
      .doc-renderer ul, .doc-renderer ol {
        margin-top: 0;
        margin-right: 0;
        margin-bottom: 24px;
        margin-left: 0;
        padding-left: 1.5rem;
      }
      .doc-renderer li {
        margin-bottom: 8px;
      }
      .doc-renderer li > ul, .doc-renderer li > ol {
        margin-top: 8px;
        margin-bottom: 0;
      }
      .doc-renderer code {
        font-family: var(--font-mono, ui-monospace, monospace);
        font-size: 0.85em;
        background: var(--control-bg);
        padding: 0.15em 0.4em;
        border-radius: 4px;
        color: var(--text-primary);
      }
      .doc-renderer pre {
        background: var(--material-card);
        border: 1px solid var(--border-subtle);
        border-radius: 12px;
        padding: 1.25rem;
        overflow-x: auto;
        margin-top: 32px;
        margin-right: 0;
        margin-bottom: 32px;
        margin-left: 0;
      }
      .doc-renderer pre code {
        background: none;
        padding: 0;
        font-size: 0.8125rem;
        color: var(--text-secondary);
      }
      .doc-renderer blockquote {
        border-left: 3px solid var(--accent-strong);
        margin-top: 32px;
        margin-right: 0;
        margin-bottom: 32px;
        margin-left: 0;
        padding: 0.5rem 1.25rem;
        color: var(--text-tertiary);
      }
      .doc-renderer hr {
        border: none;
        border-top: 1px solid var(--border-subtle);
        margin-top: 48px;
        margin-right: 0;
        margin-bottom: 48px;
        margin-left: 0;
      }
      .doc-renderer a {
        color: var(--accent-strong);
        text-decoration: underline;
        text-underline-offset: 3px;
        text-decoration-thickness: 1px;
      }
      .doc-renderer a:hover {
        color: var(--text-primary);
      }
      .doc-renderer table {
        width: 100%;
        border-collapse: collapse;
        margin-top: 32px;
        margin-right: 0;
        margin-bottom: 32px;
        margin-left: 0;
        font-size: 0.875rem;
      }
      .doc-renderer th {
        text-align: left;
        font-weight: 600;
        padding: 0.625rem 0.875rem;
        border-bottom: 2px solid var(--border-subtle);
        color: var(--text-primary);
      }
      .doc-renderer td {
        padding: 0.625rem 0.875rem;
        border-bottom: 1px solid var(--border-subtle);
      }
      .doc-renderer tr:last-child td {
        border-bottom: none;
      }
      .doc-renderer img {
        max-width: 100%;
        border-radius: 12px;
        margin-top: 32px;
        margin-right: 0;
        margin-bottom: 32px;
        margin-left: 0;
      }
      .doc-renderer strong {
        font-weight: 600;
        color: var(--text-primary);
      }
    `}</style>
  );
}
