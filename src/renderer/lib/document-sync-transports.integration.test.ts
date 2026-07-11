import { describe, expect, test } from "bun:test";
import { EventEmitter } from "node:events";
import { Hono } from "hono";
import * as Y from "yjs";
import type {
  DocumentSyncApplyAck,
  DocumentSyncApplyRequest,
  DocumentSyncCommandResult,
  DocumentSyncRequest,
  DocumentSyncResponse,
} from "../../shared/block-documents/document-sync";
import {
  DocumentSyncHub,
  type DocumentSyncClientTarget,
  type DocumentSyncDurableBackend,
} from "../../main/document-sync-hub";
import { registerDocumentSyncHttpRoutes } from "../../main/document-sync-http";
import { createElectronDocumentSyncAdapter } from "./electron-document-sync-adapter";
import type { ElectronRendererBridge } from "./electron-renderer-transport";
import { createHttpDocumentSyncAdapter } from "./http-document-sync-adapter";
import { NodexYProvider } from "./nodex-y-provider";

const success = <T>(value: T): DocumentSyncCommandResult<T> => ({
  ok: true,
  value,
});

class MemoryDurableBackend implements DocumentSyncDurableBackend {
  readonly document = new Y.Doc({ guid: "document-1" });
  readonly committed = new Map<string, DocumentSyncApplyAck>();
  headSeq = 0;

  sync = async (
    request: DocumentSyncRequest,
  ): Promise<DocumentSyncCommandResult<DocumentSyncResponse>> =>
    success({
      documentId: request.documentId,
      storeEpoch: "store-1",
      generation: 1,
      headSeq: this.headSeq,
      stateVector: Y.encodeStateVector(this.document),
      update: Y.encodeStateAsUpdate(this.document, request.stateVector),
    });

  applyUpdate = async (
    request: DocumentSyncApplyRequest,
  ): Promise<DocumentSyncCommandResult<DocumentSyncApplyAck>> => {
    const existing = this.committed.get(request.updateId);
    if (existing) {
      return success({ ...existing, headSeq: this.headSeq, duplicate: true });
    }
    Y.applyUpdate(this.document, request.update);
    this.headSeq += 1;
    const ack: DocumentSyncApplyAck = {
      documentId: request.documentId,
      storeEpoch: "store-1",
      generation: 1,
      updateId: request.updateId,
      committedSeq: this.headSeq,
      headSeq: this.headSeq,
      stateVector: Y.encodeStateVector(this.document),
      duplicate: false,
    };
    this.committed.set(request.updateId, ack);
    return success(ack);
  };

  applyDocumentMutation = async () => {
    throw new Error(
      "Document mutation is not exercised by this sync transport test",
    );
  };

  lookupCommittedRelocation = async () => ({
    ok: true as const,
    value: null,
  });

  prepareRelocationCommand = async () => {
    throw new Error("Relocation is not exercised by this sync transport test");
  };

  relocateBlocks = async () => {
    throw new Error("Relocation is not exercised by this sync transport test");
  };

  destroy(): void {
    this.document.destroy();
  }
}

const waitUntil = async (predicate: () => boolean): Promise<void> => {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    if (predicate()) return;
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  }
  throw new Error("Document transports did not settle");
};

class FakeElectronTarget extends EventEmitter implements DocumentSyncClientTarget {
  private destroyed = false;
  readonly bridgeListeners = new Map<string, Set<(...args: unknown[]) => void>>();

  constructor(readonly id: number, private readonly hub: DocumentSyncHub) {
    super();
  }

  isDestroyed(): boolean {
    return this.destroyed;
  }

  send(channel: string, ...args: unknown[]): void {
    this.bridgeListeners.get(channel)?.forEach((listener) => listener(...args));
  }

  invoke = async (channel: string, ...args: unknown[]): Promise<unknown> => {
    const request = args[0] as DocumentSyncRequest;
    if (channel === "document-sync:subscribe") {
      return this.hub.subscribe(this, request);
    }
    if (channel === "document-sync:unsubscribe") {
      return this.hub.unsubscribe(this, request);
    }
    if (channel === "document-sync:sync") {
      return this.hub.sync(this, request);
    }
    if (channel === "document-sync:apply") {
      return this.hub.applyUpdate(
        this,
        request as unknown as DocumentSyncApplyRequest,
      );
    }
    if (channel === "document-sync:awareness:publish") {
      return this.hub.publishAwareness(this, request as never);
    }
    throw new Error(`Unexpected channel: ${channel}`);
  };

  onBridge = (channel: string, listener: (...args: unknown[]) => void): (() => void) => {
    const listeners = this.bridgeListeners.get(channel) ?? new Set();
    listeners.add(listener);
    this.bridgeListeners.set(channel, listeners);
    return () => listeners.delete(listener);
  };

