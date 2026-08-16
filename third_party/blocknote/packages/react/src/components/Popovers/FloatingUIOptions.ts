import {
  FloatingFocusManagerProps,
  UseDismissProps,
  UseFloatingOptions,
  UseHoverProps,
  UseTransitionStatusProps,
  UseTransitionStylesProps,
} from "@floating-ui/react";
import { HTMLAttributes } from "react";

export type FloatingUIOptions = {
  /**
   * Snapshot the rendered DOM for the exit transition instead of keeping the
   * React subtree live. Use this for floating surfaces whose children derive
   * from editor selection state and must not change while fading out.
   */
  freezeChildrenOnClose?: boolean;
  useFloatingOptions?: UseFloatingOptions;
  useTransitionStylesProps?: UseTransitionStylesProps;
  useTransitionStatusProps?: UseTransitionStatusProps;
  useDismissProps?: UseDismissProps;
  useHoverProps?: UseHoverProps;
  elementProps?: HTMLAttributes<HTMLDivElement>;
  /**
   * Props to pass to the `FloatingFocusManager` component.
   */
  focusManagerProps?: Omit<FloatingFocusManagerProps, "context" | "children">;
};
