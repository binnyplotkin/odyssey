import { Skeleton } from "@odyssey/ui";

const CARD_SHELL: React.CSSProperties = {
  background: "var(--card)",
  border: "1px solid var(--card-border)",
  borderRadius: 14,
  overflow: "hidden",
};

function IdentityCardSkeleton() {
  return (
    <div style={CARD_SHELL}>
      {/* Gradient header */}
      <div
        style={{
          position: "relative",
          height: 112,
          background: "var(--card-hover)",
        }}
      >
        <div style={{ position: "absolute", top: 14, right: 14 }}>
          <Skeleton width={64} height={20} radius={999} static />
        </div>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 14, padding: "16px 20px 20px 20px" }}>
        {/* Avatar + title row */}
        <div style={{ position: "relative", marginTop: -44, minHeight: 64 }}>
          <div
            style={{
              position: "absolute",
              top: 13,
              left: 0,
              width: 64,
              height: 64,
              borderRadius: "50%",
              boxShadow: "0 0 0 3px var(--background)",
              overflow: "hidden",
              background: "var(--panel)",
            }}
          >
            <Skeleton width="100%" height="100%" variant="circle" />
          </div>
          <div
            style={{
              paddingLeft: 86,
              paddingTop: 38,
              display: "flex",
              flexDirection: "column",
              gap: 6,
            }}
          >
            <Skeleton width="55%" height={22} />
            <Skeleton width={100} height={13} />
          </div>
        </div>

        {/* Summary lines */}
        <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
          <Skeleton width="100%" height={13} />
          <Skeleton width="92%" height={13} />
          <Skeleton width="68%" height={13} />
        </div>

        {/* Action chips */}
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <Skeleton width={88} height={24} radius={999} static />
          <Skeleton width={70} height={24} radius={999} static />
        </div>

        {/* Stats row */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 28,
            paddingTop: 14,
            borderTop: "1px solid var(--card-border)",
          }}
        >
          {[0, 1, 2, 3].map((i) => (
            <div key={i} style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <Skeleton width={28} height={22} />
              <Skeleton width={56} height={9} />
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
      </div>
    </div>
  );
}

function VoiceIdentityCardSkeleton() {
  return (
    <div style={{ ...CARD_SHELL, padding: "16px 20px 20px 20px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 14 }}>
        <Skeleton width={14} height={14} variant="circle" />
        <Skeleton width={120} height={13} />
        <div style={{ flex: 1 }} />
        <Skeleton width={72} height={20} radius={999} static />
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <Skeleton width="100%" height={12} />
        <Skeleton width="80%" height={12} />
        <Skeleton width="65%" height={12} />
      </div>
    </div>
  );
}

function SideCardSkeleton({ rows = 4 }: { rows?: number }) {
  return (
    <div style={{ ...CARD_SHELL, padding: "16px 20px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 16 }}>
        <Skeleton width={100} height={13} />
        <div style={{ flex: 1 }} />
        <Skeleton width={56} height={20} radius={999} static />
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {Array.from({ length: rows }).map((_, i) => (
          <div
            key={i}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              padding: "10px 12px",
              borderRadius: 8,
              border: "1px solid var(--card-border)",
            }}
          >
            <Skeleton width={28} height={28} variant="circle" />
            <div style={{ display: "flex", flexDirection: "column", gap: 5, flex: 1 }}>
              <Skeleton width="55%" height={12} />
              <Skeleton width="35%" height={10} />
            </div>
            <Skeleton width={36} height={11} />
          </div>
        ))}
      </div>
    </div>
  );
}

export default function CharacterDetailLoading() {
  return (
    <div style={{ display: "flex", flexDirection: "row", gap: 20 }}>
      <div style={{ display: "flex", flexDirection: "column", gap: 20, flex: "1 1 0", minWidth: 0 }}>
        <IdentityCardSkeleton />
        <VoiceIdentityCardSkeleton />
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 20, width: 420, flexShrink: 0 }}>
        <SideCardSkeleton rows={4} />
        <SideCardSkeleton rows={2} />
      </div>
    </div>
  );
}
