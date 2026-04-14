import { getPersistenceStore } from "@odyssey/db";

export const dynamic = "force-dynamic";

export default async function SessionsPage() {
  const sessions = await getPersistenceStore().listSessions();

  return (
    <div>
      <h1
        style={{
          fontSize: "1.5rem",
          fontWeight: 700,
          marginBottom: "1.5rem",
        }}
      >
        Sessions ({sessions.length})
      </h1>

      {sessions.length === 0 ? (
        <p style={{ color: "var(--muted)" }}>No sessions found.</p>
      ) : (
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
              <th style={{ textAlign: "left", padding: "0.5rem 1rem", color: "var(--muted)", fontWeight: 500 }}>World</th>
              <th style={{ textAlign: "left", padding: "0.5rem 1rem", color: "var(--muted)", fontWeight: 500 }}>Role</th>
              <th style={{ textAlign: "left", padding: "0.5rem 1rem", color: "var(--muted)", fontWeight: 500 }}>Status</th>
              <th style={{ textAlign: "left", padding: "0.5rem 1rem", color: "var(--muted)", fontWeight: 500 }}>Version</th>
              <th style={{ textAlign: "left", padding: "0.5rem 1rem", color: "var(--muted)", fontWeight: 500 }}>Created</th>
              <th style={{ textAlign: "left", padding: "0.5rem 1rem", color: "var(--muted)", fontWeight: 500 }}>Last Active</th>
            </tr>
          </thead>
          <tbody>
            {sessions.map((session) => (
              <tr key={session.id} style={{ borderBottom: "1px solid var(--border)" }}>
                <td style={{ padding: "0.5rem 1rem", fontFamily: "var(--font-mono)", fontSize: "0.8rem" }}>
                  <a
                    href={`/sessions/${session.id}`}
                    style={{ color: "var(--accent)" }}
                  >
                    {session.id.slice(0, 16)}...
                  </a>
                </td>
                <td style={{ padding: "0.5rem 1rem" }}>{session.worldId}</td>
                <td style={{ padding: "0.5rem 1rem" }}>{session.roleId}</td>
                <td style={{ padding: "0.5rem 1rem" }}>
                  <span
                    style={{
                      display: "inline-block",
                      padding: "0.125rem 0.5rem",
                      borderRadius: "9999px",
                      fontSize: "0.75rem",
                      fontWeight: 500,
                      background:
                        session.status === "active"
                          ? "#d1fae5"
                          : session.status === "complete"
                            ? "#dbeafe"
                            : "#f3f4f6",
                      color:
                        session.status === "active"
                          ? "#065f46"
                          : session.status === "complete"
                            ? "#1e40af"
                            : "#4b5563",
                    }}
                  >
                    {session.status}
                  </span>
                </td>
                <td style={{ padding: "0.5rem 1rem" }}>{session.currentStateVersion}</td>
                <td style={{ padding: "0.5rem 1rem", color: "var(--muted)" }}>
                  {new Date(session.createdAt).toLocaleString()}
                </td>
                <td style={{ padding: "0.5rem 1rem", color: "var(--muted)" }}>
                  {new Date(session.lastActiveAt).toLocaleString()}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
