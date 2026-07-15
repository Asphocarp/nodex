import { describe, expect, test } from "vitest";
import type { DragEndEvent } from "@dnd-kit/core";
import { act } from "react";
import { render } from "@/test/dom";
import {
  dispatchSidebarThreadDragEnd,
  getSidebarThreadProjectDropContainerId,
  getSidebarThreadContainerEdgeInsetY,
  moveSidebarThreadBefore,
  resolveDisplayedVisibleThreadKeys,
  resolveSidebarThreadDropPolicy,
  resolveSidebarThreadDropIndicatorIndex,
  resolveSidebarThreadDropTarget,
  resolveSidebarThreadExternalDropTarget,
  resolveSidebarThreadKeysWithPendingDrops,
  resolveSidebarThreadContainerTargetId,
  resolveSidebarThreadProjectDropContainerId,
  SidebarThreadReorderRows,
  SidebarThreadSortableContext,
  SidebarThreadSortableItem,
  useSidebarThreadReorderController,
  type PendingSidebarThreadDrop,
  type SidebarThreadContainerDndPayload,
  type SidebarThreadItemDndPayload,
  type SidebarThreadReorderController,
} from "./sidebar-thread-reorder";
import { SidebarReorderDndProvider } from "./sidebar-reorder-dnd";

const SOURCE_RECT = { top: 60, bottom: 90 };
const TARGET_RECT = { top: 0, bottom: 30 };

function makeDragEndEvent({
  activeThreadKey,
  overThreadKey,
  activeRect = SOURCE_RECT,
  overRect = TARGET_RECT,
}: {
  activeThreadKey: string;
  overThreadKey: string | null;
  activeRect?: { top: number; bottom: number };
  overRect?: { top: number; bottom: number };
}): DragEndEvent {
  return {
    active: {
      id: activeThreadKey,
      rect: {
        current: {
          translated: activeRect,
        },
      },
    },
    over: overThreadKey === null
      ? null
      : {
          id: overThreadKey,
          rect: overRect,
        },
  } as unknown as DragEndEvent;
}

function makeSidebarThreadPayload({
  containerId,
  controller,
  getNextThreadId,
  getNextThreadKey,
  sourceProjectKind = "local",
  targetProjectKind = "local",
  threadId,
  threadKey,
}: {
  containerId: string;
  controller: SidebarThreadReorderController;
  getNextThreadId?: () => string | null;
  getNextThreadKey?: () => string | null;
  sourceProjectKind?: "local" | "remote";
  targetProjectKind?: "local" | "remote";
  threadId: string | null;
  threadKey: string;
}): SidebarThreadItemDndPayload {
  return {
    kind: "sidebar-item",
    controller,
    thread: {
      containerId,
      dragOverlay: threadKey,
      getNextThreadId,
      getNextThreadKey,
      sourceProjectKind,
      targetProjectKind,
      threadId,
      threadKey,
    },
  };
}

function makeRichDragEndEvent({
  activePayload,
  overId,
  overPayload,
  activeRect = SOURCE_RECT,
  overRect = TARGET_RECT,
}: {
  activePayload: SidebarThreadItemDndPayload;
  overId: string;
  overPayload: SidebarThreadContainerDndPayload | SidebarThreadItemDndPayload;
  activeRect?: { top: number; bottom: number };
  overRect?: { top: number; bottom: number };
}): DragEndEvent {
  return {
    active: {
      data: { current: activePayload },
      id: activePayload.thread.threadKey,
      rect: { current: { translated: activeRect } },
    },
    over: {
      data: { current: overPayload },
      id: overId,
      rect: overRect,
    },
  } as unknown as DragEndEvent;
}

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
}

