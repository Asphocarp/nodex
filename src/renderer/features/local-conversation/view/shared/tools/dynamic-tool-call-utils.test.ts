import { describe, expect, test } from "vitest";
import type { CodexDynamicToolCallView } from "../../../../../lib/types";
import {
  buildDynamicToolCallSummaryPartKey,
  continuesCodexAppLiveActivityBetweenCalls,
  extractDynamicToolTextContent,
  getDynamicToolRegistryEntry,
  isDynamicToolStandaloneInConversation,
  isDynamicToolSummaryOnlyInConversationGroup,
  parseCodexAppCreateThreadResult,
  parseCodexAppHandoffResult,
  parseAutomationUpdateToolResult,
  resolveCodexAppMetaThreadToolLabel,
  resolveCodexAppHandoffRenderState,
  resolveAutomationUpdateRenderState,
  resolveDynamicToolFallbackLabel,
  resolveDynamicToolLabel,
} from "./dynamic-tool-call-utils";

function dynamicCall(overrides: Partial<CodexDynamicToolCallView> = {}): CodexDynamicToolCallView {
  return {
    callId: "call-1",
    namespace: "codex_app",
    tool: "read_thread",
    arguments: { threadId: "thread-1" },
    status: "completed",
    contentItems: null,
    success: true,
    durationMs: 1,
    completed: true,
    ...overrides,
  };
}

