import { redirectToWiki } from "@/lib/character-to-wiki-redirect";

export const dynamic = "force-dynamic";

type Params = Promise<{ slug: string }>;
type SearchParams = Promise<{ source?: string }>;

export default async function SourcesTabRedirect({
  params,
  searchParams,
}: {
  params: Params;
  searchParams: SearchParams;
}) {
  const { slug } = await params;
  const { source } = await searchParams;
  const query = new URLSearchParams();
  if (source) query.set("source", source);
  await redirectToWiki(slug, "sources", query);
}
