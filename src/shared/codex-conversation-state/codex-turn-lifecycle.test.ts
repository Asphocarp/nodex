import { describe, expect, test } from "vitest";
import {
  createCodexCanonicalHydratedConversationState,
  type CodexCanonicalPlanImplementationItem,
} from "./codex-conversation-state";
import { appendCodexCanonicalOptimisticTurn } from "./codex-optimistic-turn";
import { createCodexCanonicalPlanImplementationRequest } from "./codex-server-request-lifecycle";
import { reduceCodexConversationTurnLifecycle } from "./codex-turn-lifecycle";

const THREAD_ID = "thread-turn-lifecycle";

function buildState() {
  return createCodexCanonicalHydratedConversationState({
    id: THREAD_ID,
    extra: null,
    sessionId: "session-turn-lifecycle",
    forkedFromId: null,
    parentThreadId: null,
    preview: "",
    ephemeral: false,
    isPinned: false,
    historyMode: "paginated",
    modelProvider: "openai",
    createdAt: 1,
    updatedAt: 1,
    recencyAt: 1,
    status: { type: "idle" },
    path: null,
    cwd: "/workspace",
    cliVersion: "test",
    source: "appServer",
    canAcceptDirectInput: true,
    threadSource: null,
    agentNickname: null,
    agentRole: null,
    gitInfo: null,
    name: null,
    turns: [],
  }, {
    model: "gpt-test",
    reasoningEffort: "high",
    cwd: "/workspace",
    approvalPolicy: "on-request",
    approvalsReviewer: "user",
    sandboxPolicy: {
      type: "workspaceWrite",
      writableRoots: ["/workspace"],
      networkAccess: false,
      excludeTmpdirEnvVar: false,
      excludeSlashTmp: false,
    },
    activePermissionProfile: { id: ":workspace", extends: null },
    runtimeWorkspaceRoots: ["/workspace"],
    hasUnreadTurn: false,
  });
}

function appendPlaceholder() {
  return appendCodexCanonicalOptimisticTurn(buildState(), {
    startedAtMs: 41,
    params: {
      threadId: THREAD_ID,
      clientUserMessageId: "client-1",
      input: [],
      cwd: "/workspace",
      approvalPolicy: "on-request",
      approvalsReviewer: "user",
      permissions: ":workspace",
      runtimeWorkspaceRoots: ["/workspace"],
      sandboxPolicy: {
        type: "workspaceWrite",
        writableRoots: ["/workspace"],
        networkAccess: false,
        excludeTmpdirEnvVar: false,
        excludeSlashTmp: false,
      },
      useAppServerPermissionDefault: false,
      model: "gpt-test",
      serviceTier: null,
      effort: "high",
      summary: "none",
      personality: null,
      outputSchema: null,
      collaborationMode: null,
      attachments: [],
    },
  });
}

describe("Codex 30751 turn lifecycle", () => {
  test("rebinds the latest nullable in-progress turn and preserves launch context", () => {
    const result = reduceCodexConversationTurnLifecycle(appendPlaceholder(), {
      conversationId: THREAD_ID,
      method: "turn/started",
      observedAtMs: 99,
      turn: {
        id: "turn-1",
        status: "inProgress",
        error: null,
        startedAt: 2,
        completedAt: null,
        durationMs: null,
      },
    });

    expect(result.disposition).toBe("applied");
    expect(result.state.turns.length).toBe(1);
    expect(result.state.turns[0]?.protocol.id).toBe("turn-1");
    expect(result.state.turns[0]?.sidecar.turnStartedAtMs).toBe(41);
    expect(result.state.turns[0]?.sidecar.params.clientUserMessageId).toBe("client-1");
  });

  test("completes stale plan rows on start, then creates one canonical follow-up on completion", () => {
    const placeholder = appendPlaceholder();
    const params = placeholder.turns[0]!.sidecar.params;
    const staleItem: CodexCanonicalPlanImplementationItem = {
      id: "implement-plan:old-turn",
      type: "planImplementation",
      turnId: "old-turn",
      planContent: "Old plan",
      isCompleted: false,
    };
    const withOldTurn = {
      ...placeholder,
      turns: [{
        protocol: {
          id: "old-turn",
          itemsView: "full" as const,
          status: "completed" as const,
          error: null,
          durationMs: 1,
        },
        items: [staleItem],
        sidecar: {
          params,
          diff: null,
          turnStartedAtMs: 1,
          finalAssistantStartedAtMs: null,
        },
      }, ...placeholder.turns],
      requests: [createCodexCanonicalPlanImplementationRequest(
        THREAD_ID,
        "old-turn",
        "Old plan",
        staleItem.id,
      )],
    };
    const started = reduceCodexConversationTurnLifecycle(withOldTurn, {
      conversationId: THREAD_ID,
      method: "turn/started",
      observedAtMs: 99,
      turn: {
        id: "turn-1",
        status: "inProgress",
        error: null,
        startedAt: null,
        completedAt: null,
        durationMs: null,
      },
    }).state;
    expect((started.turns[0]?.items[0] as CodexCanonicalPlanImplementationItem).isCompleted).toBe(true);
    expect(started.requests.length).toBe(0);

    const activeIndex = started.turns.findIndex((turn) => turn.protocol.id === "turn-1");
    const active = started.turns[activeIndex]!;
    const turns = [...started.turns];
    turns[activeIndex] = {
      ...active,
      items: [{ type: "plan", id: "plan-1", text: "  Ship exact parity  " }],
    };
    const completed = reduceCodexConversationTurnLifecycle({ ...started, turns }, {
      conversationId: THREAD_ID,
      method: "turn/completed",
      observedAtMs: 120,
      turn: {
        id: "turn-1",
        status: "completed",
        error: null,
        startedAt: null,
        completedAt: 3,
        durationMs: 42,
      },
    }).state;
    const completedTurn = completed.turns[activeIndex];
    const implementation = completedTurn?.items.find((item) => item.type === "planImplementation");

    expect(completedTurn?.protocol.durationMs).toBe(42);
    expect(implementation?.planContent).toBe("Ship exact parity");
    expect(completed.requests[0]?.method).toBe("item/plan/requestImplementation");
    expect(completed.sidecar.hasUnreadTurn).toBe(true);
  });

  test("ignores completion for an unknown turn", () => {
    const state = buildState();
    const result = reduceCodexConversationTurnLifecycle(state, {
      conversationId: THREAD_ID,
      method: "turn/completed",
      observedAtMs: 120,
      turn: {
        id: "missing",
        status: "completed",
        error: null,
        startedAt: null,
        completedAt: null,
        durationMs: 1,
      },
    });
    expect(result.state === state).toBe(true);
    expect(result.disposition).toBe("missingTurn");
  });
});
