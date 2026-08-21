export type DatabaseListMoveDirection = "top" | "up" | "down" | "bottom";

export type DatabaseListCommandId = `move-${DatabaseListMoveDirection}`;

export interface DatabaseListCommand {
  readonly id: DatabaseListCommandId;
  readonly label: string;
  readonly disabled: boolean;
}

interface DatabaseListMoveCommandCapabilities {
  readonly canMoveUp: boolean;
  readonly canMoveDown: boolean;
}

const buildMoveCommands = ({
  canMoveUp,
  canMoveDown,
}: DatabaseListMoveCommandCapabilities): readonly DatabaseListCommand[] => [
  {
    id: "move-top",
    label: "Move to top",
    disabled: !canMoveUp,
  },
  {
    id: "move-up",
    label: "Move up",
    disabled: !canMoveUp,
  },
  {
    id: "move-down",
    label: "Move down",
    disabled: !canMoveDown,
  },
  {
    id: "move-bottom",
    label: "Move to bottom",
    disabled: !canMoveDown,
  },
];

export function buildDatabaseListSelectionCommands(
  capabilities: DatabaseListMoveCommandCapabilities,
): readonly DatabaseListCommand[] {
  return buildMoveCommands(capabilities);
}

export function databaseListMoveDirection(
  commandId: DatabaseListCommandId,
): DatabaseListMoveDirection | null {
  const direction = commandId.slice("move-".length);
  if (direction === "top" || direction === "up" || direction === "down" || direction === "bottom")
    return direction;
  return null;
}
