"use client";

import { useRouter } from "next/navigation";
import { useHarnessCharacter } from "../harness-character-context";
import { SuitesView } from "../editors/test-regression";

/**
 * Renders the suites list, the read-only explorer for a selected suite,
 * or the SuiteEditor when `editing` is true.
 *
 * Maps URL state → SuitesView callback props:
 *   /harness/suites                 → list (selectedSuiteId=null)
 *   /harness/suites/:id             → read-only explorer
 *   /harness/suites/:id/edit        → SuiteEditor on the draft
 *
 * The existing SuitesView accepts these as in-component state via
 * `editing` + `onStart/StopEditing` + `onSelectSuite` callbacks; we wire
 * those to router.push so the URL stays the source of truth.
 */
export function SuitesRoutePage({
  selectedSuiteId,
  editing,
}: {
  selectedSuiteId?: string;
  editing?: boolean;
}) {
  const character = useHarnessCharacter();
  const router = useRouter();
  const harnessRoot = `/characters/${character.slug}/harness`;

  return (
    <div style={{ padding: "24px 32px 32px" }}>
      <SuitesView
        characterId={character.id}
        suiteId={selectedSuiteId ?? null}
        editing={editing ?? false}
        onSelectSuite={(id) => {
          if (id) router.push(`${harnessRoot}/suites/${id}`);
          else router.push(`${harnessRoot}/suites`);
        }}
        onStartEditing={(id) => router.push(`${harnessRoot}/suites/${id}/edit`)}
        onStopEditing={() => {
          if (selectedSuiteId) router.push(`${harnessRoot}/suites/${selectedSuiteId}`);
          else router.push(`${harnessRoot}/suites`);
        }}
      />
    </div>
  );
}
