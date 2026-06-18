import type { FloatingUIOptions } from "@blocknote/react";

export const NFM_SUGGESTION_MENU_PORTAL_ELEMENT: HTMLElement | null = null;
export const NFM_SUGGESTION_MENU_Z_INDEX = 80;
export const NFM_SUGGESTION_MENU_TOOLTIP_Z_INDEX = NFM_SUGGESTION_MENU_Z_INDEX + 1;

export const NFM_SUGGESTION_MENU_FLOATING_OPTIONS = {
  useFloatingOptions: {
    strategy: "fixed",
  },
  elementProps: {
    style: {
      zIndex: NFM_SUGGESTION_MENU_Z_INDEX,
    },
  },
} satisfies FloatingUIOptions;
