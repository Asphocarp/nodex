import { useEffect, useEffectEvent } from "react";
import { monitorForElements } from "@atlaskit/pragmatic-drag-and-drop/element/adapter";

type ElementMonitorArgs = Parameters<typeof monitorForElements>[0];
type CanMonitor = NonNullable<ElementMonitorArgs["canMonitor"]>;
type OnDragStart = NonNullable<ElementMonitorArgs["onDragStart"]>;
type OnDrag = NonNullable<ElementMonitorArgs["onDrag"]>;
type OnDrop = NonNullable<ElementMonitorArgs["onDrop"]>;

interface UseKanbanElementDragMonitorOptions {
  readonly scopeKey: symbol;
  readonly canMonitor: CanMonitor;
  readonly onDragStart: OnDragStart;
  readonly onDrag: OnDrag;
  readonly onDrop: OnDrop;
}

/**
 * Keeps one Pragmatic monitor subscribed for the lifetime of a Kanban board.
 * Effect Events provide current render state without tearing down the monitor
 * during an active drag.
 */
export function useKanbanElementDragMonitor({
  scopeKey,
  canMonitor,
  onDragStart,
  onDrag,
  onDrop,
}: UseKanbanElementDragMonitorOptions): void {
  const readCanMonitor = useEffectEvent(canMonitor);
  const handleDragStart = useEffectEvent(onDragStart);
  const handleDrag = useEffectEvent(onDrag);
  const handleDrop = useEffectEvent(onDrop);

  useEffect(() => {
    const cleanup = monitorForElements({
      canMonitor: (args) => readCanMonitor(args),
      onDragStart: (args) => handleDragStart(args),
      onDrag: (args) => handleDrag(args),
      onDrop: (args) => handleDrop(args),
    });
    return cleanup;
  }, [scopeKey]);
}
