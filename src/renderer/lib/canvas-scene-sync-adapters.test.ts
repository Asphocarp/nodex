import { describe, expect, test } from "vitest";
import {
  encodeCanvasSceneMutationResultHttp,
  encodeCanvasSceneSseEvent,
  encodeCanvasSceneSyncResultHttp,
} from "../../shared/block-documents/canvas-scene-http-contract";
import { createElectronCanvasSceneSyncAdapter } from "./electron-canvas-scene-sync-adapter";
import type { ElectronRendererBridge } from "./electron-renderer-transport";
import { createHttpCanvasSceneSyncAdapter } from "./http-canvas-scene-sync-adapter";

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
  const bridge = {
    invoke: async (channel: string, request: { documentId: string }) => {
      calls.push(channel);
      if (channel === "canvas-scene:subscribe") {
        return { ok: true, value: { subscribed: true } };
      }
      if (channel === "canvas-scene:sync") {
        return { ok: true, value: {
          version: 1, projectId: "project-1", documentId: request.documentId,
          storeEpoch: "store-1", generation: 1, headSeq: 0,
          sceneHash: "a".repeat(64), scene: emptyScene,
        } };
      }
      if (channel === "document-sync:relocation-lease:respond") {
        return { ok: true, value: {
          accepted: true, leaseId: "lease-1", documentId: request.documentId,
          status: "frozen",
        } };
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
    projectId: "project-1", documentId: "canvas-1", clientSessionId: "client-1",
  }, () => undefined);
  const result = await adapter.sync({
    version: 1, projectId: "project-1", documentId: "canvas-1", clientSessionId: "client-1",
  });
  expect(result.ok).toBe(true);
  expect(calls.slice(0, 2)).toEqual(["canvas-scene:subscribe", "canvas-scene:sync"]);
  const lease = await adapter.respondToRelocationLease?.({
    response: "ack", leaseId: "lease-1", documentId: "canvas-1",
    clientSessionId: "client-1", storeEpoch: "store-1", generation: 1, headSeq: 0,
  });
  expect(lease?.ok).toBe(true);
  unsubscribe();
});

describe("HTTP Canvas adapter", () => {
  test("opens SSE before bounded JSON sync/mutation and receives realtime", async () => {
    const sources: Array<{
      onopen: ((event: Event) => unknown) | null;
      onerror: ((event: Event) => unknown) | null;
      onmessage: ((event: MessageEvent<string>) => unknown) | null;
      close(): void;
    }> = [];
    const fetch = async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes("/relocation-leases/")) {
        return Response.json({
          accepted: true,
          leaseId: "lease-1",
          documentId: "canvas-1",
          status: "frozen",
        });
      }
      if (url.endsWith("/canvas/sync")) {
        return new Response(encodeCanvasSceneSyncResultHttp({ ok: true, value: {
          version: 1, projectId: "project-1", documentId: "canvas-1",
          storeEpoch: "store-1", generation: 1, headSeq: 0,
          sceneHash: "a".repeat(64), scene: emptyScene,
        } }), { headers: { "Content-Type": "application/vnd.nodex.canvas-scene.v1+json" } });
      }
      return new Response(encodeCanvasSceneMutationResultHttp({ ok: true, value: {
        version: 1, mutationId: "mutation-1", projectId: "project-1",
        documentId: "canvas-1", storeEpoch: "store-1", generation: 1,
        baseHeadSeq: 0, headSeq: 1, duplicate: false, outcome: "committed",
        sceneHash: "b".repeat(64), changedElementIds: [], appliedAppStateKeys: [],
        skippedAppStateKeys: [], addedFileIds: [], removedFileIds: [],
        committedAt: "2026-07-13T00:00:00.000Z",
      } }), { headers: { "Content-Type": "application/vnd.nodex.canvas-scene.v1+json" } });
    };
    const adapter = createHttpCanvasSceneSyncAdapter({
      projectId: "project-1",
      fetch: fetch as typeof globalThis.fetch,
      toUrl: (path) => `http://nodex.test${path}`,
      createEventSource: () => {
        const source = { onopen: null, onerror: null, onmessage: null, close() {} };
        sources.push(source);
        return source;
      },
    });
    const events: string[] = [];
    adapter.subscribe({
      projectId: "project-1", documentId: "canvas-1", clientSessionId: "client-1",
    }, (event) => events.push(event.type));
    const pending = adapter.sync({
      version: 1, projectId: "project-1", documentId: "canvas-1", clientSessionId: "client-1",
    });
    sources[0]?.onopen?.(new Event("open"));
    expect((await pending).ok).toBe(true);
    sources[0]?.onerror?.(new Event("error"));
    const disconnected = adapter.sync({
      version: 1, projectId: "project-1", documentId: "canvas-1", clientSessionId: "client-1",
    });
    await Promise.resolve();
    sources[0]?.onerror?.(new Event("error"));
    expect(await disconnected).toEqual({
      ok: false,
      error: expect.objectContaining({ retryable: true }),
    });
    sources[0]?.onopen?.(new Event("open"));
    expect(events).toEqual(["canvas_scene_resync_required"]);
    sources[0]?.onmessage?.({ data: encodeCanvasSceneSseEvent({
      type: "canvas_scene_resync_required", version: 1, projectId: "project-1",
      documentId: "canvas-1", storeEpoch: "store-1", generation: 1, headSeq: 1,
    }) } as MessageEvent<string>);
    expect(events).toEqual([
      "canvas_scene_resync_required",
      "canvas_scene_resync_required",
    ]);
    const lease = await adapter.respondToRelocationLease?.({
      response: "ack",
      leaseId: "lease-1",
      documentId: "canvas-1",
      clientSessionId: "client-1",
      storeEpoch: "store-1",
      generation: 1,
      headSeq: 1,
    });
    expect(lease?.ok).toBe(true);
  });
});
