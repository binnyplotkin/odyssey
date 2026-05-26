"use client";

import { useRouter } from "next/navigation";
import { useHarnessCharacter } from "../harness-character-context";
import { SweepsView } from "../editors/test-regression";

/**
 * Renders the sweeps list + (optional) sweep detail for
 * `/harness/sweeps` and `/harness/sweeps/[sweepId]`.
 */
export function SweepsRoutePage({ selectedSweepId }: { selectedSweepId?: string }) {
  const character = useHarnessCharacter();
  const router = useRouter();
  const harnessRoot = `/characters/${character.slug}/harness`;

  return (
    <div style={{ padding: "24px 32px 32px" }}>
      <SweepsView
        characterId={character.id}
        sweepId={selectedSweepId ?? null}
        onSelectSweep={(id) => {
          if (id) router.push(`${harnessRoot}/sweeps/${id}`);
          else router.push(`${harnessRoot}/sweeps`);
        }}
      />
    </div>
  );
}
