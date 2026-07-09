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
