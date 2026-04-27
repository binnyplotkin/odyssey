import { EngineCanvas } from "@/components/engine-canvas";
import { listWorlds } from "@/lib/service";

export const dynamic = "force-dynamic";

export default async function EnginePage() {
  const worlds = await listWorlds();

  return <EngineCanvas worlds={worlds} />;
}
