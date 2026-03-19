import { describe, expect, test } from "bun:test";
import { resolveStageThreadsComposerActionState } from "./composer-action";

describe("resolveStageThreadsComposerActionState", () => {
  test("keeps stop only while a turn is active and the draft is empty", () => {
    const result = resolveStageThreadsComposerActionState({
      canSendPrompt: true,
      isThreadRunning: true,
      busyAction: null,
      hasDraftContent: false,
      isQueueingEnabled: false,
    });

    expect(result.action).toBe("stop");
    expect(result.label).toBe("Stop Codex");
    expect(result.disabled).toBeFalse();
  });

  test("disables stop action while an interrupt request is pending", () => {
    const result = resolveStageThreadsComposerActionState({
      canSendPrompt: true,
      isThreadRunning: true,
      busyAction: "interrupt",
      hasDraftContent: false,
      isQueueingEnabled: false,
    });

    expect(result.action).toBe("stop");
    expect(result.disabled).toBeTrue();
  });

  test("switches to steer submit while running when queue mode is off and draft exists", () => {
    const result = resolveStageThreadsComposerActionState({
      canSendPrompt: true,
      isThreadRunning: true,
      busyAction: null,
      hasDraftContent: true,
      isQueueingEnabled: false,
    });

    expect(result.action).toBe("send");
    expect(result.submitAction).toBe("steer");
    expect(result.alternateInProgressSubmitAction).toBe("queue");
    expect(result.label).toBe("Steer follow-up");
    expect(result.disabled).toBeFalse();
  });

  test("switches to queue submit while running when queue mode is on and draft exists", () => {
    const result = resolveStageThreadsComposerActionState({
      canSendPrompt: true,
      isThreadRunning: true,
      busyAction: null,
      hasDraftContent: true,
      isQueueingEnabled: true,
    });

    expect(result.action).toBe("send");
    expect(result.submitAction).toBe("queue");
    expect(result.alternateInProgressSubmitAction).toBe("steer");
    expect(result.label).toBe("Queue follow-up");
    expect(result.disabled).toBeFalse();
  });

  test("uses send action when idle and enables it only for non-empty prompts", () => {
    const disabled = resolveStageThreadsComposerActionState({
      canSendPrompt: true,
      isThreadRunning: false,
      busyAction: null,
      hasDraftContent: false,
      isQueueingEnabled: false,
    });
    const enabled = resolveStageThreadsComposerActionState({
      canSendPrompt: true,
      isThreadRunning: false,
      busyAction: null,
      hasDraftContent: true,
      isQueueingEnabled: false,
    });

    expect(disabled.action).toBe("send");
    expect(disabled.submitAction).toBe("send");
    expect(disabled.label).toBe("Send prompt");
    expect(disabled.disabled).toBeTrue();
    expect(enabled.action).toBe("send");
    expect(enabled.submitAction).toBe("send");
    expect(enabled.disabled).toBeFalse();
  });

  test("allows send in new-thread mode when a target card exists", () => {
    const enabled = resolveStageThreadsComposerActionState({
      canSendPrompt: true,
      isThreadRunning: false,
      busyAction: null,
      hasDraftContent: true,
      isQueueingEnabled: false,
    });
    const disabled = resolveStageThreadsComposerActionState({
      canSendPrompt: false,
      isThreadRunning: false,
      busyAction: null,
      hasDraftContent: true,
      isQueueingEnabled: false,
    });

    expect(enabled.disabled).toBeFalse();
    expect(disabled.disabled).toBeTrue();
  });
});
