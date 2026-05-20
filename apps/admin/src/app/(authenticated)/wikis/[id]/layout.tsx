import { notFound } from "next/navigation";
import { getWikisStore } from "@odyssey/db";
import { WikiChrome } from "./wiki-chrome";

export const dynamic = "force-dynamic";

export default async function WikiLayout({
  params,
  children,
}: {
  params: Promise<{ id: string }>;
  children: React.ReactNode;
}) {
  const { id } = await params;
  const wikis = getWikisStore();

  const record = await wikis.getWikiById(id);
  if (!record) notFound();

  return (
    <WikiChrome wikiId={record.id} wikiTitle={record.title}>
      {children}
    </WikiChrome>
  );
}
