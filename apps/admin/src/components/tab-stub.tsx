"use client";

export function TabStub({ title, description }: { title: string; description: string }) {
  return (
    <div style={{
      display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
      padding: "5rem 2rem", gap: "var(--space-14)", textAlign: "center",
    }}>
      <div style={{
        width: 56, height: 56, borderRadius: "50%",
        background: "var(--panel)", border: "1px solid var(--border)",
        display: "flex", alignItems: "center", justifyContent: "center",
      }}>
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="var(--muted)" strokeWidth="1.5" strokeLinecap="round">
          <path d="M12 8v4" />
          <path d="M12 16h.01" />
          <circle cx="12" cy="12" r="10" />
        </svg>
      </div>
      <h2 style={{ fontFamily: "'Space Grotesk', sans-serif", fontSize: 20, fontWeight: 600, margin: 0, color: "var(--foreground)" }}>
        {title}
      </h2>
      <p style={{ fontFamily: "'Inter', sans-serif", fontSize: "var(--font-size-md)", color: "var(--muted)", margin: 0, maxWidth: 440, lineHeight: 1.55 }}>
        {description}
      </p>
    </div>
  );
}
