import type {
  CodexCanonicalConversationState,
  CodexCanonicalSteeringUserMessageItem,
} from "./codex-conversation-state";
import { upsertCodexCanonicalItemById } from "./codex-turn-mutation";

export function upsertCodexCanonicalSteeringItem(
  state: CodexCanonicalConversationState,
  turnId: string,
  item: CodexCanonicalSteeringUserMessageItem,
): CodexCanonicalConversationState {
  const turnIndex = state.turns.findIndex((turn) => turn.protocol.id === turnId);
  const turn = state.turns[turnIndex];
  if (!turn) return state;

  const items = upsertCodexCanonicalItemById(turn.items, item);
  if (items === turn.items) return state;

  const turns = [...state.turns];
  turns[turnIndex] = { ...turn, items };
  return { ...state, turns };
}

export function removeCodexCanonicalSteeringItem(
  state: CodexCanonicalConversationState,
  turnId: string,
  itemId: string,
): CodexCanonicalConversationState {
  const turnIndex = state.turns.findIndex((turn) => turn.protocol.id === turnId);
  const turn = state.turns[turnIndex];
  if (!turn) return state;

  const items = turn.items.filter((item) => item.id !== itemId);
  if (items.length === turn.items.length) return state;

  const turns = [...state.turns];
  turns[turnIndex] = { ...turn, items };
  return { ...state, turns };
}

export function retargetCodexCanonicalSteeringItem(
  state: CodexCanonicalConversationState,
  fromTurnId: string,
  toTurnId: string,
  itemId: string,
): CodexCanonicalConversationState {
  if (fromTurnId === toTurnId) return state;

  const sourceTurnIndex = state.turns.findIndex((turn) => turn.protocol.id === fromTurnId);
  const sourceTurn = state.turns[sourceTurnIndex];
  if (!sourceTurn) return state;

  const item = sourceTurn.items.find(
    (candidate): candidate is CodexCanonicalSteeringUserMessageItem =>
      candidate.type === "steeringUserMessage" && candidate.id === itemId,
  );
  if (!item) return state;

  const targetTurnIndex = state.turns.findIndex((turn) => turn.protocol.id === toTurnId);
  const targetTurn = state.turns[targetTurnIndex];
  if (!targetTurn) {
    const sourceItems = sourceTurn.items.map((candidate) =>
      candidate.id === itemId
        ? {
            ...item,
            targetTurnId: toTurnId,
            targetTurnStartedAtMs: null,
          }
        : candidate,
    );
    const turns = [...state.turns];
    turns[sourceTurnIndex] = { ...sourceTurn, items: sourceItems };
    return { ...state, turns };
  }

  const sourceItems = sourceTurn.items.filter((candidate) => candidate.id !== itemId);
  const retargetedItem: CodexCanonicalSteeringUserMessageItem = {
    ...item,
    targetTurnId: toTurnId,
    targetTurnStartedAtMs: targetTurn.sidecar.turnStartedAtMs,
  };
  const targetItems = upsertCodexCanonicalItemById(targetTurn.items, retargetedItem);
  const turns = [...state.turns];
  turns[sourceTurnIndex] = { ...sourceTurn, items: sourceItems };
  turns[targetTurnIndex] = { ...targetTurn, items: targetItems };
  return { ...state, turns };
}
