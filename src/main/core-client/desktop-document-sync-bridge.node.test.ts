import { createHash } from "node:crypto";

import { describe, expect, test, vi } from "vitest";

import {
  CANVAS_SCENE_MAINTENANCE_VERSION,
  CANVAS_SCENE_SYNC_VERSION,
  materializePortableCanvasScene,
} from "../../shared/block-documents";
import {
  BLOCK_TRANSFER_INTENT_CONTRACT_VERSION,
  type BlockTransferIntent,
} from "../../shared/block-transfer";
import type {
  DocumentSyncClientTarget,
} from "../document-sync-transport";
import type {
  DocumentSyncSubscribeRequest,
} from "../../shared/block-documents/document-sync";
import type { ExecuteNodexAgentDuplicatePageResult } from "../../shared/nodex-agent-tools";
import { DuplicatePageV3OutputSchema } from "../../shared/nodex-agent-tools/v3-write-schemas";
import { committedLocalCommit } from "../../shared/testing/local-commit";
import { authorizedReadStampFixture } from "../../shared/testing/authorized-read-stamp-fixture";
import {
  createDesktopDocumentSyncBridge,
  type DesktopDocumentSyncPort,
  type DesktopDocumentSyncScope,
} from "./desktop-document-sync-bridge";
import type { RustDataAuthorityRuntime } from "./desktop-data-authority";
import {
  createFakeCoreHandshake,
  FakeCoreClient,
} from "./testing/fake-core-client";
import { createCoreLocalCommitFixture } from "./testing/local-commit-fixture";
import {
  CoreEventCompatibilityError,
  CoreHttpError,
} from "./uds-http";
import type {
  CoreAuthorizedDeliveryPacket,
  DocumentLiveBarrier,
} from "./types";
import { LocalCommitCoordinator } from "./local-commit-coordinator";

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

class RejectFirstDocumentStreamClient extends FakeCoreClient {
  attempts = 0;

  override openDocumentEventStream(
    ...args: Parameters<FakeCoreClient["openDocumentEventStream"]>
  ): ReturnType<FakeCoreClient["openDocumentEventStream"]> {
    this.attempts += 1;
    if (this.attempts === 1) {
      return Promise.reject(
        new CoreHttpError(401, "Core SSE failed to open"),
      );
    }
    return super.openDocumentEventStream(...args);
  }
}

class TerminalDocumentStreamClient extends FakeCoreClient {
  attempts = 0;
  private rejectActive: (error: unknown) => void = () => undefined;

  override openDocumentEventStream(
    ...args: Parameters<FakeCoreClient["openDocumentEventStream"]>
  ): ReturnType<FakeCoreClient["openDocumentEventStream"]> {
    this.attempts += 1;
    if (this.attempts > 1) {
      return super.openDocumentEventStream(...args);
    }
    let resolveDone: () => void = () => undefined;
    const done = new Promise<void>((resolve, reject) => {
      resolveDone = resolve;
      this.rejectActive = reject;
    });
    return Promise.resolve({
      barrier: documentLiveBarrier(args[0].documentId),
      done,
      close: resolveDone,
    });
  }

  terminate(): void {
    this.rejectActive(new CoreEventCompatibilityError(
      "Core event Store epoch is invalid",
    ));
  }
}

class ControlledOpeningDocumentStreamClient extends FakeCoreClient {
  readonly openings: Array<{
    open(): void;
    fail(error: unknown): void;
  }> = [];

  override openDocumentEventStream(
    input: Parameters<FakeCoreClient["openDocumentEventStream"]>[0],
  ): ReturnType<FakeCoreClient["openDocumentEventStream"]> {
    let resolveOpening: (subscription: {
      readonly barrier: DocumentLiveBarrier;
      readonly done: Promise<void>;
      close(): void;
    }) => void = () => undefined;
    let rejectOpening: (error: unknown) => void = () => undefined;
    const opening = new Promise<{
      readonly barrier: DocumentLiveBarrier;
      readonly done: Promise<void>;
      close(): void;
    }>((resolve, reject) => {
      resolveOpening = resolve;
      rejectOpening = reject;
    });
    this.openings.push({
      open: () => {
        let resolveDone: () => void = () => undefined;
        const done = new Promise<void>((resolve) => {
          resolveDone = resolve;
        });
        resolveOpening({
          barrier: documentLiveBarrier(input.documentId),
          done,
          close: resolveDone,
        });
      },
      fail: rejectOpening,
    });
    return opening;
  }
}

const documentLiveBarrier = (documentId: string): DocumentLiveBarrier => ({
  store_epoch: "epoch:test",
  core_generation: "fake-core-start",
  document_id: documentId,
  document_generation: 1,
  head_seq: 0,
  commit_head: 0,
  engine: "yjs",
});

const rustRuntime = (
  rootClient: FakeCoreClient,
  projectClient: FakeCoreClient = rootClient,
): RustDataAuthorityRuntime => {
  Object.assign(rootClient, {
    handshake: createFakeCoreHandshake({
      connectionBinding: "binding:test",
      libraryId: "library:test",
      profileId: "profile:test",
      storeEpoch: "epoch:test",
    }),
  });
  return {
    backend: "rust",
    identity: {
      libraryId: "library:test",
      profileId: "profile:test",
      storeEpoch: "epoch:test",
    },
    rootClient,
    clientForProject: () => projectClient,
  } as unknown as RustDataAuthorityRuntime;
};

const documentCommitEnvelope = (
  commitSeq: number,
  documents: readonly string[],
  options: { readonly inline?: boolean } = {},
): CoreAuthorizedDeliveryPacket => {
  const update = [1, 2, 3] as const;
  const updateHash = createHash("sha256").update(Uint8Array.from(update)).digest("hex");
  return createCoreLocalCommitFixture({
    authorizationScope: {
      kind: "library",
      library_id: "library:test",
    },
    commitSeq,
    storeEpoch: "epoch:test",
    operationId: `operation:document:${commitSeq}`,
    committedAt: "2026-07-19T22:00:00.000Z",
    documentEffects: documents.map((documentId, effectOrder) => ({
      reference: {
        base_head_seq: Math.max(0, commitSeq - 1),
        document_id: documentId,
        effect_order: effectOrder,
        generation: 1,
        page_id: null,
        resource_kind: "document_update",
        result_head_seq: commitSeq,
        update_byte_length: 3,
        update_hash: updateHash,
        update_id: `update:${documentId}:${commitSeq}`,
      },
      inline_update: options.inline === false ? null : update,
    })),
    canonicalHash: String(commitSeq).padStart(64, "0"),
  });
};

const compactedDocumentCommitEnvelope = (
  commitSeq: number,
  documentId: string,
): CoreAuthorizedDeliveryPacket => {
  const envelope = documentCommitEnvelope(commitSeq, [documentId]);
  const payload = {
    module: "owned_document" as const,
    library_id: "library-1",
    canvas_id: null,
    event: {
      kind: "document_resync_required" as const,
      document_id: documentId,
      generation: 1,
      head_seq: commitSeq,
      update_id: `update:document:${commitSeq}`,
      update_hash: String(commitSeq).padStart(64, "0"),
    },
  };
  return createCoreLocalCommitFixture({
    authorizationScope: {
      kind: "library",
      library_id: "library:test",
    },
    commitSeq,
    storeEpoch: "epoch:test",
    operationId: `operation:document:${commitSeq}`,
    committedAt: "2026-07-19T22:00:00.000Z",
    payload,
    documentEffects: envelope.document_effects,
    canonicalHash: envelope.manifest.identity.manifest_hash,
  });
};

const updateResourceSnapshot = (
  packet: CoreAuthorizedDeliveryPacket,
  update: readonly number[] = [1, 2, 3],
) => {
  const reference = packet.document_effects[0]?.reference;
  if (!reference) throw new Error("Expected a Document effect fixture");
  return {
    contract_version: 6 as const,
    store_epoch: packet.manifest.identity.store_epoch,
    commit_head: packet.manifest.identity.commit_seq,
    value: {
      kind: "update_resource" as const,
      resource: {
        document_id: reference.document_id,
        generation: reference.generation,
        base_head_seq: reference.base_head_seq,
        head_seq: reference.result_head_seq,
        update_id: reference.update_id,
        update_hash: reference.update_hash,
        update_byte_length: update.length,
        update,
      },
    },
  };
};

