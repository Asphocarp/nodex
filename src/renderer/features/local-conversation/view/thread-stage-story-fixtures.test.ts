import { describe, expect, test } from "bun:test";
import {
  buildThreadStageStorySurfaceModels,
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
    });

    const { bodyModel } = buildThreadStageStorySurfaceModels(scenario, {
      preset: "new-thread",
      permissionMode: "sandbox",
      authenticatedAccount: true,
      isQueueingEnabled: false,
      collapseAgentBody: true,
    }, scenario.runtime);

    expect(bodyModel.threadId).toBe(null);
    expect(bodyModel.body.emptyState.type).toBe("newThread");
  });

  test("surfaces the synthesized implement-plan request for the plan preset", () => {
    const scenario = buildThreadStageStoryScenario({
      preset: "implement-plan",
      permissionMode: "sandbox",
      authenticatedAccount: true,
      isQueueingEnabled: false,
      collapseAgentBody: true,
    });

    const { footerModel } = buildThreadStageStorySurfaceModels(scenario, {
      preset: "implement-plan",
      permissionMode: "sandbox",
      authenticatedAccount: true,
      isQueueingEnabled: false,
      collapseAgentBody: true,
    }, scenario.runtime);

    const requestEntry = footerModel.composerShell.activeRequest;
    if (!requestEntry) {
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
    });

    const { footerModel } = buildThreadStageStorySurfaceModels(scenario, {
      preset: "background-activity",
      permissionMode: "sandbox",
      authenticatedAccount: true,
      isQueueingEnabled: false,
      collapseAgentBody: false,
    }, scenario.runtime);

    expect(footerModel.composerShell.backgroundRequest?.request.type).toBe("approval");
    expect(footerModel.composerShell.showComposer).toBeFalse();
  });
});
