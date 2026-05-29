import "dotenv/config";
import { neon } from "@neondatabase/serverless";

const EXPECTED = [
  "characters",
  "wiki_pages",
  "wiki_page_versions",
  "wiki_edges",
  "wiki_sources",
  "wiki_source_refs",
  "wiki_ingestion_log",
];

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("DATABASE_URL is required");
    process.exit(1);
  }

  const sql = neon(url);
  const rows = (await sql`
    SELECT table_name
    FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = ANY(${EXPECTED})
    ORDER BY table_name
  `) as { table_name: string }[];

  const present = new Set(rows.map((r) => r.table_name));
  console.log("Wiki tables in Neon:\n");
  for (const t of EXPECTED) {
    console.log(`  ${present.has(t) ? "✓" : "✗"}  ${t}`);
  }

  const missing = EXPECTED.filter((t) => !present.has(t));
  if (missing.length > 0) {
    console.error(`\n${missing.length} table(s) missing.`);
    process.exit(1);
  }
  console.log(`\nAll ${EXPECTED.length} tables present.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