const subscribeRequest = {
  documentId: "document:one",
  clientSessionId: "renderer:one",
} as const;

const activateYjsSubscription = async (
  bridge: DesktopDocumentSyncPort,
  client: FakeCoreClient,
  scope: DesktopDocumentSyncScope,
  target: FakeTarget,
  request: DocumentSyncSubscribeRequest,
  headSeq: number,
): Promise<void> => {
  client.enqueueDocumentSync({
    documentId: request.documentId,
    storeEpoch: "epoch:test",
    generation: 1,
    headSeq,
    update: new Uint8Array(),
    stateVector: new Uint8Array(),
  });
  const result = await bridge.sync(scope, target, {
    ...request,
    stateVector: new Uint8Array(),
  });
  if (!result.ok) throw new Error(`Document activation failed: ${result.error.message}`);
  target.sent.splice(0);
};

const canvasSubscribeRequest = {
  version: CANVAS_SCENE_SYNC_VERSION,
  accessContext: {
    kind: "project" as const,
    projectId: "project:canvas",
  },
  documentId: "document:canvas",
  clientSessionId: "renderer:canvas",
} as const;

const canvasSyncSnapshot = (
  syncRequestId: string,
  accessContext: typeof canvasSubscribeRequest.accessContext
    | { readonly kind: "library" } = canvasSubscribeRequest.accessContext,
) => ({
  kind: "snapshot" as const,
  version: CANVAS_SCENE_SYNC_VERSION,
  syncRequestId,
  libraryId: "library:test",
  accessContext,
  documentId: canvasSubscribeRequest.documentId,
  storeEpoch: "epoch:canvas",
  generation: 1,
  headSeq: 0,
  sceneHash: "a".repeat(64),
  scene: materializePortableCanvasScene({ elements: [] }),
});

const ownedDocumentDescriptorSnapshot = (
  accessContext: { readonly kind: "project"; readonly projectId: string }
    | { readonly kind: "library" } = {
      kind: "project",
      projectId: "project:one",
    },
) => ({
  contract_version: 7 as const,
  store_epoch: "epoch:test",
  commit_head: 2,
  authorization: authorizedReadStampFixture({
    deliveryAddress: accessContext.kind === "project"
      ? {
          kind: "project" as const,
          library_id: "library:test",
          project_id: accessContext.projectId,
        }
      : { kind: "library" as const, library_id: "library:test" },
    subject: { kind: "page", page_id: "page:one" },
    commitSeq: 2,
    storeEpoch: "epoch:test",
  }),
  value: {
    kind: "descriptor" as const,
    descriptor: {
      version: 3,
      libraryId: "library:test",
      accessContext,
      ownerBlockId: "page:one",
      ownerType: "page",
      ownerLifecycle: "active" as const,
      documentId: "document:one",
      storeEpoch: "epoch:test",
      generation: 1,
      headSeq: 1,
      schemaKey: "nodex.page",
      schemaVersion: 1,
      readiness: "ready" as const,
      sync: { kind: "yjs" as const, stateVector: [] },
    },
  },
});

const documentVersionSummary = () => ({
  versionId: `document-version:${"d".repeat(64)}`,
  documentId: "document:one",
  projectId: "project:one",
  generation: 1,
  baseHeadSeq: 1,
  schemaKey: "nodex.page",
  schemaVersion: 1,
  cause: "manual",
  label: "Bridge checkpoint",
  actor: { kind: "electron_renderer" },
  revisionKind: "manual",
  sourceMutationId: null,
  sourceChangeSeq: null,
  pinned: true,
  checkpointHash: "e".repeat(64),
  materializationHash: "f".repeat(64),
  byteLength: 64,
  materializationKind: "page",
  title: "Bridge",
  preview: "Bridge",
  blockCount: 1,
  createdAt: "2026-07-19T21:15:00.000Z",
  checkpointMetadata: { format: "block_tree_snapshot_v2" },
});

const prepareOperationId = (scope: string): string =>
  `electron:prepare-owner:${createHash("sha256")
    .update(JSON.stringify([
      scope,
      "page:one",
      "epoch:test",
      "binding:test",
    ]))
    .digest("hex")}`;

