import { createContext, useContext, useMemo, type ReactNode } from "react";
import type { CodexHooksSettingsTarget } from "../../../lib/codex-hooks-route";

interface HookFeedbackSettingsNavigationValue {
  hostId: string;
  onOpenHooksSettings?: (target: CodexHooksSettingsTarget) => void;
}

const HookFeedbackSettingsNavigationContext =
  createContext<HookFeedbackSettingsNavigationValue | null>(null);

export function HookFeedbackSettingsNavigationProvider({
  hostId,
  onOpenHooksSettings,
  children,
}: HookFeedbackSettingsNavigationValue & { children: ReactNode }) {
  const value = useMemo(() => ({ hostId, onOpenHooksSettings }), [hostId, onOpenHooksSettings]);
  return (
    <HookFeedbackSettingsNavigationContext.Provider value={value}>
      {children}
    </HookFeedbackSettingsNavigationContext.Provider>
  );
}

export function useHookFeedbackSettingsNavigation(): HookFeedbackSettingsNavigationValue | null {
  return useContext(HookFeedbackSettingsNavigationContext);
}
