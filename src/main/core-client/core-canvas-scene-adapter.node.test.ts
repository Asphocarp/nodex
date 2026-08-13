import { describe, expect, test } from "vitest";

import {
  CANVAS_SCENE_MAINTENANCE_VERSION,
  CANVAS_SCENE_SYNC_VERSION,
  materializePortableCanvasScene,
  type CanvasSceneRealtimeEvent,
} from "../../shared/block-documents";
import { DocumentHttpWireError } from "../../shared/block-documents/http-wire";
import { committedLocalCommit } from "../../shared/testing/local-commit";
import { createCoreCanvasSceneAdapter } from "./core-canvas-scene-adapter";
import { CoreModuleResponseError } from "./core-client";
import { FakeCoreClient } from "./testing/fake-core-client";
import { createCoreLocalCommitFixture } from "./testing/local-commit-fixture";
import type {
  CoreEventEnvelope,
  OwnedDocumentApplyResult,
} from "./types";

const PROJECT_ID = "project:canvas";
const DOCUMENT_ID = "document:canvas";
const CLIENT_SESSION_ID = "renderer:canvas";
const STORE_EPOCH = "epoch:canvas";
const SCENE_HASH = "a".repeat(64);
const COMMITTED_AT = "2026-07-19T00:00:00.000Z";

class SubscriptionLossCanvasClient extends FakeCoreClient {
  streamOpenings = 0;
  readAttempts = 0;

  override openDocumentEventStream(
    ...args: Parameters<FakeCoreClient["openDocumentEventStream"]>
  ): ReturnType<FakeCoreClient["openDocumentEventStream"]> {
    this.streamOpenings += 1;
    return super.openDocumentEventStream(...args);
  }

  override documentCanvasSync(
    ...args: Parameters<FakeCoreClient["documentCanvasSync"]>
  ): ReturnType<FakeCoreClient["documentCanvasSync"]> {
    this.readAttempts += 1;
    if (this.readAttempts === 1) {
      throw new CoreModuleResponseError({
        code: "unauthorized",
        message: "An exact Document subscription is required",
        retryable: true,
        recovery: { kind: "reconnect_document_subscription" },
      });
    }
    return super.documentCanvasSync(...args);
  }
}

class InvalidSnapshotCanvasClient extends FakeCoreClient {
  override documentCanvasSync(): ReturnType<FakeCoreClient["documentCanvasSync"]> {
    throw new DocumentHttpWireError("Canvas snapshot payload is invalid");
  }
}

const emptyScene = materializePortableCanvasScene({ elements: [] });

const syncSnapshot = (syncRequestId: string) => ({
  kind: "snapshot" as const,
  version: CANVAS_SCENE_SYNC_VERSION,
  syncRequestId,
  libraryId: "library:canvas",
  accessContext: { kind: "project" as const, projectId: PROJECT_ID },
  documentId: DOCUMENT_ID,
  storeEpoch: STORE_EPOCH,
  generation: 1,
  headSeq: 0,
  sceneHash: SCENE_HASH,
  scene: emptyScene,
});

const mutationResult = {
  version: CANVAS_SCENE_SYNC_VERSION,
  mutationId: "canvas-mutation:one",
  projectId: PROJECT_ID,
  documentId: DOCUMENT_ID,
  storeEpoch: STORE_EPOCH,
  generation: 1,
  baseHeadSeq: 0,
  headSeq: 1,
  duplicate: false,
  outcome: "committed" as const,
  sceneHash: SCENE_HASH,
  changedElementIds: [],
  appliedAppStateKeys: ["gridModeEnabled"],
  skippedAppStateKeys: [],
  addedFileIds: [],
  removedFileIds: [],
  committedAt: COMMITTED_AT,
  committedDelta: {
    elementUpdates: [],
    appState: { gridModeEnabled: true },
    fileAdditions: {},
    removedFileIds: [],
  },
};

