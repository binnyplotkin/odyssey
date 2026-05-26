import { Skeleton, SkeletonCard, SkeletonText } from "@odyssey/ui";
import type { ReactNode } from "react";

export function HarnessShellSkeleton() {
  return (
    <div
      style={{
        display: "flex",
        height: "calc(100vh - 48px)",
        background: "var(--background)",
        overflow: "hidden",
      }}
    >
      <SidebarSkeleton />
      <LayerRouteSkeleton />
      <PreviewRailSkeleton />
    </div>
  );
}

export function LayerRouteSkeleton() {
  return (
    <div
      style={{
        flex: 1,
        minWidth: 0,
        display: "flex",
        flexDirection: "column",
        overflow: "auto",
      }}
    >
      <header
        style={{
          padding: "24px 32px",
          borderBottom: "1px solid var(--border)",
          display: "flex",
          alignItems: "center",
          gap: "var(--space-16)",
          flexShrink: 0,
        }}
      >
        <div
          style={{
            flex: 1,
            minWidth: 0,
            display: "flex",
            flexDirection: "column",
            gap: "var(--space-8)",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: "var(--space-10)" }}>
            <Skeleton width={90} height={10} />
            <Skeleton width={88} height={10} static />
          </div>
          <Skeleton width={260} height={30} />
          <Skeleton width="58%" height={13} />
        </div>
        <div
          style={{
            display: "flex",
            gap: "var(--space-4)",
            padding: "var(--space-3)",
            border: "1px solid var(--card-border)",
            borderRadius: "var(--radius-sm)",
          }}
        >
          <Skeleton width={70} height={28} radius={4} static />
          <Skeleton width={86} height={28} radius={4} static />
        </div>
      </header>

      <div
        style={{
          padding: "28px 32px 40px",
          display: "grid",
          gridTemplateColumns: "minmax(0, 1fr) 280px",
          gap: "var(--space-24)",
        }}
      >
        <SkeletonCard padding={20}>
          <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-18)" }}>
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                gap: "var(--space-24)",
              }}
            >
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: "var(--space-8)",
                  flex: 1,
                }}
              >
                <Skeleton width={120} height={10} />
                <Skeleton width="72%" height={18} />
                <Skeleton width="50%" height={12} />
              </div>
              <Skeleton width={96} height={30} radius={6} />
            </div>
            <SkeletonText
              lines={5}
              lineHeight={13}
              gap={10}
              lastLineWidth="46%"
            />
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "1fr 1fr",
                gap: "var(--space-12)",
              }}
            >
              <Skeleton height={84} radius={8} static />
              <Skeleton height={84} radius={8} static />
            </div>
          </div>
        </SkeletonCard>
        <SkeletonCard padding={18}>
          <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-14)" }}>
            <Skeleton width={110} height={10} />
            <Skeleton height={36} radius={6} />
            <Skeleton height={36} radius={6} />
            <Skeleton height={92} radius={8} static />
          </div>
        </SkeletonCard>
      </div>
    </div>
  );
}

export function RunsRouteSkeleton({
  selected = false,
}: {
  selected?: boolean;
}) {
  return (
    <EvalRouteFrame>
      <RunsContentSkeleton selected={selected} />
    </EvalRouteFrame>
  );
}

export function RunsContentSkeleton({
  selected = false,
}: {
  selected?: boolean;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-24)" }}>
      <KpiSkeleton />
      {selected ? <RunDetailSkeleton /> : null}
      <ListSectionSkeleton titleWidth={120} rows={6} />
    </div>
  );
}

