import { describe, expect, test } from "bun:test";
import { Hono } from "hono";
import {
  DOCUMENT_HTTP_CONTENT_TYPE,
  decodeDocumentHttpError,
  decodeOwnedBlockDocumentDescriptorHttp,
  decodeDocumentApplyHttpAck,
  decodeDocumentRealtimeSseEvent,
  decodeDocumentSyncHttpResponse,
  encodeDocumentApplyHttpRequest,
  encodeDocumentAwarenessHttpRequest,
  encodeDocumentSyncHttpRequest,
} from "../shared/block-documents/http-contract";
import type {
  DocumentSyncApplyAck,
  DocumentSyncApplyRequest,
  DocumentSyncCommandError,
  DocumentSyncCommandResult,
  DocumentSyncRequest,
  DocumentSyncResponse,
} from "../shared/block-documents/document-sync";
import type {
  RelocationIntent,
  RelocationResult,
} from "../shared/block-documents/contracts";
import {
  decodeRelocationHttpError,
  decodeRelocationHttpResult,
  encodeRelocationHttpRequest,
  RELOCATION_HTTP_CONTENT_TYPE,
} from "../shared/block-documents/relocation-transport";
import { DocumentSyncHub } from "./document-sync-hub";
import { registerDocumentSyncHttpRoutes } from "./document-sync-http";

const success = <T>(value: T): DocumentSyncCommandResult<T> => ({
  ok: true,
  value,
});

const createApp = (options?: {
  readonly duplicate?: boolean;
  readonly prepareError?: DocumentSyncCommandError;
}) => {
  const syncCalls: DocumentSyncRequest[] = [];
  const applyCalls: DocumentSyncApplyRequest[] = [];
  const hub = new DocumentSyncHub({
    sync: async (
      request,
    ): Promise<DocumentSyncCommandResult<DocumentSyncResponse>> => {
      syncCalls.push(request);
      return success({
        documentId: request.documentId,
        storeEpoch: "store-1",
        generation: 1,
        headSeq: 0,
        stateVector: new Uint8Array([1]),
        update: new Uint8Array([2]),
      });
    },
    applyUpdate: async (
      request,
    ): Promise<DocumentSyncCommandResult<DocumentSyncApplyAck>> => {
      applyCalls.push(request);
      return success({
        documentId: request.documentId,
        storeEpoch: request.storeEpoch,
        generation: request.generation,
        updateId: request.updateId,
        committedSeq: 1,
        headSeq: 1,
        stateVector: new Uint8Array([3]),
        duplicate: options?.duplicate === true,
      });
    },
    lookupCommittedRelocation: async () => ({ ok: true, value: null }),
    prepareRelocationCommand: async () => {
      throw new Error("Relocation is not configured in HTTP sync tests");
    },
    relocateBlocks: async () => {
      throw new Error("Relocation is not configured in HTTP sync tests");
    },
  });
  const app = new Hono();
  registerDocumentSyncHttpRoutes(app, {
    hub,
    getOwnedBlockDocumentDescriptor: async (projectId, ownerBlockId) => ({
      projectId,
      ownerBlockId,
      ownerType: "card",
      ownerLifecycle: "active",
      documentId: "document-1",
      storeEpoch: "store-1",
      generation: 1,
      headSeq: 0,
      schemaKey: "nodex.card",
      schemaVersion: 1,
      readiness: "ready",
      authority: "ydoc_primary",
      stateVector: new Uint8Array([1]),
    }),
    prepareOwnedBlockDocument: async (projectId, ownerBlockId) =>
      options?.prepareError
        ? { ok: false, error: options.prepareError }
        : success({
            projectId,
            ownerBlockId,
            ownerType: "card",
            ownerLifecycle: "active",
            documentId: "document-1",
            storeEpoch: "store-1",
            generation: 1,
            headSeq: 0,
            schemaKey: "nodex.card",
            schemaVersion: 1,
            readiness: "ready",
            authority: "ydoc_primary",
            stateVector: new Uint8Array([2]),
          }),
    getDocumentProjectId: async (documentId) =>
      documentId === "document-1"
        ? success("project-1")
        : {
            ok: false,
            error: {
              code: "document_not_found",
              message: "missing",
              retryable: false,
              resetRequired: false,
            },
          },
  });
  return { app, hub, syncCalls, applyCalls };
};

