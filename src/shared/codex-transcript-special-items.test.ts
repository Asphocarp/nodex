import { describe, expect, test } from "bun:test";
import {
  normalizeAutomaticApprovalReviewPayload,
  normalizeMultiAgentActionPayload,
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
      rationale: "Looks safe",
      action: null,
    }));
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
