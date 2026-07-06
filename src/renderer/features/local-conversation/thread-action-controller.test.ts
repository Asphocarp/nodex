import { describe, expect, test } from "bun:test";
import { createThreadStageActions, type ThreadActionControllerInput } from "./thread-action-controller";

function buildInput(overrides?: Partial<ThreadActionControllerInput>): ThreadActionControllerInput {
  const settingsUpdates: unknown[] = [];
  const draftModes: string[] = [];
  const draftModels: string[] = [];
  const draftReasoning: string[] = [];

  return {
    activeThreadId: "thread_1",
    accountActions: {
      refreshAccount: async () => ({
        account: null,
        requiresOpenAiAuth: false,
        pendingLogin: null,
        rateLimits: null,
      }),
      startChatGptLogin: async () => ({ type: "apiKey" }),
      startApiKeyLogin: async () => ({ type: "apiKey" }),
      cancelLogin: async () => ({ status: "canceled" }),
      logout: async () => true,
    } as ThreadActionControllerInput["accountActions"],
    codexControl: {
      setConversationThreadSettings: async (threadId: string, patch: unknown) => {
        settingsUpdates.push({ threadId, patch });
        return {
          model: "gpt-5.3-codex",
          reasoningEffort: "high",
          collaborationMode: {
            mode: "plan",
            settings: {
              model: "gpt-5.3-codex",
              reasoning_effort: "high",
              developer_instructions: null,
            },
          },
        };
      },
      setThreadModel: (model: string) => {
        draftModels.push(model);
      },
      setThreadReasoningEffort: (reasoningEffort: string) => {
        draftReasoning.push(reasoningEffort);
      },
    } as unknown as ThreadActionControllerInput["codexControl"],
    currentSessionProjectId: "project_1",
    projectId: "project_1",
    selectedCollaborationMode: "default",
    setSelectedCollaborationMode: (mode) => {
      draftModes.push(mode);
    },
    onOpenThread: () => {},
    onOpenTurnDiffReview: () => {},
    onEnsureBlankSessionForProject: async () => ({ id: "session_1" }) as never,
    onRefreshProjectSessions: async () => [],
    onQueueingEnabledChange: () => {},
    onNewThreadProjectChange: () => {},
    onRequestNewChatProjectCreate: () => {},
    onNewThreadStartInTargetChange: () => {},
    onNewThreadStartInEnvironmentChange: () => {},
    onRefreshNewThreadStartInEnvironments: async () => {},
    onOpenNewThreadLocalEnvironmentsSettings: () => {},
    ...overrides,
  };
}

