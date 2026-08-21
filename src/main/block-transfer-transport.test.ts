import { describe, expect, test } from "vite-plus/test";
import type {
  BlockTransferCommandResult,
  BlockTransferIntent,
  BlockTransferUndoCommandResult,
  BlockTransferUndoIntent,
} from "../shared/block-transfer";
import type {
  PublicBlockTransferIntent,
  PublicBlockTransferUndoIntent,
} from "../shared/block-transfer-transport";
import {
  BLOCK_TRANSFER_IPC_CHANNEL,
  BLOCK_TRANSFER_UNDO_IPC_CHANNEL,
  registerBlockTransferIpcHandler,
  registerBlockTransferUndoIpcHandler,
  type BlockTransferIpcHandler,
  type BlockTransferUndoIpcHandler,
} from "./block-transfer-ipc";

const intent: PublicBlockTransferIntent = {
  operationId: "transfer-public-1",
  projectId: "project-a",
  storeEpoch: "epoch-a",
  mode: "move",
  rootBlockIds: ["card-a"],
  causalDependencies: [],
  source: { kind: "data_source", dataSourceId: "source-a" },
  target: { kind: "document", documentId: "document-host" },
  promotionPolicy: "literal",
};

const committed = (bound: BlockTransferIntent): BlockTransferCommandResult => ({
  ok: true,
  localCommit: {
    status: "no_op",
    observed: { store_epoch: bound.storeEpoch, commit_head: 9 },
  },
  value: {
    operationId: bound.operationId,
    projectId: bound.projectId,
    storeEpoch: bound.storeEpoch,
    mode: bound.mode,
    duplicate: false,
    sourceRootBlockIds: ["card-a"],
    resultRootBlockIds: ["card-a"],
    copiedBlockIds: {},
    transformationEvidence: [],
    finalLocations: {
      "card-a": { kind: "document", documentId: "document-host" },
    },
    finalLocationRevisions: { "card-a": 2 },
    documentCommits: [
      {
        documentId: "document-host",
        generation: 1,
        baseHeadSeq: 1,
        headSeq: 2,
        updateId: "update-a",
        update: new Uint8Array([1, 2, 3]),
        stateVector: new Uint8Array([4, 5]),
      },
    ],
    affectedDatabaseBlockIds: ["database-a"],
    commitSeq: 9,
    committedAt: "2026-07-13T00:00:00.000Z",
    undoToken: null,
  },
});

const undoIntent: PublicBlockTransferUndoIntent = {
  operationId: "undo-transfer-public-1",
  projectId: "project-a",
  storeEpoch: "epoch-a",
  token: {
    transferOperationId: "transfer-public-1",
    recipeHash: "a".repeat(64),
    storeEpoch: "epoch-a",
  },
};

const undone = (bound: BlockTransferUndoIntent): BlockTransferUndoCommandResult => ({
  ok: true,
  localCommit: {
    status: "no_op",
    observed: { store_epoch: bound.storeEpoch, commit_head: 10 },
  },
  value: {
    operationId: bound.operationId,
    projectId: bound.projectId,
    storeEpoch: bound.storeEpoch,
    transferOperationId: bound.token.transferOperationId,
    duplicate: false,
    restoredSourceRootIds: ["card-a"],
    removedPageIds: ["card-a"],
    documentCommits: [],
    commitSeq: 10,
    committedAt: "2026-07-13T00:00:01.000Z",
  },
});

describe("Block transfer IPC", () => {
  test("Electron binds trusted main-frame audit identity", async () => {
    let handler: BlockTransferIpcHandler = async () => {
      throw new Error("handler missing");
    };
    const captured: BlockTransferIntent[] = [];
    registerBlockTransferIpcHandler({
      registerHandle: (channel, listener) => {
        expect(channel).toBe(BLOCK_TRANSFER_IPC_CHANNEL);
        handler = listener;
      },
      resolveTrustedIdentity: () => ({
        clientSessionId: "electron-window-1",
        actor: { kind: "electron_renderer", clientId: "renderer-1" },
      }),
      transfer: async (bound) => {
        captured.push(bound);
        return committed(bound);
      },
    });
    const result = await handler({}, "project-a", intent);
    expect(result.ok).toBe(true);
    expect(captured[0]?.clientSessionId).toBe("electron-window-1");
    expect(captured[0]?.actor.kind).toBe("electron_renderer");
  });

  test("rejects route mismatch and caller-supplied audit fields", async () => {
    let handler: BlockTransferIpcHandler = async () => {
      throw new Error("handler missing");
    };
    let calls = 0;
    registerBlockTransferIpcHandler({
      registerHandle: (_channel, listener) => {
        handler = listener;
      },
      resolveTrustedIdentity: () => ({
        clientSessionId: "trusted",
        actor: { kind: "electron_renderer" },
      }),
      transfer: async (bound) => {
        calls += 1;
        return committed(bound);
      },
    });
    expect((await handler({}, "project-other", intent)).ok).toBe(false);
    expect(
      (
        await handler({}, "project-a", {
          ...intent,
          actor: { kind: "spoofed" },
        } as unknown as PublicBlockTransferIntent)
      ).ok,
    ).toBe(false);
    expect(calls).toBe(0);
  });

  test("binds a scoped opaque Undo token without renderer audit fields", async () => {
    let handler: BlockTransferUndoIpcHandler = async () => {
      throw new Error("handler missing");
    };
    const captured: BlockTransferUndoIntent[] = [];
    registerBlockTransferUndoIpcHandler({
      registerHandle: (channel, listener) => {
        expect(channel).toBe(BLOCK_TRANSFER_UNDO_IPC_CHANNEL);
        handler = listener;
      },
      resolveTrustedIdentity: () => ({ clientSessionId: "trusted" }),
      undo: async (bound) => {
        captured.push(bound);
        return undone(bound);
      },
    });

    expect((await handler({}, "project-a", undoIntent)).ok).toBe(true);
    expect(captured).toEqual([undoIntent]);
    expect((await handler({}, "project-other", undoIntent)).ok).toBe(false);
    expect(captured).toHaveLength(1);
  });
});
