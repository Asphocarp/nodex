import { describe, expect, test } from "vitest";
import type {
  DocumentMutationRequest,
  DocumentOperationCommandResult,
} from "../../shared/block-documents/document-operations";
import {
  createElectronRendererTransport,
  type ElectronRendererBridge,
} from "./electron-renderer-transport";

const request: DocumentMutationRequest = {
  version: 1,
  mutationId: "renderer-document-mutation-1",
  projectId: "project-1",
  storeEpoch: "epoch-1",
  actor: { kind: "renderer" },
  clientSessionId: "renderer-1",
  documentId: "document-1",
  generation: 1,
  expectedHeadSeq: 2,
  operations: [{ kind: "set_title", title: "Changed" }],
};

const result: DocumentOperationCommandResult = {
  ok: true,
  value: {
    version: 1,
    mutationKind: "document_operation_batch",
    mutationId: request.mutationId,
    projectId: request.projectId,
    storeEpoch: request.storeEpoch,
    documentId: request.documentId,
    generation: 1,
    baseHeadSeq: 2,
    headSeq: 3,
    touchedBlockIds: ["card-1"],
    createdBlockIds: [],
    deletedBlockIds: [],
    updatedBlockIds: [],
    movedBlockIds: [],
    writeFenceBlockIds: [],
    titleChanged: true,
    coordination: "merge_friendly",
    commitSeq: 5,
    committedAt: "2026-07-11T00:00:00.000Z",
    duplicate: false,
  },
};

describe("Document operation renderer IPC", () => {
  test("Electron invokes the typed main-frame channel", async () => {
    let capturedChannel = "";
    let capturedDocumentId = "";
    const bridge = {
      invoke: async (
        channel: string,
        _projectId: string,
        documentId: string,
      ) => {
        capturedChannel = channel;
        capturedDocumentId = documentId;
        return result;
      },
    } as unknown as ElectronRendererBridge;
    const response = await createElectronRendererTransport(
      bridge,
    ).mutateDocument("project-1", "document-1", request);

    expect(response.ok).toBe(true);
    expect(capturedChannel).toBe("block-documents:mutate");
    expect(capturedDocumentId).toBe("document-1");
  });
});
