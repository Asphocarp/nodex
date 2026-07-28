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
import type { DocumentSyncClientTarget } from "../document-sync-transport";
import type { ExecuteNodexAgentDuplicatePageResult } from "../../shared/nodex-agent-tools";
import { DuplicatePageV3OutputSchema } from "../../shared/nodex-agent-tools/v3-write-schemas";
import { CoreModuleResponseError } from "./core-client";
import {
  createDesktopDocumentSyncBridge,
} from "./desktop-document-sync-bridge";
import type { RustDataAuthorityRuntime } from "./desktop-data-authority";
import {
  createFakeCoreHandshake,
  FakeCoreClient,
} from "./testing/fake-core-client";
import {
  CoreEventCompatibilityError,
  CoreHttpError,
} from "./uds-http";

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
  ): ReturnType<FakeCoreClient["openDocumentEventStream"]> {
    let resolveOpening: (subscription: {
      readonly done: Promise<void>;
      close(): void;
    }) => void = () => undefined;
    let rejectOpening: (error: unknown) => void = () => undefined;
    const opening = new Promise<{
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
        resolveOpening({ done, close: resolveDone });
      },
      fail: rejectOpening,
    });
    return opening;
  }
}

class CanvasCompactionFenceClient extends FakeCoreClient {
  compactionAttempts = 0;

  override documentApply(
    ...args: Parameters<FakeCoreClient["documentApply"]>
  ): ReturnType<FakeCoreClient["documentApply"]> {
    if (args[0].intent.kind === "compact_canvas_tombstones") {
      this.compactionAttempts += 1;
      if (this.compactionAttempts === 1) {
        throw new CoreModuleResponseError({
          code: "revision_conflict",
          message: "Canvas compaction requires a write fence",
          retryable: true,
          recovery: { kind: "none" },
        });
      }
    }
    return super.documentApply(...args);
  }
}

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
    rootClient,
    clientForProject: () => projectClient,
  } as unknown as RustDataAuthorityRuntime;
};

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

const canvasSyncSnapshot = (syncRequestId: string) => ({
  kind: "snapshot" as const,
  version: CANVAS_SCENE_SYNC_VERSION,
  syncRequestId,
  projectId: canvasSubscribeRequest.projectId,
  documentId: canvasSubscribeRequest.documentId,
  storeEpoch: "epoch:canvas",
  generation: 1,
  headSeq: 0,
  sceneHash: "a".repeat(64),
  scene: materializePortableCanvasScene({ elements: [] }),
});