const preparedDocumentCommit = (operationId: string) => ({
  store_epoch: "epoch:test",
  event_sequence: 2,
  value: {
    document_id: "document:one",
    generation: 1,
    head_seq: 1,
    outcome: "no_change" as const,
  },
  receipt: {
    operation_id: operationId,
    duplicate: false,
    document_id: "document:one",
    generation: 1,
    head_seq: 1,
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

  test("acknowledges only an open Core stream and releases a failed opening binding", async () => {
    const client = new RejectFirstDocumentStreamClient();
    const bridge = createDesktopDocumentSyncBridge({
      authority: Promise.resolve(rustRuntime(client)),
    });
    const scope = { kind: "project", projectId: "project:one" } as const;

    await expect(bridge.subscribe(
      scope,
      new FakeTarget(1),
      subscribeRequest,
    )).resolves.toMatchObject({
      ok: false,
      error: {
        code: "transport_unavailable",
        message: "Core SSE failed to open",
        retryable: true,
      },
    });
    await expect(bridge.subscribe(
      scope,
      new FakeTarget(2),
      subscribeRequest,
    )).resolves.toEqual({ ok: true, value: { subscribed: true } });
    expect(client.attempts).toBe(2);
  });

  test("serializes duplicate subscribers across a failed opening and its replacement", async () => {
    const client = new ControlledOpeningDocumentStreamClient();
    const bridge = createDesktopDocumentSyncBridge({
      authority: Promise.resolve(rustRuntime(client)),
    });
    const scope = { kind: "project", projectId: "project:one" } as const;
    const target = new FakeTarget(1);

    const first = bridge.subscribe(scope, target, subscribeRequest);
    const second = bridge.subscribe(scope, target, subscribeRequest);
    const third = bridge.subscribe(scope, target, subscribeRequest);
    await vi.waitFor(() => {
      expect(client.openings).toHaveLength(1);
    });

    client.openings[0]?.fail(
      new CoreHttpError(401, "Core SSE failed to open"),
    );
    await expect(first).resolves.toMatchObject({
      ok: false,
      error: { code: "transport_unavailable" },
    });
    await vi.waitFor(() => {
      expect(client.openings).toHaveLength(2);
    });
    client.openings[1]?.open();

    await expect(second).resolves.toEqual({
      ok: true,
      value: { subscribed: true },
    });
    await expect(third).resolves.toEqual({
      ok: true,
      value: { subscribed: true },
    });
    expect(client.openings).toHaveLength(2);
  });

  test("keeps a reserved session outside root fanout until Core opens its barrier", async () => {
    const client = new ControlledOpeningDocumentStreamClient();
    const bridge = createDesktopDocumentSyncBridge({
      authority: Promise.resolve(rustRuntime(client)),
    });
    const target = new FakeTarget(30);
    const opening = bridge.subscribe(
      { kind: "library" },
      target,
      subscribeRequest,
    );
    await vi.waitFor(() => expect(client.openings).toHaveLength(1));

    bridge.publishDocumentEffects(documentCommitEnvelope(1, [
      subscribeRequest.documentId,
    ]));
    expect(target.sent).toHaveLength(0);

    client.openings[0]?.open();
    await expect(opening).resolves.toEqual({
      ok: true,
      value: { subscribed: true },
    });
    expect(target.sent.filter((delivery) =>
      typeof delivery.payload === "object"
      && delivery.payload !== null
      && "kind" in delivery.payload
      && delivery.payload.kind === "document-update"
    )).toHaveLength(0);
  });

  test("admits an exact session at its barrier but withholds bytes until canonical sync", async () => {
    const client = new FakeCoreClient();
    const bridge = createDesktopDocumentSyncBridge({
      authority: Promise.resolve(rustRuntime(client)),
    });
    const target = new FakeTarget(31);
    const scope = { kind: "library" } as const;
    await bridge.subscribe(scope, target, subscribeRequest);
    target.sent.splice(0);

    client.emitDocument(subscribeRequest.documentId, {
      transport_version: 8,
      packet: documentCommitEnvelope(1, [subscribeRequest.documentId]),
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(target.sent).toHaveLength(0);

    await activateYjsSubscription(
      bridge,
      client,
      scope,
      target,
      subscribeRequest,
      1,
    );
    client.emitDocument(subscribeRequest.documentId, {
      transport_version: 8,
      packet: documentCommitEnvelope(2, [subscribeRequest.documentId]),
    });
    await vi.waitFor(() => {
      expect(target.sent).toEqual([expect.objectContaining({
        payload: expect.objectContaining({
          kind: "document-update",
          headSeq: 2,
        }),
      })]);
    });
  });

  test("delivers an identity repair across the previous Yjs Store boundary", async () => {
    const client = new FakeCoreClient();
    const bridge = createDesktopDocumentSyncBridge({
      authority: Promise.resolve(rustRuntime(client)),
    });
    const target = new FakeTarget(32);
    const scope = { kind: "library" } as const;
    await bridge.subscribe(scope, target, subscribeRequest);
    await activateYjsSubscription(
      bridge,
      client,
      scope,
      target,
      subscribeRequest,
      1,
    );
    target.sent.splice(0);

    client.emitDocumentRepair(subscribeRequest.documentId, {
      document_id: subscribeRequest.documentId,
      store_epoch: "epoch:replacement",
      document_generation: 1,
      head_seq: 0,
      commit_head: 0,
      reason: "identity_changed",
    });

    await vi.waitFor(() => {
      expect(target.sent).toContainEqual(expect.objectContaining({
        payload: expect.objectContaining({
          kind: "resync-required",
          storeEpoch: "epoch:replacement",
          reason: "identity-boundary-changed",
        }),
      }));
    });
  });

  test("releases the bridge binding when an established logical stream terminates", async () => {
    const client = new TerminalDocumentStreamClient();
    const bridge = createDesktopDocumentSyncBridge({
      authority: Promise.resolve(rustRuntime(client)),
    });
    const scope = { kind: "project", projectId: "project:one" } as const;
    const owner = new FakeTarget(1);

    await expect(bridge.subscribe(scope, owner, subscribeRequest)).resolves
      .toEqual({ ok: true, value: { subscribed: true } });

    client.terminate();
    await vi.waitFor(() => {
      expect(owner.sent).toContainEqual({
        channel: "document-sync:event",
        payload: {
          kind: "connection",
          documentId: subscribeRequest.documentId,
          clientSessionId: subscribeRequest.clientSessionId,
          state: "disconnected",
        },
      });
    });

    await expect(bridge.subscribe(
      scope,
      new FakeTarget(2),
      subscribeRequest,
    )).resolves.toEqual({ ok: true, value: { subscribed: true } });
    expect(client.attempts).toBe(2);
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

  test("fans one LocalCommit out to every authorized live Document surface", async () => {
    const client = new FakeCoreClient();
    const bridge = createDesktopDocumentSyncBridge({
      authority: Promise.resolve(rustRuntime(client)),
    });
    const projectOne = new FakeTarget(1);
    const projectTwo = new FakeTarget(2);
    const library = new FakeTarget(3);
    const unrelated = new FakeTarget(4);
    await bridge.subscribe(
      { kind: "project", projectId: "project:one" },
      projectOne,
      { ...subscribeRequest, clientSessionId: "renderer:project:one" },
    );
    await bridge.subscribe(
      { kind: "project", projectId: "project:two" },
      projectTwo,
      { ...subscribeRequest, clientSessionId: "renderer:project:two" },
    );
    await bridge.subscribe(
      { kind: "library" },
      library,
      { ...subscribeRequest, clientSessionId: "renderer:library" },
    );
    await bridge.subscribe(
      { kind: "project", projectId: "project:two" },
      unrelated,
      {
        documentId: "document:unrelated",
        clientSessionId: "renderer:unrelated",
      },
    );
    await activateYjsSubscription(
      bridge,
      client,
      { kind: "project", projectId: "project:one" },
      projectOne,
      { ...subscribeRequest, clientSessionId: "renderer:project:one" },
      2,
    );
    await activateYjsSubscription(
      bridge,
      client,
      { kind: "project", projectId: "project:two" },
      projectTwo,
      { ...subscribeRequest, clientSessionId: "renderer:project:two" },
      2,
    );
    await activateYjsSubscription(
      bridge,
      client,
      { kind: "library" },
      library,
      { ...subscribeRequest, clientSessionId: "renderer:library" },
      2,
    );
    for (const target of [projectOne, projectTwo, library, unrelated]) {
      target.sent.splice(0);
    }

    bridge.publishDocumentEffects(documentCommitEnvelope(3, [
      subscribeRequest.documentId,
    ]));

    for (const target of [projectOne, projectTwo, library]) {
      expect(target.sent).toEqual([expect.objectContaining({
        channel: "document-sync:event",
        payload: expect.objectContaining({
          kind: "document-update",
          documentId: subscribeRequest.documentId,
          headSeq: 3,
          clientSessionId: "core:authorized-delivery",
        }),
      })]);
    }
    expect(unrelated.sent).toHaveLength(0);
  });

  test("revokes only the exact Project Document subscription from a root packet", async () => {
    const client = new FakeCoreClient();
    const bridge = createDesktopDocumentSyncBridge({
      authority: Promise.resolve(rustRuntime(client)),
    });
    const source = new FakeTarget(5);
    const target = new FakeTarget(6);
    const library = new FakeTarget(7);
    await bridge.subscribe(
      { kind: "project", projectId: "project:one" },
      source,
      { ...subscribeRequest, clientSessionId: "renderer:source" },
    );
    await bridge.subscribe(
      { kind: "project", projectId: "project:two" },
      target,
      { ...subscribeRequest, clientSessionId: "renderer:target" },
    );
    await bridge.subscribe(
      { kind: "library" },
      library,
      { ...subscribeRequest, clientSessionId: "renderer:library" },
    );
    await activateYjsSubscription(
      bridge,
      client,
      { kind: "project", projectId: "project:one" },
      source,
      { ...subscribeRequest, clientSessionId: "renderer:source" },
      3,
    );
    await activateYjsSubscription(
      bridge,
      client,
      { kind: "project", projectId: "project:two" },
      target,
      { ...subscribeRequest, clientSessionId: "renderer:target" },
      3,
    );
    await activateYjsSubscription(
      bridge,
      client,
      { kind: "library" },
      library,
      { ...subscribeRequest, clientSessionId: "renderer:library" },
      3,
    );
    for (const recipient of [source, target, library]) recipient.sent.splice(0);
    const revocation = {
      authorization_scope: {
        kind: "document" as const,
        library_id: "library:test",
        project_id: "project:one",
        document_id: subscribeRequest.documentId,
      },
      resource_kind: "document" as const,
      resource_id: subscribeRequest.documentId,
      reason: "access_revoked" as const,
    };
    const packet = createCoreLocalCommitFixture({
      authorizationScope: {
        kind: "library",
        library_id: "library:test",
      },
      commitSeq: 3,
      storeEpoch: "epoch:test",
      revocations: [revocation],
    });

    bridge.publishResourceRevocation(packet, revocation);

    expect(source.sent).toEqual([expect.objectContaining({
      payload: expect.objectContaining({
        kind: "resync-required",
        reason: "access-revoked",
      }),
    })]);
    expect(target.sent).toHaveLength(0);
    expect(library.sent).toHaveLength(0);

    bridge.publishDocumentEffects(documentCommitEnvelope(4, [subscribeRequest.documentId]));
    expect(source.sent).toHaveLength(1);
    expect(target.sent).toHaveLength(1);
    expect(library.sent).toHaveLength(1);
  });

  test("suppresses same-packet Document bytes before the revocation lane runs", async () => {
    const client = new FakeCoreClient();
    const bridge = createDesktopDocumentSyncBridge({
      authority: Promise.resolve(rustRuntime(client)),
    });
    const source = new FakeTarget(8);
    const target = new FakeTarget(9);
    await bridge.subscribe(
      { kind: "project", projectId: "project:one" },
      source,
      { ...subscribeRequest, clientSessionId: "renderer:source-barrier" },
    );
    await bridge.subscribe(
      { kind: "project", projectId: "project:two" },
      target,
      { ...subscribeRequest, clientSessionId: "renderer:target-barrier" },
    );
    await activateYjsSubscription(
      bridge,
      client,
      { kind: "project", projectId: "project:one" },
      source,
      { ...subscribeRequest, clientSessionId: "renderer:source-barrier" },
      3,
    );
    await activateYjsSubscription(
      bridge,
      client,
      { kind: "project", projectId: "project:two" },
      target,
      { ...subscribeRequest, clientSessionId: "renderer:target-barrier" },
      3,
    );
    source.sent.splice(0);
    target.sent.splice(0);
    const revocation = {
      authorization_scope: {
        kind: "document" as const,
        library_id: "library:test",
        project_id: "project:one",
        document_id: subscribeRequest.documentId,
      },
      resource_kind: "document" as const,
      resource_id: subscribeRequest.documentId,
      reason: "ownership_moved" as const,
    };
    const packet = {
      ...documentCommitEnvelope(4, [subscribeRequest.documentId]),
      visibility_deltas: [{
        authorization_scope: revocation.authorization_scope,
        change: {
          kind: "revoke" as const,
          reason: revocation.reason,
        },
        roots: [{
          kind: "document" as const,
          document_id: revocation.resource_id,
        }],
        delta_hash: "e".repeat(64),
      }],
    };

    bridge.publishDocumentEffects(packet);

    expect(source.sent).toHaveLength(0);
    expect(target.sent).toEqual([expect.objectContaining({
      payload: expect.objectContaining({ kind: "document-update" }),
    })]);

    bridge.publishResourceRevocation(packet, revocation);
    expect(source.sent).toEqual([expect.objectContaining({
      payload: expect.objectContaining({
        kind: "resync-required",
        reason: "access-revoked",
      }),
    })]);
  });

  test("closes an exact Document subscription recovered from its durable stream", async () => {
    const client = new FakeCoreClient();
    const bridge = createDesktopDocumentSyncBridge({
      authority: Promise.resolve(rustRuntime(client)),
    });
    const target = new FakeTarget(10);
    const scope = { kind: "project", projectId: "project:one" } as const;
    await bridge.subscribe(scope, target, subscribeRequest);
    target.sent.splice(0);
    const revocation = {
      authorization_scope: {
        kind: "document" as const,
        library_id: "library:test",
        project_id: "project:one",
        document_id: subscribeRequest.documentId,
      },
      resource_kind: "document" as const,
      resource_id: subscribeRequest.documentId,
      reason: "access_revoked" as const,
    };
    client.emitDocument(subscribeRequest.documentId, {
      transport_version: 8,
      packet: createCoreLocalCommitFixture({
        authorizationScope: revocation.authorization_scope,
        commitSeq: 5,
        storeEpoch: "epoch:test",
        revocations: [revocation],
      }),
    });

    await vi.waitFor(() => expect(target.sent).toEqual(expect.arrayContaining([
      expect.objectContaining({
        payload: expect.objectContaining({
          kind: "resync-required",
          reason: "access-revoked",
        }),
      }),
    ])));
    await expect(bridge.sync(scope, target, {
      ...subscribeRequest,
      stateVector: new Uint8Array(),
    })).resolves.toMatchObject({
      ok: false,
      error: { code: "unauthorized" },
    });
  });

  test("publishes an exact coordinator lane without replaying sibling Documents", async () => {
    const client = new FakeCoreClient();
    const bridge = createDesktopDocumentSyncBridge({
      authority: Promise.resolve(rustRuntime(client)),
    });
    const first = new FakeTarget(5);
    const second = new FakeTarget(6);
    await bridge.subscribe({ kind: "library" }, first, {
      documentId: "document:first",
      clientSessionId: "renderer:first",
    });
    await bridge.subscribe({ kind: "library" }, second, {
      documentId: "document:second",
      clientSessionId: "renderer:second",
    });
    await activateYjsSubscription(
      bridge,
      client,
      { kind: "library" },
      first,
      { documentId: "document:first", clientSessionId: "renderer:first" },
      2,
    );
    await activateYjsSubscription(
      bridge,
      client,
      { kind: "library" },
      second,
      { documentId: "document:second", clientSessionId: "renderer:second" },
      2,
    );
    first.sent.splice(0);
    second.sent.splice(0);
    const packet = documentCommitEnvelope(3, [
      "document:first",
      "document:second",
    ]);

    bridge.publishDocumentEffects(packet, "document:first");

    expect(first.sent).toHaveLength(1);
    expect(second.sent).toHaveLength(0);
  });

  test("fetches one exact ref for every surface in the same access scope", async () => {
    const client = new FakeCoreClient();
    const bridge = createDesktopDocumentSyncBridge({
      authority: Promise.resolve(rustRuntime(client)),
    });
    const first = new FakeTarget(11);
    const second = new FakeTarget(12);
    const scope = { kind: "project", projectId: "project:one" } as const;
    await bridge.subscribe(scope, first, {
      ...subscribeRequest,
      clientSessionId: "renderer:first",
    });
    await bridge.subscribe(scope, second, {
      ...subscribeRequest,
      clientSessionId: "renderer:second",
    });
    await activateYjsSubscription(
      bridge,
      client,
      scope,
      first,
      { ...subscribeRequest, clientSessionId: "renderer:first" },
      2,
    );
    await activateYjsSubscription(
      bridge,
      client,
      scope,
      second,
      { ...subscribeRequest, clientSessionId: "renderer:second" },
      2,
    );
    first.sent.splice(0);
    second.sent.splice(0);
    const packet = documentCommitEnvelope(
      3,
      [subscribeRequest.documentId],
      { inline: false },
    );
    client.enqueueDocumentRead(updateResourceSnapshot(packet));

    bridge.publishDocumentEffects(packet);

    await vi.waitFor(() => {
      expect(first.sent).toHaveLength(1);
      expect(second.sent).toHaveLength(1);
    });
    for (const target of [first, second]) {
      expect(target.sent[0]?.payload).toMatchObject({
        kind: "document-update",
        documentId: subscribeRequest.documentId,
        headSeq: 3,
        update: Uint8Array.from([1, 2, 3]),
      });
    }
    expect(client.documentReads).toHaveLength(1);
  });

  test("repairs an unavailable exact ref through typed snapshot resync", async () => {
    const client = new FakeCoreClient();
    const bridge = createDesktopDocumentSyncBridge({
      authority: Promise.resolve(rustRuntime(client)),
    });
    const target = new FakeTarget(13);
    await bridge.subscribe({ kind: "library" }, target, subscribeRequest);
    target.sent.splice(0);
    const packet = documentCommitEnvelope(
      4,
      [subscribeRequest.documentId],
      { inline: false },
    );
    const reference = packet.document_effects[0]?.reference;
    if (!reference) throw new Error("Expected a Document effect fixture");
    client.enqueueDocumentRead({
      contract_version: 6,
      store_epoch: "epoch:test",
      commit_head: 4,
      value: {
        kind: "update_resource_unavailable",
        unavailable: {
          document_id: reference.document_id,
          requested_generation: reference.generation,
          current_generation: reference.generation,
          current_head_seq: reference.result_head_seq,
          update_id: reference.update_id,
          update_hash: reference.update_hash,
          reason: "compacted",
        },
      },
    });

    bridge.publishDocumentEffects(packet);

    await vi.waitFor(() => expect(target.sent).toHaveLength(1));
    expect(target.sent[0]?.payload).toMatchObject({
      kind: "resync-required",
      reason: "history-compacted",
      generation: 1,
      headSeq: 4,
    });
  });

  test("fails closed when fetched or inline bytes violate their exact ref", async () => {
    const client = new FakeCoreClient();
    const bridge = createDesktopDocumentSyncBridge({
      authority: Promise.resolve(rustRuntime(client)),
    });
    const target = new FakeTarget(14);
    await bridge.subscribe({ kind: "library" }, target, subscribeRequest);
    target.sent.splice(0);
    const fetchedPacket = documentCommitEnvelope(
      5,
      [subscribeRequest.documentId],
      { inline: false },
    );
    client.enqueueDocumentRead(updateResourceSnapshot(
      fetchedPacket,
      [9, 9, 9],
    ));

    bridge.publishDocumentEffects(fetchedPacket);

    await vi.waitFor(() => expect(target.sent).toHaveLength(1));
    expect(target.sent[0]?.payload).toMatchObject({
      kind: "resync-required",
      reason: "resource-integrity-failure",
    });

    const inlineBridge = createDesktopDocumentSyncBridge({
      authority: Promise.resolve(rustRuntime(new FakeCoreClient())),
    });
    const inlineTarget = new FakeTarget(15);
    await inlineBridge.subscribe(
      { kind: "library" },
      inlineTarget,
      { ...subscribeRequest, clientSessionId: "renderer:inline-integrity" },
    );
    inlineTarget.sent.splice(0);
    const inlinePacket = documentCommitEnvelope(6, [subscribeRequest.documentId]);
    const inlineEffect = inlinePacket.document_effects[0];
    if (!inlineEffect) throw new Error("Expected a Document effect fixture");
    inlineBridge.publishDocumentEffects({
      ...inlinePacket,
      document_effects: [{
        ...inlineEffect,
        reference: {
          ...inlineEffect.reference,
          update_hash: "0".repeat(64),
        },
      }],
    });
    expect(inlineTarget.sent[0]?.payload).toMatchObject({
      kind: "resync-required",
      reason: "resource-integrity-failure",
    });
  });

  test("deduplicates an apply fast path replayed by the durable stream", async () => {
    const client = new FakeCoreClient();
    const bridge = createDesktopDocumentSyncBridge({
      authority: Promise.resolve(rustRuntime(client)),
    });
    const target = new FakeTarget(1);
    await bridge.subscribe(
      { kind: "library" },
      target,
      subscribeRequest,
    );
    await activateYjsSubscription(
      bridge,
      client,
      { kind: "library" },
      target,
      subscribeRequest,
      3,
    );
    target.sent.splice(0);

    const envelope = documentCommitEnvelope(4, [subscribeRequest.documentId]);
    bridge.publishDocumentEffects(envelope);
    bridge.publishDocumentEffects(envelope);

    expect(target.sent).toHaveLength(1);
  });

  test("publishes the admitted apply envelope once before the tailer replay", async () => {
    const client = new FakeCoreClient();
    const bridge = createDesktopDocumentSyncBridge({
      authority: Promise.resolve(rustRuntime(client)),
    });
    const target = new FakeTarget(2);
    await bridge.subscribe(
      { kind: "library" },
      target,
      subscribeRequest,
    );
    await activateYjsSubscription(
      bridge,
      client,
      { kind: "library" },
      target,
      subscribeRequest,
      5,
    );
    target.sent.splice(0);

    const coordinator = new LocalCommitCoordinator({
      expectedLibraryId: "library:test",
      expectedStoreEpoch: "epoch:test",
      onDocument: (packet) => bridge.publishDocumentEffects(packet),
      onProjection: () => undefined,
      onNotification: () => undefined,
      onVisibility: () => undefined,
    });
    const envelope = documentCommitEnvelope(6, [subscribeRequest.documentId]);

    expect(coordinator.admit(envelope, "apply").kind).toBe("accepted");
    expect(coordinator.admit(envelope, "tailer").kind).toBe("duplicate");
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(target.sent.filter((delivery) =>
      typeof delivery.payload === "object"
      && delivery.payload !== null
      && "kind" in delivery.payload
      && delivery.payload.kind === "document-update"
    )).toHaveLength(1);
  });

  test("turns a compacted Document effect into a history resync", async () => {
    const bridge = createDesktopDocumentSyncBridge({
      authority: Promise.resolve(rustRuntime(new FakeCoreClient())),
    });
    const target = new FakeTarget(1);
    await bridge.subscribe(
      { kind: "library" },
      target,
      subscribeRequest,
    );
    target.sent.splice(0);

    bridge.publishDocumentEffects(compactedDocumentCommitEnvelope(
      5,
      subscribeRequest.documentId,
    ));

    expect(target.sent).toEqual([expect.objectContaining({
      channel: "document-sync:event",
      payload: expect.objectContaining({
        kind: "resync-required",
        documentId: subscribeRequest.documentId,
        generation: 1,
        headSeq: 5,
        reason: "history-compacted",
      }),
    })]);
  });

  test("buffers out-of-order local Document effects until the durable head is contiguous", async () => {
    const client = new FakeCoreClient();
    client.enqueueDocumentSync({
      documentId: subscribeRequest.documentId,
      storeEpoch: "epoch:test",
      generation: 1,
      headSeq: 1,
      update: new Uint8Array(),
      stateVector: new Uint8Array(),
    });
    const bridge = createDesktopDocumentSyncBridge({
      authority: Promise.resolve(rustRuntime(client)),
    });
    const target = new FakeTarget(1);
    const scope = { kind: "library" } as const;
    await bridge.subscribe(scope, target, subscribeRequest);
    await bridge.sync(scope, target, {
      ...subscribeRequest,
      stateVector: new Uint8Array(),
    });
    target.sent.splice(0);

    bridge.publishDocumentEffects(documentCommitEnvelope(3, [subscribeRequest.documentId]));
    expect(target.sent).toHaveLength(0);

    bridge.publishDocumentEffects(documentCommitEnvelope(2, [subscribeRequest.documentId]));
    expect(target.sent.map((delivery) =>
      (delivery.payload as { readonly headSeq: number }).headSeq,
    )).toEqual([2, 3]);
  });

  test("reads and prepares Project and Library owners through their exact clients", async () => {
    const rootClient = new FakeCoreClient();
    const projectClient = new FakeCoreClient();
    const bridge = createDesktopDocumentSyncBridge({
      authority: Promise.resolve(rustRuntime(rootClient, projectClient)),
    });
    projectClient.enqueueDocumentRead(ownedDocumentDescriptorSnapshot());

    await expect(bridge.getOwnedDocumentDescriptor(
      "project:one",
      "page:one",
    )).resolves.toMatchObject({
      libraryId: "library:test",
      accessContext: { kind: "project", projectId: "project:one" },
      ownerBlockId: "page:one",
      documentId: "document:one",
    });

    projectClient.enqueueDocumentApply(preparedDocumentCommit(
      prepareOperationId("project:project:one"),
    ));
    projectClient.enqueueDocumentRead(ownedDocumentDescriptorSnapshot());
    await expect(bridge.prepareOwnedBlockDocument(
      "project:one",
      "page:one",
    )).resolves.toMatchObject({
      ok: true,
      value: {
        accessContext: { kind: "project", projectId: "project:one" },
        documentId: "document:one",
      },
    });
    expect(rootClient.documentApplies).toHaveLength(0);
    expect(projectClient.documentApplies[0]).toMatchObject({
      clientSessionId: "electron:owned-document:prepare",
      intent: { kind: "prepare_owner", owner_block_id: "page:one" },
    });
    expect(projectClient.documentApplies[0]?.operationId).toMatch(
      /^electron:prepare-owner:[a-f0-9]{64}$/u,
    );

    rootClient.enqueueDocumentApply(preparedDocumentCommit(
      prepareOperationId("library"),
    ));
    rootClient.enqueueDocumentRead(ownedDocumentDescriptorSnapshot({
      kind: "library",
    }));
    const libraryPrepared = await bridge.prepareLibraryOwnedBlockDocument(
      "page:one",
    );
    expect(libraryPrepared).toEqual({
      ok: true,
      value: expect.objectContaining({
        accessContext: { kind: "library" },
        ownerBlockId: "page:one",
        documentId: "document:one",
      }),
    });
    if (!libraryPrepared.ok) throw new Error("Expected Library preparation");
    expect("projectId" in libraryPrepared.value).toBe(false);
    expect(rootClient.documentApplies).toHaveLength(1);
  });

  test("routes Additional Document commands through the exact Project authority", async () => {
    const rootClient = new FakeCoreClient();
    const projectClient = new FakeCoreClient();
    const bridge = createDesktopDocumentSyncBridge({
      authority: Promise.resolve(rustRuntime(rootClient, projectClient)),
    });
    projectClient.enqueueDocumentApply({
      store_epoch: "epoch:test",
      event_sequence: 8,
      value: {
        document_id: "document:source",
        generation: 1,
        head_seq: 1,
        outcome: "committed",
        committed_at: "2026-07-19T21:05:00.000Z",
        owner_effect: {
          created_block_ids: ["block:source", "block:content"],
          preserved_block_ids: [],
          deleted_block_ids: [],
          document_heads: [{
            document_id: "document:source",
            generation: 1,
            head_seq: 1,
          }],
        },
      },
      receipt: {
        operation_id: "owner:create",
        duplicate: false,
        document_id: "document:source",
        generation: 1,
        head_seq: 1,
      },
    });

    await expect(bridge.applyAdditionalDocumentCommand({
      version: 2,
      operationId: "owner:create",
      projectId: "project:one",
      storeEpoch: "epoch:test",
      clientSessionId: "renderer:one",
      actor: { kind: "electron_renderer" },
      coordination: { kind: "fifo_only" },
      operation: {
        kind: "create_synced_source",
        sourceBlockId: "block:source",
        documentId: "document:source",
        initialBlocks: [{
          id: "block:content",
          type: "paragraph",
          props: {},
          children: [],
        }],
        placement: { kind: "library" },
      },
    })).resolves.toMatchObject({
      ok: true,
      value: { operationId: "owner:create", projectId: "project:one" },
    });
    expect(rootClient.documentApplies).toHaveLength(0);
    expect(projectClient.documentApplies).toHaveLength(1);
  });

  test("routes Document history reads through the exact Project authority", async () => {
    const rootClient = new FakeCoreClient();
    const projectClient = new FakeCoreClient();
    const bridge = createDesktopDocumentSyncBridge({
      authority: Promise.resolve(rustRuntime(rootClient, projectClient)),
    });
    projectClient.enqueueDocumentRead({
      contract_version: 1,
      store_epoch: "epoch:test",
      commit_head: 4,
      value: {
        kind: "versions",
        items: [documentVersionSummary()],
        next: null,
      },
    });

    await expect(bridge.listVersions({
      projectId: "project:one",
      documentId: "document:one",
      limit: 20,
    })).resolves.toEqual({ ok: true, value: [documentVersionSummary()] });
    expect(rootClient.documentReads).toHaveLength(0);
    expect(projectClient.documentReads).toEqual([{
      clientSessionId: "electron:document-history",
      read: {
        kind: "list_versions",
        document_id: "document:one",
        before: undefined,
        limit: 20,
      },
    }]);
  });

  test("commits a destructive Document mutation at the exact local head", async () => {
    const rootClient = new FakeCoreClient();
    const projectClient = new FakeCoreClient();
    const request = {
      version: 1 as const,
      mutationId: "restore:native",
      projectId: "project:one",
      storeEpoch: "epoch:test",
      documentId: subscribeRequest.documentId,
      versionId: documentVersionSummary().versionId,
      generation: 1,
      expectedHeadSeq: 2,
      clientSessionId: subscribeRequest.clientSessionId,
      actor: { kind: "electron_renderer" },
    };
    projectClient.enqueueDocumentApply({
      store_epoch: request.storeEpoch,
      event_sequence: 9,
      value: {
        document_id: request.documentId,
        generation: 1,
        head_seq: 3,
        outcome: "committed",
        committed_at: "2026-07-19T21:18:00.000Z",
        mutation_effect: {
          base_head_seq: 2,
          touched_block_ids: ["page:one"],
          created_block_ids: [],
          deleted_block_ids: [],
          updated_block_ids: [],
          moved_block_ids: [],
          write_fence_block_ids: ["page:one"],
          title_changed: true,
          coordination: "write_fence",
        },
      },
      receipt: {
        operation_id: request.mutationId,
        duplicate: false,
        document_id: request.documentId,
        generation: 1,
        head_seq: 3,
      },
    });
    const bridge = createDesktopDocumentSyncBridge({
      authority: Promise.resolve(rustRuntime(rootClient, projectClient)),
    });

    await expect(bridge.restoreVersion(request)).resolves.toMatchObject({
      ok: true,
      value: {
        mutationId: request.mutationId,
        baseHeadSeq: 2,
        headSeq: 3,
        coordination: "write_fence",
        duplicate: false,
      },
    });
    expect(projectClient.documentApplies).toHaveLength(1);
    expect(projectClient.documentApplies[0]?.intent).toMatchObject({
      kind: "restore_version",
      document_id: request.documentId,
      expected_head_seq: 2,
    });
    expect(projectClient.documentApplies[0]?.intent).not.toHaveProperty(
      "write_fence_prepared",
    );
  });

  test("commits a merge-friendly public Document operation without a lease", async () => {
    const rootClient = new FakeCoreClient();
    const projectClient = new FakeCoreClient();
    const request = {
      version: 1 as const,
      mutationId: "document-operation:merge-friendly",
      projectId: "project:one",
      storeEpoch: "epoch:test",
      documentId: subscribeRequest.documentId,
      generation: 1,
      expectedHeadSeq: 2,
      clientSessionId: subscribeRequest.clientSessionId,
      actor: { kind: "electron_renderer" },
      operations: [{
        kind: "insert_block" as const,
        block: {
          id: "block:inserted",
          type: "paragraph",
          props: {},
          content: [],
          children: [],
        },
      }],
    };
    projectClient.enqueueDocumentApply({
      store_epoch: request.storeEpoch,
      event_sequence: 9,
      value: {
        document_id: request.documentId,
        generation: 1,
        head_seq: 3,
        outcome: "committed",
        committed_at: "2026-07-19T21:18:00.000Z",
        mutation_effect: {
          base_head_seq: 2,
          touched_block_ids: ["block:inserted"],
          created_block_ids: ["block:inserted"],
          deleted_block_ids: [],
          updated_block_ids: [],
          moved_block_ids: [],
          write_fence_block_ids: [],
          title_changed: false,
          coordination: "merge_friendly",
        },
      },
      receipt: {
        operation_id: request.mutationId,
        duplicate: false,
        document_id: request.documentId,
        generation: 1,
        head_seq: 3,
      },
    });
    const bridge = createDesktopDocumentSyncBridge({
      authority: Promise.resolve(rustRuntime(rootClient, projectClient)),
    });

    await expect(bridge.applyDocumentMutation(request)).resolves.toMatchObject({
      ok: true,
      value: {
        mutationKind: "document_operation_batch",
        coordination: "merge_friendly",
      },
    });
    expect(projectClient.documentApplies).toHaveLength(1);
    expect(projectClient.documentApplies[0]?.intent).toMatchObject({
      kind: "apply_operation_batch",
    });
  });

  test("publishes one transfer LocalCommit to every subscribed Document", async () => {
    const rootClient = new FakeCoreClient();
    const projectClient = new FakeCoreClient();
    const transferIntent: BlockTransferIntent = {
      version: BLOCK_TRANSFER_INTENT_CONTRACT_VERSION,
      operationId: "transfer:native",
      projectId: "project:one",
      storeEpoch: "epoch:test",
      clientSessionId: "renderer:source",
      actor: { kind: "electron_renderer", clientId: "renderer:source" },
      mode: "move",
      rootBlockIds: ["block:root"],
      causalDependencies: [],
      source: { kind: "page", pageId: "page:source" },
      target: { kind: "page", pageId: "page:target" },
    };
    const transferResult = {
      mode: "move" as const,
      source_root_block_ids: ["block:root"],
      result_root_block_ids: ["block:root"],
      copied_block_ids: {},
      transformation_evidence: [],
      final_locations: {
        "block:root": {
          kind: "document" as const,
          document_id: "document:target",
        },
      },
      final_location_revisions: { "block:root": 2 },
      document_commits: [{
        document_id: "document:source",
        generation: 1,
        base_head_seq: 2,
        head_seq: 3,
        update_id: "update:source",
        update: [1, 2],
        state_vector: [3],
      }, {
        document_id: "document:target",
        generation: 1,
        base_head_seq: 5,
        head_seq: 6,
        update_id: "update:target",
        update: [4, 5],
        state_vector: [6],
      }],
      affected_database_ids: [],
      page_etags: {},
      move_etags: {},
      page_view_placements: {},
    };
    projectClient.enqueueApply({
      store_epoch: "epoch:test",
      event_sequence: 9,
      value: {
        affected_resource_ids: ["block:root"],
        page_copy: null,
        block_transfer: transferResult,
      },
      receipt: {
        operation_id: transferIntent.operationId,
        duplicate: false,
        operation_kind: "transfer_blocks",
        did_mutate: true,
        created_target: null,
        affected_parent_keys: [],
        affected_page_ids: [],
        affected_database_ids: [],
        affected_view_ids: [],
        committed_revisions: { "block:root": 2 },
        commit_seq: 9,
        committed_at: "2026-07-19T22:00:00.000Z",
      },
    });
    const bridge = createDesktopDocumentSyncBridge({
      authority: Promise.resolve(rustRuntime(rootClient, projectClient)),
    });
    const sourceTarget = new FakeTarget(11);
    const targetTarget = new FakeTarget(12);
    const scope = { kind: "project", projectId: "project:one" } as const;
    await bridge.subscribe(scope, sourceTarget, {
      documentId: "document:source",
      clientSessionId: "renderer:source",
    });
    await bridge.subscribe(scope, targetTarget, {
      documentId: "document:target",
      clientSessionId: "renderer:target",
    });
    await activateYjsSubscription(
      bridge,
      projectClient,
      scope,
      sourceTarget,
      { documentId: "document:source", clientSessionId: "renderer:source" },
      8,
    );
    await activateYjsSubscription(
      bridge,
      projectClient,
      scope,
      targetTarget,
      { documentId: "document:target", clientSessionId: "renderer:target" },
      8,
    );

    const result = await bridge.transferBlocks(transferIntent);
    if (!result.ok) throw new Error(JSON.stringify(result.error));
    expect(result).toMatchObject({
      ok: true,
      value: {
        operationId: transferIntent.operationId,
        finalLocationRevisions: { "block:root": 2 },
      },
    });
    expect(projectClient.reads).toHaveLength(0);
    expect(projectClient.applies[0]).toMatchObject({
      operationId: transferIntent.operationId,
      intent: {
        kind: "transfer_blocks",
        intent: { root_block_ids: ["block:root"] },
      },
    });
    bridge.publishDocumentEffects(documentCommitEnvelope(9, [
      "document:source",
      "document:target",
    ]));
    for (const target of [sourceTarget, targetTarget]) {
      expect(target.sent.some((delivery) =>
        typeof delivery.payload === "object"
        && delivery.payload !== null
        && "kind" in delivery.payload
        && delivery.payload.kind === "document-update"
      )).toBe(true);
      expect(target.sent.some((delivery) =>
        typeof delivery.payload === "object"
        && delivery.payload !== null
        && "kind" in delivery.payload
        && delivery.payload.kind === "relocation-lease-release"
      )).toBe(false);
    }
  });

  test("publishes a native Agent LocalCommit through the same bridge", async () => {
    const rootClient = new FakeCoreClient();
    const projectClient = new FakeCoreClient();
    const bridge = createDesktopDocumentSyncBridge({
      authority: Promise.resolve(rustRuntime(rootClient, projectClient)),
    });
    const target = new FakeTarget(21);
    const scope = { kind: "project", projectId: "project:one" } as const;
    await bridge.subscribe(scope, target, {
      documentId: "document:agent-target",
      clientSessionId: "renderer:agent-target",
    });
    await activateYjsSubscription(
      bridge,
      projectClient,
      scope,
      target,
      {
        documentId: "document:agent-target",
        clientSessionId: "renderer:agent-target",
      },
      13,
    );
    const execute = vi.fn(async (): Promise<ExecuteNodexAgentDuplicatePageResult> => ({
      ok: true,
      value: {
        output: DuplicatePageV3OutputSchema.parse({
          data: {
            sourcePageId: "page:source",
            pageId: "page:copy",
            location: { kind: "page", pageId: "page:target" },
            bodyBlocksCreated: 1,
          },
        }),
        duplicate: false,
        documentCommits: [{
          documentId: "document:agent-target",
          generation: 2,
          baseHeadSeq: 7,
          headSeq: 8,
          updateId: "update:agent-copy",
          update: new Uint8Array([1, 2, 3]),
          stateVector: new Uint8Array([4, 5]),
        }],
        affectedDatabaseBlockIds: [],
        commitSeq: 14,
      },
    }));

    const result = await bridge.executeNodexAgentMutation({
      projectId: "project:one",
      storeEpoch: "epoch:test",
      execute,
      failure: (message) => ({
        ok: false,
        error: {
          code: "internal_error",
          message,
          retryable: false,
          recovery: "none",
        },
      }),
      operationLabel: "Agent Page duplicate",
      conflictMessage: "Destination changed",
    });
    expect(result).toMatchObject({ ok: true, value: { commitSeq: 14 } });
    expect(execute).toHaveBeenCalledOnce();
    bridge.publishDocumentEffects(documentCommitEnvelope(14, [
      "document:agent-target",
    ]));
    expect(target.sent.some((delivery) =>
      typeof delivery.payload === "object"
      && delivery.payload !== null
      && "kind" in delivery.payload
      && delivery.payload.kind === "document-update"
    )).toBe(true);
  });

  test("acknowledges Canvas only after its Core stream opens and releases a failed binding", async () => {
    const client = new RejectFirstDocumentStreamClient();
    const bridge = createDesktopDocumentSyncBridge({
      authority: Promise.resolve(rustRuntime(client)),
    });

    await expect(bridge.subscribeCanvasScene(
      new FakeTarget(1),
      canvasSubscribeRequest,
    )).resolves.toMatchObject({
      ok: false,
      error: {
        code: "unknown",
        message: "Core SSE failed to open",
        retryable: true,
      },
    });
    await expect(bridge.subscribeCanvasScene(
      new FakeTarget(2),
      canvasSubscribeRequest,
    )).resolves.toEqual({ ok: true, value: { subscribed: true } });
    expect(client.attempts).toBe(2);
  });

  test("binds Canvas sync to its Project client, engine, and exact target", async () => {
    const rootClient = new FakeCoreClient();
    const projectClient = new FakeCoreClient();
    projectClient.enqueueDocumentCanvasSync(canvasSyncSnapshot("sync:canvas"));
    const bridge = createDesktopDocumentSyncBridge({
      authority: Promise.resolve(rustRuntime(rootClient, projectClient)),
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
      error: { code: "access_scope_mismatch" },
    });

    await expect(bridge.subscribeCanvasScene(
      canvasTarget,
      canvasSubscribeRequest,
    )).resolves.toEqual({ ok: true, value: { subscribed: true } });
    await expect(bridge.syncCanvasScene(
      otherTarget,
      { ...canvasSubscribeRequest, syncRequestId: "sync:foreign" },
    )).resolves.toMatchObject({
      ok: false,
      error: { code: "access_scope_mismatch" },
    });
    await expect(bridge.syncCanvasScene(
      canvasTarget,
      { ...canvasSubscribeRequest, syncRequestId: "sync:canvas" },
    )).resolves.toMatchObject({
      ok: true,
      value: {
        libraryId: "library:test",
        accessContext: canvasSubscribeRequest.accessContext,
        documentId: canvasSubscribeRequest.documentId,
        headSeq: 0,
        kind: "snapshot",
      },
    });
    expect(rootClient.documentReads).toHaveLength(0);
    expect(projectClient.documentReads).toHaveLength(0);
    expect(projectClient.documentCanvasSyncs).toEqual([{
      ...canvasSubscribeRequest,
      syncRequestId: "sync:canvas",
    }]);
  });

  test("binds Library Canvas sync directly to Library authority", async () => {
    const rootClient = new FakeCoreClient();
    const projectClient = new FakeCoreClient();
    const accessContext = { kind: "library" } as const;
    const request = {
      ...canvasSubscribeRequest,
      accessContext,
      clientSessionId: "renderer:library-canvas",
    };
    rootClient.enqueueDocumentCanvasSync(
      canvasSyncSnapshot("sync:library-canvas", accessContext),
    );
    const bridge = createDesktopDocumentSyncBridge({
      authority: Promise.resolve(rustRuntime(rootClient, projectClient)),
    });
    const target = new FakeTarget(31);

    await expect(bridge.subscribeCanvasScene(new FakeTarget(30), {
      ...request,
      accessContext: { kind: "forged" } as never,
    })).resolves.toMatchObject({
      ok: false,
      error: { code: "access_scope_mismatch" },
    });
    await expect(bridge.subscribeCanvasScene(target, request)).resolves.toEqual({
      ok: true,
      value: { subscribed: true },
    });
    await expect(bridge.syncCanvasScene(target, {
      ...request,
      syncRequestId: "sync:library-canvas",
    })).resolves.toMatchObject({
      ok: true,
      value: {
        libraryId: "library:test",
        accessContext,
        documentId: request.documentId,
      },
    });
    expect(rootClient.documentCanvasSyncs).toEqual([{
      ...request,
      syncRequestId: "sync:library-canvas",
    }]);
    expect(projectClient.documentCanvasSyncs).toHaveLength(0);
  });

  test("delivers an identity repair across the previous Canvas Store boundary", async () => {
    const projectClient = new FakeCoreClient();
    projectClient.enqueueDocumentCanvasSync(canvasSyncSnapshot("sync:identity"));
    const bridge = createDesktopDocumentSyncBridge({
      authority: Promise.resolve(rustRuntime(new FakeCoreClient(), projectClient)),
    });
    const target = new FakeTarget(4);
    await bridge.subscribeCanvasScene(target, canvasSubscribeRequest);
    await bridge.syncCanvasScene(target, {
      ...canvasSubscribeRequest,
      syncRequestId: "sync:identity",
    });
    target.sent.splice(0);

    projectClient.emitDocumentRepair(canvasSubscribeRequest.documentId, {
      document_id: canvasSubscribeRequest.documentId,
      store_epoch: "epoch:replacement",
      document_generation: 1,
      head_seq: 0,
      commit_head: 0,
      reason: "identity_changed",
    });

    await vi.waitFor(() => {
      expect(target.sent).toContainEqual(expect.objectContaining({
        payload: expect.objectContaining({
          type: "canvas_scene_resync_required",
          storeEpoch: "epoch:replacement",
        }),
      }));
    });
  });

  test("binds ephemeral Canvas presence to the exact Host target without Core writes", async () => {
    const projectClient = new FakeCoreClient();
    const requestA = {
      ...canvasSubscribeRequest,
      clientSessionId: "renderer:presence:a",
    };
    const requestB = {
      ...canvasSubscribeRequest,
      clientSessionId: "renderer:presence:b",
    };
    projectClient.enqueueDocumentCanvasSync({
      ...canvasSyncSnapshot("sync:presence:a"),
      syncRequestId: "sync:presence:a",
    });
    projectClient.enqueueDocumentCanvasSync({
      ...canvasSyncSnapshot("sync:presence:b"),
      syncRequestId: "sync:presence:b",
    });
    const bridge = createDesktopDocumentSyncBridge({
      authority: Promise.resolve(
        rustRuntime(new FakeCoreClient(), projectClient),
      ),
    });
    const targetA = new FakeTarget(41);
    const targetB = new FakeTarget(42);
    await bridge.subscribeCanvasScene(targetA, requestA);
    await bridge.subscribeCanvasScene(targetB, requestB);
    await bridge.syncCanvasScene(targetA, {
      ...requestA,
      syncRequestId: "sync:presence:a",
    });
    await bridge.syncCanvasScene(targetB, {
      ...requestB,
      syncRequestId: "sync:presence:b",
    });
    targetA.sent.splice(0);
    targetB.sent.splice(0);
    const coreSyncCount = projectClient.documentCanvasSyncs.length;
    const coreApplyCount = projectClient.documentApplies.length;

    await expect(bridge.publishCanvasPresence(targetA, {
      accessContext: requestA.accessContext,
      clientSessionId: requestA.clientSessionId,
      publication: {
        version: 1,
        engine: "canvas_scene",
        documentId: requestA.documentId,
        generation: 1,
        clock: 1,
        state: {
          pointer: {
            x: 20,
            y: 30,
            button: "up",
            tool: "pointer",
          },
          selectedElementIds: [],
          idle: "active",
        },
      },
    })).resolves.toEqual({
      ok: true,
      value: { accepted: true, applied: true },
    });
    expect(targetA.sent).toHaveLength(0);
    expect(targetB.sent.at(-1)?.payload).toMatchObject({
      type: "canvas_presence_updated",
      presence: {
        clientSessionId: requestA.clientSessionId,
        user: {
          id: "window:41",
          displayName: "Window 41",
        },
        state: { pointer: { x: 20, y: 30 } },
      },
    });
    expect(projectClient.documentCanvasSyncs).toHaveLength(coreSyncCount);
    expect(projectClient.documentApplies).toHaveLength(coreApplyCount);

    await bridge.unsubscribeCanvasScene(targetA, requestA);
    expect(targetB.sent.at(-1)?.payload).toMatchObject({
      type: "canvas_presence_updated",
      presence: {
        clientSessionId: requestA.clientSessionId,
        clock: 1,
        state: null,
      },
    });
  });

  test("commits Canvas maintenance directly through Core", async () => {
    const projectClient = new FakeCoreClient();
    const storeEpoch = "epoch:canvas";
    Object.assign(projectClient, {
      handshake: createFakeCoreHandshake({
        connectionBinding: "binding:canvas",
        libraryId: "library:test",
        profileId: "profile:test",
        storeEpoch,
      }),
    });
    projectClient.enqueueDocumentRead({
      contract_version: 3,
      store_epoch: storeEpoch,
      commit_head: 3,
      value: {
        kind: "canvas_compaction_eligibility",
        stats: {
          document_id: canvasSubscribeRequest.documentId,
          generation: 1,
          head_seq: 8,
          scene_hash: "a".repeat(64),
          tombstone_count: 2,
          tombstone_bytes: 200,
          eligible: true,
        },
      },
    });
    const operationId = "canvas-compaction:bridge";
    const compactionValue = {
      version: CANVAS_SCENE_MAINTENANCE_VERSION,
      kind: "tombstone_compaction" as const,
      operationId,
      libraryId: "library:test",
      accessContext: canvasSubscribeRequest.accessContext,
      documentId: canvasSubscribeRequest.documentId,
      storeEpoch,
      previousGeneration: 1,
      previousHeadSeq: 8,
      generation: 2,
      headSeq: 1,
      duplicate: false,
      outcome: "committed" as const,
      sceneHash: "b".repeat(64),
      removedTombstoneCount: 2,
      removedTombstoneBytes: 200,
      checkpointVersionId: "version:canvas-compaction",
      committedAt: "2026-07-29T00:00:00.000Z",
    };
    projectClient.enqueueDocumentApply({
      store_epoch: storeEpoch,
      event_sequence: 4,
      value: {
        document_id: canvasSubscribeRequest.documentId,
        generation: 2,
        head_seq: 1,
        outcome: "committed",
        canvas: compactionValue,
      },
      receipt: {
        operation_id: operationId,
        duplicate: false,
        document_id: canvasSubscribeRequest.documentId,
        generation: 2,
        head_seq: 1,
      },
    });
    const bridge = createDesktopDocumentSyncBridge({
      authority: Promise.resolve(rustRuntime(new FakeCoreClient(), projectClient)),
    });
    const target = new FakeTarget(20);
    await expect(
      bridge.subscribeCanvasScene(target, canvasSubscribeRequest),
    ).resolves.toEqual({ ok: true, value: { subscribed: true } });
    const result = await bridge.compactCanvasScene(target, {
      ...canvasSubscribeRequest,
      version: CANVAS_SCENE_MAINTENANCE_VERSION,
      mutationId: operationId,
      trigger: "automatic_idle",
    });
    expect(result).toEqual({
      ok: true,
      value: compactionValue,
      localCommit: committedLocalCommit(storeEpoch, 4),
    });
    expect(projectClient.documentApplies[0]?.intent).toMatchObject({
      kind: "compact_canvas_tombstones",
    });
  });

  test("does not open a late subscription for a destroyed startup target", async () => {
    let resolveAuthority: ((runtime: RustDataAuthorityRuntime) => void) | undefined;
    const authority = new Promise<RustDataAuthorityRuntime>((resolve) => {
      resolveAuthority = resolve;
    });
    const client = new FakeCoreClient();
    const bridge = createDesktopDocumentSyncBridge({
      authority,
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
