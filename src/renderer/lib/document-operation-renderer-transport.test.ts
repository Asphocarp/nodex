import { describe, expect, test } from "bun:test";
import type {
  DocumentMutationRequest,
  DocumentOperationCommandResult,
} from "../../shared/block-documents/document-operations";
import { browserRendererTransport } from "./browser-renderer-transport";
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
    changeLogSeq: 5,
    committedAt: "2026-07-11T00:00:00.000Z",
    duplicate: false,
  },
};

describe("Document operation renderer transports", () => {
  test("browser posts the scoped JSON contract and parses the receipt", async () => {
    const originalFetch = globalThis.fetch;
    let capturedUrl = "";
    let capturedMutationId = "";
    globalThis.fetch = (async (input, init) => {
      capturedUrl = String(input);
      capturedMutationId = (
        JSON.parse(String(init?.body)) as { readonly mutationId: string }
      ).mutationId;
      return new Response(JSON.stringify(result), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }) as typeof fetch;

    try {
      const response = await browserRendererTransport.mutateDocument(
        "project-1",
        "document-1",
        request,
      );
      expect(response.ok).toBeTrue();
      expect(capturedMutationId).toBe(request.mutationId);
      expect(
        capturedUrl.endsWith(
          "/api/projects/project-1/documents/document-1/mutations",
        ),
      ).toBeTrue();
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

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

    expect(response.ok).toBeTrue();
    expect(capturedChannel).toBe("block-documents:mutate");
    expect(capturedDocumentId).toBe("document-1");
  });
});
