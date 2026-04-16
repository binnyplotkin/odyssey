import fs from "fs/promises";
import path from "path";
import matter from "gray-matter";
import { notFound } from "next/navigation";
import { DocRenderer } from "@/components/doc-renderer";
import { DocHeader } from "./doc-header";

export const dynamic = "force-dynamic";

const DOCS_DIR = path.resolve(process.cwd(), "../../docs");

async function getDoc(id: string) {
  for (const ext of [".mdx", ".md"]) {
    try {
      const filePath = path.join(DOCS_DIR, `${id}${ext}`);
      const raw = await fs.readFile(filePath, "utf-8");
      const { content, data: frontmatter } = matter(raw);
      const stat = await fs.stat(filePath);

      // Extract title from first # heading
      const lines = content.split("\n");
      const titleLine = lines.find((l) => l.startsWith("# "));
      const title = (frontmatter.title as string) || (titleLine ? titleLine.replace(/^#\s+/, "") : id);

      // Extract subtitle from first paragraph after the title
      const titleIdx = titleLine ? lines.indexOf(titleLine) : -1;
      const afterTitle = titleIdx >= 0 ? lines.slice(titleIdx + 1) : lines;
      const subtitleLine = afterTitle.find((l) => l.trim() && !l.startsWith("#") && !l.startsWith("---") && !l.startsWith("<") && !l.startsWith("import"));
      const subtitle = subtitleLine?.trim() || undefined;

      // Strip the first # heading from content so it doesn't render twice
      const bodyContent = titleLine ? content.replace(titleLine, "").trim() : content;

      const gradientIndex = (frontmatter.gradientIndex as number) ?? 0;

      return {
        content: bodyContent,
        title,
        subtitle,
        gradientIndex,
        updatedAt: stat.mtime.toISOString(),
      };
    } catch {
      continue;
    }
  }
  return null;
}

export default async function DocPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const doc = await getDoc(id);

  if (!doc) notFound();

  return (
    <>
      <DocHeader title={doc.title} />
      <DocRenderer
        content={doc.content}
        title={doc.title}
        subtitle={doc.subtitle}
        gradientIndex={doc.gradientIndex}
        updatedAt={doc.updatedAt}
      />
    </>
  );
}