describe("createThreadStageActions settings routing", () => {
  test("routes active thread settings through conversation settings update", () => {
    const settingsUpdates: unknown[] = [];
    const draftModes: string[] = [];
    const input = buildInput({
      codexControl: {
        setConversationThreadSettings: async (threadId: string, patch: unknown) => {
          settingsUpdates.push({ threadId, patch });
          return null;
        },
        setThreadModel: () => {
          throw new Error("active thread model changes must not use draft settings");
        },
        setThreadReasoningEffort: () => {
          throw new Error("active thread reasoning changes must not use draft settings");
        },
      } as unknown as ThreadActionControllerInput["codexControl"],
      setSelectedCollaborationMode: (mode) => {
        draftModes.push(mode);
      },
    });
    const actions = createThreadStageActions(input);

    void actions.onCollaborationModeChange("plan");
    void actions.onModelChange("gpt-5.9-codex");
    void actions.onReasoningEffortChange("medium");

    expect(JSON.stringify(draftModes)).toBe("[]");
    expect(JSON.stringify(settingsUpdates)).toBe(JSON.stringify([
      { threadId: "thread_1", patch: { collaborationMode: "plan" } },
      { threadId: "thread_1", patch: { model: "gpt-5.9-codex" } },
      { threadId: "thread_1", patch: { reasoningEffort: "medium" } },
    ]));
  });

  test("routes new thread settings to local draft fallbacks", () => {
    const draftModes: string[] = [];
    const draftModels: string[] = [];
    const draftReasoning: string[] = [];
    const settingsUpdates: unknown[] = [];
    const input = buildInput({
      activeThreadId: null,
      codexControl: {
        setConversationThreadSettings: async (threadId: string, patch: unknown) => {
          settingsUpdates.push({ threadId, patch });
          return null;
        },
        setThreadModel: (model: string) => {
          draftModels.push(model);
        },
        setThreadReasoningEffort: (reasoningEffort: string) => {
          draftReasoning.push(reasoningEffort);
        },
      } as unknown as ThreadActionControllerInput["codexControl"],
      setSelectedCollaborationMode: (mode) => {
        draftModes.push(mode);
      },
    });
    const actions = createThreadStageActions(input);

    void actions.onCollaborationModeChange("plan");
    void actions.onModelChange("gpt-5.9-codex");
    void actions.onReasoningEffortChange("medium");

    expect(JSON.stringify(settingsUpdates)).toBe("[]");
    expect(JSON.stringify(draftModes)).toBe(JSON.stringify(["plan"]));
    expect(JSON.stringify(draftModels)).toBe(JSON.stringify(["gpt-5.9-codex"]));
    expect(JSON.stringify(draftReasoning)).toBe(JSON.stringify(["medium"]));
  });

  test("routes permission request responses through Codex control with conversation context", async () => {
    const calls: unknown[] = [];
    const input = buildInput({
      codexControl: {
        respondPermissionRequest: async (requestId: string, response: unknown, conversationId: string | null) => {
          calls.push({ requestId, response, conversationId });
          return true;
        },
      } as unknown as ThreadActionControllerInput["codexControl"],
    });
    const actions = createThreadStageActions(input);

    await actions.onRespondPermissionRequest?.("permission-1", {
      permissions: {},
      scope: "turn",
    }, {
      conversationId: "thread-1",
    });

    expect(JSON.stringify(calls)).toBe(JSON.stringify([
      {
        requestId: "permission-1",
        response: {
          permissions: {},
          scope: "turn",
        },
        conversationId: "thread-1",
      },
    ]));
  });

  test("passes subagent context to the shell opener without hydrating inline", async () => {
    const calls: string[] = [];
    const input = buildInput({
      activeThreadId: "thread-parent",
      codexControl: {
        hydrateBackgroundSubagentThreads: async (input: { threadIds: string[] }) => {
          calls.push(`hydrate:${input.threadIds.join(",")}`);
          return [];
        },
        requestThreadStreamSnapshot: async (threadId: string) => {
          calls.push(`snapshot:${threadId}`);
          return null;
        },
      } as unknown as ThreadActionControllerInput["codexControl"],
      onOpenThread: (threadId, context) => {
        calls.push(`open:${threadId}:${context?.subagent?.conversationId ?? "none"}`);
      },
    });
    const actions = createThreadStageActions(input);

    await actions.onOpenThread("thread-child", {
      subagent: {
        agentRole: "reviewer",
        conversationId: "thread-child",
        diffStats: null,
        displayName: "Reviewer",
        spawnModel: "gpt-5.3-codex",
        status: "active",
        statusSummary: "checking changes",
      },
    });

    expect(JSON.stringify(calls)).toBe(JSON.stringify([
      "open:thread-child:thread-child",
    ]));
  });

  test("does not run subagent hydration for ordinary thread opens", async () => {
    const calls: string[] = [];
    const input = buildInput({
      codexControl: {
        hydrateBackgroundSubagentThreads: async (input: { threadIds: string[] }) => {
          calls.push(`hydrate:${input.threadIds.join(",")}`);
          return [];
        },
        requestThreadStreamSnapshot: async (threadId: string) => {
          calls.push(`snapshot:${threadId}`);
          return null;
        },
      } as unknown as ThreadActionControllerInput["codexControl"],
      onOpenThread: (threadId, context) => {
        calls.push(`open:${threadId}:${context?.subagent?.conversationId ?? "none"}`);
      },
    });
    const actions = createThreadStageActions(input);

    await actions.onOpenThread("thread-ordinary");

    expect(JSON.stringify(calls)).toBe(JSON.stringify([
      "open:thread-ordinary:none",
    ]));
  });

  test("stops background agents by interrupting unique child threads", async () => {
    const calls: string[] = [];
    const input = buildInput({
      codexControl: {
        interruptTurn: async (threadId: string) => {
          calls.push(threadId);
          return true;
        },
      } as unknown as ThreadActionControllerInput["codexControl"],
    });
    const actions = createThreadStageActions(input);

    await actions.onStopBackgroundAgents?.(["thread-child-a", "thread-child-b", "thread-child-a", " "]);

    expect(JSON.stringify(calls)).toBe(JSON.stringify([
      "thread-child-a",
      "thread-child-b",
    ]));
  });
});
