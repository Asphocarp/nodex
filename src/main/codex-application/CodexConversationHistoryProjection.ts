import type { Turn } from "@nodex/codex-app-server-protocol/v2";
import type { CodexCanonicalConversationState } from "../../shared/types";
import {
  createCodexCanonicalHydratedConversationState,
  mergeCodexCanonicalOlderTurnStates,
} from "../../shared/codex-conversation-state/codex-conversation-state";

/** Pure history materialization from raw app-server Turns into the canonical aggregate. */
export const projectCodexConversationOlderTurns = (input: {
  readonly current: CodexCanonicalConversationState;
  readonly olderTurns: readonly Turn[];
  readonly oldestLoadedTurnId: string | null;
}): CodexCanonicalConversationState => {
  const hydration = input.current.sidecar.hydrationContext;
  if (!hydration) {
    throw new Error(
      `Cannot merge canonical history for '${input.current.protocol.id}' without hydration context`,
    );
  }

  const latestParams = input.current.turns.at(-1)?.sidecar.params ?? null;
  const latestSettings = hydration.latestThreadSettings;
  const currentPermissions = hydration.currentPermissions;
  const cwd = latestSettings?.cwd ?? hydration.cwd ?? latestParams?.cwd ?? "/";
  const page = createCodexCanonicalHydratedConversationState(
    { ...input.current.protocol, turns: [...input.olderTurns] },
    {
      model: input.current.sidecar.latestThreadSettings?.model ?? hydration.latestModel,
      reasoningEffort:
        input.current.sidecar.latestThreadSettings?.effort ?? hydration.latestReasoningEffort,
      cwd,
      approvalPolicy:
        latestSettings?.approvalPolicy ??
        latestParams?.approvalPolicy ??
        currentPermissions.approvalPolicy,
      approvalsReviewer:
        latestSettings?.approvalsReviewer ??
        latestParams?.approvalsReviewer ??
        currentPermissions.approvalsReviewer,
      sandboxPolicy:
        latestSettings?.sandboxPolicy ??
        latestParams?.sandboxPolicy ??
        currentPermissions.sandboxPolicy,
      activePermissionProfile: null,
      runtimeWorkspaceRoots: [],
      pendingRequests: input.current.requests,
      hasUnreadTurn: input.current.sidecar.hasUnreadTurn,
    },
  );

  return {
    ...input.current,
    turns: mergeCodexCanonicalOlderTurnStates({
      olderTurns: page.turns,
      currentTurns: input.current.turns,
      oldestLoadedTurnId: input.oldestLoadedTurnId,
    }),
  };
};
