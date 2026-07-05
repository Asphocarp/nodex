import { describe, expect, test } from "bun:test";
import type { CodexDynamicToolCallView } from "../../../../../lib/types";
import {
  buildDynamicToolCallSummaryPartKey,
  continuesCodexAppLiveActivityBetweenCalls,
  getDynamicToolRegistryEntry,
  isDynamicToolStandaloneInConversation,
  isDynamicToolSummaryOnlyInConversationGroup,
  parseCodexAppHandoffResult,
  resolveCodexAppMetaThreadToolLabel,
  resolveCodexAppHandoffRenderState,
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
  test("resolves Electron-style registry flags from one entry map", () => {
    expect(continuesCodexAppLiveActivityBetweenCalls(dynamicCall({ tool: "read_thread" }))).toBeTrue();
    expect(continuesCodexAppLiveActivityBetweenCalls(dynamicCall({ tool: "send_message_to_thread" }))).toBeFalse();
    expect(isDynamicToolStandaloneInConversation(dynamicCall({ tool: "handoff_thread" }))).toBeTrue();
    expect(isDynamicToolSummaryOnlyInConversationGroup(dynamicCall({
      tool: "get_handoff_status",
      arguments: { operationId: "operation-1" },
    }))).toBeTrue();
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
    expect(handoffToHost === handoffLocal).toBeFalse();
    expect(handoffStatus.endsWith("\u001foperation-1")).toBeTrue();
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
    expect(state.label).toBe("Handing off thread");
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
});