const ownedDocumentDescriptorSnapshot = (projectId = "project:one") => ({
  contract_version: 1 as const,
  store_epoch: "epoch:test",
  event_head: 2,
  value: {
    kind: "descriptor" as const,
    descriptor: {
      version: 2,
      projectId,
      ownerBlockId: "page:one",
      ownerType: "page",
      ownerLifecycle: "active",
      documentId: "document:one",
      storeEpoch: "epoch:test",
      generation: 1,
      headSeq: 1,
      schemaKey: "nodex.page",
      schemaVersion: 1,
      readiness: "ready",
      sync: { kind: "yjs", stateVector: [] },
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
      projectId: "project:one",
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
      value: { projectId: "project:one", documentId: "document:one" },
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
    rootClient.enqueueDocumentRead(ownedDocumentDescriptorSnapshot(
      "project:compatibility-storage",
    ));
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
      version: 1,
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
        placement: { kind: "space" },
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
      event_head: 4,
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

  test("flushes and freezes exact native participants before restore, then replays without refencing", async () => {
    const rootClient = new FakeCoreClient();
    const projectClient = new FakeCoreClient();
    projectClient.enqueueDocumentSync({
      documentId: subscribeRequest.documentId,
      storeEpoch: "epoch:test",
      generation: 1,
      headSeq: 2,
      update: new Uint8Array(),
      stateVector: new Uint8Array(),
    });
    const committed = (duplicate: boolean) => ({
      store_epoch: "epoch:test",
      event_sequence: 9,
      value: {
        document_id: subscribeRequest.documentId,
        generation: 1,
        head_seq: 3,
        outcome: "committed" as const,
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
          coordination: "write_fence" as const,
        },
      },
      receipt: {
        operation_id: "restore:native",
        duplicate,
        document_id: subscribeRequest.documentId,
        generation: 1,
        head_seq: 3,
      },
    });
    let applyCount = 0;
    vi.spyOn(projectClient, "documentApply").mockImplementation(async (input) => {
      projectClient.documentApplies.push(input);
      applyCount += 1;
      if (applyCount === 1) {
        throw new CoreModuleResponseError({
          code: "revision_conflict",
          message: "Document restore requires a trusted current-head write fence",
          retryable: true,
          recovery: { kind: "none" },
        });
      }
      return committed(applyCount === 3);
    });
    const bridge = createDesktopDocumentSyncBridge({
      authority: Promise.resolve(rustRuntime(rootClient, projectClient)),
    });
    const target = new FakeTarget(1);
    const attacker = new FakeTarget(2);
    const scope = { kind: "project", projectId: "project:one" } as const;
    await bridge.subscribe(scope, target, subscribeRequest);
    await bridge.sync(scope, target, {
      ...subscribeRequest,
      stateVector: new Uint8Array(),
    });
    const request = {
      version: 1 as const,
      mutationId: "restore:native",
      projectId: scope.projectId,
      storeEpoch: "epoch:test",
      documentId: subscribeRequest.documentId,
      versionId: documentVersionSummary().versionId,
      generation: 1,
      expectedHeadSeq: 2,
      clientSessionId: subscribeRequest.clientSessionId,
      actor: { kind: "electron_renderer" },
    };

    const pending = bridge.restoreVersion(request);
    await vi.waitFor(() => {
      expect(target.sent.some((delivery) =>
        typeof delivery.payload === "object"
        && delivery.payload !== null
        && "kind" in delivery.payload
        && delivery.payload.kind === "relocation-lease-prepare"
      )).toBe(true);
    });
    const prepare = target.sent
      .map((delivery) => delivery.payload)
      .find((event) =>
        typeof event === "object"
        && event !== null
        && "kind" in event
        && event.kind === "relocation-lease-prepare"
      ) as {
        readonly leaseId: string;
        readonly documentId: string;
        readonly clientSessionId: string;
        readonly storeEpoch: string;
        readonly generation: number;
        readonly expectedHeadSeq: number;
      };
    const response = {
      response: "ack" as const,
      leaseId: prepare.leaseId,
      documentId: prepare.documentId,
      clientSessionId: prepare.clientSessionId,
      storeEpoch: prepare.storeEpoch,
      generation: prepare.generation,
      headSeq: prepare.expectedHeadSeq,
    };
    await expect(bridge.respondToRelocationLease(
      scope,
      attacker,
      response,
    )).resolves.toMatchObject({ ok: false, error: { code: "unauthorized" } });
    await expect(bridge.respondToRelocationLease(
      scope,
      target,
      response,
    )).resolves.toMatchObject({ ok: true, value: { status: "frozen" } });
    await expect(pending).resolves.toMatchObject({
      ok: true,
      value: { mutationId: request.mutationId, headSeq: 3, duplicate: false },
    });
    expect(projectClient.documentApplies.map((input) =>
      input.intent.kind === "restore_version"
        ? input.intent.write_fence_prepared
        : undefined
    )).toEqual([false, true]);
    const prepareCount = target.sent
      .map((delivery) => delivery.payload)
      .filter((event) =>
        typeof event === "object"
        && event !== null
        && "kind" in event
        && event.kind === "relocation-lease-prepare"
      ).length;
    expect(target.sent.some((delivery) =>
      typeof delivery.payload === "object"
      && delivery.payload !== null
      && "kind" in delivery.payload
      && delivery.payload.kind === "relocation-lease-release"
    )).toBe(true);

    await expect(bridge.restoreVersion(request)).resolves.toMatchObject({
      ok: true,
      value: { duplicate: true, headSeq: 3 },
    });
    expect(projectClient.documentApplies).toHaveLength(3);
    expect(target.sent
      .map((delivery) => delivery.payload)
      .filter((event) =>
        typeof event === "object"
        && event !== null
        && "kind" in event
        && event.kind === "relocation-lease-prepare"
      )).toHaveLength(prepareCount);
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
      write_fence_prepared: false,
    });
  });

  test("coordinates a native Block transfer across every leased Document", async () => {
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
      source: { kind: "page", pageId: "page:source" },
      target: { kind: "page", pageId: "page:target" },
    };
    const preparation = {
      source_document_id: "document:source",
      source_database_id: null,
      target_document_id: "document:target",
      target_database_id: null,
      write_fence: {
        documents: [{
          document_id: "document:source",
          generation: 1,
          expected_head_seq: 2,
        }, {
          document_id: "document:target",
          generation: 1,
          expected_head_seq: 5,
        }],
        location_revisions: { "block:root": 1 },
        source_memberships: {},
      },
    } as const;
    const preparedSnapshot = {
      contract_version: 1 as const,
      store_epoch: "epoch:test",
      event_head: 8,
      value: {
        kind: "block_transfer_plan" as const,
        value: { kind: "prepared" as const, preparation },
      },
    };
    projectClient.enqueueRead(preparedSnapshot);
    projectClient.enqueueRead(preparedSnapshot);
    projectClient.enqueueRead(preparedSnapshot);
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
        change_log_seq: 9,
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

    const pending = bridge.transferBlocks(transferIntent);
    await vi.waitFor(() => {
      expect(sourceTarget.sent.some((delivery) =>
        typeof delivery.payload === "object"
        && delivery.payload !== null
        && "kind" in delivery.payload
        && delivery.payload.kind === "relocation-lease-prepare"
      )).toBe(true);
      expect(targetTarget.sent.some((delivery) =>
        typeof delivery.payload === "object"
        && delivery.payload !== null
        && "kind" in delivery.payload
        && delivery.payload.kind === "relocation-lease-prepare"
      )).toBe(true);
    });
    const acknowledge = async (target: FakeTarget): Promise<void> => {
      const event = target.sent
        .map((delivery) => delivery.payload)
        .find((payload) =>
          typeof payload === "object"
          && payload !== null
          && "kind" in payload
          && payload.kind === "relocation-lease-prepare"
        );
      if (
        typeof event !== "object"
        || event === null
        || !("leaseId" in event)
        || !("documentId" in event)
        || !("clientSessionId" in event)
        || !("storeEpoch" in event)
        || !("generation" in event)
        || !("expectedHeadSeq" in event)
      ) {
        throw new Error("Expected native Block transfer lease preparation");
      }
      await expect(bridge.respondToRelocationLease(scope, target, {
        response: "ack",
        leaseId: String(event.leaseId),
        documentId: String(event.documentId),
        clientSessionId: String(event.clientSessionId),
        storeEpoch: String(event.storeEpoch),
        generation: Number(event.generation),
        headSeq: Number(event.expectedHeadSeq),
      })).resolves.toMatchObject({ ok: true, value: { status: "frozen" } });
    };
    await acknowledge(sourceTarget);
    await acknowledge(targetTarget);

    const result = await pending;
    if (!result.ok) throw new Error(JSON.stringify(result.error));
    expect(result).toMatchObject({
      ok: true,
      value: {
        operationId: transferIntent.operationId,
        finalLocationRevisions: { "block:root": 2 },
      },
    });
    expect(projectClient.reads).toHaveLength(3);
    expect(projectClient.applies[0]).toMatchObject({
      operationId: transferIntent.operationId,
      intent: {
        kind: "transfer_blocks",
        write_fence: {
          documents: [{
            document_id: "document:source",
            expected_head_seq: 2,
          }, {
            document_id: "document:target",
            expected_head_seq: 5,
          }],
          location_revisions: { "block:root": 1 },
          source_memberships: {},
        },
      },
    });
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
      )).toBe(true);
    }
  });

  test("freezes a live Document before a native Agent mutation and fans out its commit", async () => {
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
        changeLogSeq: 14,
      },
    }));
    const pending = bridge.coordinateNodexAgentLeasedMutation({
      projectId: "project:one",
      storeEpoch: "epoch:test",
      leaseDocuments: [{
        documentId: "document:agent-target",
        generation: 2,
        expectedHeadSeq: 7,
      }],
      execute,
      failure: (message, recovery = "none") => ({
        ok: false,
        error: {
          code: recovery === "get_block_again" ? "conflict" : "internal_error",
          message,
          retryable: false,
          recovery,
        },
      }),
      operationLabel: "Agent Page duplicate",
      conflictMessage: "Destination changed",
    });

    await vi.waitFor(() => {
      expect(target.sent.some((delivery) =>
        typeof delivery.payload === "object"
        && delivery.payload !== null
        && "kind" in delivery.payload
        && delivery.payload.kind === "relocation-lease-prepare"
      )).toBe(true);
    });
    expect(execute).not.toHaveBeenCalled();
    const prepare = target.sent
      .map((delivery) => delivery.payload)
      .find((payload) =>
        typeof payload === "object"
        && payload !== null
        && "kind" in payload
        && payload.kind === "relocation-lease-prepare"
      );
    if (
      typeof prepare !== "object"
      || prepare === null
      || !("leaseId" in prepare)
      || !("documentId" in prepare)
      || !("clientSessionId" in prepare)
      || !("storeEpoch" in prepare)
      || !("generation" in prepare)
      || !("expectedHeadSeq" in prepare)
    ) {
      throw new Error("Expected native Agent mutation lease preparation");
    }
    await expect(bridge.respondToRelocationLease(scope, target, {
      response: "ack",
      leaseId: String(prepare.leaseId),
      documentId: String(prepare.documentId),
      clientSessionId: String(prepare.clientSessionId),
      storeEpoch: String(prepare.storeEpoch),
      generation: Number(prepare.generation),
      headSeq: Number(prepare.expectedHeadSeq),
    })).resolves.toMatchObject({ ok: true, value: { status: "frozen" } });

    const result = await pending;
    if (!result.ok) throw new Error(JSON.stringify(result.error));
    expect(result).toMatchObject({
      ok: true,
      value: { changeLogSeq: 14 },
    });
    expect(execute).toHaveBeenCalledOnce();
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
      error: { code: "project_scope_mismatch" },
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
      error: { code: "project_scope_mismatch" },
    });
    await expect(bridge.syncCanvasScene(
      canvasTarget,
      { ...canvasSubscribeRequest, syncRequestId: "sync:canvas" },
    )).resolves.toMatchObject({
      ok: true,
      value: {
        projectId: canvasSubscribeRequest.projectId,
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
      projectId: requestA.projectId,
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

  test("freezes the closing Canvas subscriber before committing idle maintenance", async () => {
    const projectClient = new CanvasCompactionFenceClient();
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
      event_head: 3,
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
      projectId: canvasSubscribeRequest.projectId,
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
    const pending = bridge.compactCanvasScene(target, {
      ...canvasSubscribeRequest,
      version: CANVAS_SCENE_MAINTENANCE_VERSION,
      mutationId: operationId,
      trigger: "automatic_idle",
    });
    await vi.waitFor(() => {
      expect(target.sent.some((delivery) =>
        typeof delivery.payload === "object"
        && delivery.payload !== null
        && "kind" in delivery.payload
        && delivery.payload.kind === "relocation-lease-prepare"
      )).toBe(true);
    });
    expect(projectClient.compactionAttempts).toBe(1);
    const prepare = target.sent
      .map((delivery) => delivery.payload)
      .find((payload) =>
        typeof payload === "object"
        && payload !== null
        && "kind" in payload
        && payload.kind === "relocation-lease-prepare"
      );
    if (
      typeof prepare !== "object"
      || prepare === null
      || !("leaseId" in prepare)
      || !("documentId" in prepare)
      || !("clientSessionId" in prepare)
      || !("storeEpoch" in prepare)
      || !("generation" in prepare)
      || !("expectedHeadSeq" in prepare)
    ) {
      throw new Error("Expected Canvas compaction lease preparation");
    }
    await expect(bridge.respondToRelocationLease(
      { kind: "project", projectId: canvasSubscribeRequest.projectId },
      target,
      {
        response: "ack",
        leaseId: String(prepare.leaseId),
        documentId: String(prepare.documentId),
        clientSessionId: String(prepare.clientSessionId),
        storeEpoch: String(prepare.storeEpoch),
        generation: Number(prepare.generation),
        headSeq: Number(prepare.expectedHeadSeq),
      },
    )).resolves.toMatchObject({ ok: true, value: { status: "frozen" } });
    await expect(pending).resolves.toEqual({ ok: true, value: compactionValue });
    expect(projectClient.compactionAttempts).toBe(2);
    expect(projectClient.documentApplies[0]?.intent).toMatchObject({
      kind: "compact_canvas_tombstones",
      write_fence_prepared: true,
    });
    expect(target.sent.some((delivery) =>
      typeof delivery.payload === "object"
      && delivery.payload !== null
      && "kind" in delivery.payload
      && delivery.payload.kind === "relocation-lease-cancel"
    )).toBe(true);
  });

  test("defers Canvas maintenance while another surface is subscribed", async () => {
    const projectClient = new CanvasCompactionFenceClient();
    Object.assign(projectClient, {
      handshake: createFakeCoreHandshake({
        connectionBinding: "binding:canvas",
        libraryId: "library:test",
        profileId: "profile:test",
        storeEpoch: "epoch:canvas",
      }),
    });
    const bridge = createDesktopDocumentSyncBridge({
      authority: Promise.resolve(rustRuntime(new FakeCoreClient(), projectClient)),
    });
    const targetA = new FakeTarget(21);
    const targetB = new FakeTarget(22);
    const requestB = {
      ...canvasSubscribeRequest,
      clientSessionId: "renderer:canvas:second",
    };
    await expect(
      bridge.subscribeCanvasScene(targetA, canvasSubscribeRequest),
    ).resolves.toEqual({ ok: true, value: { subscribed: true } });
    await expect(
      bridge.subscribeCanvasScene(targetB, requestB),
    ).resolves.toEqual({ ok: true, value: { subscribed: true } });

    await expect(bridge.compactCanvasScene(targetA, {
      ...canvasSubscribeRequest,
      version: CANVAS_SCENE_MAINTENANCE_VERSION,
      mutationId: "canvas-maintenance:deferred",
      trigger: "automatic_idle",
    })).resolves.toMatchObject({
      ok: false,
      error: {
        code: "write_fence_required",
        retryable: true,
      },
    });
    expect(projectClient.compactionAttempts).toBe(0);
    expect([...targetA.sent, ...targetB.sent].some((delivery) =>
      typeof delivery.payload === "object"
      && delivery.payload !== null
      && "kind" in delivery.payload
      && delivery.payload.kind === "relocation-lease-prepare"
    )).toBe(false);
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
