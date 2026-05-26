import { notFound } from "next/navigation";
import { LAYERS } from "@/components/harness/harness-types";
import { LayerPage } from "@/components/harness/layer-page";

type Params = Promise<{ slug: string; layer: string }>;

/**
 * Per-layer route. Each L01-L09 / stage-manager / test-chat / adversarial
 * layer lives at `/harness/layers/<key>`. Renders the existing editor
 * component for that layer inside the harness shell (provided by the
 * parent layout).
 */
export default async function LayerRoute({ params }: { params: Params }) {
  const { layer } = await params;
  const def = LAYERS.find((l) => l.key === layer);
  if (!def) notFound();

  return <LayerPage layer={def} />;
}
