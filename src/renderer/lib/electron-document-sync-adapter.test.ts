import { describe, expect, test } from "bun:test";
import type { DocumentSyncRealtimeEvent } from "../../shared/block-documents/document-sync";
import { createElectronDocumentSyncAdapter } from "./electron-document-sync-adapter";
import type { ElectronRendererBridge } from "./electron-renderer-transport";

interface Deferred<T> {
  readonly promise: Promise<T>;
  readonly resolve: (value: T) => void;
}

const deferred = <T>(): Deferred<T> => {
  let resolve: (value: T) => void = () => undefined;
  const promise = new Promise<T>((complete) => {
    resolve = complete;
  });
  return { promise, resolve };
};

class FakeBridge {
  readonly calls: Array<{ readonly channel: string; readonly args: unknown[] }> = [];
  readonly listeners = new Map<string, Set<(...args: unknown[]) => void>>();
  readonly subscription = deferred<unknown>();

  invoke = async (channel: string, ...args: unknown[]): Promise<unknown> => {
    this.calls.push({ channel, args });
    if (channel === "document-sync:subscribe") {
      return this.subscription.promise;
    }
    if (channel === "document-sync:sync") {
      return {
        ok: true,
        value: {
          documentId: "doc-1",
          storeEpoch: "epoch-1",
          generation: 1,
          headSeq: 0,
          stateVector: new Uint8Array([0]),
          update: new Uint8Array([0]),
        },
      };
    }
    if (channel === "document-sync:unsubscribe") {
      return { ok: true, value: { unsubscribed: true } };
    }
    if (channel === "document-sync:relocation-lease:respond") {
      const request = args[0] as {
        leaseId: string;
        documentId: string;
        response: "ack" | "nack";
      };
      return {
        ok: true,
        value: {
          accepted: true,
          leaseId: request.leaseId,
          documentId: request.documentId,
          status: request.response === "ack" ? "frozen" : "cancelled",
        },
      };
    }
    return {
      ok: false,
      error: {
        code: "unknown",
        message: "unexpected command",
        retryable: false,
        resetRequired: false,
      },
    };
  };

  on = (
    event: string,
    callback: (...args: unknown[]) => void,
  ): (() => void) => {
    const active = this.listeners.get(event) ?? new Set();
    active.add(callback);
    this.listeners.set(event, active);
    return () => active.delete(callback);
  };

  emit(event: string, value: unknown): void {
    this.listeners.get(event)?.forEach((listener) => listener(value));
  }
}

