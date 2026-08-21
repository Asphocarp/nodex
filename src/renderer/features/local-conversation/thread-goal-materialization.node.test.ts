import { describe, expect, test } from "vitest";
import {
  materializeThreadGoalDraft,
  runBestEffortThreadGoalCleanup,
} from "./thread-goal-materialization";

describe("thread goal materialization boundary", () => {
  test("rejects a draft with no objective or attachments", async () => {
    let error: unknown = null;

    try {
      await materializeThreadGoalDraft({
        objective: " \n ",
        pastedTextAttachments: [],
        imageAttachments: [],
      });
    } catch (caught) {
      error = caught;
    }

    expect(error instanceof Error ? error.message : null).toBe("Goal objective must not be empty");
  });

  test("treats materialized-directory cleanup as best effort", async () => {
    let cleanupCalls = 0;
    await runBestEffortThreadGoalCleanup(async () => {
      cleanupCalls += 1;
      throw new Error("cleanup failed");
    });
    expect(cleanupCalls).toBe(1);
  });
});