const committedMutation = (): OwnedDocumentApplyResult => ({
  status: "committed",
  commit: {
    store_epoch: STORE_EPOCH,
    commit_seq: 1,
    manifest_hash: "f".repeat(64),
  },
  outcome: {
    document_id: DOCUMENT_ID,
    generation: 1,
    head_seq: 1,
    outcome: "committed",
    canvas: mutationResult,
  },
  receipt: {
    operation_id: mutationResult.mutationId,
    duplicate: false,
    document_id: DOCUMENT_ID,
    generation: 1,
    head_seq: 1,
  },
});

const committedEvent = (): CoreEventEnvelope => ({
  transport_version: 4,
  packet: createCoreLocalCommitFixture({
    commitSeq: 1,
    storeEpoch: STORE_EPOCH,
    operationId: mutationResult.mutationId,
    committedAt: COMMITTED_AT,
    payload: {
      module: "owned_document",
      library_id: "library-1",
      canvas_id: "canvas:test",
      event: {
        kind: "canvas_updated",
        document_id: DOCUMENT_ID,
        generation: 1,
        base_head_seq: 0,
        head_seq: 1,
        scene_hash: SCENE_HASH,
        mutation: {
          elementUpdates: [],
          appState: { gridModeEnabled: true },
          fileAdditions: {},
          removedFileIds: [],
        },
      },
    },
    canonicalHash: "0".repeat(64),
  }),
});

