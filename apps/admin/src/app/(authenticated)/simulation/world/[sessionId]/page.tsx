import { WorldSimulationConsole } from "@/components/world-simulation-console";

export default async function WorldSimulationPage({
  params,
}: {
  params: Promise<{ sessionId: string }>;
}) {
  const { sessionId } = await params;
  return <WorldSimulationConsole sessionId={sessionId} />;
}