export function RunDetailSkeleton() {
  return (
    <SkeletonCard
      padding={0}
      style={{ borderColor: "#1F4D2F", overflow: "hidden" }}
    >
      <div
        style={{
          padding: "20px 22px",
          borderBottom: "1px solid #1A2A20",
          display: "flex",
          justifyContent: "space-between",
          gap: "var(--space-24)",
        }}
      >
        <div
          style={{ display: "flex", flexDirection: "column", gap: "var(--space-10)", flex: 1 }}
        >
          <Skeleton width={160} height={10} />
          <Skeleton width="54%" height={24} />
          <Skeleton width="72%" height={12} />
        </div>
        <Skeleton width={86} height={30} radius={6} />
      </div>
      <div
        style={{
          padding: "var(--space-20)",
          display: "grid",
          gridTemplateColumns: "repeat(4, 1fr)",
          gap: "var(--space-12)",
        }}
      >
        {Array.from({ length: 4 }).map((_, i) => (
          <MetricSkeleton key={i} />
        ))}
      </div>
      <div
        style={{
          padding: "0 20px 20px",
          display: "flex",
          flexDirection: "column",
          gap: "var(--space-10)",
        }}
      >
        {Array.from({ length: 4 }).map((_, i) => (
          <RowSkeleton key={i} />
        ))}
      </div>
    </SkeletonCard>
  );
}

export function SweepsRouteSkeleton({
  selected = false,
}: {
  selected?: boolean;
}) {
  return (
    <EvalRouteFrame>
      <SweepsContentSkeleton selected={selected} />
    </EvalRouteFrame>
  );
}

export function SweepsContentSkeleton({
  selected = false,
}: {
  selected?: boolean;
}) {
  return selected ? (
    <SweepDetailSkeleton />
  ) : (
    <section style={{ display: "flex", flexDirection: "column", gap: "var(--space-12)" }}>
      <SectionIntroSkeleton titleWidth={160} bodyWidth="64%" />
      <ListRows count={5} />
    </section>
  );
}

export function SweepDetailSkeleton() {
  return (
    <section style={{ display: "flex", flexDirection: "column", gap: "var(--space-24)" }}>
      <div
        style={{ display: "flex", justifyContent: "space-between", gap: "var(--space-24)" }}
      >
        <div
          style={{ display: "flex", flexDirection: "column", gap: "var(--space-8)", flex: 1 }}
        >
          <Skeleton width={230} height={10} />
          <Skeleton width={260} height={26} />
          <Skeleton width={220} height={11} />
        </div>
        <Skeleton width={92} height={30} radius={6} />
      </div>
      <SkeletonCard height={280} padding={20}>
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: "var(--space-16)",
            height: "100%",
          }}
        >
          <Skeleton width={180} height={14} />
          <Skeleton width="100%" height="100%" radius={8} static />
        </div>
      </SkeletonCard>
      <ListRows count={4} />
    </section>
  );
}

export function SuitesRouteSkeleton({
  mode = "list",
}: {
  mode?: "list" | "detail" | "editor";
}) {
  return (
    <EvalRouteFrame>
      <SuitesContentSkeleton mode={mode} />
    </EvalRouteFrame>
  );
}

export function SuitesContentSkeleton({
  mode = "list",
}: {
  mode?: "list" | "detail" | "editor";
}) {
  return mode === "detail" ? (
    <SuiteDetailSkeleton />
  ) : mode === "editor" ? (
    <SuiteEditorSkeleton />
  ) : (
    <section style={{ display: "flex", flexDirection: "column", gap: "var(--space-18)" }}>
      <SectionIntroSkeleton titleWidth={84} bodyWidth="70%" />
      <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-8)" }}>
        <Skeleton width={140} height={10} />
        <ListRows count={5} />
      </div>
    </section>
  );
}

export function SuiteDetailSkeleton() {
  return (
    <section style={{ display: "flex", flexDirection: "column", gap: "var(--space-20)" }}>
      <div
        style={{ display: "flex", justifyContent: "space-between", gap: "var(--space-24)" }}
      >
        <div
          style={{ display: "flex", flexDirection: "column", gap: "var(--space-8)", flex: 1 }}
        >
          <Skeleton width={150} height={10} />
          <Skeleton width={260} height={26} />
          <Skeleton width="62%" height={12} />
        </div>
        <div style={{ display: "flex", gap: "var(--space-8)" }}>
          <Skeleton width={88} height={30} radius={6} />
          <Skeleton width={112} height={30} radius={6} />
        </div>
      </div>
      {Array.from({ length: 3 }).map((_, i) => (
        <SkeletonCard key={i} padding={18}>
          <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-12)" }}>
            <Skeleton width={140} height={12} />
            <SkeletonText lines={3} lineHeight={12} gap={8} />
            <Skeleton width="70%" height={42} radius={6} static />
          </div>
        </SkeletonCard>
      ))}
    </section>
  );
}

