import { describe, expect, test } from "vitest";

import {
  CANVAS_SCENE_SYNC_VERSION,
  materializePortableCanvasScene,
} from "../../shared/block-documents";
import type { DocumentSyncClientTarget } from "../document-sync-hub";
import {
  createDesktopDocumentSyncBridge,
  type DesktopDocumentSyncBridgeInput,
} from "./desktop-document-sync-bridge";
import type { RustDataAuthorityRuntime } from "./desktop-data-authority";
import { FakeCoreClient } from "./testing/fake-core-client";

class FakeTarget implements DocumentSyncClientTarget {
  readonly sent: Array<{ readonly channel: string; readonly payload: unknown }> = [];
  readonly #destroyedListeners: Array<() => void> = [];
  #destroyed = false;

  constructor(readonly id: number) {}

  isDestroyed(): boolean {
    return this.#destroyed;
  }

  send(channel: string, ...args: unknown[]): void {
    this.sent.push({ channel, payload: args[0] });
  }

  once(event: "destroyed", listener: () => void): void {
    if (event === "destroyed") this.#destroyedListeners.push(listener);
  }

  destroy(): void {
    this.#destroyed = true;
    for (const listener of this.#destroyedListeners) listener();
  }
}

const neverTypeScript = (): DesktopDocumentSyncBridgeInput["typescript"] => ({
  hub: {
    subscribe: () => { throw new Error("TypeScript Hub must not run"); },
    unsubscribe: () => { throw new Error("TypeScript Hub must not run"); },
    sync: async () => { throw new Error("TypeScript Hub must not run"); },
    applyUpdate: async () => { throw new Error("TypeScript Hub must not run"); },
    publishAwareness: () => { throw new Error("TypeScript Hub must not run"); },
    respondToRelocationLease: () => { throw new Error("TypeScript Hub must not run"); },
    subscribeCanvasScene: () => { throw new Error("TypeScript Hub must not run"); },
    unsubscribeCanvasScene: () => { throw new Error("TypeScript Hub must not run"); },
    syncCanvasScene: async () => { throw new Error("TypeScript Hub must not run"); },
    applyCanvasSceneMutation: async () => { throw new Error("TypeScript Hub must not run"); },
  },
  authorizeProject: async () => {
    throw new Error("TypeScript authorization must not run");
  },
  authorizeLibrary: async () => {
    throw new Error("TypeScript authorization must not run");
  },
});

const rustRuntime = (
  rootClient: FakeCoreClient,
  projectClient: FakeCoreClient = rootClient,
): RustDataAuthorityRuntime => ({
  backend: "rust",
  rootClient,
  clientForProject: () => projectClient,
} as unknown as RustDataAuthorityRuntime);

const subscribeRequest = {
  documentId: "document:one",
  clientSessionId: "renderer:one",
} as const;

const canvasSubscribeRequest = {
  version: CANVAS_SCENE_SYNC_VERSION,
  projectId: "project:canvas",
  documentId: "document:canvas",
  clientSessionId: "renderer:canvas",
} as const;

const canvasSyncSnapshot = () => ({
  version: 1 as const,
  store_epoch: "epoch:canvas",
  event_head: 0,
  value: {
    kind: "canvas_sync" as const,
    descriptor: {
      version: 2 as const,
      projectId: canvasSubscribeRequest.projectId,
      ownerBlockId: "canvas:one",
      ownerType: "canvas" as const,
      ownerLifecycle: "active" as const,
      documentId: canvasSubscribeRequest.documentId,
      storeEpoch: "epoch:canvas",
      generation: 1,
      headSeq: 0,
      schemaKey: "nodex.canvas",
      schemaVersion: 1,
      readiness: "ready" as const,
      sync: { kind: "canvas_scene" as const },
    },
    scene_json: [...new TextEncoder().encode(JSON.stringify(
      materializePortableCanvasScene({ elements: [] }),
    ))],
    scene_hash: "a".repeat(64),
  },
});

describe("Desktop Document sync bridge", () => {
  test("binds one Project subscription to its exact Electron target", async () => {
    const client = new FakeCoreClient();
    client.enqueueDocumentSync({
      documentId: subscribeRequest.documentId,
      storeEpoch: "epoch:test",
      generation: 1,
      headSeq: 2,
      update: new Uint8Array(),
      stateVector: new Uint8Array(),
    });
    const bridge = createDesktopDocumentSyncBridge({
      authority: Promise.resolve(rustRuntime(client)),
      typescript: neverTypeScript(),
    });
    const owner = new FakeTarget(1);
    const other = new FakeTarget(2);
    const scope = { kind: "project", projectId: "project:one" } as const;

    await expect(bridge.subscribe(scope, owner, subscribeRequest)).resolves
      .toEqual({ ok: true, value: { subscribed: true } });
    await expect(bridge.subscribe(scope, owner, {
      ...subscribeRequest,
      documentId: "document:two",
    })).resolves.toMatchObject({
      ok: false,
      error: { code: "unauthorized" },
    });
    await expect(bridge.subscribe(
      { kind: "library" },
      other,
      subscribeRequest,
    )).resolves.toMatchObject({
      ok: false,
      error: { code: "unauthorized" },
    });
    await expect(bridge.subscribe(scope, other, subscribeRequest)).resolves
      .toMatchObject({ ok: false, error: { code: "unauthorized" } });
    await expect(bridge.sync(scope, other, {
      ...subscribeRequest,
      stateVector: new Uint8Array(),
    })).resolves.toMatchObject({
      ok: false,
      error: { code: "unauthorized" },
    });
    await expect(bridge.sync(scope, owner, {
      ...subscribeRequest,
      stateVector: new Uint8Array(),
    })).resolves.toMatchObject({
      ok: true,
      value: { documentId: subscribeRequest.documentId, headSeq: 2 },
    });

    owner.destroy();
    await expect(bridge.subscribe(scope, other, subscribeRequest)).resolves
      .toEqual({ ok: true, value: { subscribed: true } });
  });

  test("uses the trusted root client for Library Document sync", async () => {
    const rootClient = new FakeCoreClient();
    const projectClient = new FakeCoreClient();
    rootClient.enqueueDocumentSync({
      documentId: subscribeRequest.documentId,
      storeEpoch: "epoch:test",
      generation: 1,
      headSeq: 3,
      update: new Uint8Array(),
      stateVector: new Uint8Array(),
    });
    const bridge = createDesktopDocumentSyncBridge({
      authority: Promise.resolve(rustRuntime(rootClient, projectClient)),
      typescript: neverTypeScript(),
    });
    const target = new FakeTarget(1);
    const scope = { kind: "library" } as const;

    await expect(bridge.subscribe(scope, target, subscribeRequest)).resolves
      .toEqual({ ok: true, value: { subscribed: true } });
    await expect(bridge.sync(scope, target, {
      ...subscribeRequest,
      stateVector: new Uint8Array(),
    })).resolves.toMatchObject({
      ok: true,
      value: { documentId: subscribeRequest.documentId, headSeq: 3 },
    });
    expect(rootClient.documentSyncs).toHaveLength(1);
    expect(projectClient.documentSyncs).toHaveLength(0);
  });

  test("binds Canvas sync to its Project client, engine, and exact target", async () => {
    const rootClient = new FakeCoreClient();
    const projectClient = new FakeCoreClient();
    projectClient.enqueueDocumentRead(canvasSyncSnapshot());
    const bridge = createDesktopDocumentSyncBridge({
      authority: Promise.resolve(rustRuntime(rootClient, projectClient)),
      typescript: neverTypeScript(),
    });
    const yjsTarget = new FakeTarget(1);
    const canvasTarget = new FakeTarget(2);
    const otherTarget = new FakeTarget(3);

    await expect(bridge.subscribe(
      { kind: "project", projectId: "project:one" },
      yjsTarget,
      subscribeRequest,
    )).resolves.toEqual({ ok: true, value: { subscribed: true } });
    await expect(bridge.subscribeCanvasScene(canvasTarget, {
      ...canvasSubscribeRequest,
      clientSessionId: subscribeRequest.clientSessionId,
    })).resolves.toMatchObject({
      ok: false,
      error: { code: "project_scope_mismatch" },
    });

    await expect(bridge.subscribeCanvasScene(
      canvasTarget,
      canvasSubscribeRequest,
    )).resolves.toEqual({ ok: true, value: { subscribed: true } });
    await expect(bridge.syncCanvasScene(
      otherTarget,
      canvasSubscribeRequest,
    )).resolves.toMatchObject({
      ok: false,
      error: { code: "project_scope_mismatch" },
    });
    await expect(bridge.syncCanvasScene(
      canvasTarget,
      canvasSubscribeRequest,
    )).resolves.toMatchObject({
      ok: true,
      value: {
        projectId: canvasSubscribeRequest.projectId,
        documentId: canvasSubscribeRequest.documentId,
        headSeq: 0,
      },
    });
    expect(rootClient.documentReads).toHaveLength(0);
    expect(projectClient.documentReads).toEqual([{
      clientSessionId: canvasSubscribeRequest.clientSessionId,
      read: {
        kind: "sync_canvas",
        document_id: canvasSubscribeRequest.documentId,
      },
    }]);
  });

  test("does not open a late subscription for a destroyed startup target", async () => {
    let resolveAuthority: ((runtime: RustDataAuthorityRuntime) => void) | undefined;
    const authority = new Promise<RustDataAuthorityRuntime>((resolve) => {
      resolveAuthority = resolve;
    });
    const client = new FakeCoreClient();
    const bridge = createDesktopDocumentSyncBridge({
      authority,
      typescript: neverTypeScript(),
    });
    const target = new FakeTarget(1);
    const pending = bridge.subscribe(
      { kind: "project", projectId: "project:one" },
      target,
      subscribeRequest,
    );

    target.destroy();
    resolveAuthority?.(rustRuntime(client));

    await expect(pending).resolves.toMatchObject({
      ok: false,
      error: { code: "unauthorized" },
    });
  });

  test("normalizes authority startup failure into a typed transport error", async () => {
    const bridge = createDesktopDocumentSyncBridge({
      authority: Promise.reject(new Error("Core startup failed")),
      typescript: neverTypeScript(),
    });

    await expect(bridge.subscribe(
      { kind: "project", projectId: "project:one" },
      new FakeTarget(1),
      subscribeRequest,
    )).resolves.toMatchObject({
      ok: false,
      error: {
        code: "transport_unavailable",
        message: "Core startup failed",
        retryable: true,
      },
    });
  });
});
