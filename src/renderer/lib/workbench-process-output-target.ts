import type {
  CodexBackgroundTerminalProcessRow,
} from "@/lib/codex-background-terminal-processes";
import type {
  CodexBackgroundTerminalRow,
  CodexConversationItem,
  CodexConversationSnapshot,
} from "@/lib/types";
import type { ProcessOutputPanelTarget } from "@/lib/workbench-panel-tab-model";

export function findProcessOutputCommandItem(
  conversation: CodexConversationSnapshot | null | undefined,
  itemId: string,
  turnId?: string | null,
): CodexConversationItem | null {
  if (!conversation) return null;

  const candidateTurns = turnId
    ? conversation.turns.filter((turn) => turn.turnId === turnId)
    : conversation.turns;
  for (const turn of candidateTurns) {
    const item = turn.items.find(
      (candidate) =>
        candidate.itemId === itemId
        && candidate.kind === "commandExecution",
    );
    if (item) return item;
  }

  return null;
}

export function buildProcessOutputTargetFromManagerRow(
  row: CodexBackgroundTerminalProcessRow,
  conversation: CodexConversationSnapshot | null | undefined,
): ProcessOutputPanelTarget {
  const item = findProcessOutputCommandItem(
    conversation,
    row.itemId,
    row.turnId,
  );
  return {
    threadId: row.threadId,
    turnId: item?.turnId ?? row.turnId,
    itemId: row.itemId,
    command: item?.command ?? row.command,
    cwd: item?.cwd ?? row.cwd,
    terminalSessionId: row.terminalSessionId,
  };
}

export function buildProcessOutputTargetFromSummaryRow(
  threadId: string,
  row: CodexBackgroundTerminalRow,
): ProcessOutputPanelTarget {
  return {
    threadId,
    turnId: row.turnId,
    itemId: row.id,
    command: row.command,
    cwd: row.cwd,
    terminalSessionId: null,
  };
}
