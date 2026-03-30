import { describe, expect, test } from "bun:test";
import { codexControlStoreReducer, createInitialCodexControlState } from "./codex-control-store";

describe("codex-control-store", () => {
  test("ignores thread summary and status events because thread lists now live in local conversation store", () => {
    const initial = createInitialCodexControlState();
    const afterSummary = codexControlStoreReducer(initial, {
      type: "event",
      event: {
        type: "threadSummary",
        thread: {
          threadId: "thread-1",
          projectId: "project-1",
          cardId: "card-1",
          threadName: "Thread 1",
          threadPreview: "Preview",
          modelProvider: "openai",
          cwd: "/tmp/project",
          statusType: "idle",
          statusActiveFlags: [],
          archived: false,
          createdAt: 1,
          updatedAt: 2,
          linkedAt: "2026-03-23T00:00:00.000Z",
        },
      },
    });
    const afterStatus = codexControlStoreReducer(afterSummary, {
      type: "event",
      event: {
        type: "threadStatus",
        threadId: "thread-1",
        statusType: "active",
        statusActiveFlags: ["waitingOnUserInput"],
      },
    });

    expect(afterStatus).toBe(initial);
  });

  test("stores permission mode per project", () => {
    const initial = createInitialCodexControlState();

    const next = codexControlStoreReducer(initial, {
      type: "setPermissionMode",
      projectId: "project-1",
      mode: "full-access",
    });

    expect(next.permissionModeByProject["project-1"]).toBe("full-access");
  });

  test("tracks thread start progress output deltas with carriage returns and backspaces", () => {
    const initial = createInitialCodexControlState();
    const withStdout = codexControlStoreReducer(initial, {
      type: "event",
      event: {
        type: "threadStartProgress",
        projectId: "project-1",
        cardId: "card-1",
        phase: "runningSetup",
        message: "Running setup",
        outputDelta: "hello",
        updatedAt: 1,
      },
    });
    const withCarriageReturn = codexControlStoreReducer(withStdout, {
      type: "event",
      event: {
        type: "threadStartProgress",
        projectId: "project-1",
        cardId: "card-1",
        phase: "runningSetup",
        message: "Running setup",
        outputDelta: "\rworld",
        updatedAt: 2,
      },
    });
    const withBackspace = codexControlStoreReducer(withCarriageReturn, {
      type: "event",
      event: {
        type: "threadStartProgress",
        projectId: "project-1",
        cardId: "card-1",
        phase: "runningSetup",
        message: "Running setup",
        outputDelta: "\b!",
        updatedAt: 3,
      },
    });

    expect(withBackspace.threadStartProgressByTarget["project-1:card-1"]?.outputText).toBe("worl!");
  });

  test("clears previous progress output when requested", () => {
    const initial = codexControlStoreReducer(createInitialCodexControlState(), {
      type: "event",
      event: {
        type: "threadStartProgress",
        projectId: "project-1",
        cardId: "card-1",
        phase: "runningSetup",
        message: "Running setup",
        outputDelta: "old output",
        updatedAt: 1,
      },
    });

    const next = codexControlStoreReducer(initial, {
      type: "event",
      event: {
        type: "threadStartProgress",
        projectId: "project-1",
        cardId: "card-1",
        phase: "failed",
        message: "Failed",
        clearOutput: true,
        outputDelta: "new output",
        updatedAt: 2,
      },
    });

    expect(next.threadStartProgressByTarget["project-1:card-1"]?.outputText).toBe("new output");
    expect(next.threadStartProgressByTarget["project-1:card-1"]?.phase).toBe("failed");
  });
});
