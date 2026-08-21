import type {
  CodexCanonicalConversationState,
  CodexCanonicalTurnState,
} from "./codex-conversation-state";

function interruptRunningCommands(turn: CodexCanonicalTurnState): CodexCanonicalTurnState {
  const runningIds = turn.items.flatMap((item) =>
    item.type === "commandExecution" && item.status === "inProgress" ? [item.id] : [],
  );
  if (runningIds.length === 0) return turn;
  const interrupted = new Set(turn.sidecar.interruptedCommandExecutionItemIds ?? []);
  const previousSize = interrupted.size;
  for (const itemId of runningIds) interrupted.add(itemId);
  if (interrupted.size === previousSize) return turn;
  return {
    ...turn,
    sidecar: {
      ...turn.sidecar,
      interruptedCommandExecutionItemIds: [...interrupted],
    },
  };
}

export function reduceCodexBackgroundTerminalCleanup(
  state: CodexCanonicalConversationState,
): CodexCanonicalConversationState {
  const turns = state.turns.map(interruptRunningCommands);
  return turns.some((turn, index) => turn !== state.turns[index]) ? { ...state, turns } : state;
}