describe("createElectronDocumentSyncAdapter", () => {
  test("installs realtime listening and awaits subscribe before state-vector sync", async () => {
    const bridge = new FakeBridge();
    const adapter = createElectronDocumentSyncAdapter(
      bridge as unknown as ElectronRendererBridge,
    );
    const events: DocumentSyncRealtimeEvent[] = [];
    const unsubscribe = adapter.subscribe(
      { documentId: "doc-1", clientSessionId: "session-1" },
      (event) => events.push(event),
    );
    const syncing = adapter.sync({
      documentId: "doc-1",
      clientSessionId: "session-1",
      stateVector: new Uint8Array([0]),
    });
    await Promise.resolve();
    expect(bridge.calls.map((call) => call.channel).join(",")).toBe(
      "document-sync:subscribe",
    );

    bridge.emit("document-sync:event", {
      kind: "connection",
      documentId: "doc-1",
      state: "connected",
    });
    expect(events.length).toBe(1);
    bridge.subscription.resolve({ ok: true, value: { subscribed: true } });
    const result = await syncing;
    expect(result.ok).toBeTrue();
    expect(bridge.calls.map((call) => call.channel).join(",")).toBe(
      "document-sync:subscribe,document-sync:sync",
    );

    unsubscribe();
    await Promise.resolve();
    await Promise.resolve();
    expect(bridge.calls.map((call) => call.channel).join(",")).toBe(
      "document-sync:subscribe,document-sync:sync,document-sync:unsubscribe",
    );
  });

  test("routes binary events only to matching document subscribers", () => {
    const bridge = new FakeBridge();
    const adapter = createElectronDocumentSyncAdapter(
      bridge as unknown as ElectronRendererBridge,
    );
    const events: DocumentSyncRealtimeEvent[] = [];
    adapter.subscribe(
      { documentId: "doc-1", clientSessionId: "session-1" },
      (event) => events.push(event),
    );

    bridge.emit("document-sync:event", {
      kind: "document-update",
      documentId: "doc-2",
      storeEpoch: "epoch-1",
      generation: 1,
      headSeq: 1,
      updateId: "update-other",
      clientSessionId: "session-2",
      update: new Uint8Array([9]),
    });
    bridge.emit("document-sync:event", {
      kind: "document-update",
      documentId: "doc-1",
      storeEpoch: "epoch-1",
      generation: 1,
      headSeq: 1,
      updateId: "update-1",
      clientSessionId: "session-2",
      update: new Uint8Array([4, 5]),
    });
    bridge.emit("document-sync:event", {
      kind: "store-reset",
      documentId: "doc-1",
      storeEpoch: "epoch-restored",
    });

    expect(events.length).toBe(2);
    const event = events[0];
    expect(event?.kind).toBe("document-update");
    if (event?.kind === "document-update") {
      expect(Array.from(event.update).join(",")).toBe("4,5");
    }
    expect(events[1]?.kind).toBe("store-reset");
  });

  test("returns typed subscription errors without parsing Error messages", async () => {
    const bridge = new FakeBridge();
    const adapter = createElectronDocumentSyncAdapter(
      bridge as unknown as ElectronRendererBridge,
    );
    adapter.subscribe(
      { documentId: "doc-1", clientSessionId: "session-1" },
      () => undefined,
    );
    bridge.subscription.resolve({
      ok: false,
      error: {
        code: "store_not_initialized",
        message: "backend booting",
        retryable: true,
        resetRequired: false,
      },
    });

    const result = await adapter.sync({
      documentId: "doc-1",
      clientSessionId: "session-1",
      stateVector: new Uint8Array([0]),
    });
    expect(result.ok).toBeFalse();
    if (!result.ok) {
      expect(result.error.code).toBe("store_not_initialized");
      expect(result.error.retryable).toBeTrue();
    }
  });

  test("targets lease events by client session and invokes the response seam", async () => {
    const bridge = new FakeBridge();
    const adapter = createElectronDocumentSyncAdapter(
      bridge as unknown as ElectronRendererBridge,
    );
    const events: DocumentSyncRealtimeEvent[] = [];
    adapter.subscribe(
      { documentId: "doc-1", clientSessionId: "session-1" },
      (event) => events.push(event),
    );
    bridge.subscription.resolve({ ok: true, value: { subscribed: true } });
    await Promise.resolve();

    const base = {
      kind: "relocation-lease-prepare" as const,
      leaseId: "lease-1",
      documentId: "doc-1",
      storeEpoch: "epoch-1",
      generation: 1,
      expectedHeadSeq: 0,
      deadlineAt: 2_000,
    };
    bridge.emit("document-sync:event", {
      ...base,
      clientSessionId: "session-other",
    });
    bridge.emit("document-sync:event", {
      ...base,
      clientSessionId: "session-1",
    });
    expect(events.length).toBe(1);
    expect(events[0]?.kind).toBe("relocation-lease-prepare");

    const response = await adapter.respondToRelocationLease({
      response: "ack",
      leaseId: "lease-1",
      documentId: "doc-1",
      clientSessionId: "session-1",
      storeEpoch: "epoch-1",
      generation: 1,
      headSeq: 0,
    });
    expect(response.ok).toBeTrue();
    expect(bridge.calls.at(-1)?.channel).toBe(
      "document-sync:relocation-lease:respond",
    );
  });
});
