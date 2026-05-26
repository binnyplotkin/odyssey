"use client";

import { useHarnessCharacter } from "./harness-character-context";
import { HarnessEditorPane } from "./harness-editor-pane";
import type { LayerDef } from "./harness-types";

/**
 * Client wrapper around the existing HarnessEditorPane. Reads the
 * character from context so the route page can stay tiny + server.
 *
 * Long-term this can absorb the editor pane and we'd drop one indirection,
 * but keeping HarnessEditorPane intact lets the L01-L04 editors stay
 * untouched for this routing refactor.
 */
export function LayerPage({ layer }: { layer: LayerDef }) {
  const character = useHarnessCharacter();
  return <HarnessEditorPane character={character} layer={layer} />;
}
