export type DatabaseListMoveDirection = "top" | "up" | "down" | "bottom";

export type DatabaseListCommandId =
  | "open"
  | "select-only"
  | "toggle-selection"
  | `move-${DatabaseListMoveDirection}`;

export interface DatabaseListCommand {
  readonly id: DatabaseListCommandId;
  readonly label: string;
  readonly disabled: boolean;
  readonly section: "page" | "selection" | "position";
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
    section: "position",
  },
  {
    id: "move-up",
    label: "Move up",
    disabled: !canMoveUp,
    section: "position",
  },
  {
    id: "move-down",
    label: "Move down",
    disabled: !canMoveDown,
    section: "position",
  },
  {
    id: "move-bottom",
    label: "Move to bottom",
    disabled: !canMoveDown,
    section: "position",
  },
];

export function buildDatabaseListRowCommands({
  selected,
  canMoveUp,
  canMoveDown,
}: DatabaseListMoveCommandCapabilities & {
  readonly selected: boolean;
}): readonly DatabaseListCommand[] {
  return [
    {
      id: "open",
      label: "Open page",
      disabled: false,
      section: "page",
    },
    {
      id: "select-only",
      label: "Select only this row",
      disabled: false,
      section: "selection",
    },
    {
      id: "toggle-selection",
      label: selected ? "Remove from selection" : "Add to selection",
      disabled: false,
      section: "selection",
    },
    ...buildMoveCommands({ canMoveUp, canMoveDown }),
  ];
}

export function buildDatabaseListSelectionCommands(
  capabilities: DatabaseListMoveCommandCapabilities,
): readonly DatabaseListCommand[] {
  return buildMoveCommands(capabilities);
}

export function databaseListMoveDirection(
  commandId: DatabaseListCommandId,
): DatabaseListMoveDirection | null {
  if (!commandId.startsWith("move-")) return null;
  const direction = commandId.slice("move-".length);
  if (
    direction === "top"
    || direction === "up"
    || direction === "down"
    || direction === "bottom"
  ) return direction;
  return null;
}
