import { describe, expect, test } from "vitest";
import type {
  BlockTransferCommandResult,
  BlockTransferIntent,
} from "../shared/block-transfer";
import type { PublicBlockTransferIntent } from "../shared/block-transfer-transport";
import {
  BLOCK_TRANSFER_IPC_CHANNEL,
  registerBlockTransferIpcHandler,
  type BlockTransferIpcHandler,
} from "./block-transfer-ipc";

const intent: PublicBlockTransferIntent = {
  version: 2,
  operationId: "transfer-public-1",
  projectId: "project-a",
  storeEpoch: "epoch-a",
  mode: "move",
  rootBlockIds: ["card-a"],
  source: { kind: "data_source", dataSourceId: "source-a" },
  target: { kind: "document", documentId: "document-host" },
};

const committed = (bound: BlockTransferIntent): BlockTransferCommandResult => ({
  ok: true,
  value: {
    version: 1,
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
    changeLogSeq: 9,
    committedAt: "2026-07-13T00:00:00.000Z",
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

});
