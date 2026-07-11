import { describe, expect, test } from "bun:test";
import {
  DOCUMENT_HTTP_CONTENT_TYPE,
  decodeDocumentApplyHttpRequest,
  decodeDocumentAwarenessHttpRequest,
  decodeDocumentSyncHttpRequest,
  encodeDocumentApplyHttpAck,
  encodeDocumentHttpError,
  encodeDocumentRealtimeSseEvent,
  encodeDocumentSyncHttpResponse,
} from "../../shared/block-documents/http-contract";
import type { DocumentSyncRealtimeEvent } from "../../shared/block-documents/document-sync";
import { createHttpDocumentSyncAdapter } from "./http-document-sync-adapter";

class FakeEventSource {
  onopen: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onmessage: ((event: { readonly data: string }) => void) | null = null;
  closed = false;

  constructor(readonly url: string) {}

  open(): void {
    this.onopen?.();
  }

  disconnect(): void {
    this.onerror?.();
  }

  message(event: DocumentSyncRealtimeEvent): void {
    this.onmessage?.({ data: encodeDocumentRealtimeSseEvent(event) });
  }

  close(): void {
    this.closed = true;
  }
}

const binaryResponse = (body: Uint8Array): Response =>
  new Response(body.slice().buffer as ArrayBuffer, {
    headers: { "Content-Type": DOCUMENT_HTTP_CONTENT_TYPE },
  });

