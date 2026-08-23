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

export function listCodexBackgroundTerminalTurnIds(
  state: CodexCanonicalConversationState,
): readonly string[] {
  const latestTurnIndex = state.turns.length - 1;
  return [
    ...new Set(
      state.turns.flatMap((turn, index) =>
        !(index === latestTurnIndex && turn.protocol.status === "inProgress") &&
        turn.protocol.id !== null &&
        turn.items.some(
          (item) =>
            item.type === "commandExecution" &&
            item.status === "inProgress" &&
            !(turn.sidecar.interruptedCommandExecutionItemIds ?? []).includes(item.id),
        )
          ? [turn.protocol.id]
          : [],
      ),
    ),
  ];
}

export function reduceCodexBackgroundTerminalCleanup(
  state: CodexCanonicalConversationState,
): CodexCanonicalConversationState {
  const latestTurnIndex = state.turns.length - 1;
  const turns = state.turns.map((turn, index) =>
    index === latestTurnIndex && turn.protocol.status === "inProgress"
      ? turn
      : interruptRunningCommands(turn),
  );
  return turns.some((turn, index) => turn !== state.turns[index]) ? { ...state, turns } : state;
}