describe("sidebar thread insertion targeting", () => {
  test("places the dragged thread before the hovered row above its midpoint", () => {
    const target = resolveSidebarThreadDropTarget({
      visibleThreadKeys: ["local:alpha", "local:beta", "remote:gamma"],
      activeThreadKey: "remote:gamma",
      overThreadKey: "local:alpha",
      activeRect: SOURCE_RECT,
      overRect: TARGET_RECT,
      pointerY: 4,
    });

    expect(target?.beforeThreadKey).toBe("local:alpha");
    expect(JSON.stringify(moveSidebarThreadBefore(
      ["local:alpha", "local:beta", "remote:gamma"],
      "remote:gamma",
      target?.beforeThreadKey ?? null,
    ))).toBe(JSON.stringify(["remote:gamma", "local:alpha", "local:beta"]));
  });

  test("places the dragged thread after the hovered row below its midpoint", () => {
    const target = resolveSidebarThreadDropTarget({
      visibleThreadKeys: ["alpha", "beta", "gamma"],
      activeThreadKey: "gamma",
      overThreadKey: "alpha",
      activeRect: SOURCE_RECT,
      overRect: TARGET_RECT,
      pointerY: 26,
    });

    expect(target?.beforeThreadKey).toBe("beta");
  });

  test("uses the translated active midpoint for keyboard sorting", () => {
    const target = resolveSidebarThreadDropTarget({
      visibleThreadKeys: ["alpha", "beta", "gamma"],
      activeThreadKey: "gamma",
      overThreadKey: "alpha",
      activeRect: { top: 2, bottom: 28 },
      overRect: TARGET_RECT,
      pointerY: null,
    });

    expect(target?.beforeThreadKey).toBe("beta");
  });

  test("suppresses an unchanged drop and its indicator", () => {
    const target = resolveSidebarThreadDropTarget({
      visibleThreadKeys: ["alpha", "beta", "gamma"],
      activeThreadKey: "gamma",
      overThreadKey: "beta",
      activeRect: SOURCE_RECT,
      overRect: { top: 30, bottom: 60 },
      pointerY: 58,
    });

    expect(target).toBe(null);
  });

  test("resolves indicators before a row or after the final row", () => {
    expect(resolveSidebarThreadDropIndicatorIndex(
      ["alpha", "beta"],
      { beforeThreadKey: "beta" },
    )).toBe(1);
    expect(resolveSidebarThreadDropIndicatorIndex(
      ["alpha", "beta"],
      { beforeThreadKey: null },
    )).toBe(2);
  });
});

describe("cross-container sidebar thread targeting", () => {
  const controller: SidebarThreadReorderController = {
    handleDragEnd() {},
  };
  const activePayload = makeSidebarThreadPayload({
    containerId: "project:alpha",
    controller,
    threadId: "thread-alpha",
    threadKey: "local:thread-alpha",
  });

  test("resolves the target row and its next real thread as insertion anchors", () => {
    const targetPayload = makeSidebarThreadPayload({
      containerId: "project:beta",
      controller: { handleDragEnd() {} },
      getNextThreadKey: () => "local:thread-gamma",
      threadId: "thread-beta",
      threadKey: "local:thread-beta",
    });
    const event = makeRichDragEndEvent({
      activePayload,
      overId: "local:thread-beta",
      overPayload: targetPayload,
    });

    const beforeTarget = resolveSidebarThreadExternalDropTarget(
      event,
      4,
      (threadKey) => threadKey.slice("local:".length),
    );
    const afterTarget = resolveSidebarThreadExternalDropTarget(
      event,
      26,
      (threadKey) => threadKey.slice("local:".length),
    );

    expect(beforeTarget?.beforeThreadId).toBe("thread-beta");
    expect(afterTarget?.beforeThreadId).toBe("thread-gamma");
    expect(Boolean(afterTarget?.insertAtEnd)).toBe(false);
  });

  test("marks the drop after the final real row as an end insertion", () => {
    const targetPayload = makeSidebarThreadPayload({
      containerId: "project:beta",
      controller: { handleDragEnd() {} },
      getNextThreadKey: () => null,
      threadId: "thread-beta",
      threadKey: "local:thread-beta",
    });
    const target = resolveSidebarThreadExternalDropTarget(
      makeRichDragEndEvent({
        activePayload,
        overId: "local:thread-beta",
        overPayload: targetPayload,
      }),
      26,
      () => null,
    );

    expect(target?.beforeThreadId).toBe(null);
    expect(target?.insertAtEnd).toBe(true);
  });

  test("uses a project container target as default-order placement", () => {
    const target = resolveSidebarThreadExternalDropTarget(
      makeRichDragEndEvent({
        activePayload,
        overId: "sidebar-thread-container:project:beta",
        overPayload: {
          kind: "sidebar-thread-container",
          containerId: "project:beta",
          targetProjectKind: "local",
        },
      }),
      16,
      () => null,
    );

    expect(target?.targetContainerId).toBe("project:beta");
    expect(target?.beforeThreadId).toBe(null);
    expect(target?.useDefaultOrder).toBe(true);
  });

  test("keeps a project droppable id stable while resolving a pinned source at the drop boundary", () => {
    const containerPayload: SidebarThreadContainerDndPayload = {
      kind: "sidebar-thread-container",
      containerId: getSidebarThreadProjectDropContainerId("beta"),
      preserveSourceProjectLane: true,
      targetProjectKind: "local",
    };
    const pinnedActivePayload = makeSidebarThreadPayload({
      containerId: "project-pinned:alpha",
      controller,
      threadId: "thread-alpha",
      threadKey: "local:thread-alpha",
    });
    const target = resolveSidebarThreadExternalDropTarget(
      makeRichDragEndEvent({
        activePayload: pinnedActivePayload,
        overId: "sidebar-thread-container:project:beta",
        overPayload: containerPayload,
      }),
      16,
      () => null,
    );

    expect(containerPayload.containerId).toBe("project:beta");
    expect(resolveSidebarThreadContainerTargetId(
      containerPayload,
      "project-pinned:alpha",
    )).toBe("project-pinned:beta");
    expect(target?.targetContainerId).toBe("project-pinned:beta");
    expect(target?.useDefaultOrder).toBe(true);
  });

  test("matches project container edge geometry from the reference coordinator", () => {
    expect(getSidebarThreadContainerEdgeInsetY({
      kind: "sidebar-thread-container",
      containerId: "project:alpha",
    })).toBe(10);
    expect(getSidebarThreadContainerEdgeInsetY({
      kind: "sidebar-thread-container",
      containerId: "project:alpha",
      projectDropZone: "project-row",
    })).toBe(7);
    expect(getSidebarThreadContainerEdgeInsetY({
      kind: "sidebar-thread-container",
      containerId: "project:alpha",
      projectDropZone: "project-icon",
    })).toBe(0);
    expect(getSidebarThreadContainerEdgeInsetY({
      kind: "sidebar-thread-container",
      containerId: "chats",
    })).toBe(0);
  });
});

