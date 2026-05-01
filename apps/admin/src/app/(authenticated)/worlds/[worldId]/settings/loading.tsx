import { Skeleton } from "@odyssey/ui";

const CARD: React.CSSProperties = {
  background: "var(--card)",
  border: "1px solid var(--card-border)",
  borderRadius: 12,
};

function Field({ label, control = 32 }: { label: number; control?: number | string }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <Skeleton width={label} height={11} />
      <Skeleton
        width="100%"
        height={typeof control === "number" ? control : undefined}
        style={typeof control === "string" ? { height: control } : undefined}
        radius={6}
      />
    </div>
  );
}

function Section({
  titleWidth,
  children,
}: {
  titleWidth: number;
  children: React.ReactNode;
}) {
  return (
    <div style={{ ...CARD, padding: "18px 20px", display: "flex", flexDirection: "column", gap: 14 }}>
      <Skeleton width={titleWidth} height={13} />
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>{children}</div>
    </div>
  );
}

export default function WorldSettingsLoading() {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16, maxWidth: 720 }}>
      <Section titleWidth={120}>
        <Field label={56} />
        <Field label={72} />
        <Field label={64} control={72} />
      </Section>

      <Section titleWidth={140}>
        <Field label={56} />
        <Field label={64} />
      </Section>

      <Section titleWidth={120}>
        <Field label={88} control={88} />
      </Section>

      <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
        <Skeleton width={88} height={32} radius={8} />
        <Skeleton width={120} height={32} radius={8} />
      </div>
    </div>
  );
}
