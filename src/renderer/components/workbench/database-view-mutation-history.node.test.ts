import { describe, expect, test, vi } from "vite-plus/test";

import type { DatabaseListMoveUndoRecipeV2 } from "../../../shared/database-module-v2";
import type { BlockTransferUndoToken } from "../../../shared/block-transfer";
import {
  createDatabaseViewMutationHistory,
  handleDatabaseViewMutationHistoryKeyDown,
} from "./database-view-mutation-history";

const recipe = (pageId: string): DatabaseListMoveUndoRecipeV2 => ({
  viewId: "view-1" as DatabaseListMoveUndoRecipeV2["viewId"],
  dataSourceId: "source-1" as DatabaseListMoveUndoRecipeV2["dataSourceId"],
  propertyStates: [],
  postParentGuards: [{ pageId, parentPageId: null }],
  postBeforePageId: null,
  postOrderGuard: true,
  restoreRuns: [{ pageIds: [pageId], parentPageId: null, beforePageId: null }],
});
const token = (operationId: string): BlockTransferUndoToken => ({
  transferOperationId: operationId,
  recipeHash: "a".repeat(64),
  storeEpoch: "epoch-1",
});

describe("Database View mutation history", () => {
  test("keeps a failed semantic Undo and removes it only after success", async () => {
    const history = createDatabaseViewMutationHistory("epoch-1:view-1");
    history.registerListMove(recipe("page-a"));

    await expect(history.undoListMove(async () => false)).resolves.toBe(false);
    expect(history.size()).toBe(1);
    await expect(history.undoListMove(async () => true)).resolves.toBe(true);
    expect(history.size()).toBe(0);
  });

  test("clears recipes when the store epoch or View scope changes", () => {
    const history = createDatabaseViewMutationHistory("epoch-1:view-1");
    history.registerListMove(recipe("page-a"));
    history.setScope("epoch-2:view-1");
    expect(history.size()).toBe(0);
  });

  test("undoes consecutive List moves in reverse gesture order", async () => {
    const history = createDatabaseViewMutationHistory("epoch-1:view-1");
    history.registerListMove(recipe("page-a"));
    history.registerListMove(recipe("page-b"));
    history.registerListMove(recipe("page-c"));
    const undonePageIds: string[] = [];

    for (let index = 0; index < 3; index += 1) {
      await expect(
        history.undoListMove(async (entry) => {
          undonePageIds.push(entry.postParentGuards[0]?.pageId ?? "missing");
          return true;
        }),
      ).resolves.toBe(true);
    }

    expect(undonePageIds).toEqual(["page-c", "page-b", "page-a"]);
    expect(history.size()).toBe(0);
  });

  test("undoes List moves and Block promotions in their real gesture order", async () => {
    const history = createDatabaseViewMutationHistory("epoch-1:view-1");
    history.registerListMove(recipe("page-a"));
    history.registerBlockTransfer(token("promotion-a"));
    history.registerListMove(recipe("page-b"));
    const order: string[] = [];
    const handlers = {
      listMove: async (entry: DatabaseListMoveUndoRecipeV2) => {
        order.push(entry.postParentGuards[0]?.pageId ?? "missing");
        return true;
      },
      blockTransfer: async (entry: BlockTransferUndoToken) => {
        order.push(entry.transferOperationId);
        return true;
      },
    };

    await history.undoLast(handlers);
    await history.undoLast(handlers);
    await history.undoLast(handlers);

    expect(order).toEqual(["page-b", "promotion-a", "page-a"]);
    expect(history.size()).toBe(0);
  });

  test("consumes scoped command-z without exposing a success UI", async () => {
    const history = createDatabaseViewMutationHistory("epoch-1:view-1");
    history.registerListMove(recipe("page-a"));
    const preventDefault = vi.fn();
    const stopPropagation = vi.fn();
    const undo = vi.fn(async () => true);

    expect(
      handleDatabaseViewMutationHistoryKeyDown({
        event: {
          key: "z",
          metaKey: true,
          ctrlKey: false,
          shiftKey: false,
          target: null,
          preventDefault,
          stopPropagation,
        },
        history,
        undoListMove: undo,
      }),
    ).toBe(true);
    await vi.waitFor(() => expect(history.size()).toBe(0));
    expect(preventDefault).toHaveBeenCalledOnce();
    expect(stopPropagation).toHaveBeenCalledOnce();
    expect(undo).toHaveBeenCalledOnce();
  });
});
