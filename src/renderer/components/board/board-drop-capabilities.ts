import type { BoardCardDragMode } from "./board-card-drop-strategy";

export interface BoardDropCapabilities {
  allowPageTargets: boolean;
  allowColumnTargets: boolean;
}

export function resolveBoardDropCapabilities(args: {
  dragMode: BoardCardDragMode;
}): BoardDropCapabilities {
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
