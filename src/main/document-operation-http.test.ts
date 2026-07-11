import { describe, expect, test } from "vitest";
import { Hono } from "hono";
import type {
  DocumentMutationRequest,
  DocumentOperationCommandResult,
} from "../shared/block-documents/document-operations";
import { registerDocumentMutationHttpRoute } from "./document-operation-http";

const request: DocumentMutationRequest = {
  version: 1,
  mutationId: "mutation-http-1",
  projectId: "project-1",
  storeEpoch: "epoch-1",
  actor: { kind: "spoofed" },
  clientSessionId: "spoofed",
  documentId: "document-1",
  generation: 1,
  expectedHeadSeq: 5,
  operations: [{ kind: "set_title", title: "HTTP" }],
};

const committed = (
  bound: DocumentMutationRequest,
): DocumentOperationCommandResult => ({
  ok: true,
  value: {
    version: 1,
    mutationKind: "document_operation_batch",
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
    changeLogSeq: 11,
    committedAt: "2026-07-11T00:00:00.000Z",
    duplicate: false,
  },
});

const createApp = (
  apply: (
    input: DocumentMutationRequest,
  ) => Promise<DocumentOperationCommandResult>,
) => {
  const app = new Hono();
  registerDocumentMutationHttpRoute(app, { applyMutation: apply });
  return app;
};

const post = async (
  app: Hono,
  projectId: string,
  documentId: string,
  body: unknown,
): Promise<Response> =>
  await app.request(
    `/api/projects/${projectId}/documents/${documentId}/mutations`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    },
  );

describe("Document mutation HTTP", () => {
  test("binds loopback audit identity and returns the typed result", async () => {
    const captured: DocumentMutationRequest[] = [];
    const app = createApp(async (bound) => {
      captured.push(bound);
      return committed(bound);
    });
    const response = await post(app, "project-1", "document-1", request);
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(captured.length).toBe(1);
    expect(captured[0]?.clientSessionId).toBe("http-loopback");
    expect(captured[0]?.actor.kind).toBe("http_loopback");
    const body = (await response.json()) as DocumentOperationCommandResult;
    expect(body.ok).toBe(true);
  });

  test("rejects path mismatch before invoking authority", async () => {
    let calls = 0;
    const app = createApp(async (bound) => {
      calls += 1;
      return committed(bound);
    });
    const response = await post(app, "project-1", "document-2", request);
    expect(response.status).toBe(400);
    expect(calls).toBe(0);
    const body = (await response.json()) as DocumentOperationCommandResult;
    expect(body.ok).toBe(false);
  });

  test("preserves conflict and unavailable status classes", async () => {
    const conflict = createApp(async () => ({
      ok: false,
      error: {
        code: "document_head_conflict",
        message: "stale",
        retryable: true,
        mutationId: "mutation-http-1",
        expectedHeadSeq: 5,
        actualHeadSeq: 6,
      },
    }));
    expect(
      (await post(conflict, "project-1", "document-1", request)).status,
    ).toBe(409);

    const unavailable = createApp(async () => {
      throw new Error("writer offline");
    });
    const response = await post(
      unavailable,
      "project-1",
      "document-1",
      request,
    );
    expect(response.status).toBe(503);
    const body = (await response.json()) as DocumentOperationCommandResult;
    expect(body.ok).toBe(false);
    if (!body.ok) expect(body.error.retryable).toBe(true);
  });
});
