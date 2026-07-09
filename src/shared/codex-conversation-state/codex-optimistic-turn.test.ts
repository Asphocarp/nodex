import { describe, expect, test } from "vitest";
import type { Turn } from "@nodex/codex-app-server-protocol/v2/Turn";
import {
  createCodexCanonicalHydratedConversationState,
  appendCodexCanonicalWorktreeInitItem,
  type CodexCanonicalLiveTurnParams,
} from "./codex-conversation-state";
import {
  appendCodexCanonicalOptimisticTurn,
  bindCodexCanonicalOptimisticTurn,
  failCodexCanonicalOptimisticTurn,
} from "./codex-optimistic-turn";

function buildState() {
  return createCodexCanonicalHydratedConversationState({
    id: "thread-created",
    extra: null,
    sessionId: "session-created",
    forkedFromId: null,
    parentThreadId: null,
    preview: "",
    ephemeral: false,
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
    threadSource: "subagent",
    agentNickname: null,
    agentRole: null,
    gitInfo: null,
    name: null,
    turns: [],
  }, {
    model: "gpt-test",
    reasoningEffort: "medium",
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
    pendingRequests: [],
    hasUnreadTurn: false,
  });
}

function buildParams(): CodexCanonicalLiveTurnParams {
  return {
    threadId: "thread-created",
    clientUserMessageId: "client-message",
    input: [{ type: "text", text: "delegated", text_elements: [] }],
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
    model: null,
    serviceTier: "fast",
    effort: "medium",
    summary: "none",
    personality: null,
    outputSchema: null,
    collaborationMode: null,
    attachments: [],
  };
}

describe("Codex optimistic turn parity", () => {
  test("publishes the exact nullable in-progress placeholder before dispatch", () => {
    const state = appendCodexCanonicalOptimisticTurn(buildState(), {
      params: buildParams(),
      startedAtMs: 42,
    });
    const turn = state.turns[0];

    expect(turn?.protocol.id).toBe(null);
    expect(turn?.protocol.status).toBe("inProgress");
    expect(turn?.sidecar.turnStartedAtMs).toBe(42);
    expect(turn?.sidecar.params.clientUserMessageId).toBe("client-message");
    expect(turn?.items.length).toBe(0);
  });

  test("binds the matching placeholder while preserving its launch params", () => {
    const optimistic = appendCodexCanonicalOptimisticTurn(buildState(), {
      params: buildParams(),
      startedAtMs: 42,
    });
    const withWorktreeInit = appendCodexCanonicalWorktreeInitItem(optimistic, {
      type: "worktreeInit",
      id: "pending:1",
      worktreeOutputText: "created\n",
      setup: null,
    });
    const responseTurn: Turn = {
      id: "turn-server",
      items: [{
        type: "agentMessage",
        id: "response-only-item",
        text: "must arrive through lifecycle",
        phase: "final_answer",
        memoryCitation: null,
      }],
      itemsView: "full",
      status: "completed",
      error: {
        message: "response-only error",
        codexErrorInfo: null,
        additionalDetails: null,
      },
      startedAt: 10,
      completedAt: 12,
      durationMs: 2_000,
    };
    const bound = bindCodexCanonicalOptimisticTurn(
      withWorktreeInit,
      "client-message",
      responseTurn,
    );

    expect(bound.turns[0]?.protocol.id).toBe("turn-server");
    expect(bound.turns[0]?.protocol.status).toBe("completed");
    expect(bound.turns[0]?.protocol.error).toBe(null);
    expect(bound.turns[0]?.protocol.durationMs).toBe(null);
    expect(bound.turns[0]?.sidecar.turnStartedAtMs).toBe(42);
    expect(bound.turns[0]?.sidecar.params.input[0]?.type).toBe("text");
    expect(bound.turns[0]?.items).toStrictEqual(withWorktreeInit.turns[0]?.items);
  });

  test("prefers an already-bound response turn without overwriting notification state", () => {
    const optimistic = appendCodexCanonicalOptimisticTurn(buildState(), {
      params: buildParams(),
      startedAtMs: 42,
    });
    const existing = optimistic.turns[0];
    if (!existing) throw new Error("Expected optimistic turn");
    const notificationItem = {
      type: "modelChanged" as const,
      id: "notification-item",
      fromModel: "old",
      toModel: "new",
    };
    const raced = {
      ...optimistic,
      turns: [{
        ...existing,
        protocol: {
          ...existing.protocol,
          id: "turn-server",
          status: "completed" as const,
          durationMs: 90,
        },
        items: [notificationItem],
        sidecar: {
          ...existing.sidecar,
          completedAtMs: 132,
        },
      }],
    };
    const rebound = bindCodexCanonicalOptimisticTurn(
      raced,
      "unrelated-client-id",
      {
        id: "turn-server",
        items: [],
        itemsView: "full",
        status: "failed",
        error: null,
        startedAt: null,
        completedAt: null,
        durationMs: null,
      },
    );

    expect(rebound).toBe(raced);
    expect(rebound.turns[0]?.items).toStrictEqual([notificationItem]);
    expect(rebound.turns[0]?.protocol.status).toBe("completed");
    expect(rebound.turns[0]?.protocol.durationMs).toBe(90);
    expect(rebound.turns[0]?.sidecar.completedAtMs).toBe(132);
  });

  test("keeps the created thread and terminalizes a failed first request", () => {
    const optimistic = appendCodexCanonicalOptimisticTurn(buildState(), {
      params: buildParams(),
    });
    const failed = failCodexCanonicalOptimisticTurn(
      optimistic,
      "client-message",
    );

    expect(failed.protocol.id).toBe("thread-created");
    expect(failed.turns[0]?.protocol.id).toBe(null);
    expect(failed.turns[0]?.protocol.status).toBe("failed");
    expect(failed.turns[0]?.protocol.error?.message).toBe("Error submitting message");
    expect(failed.turns[0]?.items[0]?.type).toBe("error");
  });

  test("adds the exact model-change marker for a downgrade and consumes the pending model", () => {
    const base = buildState();
    const state = {
      ...base,
      sidecar: { ...base.sidecar, previousTurnModel: "gpt-terra" },
    };
    const params = {
      ...buildParams(),
      collaborationMode: {
        mode: "default" as const,
        settings: {
          model: "gpt-luna",
          reasoning_effort: null,
          developer_instructions: null,
        },
      },
    };

    const optimistic = appendCodexCanonicalOptimisticTurn(state, {
      params,
      currentCollaborationModel: "gpt-luna",
    });

    expect(optimistic.turns[0]?.items[0]).toMatchObject({
      type: "modelChanged",
      fromModel: "gpt-terra",
      toModel: "gpt-luna",
    });
    expect(optimistic.sidecar.previousTurnModel).toBe(null);

    const upgrade = appendCodexCanonicalOptimisticTurn(
      { ...base, sidecar: { ...base.sidecar, previousTurnModel: "gpt-luna" } },
      {
        params: {
          ...params,
          collaborationMode: {
            ...params.collaborationMode,
            settings: { ...params.collaborationMode.settings, model: "gpt-terra" },
          },
        },
        currentCollaborationModel: "gpt-terra",
      },
    );
    expect(upgrade.turns[0]?.items).toStrictEqual([]);
  });
});
