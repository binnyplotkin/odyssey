import { getWorldRepository } from "@odyssey/db";

export const dynamic = "force-dynamic";

export default async function WorldsPage() {
  const worlds = await getWorldRepository().listWorlds();

  return (
    <div>
      <h1
        style={{
          fontSize: "1.5rem",
          fontWeight: 700,
          marginBottom: "1.5rem",
        }}
      >
        Worlds ({worlds.length})
      </h1>

      <table
        style={{
          width: "100%",
          borderCollapse: "collapse",
          background: "var(--panel)",
          border: "1px solid var(--border)",
          borderRadius: "0.5rem",
          overflow: "hidden",
          fontSize: "0.875rem",
        }}
      >
        <thead>
          <tr style={{ borderBottom: "1px solid var(--border)" }}>
            <th style={{ textAlign: "left", padding: "0.5rem 1rem", color: "var(--muted)", fontWeight: 500 }}>ID</th>
            <th style={{ textAlign: "left", padding: "0.5rem 1rem", color: "var(--muted)", fontWeight: 500 }}>Title</th>
            <th style={{ textAlign: "left", padding: "0.5rem 1rem", color: "var(--muted)", fontWeight: 500 }}>Roles</th>
            <th style={{ textAlign: "left", padding: "0.5rem 1rem", color: "var(--muted)", fontWeight: 500 }}>Characters</th>
            <th style={{ textAlign: "left", padding: "0.5rem 1rem", color: "var(--muted)", fontWeight: 500 }}>Groups</th>
            <th style={{ textAlign: "left", padding: "0.5rem 1rem", color: "var(--muted)", fontWeight: 500 }}>Events</th>
          </tr>
        </thead>
        <tbody>
          {worlds.map((world) => (
            <tr key={world.id} style={{ borderBottom: "1px solid var(--border)" }}>
              <td style={{ padding: "0.5rem 1rem", fontFamily: "var(--font-mono)", fontSize: "0.8rem" }}>
                <a
                  href={`/worlds/${world.id}`}
                  style={{ color: "var(--accent)" }}
                >
                  {world.id}
                </a>
              </td>
              <td style={{ padding: "0.5rem 1rem", fontWeight: 500 }}>{world.title}</td>
              <td style={{ padding: "0.5rem 1rem" }}>{world.roles.length}</td>
              <td style={{ padding: "0.5rem 1rem" }}>{world.characters.length}</td>
              <td style={{ padding: "0.5rem 1rem" }}>{world.groups.length}</td>
              <td style={{ padding: "0.5rem 1rem" }}>{world.eventTemplates.length}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
