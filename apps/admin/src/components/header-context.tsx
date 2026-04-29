"use client";

import { createContext, useContext, useState, useCallback, type ReactNode } from "react";

type HeaderContextValue = {
  content: ReactNode;
  setContent: (content: ReactNode) => void;
  /** When true, the page area is rendered without the default 2rem padding. */
  flush: boolean;
  setFlush: (flush: boolean) => void;
};

const HeaderContext = createContext<HeaderContextValue>({
  content: null,
  setContent: () => {},
  flush: false,
  setFlush: () => {},
});

export function HeaderProvider({ children }: { children: ReactNode }) {
  const [content, setContentState] = useState<ReactNode>(null);
  const [flush, setFlushState] = useState(false);

  const setContent = useCallback((node: ReactNode) => {
    setContentState(node);
  }, []);

  const setFlush = useCallback((value: boolean) => {
    setFlushState(value);
  }, []);

  return (
    <HeaderContext.Provider value={{ content, setContent, flush, setFlush }}>
      {children}
    </HeaderContext.Provider>
  );
}

export function useHeaderContent() {
  return useContext(HeaderContext);
}
