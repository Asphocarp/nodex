import { useCallback } from "react";
import { invoke } from "./api";
import type {
  CodexCollaborationModeKind,
  CodexPermissionMode,
  CodexReasoningEffort,
  CodexThreadActionResult,
  CodexTurnStartOptions,
  CodexTurnSummary,
} from "./types";

interface UseCodexThreadFollowerClientInput {
  projectId: string;
  permissionMode: CodexPermissionMode;
  model: string;
  reasoningEffort: CodexReasoningEffort;
}

export function useCodexThreadFollowerClient(input: UseCodexThreadFollowerClientInput) {
  const buildTurnStartOptions = useCallback((collaborationMode?: CodexCollaborationModeKind | null): CodexTurnStartOptions => ({
    permissionMode: input.permissionMode,
    model: input.model,
    reasoningEffort: input.reasoningEffort,
    collaborationMode: collaborationMode ?? undefined,
  }), [input.model, input.permissionMode, input.reasoningEffort]);

  const startTurn = useCallback(async (
    threadId: string,
    prompt: string,
    opts?: { collaborationMode?: CodexCollaborationModeKind | null },
  ) => {
    return (await invoke(
      "codex:turn:start",
      threadId,
      prompt,
      buildTurnStartOptions(opts?.collaborationMode),
    )) as CodexTurnSummary | null;
  }, [buildTurnStartOptions]);

  const enqueueQueuedFollowUp = useCallback(async (
    threadId: string,
    prompt: string,
    opts?: { collaborationMode?: CodexCollaborationModeKind | null },
  ) => {
    return (await invoke(
      "codex:thread:follow-up:enqueue",
      threadId,
      prompt,
      buildTurnStartOptions(opts?.collaborationMode),
    )) as void;
  }, [buildTurnStartOptions]);

  const removeQueuedFollowUp = useCallback(async (threadId: string, followUpId: string) => {
    return (await invoke("codex:thread:follow-up:remove", threadId, followUpId)) as void;
  }, []);

  const reorderQueuedFollowUps = useCallback(async (threadId: string, orderedFollowUpIds: string[]) => {
    return (await invoke("codex:thread:follow-up:reorder", threadId, orderedFollowUpIds)) as void;
  }, []);

  const sendQueuedFollowUpNow = useCallback(async (threadId: string, followUpId: string) => {
    return (await invoke("codex:thread:follow-up:send-now", threadId, followUpId)) as void;
  }, []);

  const steerTurn = useCallback(async (threadId: string, turnId: string, prompt: string) => {
    return (await invoke("codex:turn:steer", threadId, turnId, prompt)) as { turnId: string } | null;
  }, []);

  const interruptTurn = useCallback(async (threadId: string, turnId?: string) => {
    return (await invoke("codex:turn:interrupt", threadId, turnId)) as boolean;
  }, []);

  const cleanBackgroundTerminals = useCallback(async (threadId: string) => {
    return (await invoke("codex:thread:background-terminals:clean", threadId)) as boolean;
  }, []);

  const editLastUserTurn = useCallback(async (threadId: string, turnId: string, message: string) => {
    return (await invoke("codex:thread:edit-last-user-turn", threadId, turnId, message)) as CodexThreadActionResult;
  }, []);

  const forkConversationFromTurn = useCallback(async (threadId: string, turnId: string, message: string) => {
    return (await invoke("codex:thread:fork-from-turn", threadId, turnId, message)) as CodexThreadActionResult;
  }, []);

  return {
    projectId: input.projectId,
    startTurn,
    enqueueQueuedFollowUp,
    removeQueuedFollowUp,
    reorderQueuedFollowUps,
    sendQueuedFollowUpNow,
    steerTurn,
    interruptTurn,
    cleanBackgroundTerminals,
    editLastUserTurn,
    forkConversationFromTurn,
  };
}
