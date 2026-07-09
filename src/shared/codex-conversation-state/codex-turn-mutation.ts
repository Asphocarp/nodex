import type {
  CodexCanonicalItem,
  CodexCanonicalTurnState,
} from "./codex-conversation-state";

export function replaceCodexCanonicalTurnAt(
  turns: readonly CodexCanonicalTurnState[],
  turnIndex: number,
  turn: CodexCanonicalTurnState,
): readonly CodexCanonicalTurnState[] {
  if (turns[turnIndex] === turn) {
    return turns;
  }

  const nextTurns = [...turns];
  nextTurns[turnIndex] = turn;
  return nextTurns;
}

/** Exact `_1` collection repair used before every request-caused item upsert. */
export function ensureCodexCanonicalTurnCollections(
  turn: CodexCanonicalTurnState,
): CodexCanonicalTurnState {
  if (turn.sidecar.hookRuns !== undefined) {
    return turn;
  }

  return {
    ...turn,
    sidecar: {
      ...turn.sidecar,
      hookRuns: [],
    },
  };
}

/** Exact `WQ`: replace the first same-ID row regardless of its item type. */
export function upsertCodexCanonicalItemById(
  items: readonly CodexCanonicalItem[],
  item: CodexCanonicalItem,
): readonly CodexCanonicalItem[] {
  const itemIndex = items.findIndex((candidate) => candidate.id === item.id);
  if (itemIndex < 0) {
    return [...items, item];
  }

  const nextItems = [...items];
  nextItems[itemIndex] = item;
  return nextItems;
}
