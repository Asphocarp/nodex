import { describe, expect, test } from "vitest";
import type {
  AdditionalDocumentCommandResult,
} from "../../shared/additional-document-commands";
import type { PublicAdditionalDocumentCommandRequest } from "../../shared/additional-document-command-transport";
import { noOpLocalCommit } from "../../shared/testing/local-commit";
import {
  createElectronRendererTransport,
  type ElectronRendererBridge,
} from "./electron-renderer-transport";

const request: PublicAdditionalDocumentCommandRequest = {
  version: 2,
  operationId: "renderer-additional-1",
  projectId: "project-1",
  storeEpoch: "epoch-1",
  clientSessionId: "renderer-1",
  actor: { kind: "renderer" },
  coordination: { kind: "fifo_only" },
  operation: {
    kind: "create_synced_source",
    sourceBlockId: "synced-source-1",
    documentId: "document-synced-1",
    initialBlocks: [],
    placement: { kind: "library" },
  },
};

const result: AdditionalDocumentCommandResult = {
  ok: true,
  localCommit: noOpLocalCommit(request.storeEpoch),
  value: {
    version: 2,
    operationId: request.operationId,
    projectId: request.projectId,
    storeEpoch: request.storeEpoch,
    operationKind: request.operation.kind,
    semanticHash: "b".repeat(64),
    duplicate: false,
    effect: {
      createdBlockIds: ["synced-source-1"],
      preservedBlockIds: [],
      deletedBlockIds: [],
      documentHeads: [
        { documentId: "document-synced-1", generation: 1, headSeq: 1 },
      ],
    },
    commitSeq: 12,
    committedAt: "2026-07-12T00:00:00.000Z",
  },
};

describe("Additional Document command renderer IPC", () => {
  test("Electron invokes the trusted main-frame command channel", async () => {
    let capturedChannel = "";
    let capturedProjectId = "";
    const bridge = {
      invoke: async (channel: string, projectId: string) => {
        capturedChannel = channel;
        capturedProjectId = projectId;
        return result;
      },
    } as unknown as ElectronRendererBridge;

    const response =
      await createElectronRendererTransport(
        bridge,
      ).applyAdditionalDocumentCommand("project-1", request);
    expect(response.ok).toBe(true);
    expect(capturedChannel).toBe("block-documents:command");
    expect(capturedProjectId).toBe("project-1");
  });
});