  asBridge(): ElectronRendererBridge {
    return {
      invoke: this.invoke,
      on: this.onBridge,
      serverUrl: "http://unused.test",
    } as unknown as ElectronRendererBridge;
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.emit("destroyed");
  }
}

class HonoEventSource {
  onopen: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onmessage: ((event: { readonly data: string }) => void) | null = null;
  private reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
  private closed = false;

  constructor(readonly url: string, private readonly app: Hono) {
    queueMicrotask(() => void this.start());
  }

  close(): void {
    this.closed = true;
    void this.reader?.cancel();
    this.reader = null;
  }

  private async start(): Promise<void> {
    const parsed = new URL(this.url);
    const response = await this.app.request(`${parsed.pathname}${parsed.search}`);
    if (!response.ok || !response.body || this.closed) {
      this.onerror?.();
      return;
    }
    this.reader = response.body.getReader();
    this.onopen?.();
    const decoder = new TextDecoder();
    let buffer = "";
    while (!this.closed) {
      const next = await this.reader.read();
      if (next.done) break;
      buffer += decoder.decode(next.value, { stream: true });
      let boundary = buffer.indexOf("\n\n");
      while (boundary >= 0) {
        const frame = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);
        const data = frame
          .split("\n")
          .find((line) => line.startsWith("data: "))
          ?.slice("data: ".length);
        if (data) this.onmessage?.({ data });
        boundary = buffer.indexOf("\n\n");
      }
    }
    if (!this.closed) this.onerror?.();
  }
}

const runConcurrentEdit = async (
  createAdapter: (clientIndex: number) => ReturnType<typeof createElectronDocumentSyncAdapter>,
): Promise<{ readonly merged: string; readonly first: string; readonly second: string }> => {
  const firstDocument = new Y.Doc({ guid: "document-1" });
  const secondDocument = new Y.Doc({ guid: "document-1" });
  const first = new NodexYProvider({
    documentId: "document-1",
    document: firstDocument,
    adapter: createAdapter(1),
    clientSessionId: "client-1",
    autoConnect: false,
  });
  const second = new NodexYProvider({
    documentId: "document-1",
    document: secondDocument,
    adapter: createAdapter(2),
    clientSessionId: "client-2",
    autoConnect: false,
  });
  try {
    await Promise.all([first.connect(), second.connect()]);
    firstDocument.getText("title").insert(0, "A");
    secondDocument.getText("title").insert(0, "B");
    await Promise.all([first.flush(), second.flush()]);
    await waitUntil(
      () => first.getStatus().headSeq === 2 && second.getStatus().headSeq === 2,
    );
    return {
      merged: firstDocument.getText("title").toString(),
      first: firstDocument.getText("title").toString(),
      second: secondDocument.getText("title").toString(),
    };
  } finally {
    first.destroy();
    second.destroy();
    firstDocument.destroy();
    secondDocument.destroy();
  }
};

describe("Document sync transport parity", () => {
  test("converges two independent Electron IPC provider surfaces", async () => {
    const backend = new MemoryDurableBackend();
    const hub = new DocumentSyncHub(backend);
    const targets = [new FakeElectronTarget(1, hub), new FakeElectronTarget(2, hub)];
    try {
      const result = await runConcurrentEdit((index) =>
        createElectronDocumentSyncAdapter(targets[index - 1]!.asBridge()),
      );
      expect(result.first).toBe(result.merged);
      expect(result.second).toBe(result.merged);
      expect(result.merged.length).toBe(2);
      expect(backend.document.getText("title").toString()).toBe(result.merged);
    } finally {
      targets.forEach((target) => target.destroy());
      backend.destroy();
    }
  });

  test("converges two independent browser HTTP/SSE provider surfaces", async () => {
    const backend = new MemoryDurableBackend();
    const hub = new DocumentSyncHub(backend);
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
        stateVector: new Uint8Array(),
      }),
      prepareOwnedBlockDocument: async (projectId, ownerBlockId) => success({
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
        stateVector: new Uint8Array(),
      }),
      getDocumentProjectId: async () => success("project-1"),
    });
    const adapters = [1, 2].map(() =>
      createHttpDocumentSyncAdapter({
        projectId: "project-1",
        toUrl: (path) => `http://nodex.test${path}`,
        fetch: ((input: string | URL | Request, init?: RequestInit) => {
          const parsed = new URL(String(input));
          return app.request(`${parsed.pathname}${parsed.search}`, init);
        }) as typeof globalThis.fetch,
        createEventSource: (url) => new HonoEventSource(url, app),
      }),
    );
    try {
      const result = await runConcurrentEdit((index) => adapters[index - 1]!);
      expect(result.first).toBe(result.merged);
      expect(result.second).toBe(result.merged);
      expect(result.merged.length).toBe(2);
      expect(backend.document.getText("title").toString()).toBe(result.merged);
    } finally {
      backend.destroy();
    }
  });
});
