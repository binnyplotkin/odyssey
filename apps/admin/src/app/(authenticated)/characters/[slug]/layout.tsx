import { Suspense } from "react";
import { CharacterHeaderShell } from "@/components/character-header-shell";
import { CharacterHeaderSkeleton } from "@/components/character-header-skeleton";

type Params = Promise<{ slug: string }>;

// The character lookup lives inside <Suspense>, not at the top level of the
// layout — otherwise the layout itself suspends and the closest fallback
// becomes /characters/loading.tsx (the list skeleton), causing a brief
// list-skeleton flash on every navigation into a slug. Keeping the layout's
// own render synchronous lets [slug]/loading.tsx own the body suspense and
// the Suspense below own the header suspense.

export default async function CharacterLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Params;
}) {
  const { slug } = await params;

  return (
    <>
      <Suspense fallback={<CharacterHeaderSkeleton />}>
        <CharacterHeaderShell slug={slug} />
      </Suspense>
      {children}
    </>
  );
}
