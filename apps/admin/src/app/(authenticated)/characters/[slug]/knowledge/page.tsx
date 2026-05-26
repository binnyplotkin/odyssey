import { redirectToWiki } from "@/lib/character-to-wiki-redirect";

export const dynamic = "force-dynamic";

type Params = Promise<{ slug: string }>;
type SearchParams = Promise<{ focus?: string }>;

export default async function KnowledgeTabRedirect({
  params,
  searchParams,
}: {
  params: Params;
  searchParams: SearchParams;
}) {
  const { slug } = await params;
  const { focus } = await searchParams;
  const query = new URLSearchParams();
  if (focus) query.set("focus", focus);
  await redirectToWiki(slug, "knowledge", query);
}
