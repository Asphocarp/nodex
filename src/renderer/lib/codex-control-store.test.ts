import { describe, expect, test } from "bun:test";
import { codexControlStoreReducer, createInitialCodexControlState } from "./codex-control-store";

describe("codex-control-store", () => {
  test("stores thread lists sorted by updatedAt descending", () => {
    const initial = createInitialCodexControlState();

    const next = codexControlStoreReducer(initial, {
      type: "setThreads",
      projectId: "project-1",
      threads: [
        {
          threadId: "thread-older",
          projectId: "project-1",
          cardId: "card-1",
          threadName: "Older",
          threadPreview: "",
          modelProvider: "openai",
          cwd: "/tmp/project",
          statusType: "idle",
          statusActiveFlags: [],
          archived: false,
          createdAt: 1,
          updatedAt: 2,
          linkedAt: "2026-03-23T00:00:00.000Z",
        },
        {
          threadId: "thread-newer",
          projectId: "project-1",
          cardId: "card-2",
          threadName: "Newer",
          threadPreview: "",
          modelProvider: "openai",
          cwd: "/tmp/project",
          statusType: "active",
          statusActiveFlags: [],
          archived: false,
          createdAt: 1,
          updatedAt: 5,
          linkedAt: "2026-03-23T00:00:00.000Z",
        },
      ],
    });

    expect(next.threadsByProject["project-1"]?.[0]?.threadId).toBe("thread-newer");
    expect(next.threadsByProject["project-1"]?.[1]?.threadId).toBe("thread-older");
  });

  test("applies thread summary, archive, and status events without thread detail state", () => {
    const initial = codexControlStoreReducer(createInitialCodexControlState(), {
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

    const withArchived = codexControlStoreReducer(initial, {
      type: "event",
      event: {
        type: "threadArchivedState",
        threadId: "thread-1",
        archived: true,
      },
    });
    const withStatus = codexControlStoreReducer(withArchived, {
      type: "event",
      event: {
        type: "threadStatus",
        threadId: "thread-1",
        statusType: "active",
        statusActiveFlags: ["waitingOnUserInput"],
      },
    });

    expect(withStatus.threadsByProject["project-1"]?.[0]?.archived).toBeTrue();
    expect(withStatus.threadsByProject["project-1"]?.[0]?.statusType).toBe("active");
    expect(withStatus.threadsByProject["project-1"]?.[0]?.statusActiveFlags[0]).toBe("waitingOnUserInput");
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