describe("createHttpDocumentSyncAdapter", () => {
  test("opens project-scoped SSE before binary sync and apply commands", async () => {
    const eventSources: FakeEventSource[] = [];
    const calls: Array<{ readonly url: string; readonly init: RequestInit }> = [];
    const fetch = async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      calls.push({ url, init: init ?? {} });
      const body = new Uint8Array(await new Response(init?.body).arrayBuffer());
      if (url.endsWith("/sync")) {
        const request = decodeDocumentSyncHttpRequest("document-1", body);
        expect(request.clientSessionId).toBe("client-1");
        return binaryResponse(
          encodeDocumentSyncHttpResponse({
            documentId: request.documentId,
            storeEpoch: "store-1",
            generation: 1,
            headSeq: 0,
            stateVector: new Uint8Array([1]),
            update: new Uint8Array([2]),
          }),
        );
      }
      const request = decodeDocumentApplyHttpRequest("document-1", body);
      expect(request.touchedBlockIds.join(",")).toBe("block-1");
      return binaryResponse(
        encodeDocumentApplyHttpAck({
          documentId: request.documentId,
          storeEpoch: request.storeEpoch,
          generation: request.generation,
          updateId: request.updateId,
          committedSeq: 1,
          headSeq: 1,
          stateVector: new Uint8Array([3]),
          duplicate: false,
        }),
      );
    };
    const adapter = createHttpDocumentSyncAdapter({
      projectId: "project/a",
      fetch: fetch as typeof globalThis.fetch,
      toUrl: (path) => `http://nodex.test${path}`,
      createEventSource: (url) => {
        const source = new FakeEventSource(url);
        eventSources.push(source);
        return source;
      },
    });
    const unsubscribe = adapter.subscribe(
      { documentId: "document-1", clientSessionId: "client-1" },
      () => undefined,
    );
    const syncing = adapter.sync({
      documentId: "document-1",
      clientSessionId: "client-1",
      stateVector: new Uint8Array([0]),
    });
    await Promise.resolve();
    expect(calls.length).toBe(0);
    expect(eventSources[0]?.url.includes("/projects/project%2Fa/")).toBeTrue();

    eventSources[0]?.open();
    const syncResult = await syncing;
    expect(syncResult.ok).toBeTrue();
    const applyResult = await adapter.applyUpdate({
      documentId: "document-1",
      storeEpoch: "store-1",
      generation: 1,
      updateId: "update-1",
      clientSessionId: "client-1",
      baseHeadSeq: 0,
      touchedBlockIds: ["block-1"],
      update: new Uint8Array([4]),
    });
    expect(applyResult.ok).toBeTrue();
    expect(calls.length).toBe(2);
    expect(calls.every((call) => call.init.method === "POST")).toBeTrue();
    expect(
      calls.every(
        (call) =>
          (call.init.headers as Record<string, string>)["Content-Type"] ===
          DOCUMENT_HTTP_CONTENT_TYPE,
      ),
    ).toBeTrue();
    unsubscribe();
    expect(eventSources[0]?.closed).toBeTrue();
  });

  test("decodes SSE updates, reconnect signals, Awareness, and typed errors", async () => {
    let eventSource: FakeEventSource | null = null;
    const fetch = async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      const body = new Uint8Array(await new Response(init?.body).arrayBuffer());
      if (url.endsWith("/awareness")) {
        const request = decodeDocumentAwarenessHttpRequest("document-1", body);
        expect(Array.from(request.update).join(",")).toBe("8,9");
        return Response.json({ accepted: true });
      }
      return new Response(
        encodeDocumentHttpError({
          code: "document_not_ready",
          message: "still migrating",
          retryable: true,
          resetRequired: false,
        }),
        { status: 409, headers: { "Content-Type": "application/json" } },
      );
    };
    const adapter = createHttpDocumentSyncAdapter({
      projectId: "project-1",
      fetch: fetch as typeof globalThis.fetch,
      toUrl: (path) => `http://nodex.test${path}`,
      createEventSource: (url) => {
        eventSource = new FakeEventSource(url);
        return eventSource;
      },
    });
    const events: DocumentSyncRealtimeEvent[] = [];
    adapter.subscribe(
      { documentId: "document-1", clientSessionId: "client-1" },
      (event) => events.push(event),
    );
    const source = eventSource as FakeEventSource | null;
    source?.open();
    source?.message({
      kind: "document-update",
      documentId: "document-1",
      storeEpoch: "store-1",
      generation: 1,
      headSeq: 1,
      updateId: "update-1",
      clientSessionId: "client-2",
      update: new Uint8Array([6, 7]),
    });
    source?.message({
      kind: "store-reset",
      documentId: "document-1",
      storeEpoch: "store-restored",
    });
    source?.disconnect();
    source?.open();
    expect(events.map((event) => `${event.kind}:${event.kind === "connection" ? event.state : "data"}`).join(",")).toBe(
      "connection:connected,document-update:data,store-reset:data,connection:disconnected,connection:connected",
    );

    const awareness = await adapter.publishAwareness({
      documentId: "document-1",
      clientSessionId: "client-1",
      storeEpoch: "store-1",
      generation: 1,
      update: new Uint8Array([8, 9]),
    });
    expect(awareness.ok).toBeTrue();

    const sync = await adapter.sync({
      documentId: "document-1",
      clientSessionId: "client-1",
      stateVector: new Uint8Array([0]),
    });
    expect(sync.ok).toBeFalse();
    if (!sync.ok) {
      expect(sync.error.code).toBe("document_not_ready");
      expect(sync.error.retryable).toBeTrue();
    }
  });

  test("fails closed when EventSource cannot start", async () => {
    const adapter = createHttpDocumentSyncAdapter({
      projectId: "project-1",
      fetch: async () => {
        throw new Error("must not fetch");
      },
      createEventSource: () => {
        throw new Error("EventSource unavailable");
      },
    });
    adapter.subscribe(
      { documentId: "document-1", clientSessionId: "client-1" },
      () => undefined,
    );
    const result = await adapter.sync({
      documentId: "document-1",
      clientSessionId: "client-1",
      stateVector: new Uint8Array([0]),
    });
    expect(result.ok).toBeFalse();
    if (!result.ok) {
      expect(result.error.code).toBe("transport_unavailable");
    }
  });
});
