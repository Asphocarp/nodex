import { useCallback } from "react";
import { invoke } from "./use-codex-thread-follower-client-deps";
import type {
  CodexCollaborationModeKind,
  CodexPermissionMode,
  CodexReasoningEffort,
  CodexServiceTier,
  CodexThreadActionResult,
  CodexTurnStartOptions,
  CodexTurnSummary,
} from "./types";
import {
  buildCodexServiceTierRequestOverride,
  resolveCodexRequestServiceTier,
} from "./codex-service-tier-settings";
import { useCodexServiceTierSettings } from "./use-codex-service-tier-settings";

interface UseCodexThreadFollowerClientInput {
  projectId: string;
  permissionMode: CodexPermissionMode;
  model: string;
  reasoningEffort: CodexReasoningEffort;
}

export function useCodexThreadFollowerClient(input: UseCodexThreadFollowerClientInput) {
  const { serviceTierSettings } = useCodexServiceTierSettings();

  const buildTurnStartOptions = useCallback((
    overrides?: {
      collaborationMode?: CodexCollaborationModeKind | null;
      serviceTier?: CodexServiceTier;
    },
  ): CodexTurnStartOptions => {
    const effectiveServiceTier = resolveCodexRequestServiceTier(overrides, serviceTierSettings.serviceTier);
    return {
      permissionMode: input.permissionMode,
      model: input.model,
      reasoningEffort: input.reasoningEffort,
      collaborationMode: overrides?.collaborationMode ?? undefined,
      ...buildCodexServiceTierRequestOverride(effectiveServiceTier),
    };
  }, [input.model, input.permissionMode, input.reasoningEffort, serviceTierSettings.serviceTier]);

  const startTurn = useCallback(async (
    threadId: string,
    prompt: string,
    opts?: { collaborationMode?: CodexCollaborationModeKind | null; serviceTier?: CodexServiceTier },
  ) => {
    return (await invoke(
      "codex:turn:start",
      threadId,
      prompt,
      buildTurnStartOptions(opts),
    )) as CodexTurnSummary | null;
  }, [buildTurnStartOptions]);

  const enqueueQueuedFollowUp = useCallback(async (
    threadId: string,
    prompt: string,
    opts?: { collaborationMode?: CodexCollaborationModeKind | null; serviceTier?: CodexServiceTier },
  ) => {
    return (await invoke(
      "codex:thread:follow-up:enqueue",
      threadId,
      prompt,
      buildTurnStartOptions(opts),
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
    const effectiveServiceTier = resolveCodexRequestServiceTier(undefined, serviceTierSettings.serviceTier);
    return (await invoke(
      "codex:thread:edit-last-user-turn",
      threadId,
      turnId,
      message,
      buildCodexServiceTierRequestOverride(effectiveServiceTier),
    )) as CodexThreadActionResult;
  }, [serviceTierSettings.serviceTier]);

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
