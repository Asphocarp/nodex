import { describe, expect, test } from "vite-plus/test";
import type { ThreadFooterModel } from "../../thread-stage-types";
import {
  isInterruptedTurnResumeEligible,
  createInterruptedTurnResumeGate,
} from "./interrupted-turn-resume-controller";

function buildModel(overrides: Partial<ThreadFooterModel> = {}): ThreadFooterModel {
  return {
    threadId: "thread_1",
    projectId: "project_1",
    conversation: {
      threadId: "thread_1",
      projectId: "project_1",
      statusType: "idle",
      statusActiveFlags: [],
      turns: [{ turnId: "turn_1", status: "interrupted", items: [] }],
      threadGoal: null,
    },
    activeTurn: null,
    isThreadRunning: false,
    isNewThreadTab: false,
    resumeState: "resumed",
    ...overrides,
  } as ThreadFooterModel;
}

describe("interrupted turn resume controller", () => {
  test("allows only an idle interrupted conversation without an active goal", () => {
    expect(
      isInterruptedTurnResumeEligible({
        model: buildModel(),
        hasResumeAction: true,
      }),
    ).toBe(true);
    expect(
      isInterruptedTurnResumeEligible({
        model: buildModel({ isThreadRunning: true }),
        hasResumeAction: true,
      }),
    ).toBe(false);
    expect(
      isInterruptedTurnResumeEligible({
        model: buildModel({ conversation: null }),
        hasResumeAction: true,
      }),
    ).toBe(false);
    expect(
      isInterruptedTurnResumeEligible({
        model: buildModel(),
        hasResumeAction: false,
      }),
    ).toBe(false);
  });

  test("admits one attempt until its release completes", () => {
    const gate = createInterruptedTurnResumeGate();
    const release = gate.tryAcquire(true);

    expect(release).not.toBeNull();
    expect(gate.tryAcquire(true)).toBeNull();
    release?.();
    release?.();
    expect(gate.tryAcquire(true)).not.toBeNull();
  });
});
