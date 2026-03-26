import { useCallback, useEffect, useMemo, useReducer, useState } from "react";
import { invoke, subscribeCodexEvents } from "./api";
import {
  readCodexPermissionModes,
  writeCodexPermissionModes,
} from "./codex-permission-mode-settings";
import {
  resolveCodexReasoningEffortOptions,
  resolveCodexThreadSettings,
} from "./codex-thread-settings";
import {
  codexControlStoreReducer,
  createInitialCodexControlState,
} from "./codex-control-store";
import type {
  CodexApprovalDecision,
  CodexCollaborationModeKind,
  CodexCollaborationModePreset,
  CodexModelOption,
  CodexMcpServerElicitationAction,
  CodexPermissionMode,
  CodexThreadSettings,
  CodexThreadStartForCardInput,
  CodexThreadSummary,
  CodexTurnStartOptions,
  CodexTurnSummary,
} from "./types";
import { useCodexThreadSettings } from "./use-codex-thread-settings";

function resolveProjectPermissionMode(
  permissionModeByProject: Record<string, CodexPermissionMode>,
  projectId: string,
): CodexPermissionMode {
  return permissionModeByProject[projectId] ?? "custom";
}

export function useCodexControl(activeProjectId: string) {
  const [state, dispatch] = useReducer(codexControlStoreReducer, undefined, createInitialCodexControlState);
  const [availableModels, setAvailableModels] = useState<CodexModelOption[]>([]);
  const {
    settings: storedThreadSettings,
    updateSettings: updateStoredThreadSettings,
  } = useCodexThreadSettings();

  const loadModels = useCallback(async () => {
    const models = (await invoke("codex:model:list")) as CodexModelOption[];
    setAvailableModels(models);
    return models;
  }, []);

  const listCollaborationModes = useCallback(async () => {
    return (await invoke("codex:collaboration-mode:list")) as CodexCollaborationModePreset[];
  }, []);

  const loadThreads = useCallback(
    async (projectId: string, opts?: { cardId?: string; includeArchived?: boolean }) => {
      const threads = (await invoke("codex:threads:list", projectId, opts)) as CodexThreadSummary[];
      dispatch({ type: "setThreads", projectId, threads });
      return threads;
    },
    [],
  );

  const startThreadForCard = useCallback(
    async (input: CodexThreadStartForCardInput) => {
      const resolvedSettings = resolveCodexThreadSettings(storedThreadSettings, availableModels);
      const detail = (await invoke("codex:thread:start-for-card", {
        ...input,
        permissionMode: resolveProjectPermissionMode(state.permissionModeByProject, input.projectId),
        model: input.model ?? resolvedSettings.model,
        reasoningEffort: resolvedSettings.reasoningEffort,
      })) as { threadId: string; projectId: string };
      await loadThreads(input.projectId);
      return detail;
    },
    [availableModels, loadThreads, state.permissionModeByProject, storedThreadSettings],
  );

  const setThreadName = useCallback(async (threadId: string, name: string, projectId: string) => {
    const result = (await invoke("codex:thread:name:set", threadId, name)) as boolean;
    if (result) {
      await loadThreads(projectId);
    }
    return result;
  }, [loadThreads]);

  const archiveThread = useCallback(async (threadId: string, projectId: string) => {
    const result = (await invoke("codex:thread:archive", threadId)) as boolean;
    if (result) await loadThreads(projectId);
    return result;
  }, [loadThreads]);

  const unarchiveThread = useCallback(async (threadId: string, projectId: string) => {
    const result = (await invoke("codex:thread:unarchive", threadId)) as CodexThreadSummary | null;
    await loadThreads(projectId, { includeArchived: true });
    return result;
  }, [loadThreads]);

  const startTurn = useCallback(async (
    threadId: string,
    prompt: string,
    opts?: { projectId?: string; collaborationMode?: CodexCollaborationModeKind },
  ) => {
    dispatch({
      type: "event",
      event: {
        type: "threadStatus",
        threadId,
        statusType: "active",
        statusActiveFlags: [],
      },
    });

    try {
      const resolvedSettings = resolveCodexThreadSettings(storedThreadSettings, availableModels);
      const resolvedProjectId = opts?.projectId ?? activeProjectId;
      const turnOpts: CodexTurnStartOptions = {
        permissionMode: resolveProjectPermissionMode(state.permissionModeByProject, resolvedProjectId),
        model: resolvedSettings.model,
        reasoningEffort: resolvedSettings.reasoningEffort,
        collaborationMode: opts?.collaborationMode,
      };
      const turn = (await invoke("codex:turn:start", threadId, prompt, turnOpts)) as CodexTurnSummary | null;
      if (turn) {
        dispatch({
          type: "event",
          event: {
            type: "threadStatus",
            threadId,
            statusType: "active",
            statusActiveFlags: [],
          },
        });
      }
      return turn;
    } catch (error) {
      dispatch({
        type: "event",
        event: {
          type: "threadStatus",
          threadId,
          statusType: "idle",
          statusActiveFlags: [],
        },
      });
      throw error;
    }
  }, [activeProjectId, availableModels, state.permissionModeByProject, storedThreadSettings]);

  const enqueueQueuedFollowUp = useCallback(async (
    threadId: string,
    prompt: string,
    opts?: { projectId?: string; collaborationMode?: CodexCollaborationModeKind | null },
  ) => {
    const resolvedSettings = resolveCodexThreadSettings(storedThreadSettings, availableModels);
    const resolvedProjectId = opts?.projectId ?? activeProjectId;
    const turnOpts: CodexTurnStartOptions = {
      permissionMode: resolveProjectPermissionMode(state.permissionModeByProject, resolvedProjectId),
      model: resolvedSettings.model,
      reasoningEffort: resolvedSettings.reasoningEffort,
      collaborationMode: opts?.collaborationMode ?? undefined,
    };
    return (await invoke("codex:thread:follow-up:enqueue", threadId, prompt, turnOpts)) as void;
  }, [activeProjectId, availableModels, state.permissionModeByProject, storedThreadSettings]);

  const steerTurn = useCallback(async (threadId: string, turnId: string, prompt: string) => {
    const promptText = prompt.trim();
    if (!promptText) {
      throw new Error("Turn steer requires a non-empty prompt");
    }

    return (await invoke(
      "codex:turn:steer",
      threadId,
      turnId,
      promptText,
    )) as { turnId: string } | null;
  }, []);

  const interruptTurn = useCallback(async (threadId: string, turnId?: string) => {
    return (await invoke("codex:turn:interrupt", threadId, turnId)) as boolean;
  }, []);

  const respondApproval = useCallback(async (requestId: string, decision: CodexApprovalDecision) => {
    return (await invoke("codex:approval:respond", requestId, decision)) as boolean;
  }, []);

  const respondUserInput = useCallback(async (requestId: string, answers: Record<string, string[]>) => {
    return (await invoke("codex:user-input:respond", requestId, answers)) as boolean;
  }, []);

  const respondMcpElicitation = useCallback(async (requestId: string, action: CodexMcpServerElicitationAction) => {
    return (await invoke("codex:mcp-elicitation:respond", requestId, action)) as boolean;
  }, []);

  const setPermissionMode = useCallback(async (projectId: string, mode: CodexPermissionMode) => {
    dispatch({ type: "setPermissionMode", projectId, mode });
    await invoke("codex:permission:mode:set", projectId, mode);
  }, []);

  const setThreadModel = useCallback((model: string) => {
    updateStoredThreadSettings({ model });
  }, [updateStoredThreadSettings]);

  const setThreadReasoningEffort = useCallback((reasoningEffort: CodexThreadSettings["reasoningEffort"]) => {
    if (!reasoningEffort) return;

    updateStoredThreadSettings({ reasoningEffort });
  }, [updateStoredThreadSettings]);

  useEffect(() => {
    const stored = readCodexPermissionModes();
    Object.entries(stored).forEach(([projectId, mode]) => {
      dispatch({ type: "setPermissionMode", projectId, mode });
      void invoke("codex:permission:mode:set", projectId, mode).catch(() => {
        // ignore main-process availability errors on boot
      });
    });
  }, []);

  useEffect(() => {
    writeCodexPermissionModes(state.permissionModeByProject);
  }, [state.permissionModeByProject]);

  useEffect(() => {
    void loadModels().catch(() => {
      setAvailableModels([]);
    });
  }, [loadModels]);

  useEffect(() => {
    if (!activeProjectId) return;

    void loadThreads(activeProjectId).catch(() => {
      // ignore thread list reload errors; callers surface failures when they need them
    });
  }, [activeProjectId, loadThreads]);

  useEffect(() => {
    return subscribeCodexEvents((event) => {
      dispatch({ type: "event", event });
    });
  }, []);

  const threads = useMemo(
    () => state.threadsByProject[activeProjectId] ?? [],
    [activeProjectId, state.threadsByProject],
  );
  const threadSettings = useMemo(
    () => resolveCodexThreadSettings(storedThreadSettings, availableModels),
    [availableModels, storedThreadSettings],
  );
  const reasoningEffortOptions = useMemo(
    () => resolveCodexReasoningEffortOptions(threadSettings.model, availableModels),
    [availableModels, threadSettings.model],
  );
  const permissionMode = state.permissionModeByProject[activeProjectId] ?? "custom";

  return {
    state,
    threads,
    availableModels,
    threadSettings,
    reasoningEffortOptions,
    permissionMode,
    loadThreads,
    loadModels,
    listCollaborationModes,
    startThreadForCard,
    setThreadName,
    archiveThread,
    unarchiveThread,
    startTurn,
    enqueueQueuedFollowUp,
    steerTurn,
    interruptTurn,
    respondApproval,
    respondUserInput,
    respondMcpElicitation,
    setPermissionMode,
    setThreadModel,
    setThreadReasoningEffort,
  };
}
