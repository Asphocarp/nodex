import { describe, expect, test } from "bun:test";
import {
  normalizeAutomaticApprovalReviewPayload,
  normalizeMultiAgentActionPayload,
  shouldShowAutoReviewInterruptionWarning,
} from "./codex-transcript-special-items";

describe("codex-transcript-special-items", () => {
  test("normalizes automatic approval review payloads from nested review records", () => {
    const payload = normalizeAutomaticApprovalReviewPayload(
      {
        review: {
          status: "approved",
          riskScore: 0.25,
          riskLevel: "low",
          rationale: "Looks safe",
        },
      },
      "item_123",
    );

    expect(JSON.stringify(payload)).toBe(JSON.stringify({
      targetItemId: "item_123",
      status: "approved",
      riskScore: 0.25,
      riskLevel: "low",
      userAuthorization: null,
      rationale: "Looks safe",
      action: null,
    }));
  });

  test("normalizes current guardian review protocol fields", () => {
    const payload = normalizeAutomaticApprovalReviewPayload({
      targetItemId: null,
      review: {
        status: "timedOut",
        riskLevel: "critical",
        userAuthorization: "high",
        rationale: null,
      },
      action: {
        type: "requestPermissions",
      },
    });

    expect(JSON.stringify(payload)).toBe(JSON.stringify({
      targetItemId: null,
      status: "timedOut",
      riskScore: null,
      riskLevel: "critical",
      userAuthorization: "high",
      rationale: null,
      action: {
        type: "requestPermissions",
      },
    }));
  });

  test("matches auto-review interruption guardian warnings by kind or message prefix", () => {
    expect(shouldShowAutoReviewInterruptionWarning({
      threadId: "thread-1",
      kind: "tooManyDenials",
      message: "Different text",
    })).toBeTrue();
    expect(shouldShowAutoReviewInterruptionWarning({
      threadId: "thread-1",
      message: "Automatic approval review rejected too many approval requests for this turn.",
    })).toBeTrue();
    expect(shouldShowAutoReviewInterruptionWarning({
      threadId: "thread-1",
      message: "Different guardian warning",
    })).toBeFalse();
  });

  test("filters invalid receiver threads and agent states in multi-agent action payloads", () => {
    const payload = normalizeMultiAgentActionPayload({
      tool: "sendInput",
      status: "completed",
      receiverThreadIds: ["thr_a", 42, "thr_b"],
      receiverThreads: [
        {
          threadId: "thr_a",
          thread: {
            nickname: "Scout",
            model: "gpt-5",
            agentRole: "explorer",
          },
        },
        {
          threadId: 7,
          thread: {
            nickname: "Broken",
          },
        },
      ],
      agentsStates: {
        thr_a: {
          status: "running",
          message: "Working",
        },
        thr_b: {
          status: "mystery",
          message: "Bad",
        },
      },
    });

    expect(JSON.stringify(payload)).toBe(JSON.stringify({
      id: null,
      action: "sendInput",
      status: "completed",
      senderThreadId: null,
      receiverThreadIds: ["thr_a", "thr_b"],
      receiverThreads: [{
        threadId: "thr_a",
        thread: {
          nickname: "Scout",
          model: "gpt-5",
          agentRole: "explorer",
        },
      }],
      prompt: null,
      model: null,
      reasoningEffort: null,
      agentsStates: {
        thr_a: {
          status: "running",
          message: "Working",
        },
      },
    }));
  });
});
