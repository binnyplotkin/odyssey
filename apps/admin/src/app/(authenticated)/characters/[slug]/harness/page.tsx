import { redirect } from "next/navigation";

/**
 * The harness root has no content of its own. Redirect to L01 — the
 * conventional first layer in authoring order. Users who want a specific
 * deeper page should link directly to it (e.g. /harness/suites or
 * /harness/runs/<id>).
 *
 * Back-compat: legacy `?layer=test-regression&tab=runs&run=X` URLs are
 * NOT auto-redirected here (they were internal-only and short-lived).
 * If we discover external links to them in practice, add a redirect map
 * in middleware.
 */
type Params = Promise<{ slug: string }>;
type SearchParams = Promise<{ [key: string]: string | string[] | undefined }>;

export default async function HarnessRoot({
  params,
  searchParams,
}: {
  params: Params;
  searchParams: SearchParams;
}) {
  const { slug } = await params;
  const sp = await searchParams;

  // Light back-compat: translate the common `?layer=…` shapes to the new
  // nested paths. Anything we don't recognize falls through to L01.
  const layer = typeof sp.layer === "string" ? sp.layer : null;
  if (layer) {
    const target = redirectFor(layer, sp);
    if (target) redirect(`/characters/${slug}/harness/${target}`);
  }

  redirect(`/characters/${slug}/harness/layers/l01`);
}

function redirectFor(
  layer: string,
  sp: { [key: string]: string | string[] | undefined },
): string | null {
  // L01-L09 + stage-manager rows live under /layers/<key>.
  if (
    layer.startsWith("l0") ||
    layer === "l1" ||
    layer.startsWith("sm-") ||
    layer === "test-chat" ||
    layer === "test-adversarial"
  ) {
    return `layers/${layer}`;
  }

  // The old `test-regression` catch-all carried sub-state in `tab` /
  // `run` / `sweep` / `suite` / `edit` — translate to nested paths.
  if (layer === "test-regression") {
    const tab = typeof sp.tab === "string" ? sp.tab : "runs";
    const runId = typeof sp.run === "string" ? sp.run : null;
    const sweepId = typeof sp.sweep === "string" ? sp.sweep : null;
    const suiteId = typeof sp.suite === "string" ? sp.suite : null;
    const edit = sp.edit === "1";

    if (tab === "runs" && runId) return `runs/${runId}`;
    if (tab === "sweeps" && sweepId) return `sweeps/${sweepId}`;
    if (tab === "suites" && suiteId && edit) return `suites/${suiteId}/edit`;
    if (tab === "suites" && suiteId) return `suites/${suiteId}`;
    if (tab === "history") return "history";
    if (tab === "sweeps") return "sweeps";
    if (tab === "suites") return "suites";
    return "runs";
  }

  return null;
}
