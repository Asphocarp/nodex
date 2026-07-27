import { describe, expect, test } from "vitest";
import type { ProjectSessionThreadLink } from "@/lib/types";
import { projectSessionThreadLinkToSummary } from "./thread-summary-projection";

describe("projectSessionThreadLinkToSummary", () => {
  test("preserves the durable execution profile used by the active thread", () => {
    const executionProfile = {
      providerId: "openai",
      modelId: "gpt-5.5",
      harnessId: null,
      reasoningEffort: "high",
      serviceTier: "fast",
    };
    const link: ProjectSessionThreadLink = {
      sessionId: "session_1",
      projectId: "project_1",
      threadId: "thread_1",
      threadPreview: "Keep the thread-owned profile.",
      modelProvider: "openai",
      executionProfile,
      statusType: "idle",
      statusActiveFlags: [],
      archived: false,
      createdAt: 1,
      updatedAt: 2,
      linkedAt: "2026-07-28T00:00:00.000Z",
    };

    expect(projectSessionThreadLinkToSummary(link).executionProfile)
      .toEqual(executionProfile);
  });
});
