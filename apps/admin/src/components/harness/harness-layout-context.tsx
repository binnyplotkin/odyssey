"use client";

import { createContext, useCallback, useContext, useEffect, useState } from "react";

/**
 * Holds the collapsed state of the harness left sidebar and right rail.
 * Persisted to localStorage so the choice survives reloads and route
 * navigations within the harness.
 *
 * Lives in its own provider rather than baked into HarnessShell so the
 * header content (which gets portal'd into the global AdminShell header)
 * can read + toggle the state from outside the shell's React subtree.
 */

type HarnessLayoutState = {
  leftCollapsed: boolean;
  rightCollapsed: boolean;
  toggleLeft: () => void;
  toggleRight: () => void;
};

const Ctx = createContext<HarnessLayoutState | null>(null);

// Versioned key so we can change the persisted shape later without
// inheriting confusing stale state from existing users.
const STORAGE_KEY = "odyssey.harness.layout.v1";

type Persisted = { leftCollapsed: boolean; rightCollapsed: boolean };

function readPersisted(): Persisted {
  // Default = both panels visible. SSR-safe: window check first.
  if (typeof window === "undefined") return { leftCollapsed: false, rightCollapsed: false };
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return { leftCollapsed: false, rightCollapsed: false };
    const parsed = JSON.parse(raw) as Partial<Persisted>;
    return {
      leftCollapsed: Boolean(parsed.leftCollapsed),
      rightCollapsed: Boolean(parsed.rightCollapsed),
    };
  } catch {
    return { leftCollapsed: false, rightCollapsed: false };
  }
}

export function HarnessLayoutProvider({ children }: { children: React.ReactNode }) {
  // Start with the SSR default (both visible) to keep the server-rendered
  // HTML stable; sync from localStorage on mount. The initial mismatch lasts
  // <1 frame and doesn't cause a visible flash because the sidebars use
  // width transitions, not display:none.
  const [leftCollapsed, setLeftCollapsed] = useState(false);
  const [rightCollapsed, setRightCollapsed] = useState(false);

  useEffect(() => {
    const persisted = readPersisted();
    setLeftCollapsed(persisted.leftCollapsed);
    setRightCollapsed(persisted.rightCollapsed);
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      window.localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({ leftCollapsed, rightCollapsed }),
      );
    } catch {
      // localStorage can throw in private mode / quota-exceeded — non-fatal.
    }
  }, [leftCollapsed, rightCollapsed]);

  const toggleLeft = useCallback(() => setLeftCollapsed((v) => !v), []);
  const toggleRight = useCallback(() => setRightCollapsed((v) => !v), []);

  return (
    <Ctx.Provider value={{ leftCollapsed, rightCollapsed, toggleLeft, toggleRight }}>
      {children}
    </Ctx.Provider>
  );
}

export function useHarnessLayout(): HarnessLayoutState {
  const v = useContext(Ctx);
  if (!v) throw new Error("useHarnessLayout must be called inside HarnessLayoutProvider");
  return v;
}
