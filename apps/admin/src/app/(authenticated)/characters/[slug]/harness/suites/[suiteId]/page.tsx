import { SuitesRoutePage } from "@/components/harness/eval-routes/suites-route-page";

type Params = Promise<{ slug: string; suiteId: string }>;

export default async function Page({ params }: { params: Params }) {
  const { suiteId } = await params;
  return <SuitesRoutePage selectedSuiteId={suiteId} />;
}
