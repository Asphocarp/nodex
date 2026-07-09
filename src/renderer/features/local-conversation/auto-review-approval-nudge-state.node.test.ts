import { beforeEach, describe, expect, test } from "vitest";
import { clearPersistedAtomStoreForTests } from "@/lib/persisted-atom-store";
import {
  dismissAutoReviewApprovalNudges,
  getAutoReviewApprovalNudgeState,
  recordManualApprovalForAutoReviewNudge,
  resetAutoReviewApprovalNudgeStateForTests,
  resolveAutoReviewApprovalNudge,
} from "./auto-review-approval-nudge-state";

describe("auto-review approval nudge state", () => {
  beforeEach(() => {
    clearPersistedAtomStoreForTests();
    resetAutoReviewApprovalNudgeStateForTests();
  });

  test("activates per thread at the manual approval threshold and clears after resolution", async () => {
    await recordManualApprovalForAutoReviewNudge({ threadId: "thread_1", eligible: true });
    await recordManualApprovalForAutoReviewNudge({ threadId: "thread_1", eligible: true });
    expect(getAutoReviewApprovalNudgeState().activeThreadIds.has("thread_1")).toBe(false);

    await recordManualApprovalForAutoReviewNudge({ threadId: "thread_1", eligible: true });
    expect(getAutoReviewApprovalNudgeState().activeThreadIds.has("thread_1")).toBe(true);

    resolveAutoReviewApprovalNudge("thread_1");
    expect(getAutoReviewApprovalNudgeState().activeThreadIds.has("thread_1")).toBe(false);
    expect(getAutoReviewApprovalNudgeState().manualApprovalCountByThreadId.has("thread_1")).toBe(false);
  });

  test("permanent dismissal clears every thread and prevents later activation", async () => {
    await recordManualApprovalForAutoReviewNudge({
      threadId: "thread_1",
      eligible: true,
      threshold: 1,
    });
    await dismissAutoReviewApprovalNudges();
    await recordManualApprovalForAutoReviewNudge({
      threadId: "thread_2",
      eligible: true,
      threshold: 1,
    });

    const current = getAutoReviewApprovalNudgeState();
    expect(current.dismissed).toBe(true);
    expect(current.activeThreadIds.size).toBe(0);
    expect(current.manualApprovalCountByThreadId.size).toBe(0);
  });
});
