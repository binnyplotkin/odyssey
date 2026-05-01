import { Suspense } from "react";
import { WorldHeaderShell } from "@/components/world-header-shell";
import { WorldHeaderSkeleton } from "@/components/world-header-skeleton";

type Params = Promise<{ worldId: string }>;

// World-detail lookup lives inside <Suspense>, not at the top level of the
// layout — otherwise the layout itself suspends and the closest fallback
// becomes /worlds/loading.tsx (the list skeleton), causing a list-skeleton
// flash on every navigation into a world. Mirrors the [slug] layout fix.

export default async function WorldLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Params;
}) {
  const { worldId } = await params;

  return (
    <>
      <Suspense fallback={<WorldHeaderSkeleton />}>
        <WorldHeaderShell worldId={worldId} />
      </Suspense>
      {children}
    </>
  );
}
