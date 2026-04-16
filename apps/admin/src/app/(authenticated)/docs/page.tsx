import fs from "fs/promises";
import path from "path";
import matter from "gray-matter";
import { DocsListClient } from "./docs-list-client";

export const dynamic = "force-dynamic";

export type DocEntry = { id: string; title: string; preview: string; updatedAt: string; gradientIndex: number };

async function getDocs(): Promise<DocEntry[]> {
  const docsDir = path.resolve(process.cwd(), "../../docs");

  try {
    const files = await fs.readdir(docsDir);
    const docs = await Promise.all(
      files
        .filter((f) => f.endsWith(".md") || f.endsWith(".mdx"))
        .map(async (f) => {
          const id = f.replace(/\.mdx?$/, "");
          const raw = await fs.readFile(path.join(docsDir, f), "utf-8");
          const { data: frontmatter, content } = matter(raw);
          const lines = content.split("\n");
          const firstLine = lines.find((l) => l.startsWith("# "));
          const title = (frontmatter.title as string) || (firstLine ? firstLine.replace(/^#\s+/, "") : id);
          const bodyLines = lines.filter((l) => l && !l.startsWith("#") && !l.startsWith("---") && !l.startsWith("|") && !l.startsWith("<") && !l.startsWith("import"));
          const preview = bodyLines.slice(0, 3).join(" ").slice(0, 160);
          const stat = await fs.stat(path.join(docsDir, f));
          return { id, title, preview, updatedAt: stat.mtime.toISOString(), gradientIndex: 0 };
        })
    );
    docs.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    docs.forEach((d, i) => { d.gradientIndex = i % 6; });
    return docs;
  } catch {
    return [];
  }
}

export default async function DocsPage() {
  const docs = await getDocs();
  return <DocsListClient docs={docs} />;
}
