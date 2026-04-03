import type {
  CodexItemStatus,
  CodexTurnStatus,
} from "./types";

export function resolveCommandExecutionRenderStatus(input: {
  itemStatus?: CodexItemStatus;
  turnStatus?: CodexTurnStatus | null;
}): CodexItemStatus | undefined {
  if (input.itemStatus === "inProgress" && input.turnStatus === "interrupted") {
    return "interrupted";
  }

  return input.itemStatus;
}
