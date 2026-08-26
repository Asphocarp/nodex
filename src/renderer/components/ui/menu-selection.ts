import type { MouseEvent as ReactMouseEvent, MouseEventHandler } from "react";

export type NodexMenuSelectHandler = (event: Event) => void;

type BaseUiMouseEvent<Element extends HTMLElement> = ReactMouseEvent<Element> & {
  preventBaseUIHandler: () => void;
};

/** Preserves Nodex's preventable selection contract while Base UI owns dismissal. */
export function handleNodexMenuItemClick<Element extends HTMLElement>(
  event: BaseUiMouseEvent<Element>,
  onClick: MouseEventHandler<Element> | undefined,
  onSelect: NodexMenuSelectHandler | undefined,
): void {
  onClick?.(event);
  onSelect?.(event.nativeEvent);

  if (!event.defaultPrevented && !event.nativeEvent.defaultPrevented) return;
  event.preventBaseUIHandler();
}
