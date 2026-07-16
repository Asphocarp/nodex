import type { KanbanCardDragMode } from "./kanban-card-drop-strategy";

export interface KanbanDropCapabilities {
  allowPageTargets: boolean;
  allowColumnTargets: boolean;
}

export function resolveKanbanDropCapabilities(args: {
  dragMode: KanbanCardDragMode;
}): KanbanDropCapabilities {
  if (args.dragMode.kind === "derived-move-only") {
    return {
      allowPageTargets: false,
      allowColumnTargets: true,
    };
  }

  return {
    allowPageTargets: true,
    allowColumnTargets: true,
  };
}
