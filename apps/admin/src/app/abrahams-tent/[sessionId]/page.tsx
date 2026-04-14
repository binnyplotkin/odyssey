import { AbrahamsTentConsole } from "@/components/abrahams-tent-console";

export default async function AbrahamsTentSession({
  params,
}: {
  params: Promise<{ sessionId: string }>;
}) {
  const { sessionId } = await params;
  return <AbrahamsTentConsole sessionId={sessionId} />;
}
