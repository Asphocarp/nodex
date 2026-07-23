import { describe, expect, test } from "vitest";

import {
  CANVAS_SCENE_SYNC_VERSION,
  materializePortableCanvasScene,
  type CanvasSceneRealtimeEvent,
} from "../../shared/block-documents";
import { createCoreCanvasSceneAdapter } from "./core-canvas-scene-adapter";
import { CoreModuleResponseError } from "./core-client";
import { FakeCoreClient } from "./testing/fake-core-client";
import type {
  CoreEventEnvelope,
  OwnedDocumentCommittedValue,
  OwnedDocumentReadSnapshot,
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

  override documentRead(
    ...args: Parameters<FakeCoreClient["documentRead"]>
  ): ReturnType<FakeCoreClient["documentRead"]> {
    this.readAttempts += 1;
    if (this.readAttempts === 1) {
      throw new CoreModuleResponseError({
        code: "unauthorized",
        message: "An exact Document subscription is required",
        retryable: true,
        recovery: { kind: "reconnect_document_subscription" },
      });
    }
    return super.documentRead(...args);
  }
}

const emptyScene = materializePortableCanvasScene({ elements: [] });

const syncSnapshot = (): OwnedDocumentReadSnapshot => ({
  contract_version: 1,
  store_epoch: STORE_EPOCH,
  event_head: 0,
  value: {
    kind: "canvas_sync",
    descriptor: {
      version: 2,
      projectId: PROJECT_ID,
      ownerBlockId: "canvas:one",
      ownerType: "canvas",
      ownerLifecycle: "active",
      documentId: DOCUMENT_ID,
      storeEpoch: STORE_EPOCH,
      generation: 1,
      headSeq: 0,
      schemaKey: "nodex.canvas",
      schemaVersion: 1,
      readiness: "ready",
      sync: { kind: "canvas_scene" },
    },
    scene_json: [...new TextEncoder().encode(JSON.stringify(emptyScene))],
    scene_hash: SCENE_HASH,
  },
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
};

const committedMutation = (): OwnedDocumentCommittedValue => ({
  store_epoch: STORE_EPOCH,
  event_sequence: 1,
  value: {
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
  transport_version: 3,
  event: {
    event_version: 2,
    sequence: 1,
    store_epoch: STORE_EPOCH,
    operation_id: mutationResult.mutationId,
    committed_at: COMMITTED_AT,
    projection_impact: { kind: "none" },
    payload: {
      module: "owned_document",
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
  },
});

describe("Core Canvas scene adapter", () => {
  test("reconnects and retries once when Core reports a lost subscription lease", async () => {
    const client = new SubscriptionLossCanvasClient();
    client.enqueueDocumentRead(syncSnapshot());
    const adapter = createCoreCanvasSceneAdapter(client, { retryDelayMs: 0 });
    const request = {
      version: CANVAS_SCENE_SYNC_VERSION,
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
    client.enqueueDocumentRead(syncSnapshot());

    await expect(adapter.sync(subscription)).resolves.toMatchObject({
      ok: true,
      value: {
        projectId: PROJECT_ID,
        documentId: DOCUMENT_ID,
        headSeq: 0,
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
    })).resolves.toEqual({ ok: true, value: mutationResult });

    client.emit(committedEvent());
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
    await expect(adapter.sync(subscription)).resolves.toMatchObject({
      ok: false,
      error: { code: "unknown", retryable: true },
    });
  });
});