describe("sidebar thread allowed-target policy", () => {
  test("project folder targets preserve the active pin lane", () => {
    expect(resolveSidebarThreadProjectDropContainerId(
      "beta",
      "project-pinned:alpha",
    )).toBe("project-pinned:beta");
    expect(resolveSidebarThreadProjectDropContainerId("beta", "pinned")).toBe(
      "project-pinned:beta",
    );
    expect(resolveSidebarThreadProjectDropContainerId("beta", "project:alpha")).toBe(
      "project:beta",
    );
    expect(resolveSidebarThreadProjectDropContainerId("beta", "chats")).toBe("project:beta");
  });

  function policy(overrides: Partial<Parameters<typeof resolveSidebarThreadDropPolicy>[0]> = {}) {
    return resolveSidebarThreadDropPolicy({
      homeContainerId: "project:alpha",
      sourceContainerId: "project:alpha",
      sourceProjectKind: "local",
      targetContainerId: "project:beta",
      targetProjectKind: "local",
      threadId: "thread-alpha",
      threadKind: "local",
      ...overrides,
    });
  }

  test("allows ordinary local project, chats, and pinned movement", () => {
    const statuses = [
      policy(),
      policy({ targetContainerId: "chats", targetProjectKind: undefined }),
      policy({ targetContainerId: "pinned", targetProjectKind: undefined }),
      policy({ targetContainerId: "project-pinned:beta" }),
      policy({ sourceContainerId: "chats", targetContainerId: "pinned" }),
      policy({
        sourceContainerId: "project-pinned:alpha",
        targetContainerId: "project-pinned:beta",
      }),
      policy({
        homeContainerId: "pinned",
        sourceContainerId: "pinned",
        targetContainerId: "chats",
        targetProjectKind: undefined,
      }),
    ].map((result) => result.status);

    expect(JSON.stringify(statuses)).toBe(JSON.stringify([
      "allowed",
      "allowed",
      "allowed",
      "allowed",
      "allowed",
      "allowed",
      "allowed",
    ]));
  });

  test("allows a pending local row only inside its current container", () => {
    expect(policy({
      sourceContainerId: "project:alpha",
      targetContainerId: "project:alpha",
      threadId: null,
    }).status).toBe("allowed");
    expect(JSON.stringify(policy({ threadId: null }))).toBe(JSON.stringify({
      status: "blocked",
      reason: "pending-cross-container",
    }));
  });

  test("blocks reorder-only, mismatched, remote, cloud, and unsupported targets", () => {
    const reasons = [
      policy({ sourceContainerId: "reorder-only:alpha" }),
      policy({ targetProjectKind: "remote" }),
      policy({ sourceProjectKind: "remote", targetProjectKind: undefined, threadKind: "remote" }),
      policy({ sourceContainerId: "cloud", targetContainerId: "pinned" }),
      policy({ targetContainerId: "unsupported", sourceContainerId: "pinned" }),
    ].map((result) => result.status === "blocked" ? result.reason : "allowed");

    expect(JSON.stringify(reasons)).toBe(JSON.stringify([
      "reorder-only-source",
      "project-kind-mismatch",
      "remote-deferred",
      "cloud-deferred",
      "unsupported-target",
    ]));
  });
});

