"use client";

import { useRouter } from "next/navigation";
import { useHarnessCharacter } from "../harness-character-context";
import { RunsView } from "../editors/test-regression";

/**
 * Renders the runs list + (optional) selected run drilldown for
 * `/harness/runs` and `/harness/runs/[runId]`.
 *
 * The existing RunsView component takes a `runId` + `onSelectRun` pair;
 * we map the callback to a router navigation so the URL stays the source
 * of truth.
 */
export function RunsRoutePage({ selectedRunId }: { selectedRunId?: string }) {
  const character = useHarnessCharacter();
  const router = useRouter();
  const harnessRoot = `/characters/${character.slug}/harness`;

  return (
    <div style={{ padding: "24px 32px 32px" }}>
      <RunsView
        characterId={character.id}
        characterSlug={character.slug}
        runId={selectedRunId ?? null}
        onSelectRun={(id) => {
          if (id) router.push(`${harnessRoot}/runs/${id}`);
          else router.push(`${harnessRoot}/runs`);
        }}
      />
    </div>
  );
}