describe("dynamic tool registry", () => {
  test("parses only exact create_thread materialization result variants", () => {
    const threadResult = parseCodexAppCreateThreadResult(dynamicCall({
      tool: "create_thread",
      contentItems: [{ type: "inputText", text: "{\"threadId\":\"thread-created\"}" }],
    }));
    const clientThreadResult = parseCodexAppCreateThreadResult(dynamicCall({
      tool: "create_thread",
      contentItems: [{
        type: "inputText",
        text: "{\"clientThreadId\":\"client-new-thread:11111111-1111-4111-8111-111111111111\"}",
      }],
    }));
    const legacyPendingResult = parseCodexAppCreateThreadResult(dynamicCall({
      tool: "create_thread",
      contentItems: [{ type: "inputText", text: "{\"pendingWorktreeId\":\"pending-worktree\"}" }],
    }));
    const wrongToolResult = parseCodexAppCreateThreadResult(dynamicCall({
      tool: "fork_thread",
      contentItems: [{ type: "inputText", text: "{\"threadId\":\"thread-created\"}" }],
    }));

    expect(JSON.stringify(threadResult)).toBe("{\"threadId\":\"thread-created\"}");
    expect(JSON.stringify(clientThreadResult)).toBe(
      "{\"clientThreadId\":\"client-new-thread:11111111-1111-4111-8111-111111111111\"}",
    );
    expect(legacyPendingResult).toBe(null);
    expect(wrongToolResult).toBe(null);
  });

  test("resolves Electron-style registry flags from one entry map", () => {
    expect(continuesCodexAppLiveActivityBetweenCalls(dynamicCall({ tool: "read_thread" }))).toBe(true);
    expect(continuesCodexAppLiveActivityBetweenCalls(dynamicCall({ tool: "send_message_to_thread" }))).toBe(false);
    expect(isDynamicToolStandaloneInConversation(dynamicCall({ tool: "handoff_thread" }))).toBe(true);
    expect(isDynamicToolSummaryOnlyInConversationGroup(dynamicCall({
      tool: "get_handoff_status",
      arguments: { operationId: "operation-1" },
    }))).toBe(true);
  });

  test("uses the exact task-oriented labels for registered Codex app tools", () => {
    const cases: Array<[string, Partial<CodexDynamicToolCallView>, string]> = [
      ["fork active", { tool: "fork_thread", arguments: {}, completed: false }, "Creating new task"],
      ["fork complete", { tool: "fork_thread", arguments: {} }, "Created new task"],
      ["worktree fork", { tool: "fork_thread", arguments: { environment: { type: "worktree" } } }, "Created task in new worktree"],
      ["list", { tool: "list_threads" }, "Listed tasks"],
      ["read", { tool: "read_thread" }, "Read task"],
      ["send", { tool: "send_message_to_thread" }, "Sent message to task"],
      ["pin", { tool: "set_thread_pinned" }, "Updated task pin"],
      ["archive", { tool: "set_thread_archived" }, "Updated task archive"],
      ["title", { tool: "set_thread_title" }, "Renamed task"],
    ];

    expect(cases.map(([name, overrides]) => `${name}:${resolveCodexAppMetaThreadToolLabel(dynamicCall(overrides))}`).join("|")).toBe(
      cases.map(([name, , label]) => `${name}:${label}`).join("|"),
    );
  });

  test("keeps automation_update rendering separate from dynamic standalone policy", () => {
    const call = dynamicCall({
      tool: "automation_update",
      arguments: {
        mode: "suggested_create",
        kind: "cron",
        status: "ACTIVE",
        name: "Review release notes",
        prompt: "Review release notes and summarize risks.",
        rrule: "FREQ=DAILY;BYHOUR=9;BYMINUTE=0",
        cwds: "/repo/nodex",
        executionEnvironment: "worktree",
        localEnvironmentConfigPath: null,
        model: "gpt-5-codex",
        reasoningEffort: "medium",
      },
    });
    const entry = getDynamicToolRegistryEntry(call);
    const state = resolveAutomationUpdateRenderState(call, "thread-current");

    expect(entry?.rendererKind ?? "").toBe("automationUpdate");
    expect(isDynamicToolStandaloneInConversation(call)).toBe(false);
    expect(state?.statusLabel ?? "").toBe("Proposed");
    expect(state?.title ?? "").toBe("Review release notes");
    expect(state?.subtitle ?? "").toBe("Daily");
    expect(state?.canAccept ?? false).toBe(true);
    expect(state?.createInput?.cwds?.join(",") ?? "").toBe("/repo/nodex");
    expect(state?.createInput?.executionEnvironment ?? "").toBe("worktree");
  });

  test("resolves registry metadata namespace-first without tool-name fallback", () => {
    const foreignHandoff = dynamicCall({
      namespace: "unsupported_namespace",
      tool: "handoff_thread",
    });
    const completedSetup = dynamicCall({
      namespace: "unsupported_namespace",
      tool: "setup_codex_step",
      arguments: { step: "complete" },
    });

    expect(getDynamicToolRegistryEntry(foreignHandoff)).toBe(null);
    expect(isDynamicToolStandaloneInConversation(foreignHandoff)).toBe(false);
    expect(isDynamicToolSummaryOnlyInConversationGroup(completedSetup)).toBe(false);
    expect(continuesCodexAppLiveActivityBetweenCalls(completedSetup)).toBe(false);
  });

  test("parses automation_update JSON result from later content items", () => {
    const call = dynamicCall({
      tool: "automation_update",
      arguments: {
        mode: "delete",
        id: "automation-release",
      },
      contentItems: [
        { type: "inputText", text: "Deleted automation in the app." },
        {
          type: "inputText",
          text: JSON.stringify({
            automationId: "automation-release",
            mode: "delete",
            deleteStatus: "not_found",
            snapshot: {
              kind: "cron",
              name: "Release notes",
              rrule: "FREQ=WEEKLY",
            },
          }),
        },
      ],
    });
    const result = parseAutomationUpdateToolResult(call);
    const state = resolveAutomationUpdateRenderState(call);

    expect(result?.automationId ?? "").toBe("automation-release");
    expect(result?.mode ?? "").toBe("delete");
    expect(result?.deleteStatus ?? "").toBe("not_found");
    expect(state?.statusLabel ?? "").toBe("Missing");
    expect(state?.title ?? "").toBe("Release notes");
  });

  test("keeps omitted automation_update local environment paths out of update payloads", () => {
    const state = resolveAutomationUpdateRenderState(dynamicCall({
      tool: "automation_update",
      arguments: {
        mode: "suggested_update",
        id: "automation-release",
        kind: "cron",
        status: "ACTIVE",
        name: "Release notes",
        prompt: "Review release notes.",
        rrule: "FREQ=DAILY;BYHOUR=9;BYMINUTE=0",
        cwds: ["/repo/nodex"],
        executionEnvironment: "worktree",
        model: "gpt-5-codex",
        reasoningEffort: "medium",
      },
    }));

    expect(Object.prototype.hasOwnProperty.call(state?.updateInput ?? {}, "localEnvironmentConfigPath")).toBe(false);
  });

  test("keys completed summary parts through registry-specific keys", () => {
    const readA = buildDynamicToolCallSummaryPartKey(dynamicCall({
      callId: "read-a",
      tool: "read_thread",
      arguments: { threadId: "thread-a" },
    }));
    const readB = buildDynamicToolCallSummaryPartKey(dynamicCall({
      callId: "read-b",
      tool: "read_thread",
      arguments: { threadId: "thread-b" },
    }));
    const handoffToHost = buildDynamicToolCallSummaryPartKey(dynamicCall({
      tool: "handoff_thread",
      arguments: { threadId: "thread-a", destinationHostId: "host-1" },
    }));
    const handoffLocal = buildDynamicToolCallSummaryPartKey(dynamicCall({
      tool: "handoff_thread",
      arguments: { threadId: "thread-a" },
    }));
    const handoffStatus = buildDynamicToolCallSummaryPartKey(dynamicCall({
      tool: "get_handoff_status",
      arguments: { operationId: "operation-1" },
    }));

    expect(readA).toBe(readB);
    expect(handoffToHost === handoffLocal).toBe(false);
    expect(handoffStatus.endsWith(":operation-1")).toBe(true);
  });

  test("uses handoff operation status for labels instead of only item completion", () => {
    const queued = dynamicCall({
      tool: "handoff_thread",
      contentItems: [{
        type: "inputText",
        text: JSON.stringify({
          destinationHostDisplayName: "Work Mac",
          operationId: "operation-1",
          status: "queued",
          threadTitle: "Fix renderer",
        }),
      }],
      completed: true,
      success: true,
    });
    const failed = dynamicCall({
      ...queued,
      contentItems: [{
        type: "inputText",
        text: JSON.stringify({
          destinationHostDisplayName: "Work Mac",
          operationId: "operation-1",
          status: "error",
          threadTitle: "Fix renderer",
        }),
      }],
    });

    expect(resolveCodexAppMetaThreadToolLabel(queued)).toBe("Handing off Fix renderer to Work Mac");
    expect(resolveCodexAppMetaThreadToolLabel(failed)).toBe("Failed to hand off Fix renderer to Work Mac");
  });

  test("keeps real handoff operation status and steps even when title is unavailable", () => {
    const running = dynamicCall({
      tool: "handoff_thread",
      arguments: { threadId: "thread-1" },
      contentItems: [{
        type: "inputText",
        text: JSON.stringify({
          destinationHostDisplayName: "Local",
          message: "Preparing thread handoff.",
          operationId: "operation-1",
          status: "running",
          steps: [
            { id: "resolve-thread", label: "Resolve thread", status: "success", message: null },
            { id: "handoff", label: "Move thread", status: "running", message: "Preparing thread handoff." },
          ],
        }),
      }],
      completed: true,
      success: true,
    });
    const parsed = parseCodexAppHandoffResult(running);
    const state = resolveCodexAppHandoffRenderState(running);

    expect(parsed?.steps.length ?? 0).toBe(2);
    expect(state.activityStatus).toBe("running");
    expect(state.label).toBe("Handing off task");
  });

  test("exposes non-thread registry entries without making them thread tools", () => {
    const settingsCall = dynamicCall({
      tool: "read_settings",
      arguments: {},
    });
    const chromeCall = dynamicCall({
      namespace: "chrome_extension",
      tool: "get_tab_context",
      arguments: { tabId: 3 },
    });

    expect(getDynamicToolRegistryEntry(settingsCall)?.rendererKind ?? "").toBe("settings");
    expect(resolveDynamicToolLabel({
      threadId: "thread-1",
      turnId: "turn-1",
      entryId: "entry-1",
      itemId: "item-1",
      type: "dynamicToolCall",
      kind: "toolCall",
      semanticKind: "dynamicToolCall",
      status: "completed",
      createdAt: 1,
      updatedAt: 1,
      dynamicToolCall: chromeCall,
    })).toBe("Read tab");
  });

  test("matches Electron dynamic fallback labels for completed and active rows", () => {
    expect(resolveDynamicToolFallbackLabel(dynamicCall({
      tool: "automation_update",
      completed: true,
    }))).toBe("Scheduled task updated");
    expect(resolveDynamicToolFallbackLabel(dynamicCall({
      tool: "automation_update",
      completed: false,
    }))).toBe("Updating scheduled task");
    expect(resolveDynamicToolFallbackLabel(dynamicCall({
      tool: "read_thread_terminal",
      completed: true,
    }))).toBe("Read thread terminal");
    expect(resolveDynamicToolFallbackLabel(dynamicCall({
      tool: "inspect_project_graph",
      completed: true,
    }))).toBe("Inspect Project Graph");
  });

  test("extracts automation_update text as the Codex markdown fallback instead of raw JSON", () => {
    const text = extractDynamicToolTextContent(dynamicCall({
      tool: "automation_update",
      contentItems: [
        { type: "inputText", text: "Updated automation in the app." },
        {
          type: "inputText",
          text: JSON.stringify({
            automationId: "automation-review",
            mode: "update",
          }),
        },
      ],
    })).join("\n");

    expect(text).toBe("Scheduled task update\n\nMode: update\nAutomation ID: automation-review");
  });
});
