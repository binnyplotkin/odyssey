import { redirectToWiki } from "@/lib/character-to-wiki-redirect";

export const dynamic = "force-dynamic";

type Params = Promise<{ slug: string }>;

export default async function IngestionTabRedirect({
  params,
}: {
  params: Params;
}) {
  const { slug } = await params;
  await redirectToWiki(slug, "ingestion");
}