export function SuiteEditorSkeleton() {
  return (
    <section
      style={{
        display: "grid",
        gridTemplateColumns: "minmax(0, 1fr) 280px",
        gap: "var(--space-20)",
      }}
    >
      <SkeletonCard padding={18}>
        <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-16)" }}>
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              gap: "var(--space-18)",
            }}
          >
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                gap: "var(--space-8)",
                flex: 1,
              }}
            >
              <Skeleton width={120} height={10} />
              <Skeleton width={240} height={24} />
            </div>
            <Skeleton width={106} height={30} radius={6} />
          </div>
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} width="100%" height={92} radius={8} static />
          ))}
        </div>
      </SkeletonCard>
      <SkeletonCard padding={16}>
        <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-12)" }}>
          <Skeleton width={100} height={10} />
          <SkeletonText lines={6} lineHeight={12} gap={8} />
        </div>
      </SkeletonCard>
    </section>
  );
}

export function HistoryRouteSkeleton() {
  return (
    <EvalRouteFrame>
      <SectionIntroSkeleton titleWidth={160} bodyWidth="54%" />
      <ListRows count={7} />
    </EvalRouteFrame>
  );
}

export function PromptSkeleton() {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-10)" }}>
      <Skeleton width="82%" height={12} />
      <Skeleton width="96%" height={12} />
      <Skeleton width="68%" height={12} />
      <Skeleton width="90%" height={12} />
      <Skeleton width="58%" height={12} />
      <div style={{ height: 8 }} />
      <Skeleton width="92%" height={12} static />
      <Skeleton width="76%" height={12} static />
      <Skeleton width="88%" height={12} static />
    </div>
  );
}

export function LaunchSummarySkeleton() {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-10)" }}>
      <FieldSkeleton />
      <FieldSkeleton width={120} />
      <FieldSkeleton width={56} />
    </div>
  );
}

export function ActivityListSkeleton() {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-8)" }}>
      {Array.from({ length: 4 }).map((_, i) => (
        <div
          key={i}
          style={{
            display: "flex",
            alignItems: "center",
            gap: "var(--space-10)",
            padding: "var(--space-10)",
            borderRadius: "var(--radius-sm)",
            background: "var(--background)",
          }}
        >
          <Skeleton width={6} height={6} variant="circle" static />
          <div
            style={{
              flex: 1,
              display: "flex",
              flexDirection: "column",
              gap: "var(--space-6)",
            }}
          >
            <Skeleton width={i % 2 === 0 ? "68%" : "56%"} height={11} />
            <Skeleton width={i % 2 === 0 ? "82%" : "74%"} height={10} static />
          </div>
        </div>
      ))}
    </div>
  );
}

function SidebarSkeleton() {
  return (
    <aside
      style={{
        width: 280,
        flexShrink: 0,
        background: "var(--sidebar-glass)",
        borderRight: "1px solid var(--border)",
        padding: "24px 20px",
        display: "flex",
        flexDirection: "column",
        gap: "var(--space-18)",
      }}
    >
      <div style={{ display: "flex", gap: "var(--space-12)", alignItems: "center" }}>
        <Skeleton width={40} height={40} radius={6} />
        <div
          style={{ flex: 1, display: "flex", flexDirection: "column", gap: "var(--space-6)" }}
        >
          <Skeleton width="70%" height={14} />
          <Skeleton width="42%" height={10} />
        </div>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-8)" }}>
        {Array.from({ length: 12 }).map((_, i) => (
          <Skeleton
            key={i}
            width={i % 4 === 0 ? "78%" : "100%"}
            height={24}
            radius={4}
            static={i > 4}
          />
        ))}
      </div>
    </aside>
  );
}