const binaryRequest = (
  body: Uint8Array,
  signal?: AbortSignal,
): RequestInit => ({
  method: "POST",
  headers: { "Content-Type": DOCUMENT_HTTP_CONTENT_TYPE },
  body: body.slice().buffer,
  ...(signal ? { signal } : {}),
});

const readSseData = async (
  reader: ReadableStreamDefaultReader<Uint8Array>,
): Promise<string> => {
  const decoder = new TextDecoder();
  let buffered = "";
  while (!buffered.includes("\n\n")) {
    const next = await reader.read();
    if (next.done) throw new Error("SSE stream ended before an event");
    buffered += decoder.decode(next.value, { stream: true });
  }
  const frame = buffered.slice(0, buffered.indexOf("\n\n"));
  const dataLine = frame.split("\n").find((line) => line.startsWith("data: "));
  if (!dataLine) throw new Error(`SSE frame has no data: ${frame}`);
  return dataLine.slice("data: ".length);
};

describe("Document sync HTTP routes", () => {
  test("returns a strictly project-scoped owned Document descriptor", async () => {
    const { app } = createApp();
    const response = await app.request(
      "/api/projects/project-1/blocks/card-1/document",
    );
    expect(response.status).toBe(200);
    const descriptor = decodeOwnedBlockDocumentDescriptorHttp(
      await response.text(),
    );
    expect(descriptor.projectId).toBe("project-1");
    expect(descriptor.ownerBlockId).toBe("card-1");
    expect(descriptor.authority).toBe("ydoc_primary");
    expect(Array.from(descriptor.stateVector).join(",")).toBe("1");
  });

  test("prepares an eligible owned Document through the writer boundary", async () => {
    const { app } = createApp();
    const response = await app.request(
      "/api/projects/project-1/blocks/card-1/document/prepare",
      { method: "POST" },
    );
    expect(response.status).toBe(200);
    const descriptor = decodeOwnedBlockDocumentDescriptorHttp(
      await response.text(),
    );
    expect(descriptor.authority).toBe("ydoc_primary");
    expect(Array.from(descriptor.stateVector).join(",")).toBe("2");
  });

  test("preserves typed preparation errors on the HTTP transport", async () => {
    const { app } = createApp({
      prepareError: {
        code: "document_not_ready",
        message: "legacy projections still need migration",
        retryable: true,
        resetRequired: false,
      },
    });
    const response = await app.request(
      "/api/projects/project-1/blocks/card-1/document/prepare",
      { method: "POST" },
    );
    expect(response.status).toBe(409);
    const error = decodeDocumentHttpError(await response.text());
    expect(error.code).toBe("document_not_ready");
    expect(error.message).toBe("legacy projections still need migration");
    expect(error.retryable).toBeTrue();
  });

  test("requires project-scoped SSE before binary sync and durable fanout", async () => {
    const { app, syncCalls, applyCalls } = createApp();
    const eventResponse = await app.request(
      "/api/projects/project-1/documents/document-1/events?clientSessionId=client-1",
    );
    expect(eventResponse.status).toBe(200);
    const reader = eventResponse.body?.getReader();
    if (!reader) throw new Error("Missing SSE response body");
    const connected = decodeDocumentRealtimeSseEvent(await readSseData(reader));
    expect(connected.kind).toBe("connection");

    const syncResponse = await app.request(
      "/api/projects/project-1/documents/document-1/sync",
      binaryRequest(
        encodeDocumentSyncHttpRequest({
          documentId: "document-1",
          clientSessionId: "client-1",
          stateVector: new Uint8Array([0]),
        }),
      ),
    );
    expect(syncResponse.status).toBe(200);
    const sync = decodeDocumentSyncHttpResponse(
      new Uint8Array(await syncResponse.arrayBuffer()),
    );
    expect(sync.documentId).toBe("document-1");
    expect(syncCalls.length).toBe(1);

    const applyResponse = await app.request(
      "/api/projects/project-1/documents/document-1/updates",
      binaryRequest(
        encodeDocumentApplyHttpRequest({
          documentId: "document-1",
          storeEpoch: "store-1",
          generation: 1,
          updateId: "update-1",
          clientSessionId: "client-1",
          baseHeadSeq: 0,
          touchedBlockIds: ["block-1"],
          update: new Uint8Array([4, 5]),
        }),
      ),
    );
    expect(applyResponse.status).toBe(200);
    const ack = decodeDocumentApplyHttpAck(
      new Uint8Array(await applyResponse.arrayBuffer()),
    );
    expect(ack.committedSeq).toBe(1);
    expect(applyCalls.length).toBe(1);
    const updateEvent = decodeDocumentRealtimeSseEvent(
      await readSseData(reader),
    );
    expect(updateEvent.kind).toBe("document-update");
    if (updateEvent.kind === "document-update") {
      expect(Array.from(updateEvent.update).join(",")).toBe("4,5");
    }

    await reader.cancel();
  });

  test("hides cross-Project Documents and rejects commands without a live stream", async () => {
    const { app } = createApp();
    const crossProject = await app.request(
      "/api/projects/project-2/documents/document-1/events?clientSessionId=client-1",
    );
    expect(crossProject.status).toBe(404);

    const withoutStream = await app.request(
      "/api/projects/project-1/documents/document-1/sync",
      binaryRequest(
        encodeDocumentSyncHttpRequest({
          documentId: "document-1",
          clientSessionId: "client-1",
          stateVector: new Uint8Array([0]),
        }),
      ),
    );
    expect(withoutStream.status).toBe(404);
  });

  test("keeps Awareness ephemeral and suppresses duplicate durable fanout", async () => {
    const { app } = createApp({ duplicate: true });
    const eventResponse = await app.request(
      "/api/projects/project-1/documents/document-1/events?clientSessionId=client-1",
    );
    const reader = eventResponse.body?.getReader();
    if (!reader) throw new Error("Missing SSE response body");
    await readSseData(reader);

    const syncResponse = await app.request(
      "/api/projects/project-1/documents/document-1/sync",
      binaryRequest(
        encodeDocumentSyncHttpRequest({
          documentId: "document-1",
          clientSessionId: "client-1",
          stateVector: new Uint8Array([0]),
        }),
      ),
    );
    expect(syncResponse.status).toBe(200);

    const awarenessResponse = await app.request(
      "/api/projects/project-1/documents/document-1/awareness",
      binaryRequest(
        encodeDocumentAwarenessHttpRequest({
          documentId: "document-1",
          clientSessionId: "client-1",
          storeEpoch: "store-1",
          generation: 1,
          update: new Uint8Array(),
        }),
      ),
    );
    // An empty Yjs Awareness update is malformed and is rejected without persistence.
    expect(awarenessResponse.status).toBe(400);

    const applyResponse = await app.request(
      "/api/projects/project-1/documents/document-1/updates",
      binaryRequest(
        encodeDocumentApplyHttpRequest({
          documentId: "document-1",
          storeEpoch: "store-1",
          generation: 1,
          updateId: "update-duplicate",
          clientSessionId: "client-1",
          baseHeadSeq: 0,
          touchedBlockIds: [],
          update: new Uint8Array([1]),
        }),
      ),
    );
    expect(applyResponse.status).toBe(200);

    const pendingRead = reader.read();
    const outcome = await Promise.race([
      pendingRead.then(() => "event"),
      new Promise<string>((resolve) => setTimeout(() => resolve("quiet"), 20)),
    ]);
    expect(outcome).toBe("quiet");
    await reader.cancel();
  });

  test("strictly scopes relocation lease responses to route and live browser session", async () => {
    const { app, hub } = createApp();
    const eventResponse = await app.request(
      "/api/projects/project-1/documents/document-1/events?clientSessionId=client-1",
    );
    const reader = eventResponse.body?.getReader();
    if (!reader) throw new Error("Missing SSE response body");
    await readSseData(reader);
    await app.request(
      "/api/projects/project-1/documents/document-1/sync",
      binaryRequest(
        encodeDocumentSyncHttpRequest({
          documentId: "document-1",
          clientSessionId: "client-1",
          stateVector: new Uint8Array([0]),
        }),
      ),
    );

    let capturedLeaseId = "";
    hub.respondToRelocationLease = (_target, request) => {
      capturedLeaseId = request.leaseId;
      return success({
        accepted: true,
        leaseId: request.leaseId,
        documentId: request.documentId,
        status: request.response === "ack" ? "frozen" : "cancelled",
      });
    };
    const body = {
      response: "ack",
      leaseId: "lease-1",
      documentId: "document-1",
      clientSessionId: "client-1",
      storeEpoch: "store-1",
      generation: 1,
      headSeq: 0,
    } as const;
    const accepted = await app.request(
      "/api/projects/project-1/documents/document-1/relocation-leases/lease-1/responses",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      },
    );
    expect(accepted.status).toBe(200);
    expect(capturedLeaseId).toBe("lease-1");

    const wrongRoute = await app.request(
      "/api/projects/project-1/documents/document-1/relocation-leases/lease-other/responses",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      },
    );
    expect(wrongRoute.status).toBe(400);
    const unknownField = await app.request(
      "/api/projects/project-1/documents/document-1/relocation-leases/lease-1/responses",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...body, unexpected: true }),
      },
    );
    expect(unknownField.status).toBe(400);

    await reader.cancel();
    const afterStreamClosed = await app.request(
      "/api/projects/project-1/documents/document-1/relocation-leases/lease-1/responses",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      },
    );
    expect(afterStreamClosed.status).toBe(404);
  });

  test("relocates through the caller's live source session and returns binary commits", async () => {
    const { app, hub } = createApp();
    const eventResponse = await app.request(
      "/api/projects/project-1/documents/document-1/events?clientSessionId=client-1",
    );
    const reader = eventResponse.body?.getReader();
    if (!reader) throw new Error("Missing SSE response body");
    await readSseData(reader);

    const intent: RelocationIntent = {
      relocationId: "move-http-1",
      projectId: "project-1",
      storeEpoch: "store-1",
      rootBlockIds: ["block-1"],
      sourceDocumentId: "document-1",
      sourceGeneration: 1,
      target: {
        kind: "document",
        documentId: "document-2",
        generation: 1,
      },
    };
    const relocationResult: RelocationResult = {
      relocationId: intent.relocationId,
      projectId: intent.projectId,
      storeEpoch: intent.storeEpoch,
      duplicate: false,
      rootBlockIds: ["block-1"],
      movedBlockIds: ["block-1"],
      finalLocations: {
        "block-1": { kind: "document", documentId: "document-2" },
      },
      finalLocationRevisions: { "block-1": 2 },
      sourceCommit: {
        documentId: "document-1",
        generation: 1,
        baseHeadSeq: 0,
        headSeq: 1,
        updateId: "relocation:source",
        update: new Uint8Array([1]),
        stateVector: new Uint8Array([2]),
      },
      targetCommit: {
        documentId: "document-2",
        generation: 1,
        baseHeadSeq: 3,
        headSeq: 4,
        updateId: "relocation:target",
        update: new Uint8Array([3]),
        stateVector: new Uint8Array([4]),
      },
      changeLogSeq: 5,
      committedAt: "2026-07-11T00:00:00.000Z",
    };
    let capturedClientSessionId = "";
    hub.relocate = async (_target, receivedIntent, clientSessionId) => {
      capturedClientSessionId = clientSessionId ?? "";
      expect(receivedIntent.relocationId).toBe(intent.relocationId);
      return { ok: true, value: relocationResult };
    };

    const response = await app.request(
      "/api/projects/project-1/documents/document-1/relocations",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: RELOCATION_HTTP_CONTENT_TYPE,
        },
        body: encodeRelocationHttpRequest("client-1", intent),
      },
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe(
      RELOCATION_HTTP_CONTENT_TYPE,
    );
    expect(capturedClientSessionId).toBe("client-1");
    const decoded = decodeRelocationHttpResult(
      new Uint8Array(await response.arrayBuffer()),
      intent,
    );
    expect(decoded.sourceCommit.update?.join(",")).toBe("1");
    expect(decoded.targetCommit?.stateVector.join(",")).toBe("4");

    const unauthorized = await app.request(
      "/api/projects/project-1/documents/document-1/relocations",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: encodeRelocationHttpRequest("client-other", intent),
      },
    );
    expect(unauthorized.status).toBe(400);
    expect(decodeRelocationHttpError(await unauthorized.text()).code).toBe(
      "invalid_relocation_request",
    );

    await reader.cancel();
  });
});
