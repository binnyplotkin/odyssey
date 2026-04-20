import "dotenv/config";
import { neon } from "@neondatabase/serverless";

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("DATABASE_URL is required");
    process.exit(1);
  }
  const sql = neon(url);

  const nodeCounts = await sql.query(
    `SELECT kind, count(*)::int AS n FROM world_nodes GROUP BY kind ORDER BY kind`,
  );
  const edgeCount = await sql.query(`SELECT count(*)::int AS n FROM world_edges`);
  const worldRollup = await sql.query(
    `SELECT w.id, w.title, count(wn.id)::int AS nodes
       FROM worlds w
       LEFT JOIN world_nodes wn ON wn.world_id = w.id
       GROUP BY w.id, w.title
       ORDER BY w.title`,
  );

  console.log("nodes by kind:", nodeCounts);
  console.log("edges:", edgeCount);
  console.log("nodes per world:");
  for (const row of worldRollup as any[]) {
    console.log(`  ${row.title} (${row.id}) → ${row.nodes} nodes`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
