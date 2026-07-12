import { describe, expect, test, vi } from "vitest";
import { Hono } from "hono";
import {
  DOCUMENT_HTTP_CONTENT_TYPE,
  decodeDocumentHttpError,
  decodeOwnedDocumentDescriptorHttp,
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
import {
  CANVAS_SCENE_HTTP_CONTENT_TYPE,
  decodeCanvasSceneSyncResultHttp,
  encodeCanvasSceneSyncRequestHttp,
} from "../shared/block-documents/canvas-scene-http-contract";
import { MAX_CANVAS_SCENE_MUTATION_BYTES } from "../shared/block-documents/canvas-scene-sync";
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
    syncCanvasScene: async (request) => ({
      ok: true,
      value: {
        version: 1,
        projectId: request.projectId,
        documentId: request.documentId,
        storeEpoch: "store-1",
        generation: 1,
        headSeq: 0,
        sceneHash: "a".repeat(64),
        scene: {
          kind: "canvas_scene",
          schemaVersion: 1,
          elements: [],
          appState: {},
          files: {},
          cardReferences: [],
          plainText: "",
          preview: "",
        },
      },
    }),
    applyCanvasSceneMutation: async (request) => ({
      ok: false,
      error: {
        code: "unknown",
        message: `unused ${request.mutationId}`,
        retryable: false,
        resetRequired: false,
      },
    }),
    applyDocumentMutation: async () => {
      throw new Error("Document mutation is not configured in sync tests");
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
    getOwnedDocumentDescriptor: async (projectId: string, ownerBlockId: string) => ({
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
      sync: { kind: "yjs", stateVector: new Uint8Array([1]) },
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
            sync: { kind: "yjs", stateVector: new Uint8Array([2]) },
          }),
    getDocumentProjectId: async (documentId) =>
      documentId === "document-1" || documentId === "canvas-1"
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
  test("serves Canvas full sync only behind its project-scoped SSE subscription", async () => {
    const { app } = createApp();
    const abort = new AbortController();
    const eventResponsePromise = app.request(
      "/api/projects/project-1/documents/canvas-1/canvas/events?clientSessionId=canvas-client-1",
      { signal: abort.signal },
    );
    await Promise.resolve();
    const response = await app.request(
      "/api/projects/project-1/documents/canvas-1/canvas/sync",
      {
        method: "POST",
        headers: { "Content-Type": "application/vnd.nodex.canvas-scene.v1+json" },
        body: encodeCanvasSceneSyncRequestHttp({
          version: 1,
          projectId: "project-1",
          documentId: "canvas-1",
          clientSessionId: "canvas-client-1",
        }),
      },
    );
    expect(response.status).toBe(200);
    const result = decodeCanvasSceneSyncResultHttp(await response.text());
    expect(result.ok).toBe(true);
    abort.abort();
    await eventResponsePromise;
  });

  test("rejects Canvas bodies with the wrong media type or an oversized payload", async () => {
    const { app } = createApp();
    const wrongMedia = await app.request(
      "/api/projects/project-1/documents/canvas-1/canvas/sync",
      { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" },
    );
    expect(wrongMedia.status).toBe(400);
    expect(await wrongMedia.text()).toContain("invalid Content-Type");

    const oversized = await app.request(
      "/api/projects/project-1/documents/canvas-1/canvas/mutations",
      {
        method: "POST",
        headers: { "Content-Type": CANVAS_SCENE_HTTP_CONTENT_TYPE },
        body: "x".repeat(MAX_CANVAS_SCENE_MUTATION_BYTES + 1),
      },
    );
    expect(oversized.status).toBe(400);
    expect(await oversized.text()).toContain("too large");
  });

  test("keeps an idle Canvas event stream alive", async () => {
    vi.useFakeTimers();
    try {
      const { app } = createApp();
      const response = await app.request(
        "/api/projects/project-1/documents/canvas-1/canvas/events?clientSessionId=canvas-keepalive",
      );
      const reader = response.body?.getReader();
      if (!reader) throw new Error("Missing Canvas SSE response body");
      const pending = reader.read();
      await vi.advanceTimersByTimeAsync(30_000);
      const frame = await pending;
      expect(new TextDecoder().decode(frame.value)).toContain(": ping");
      await reader.cancel();
    } finally {
      vi.useRealTimers();
    }
  });

  test("returns a strictly project-scoped owned Document descriptor", async () => {
    const { app } = createApp();
    const response = await app.request(
      "/api/projects/project-1/blocks/card-1/document",
    );
    expect(response.status).toBe(200);
    const descriptor = decodeOwnedDocumentDescriptorHttp(
      await response.text(),
    );
    expect(descriptor.projectId).toBe("project-1");
    expect(descriptor.ownerBlockId).toBe("card-1");
    expect(descriptor.sync.kind).toBe("yjs");
    if (descriptor.sync.kind === "yjs") {
      expect(Array.from(descriptor.sync.stateVector).join(",")).toBe("1");
    }
  });

  test("prepares an eligible owned Document through the writer boundary", async () => {
    const { app } = createApp();
    const response = await app.request(
      "/api/projects/project-1/blocks/card-1/document/prepare",
      { method: "POST" },
    );
    expect(response.status).toBe(200);
    const descriptor = decodeOwnedDocumentDescriptorHttp(
      await response.text(),
    );
    expect(descriptor.sync.kind).toBe("yjs");
    if (descriptor.sync.kind === "yjs") {
      expect(Array.from(descriptor.sync.stateVector).join(",")).toBe("2");
    }
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
    expect(error.retryable).toBe(true);
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

});
