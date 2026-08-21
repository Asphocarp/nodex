import { describe, expect, test } from "vite-plus/test";
import {
  CodexUserInputAutoResolutionController,
  USER_INPUT_AUTO_RESOLUTION_COUNTDOWN_MS,
  USER_INPUT_FOREGROUND_INACTIVITY_MS,
} from "./codex-user-input-auto-resolution";
import type { CodexUserInputAutoResolutionChange } from "../../shared/codex-user-input-auto-resolution";

function createManualClock() {
  let now = 1_000;
  let nextId = 0;
  const timers = new Map<
    number,
    {
      callback: () => void;
      deadline: number;
    }
  >();

  return {
    now: () => now,
    setTimeout: (callback: () => void, timeoutMs: number) => {
      const id = ++nextId;
      timers.set(id, {
        callback,
        deadline: now + timeoutMs,
      });
      return id;
    },
    clearTimeout: (id: unknown) => {
      timers.delete(id as number);
    },
    advanceBy: (durationMs: number) => {
      const target = now + durationMs;
      while (true) {
        const due = [...timers.entries()]
          .filter(([, timer]) => timer.deadline <= target)
          .sort((left, right) => left[1].deadline - right[1].deadline)[0];
        if (!due) break;
        timers.delete(due[0]);
        now = due[1].deadline;
        due[1].callback();
      }
      now = target;
    },
  };
}

