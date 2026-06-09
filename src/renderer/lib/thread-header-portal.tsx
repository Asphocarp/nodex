import { createContext, useContext, type ReactNode } from "react";

const ThreadHeaderPortalTargetContext = createContext<HTMLElement | null>(null);

export function ThreadHeaderPortalProvider({
  children,
  target,
}: {
  children: ReactNode;
  target: HTMLElement | null;
}) {
  return (
    <ThreadHeaderPortalTargetContext.Provider value={target}>
      {children}
    </ThreadHeaderPortalTargetContext.Provider>
  );
}

export function useThreadHeaderPortalTarget(): HTMLElement | null {
  return useContext(ThreadHeaderPortalTargetContext);
}
