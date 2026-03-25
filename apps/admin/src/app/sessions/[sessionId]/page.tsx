import { notFound } from "next/navigation";
import { getPersistenceStore } from "@odyssey/db";

export const dynamic = "force-dynamic";

export default async function SessionDetailPage({
  params,
}: {
  params: Promise<{ sessionId: string }>;
}) {
  const { sessionId } = await params;
  const store = getPersistenceStore();
  const session = await store.getSession(sessionId);

  if (!session) {
    notFound();
  }

  const turns = await store.getTurns(sessionId);

  return (
    <div>
      <div style={{ marginBottom: "1.5rem" }}>
        <a href="/sessions" style={{ color: "var(--accent)", fontSize: "0.875rem" }}>
          &larr; Back to Sessions
        </a>
      </div>

      <h1 style={{ fontSize: "1.5rem", fontWeight: 700, marginBottom: "0.5rem" }}>
        Session
      </h1>
      <p style={{ fontFamily: "var(--font-mono)", fontSize: "0.8rem", color: "var(--muted)", marginBottom: "1.5rem" }}>
        {session.id}
      </p>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))",
          gap: "0.75rem",
          marginBottom: "2rem",
        }}
      >
        {[
          { label: "World", value: session.worldId },
          { label: "Role", value: session.roleId },
          { label: "Status", value: session.status },
          { label: "Version", value: session.currentStateVersion },
          { label: "Stability", value: session.state.stability },
          { label: "Morale", value: session.state.morale },
          { label: "Resources", value: session.state.resources },
          { label: "Pressure", value: session.state.pressure },
        ].map(({ label, value }) => (
          <div
            key={label}
            style={{
              background: "var(--panel)",
              border: "1px solid var(--border)",
              borderRadius: "0.5rem",
              padding: "0.75rem",
            }}
          >
            <div style={{ fontSize: "0.7rem", textTransform: "uppercase", color: "var(--muted)", marginBottom: "0.25rem" }}>
              {label}
            </div>
            <div style={{ fontWeight: 600, fontSize: "0.875rem" }}>{value}</div>
          </div>
        ))}
      </div>

      <section>
        <h2 style={{ fontSize: "1rem", fontWeight: 600, marginBottom: "0.75rem" }}>
          Turn History ({turns.length})
        </h2>

        {turns.length === 0 ? (
          <p style={{ color: "var(--muted)" }}>No turns recorded yet.</p>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
            {turns.map((turn) => (
              <div
                key={turn.id}
                style={{
                  background: "var(--panel)",
                  border: "1px solid var(--border)",
                  borderRadius: "0.5rem",
                  padding: "1rem",
                }}
              >
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    marginBottom: "0.5rem",
                  }}
                >
                  <span style={{ fontWeight: 600, fontSize: "0.875rem" }}>
                    Turn v{turn.stateVersion}
                  </span>
                  <span style={{ fontSize: "0.75rem", color: "var(--muted)" }}>
                    {new Date(turn.createdAt).toLocaleString()}
                  </span>
                </div>

                <div style={{ fontSize: "0.875rem", marginBottom: "0.5rem" }}>
                  <strong>Input:</strong> {turn.input.text}
                </div>

                <div style={{ fontSize: "0.8rem", color: "var(--muted)" }}>
                  {turn.stateDeltaSummary}
                </div>

                {turn.result.narration.length > 0 && (
                  <div style={{ fontSize: "0.85rem", marginTop: "0.5rem", fontStyle: "italic" }}>
                    {turn.result.narration.map((n) => n.text).join(" ")}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
