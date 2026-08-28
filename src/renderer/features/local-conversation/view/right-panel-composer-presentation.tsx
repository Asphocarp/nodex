import { createContext, useContext, useMemo, type ReactNode } from "react";

export type RightPanelComposerPresentation = "default" | "compact" | "compact-hovered" | "expanded";

export const RIGHT_PANEL_COMPOSER_ACCESSORY_INLINE_INSET_CLASS =
  "mx-[var(--right-panel-composer-accessory-inline-inset,0px)]";

export const RIGHT_PANEL_COMPOSER_ACCESSORY_FROSTED_SURFACE_CLASS =
  "bg-token-input-background/70 backdrop-blur-sm";

interface RightPanelComposerPresentationContextValue {
  floating: boolean;
  presentation: RightPanelComposerPresentation;
  visible: boolean;
}

const DEFAULT_PRESENTATION: RightPanelComposerPresentationContextValue = {
  floating: false,
  presentation: "default",
  visible: true,
};

const RightPanelComposerPresentationContext =
  createContext<RightPanelComposerPresentationContextValue>(DEFAULT_PRESENTATION);

export function RightPanelComposerPresentationProvider({
  children,
  presentation,
  visible,
}: {
  children: ReactNode;
  presentation: RightPanelComposerPresentation;
  visible: boolean;
}) {
  const value = useMemo(() => ({ floating: true, presentation, visible }), [presentation, visible]);
  return (
    <RightPanelComposerPresentationContext.Provider value={value}>
      {children}
    </RightPanelComposerPresentationContext.Provider>
  );
}

export function useRightPanelComposerPresentation(): RightPanelComposerPresentationContextValue {
  return useContext(RightPanelComposerPresentationContext);
}

export function isCompactRightPanelComposerPresentation(
  presentation: RightPanelComposerPresentation,
): boolean {
  return presentation === "compact" || presentation === "compact-hovered";
}
