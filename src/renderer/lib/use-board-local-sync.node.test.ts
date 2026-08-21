import { describe, expect, test } from "vite-plus/test";
import {
  publishBoardLocalMutation,
  resetBoardLocalMutationListenersForTest,
  subscribeBoardLocalMutation,
} from "./use-board-local-sync";

describe("board local optimistic mutation sync", () => {
  test("publishes patch mutations to listeners in the same project", () => {
    resetBoardLocalMutationListenersForTest();
    const sourceInstanceId = Symbol("source");
    const received: string[] = [];

    const unsubscribe = subscribeBoardLocalMutation("default", (mutation) => {
      if (mutation.type !== "patch") return;
      received.push(
        `${mutation.columnId}:${mutation.pageId}:${String(mutation.updates.title ?? "")}`,
      );
    });

    publishBoardLocalMutation("default", {
      type: "patch",
      sourceInstanceId,
      columnId: "plan",
      pageId: "abc",
      updates: { title: "Updated from projection" },
    });

    expect(received.length).toBe(1);
    expect(received[0]).toBe("plan:abc:Updated from projection");
    unsubscribe();
  });

  test("does not publish mutations across different projects", () => {
    resetBoardLocalMutationListenersForTest();
    const sourceInstanceId = Symbol("source");
    let callCount = 0;

    const unsubscribe = subscribeBoardLocalMutation("default", () => {
      callCount += 1;
    });

    publishBoardLocalMutation("another-project", {
      type: "patch",
      sourceInstanceId,
      columnId: "plan",
      pageId: "abc",
      updates: { description: "Should not cross project boundary" },
    });

    expect(callCount).toBe(0);
    unsubscribe();
  });

  test("unsubscribe detaches listener", () => {
    resetBoardLocalMutationListenersForTest();
    const sourceInstanceId = Symbol("source");
    let callCount = 0;

    const unsubscribe = subscribeBoardLocalMutation("default", () => {
      callCount += 1;
    });

    unsubscribe();

    publishBoardLocalMutation("default", {
      type: "refresh",
      sourceInstanceId,
    });

    expect(callCount).toBe(0);
  });
});