function PreviewRailSkeleton() {
  return (
    <aside
      style={{
        width: 480,
        flexShrink: 0,
        background: "var(--sidebar-glass)",
        borderLeft: "1px solid var(--border)",
        display: "flex",
        flexDirection: "column",
      }}
    >
      <div
        style={{
          padding: "18px 20px",
          borderBottom: "1px solid var(--border)",
          display: "flex",
          gap: "var(--space-12)",
        }}
      >
        <Skeleton width={150} height={10} />
        <div style={{ flex: 1 }} />
        <Skeleton width={52} height={24} radius={3} static />
        <Skeleton width={70} height={24} radius={3} static />
      </div>
      <div style={{ padding: "var(--space-20)", flex: 1 }}>
        <PromptSkeleton />
      </div>
      <div style={{ padding: "var(--space-20)", borderTop: "1px solid var(--border)" }}>
        <Skeleton height={40} radius={10} />
      </div>
    </aside>
  );
}

function EvalRouteFrame({ children }: { children: ReactNode }) {
  return (
    <div
      style={{
        padding: "24px 32px 32px",
        display: "flex",
        flexDirection: "column",
        gap: "var(--space-24)",
      }}
    >
      {children}
    </div>
  );
}

function KpiSkeleton() {
  return (
    <section
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(5, minmax(0, 1fr))",
        border: "1px solid var(--card-border)",
        borderRadius: "var(--radius-lg)",
        background: "var(--card)",
        overflow: "hidden",
      }}
    >
      {Array.from({ length: 5 }).map((_, i) => (
        <div
          key={i}
          style={{
            padding: "18px 20px",
            borderRight: i < 4 ? "1px solid var(--card-border)" : undefined,
          }}
        >
          <MetricSkeleton spark={i === 4} />
        </div>
      ))}
    </section>
  );
}

function MetricSkeleton({ spark = false }: { spark?: boolean }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-8)" }}>
      <Skeleton width={spark ? 110 : 92} height={10} />
      <Skeleton
        width={spark ? "90%" : 66}
        height={spark ? 26 : 28}
        radius={spark ? 6 : 4}
        static={spark}
      />
      {!spark ? <Skeleton width={74} height={10} static /> : null}
    </div>
  );
}

function ListSectionSkeleton({
  titleWidth,
  rows,
}: {
  titleWidth: number;
  rows: number;
}) {
  return (
    <section style={{ display: "flex", flexDirection: "column", gap: "var(--space-12)" }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
        }}
      >
        <Skeleton width={titleWidth} height={18} />
        <Skeleton width={96} height={10} />
      </div>
      <ListRows count={rows} />
    </section>
  );
}

function SectionIntroSkeleton({
  titleWidth,
  bodyWidth,
}: {
  titleWidth: number;
  bodyWidth: number | string;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-8)" }}>
      <Skeleton width={titleWidth} height={20} />
      <Skeleton width={bodyWidth} height={13} />
    </div>
  );
}

function ListRows({ count }: { count: number }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-8)" }}>
      {Array.from({ length: count }).map((_, i) => (
        <RowSkeleton key={i} />
      ))}
    </div>
  );
}

function RowSkeleton() {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: "var(--space-18)",
        padding: "16px 18px",
        borderRadius: "var(--radius-md)",
        background: "var(--card)",
        border: "1px solid var(--card-border)",
      }}
    >
      <div
        style={{ flex: 1, display: "flex", flexDirection: "column", gap: "var(--space-8)" }}
      >
        <Skeleton width="44%" height={12} />
        <Skeleton width="66%" height={10} static />
      </div>
      <Skeleton width={70} height={12} />
      <Skeleton width={54} height={12} static />
      <Skeleton width={14} height={12} static />
    </div>
  );
}

function FieldSkeleton({ width = 150 }: { width?: number }) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: "var(--space-8)",
      }}
    >
      <Skeleton width={58} height={10} static />
      <Skeleton width={width} height={11} />
    </div>
  );
}
