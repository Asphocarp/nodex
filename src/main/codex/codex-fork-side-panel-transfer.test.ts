import { describe, expect, test } from "vitest";
import {
  CodexForkSidePanelTransferManager,
  type CodexForkSidePanelSnapshotAdapter,
} from "./codex-fork-side-panel-transfer";

interface TestSnapshot {
  readonly value: string;
  readonly appliedPrefix?: number;
}

function makeHarness() {
  const events: string[] = [];
  let applyFailure: Error | null = null;
  let rebaseFailure: Error | null = null;
  const adapter: CodexForkSidePanelSnapshotAdapter<TestSnapshot> = {
    capture: async (sourceConversationId) => {
      events.push(`capture:${sourceConversationId}`);
      return { value: sourceConversationId };
    },
    rebase: async (snapshot, input) => {
      events.push([
        "rebase",
        snapshot.value,
        input.targetConversationId,
        input.sourceWorkspaceRoot ?? "-",
        input.targetWorkspaceRoot ?? "-",
      ].join(":"));
      if (rebaseFailure) throw rebaseFailure;
      return { value: `${snapshot.value}->${input.targetConversationId}` };
    },
    apply: async (snapshot, input) => {
      events.push(`apply-prefix:${snapshot.value}:${input.targetProjectSessionId}`);
      if (applyFailure) throw applyFailure;
      events.push(`apply-complete:${input.targetConversationId}`);
    },
  };
  return {
    events,
    manager: new CodexForkSidePanelTransferManager(adapter),
    setApplyFailure: (error: Error | null) => {
      applyFailure = error;
    },
    setRebaseFailure: (error: Error | null) => {
      rebaseFailure = error;
    },
  };
}

