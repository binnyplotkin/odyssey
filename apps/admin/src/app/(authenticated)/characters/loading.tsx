import { Skeleton } from "@odyssey/ui";

const PANEL: React.CSSProperties = {
  background: "var(--panel)",
  border: "1px solid var(--border)",
};

function CardSkeleton() {
  return (
    <div
      style={{
        ...PANEL,
        width: 363,
        borderRadius: 14,
        overflow: "hidden",
        display: "flex",
        flexDirection: "column",
      }}
    >
      {/* Gradient header */}
      <div style={{ position: "relative", height: 128, background: "var(--card-hover)" }}>
        <div style={{ position: "absolute", top: 14, right: 14 }}>
          <Skeleton width={56} height={20} radius={999} static />
        </div>
      </div>

      {/* Body */}
      <div
        style={{
          padding: "16px 18px 18px 18px",
          display: "flex",
          flexDirection: "column",
          gap: 18,
        }}
      >
        {/* Avatar + title row */}
        <div style={{ position: "relative", marginTop: -44, minHeight: 56 }}>
          <div
            style={{
              position: "absolute",
              top: 17,
              left: 0,
              width: 56,
              height: 56,
              borderRadius: "50%",
              boxShadow: "0 0 0 3px var(--background)",
              background: "var(--panel)",
              overflow: "hidden",
            }}
          >
            <Skeleton width="100%" height="100%" variant="circle" />
          </div>
          <div
            style={{
              paddingLeft: 78,
              paddingTop: 34,
              display: "flex",
              flexDirection: "column",
              gap: 6,
            }}
          >
            <Skeleton width="60%" height={18} />
            <Skeleton width={80} height={10} />
          </div>
        </div>

        {/* Description */}
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <Skeleton width="100%" height={13} />
          <Skeleton width="80%" height={13} />
        </div>

        {/* Stats row */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 20,
            padding: "12px 0",
            borderTop: "1px solid var(--border)",
            borderBottom: "1px solid var(--border)",
          }}
        >
          {[0, 1, 2].map((i) => (
            <div key={i} style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <Skeleton width={28} height={22} />
              <Skeleton width={40} height={9} />
            </div>
          ))}
          <div
            style={{
              marginLeft: "auto",
              display: "flex",
              flexDirection: "column",
              alignItems: "flex-end",
              gap: 4,
            }}
          >
            <Skeleton width={64} height={13} />
            <Skeleton width={56} height={9} />
          </div>
        </div>

        {/* Footer */}
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <Skeleton width={12} height={12} variant="circle" />
          <Skeleton width={140} height={12} />
        </div>
      </div>
    </div>
  );
}

export default function CharactersLoading() {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      {/* Toolbar */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 16,
          flexWrap: "wrap",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          <div
            style={{
              ...PANEL,
              display: "flex",
              alignItems: "center",
              gap: 8,
              padding: "0.5rem 0.75rem",
              borderRadius: 10,
              width: 320,
            }}
          >
            <Skeleton width={14} height={14} variant="circle" />
            <Skeleton width={140} height={13} />
          </div>
          <Skeleton width={180} height={11} />
        </div>
        <Skeleton width={200} height={32} radius={999} />
      </div>

      {/* Card grid */}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 20 }}>
        {Array.from({ length: 6 }).map((_, i) => (
          <CardSkeleton key={i} />
        ))}
      </div>
    </div>
  );
}
