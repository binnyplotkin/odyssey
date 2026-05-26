import { redirectToWiki } from "@/lib/character-to-wiki-redirect";

export const dynamic = "force-dynamic";

type Params = Promise<{ slug: string; pageSlug: string }>;
type SearchParams = Promise<{ edit?: string }>;

export default async function WikiPageRedirect({
  params,
  searchParams,
}: {
  params: Params;
  searchParams: SearchParams;
}) {
  const { slug, pageSlug } = await params;
  const { edit } = await searchParams;
  const query = new URLSearchParams();
  if (edit) query.set("edit", edit);
  await redirectToWiki(slug, `wiki/${pageSlug}`, query);
}