describe("cross-container drag completion", () => {
  test("ends a same-controller reorder without invoking the external mutation", () => {
    let dragEndCount = 0;
    let dragCancelCount = 0;
    let externalDropCount = 0;
    const controller: SidebarThreadReorderController = {
      handleDragCancel() {
        dragCancelCount += 1;
      },
      handleDragEnd() {
        dragEndCount += 1;
      },
    };
    const activePayload = makeSidebarThreadPayload({
      containerId: "project:alpha",
      controller,
      threadId: "thread-alpha",
      threadKey: "local:thread-alpha",
    });
    const targetPayload = makeSidebarThreadPayload({
      containerId: "project:alpha",
      controller,
      threadId: "thread-beta",
      threadKey: "local:thread-beta",
    });

    const disposition = dispatchSidebarThreadDragEnd({
      cachedDropTarget: null,
      destinationController: null,
      event: makeRichDragEndEvent({
        activePayload,
        overId: "local:thread-beta",
        overPayload: targetPayload,
      }),
      getThreadIdByThreadKey: () => null,
      homeContainerIdByThreadId: new Map(),
      onError() {},
      onThreadDrop() {
        externalDropCount += 1;
      },
      pointerY: 4,
      updatePendingThreadDrops() {},
    });

    expect(disposition).toBe("reordered");
    expect(dragEndCount).toBe(1);
    expect(dragCancelCount).toBe(0);
    expect(externalDropCount).toBe(0);
  });

  test("cancels both controllers and keeps the exact optimistic move until mutation settles", async () => {
    const request = deferred();
    let sourceDragEndCount = 0;
    let sourceDragCancelCount = 0;
    let destinationDragCancelCount = 0;
    const drops: unknown[] = [];
    let pendingDrops: PendingSidebarThreadDrop[] = [];
    const sourceController: SidebarThreadReorderController = {
      handleDragCancel() {
        sourceDragCancelCount += 1;
      },
      handleDragEnd() {
        sourceDragEndCount += 1;
      },
    };
    const destinationController: SidebarThreadReorderController = {
      handleDragCancel() {
        destinationDragCancelCount += 1;
      },
      handleDragEnd() {},
    };
    const activePayload = makeSidebarThreadPayload({
      containerId: "project:alpha",
      controller: sourceController,
      threadId: "thread-alpha",
      threadKey: "local:thread-alpha",
    });
    const targetPayload = makeSidebarThreadPayload({
      containerId: "project:beta",
      controller: destinationController,
      getNextThreadKey: () => null,
      threadId: "thread-beta",
      threadKey: "local:thread-beta",
    });
    const disposition = dispatchSidebarThreadDragEnd({
      cachedDropTarget: null,
      destinationController,
      event: makeRichDragEndEvent({
        activePayload,
        overId: "local:thread-beta",
        overPayload: targetPayload,
      }),
      getThreadIdByThreadKey: () => null,
      homeContainerIdByThreadId: new Map([["thread-alpha", "project:alpha"]]),
      onError() {},
      onThreadDrop(drop) {
        drops.push(drop);
        return request.promise;
      },
      pointerY: 26,
      updatePendingThreadDrops(update) {
        pendingDrops = update(pendingDrops);
      },
    });

    expect(disposition).toBe("moved");
    expect(sourceDragEndCount).toBe(0);
    expect(sourceDragCancelCount).toBe(1);
    expect(destinationDragCancelCount).toBe(1);
    expect(pendingDrops.length).toBe(1);
    expect(drops.length).toBe(0);

    await Promise.resolve();
    expect(drops.length).toBe(1);
    expect(JSON.stringify(drops[0])).toBe(JSON.stringify({
      beforeThreadId: null,
      sourceContainerId: "project:alpha",
      targetContainerId: "project:beta",
      threadId: "thread-alpha",
      insertAtEnd: true,
    }));
    expect(pendingDrops.length).toBe(1);

    request.resolve();
    await request.promise;
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(pendingDrops.length).toBe(0);
  });
});

