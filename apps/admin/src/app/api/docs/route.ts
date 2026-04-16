import { NextResponse } from "next/server";
import fs from "fs/promises";
import path from "path";

const DOCS_DIR = path.resolve(process.cwd(), "../../docs");

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const id = searchParams.get("id");

  try {
    if (id) {
      const filePath = path.join(DOCS_DIR, `${id}.md`);
      const content = await fs.readFile(filePath, "utf-8");
      return NextResponse.json({ id, content });
    }

    const files = await fs.readdir(DOCS_DIR);
    const docs = await Promise.all(
      files
        .filter((f) => f.endsWith(".md"))
        .map(async (f) => {
          const id = f.replace(/\.md$/, "");
          const content = await fs.readFile(path.join(DOCS_DIR, f), "utf-8");
          const firstLine = content.split("\n").find((l) => l.startsWith("# "));
          const title = firstLine ? firstLine.replace(/^#\s+/, "") : id;
          const stat = await fs.stat(path.join(DOCS_DIR, f));
          return { id, title, updatedAt: stat.mtime.toISOString() };
        })
    );

    docs.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    return NextResponse.json(docs);
  } catch (e: any) {
    if (e.code === "ENOENT") {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