describe("Core Canvas scene adapter", () => {
  test("classifies an invalid Canvas snapshot as a terminal protocol error", async () => {
    const client = new InvalidSnapshotCanvasClient();
    const adapter = createCoreCanvasSceneAdapter(client);
    const request = {
      version: CANVAS_SCENE_SYNC_VERSION,
      syncRequestId: "sync:invalid",
      projectId: PROJECT_ID,
      documentId: DOCUMENT_ID,
      clientSessionId: CLIENT_SESSION_ID,
    } as const;
    const close = adapter.subscribe(request, () => undefined);

    await expect(adapter.sync(request)).resolves.toEqual({
      ok: false,
      error: {
        code: "canvas_scene_corrupt",
        message: "Canvas snapshot payload is invalid",
        retryable: false,
        resetRequired: false,
      },
    });

    close();
  });

  test("reconnects and retries once when Core reports a lost subscription lease", async () => {
    const client = new SubscriptionLossCanvasClient();
    client.enqueueDocumentCanvasSync(syncSnapshot("sync:one"));
    const adapter = createCoreCanvasSceneAdapter(client, { retryDelayMs: 0 });
    const request = {
      version: CANVAS_SCENE_SYNC_VERSION,
      syncRequestId: "sync:one",
      projectId: PROJECT_ID,
      documentId: DOCUMENT_ID,
      clientSessionId: CLIENT_SESSION_ID,
    } as const;
    const close = adapter.subscribe(request, () => undefined);

    await expect(adapter.sync(request)).resolves.toMatchObject({
      ok: true,
      value: { documentId: DOCUMENT_ID },
    });
    expect(client.streamOpenings).toBe(2);
    expect(client.readAttempts).toBe(2);
    close();
  });

  test("syncs, applies, and maps durable Canvas events behind one subscription", async () => {
    const client = new FakeCoreClient();
    const adapter = createCoreCanvasSceneAdapter(client);
    const events: CanvasSceneRealtimeEvent[] = [];
    const subscription = {
      version: CANVAS_SCENE_SYNC_VERSION,
      projectId: PROJECT_ID,
      documentId: DOCUMENT_ID,
      clientSessionId: CLIENT_SESSION_ID,
    } as const;
    const close = adapter.subscribe(subscription, (event) => events.push(event));
    client.enqueueDocumentCanvasSync(syncSnapshot("sync:two"));

    await expect(adapter.sync({
      ...subscription,
      syncRequestId: "sync:two",
    })).resolves.toMatchObject({
      ok: true,
      value: {
        libraryId: "library:canvas",
        accessContext: { kind: "project", projectId: PROJECT_ID },
        documentId: DOCUMENT_ID,
        headSeq: 0,
        kind: "snapshot",
        scene: emptyScene,
      },
    });

    client.enqueueDocumentApply(committedMutation());
    await expect(adapter.applyMutation({
      ...subscription,
      mutationId: mutationResult.mutationId,
      storeEpoch: STORE_EPOCH,
      generation: 1,
      baseHeadSeq: 0,
      elementCandidates: [],
      appStateIntents: {
        gridModeEnabled: {
          expected: { kind: "absent" },
          value: { kind: "value", value: true },
        },
      },
      fileAdditions: {},
    })).resolves.toEqual({
      ok: true,
      value: mutationResult,
      localCommit: committedLocalCommit(STORE_EPOCH, 1),
    });

    client.emitDocument(DOCUMENT_ID, committedEvent());
    await expect.poll(() => events).toEqual([{
      type: "canvas_scene_committed",
      version: CANVAS_SCENE_SYNC_VERSION,
      projectId: PROJECT_ID,
      documentId: DOCUMENT_ID,
      storeEpoch: STORE_EPOCH,
      generation: 1,
      mutationId: mutationResult.mutationId,
      baseHeadSeq: 0,
      headSeq: 1,
      sceneHash: SCENE_HASH,
      elementUpdates: [],
      appState: { gridModeEnabled: true },
      fileAdditions: {},
      removedFileIds: [],
    }]);

    close();
    await expect(adapter.sync({
      ...subscription,
      syncRequestId: "sync:closed",
    })).resolves.toMatchObject({
      ok: false,
      error: { code: "unknown", retryable: true },
    });
  });

  test("rejects Canvas sync access drift instead of rewriting Core identity", async () => {
    const client = new FakeCoreClient();
    const adapter = createCoreCanvasSceneAdapter(client);
    const subscription = {
      version: CANVAS_SCENE_SYNC_VERSION,
      projectId: PROJECT_ID,
      documentId: DOCUMENT_ID,
      clientSessionId: CLIENT_SESSION_ID,
    } as const;
    const close = adapter.subscribe(subscription, () => undefined);
    client.enqueueDocumentCanvasSync({
      ...syncSnapshot("sync:granted"),
      accessContext: {
        kind: "project",
        projectId: "project:wrong-authority",
      },
    });

    await expect(adapter.sync({
      ...subscription,
      syncRequestId: "sync:granted",
    })).resolves.toMatchObject({
      ok: false,
      error: { code: "canvas_scene_corrupt" },
    });

    const physicalMutation = committedMutation();
    client.enqueueDocumentApply({
      ...physicalMutation,
        outcome: {
          ...physicalMutation.outcome,
        canvas: {
          ...mutationResult,
          projectId: "project:compatibility-storage",
        },
      },
    });
    await expect(adapter.applyMutation({
      ...subscription,
      mutationId: mutationResult.mutationId,
      storeEpoch: STORE_EPOCH,
      generation: 1,
      baseHeadSeq: 0,
      elementCandidates: [],
      appStateIntents: {},
      fileAdditions: {},
    })).resolves.toMatchObject({
      ok: true,
      value: { projectId: PROJECT_ID, documentId: DOCUMENT_ID },
    });
    close();
  });

  test("reads compaction evidence, applies generation rollover, and maps its reset event", async () => {
    const client = new FakeCoreClient();
    const adapter = createCoreCanvasSceneAdapter(client);
    const events: CanvasSceneRealtimeEvent[] = [];
    const subscription = {
      version: CANVAS_SCENE_SYNC_VERSION,
      projectId: PROJECT_ID,
      documentId: DOCUMENT_ID,
      clientSessionId: CLIENT_SESSION_ID,
    } as const;
    const close = adapter.subscribe(subscription, (event) => events.push(event));
    client.enqueueDocumentRead({
      contract_version: 3,
      store_epoch: STORE_EPOCH,
      commit_head: 3,
      value: {
        kind: "canvas_compaction_eligibility",
        stats: {
          document_id: DOCUMENT_ID,
          generation: 1,
          head_seq: 9,
          scene_hash: SCENE_HASH,
          tombstone_count: 2,
          tombstone_bytes: 200,
          eligible: true,
        },
      },
    });
    const request = {
      version: CANVAS_SCENE_MAINTENANCE_VERSION,
      mutationId: "canvas-compaction:one",
      projectId: PROJECT_ID,
      documentId: DOCUMENT_ID,
      clientSessionId: CLIENT_SESSION_ID,
      trigger: "automatic_idle",
    } as const;
    const eligibility = await adapter.readCompaction(request);
    expect(eligibility).toMatchObject({
      ok: true,
      value: {
        documentId: DOCUMENT_ID,
        generation: 1,
        headSeq: 9,
        tombstoneCount: 2,
      },
    });
    if (!eligibility.ok) throw new Error("expected compaction eligibility");
    const compactionResult = {
      version: CANVAS_SCENE_MAINTENANCE_VERSION,
      kind: "tombstone_compaction" as const,
      operationId: request.mutationId,
      projectId: PROJECT_ID,
      documentId: DOCUMENT_ID,
      storeEpoch: STORE_EPOCH,
      previousGeneration: 1,
      previousHeadSeq: 9,
      generation: 2,
      headSeq: 1,
      duplicate: false,
      outcome: "committed" as const,
      sceneHash: "b".repeat(64),
      removedTombstoneCount: 2,
      removedTombstoneBytes: 200,
      checkpointVersionId: "version:before-compaction",
      committedAt: COMMITTED_AT,
    };
    client.enqueueDocumentApply({
      store_epoch: STORE_EPOCH,
      event_sequence: 4,
      value: {
        document_id: DOCUMENT_ID,
        generation: 2,
        head_seq: 1,
        outcome: "committed",
        canvas: {
          ...compactionResult,
          projectId: "project:compatibility-storage",
        },
      },
      receipt: {
        operation_id: request.mutationId,
        duplicate: false,
        document_id: DOCUMENT_ID,
        generation: 2,
        head_seq: 1,
      },
    });
    await expect(
      adapter.compact(request, eligibility.value),
    ).resolves.toEqual({
      ok: true,
      value: compactionResult,
      localCommit: committedLocalCommit(STORE_EPOCH, 4),
    });
    expect(client.documentApplies[0]?.intent).toMatchObject({
      kind: "compact_canvas_tombstones",
      generation: 1,
      expected_head_seq: 9,
    });

    client.emitDocument(DOCUMENT_ID, {
      transport_version: 4,
      packet: createCoreLocalCommitFixture({
        commitSeq: 4,
        storeEpoch: STORE_EPOCH,
        operationId: request.mutationId,
        committedAt: COMMITTED_AT,
        payload: {
          module: "owned_document",
          library_id: "library-1",
          canvas_id: "canvas:test",
          event: {
            kind: "canvas_generation_changed",
            document_id: DOCUMENT_ID,
            previous_generation: 1,
            previous_head_seq: 9,
            generation: 2,
            head_seq: 1,
            scene_hash: compactionResult.sceneHash,
          },
        },
        canonicalHash: "0".repeat(64),
      }),
    });
    await expect.poll(() => events).toEqual([{
      type: "canvas_scene_resync_required",
      version: CANVAS_SCENE_SYNC_VERSION,
      projectId: PROJECT_ID,
      documentId: DOCUMENT_ID,
      storeEpoch: STORE_EPOCH,
      generation: 2,
      headSeq: 1,
    }]);
    close();
  });
});
