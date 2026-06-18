import type { FloatingUIOptions } from "@blocknote/react";
import { flip, offset, shift } from "@floating-ui/react";

export const NFM_TEXT_ACTION_MENU_FLOATING_OPTIONS = {
  useFloatingOptions: {
    placement: "bottom-start",
    transform: false,
    middleware: [
      offset(({ rects }) => ({
        crossAxis: rects.reference.width,
      })),
      shift(),
      flip(),
    ],
  },
  useTransitionStylesProps: {
    duration: {
      open: 100,
      close: 100,
    },
    initial: {
      opacity: 0,
      transform: "scale(0.97)",
    },
    open: {
      opacity: 1,
      transform: "scale(1)",
    },
    close: {
      opacity: 0,
      transform: "scale(0.97)",
    },
    common: {
      transitionTimingFunction: "ease",
      transitionDelay: "30ms",
      transformOrigin: "112px center",
      willChange: "opacity, transform",
    },
  },
  focusManagerProps: {
    disabled: true,
  },
  elementProps: {
    className: "notion-text-action-menu pointer-events-none",
    style: {
      zIndex: 40,
      transformOrigin: "112px center",
    },
  },
} satisfies FloatingUIOptions;
