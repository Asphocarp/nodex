import { describe, expect, test } from "bun:test";
import {
  buildThreadStageStoryModel,
  buildThreadStageStoryScenario,
} from "./thread-stage-story-fixtures";

describe("thread stage story fixtures", () => {
  test("builds the new-thread preset on the real empty-state path", () => {
    const scenario = buildThreadStageStoryScenario({
      preset: "new-thread",
      permissionMode: "sandbox",
      authenticatedAccount: true,
      isQueueingEnabled: false,
      collapseAgentBody: true,
      collapseToolCalls: false,
    });

    const model = buildThreadStageStoryModel(scenario, {
      preset: "new-thread",
      permissionMode: "sandbox",
      authenticatedAccount: true,
      isQueueingEnabled: false,
      collapseAgentBody: true,
      collapseToolCalls: false,
    }, scenario.runtime);

    expect(model.isNewThreadTab).toBeTrue();
    expect(model.body.emptyState.type).toBe("newThread");
  });

  test("surfaces the synthesized implement-plan request for the plan preset", () => {
    const scenario = buildThreadStageStoryScenario({
      preset: "implement-plan",
      permissionMode: "sandbox",
      authenticatedAccount: true,
      isQueueingEnabled: false,
      collapseAgentBody: true,
      collapseToolCalls: false,
    });

    const model = buildThreadStageStoryModel(scenario, {
      preset: "implement-plan",
      permissionMode: "sandbox",
      authenticatedAccount: true,
      isQueueingEnabled: false,
      collapseAgentBody: true,
      collapseToolCalls: false,
    }, scenario.runtime);

    expect(model.pendingRequestSurface?.entries.length).toBe(1);
    const requestEntry = model.pendingRequestSurface?.entries[0];
    if (!requestEntry || requestEntry.kind !== "request") {
      throw new Error("expected implement-plan request entry");
    }
    expect(requestEntry.request.type).toBe("implementPlan");
  });

  test("keeps the composer hidden when background approval is present", () => {
    const scenario = buildThreadStageStoryScenario({
      preset: "background-activity",
      permissionMode: "sandbox",
      authenticatedAccount: true,
      isQueueingEnabled: false,
      collapseAgentBody: false,
      collapseToolCalls: false,
    });

    const model = buildThreadStageStoryModel(scenario, {
      preset: "background-activity",
      permissionMode: "sandbox",
      authenticatedAccount: true,
      isQueueingEnabled: false,
      collapseAgentBody: false,
      collapseToolCalls: false,
    }, scenario.runtime);

    expect(model.pendingRequestSurface?.backgroundRequestCount).toBe(1);
    expect(model.pendingRequestSurface?.showComposer).toBeFalse();
  });
});
