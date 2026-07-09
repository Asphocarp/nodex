import type { Thread } from "@nodex/codex-app-server-protocol/v2";
import {
  createCodexCanonicalConversationState,
  type CodexCanonicalConversationState,
  type CodexCanonicalTurnParams,
} from "./codex-conversation-state";

export function replaceCodexCanonicalRollbackThread(
  state: CodexCanonicalConversationState,
  thread: Thread,
): CodexCanonicalConversationState | null {
  if (state.protocol.id !== thread.id) return null;
  const turnParamsById: Record<string, CodexCanonicalTurnParams> = {};
  for (const turn of thread.turns) {
    const existing = state.turns.find((candidate) => candidate.protocol.id === turn.id);
    if (!existing) return null;
    turnParamsById[turn.id] = existing.sidecar.params;
  }

  const rebuilt = createCodexCanonicalConversationState(thread, {
    turnParamsById,
    pendingRequests: [],
    hasUnreadTurn: false,
    hydrationContext: state.sidecar.hydrationContext,
  });
  return {
    ...rebuilt,
    sidecar: {
      ...state.sidecar,
      ...rebuilt.sidecar,
      hasUnreadTurn: false,
    },
  };
}
