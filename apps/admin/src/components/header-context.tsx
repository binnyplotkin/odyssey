"use client";

import { createContext, useContext, useState, useCallback, type ReactNode } from "react";

type HeaderContextValue = {
  content: ReactNode;
  setContent: (content: ReactNode) => void;
};

const HeaderContext = createContext<HeaderContextValue>({
  content: null,
  setContent: () => {},
});

export function HeaderProvider({ children }: { children: ReactNode }) {
  const [content, setContentState] = useState<ReactNode>(null);

  const setContent = useCallback((node: ReactNode) => {
    setContentState(node);
  }, []);

  return (
    <HeaderContext.Provider value={{ content, setContent }}>
      {children}
    </HeaderContext.Provider>
  );
}

export function useHeaderContent() {
  return useContext(HeaderContext);
}
