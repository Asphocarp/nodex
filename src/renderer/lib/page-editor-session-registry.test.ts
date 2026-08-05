import { describe, expect, test, vi } from "vitest";
import type { OwnedDocumentDescriptor } from "../../shared/block-documents";
import type {
  BlockDocumentSurfaceRuntime,
  BlockDocumentSurfaceStatus,
} from "./block-document-surface-runtime";
import {
  PageEditorSessionRegistry,
  makePageEditorSessionKey,
} from "./page-editor-session-registry";

const descriptor = (
  generation = 1,
  headSeq = 1,
): OwnedDocumentDescriptor => ({
  projectId: "project-1",
  ownerBlockId: "page-1",
  ownerType: "page",
  ownerLifecycle: "active",
  documentId: "document-1",
  storeEpoch: "epoch-1",
  generation,
  headSeq,
  schemaKey: "nodex.page",
  schemaVersion: 1,
  readiness: "ready",
  sync: { kind: "yjs", stateVector: new Uint8Array([headSeq]) },
});

function createRuntime(input: {
  readonly descriptor?: OwnedDocumentDescriptor;
  readonly connect?: () => Promise<void>;
  readonly close?: () => Promise<void>;
  readonly ready?: boolean;
}) {
  const runtimeDescriptor = input.descriptor ?? descriptor();
  const clearLocalAwareness = vi.fn();
  const persist = vi.fn(async () => ({
    timedOut: false,
    flush: "completed" as const,
    checkpoint: "completed" as const,
  }));
  const close = vi.fn(async () => {
    await input.close?.();
    return {
      timedOut: false,
      flush: "completed" as const,
      checkpoint: "completed" as const,
    };
  });
  const connect = vi.fn(input.connect ?? (async () => undefined));
  const ready = input.ready ?? true;
  const status: BlockDocumentSurfaceStatus = {
    phase: ready ? "ready" : "connecting",
    ready,
    reloadRequired: false,
    descriptor: runtimeDescriptor,
    provider: {
      phase: ready ? "synced" : "connecting",
      documentId: runtimeDescriptor.documentId,
      clientSessionId: "client-session-1",
      connected: ready,
      storeEpoch: runtimeDescriptor.storeEpoch,
      generation: runtimeDescriptor.generation,
      headSeq: runtimeDescriptor.headSeq,
      pendingUpdateCount: 0,
    },
  };
  const runtime = {
    descriptor: runtimeDescriptor,
    connect,
    close,
    persist,
    clearLocalAwareness,
    getStatus: () => status,
  } as unknown as BlockDocumentSurfaceRuntime;
  return { runtime, connect, close, persist, clearLocalAwareness };
}

