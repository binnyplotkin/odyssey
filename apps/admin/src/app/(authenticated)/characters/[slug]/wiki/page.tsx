import { redirectToWiki } from "@/lib/character-to-wiki-redirect";

export const dynamic = "force-dynamic";

type Params = Promise<{ slug: string }>;
type SearchParams = Promise<{ page?: string; edit?: string }>;

export default async function WikiTabRedirect({
  params,
  searchParams,
}: {
  params: Params;
  searchParams: SearchParams;
}) {
  const { slug } = await params;
  const sp = await searchParams;
  const query = new URLSearchParams();
  if (sp.page) query.set("page", sp.page);
  if (sp.edit) query.set("edit", sp.edit);
  await redirectToWiki(slug, "wiki", query);
}
