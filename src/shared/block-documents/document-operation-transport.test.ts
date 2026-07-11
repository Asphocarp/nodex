import { describe, expect, test } from "vitest";
import {
  bindTrustedDocumentMutation,
  documentMutationHttpStatus,
} from "./document-operation-transport";
import { DOCUMENT_OPERATION_CONTRACT_VERSION } from "./document-operations";

const request = () => ({
  version: DOCUMENT_OPERATION_CONTRACT_VERSION,
  mutationId: "mutation-1",
  projectId: "project-1",
  storeEpoch: "epoch-1",
  clientSessionId: "spoofed-session",
  actor: { kind: "spoofed" },
  documentId: "document-1",
  generation: 1,
  expectedHeadSeq: 4,
  operations: [{ kind: "set_title" as const, title: "Current" }],
});

describe("Document operation transport", () => {
  test("binds host identity without changing logical scope", () => {
    const bound = bindTrustedDocumentMutation(
      request(),
      "project-1",
      "document-1",
      {
        actor: { kind: "electron_renderer", clientId: "renderer-7" },
        clientSessionId: "renderer-7",
      },
    );
    expect(bound.ok).toBe(true);
    if (!bound.ok) return;
    expect(bound.value.clientSessionId).toBe("renderer-7");
    expect(JSON.stringify(bound.value.actor)).toBe(
      JSON.stringify({ kind: "electron_renderer", clientId: "renderer-7" }),
    );
    expect(bound.value.projectId).toBe("project-1");
    expect(bound.value.documentId).toBe("document-1");
  });

  test("rejects route scope mismatch and preserves a valid mutation hint", () => {
    const wrongProject = bindTrustedDocumentMutation(
      request(),
      "project-2",
      "document-1",
      { actor: { kind: "http_loopback" } },
    );
    expect(wrongProject.ok).toBe(false);
    if (!wrongProject.ok) {
      expect(wrongProject.error.code).toBe(
        "invalid_document_operation_request",
      );
      expect(wrongProject.error.mutationId).toBe("mutation-1");
    }

    const malformed = bindTrustedDocumentMutation(
      { ...request(), operations: [{ kind: "unknown" }] },
      "project-1",
      "document-1",
      { actor: { kind: "http_loopback" } },
    );
    expect(malformed.ok).toBe(false);
    if (!malformed.ok) expect(malformed.error.mutationId).toBe("mutation-1");
  });

  test("maps typed boundary failures to stable HTTP classes", () => {
    expect(
      documentMutationHttpStatus({
        code: "block_not_found",
        message: "missing",
        retryable: false,
      }),
    ).toBe(404);
    expect(
      documentMutationHttpStatus({
        code: "document_head_conflict",
        message: "stale",
        retryable: true,
        expectedHeadSeq: 2,
        actualHeadSeq: 3,
      }),
    ).toBe(409);
    expect(
      documentMutationHttpStatus({
        code: "unknown",
        message: "offline",
        retryable: true,
      }),
    ).toBe(503);
  });
});
