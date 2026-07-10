import { describe, expect, test } from "bun:test";
import { Hono } from "hono";
import {
  DOCUMENT_HTTP_CONTENT_TYPE,
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
  DocumentSyncCommandResult,
  DocumentSyncRequest,
  DocumentSyncResponse,
} from "../shared/block-documents/document-sync";
import { DocumentSyncHub } from "./document-sync-hub";
import { registerDocumentSyncHttpRoutes } from "./document-sync-http";

const success = <T>(value: T): DocumentSyncCommandResult<T> => ({
  ok: true,
  value,
});

const createApp = (options?: { readonly duplicate?: boolean }) => {
  const syncCalls: DocumentSyncRequest[] = [];
  const applyCalls: DocumentSyncApplyRequest[] = [];
  const hub = new DocumentSyncHub({
    sync: async (request): Promise<DocumentSyncCommandResult<DocumentSyncResponse>> => {
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
  });
  const app = new Hono();
  registerDocumentSyncHttpRoutes(app, {
    hub,
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
  return { app, syncCalls, applyCalls };
};

const binaryRequest = (body: Uint8Array, signal?: AbortSignal): RequestInit => ({
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
  const dataLine = frame
    .split("\n")
    .find((line) => line.startsWith("data: "));
  if (!dataLine) throw new Error(`SSE frame has no data: ${frame}`);
  return dataLine.slice("data: ".length);
};

describe("Document sync HTTP routes", () => {
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
    const updateEvent = decodeDocumentRealtimeSseEvent(await readSseData(reader));
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
});