describe("PageEditorSessionRegistry", () => {
  test("keeps one model for a PageTab while durable head snapshots advance", () => {
    const registry = new PageEditorSessionRegistry();
    const key = makePageEditorSessionKey("session-1", "tab-page-1");
    const firstRuntime = createRuntime({});
    const createFirst = vi.fn(() => firstRuntime.runtime);
    const first = registry.acquire({
      key,
      descriptor: descriptor(1, 1),
      createRuntime: createFirst,
    });
    const second = registry.acquire({
      key,
      descriptor: descriptor(1, 2),
      createRuntime: () => {
        throw new Error("A head-only update must not replace the model");
      },
    });

    expect(second).toBe(first);
    expect(createFirst).toHaveBeenCalledTimes(1);
    expect(registry.size).toBe(1);
  });

  test("serializes generation replacement behind disposal of the old model", async () => {
    let releaseOldClose: () => void = () => undefined;
    const oldCloseBarrier = new Promise<void>((resolve) => {
      releaseOldClose = resolve;
    });
    const calls: string[] = [];
    const oldRuntime = createRuntime({
      close: async () => {
        calls.push("old-close-start");
        await oldCloseBarrier;
        calls.push("old-close-end");
      },
    });
    const nextRuntime = createRuntime({
      descriptor: descriptor(2),
      connect: async () => {
        calls.push("next-connect");
      },
    });
    const registry = new PageEditorSessionRegistry();
    const key = makePageEditorSessionKey("session-1", "tab-page-1");
    const oldSession = registry.acquire({
      key,
      descriptor: descriptor(1),
      createRuntime: () => oldRuntime.runtime,
    });
    await oldSession.connect();

    const nextSession = registry.acquire({
      key,
      descriptor: descriptor(2),
      createRuntime: () => nextRuntime.runtime,
    });
    const connecting = nextSession.connect();
    await vi.waitFor(() => {
      expect(calls).toEqual(["old-close-start"]);
    });
    releaseOldClose();
    await connecting;
    expect(calls).toEqual([
      "old-close-start",
      "old-close-end",
      "next-connect",
    ]);
  });

  test("ignores stale view cleanup and backgrounds only the latest claim", async () => {
    const registry = new PageEditorSessionRegistry();
    const runtime = createRuntime({});
    const session = registry.acquire({
      key: makePageEditorSessionKey("session-1", "tab-page-1"),
      descriptor: descriptor(),
      createRuntime: () => runtime.runtime,
    });
    const first = session.claimView();
    const second = session.claimView();

    expect(session.releaseView(first)).toBe(false);
    expect(runtime.clearLocalAwareness).not.toHaveBeenCalled();
    expect(runtime.persist).not.toHaveBeenCalled();

    session.releaseView(second);
    await Promise.resolve();
    expect(runtime.clearLocalAwareness).toHaveBeenCalledTimes(1);
    expect(runtime.persist).toHaveBeenCalledTimes(1);
  });

  test("can release an ephemeral preview view without an extra background persist", async () => {
    const registry = new PageEditorSessionRegistry();
    const runtime = createRuntime({});
    const session = registry.acquire({
      key: makePageEditorSessionKey("session-1", "preview-page-1"),
      descriptor: descriptor(),
      createRuntime: () => runtime.runtime,
    });

    const released = session.releaseView(session.claimView(), {
      persist: false,
    });
    await Promise.resolve();

    expect(released).toBe(true);
    expect(runtime.clearLocalAwareness).toHaveBeenCalledTimes(1);
    expect(runtime.persist).not.toHaveBeenCalled();
  });

  test("flushes every ready retained model at the renderer close boundary", async () => {
    const registry = new PageEditorSessionRegistry();
    const readyRuntime = createRuntime({});
    const connectingRuntime = createRuntime({ ready: false });
    registry.acquire({
      key: makePageEditorSessionKey("session-1", "tab-page-1"),
      descriptor: descriptor(),
      createRuntime: () => readyRuntime.runtime,
    });
    registry.acquire({
      key: makePageEditorSessionKey("session-1", "tab-page-2"),
      descriptor: {
        ...descriptor(),
        ownerBlockId: "page-2",
        documentId: "document-2",
      },
      createRuntime: () => connectingRuntime.runtime,
    });

    await registry.persistAll();

    expect(readyRuntime.persist).toHaveBeenCalledTimes(1);
    expect(connectingRuntime.persist).not.toHaveBeenCalled();
  });

  test("removes presence without persisting a model that has not synced yet", async () => {
    const registry = new PageEditorSessionRegistry();
    const runtime = createRuntime({ ready: false });
    const session = registry.acquire({
      key: makePageEditorSessionKey("session-1", "tab-page-1"),
      descriptor: descriptor(),
      createRuntime: () => runtime.runtime,
    });

    session.releaseView(session.claimView());
    await Promise.resolve();

    expect(runtime.clearLocalAwareness).toHaveBeenCalledTimes(1);
    expect(runtime.persist).not.toHaveBeenCalled();
  });

  test("explicit close destroys a retained editor and runtime exactly once", async () => {
    const registry = new PageEditorSessionRegistry();
    const runtime = createRuntime({});
    const key = makePageEditorSessionKey("session-1", "tab-page-1");
    const session = registry.acquire({
      key,
      descriptor: descriptor(),
      createRuntime: () => runtime.runtime,
    });
    const destroy = vi.fn();
    session.getOrCreateEditor(
      "editor-1",
      () => ({ _tiptapEditor: { destroy } }),
    );

    await Promise.all([
      registry.dispose(key),
      registry.dispose(key),
      session.dispose(),
    ]);

    expect(destroy).toHaveBeenCalledTimes(1);
    expect(runtime.close).toHaveBeenCalledTimes(1);
    expect(registry.size).toBe(0);
  });

  test("does not wait for a stalled initial sync before closing the runtime", async () => {
    const registry = new PageEditorSessionRegistry();
    const runtime = createRuntime({
      connect: () => new Promise<void>(() => undefined),
    });
    const key = makePageEditorSessionKey("session-1", "tab-page-1");
    const session = registry.acquire({
      key,
      descriptor: descriptor(),
      createRuntime: () => runtime.runtime,
    });
    void session.connect().catch(() => undefined);
    await Promise.resolve();

    await registry.dispose(key);

    expect(runtime.connect).toHaveBeenCalledTimes(1);
    expect(runtime.close).toHaveBeenCalledTimes(1);
  });

  test("disposes every PageTab model owned by an archived ProjectSession", async () => {
    const registry = new PageEditorSessionRegistry();
    const firstRuntime = createRuntime({});
    const secondRuntime = createRuntime({});
    const otherRuntime = createRuntime({});
    registry.acquire({
      key: makePageEditorSessionKey("session-1", "tab-page-1"),
      descriptor: descriptor(),
      createRuntime: () => firstRuntime.runtime,
    });
    registry.acquire({
      key: makePageEditorSessionKey("session-1", "tab-page-2"),
      descriptor: {
        ...descriptor(),
        ownerBlockId: "page-2",
        documentId: "document-2",
      },
      createRuntime: () => secondRuntime.runtime,
    });
    registry.acquire({
      key: makePageEditorSessionKey("session-2", "tab-page-1"),
      descriptor: descriptor(),
      createRuntime: () => otherRuntime.runtime,
    });

    await registry.disposeProjectSession("session-1");

    expect(firstRuntime.close).toHaveBeenCalledTimes(1);
    expect(secondRuntime.close).toHaveBeenCalledTimes(1);
    expect(otherRuntime.close).not.toHaveBeenCalled();
    expect(registry.size).toBe(1);
  });
});
