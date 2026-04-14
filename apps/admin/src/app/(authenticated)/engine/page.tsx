import { EngineCanvas } from "@/components/engine-canvas";
import { listWorlds } from "@/lib/service";

export default async function EnginePage() {
  const worlds = await listWorlds();

  return <EngineCanvas worlds={worlds} />;
}