describe("CodexUserInputAutoResolutionController", () => {
  test("waits for foreground inactivity before starting the countdown", async () => {
    const clock = createManualClock();
    const changes: CodexUserInputAutoResolutionChange[] = [];
    const resolved: Array<[string, string | number]> = [];
    const controller = new CodexUserInputAutoResolutionController({
      ...clock,
      isConversationPresented: () => true,
      onChange: (change) => changes.push(change),
      onResolve: (conversationId, requestId) => {
        resolved.push([conversationId, requestId]);
      },
    });

    controller.observeRequest("thread-1", "request-1");
    expect(controller.snapshot()[0]?.phase.type).toBe("waitingForInactivity");

    clock.advanceBy(USER_INPUT_FOREGROUND_INACTIVITY_MS - 1);
    expect(controller.snapshot()[0]?.phase.type).toBe("waitingForInactivity");
    clock.advanceBy(1);
    expect(controller.snapshot()[0]?.phase).toEqual({
      type: "scheduled",
      deadlineMs: clock.now() + USER_INPUT_AUTO_RESOLUTION_COUNTDOWN_MS,
    });

    clock.advanceBy(USER_INPUT_AUTO_RESOLUTION_COUNTDOWN_MS);
    await Promise.resolve();
    expect(resolved).toEqual([["thread-1", "request-1"]]);
    expect(controller.snapshot()).toEqual([]);
    expect(changes.at(-1)).toEqual({
      type: "timedOut",
      conversationId: "thread-1",
      requestId: "request-1",
    });
  });

  test("starts background countdown immediately and snoozes permanently", () => {
    const clock = createManualClock();
    const resolved: Array<[string, string | number]> = [];
    const controller = new CodexUserInputAutoResolutionController({
      ...clock,
      isConversationPresented: () => false,
      onChange: () => undefined,
      onResolve: (conversationId, requestId) => {
        resolved.push([conversationId, requestId]);
      },
    });

    controller.observeRequest("thread-1", 7);
    expect(controller.snapshot()[0]?.phase.type).toBe("scheduled");
    expect(controller.snooze("thread-1", "7")).toBe(false);
    expect(controller.snapshot()[0]?.phase.type).toBe("scheduled");
    expect(controller.snooze("thread-1", 7)).toBe(true);
    expect(controller.snapshot()[0]?.phase.type).toBe("snoozed");
    clock.advanceBy(USER_INPUT_AUTO_RESOLUTION_COUNTDOWN_MS * 2);
    expect(resolved).toEqual([]);
  });

  test("resets only the inactivity timer and cancels on manual response", () => {
    const clock = createManualClock();
    const resolved: Array<[string, string | number]> = [];
    const controller = new CodexUserInputAutoResolutionController({
      ...clock,
      isConversationPresented: () => true,
      onChange: () => undefined,
      onResolve: (conversationId, requestId) => {
        resolved.push([conversationId, requestId]);
      },
    });

    controller.observeRequest("thread-1", "7");
    clock.advanceBy(USER_INPUT_FOREGROUND_INACTIVITY_MS - 1);
    controller.recordActivity("thread-1");
    clock.advanceBy(USER_INPUT_FOREGROUND_INACTIVITY_MS - 1);
    expect(controller.snapshot()[0]?.phase.type).toBe("waitingForInactivity");

    controller.observeResponse("thread-1", "7");
    clock.advanceBy(USER_INPUT_FOREGROUND_INACTIVITY_MS + USER_INPUT_AUTO_RESOLUTION_COUNTDOWN_MS);
    expect(resolved).toEqual([]);
    expect(controller.snapshot()).toEqual([]);
  });

  test("replaces the prior request while preserving strict scalar identity", () => {
    const clock = createManualClock();
    const changes: CodexUserInputAutoResolutionChange[] = [];
    const controller = new CodexUserInputAutoResolutionController({
      ...clock,
      isConversationPresented: () => false,
      onChange: (change) => changes.push(change),
      onResolve: () => undefined,
    });

    controller.observeRequest("thread-1", 7);
    controller.observeRequest("thread-1", "7");
    expect(controller.snapshot()).toHaveLength(1);
    controller.observeResponse("thread-1", 7);
    expect(controller.snapshot()).toHaveLength(1);
    expect(changes).toContainEqual({
      type: "removed",
      conversationId: "thread-1",
      requestId: 7,
      reason: "replaced",
    });
    controller.observeResponse("thread-1", "7");
    expect(controller.snapshot()).toEqual([]);
  });

  test("cancels when thread-history reconciliation removes the request", () => {
    const clock = createManualClock();
    const resolved: Array<[string, string | number]> = [];
    const controller = new CodexUserInputAutoResolutionController({
      ...clock,
      isConversationPresented: () => false,
      onChange: () => undefined,
      onResolve: (conversationId, requestId) => {
        resolved.push([conversationId, requestId]);
      },
    });

    controller.observeRequest("thread-1", 7);
    controller.reconcilePendingRequests("thread-1", ["7"]);
    clock.advanceBy(USER_INPUT_AUTO_RESOLUTION_COUNTDOWN_MS);

    expect(controller.snapshot()).toEqual([]);
    expect(resolved).toEqual([]);
  });

  test("returns a background countdown to inactivity when presentation becomes foreground", () => {
    const clock = createManualClock();
    let presented = false;
    const controller = new CodexUserInputAutoResolutionController({
      ...clock,
      isConversationPresented: () => presented,
      onChange: () => undefined,
      onResolve: () => undefined,
    });

    controller.observeRequest("thread-1", "request-1");
    expect(controller.snapshot()[0]?.phase.type).toBe("scheduled");

    presented = true;
    controller.reevaluatePresentation("thread-1");
    expect(controller.snapshot()[0]?.phase.type).toBe("waitingForInactivity");
  });

  test("survives a blur-focus handoff between foreground presenters", () => {
    const clock = createManualClock();
    let presented = true;
    const controller = new CodexUserInputAutoResolutionController({
      ...clock,
      isConversationPresented: () => presented,
      onChange: () => undefined,
      onResolve: () => undefined,
    });

    controller.observeRequest("thread-1", "request-1");
    presented = false;
    controller.reevaluatePresentation("thread-1");
    expect(controller.snapshot()[0]?.phase.type).toBe("scheduled");

    presented = true;
    controller.reevaluatePresentation("thread-1");
    expect(controller.snapshot()[0]?.phase.type).toBe("waitingForInactivity");
  });

  test("publishes a terminal timeout before awaiting response I/O and does not retry failures", async () => {
    const clock = createManualClock();
    const errors: unknown[] = [];
    const changes: CodexUserInputAutoResolutionChange[] = [];
    let rejectResolution: (error: Error) => void = () => {
      throw new Error("Resolution rejector was not initialized");
    };
    const resolution = new Promise<void>((_, reject) => {
      rejectResolution = reject;
    });
    const controller = new CodexUserInputAutoResolutionController({
      ...clock,
      isConversationPresented: () => false,
      onChange: (change) => changes.push(change),
      onResolve: () => resolution,
      onResolveError: (error) => errors.push(error),
    });

    controller.observeRequest("thread-1", "request-1");
    clock.advanceBy(USER_INPUT_AUTO_RESOLUTION_COUNTDOWN_MS);
    expect(controller.snapshot()).toEqual([]);
    expect(changes.at(-1)).toEqual({
      type: "timedOut",
      conversationId: "thread-1",
      requestId: "request-1",
    });

    rejectResolution(new Error("transport failed"));
    await Promise.resolve();
    expect(errors).toHaveLength(1);

    clock.advanceBy(USER_INPUT_AUTO_RESOLUTION_COUNTDOWN_MS);
    await Promise.resolve();
    expect(controller.snapshot()).toEqual([]);
  });

  test("ignores a cancelled timer callback that was already queued", () => {
    const callbacks: Array<() => void> = [];
    const controller = new CodexUserInputAutoResolutionController({
      now: () => 1_000,
      setTimeout: (callback) => {
        callbacks.push(callback);
        return callbacks.length;
      },
      clearTimeout: () => undefined,
      isConversationPresented: () => true,
      onChange: () => undefined,
      onResolve: () => undefined,
    });

    controller.observeRequest("thread-1", "request-1");
    controller.recordActivity("thread-1");
    callbacks[0]?.();

    expect(controller.snapshot()[0]?.phase.type).toBe("waitingForInactivity");
  });

  test("treats disconnect as terminal for the current request generation", () => {
    const clock = createManualClock();
    const changes: CodexUserInputAutoResolutionChange[] = [];
    const controller = new CodexUserInputAutoResolutionController({
      ...clock,
      isConversationPresented: () => false,
      onChange: (change) => changes.push(change),
      onResolve: () => undefined,
    });

    controller.observeRequest("thread-1", "request-1");
    controller.handleDisconnect();
    expect(controller.snapshot()).toEqual([]);
    expect(changes.at(-1)).toEqual({
      type: "removed",
      conversationId: "thread-1",
      requestId: "request-1",
      reason: "disconnected",
    });

    controller.observeServerResolution("thread-1", "request-1");
    expect(changes).toHaveLength(2);
  });
});
