import { describe, expect, test } from "vitest";
import type {
  DocumentMutationRequest,
  DocumentOperationCommandResult,
} from "../shared/block-documents/document-operations";
import {
  DOCUMENT_MUTATION_IPC_CHANNEL,
  registerDocumentMutationIpcHandler,
  type DocumentMutationIpcHandler,
} from "./document-operation-ipc";

const request: DocumentMutationRequest = {
  version: 1,
  mutationId: "mutation-1",
  projectId: "project-1",
  storeEpoch: "epoch-1",
  clientSessionId: "spoofed",
  actor: { kind: "spoofed" },
  documentId: "document-1",
  generation: 1,
  expectedHeadSeq: 3,
  operations: [
    {
      kind: "set_rich_title",
      richTitle: [
        { type: "text", text: "Current", styles: { italic: true } },
      ],
    },
  ],
};

const committed = (
  bound: DocumentMutationRequest,
): DocumentOperationCommandResult => ({
  ok: true,
  value: {
    version: 1,
    mutationKind:
      "operations" in bound
        ? "document_operation_batch"
        : "nfm" in bound
          ? "replace_document_from_nfm"
          : "document_version_restore",
    mutationId: bound.mutationId,
    projectId: bound.projectId,
    storeEpoch: bound.storeEpoch,
    documentId: bound.documentId,
    generation: bound.generation,
    baseHeadSeq: bound.expectedHeadSeq,
    headSeq: bound.expectedHeadSeq + 1,
    touchedBlockIds: ["card-1"],
    createdBlockIds: [],
    deletedBlockIds: [],
    updatedBlockIds: [],
    movedBlockIds: [],
    writeFenceBlockIds: [],
    titleChanged: true,
    coordination: "merge_friendly",
    commitSeq: 7,
    committedAt: "2026-07-11T00:00:00.000Z",
    duplicate: false,
  },
});

const register = (options: {
  readonly trusted: boolean;
  readonly apply?: (
    input: DocumentMutationRequest,
  ) => Promise<DocumentOperationCommandResult>;
}) => {
  let handler: DocumentMutationIpcHandler | null = null;
  const captured: DocumentMutationRequest[] = [];
  registerDocumentMutationIpcHandler({
    registerHandle: (channel, listener) => {
      expect(channel).toBe(DOCUMENT_MUTATION_IPC_CHANNEL);
      handler = listener;
    },
    resolveTrustedIdentity: () =>
      options.trusted
        ? {
            actor: { kind: "electron_renderer", clientId: "renderer-1" },
            clientSessionId: "renderer-1",
          }
        : null,
    applyMutation: async (bound) => {
      captured.push(bound);
      return options.apply ? await options.apply(bound) : committed(bound);
    },
  });
  return {
    captured,
    invoke: async (projectId: string, documentId: string, input: unknown) => {
      if (!handler) throw new Error("IPC handler was not registered");
      return await handler(
        { sender: "fixture" },
        projectId,
        documentId,
        input as DocumentMutationRequest,
      );
    },
  };
};

describe("Document mutation IPC", () => {
  test("binds host identity before calling the Hub", async () => {
    const harness = register({ trusted: true });
    const result = await harness.invoke("project-1", "document-1", request);
    expect(result.ok).toBe(true);
    expect(harness.captured.length).toBe(1);
    expect(harness.captured[0]?.clientSessionId).toBe("renderer-1");
    expect(harness.captured[0]?.actor.kind).toBe("electron_renderer");
  });

  test("rejects sender and route scope before the Hub", async () => {
    const untrusted = register({ trusted: false });
    const unauthorized = await untrusted.invoke(
      "project-1",
      "document-1",
      request,
    );
    expect(unauthorized.ok).toBe(false);
    expect(untrusted.captured.length).toBe(0);

    const scoped = register({ trusted: true });
    const mismatch = await scoped.invoke(
      "project-1",
      "document-2",
      request,
    );
    expect(mismatch.ok).toBe(false);
    expect(scoped.captured.length).toBe(0);
  });

  test("normalizes thrown backend failures", async () => {
    const harness = register({
      trusted: true,
      apply: async () => {
        throw new Error("worker offline");
      },
    });
    const result = await harness.invoke("project-1", "document-1", request);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("unknown");
    expect(result.error.retryable).toBe(true);
    expect(result.error.mutationId).toBe("mutation-1");
  });
});
