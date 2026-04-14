import { notFound } from "next/navigation";
import { getWorldRepository } from "@odyssey/db";

export const dynamic = "force-dynamic";

export default async function WorldDetailPage({
  params,
}: {
  params: Promise<{ worldId: string }>;
}) {
  const { worldId } = await params;
  const detail = await getWorldRepository().getWorldDetail(worldId);

  if (!detail) {
    notFound();
  }

  const { world, source, editable } = detail;

  return (
    <div>
      <div style={{ marginBottom: "1.5rem" }}>
        <a href="/worlds" style={{ color: "var(--accent)", fontSize: "0.875rem" }}>
          &larr; Back to Worlds
        </a>
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", marginBottom: "1.5rem" }}>
        <h1 style={{ fontSize: "1.5rem", fontWeight: 700 }}>{world.title}</h1>
        <span
          style={{
            display: "inline-block",
            padding: "0.125rem 0.5rem",
            borderRadius: "9999px",
            fontSize: "0.75rem",
            fontWeight: 500,
            background: source === "static" ? "#f3f4f6" : "#dbeafe",
            color: source === "static" ? "#4b5563" : "#1e40af",
          }}
        >
          {source}{editable ? " (editable)" : ""}
        </span>
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          gap: "1.5rem",
          marginBottom: "2rem",
        }}
      >
        <section
          style={{
            background: "var(--panel)",
            border: "1px solid var(--border)",
            borderRadius: "0.5rem",
            padding: "1rem",
          }}
        >
          <h2 style={{ fontSize: "0.875rem", fontWeight: 600, color: "var(--muted)", marginBottom: "0.5rem" }}>
            Setting
          </h2>
          <p style={{ fontSize: "0.875rem", lineHeight: 1.5 }}>{world.setting}</p>
        </section>

        <section
          style={{
            background: "var(--panel)",
            border: "1px solid var(--border)",
            borderRadius: "0.5rem",
            padding: "1rem",
          }}
        >
          <h2 style={{ fontSize: "0.875rem", fontWeight: 600, color: "var(--muted)", marginBottom: "0.5rem" }}>
            Premise
          </h2>
          <p style={{ fontSize: "0.875rem", lineHeight: 1.5 }}>{world.premise}</p>
        </section>
      </div>

      <section style={{ marginBottom: "2rem" }}>
        <h2 style={{ fontSize: "1rem", fontWeight: 600, marginBottom: "0.75rem" }}>
          Characters ({world.characters.length})
        </h2>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: "0.75rem" }}>
          {world.characters.map((character) => (
            <div
              key={character.id}
              style={{
                background: "var(--panel)",
                border: "1px solid var(--border)",
                borderRadius: "0.5rem",
                padding: "1rem",
              }}
            >
              <div style={{ fontWeight: 600, marginBottom: "0.25rem" }}>{character.name}</div>
              <div style={{ fontSize: "0.8rem", color: "var(--muted)", marginBottom: "0.25rem" }}>
                {character.title} &middot; {character.archetype}
              </div>
              <div style={{ fontSize: "0.8rem", color: "var(--muted)", marginBottom: "0.25rem" }}>
                Group: {(character.groupIds ?? (character.groupId ? [character.groupId] : [])).join(", ")}
              </div>
              {character.backstory && (
                <div style={{ fontSize: "0.8rem", marginTop: "0.5rem", lineHeight: 1.4 }}>
                  {character.backstory}
                </div>
              )}
              {character.tags && character.tags.length > 0 && (
                <div style={{ display: "flex", gap: "0.25rem", flexWrap: "wrap", marginTop: "0.5rem" }}>
                  {character.tags.map((tag) => (
                    <span
                      key={tag}
                      style={{
                        fontSize: "0.7rem",
                        padding: "0.1rem 0.4rem",
                        borderRadius: "9999px",
                        background: "rgba(232, 121, 160, 0.15)",
                        color: "#E879A0",
                      }}
                    >
                      {tag}
                    </span>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      </section>

      <section style={{ marginBottom: "2rem" }}>
        <h2 style={{ fontSize: "1rem", fontWeight: 600, marginBottom: "0.75rem" }}>
          Groups ({world.groups.length})
        </h2>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: "0.75rem" }}>
          {world.groups.map((group) => (
            <div
              key={group.id}
              style={{
                background: "var(--panel)",
                border: "1px solid var(--border)",
                borderRadius: "0.5rem",
                padding: "1rem",
              }}
            >
              <div style={{ fontWeight: 600, marginBottom: "0.25rem" }}>{group.name}</div>
              <div style={{ fontSize: "0.8rem", color: "var(--muted)", marginBottom: "0.25rem" }}>
                Influence: {group.influence} &middot; {group.disposition}
                {group.powerType && <> &middot; {group.powerType}</>}
              </div>
              <div style={{ fontSize: "0.8rem", marginBottom: "0.25rem" }}>{group.description}</div>
              {group.backstory && (
                <div style={{ fontSize: "0.8rem", color: "var(--muted)", marginTop: "0.25rem" }}>{group.backstory}</div>
              )}
              {group.tags && group.tags.length > 0 && (
                <div style={{ display: "flex", gap: "0.25rem", flexWrap: "wrap", marginTop: "0.5rem" }}>
                  {group.tags.map((tag) => (
                    <span
                      key={tag}
                      style={{
                        fontSize: "0.7rem",
                        padding: "0.1rem 0.4rem",
                        borderRadius: "9999px",
                        background: "rgba(109, 184, 137, 0.15)",
                        color: "#6DB889",
                      }}
                    >
                      {tag}
                    </span>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      </section>

      <section>
        <h2 style={{ fontSize: "1rem", fontWeight: 600, marginBottom: "0.75rem" }}>
          Initial State
        </h2>
        <pre
          style={{
            background: "var(--panel)",
            border: "1px solid var(--border)",
            borderRadius: "0.5rem",
            padding: "1rem",
            fontSize: "0.8rem",
            overflow: "auto",
            maxHeight: 400,
          }}
        >
          {JSON.stringify(world.initialState, null, 2)}
        </pre>
      </section>
    </div>
  );
}
