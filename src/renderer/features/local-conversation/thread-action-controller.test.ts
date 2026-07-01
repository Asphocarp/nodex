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
});
