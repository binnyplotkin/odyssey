import { RunsRoutePage } from "@/components/harness/eval-routes/runs-route-page";

type Params = Promise<{ slug: string; runId: string }>;

export default async function Page({ params }: { params: Params }) {
  const { runId } = await params;
  return <RunsRoutePage selectedRunId={runId} />;
}
