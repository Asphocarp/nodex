import { expect, test } from "vitest";
import { createElectronCanvasSceneSyncAdapter } from "./electron-canvas-scene-sync-adapter";
import type { ElectronRendererBridge } from "./electron-renderer-transport";

const emptyScene = {
  kind: "canvas_scene" as const,
  schemaVersion: 1 as const,
  elements: [],
  appState: {},
  files: {},
  pageReferences: [],
  plainText: "",
  preview: "",
};

test("Electron Canvas adapter awaits subscription and carries lease responses", async () => {
  const calls: string[] = [];
  const listeners = new Set<(...args: unknown[]) => void>();
  const presenceEvents: unknown[] = [];
  const bridge = {
    invoke: async (
      channel: string,
      request: { documentId: string; syncRequestId?: string },
    ) => {
      calls.push(channel);
      if (channel === "canvas-scene:subscribe") {
        return { ok: true, value: { subscribed: true } };
      }
      if (channel === "canvas-scene:sync") {
        return {
          ok: true,
          value: {
            kind: "snapshot",
            version: 1,
            syncRequestId: request.syncRequestId,
            projectId: "project-1",
            documentId: request.documentId,
            storeEpoch: "store-1",
            generation: 1,
            headSeq: 0,
            sceneHash: "a".repeat(64),
            scene: emptyScene,
          },
        };
      }
      if (channel === "document-sync:relocation-lease:respond") {
        return {
          ok: true,
          value: {
            accepted: true,
            leaseId: "lease-1",
            documentId: request.documentId,
            status: "frozen",
          },
        };
      }
      if (channel === "canvas-scene:presence:publish") {
        return { ok: true, value: { accepted: true, applied: true } };
      }
      return { ok: true, value: { unsubscribed: true } };
    },
    on: (_event: string, listener: (...args: unknown[]) => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  } as unknown as ElectronRendererBridge;
  const adapter = createElectronCanvasSceneSyncAdapter(bridge, "project-1");
  const unsubscribe = adapter.subscribe({
    projectId: "project-1",
    documentId: "canvas-1",
    clientSessionId: "client-1",
  }, () => undefined, undefined, (event) => presenceEvents.push(event));
  const result = await adapter.sync({
    version: 1,
    syncRequestId: "sync-1",
    projectId: "project-1",
    documentId: "canvas-1",
    clientSessionId: "client-1",
  });
  expect(result.ok).toBe(true);
  expect(calls.slice(0, 2)).toEqual(["canvas-scene:subscribe", "canvas-scene:sync"]);
  const lease = await adapter.respondToRelocationLease?.({
    response: "ack",
    leaseId: "lease-1",
    documentId: "canvas-1",
    clientSessionId: "client-1",
    storeEpoch: "store-1",
    generation: 1,
    headSeq: 0,
  });
  expect(lease?.ok).toBe(true);
  listeners.forEach((listener) => listener({
    type: "canvas_presence_snapshot",
    version: 1,
    projectId: "project-1",
    documentId: "canvas-1",
    generation: 1,
    presences: [],
  }));
  expect(presenceEvents).toHaveLength(1);
  await expect(adapter.publishPresence?.({
    projectId: "project-1",
    clientSessionId: "client-1",
    publication: {
      version: 1,
      engine: "canvas_scene",
      documentId: "canvas-1",
      generation: 1,
      clock: 1,
      state: { selectedElementIds: [], idle: "active" },
    },
  })).resolves.toMatchObject({ ok: true });
  expect(calls).toContain("canvas-scene:presence:publish");
  unsubscribe();
});

test("Electron Canvas keeps a revived exact session ahead of stale teardown", async () => {
  let resolveSubscription: (result: unknown) => void = () => undefined;
  const subscription = new Promise<unknown>((resolve) => {
    resolveSubscription = resolve;
  });
  const calls: string[] = [];
  const bridge = {
    invoke: async (
      channel: string,
      request: { documentId: string; syncRequestId?: string },
    ) => {
      calls.push(channel);
      if (channel === "canvas-scene:subscribe") return await subscription;
      if (channel === "canvas-scene:sync") {
        return {
          ok: true,
          value: {
            kind: "snapshot",
            version: 1,
            syncRequestId: request.syncRequestId,
            projectId: "project-1",
            documentId: request.documentId,
            storeEpoch: "store-1",
            generation: 1,
            headSeq: 0,
            sceneHash: "a".repeat(64),
            scene: emptyScene,
          },
        };
      }
      return { ok: true, value: { unsubscribed: true } };
    },
    on: () => () => undefined,
  } as unknown as ElectronRendererBridge;
  const adapter = createElectronCanvasSceneSyncAdapter(bridge, "project-1");
  const request = {
    projectId: "project-1",
    documentId: "canvas-1",
    clientSessionId: "client-1",
  } as const;
  const listener = () => undefined;
  const closeFirst = adapter.subscribe(request, listener);
  closeFirst();
  const closeSecond = adapter.subscribe(request, listener);

  resolveSubscription({ ok: true, value: { subscribed: true } });
  await expect(adapter.sync({
    version: 1,
    syncRequestId: "sync-2",
    ...request,
  })).resolves.toMatchObject({
    ok: true,
  });
  expect(calls).toEqual(["canvas-scene:subscribe", "canvas-scene:sync"]);

  closeSecond();
  await Promise.resolve();
  await Promise.resolve();
  expect(calls.at(-1)).toBe("canvas-scene:unsubscribe");
});