describe("optimistic sidebar thread order", () => {
  test("removes a moving thread everywhere and inserts it at the requested real anchor", () => {
    const pendingDrop = {
      beforeThreadId: "thread-beta",
      homeContainerId: "project:alpha",
      sourceContainerId: "project:alpha",
      targetContainerId: "project:beta",
      threadId: "thread-alpha",
      threadKey: "local:thread-alpha",
    };

    expect(JSON.stringify(resolveSidebarThreadKeysWithPendingDrops({
      containerId: "project:alpha",
      pendingThreadDrops: [pendingDrop],
      threadKeys: ["local:thread-alpha", "local:thread-gamma"],
      getThreadId: (threadKey) => threadKey.slice("local:".length),
    }))).toBe(JSON.stringify(["local:thread-gamma"]));
    expect(JSON.stringify(resolveSidebarThreadKeysWithPendingDrops({
      containerId: "project:beta",
      pendingThreadDrops: [pendingDrop],
      threadKeys: ["local:thread-beta", "local:thread-delta"],
      getThreadId: (threadKey) => threadKey.slice("local:".length),
    }))).toBe(JSON.stringify([
      "local:thread-alpha",
      "local:thread-beta",
      "local:thread-delta",
    ]));
  });

  test("uses the pending order only while it still describes the authoritative key set", () => {
    const pendingOrder = {
      previousVisibleThreadKeys: ["alpha", "beta", "gamma"],
      nextVisibleThreadKeys: ["gamma", "alpha", "beta"],
    };

    expect(JSON.stringify(resolveDisplayedVisibleThreadKeys(
      ["alpha", "beta", "gamma"],
      pendingOrder,
    ))).toBe(JSON.stringify(["gamma", "alpha", "beta"]));
    expect(JSON.stringify(resolveDisplayedVisibleThreadKeys(
      ["gamma", "alpha", "beta"],
      pendingOrder,
    ))).toBe(JSON.stringify(["gamma", "alpha", "beta"]));
    expect(JSON.stringify(resolveDisplayedVisibleThreadKeys(
      ["alpha", "beta", "delta"],
      pendingOrder,
    ))).toBe(JSON.stringify(["alpha", "beta", "delta"]));
  });

  test("keeps the optimistic order until the returned request settles", async () => {
    const request = deferred();
    const changes: Array<{
      visibleThreadKeys: string[];
      nextVisibleThreadKeys: string[];
    }> = [];
    let latest!: ReturnType<typeof useSidebarThreadReorderController>;

    function Harness() {
      latest = useSidebarThreadReorderController({
        visibleThreadKeys: ["alpha", "beta", "gamma"],
        onVisibleThreadOrderChange(change) {
          changes.push(change);
          return request.promise;
        },
      });
      return null;
    }

    render(<Harness />);

    await act(async () => {
      latest.controller.handleDragEnd(makeDragEndEvent({
        activeThreadKey: "gamma",
        overThreadKey: "alpha",
      }), 4);
      await Promise.resolve();
    });

    expect(JSON.stringify(latest.displayedVisibleThreadKeys)).toBe(JSON.stringify([
      "gamma",
      "alpha",
      "beta",
    ]));
    expect(JSON.stringify(changes[0]?.visibleThreadKeys)).toBe(JSON.stringify([
      "alpha",
      "beta",
      "gamma",
    ]));
    expect(JSON.stringify(changes[0]?.nextVisibleThreadKeys)).toBe(JSON.stringify([
      "gamma",
      "alpha",
      "beta",
    ]));

    await act(async () => {
      request.resolve();
      await request.promise;
      await Promise.resolve();
    });

    expect(JSON.stringify(latest.displayedVisibleThreadKeys)).toBe(JSON.stringify([
      "alpha",
      "beta",
      "gamma",
    ]));
  });

  test("keeps a newer optimistic reorder when an older request settles", async () => {
    const firstRequest = deferred();
    const secondRequest = deferred();
    let requestIndex = 0;
    let latest!: ReturnType<typeof useSidebarThreadReorderController>;

    function Harness({
      visibleThreadKeys,
    }: {
      visibleThreadKeys: string[];
    }) {
      latest = useSidebarThreadReorderController({
        visibleThreadKeys,
        onVisibleThreadOrderChange() {
          const request = requestIndex === 0 ? firstRequest : secondRequest;
          requestIndex += 1;
          return request.promise;
        },
      });
      return null;
    }

    const view = render(<Harness visibleThreadKeys={["alpha", "beta", "gamma"]} />);

    await act(async () => {
      latest.controller.handleDragEnd(makeDragEndEvent({
        activeThreadKey: "gamma",
        overThreadKey: "alpha",
      }), 4);
      await Promise.resolve();
    });
    view.rerender(<Harness visibleThreadKeys={["gamma", "alpha", "beta"]} />);
    await act(async () => {
      latest.controller.handleDragEnd(makeDragEndEvent({
        activeThreadKey: "beta",
        overThreadKey: "gamma",
        activeRect: { top: 60, bottom: 90 },
        overRect: { top: 0, bottom: 30 },
      }), 4);
      await Promise.resolve();
    });

    expect(JSON.stringify(latest.displayedVisibleThreadKeys)).toBe(JSON.stringify([
      "beta",
      "gamma",
      "alpha",
    ]));

    await act(async () => {
      firstRequest.resolve();
      await firstRequest.promise;
      await Promise.resolve();
    });

    expect(JSON.stringify(latest.displayedVisibleThreadKeys)).toBe(JSON.stringify([
      "beta",
      "gamma",
      "alpha",
    ]));

    await act(async () => {
      secondRequest.resolve();
      await secondRequest.promise;
      await Promise.resolve();
    });
  });

  test("reports a failed reorder and rolls back its optimistic order", async () => {
    const failure = new Error("persistence failed");
    const errors: unknown[] = [];
    let latest!: ReturnType<typeof useSidebarThreadReorderController>;

    function Harness() {
      latest = useSidebarThreadReorderController({
        visibleThreadKeys: ["alpha", "beta", "gamma"],
        onVisibleThreadOrderChange() {
          return Promise.reject(failure);
        },
      });
      return null;
    }

    render(
      <SidebarReorderDndProvider onThreadError={(error) => errors.push(error)}>
        <Harness />
      </SidebarReorderDndProvider>,
    );

    await act(async () => {
      latest.controller.handleDragEnd(makeDragEndEvent({
        activeThreadKey: "gamma",
        overThreadKey: "alpha",
      }), 4);
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(errors).toEqual([failure]);
    expect(latest.displayedVisibleThreadKeys).toEqual(["alpha", "beta", "gamma"]);
  });
});

describe("sidebar thread sortable wrapper", () => {
  test("makes the complete row the pointer and keyboard drag activator", () => {
    const controller: SidebarThreadReorderController = {
      handleDragEnd() {},
    };
    const view = render(
      <SidebarReorderDndProvider>
        <SidebarThreadSortableContext threadKeys={["local:alpha"]}>
          <div role="list">
            <SidebarThreadSortableItem
              threadKey="local:alpha"
              controller={controller}
            >
              <span>Alpha task</span>
            </SidebarThreadSortableItem>
          </div>
        </SidebarThreadSortableContext>
      </SidebarReorderDndProvider>,
    );

    const row = view.getByRole("listitem");
    const activator = row.firstElementChild;
    expect(activator?.getAttribute("role")).toBe("button");
    expect(activator?.getAttribute("tabindex")).toBe("0");
    expect(activator?.textContent).toBe("Alpha task");
  });

  test("keeps a visible pending project row outside the sortable child set", () => {
    const view = render(
      <SidebarReorderDndProvider>
        <div role="list">
          <SidebarThreadReorderRows
            visibleThreadKeys={["thread:alpha", "pending:worktree", "thread:beta"]}
            sortableThreadKeys={["thread:alpha", "thread:beta"]}
            onVisibleThreadOrderChange={async () => {}}
            renderThread={(threadKey) => (
              <span data-testid={threadKey}>{threadKey}</span>
            )}
          />
        </div>
      </SidebarReorderDndProvider>,
    );

    expect(view.getByTestId("thread:alpha").closest("[role='button']") !== null).toBe(true);
    expect(view.getByTestId("thread:beta").closest("[role='button']") !== null).toBe(true);
    expect(view.getByTestId("pending:worktree").closest("[role='button']")).toBe(null);
  });
});
