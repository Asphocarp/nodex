import { useEffect, useMemo, useState } from "react";
import { useThreadStageModel } from "../use-thread-stage-model";
import type {
  ThreadBodyUiStateOverrides,
  ThreadStageActions,
  ThreadStageModelInput,
} from "../thread-stage-types";
import {
  requestLocalConversationResume,
  useComposerIntent,
  useConversation,
  useConversationSubset,
  useDismissedPlanImplementationTurnIds,
  useLocalConversationAccount,
  useLocalConversationConnection,
} from "../local-conversation-store";
import { invoke } from "@/lib/api";
import { resolveThreadCardStatus } from "./shared/thread-card-fetch";
import { LocalConversationStageScreen } from "./local-conversation-stage-screen";

type ConnectedThreadStageInput = Omit<
  ThreadStageModelInput,
  | "conversation"
  | "knownConversationsById"
  | "dismissedPlanImplementationTurnIdByThread"
  | "connection"
  | "account"
  | "composerIntent"
  | "activeThreadCardColumnId"
>;

interface ConnectedThreadStageProps extends ConnectedThreadStageInput {
  actions: ThreadStageActions;
  initialUiState?: ThreadBodyUiStateOverrides;
}

export function ConnectedThreadStage({
  actions,
  initialUiState,
  ...input
}: ConnectedThreadStageProps) {
  const connection = useLocalConversationConnection();
  const account = useLocalConversationAccount();
  const conversation = useConversation(
    input.activeThreadId && !input.isNewThreadTab ? input.activeThreadId : null,
  );
  const composerIntent = useComposerIntent(
    input.activeThreadId && !input.isNewThreadTab ? input.activeThreadId : null,
  );

  const mergedConversation = useMemo(() => {
    if (!conversation) {
      return null;
    }

    if (!input.activeThreadSummary) {
      return conversation;
    }

    return {
      ...conversation,
      statusType: input.activeThreadSummary.statusType,
      statusActiveFlags: input.activeThreadSummary.statusActiveFlags,
      updatedAt: Math.max(conversation.updatedAt, input.activeThreadSummary.updatedAt),
    };
  }, [conversation, input.activeThreadSummary]);

  const childThreadIds = useMemo(
    () => mergedConversation?.childMemberships.map((membership) => membership.threadId) ?? [],
    [mergedConversation],
  );
  const knownConversationsById = useConversationSubset(childThreadIds);
  const dismissedPlanImplementationTurnIdByThread = useDismissedPlanImplementationTurnIds(
    input.activeThreadId
      ? [input.activeThreadId, ...childThreadIds]
      : childThreadIds,
  );
  const [activeThreadCardColumnId, setActiveThreadCardColumnId] = useState<string | null>(null);

  useEffect(() => {
    if (!input.activeThreadId || input.isNewThreadTab) {
      return;
    }

    const resumeState = mergedConversation?.resumeState ?? "needs_resume";
    if (resumeState === "resuming" || resumeState === "resumed") {
      return;
    }

    void requestLocalConversationResume(input.activeThreadId).catch(() => {});
  }, [input.activeThreadId, input.isNewThreadTab, mergedConversation?.resumeState]);

  useEffect(() => {
    const activeThreadCardId = mergedConversation?.cardId;
    const activeThreadProjectId = mergedConversation?.projectId ?? input.projectId;
    if (!activeThreadCardId || !activeThreadProjectId) {
      setActiveThreadCardColumnId(null);
      return;
    }

    let cancelled = false;
    void invoke("card:get", activeThreadProjectId, activeThreadCardId)
      .then((result) => {
        if (cancelled) return;
        setActiveThreadCardColumnId(resolveThreadCardStatus(result));
      })
      .catch(() => {
        if (cancelled) return;
        setActiveThreadCardColumnId(null);
      });

    return () => {
      cancelled = true;
    };
  }, [input.projectId, mergedConversation?.cardId, mergedConversation?.projectId]);

  const threadStageInput = useMemo<ThreadStageModelInput>(() => ({
    ...input,
    activeThreadCardColumnId,
    conversation: mergedConversation,
    knownConversationsById,
    dismissedPlanImplementationTurnIdByThread,
    connection,
    account,
    composerIntent,
  }), [
    account,
    activeThreadCardColumnId,
    composerIntent,
    connection,
    dismissedPlanImplementationTurnIdByThread,
    input,
    knownConversationsById,
    mergedConversation,
  ]);

  const { model } = useThreadStageModel(threadStageInput, actions);

  return (
    <LocalConversationStageScreen
      model={model}
      actions={actions}
      initialUiState={initialUiState}
    />
  );
}