describe("CodexForkSidePanelTransferManager", () => {
  test("keeps pending and target namespaces independent and last-write-wins", async () => {
    const { manager } = makeHarness();
    await manager.capturePending({
      pendingWorktreeId: "shared",
      sourceConversationId: "source-a",
      sourceWorkspaceRoot: "/source-a",
    });
    await manager.stageDirect({
      sourceConversationId: "source-direct",
      targetConversationId: "shared",
    });
    await manager.capturePending({
      pendingWorktreeId: "shared",
      sourceConversationId: "source-b",
      sourceWorkspaceRoot: "/source-b",
    });

    expect(manager.getPendingSnapshot("shared")?.value).toBe("source-b");
    expect(manager.getTargetSnapshot("shared")?.value).toBe("source-direct->shared");
  });

  test("does not touch an existing target when pending promotion is missing", async () => {
    const { events, manager } = makeHarness();
    await manager.stageDirect({
      sourceConversationId: "source",
      targetConversationId: "target",
    });
    events.length = 0;

    expect(await manager.promotePending({
      pendingWorktreeId: "missing",
      targetConversationId: "target",
      targetWorkspaceRoot: "/target",
    })).toBe(false);
    expect(events.length).toBe(0);
    expect(manager.getTargetSnapshot("target")?.value).toBe("source->target");
  });

  test("promotes with frozen source root then consumes the pending slot once", async () => {
    const { events, manager } = makeHarness();
    await manager.capturePending({
      pendingWorktreeId: "pending",
      sourceConversationId: "source",
      sourceWorkspaceRoot: "/source",
    });

    expect(await manager.promotePending({
      pendingWorktreeId: "pending",
      targetConversationId: "target",
      targetWorkspaceRoot: "/target",
    })).toBe(true);
    expect(events.at(-1)).toBe("rebase:source:target:/source:/target");
    expect(manager.getPendingSnapshot("pending")).toBe(null);
    expect(manager.getTargetSnapshot("target")?.value).toBe("source->target");
    expect(await manager.promotePending({
      pendingWorktreeId: "pending",
      targetConversationId: "other",
      targetWorkspaceRoot: "/other",
    })).toBe(false);
  });

  test("retains pending and the previous target when rebase throws", async () => {
    const { manager, setRebaseFailure } = makeHarness();
    await manager.stageDirect({
      sourceConversationId: "old-source",
      targetConversationId: "target",
    });
    await manager.capturePending({
      pendingWorktreeId: "pending",
      sourceConversationId: "new-source",
      sourceWorkspaceRoot: "/source",
    });
    setRebaseFailure(new Error("rebase failed"));

    let message = "";
    try {
      await manager.promotePending({
        pendingWorktreeId: "pending",
        targetConversationId: "target",
        targetWorkspaceRoot: "/target",
      });
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }
    expect(message).toBe("rebase failed");
    expect(manager.getPendingSnapshot("pending")?.value).toBe("new-source");
    expect(manager.getTargetSnapshot("target")?.value).toBe("old-source->target");
  });

  test("explicit pending discard is idempotent and cannot clear a target", async () => {
    const { manager } = makeHarness();
    await manager.capturePending({
      pendingWorktreeId: "pending",
      sourceConversationId: "source",
      sourceWorkspaceRoot: "/source",
    });
    await manager.stageDirect({
      sourceConversationId: "source",
      targetConversationId: "target",
    });

    manager.discardPending("pending");
    manager.discardPending("pending");
    expect(manager.getPendingSnapshot("pending")).toBe(null);
    expect(manager.getTargetSnapshot("target")?.value).toBe("source->target");
  });

  test("clears target only after the complete apply callback succeeds", async () => {
    const { events, manager } = makeHarness();
    await manager.stageDirect({
      sourceConversationId: "source",
      targetConversationId: "target",
    });

    expect(await manager.consumeTarget({
      routeKind: "local-thread",
      targetConversationId: "target",
      targetProjectSessionId: "session-target",
    })).toEqual({ value: "source->target" });
    expect(events.slice(-2).join(",")).toBe(
      "apply-prefix:source->target:session-target,apply-complete:target",
    );
    expect(manager.getTargetSnapshot("target")).toBe(null);
    expect(await manager.consumeTarget({
      routeKind: "local-thread",
      targetConversationId: "target",
      targetProjectSessionId: "session-target",
    })).toBe(null);
  });

  test("retains target and replays an applied prefix after an apply throw", async () => {
    const { events, manager, setApplyFailure } = makeHarness();
    await manager.stageDirect({
      sourceConversationId: "source",
      targetConversationId: "target",
    });
    setApplyFailure(new Error("apply failed"));

    let message = "";
    try {
      await manager.consumeTarget({
        routeKind: "local-thread",
        targetConversationId: "target",
        targetProjectSessionId: "session-target",
      });
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }
    expect(message).toBe("apply failed");
    expect(manager.getTargetSnapshot("target")?.value).toBe("source->target");

    setApplyFailure(null);
    expect(await manager.consumeTarget({
      routeKind: "local-thread",
      targetConversationId: "target",
      targetProjectSessionId: "session-target",
    })).toEqual({ value: "source->target" });
    expect(events.filter((event) => event.startsWith("apply-prefix:")).length).toBe(2);
  });

  test("wrong-route guard runs before lookup or apply and retains target", async () => {
    const { events, manager } = makeHarness();
    await manager.stageDirect({
      sourceConversationId: "source",
      targetConversationId: "target",
    });
    const applyEventCount = events.filter((event) => event.startsWith("apply-")).length;

    let message = "";
    try {
      await manager.consumeTarget({
        routeKind: "pending-thread",
        targetConversationId: "target",
        targetProjectSessionId: "session-target",
      });
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }
    expect(message).toBe("Expected local conversation route");
    expect(events.filter((event) => event.startsWith("apply-")).length).toBe(applyEventCount);
    expect(manager.getTargetSnapshot("target")?.value).toBe("source->target");
  });

  test("clear and fresh manager instances have no restart recovery state", async () => {
    const first = makeHarness();
    await first.manager.capturePending({
      pendingWorktreeId: "pending",
      sourceConversationId: "source",
      sourceWorkspaceRoot: "/source",
    });
    await first.manager.stageDirect({
      sourceConversationId: "source",
      targetConversationId: "target",
    });
    first.manager.clear();

    const fresh = makeHarness().manager;
    expect(first.manager.getPendingSnapshot("pending")).toBe(null);
    expect(first.manager.getTargetSnapshot("target")).toBe(null);
    expect(fresh.getPendingSnapshot("pending")).toBe(null);
    expect(fresh.getTargetSnapshot("target")).toBe(null);
  });
});
