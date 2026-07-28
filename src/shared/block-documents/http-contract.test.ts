import { describe, expect, test } from "vitest";
import {
  decodeOwnedDocumentDescriptorHttp,
  decodeCanvasSceneSyncHttpRequest,
  decodeCanvasSceneSyncHttpResponse,
  decodeLibraryOwnedDocumentDescriptorHttp,
  decodeDocumentApplyHttpAck,
  decodeDocumentApplyHttpRequest,
  decodeDocumentAwarenessHttpRequest,
  decodeDocumentHttpError,
  decodeDocumentRealtimeSseEvent,
  decodeDocumentSyncHttpRequest,
  decodeDocumentSyncHttpResponse,
  encodeDocumentApplyHttpAck,
  encodeCanvasSceneSyncHttpRequest,
  encodeCanvasSceneSyncHttpResponse,
  encodeDocumentApplyHttpRequest,
  encodeDocumentAwarenessHttpRequest,
  encodeDocumentHttpError,
  encodeDocumentRealtimeSseEvent,
  encodeDocumentSyncHttpRequest,
  encodeDocumentSyncHttpResponse,
  encodeOwnedDocumentDescriptorHttp,
  encodeLibraryOwnedDocumentDescriptorHttp,
} from "./http-contract";
import {
  CANVAS_SCENE_SYNC_VERSION,
  MAX_CANVAS_SCENE_SNAPSHOT_BYTES,
} from "./canvas-scene-sync";
import {
  canonicalStringifyCanvasScene,
  materializePortableCanvasScene,
} from "./canvas-scene";
import {
  decodeDocumentHttpEnvelope,
  encodeDocumentHttpEnvelope,
} from "./http-wire";
import { PAGE_DOCUMENT_SCHEMA_VERSION } from "./page-document";

const bytes = (...values: number[]): Uint8Array => Uint8Array.from(values);

describe("Document HTTP contract", () => {
  test("round-trips Library descriptors without a compatibility Project", () => {
    const descriptor = decodeLibraryOwnedDocumentDescriptorHttp(
      encodeLibraryOwnedDocumentDescriptorHttp({
        accessContext: { kind: "library" },
        ownerBlockId: "page-1",
        ownerType: "page",
        ownerLifecycle: "active",
        documentId: "document-1",
        storeEpoch: "store-1",
        generation: 1,
        headSeq: 2,
        schemaKey: "nodex.page",
        schemaVersion: PAGE_DOCUMENT_SCHEMA_VERSION,
        readiness: "ready",
        sync: { kind: "yjs", stateVector: bytes(1, 2, 3) },
      }),
    );
    expect(descriptor.accessContext).toEqual({ kind: "library" });
    expect("projectId" in descriptor).toBe(false);
    expect(() => decodeLibraryOwnedDocumentDescriptorHttp(JSON.stringify({
      ...JSON.parse(encodeLibraryOwnedDocumentDescriptorHttp(descriptor)),
      projectId: "forged",
    }))).toThrow("unsupported fields");
  });

  test("round-trips engine-neutral Yjs and Canvas descriptors", () => {
    const common = {
      projectId: "project-1",
      ownerLifecycle: "active",
      storeEpoch: "store-1",
      generation: 2,
      headSeq: 7,
      schemaVersion: 1,
      readiness: "ready",
    } as const;
    const yjs = decodeOwnedDocumentDescriptorHttp(
      encodeOwnedDocumentDescriptorHttp({
        ...common,
        ownerBlockId: "card-1",
        ownerType: "page",
        documentId: "document-1",
        schemaKey: "nodex.page",
        schemaVersion: PAGE_DOCUMENT_SCHEMA_VERSION,
        sync: { kind: "yjs", stateVector: bytes(0, 128, 255) },
      }),
    );
    expect(yjs.sync.kind).toBe("yjs");
    if (yjs.sync.kind !== "yjs") throw new Error("Expected Yjs sync engine");
    expect(Array.from(yjs.sync.stateVector).join(",")).toBe("0,128,255");

    const canvas = decodeOwnedDocumentDescriptorHttp(
      encodeOwnedDocumentDescriptorHttp({
        ...common,
        ownerBlockId: "canvas-1",
        ownerType: "canvas",
        documentId: "canvas-document-1",
        schemaKey: "nodex.canvas",
        sync: { kind: "canvas_scene" },
      }),
    );
    expect(canvas.sync).toEqual({ kind: "canvas_scene" });
    expect("stateVector" in canvas.sync).toBe(false);
  });

  test("rejects Yjs fields on a Canvas engine descriptor", () => {
    const serialized = JSON.stringify({
      version: 2,
      projectId: "project-1",
      ownerBlockId: "canvas-1",
      ownerType: "canvas",
      ownerLifecycle: "active",
      documentId: "canvas-document-1",
      storeEpoch: "store-1",
      generation: 1,
      headSeq: 1,
      schemaKey: "nodex.canvas",
      schemaVersion: 1,
      readiness: "ready",
      sync: { kind: "canvas_scene", stateVector: "AA==" },
    });
    expect(() => decodeOwnedDocumentDescriptorHttp(serialized)).toThrow(
      "Canvas scene sync descriptor has unsupported fields",
    );
  });

  test("round-trips sync and apply commands without JSON-encoding binary updates", () => {
    const syncRequest = {
      documentId: "document-1",
      clientSessionId: "client-1",
      stateVector: bytes(0, 128, 255),
    } as const;
    const decodedSyncRequest = decodeDocumentSyncHttpRequest(
      syncRequest.documentId,
      encodeDocumentSyncHttpRequest(syncRequest),
    );
    expect(Array.from(decodedSyncRequest.stateVector).join(",")).toBe(
      "0,128,255",
    );

    const syncResponse = {
      documentId: "document-1",
      storeEpoch: "store-1",
      generation: 1,
      headSeq: 4,
      stateVector: bytes(1, 2),
      update: bytes(3, 4, 255),
    } as const;
    const decodedSyncResponse = decodeDocumentSyncHttpResponse(
      encodeDocumentSyncHttpResponse(syncResponse),
    );
    expect(Array.from(decodedSyncResponse.stateVector).join(",")).toBe("1,2");
    expect(Array.from(decodedSyncResponse.update).join(",")).toBe("3,4,255");

    const applyRequest = {
      documentId: "document-1",
      storeEpoch: "store-1",
      generation: 1,
      updateId: "update-1",
      clientSessionId: "client-1",
      baseHeadSeq: 4,
      touchedBlockIds: ["block-a", "block-b"],
      update: bytes(5, 6, 7),
    } as const;
    const decodedApplyRequest = decodeDocumentApplyHttpRequest(
      applyRequest.documentId,
      encodeDocumentApplyHttpRequest(applyRequest),
    );
    expect(decodedApplyRequest.touchedBlockIds.join(",")).toBe(
      "block-a,block-b",
    );
    expect(Array.from(decodedApplyRequest.update).join(",")).toBe("5,6,7");

    const ack = {
      documentId: "document-1",
      storeEpoch: "store-1",
      generation: 1,
      updateId: "update-1",
      committedSeq: 5,
      headSeq: 6,
      stateVector: bytes(8, 9),
      duplicate: false,
    } as const;
    const decodedAck = decodeDocumentApplyHttpAck(
      encodeDocumentApplyHttpAck(ack),
    );
    expect(decodedAck.committedSeq).toBe(5);
    expect(Array.from(decodedAck.stateVector).join(",")).toBe("8,9");
  });

  test("round-trips discriminated Canvas sync with raw canonical snapshot bytes", () => {
    const scene = materializePortableCanvasScene({ elements: [] });
    const request = {
      version: CANVAS_SCENE_SYNC_VERSION,
      syncRequestId: "sync-1",
      projectId: "project-1",
      documentId: "canvas-1",
      clientSessionId: "client-1",
      knownStoreEpoch: "store-1",
      knownGeneration: 1,
      knownHeadSeq: 2,
      knownSceneHash: "a".repeat(64),
    } as const;
    expect(
      decodeCanvasSceneSyncHttpRequest(
        request.documentId,
        request.projectId,
        encodeCanvasSceneSyncHttpRequest(request),
      ),
    ).toEqual(request);

    const snapshot = encodeCanvasSceneSyncHttpResponse({
      kind: "snapshot",
      version: CANVAS_SCENE_SYNC_VERSION,
      syncRequestId: request.syncRequestId,
      projectId: request.projectId,
      documentId: request.documentId,
      storeEpoch: request.knownStoreEpoch,
      generation: request.knownGeneration,
      headSeq: request.knownHeadSeq,
      sceneHash: request.knownSceneHash,
      scene,
    });
    const raw = decodeDocumentHttpEnvelope(
      snapshot,
      (value) => value as Readonly<Record<string, unknown>>,
      MAX_CANVAS_SCENE_SNAPSHOT_BYTES,
    );
    expect(new TextDecoder().decode(raw.payload)).toBe(
      canonicalStringifyCanvasScene(scene),
    );
    expect(decodeCanvasSceneSyncHttpResponse(snapshot)).toEqual({
      kind: "snapshot",
      version: CANVAS_SCENE_SYNC_VERSION,
      syncRequestId: request.syncRequestId,
      projectId: request.projectId,
      documentId: request.documentId,
      storeEpoch: request.knownStoreEpoch,
      generation: request.knownGeneration,
      headSeq: request.knownHeadSeq,
      sceneHash: request.knownSceneHash,
      scene,
    });

    const current = encodeCanvasSceneSyncHttpResponse({
      kind: "up_to_date",
      version: CANVAS_SCENE_SYNC_VERSION,
      syncRequestId: "sync-2",
      projectId: request.projectId,
      documentId: request.documentId,
      storeEpoch: request.knownStoreEpoch,
      generation: request.knownGeneration,
      headSeq: request.knownHeadSeq,
      sceneHash: request.knownSceneHash,
    });
    expect(
      decodeDocumentHttpEnvelope(
        current,
        (value) => value as Readonly<Record<string, unknown>>,
        MAX_CANVAS_SCENE_SNAPSHOT_BYTES,
      ).payload,
    ).toHaveLength(0);
    expect(decodeCanvasSceneSyncHttpResponse(current).kind).toBe("up_to_date");
  });

  test("rejects malformed Canvas binary sync payloads and engine confusion", () => {
    const metadata = {
      version: 2,
      engine: "canvas_scene",
      kind: "snapshot",
      syncRequestId: "sync-1",
      projectId: "project-1",
      documentId: "canvas-1",
      storeEpoch: "store-1",
      generation: 1,
      headSeq: 0,
      sceneHash: "a".repeat(64),
    } as const;
    expect(() =>
      decodeCanvasSceneSyncHttpResponse(
        encodeDocumentHttpEnvelope(metadata, bytes(0xff)),
      )
    ).toThrow("UTF-8 JSON");
    expect(() =>
      decodeCanvasSceneSyncHttpResponse(
        encodeDocumentHttpEnvelope(
          metadata,
          new TextEncoder().encode(JSON.stringify(
            materializePortableCanvasScene({ elements: [] }),
          )),
        ),
      )
    ).toThrow("canonical JSON");
    expect(() =>
      decodeCanvasSceneSyncHttpResponse(
        encodeDocumentSyncHttpResponse({
          documentId: "canvas-1",
          storeEpoch: "store-1",
          generation: 1,
          headSeq: 0,
          stateVector: bytes(),
          update: bytes(),
        }),
      )
    ).toThrow("wrong engine");
    expect(() =>
      decodeCanvasSceneSyncHttpResponse(
        encodeDocumentHttpEnvelope(metadata, new Uint8Array(
          MAX_CANVAS_SCENE_SNAPSHOT_BYTES + 1,
        )),
      )
    ).toThrow("exceeds");
  });

  test("round-trips Awareness, realtime events, and typed errors", () => {
    const awareness = {
      documentId: "document-1",
      clientSessionId: "client-1",
      storeEpoch: "store-1",
      generation: 2,
      update: bytes(10, 255),
    } as const;
    const decodedAwareness = decodeDocumentAwarenessHttpRequest(
      awareness.documentId,
      encodeDocumentAwarenessHttpRequest(awareness),
    );
    expect(Array.from(decodedAwareness.update).join(",")).toBe("10,255");

    const events = [
      {
        kind: "connection",
        documentId: "document-1",
        clientSessionId: "client-1",
        state: "connected",
      },
      {
        kind: "store-reset",
        documentId: "document-1",
        storeEpoch: "store-restored",
      },
      {
        kind: "document-update",
        documentId: "document-1",
        storeEpoch: "store-1",
        generation: 1,
        headSeq: 1,
        updateId: "update-1",
        clientSessionId: "client-1",
        update: bytes(11, 12),
      },
      {
        kind: "awareness",
        documentId: "document-1",
        storeEpoch: "store-1",
        generation: 1,
        clientSessionId: "client-2",
        update: bytes(13),
      },
      {
        kind: "resync-required",
        documentId: "document-1",
        storeEpoch: "store-1",
        generation: 1,
        headSeq: 2,
        reason: "event-gap",
      },
      {
        kind: "relocation-lease-prepare",
        leaseId: "lease-1",
        documentId: "document-1",
        clientSessionId: "client-1",
        storeEpoch: "store-1",
        generation: 1,
        expectedHeadSeq: 2,
        deadlineAt: 2_000,
      },
      {
        kind: "relocation-lease-release",
        leaseId: "lease-1",
        documentId: "document-1",
        clientSessionId: "client-1",
        storeEpoch: "store-1",
        generation: 1,
        headSeq: 3,
      },
      {
        kind: "relocation-lease-cancel",
        leaseId: "lease-2",
        documentId: "document-1",
        clientSessionId: "client-1",
        storeEpoch: "store-1",
        generation: 1,
        headSeq: 3,
        reason: "lease timeout",
      },
    ] as const;
    const decodedKinds = events.map(
      (event) =>
        decodeDocumentRealtimeSseEvent(encodeDocumentRealtimeSseEvent(event))
          .kind,
    );
    expect(decodedKinds.join(",")).toBe(
      "connection,store-reset,document-update,awareness,resync-required,relocation-lease-prepare,relocation-lease-release,relocation-lease-cancel",
    );

    const error = {
      code: "document_not_ready",
      message: "not ready",
      retryable: true,
      resetRequired: false,
    } as const;
    expect(decodeDocumentHttpError(encodeDocumentHttpError(error)).code).toBe(
      "document_not_ready",
    );

    const recoveryError = {
      code: "block_relocated",
      message: "moved",
      retryable: false,
      resetRequired: true,
      relocationId: "relocation-1",
      recoveryArtifactId: "artifact-1",
    } as const;
    const decodedRecoveryError = decodeDocumentHttpError(
      encodeDocumentHttpError(recoveryError),
    );
    expect(decodedRecoveryError.code).toBe("block_relocated");
    expect(decodedRecoveryError.relocationId).toBe("relocation-1");
    expect(decodedRecoveryError.recoveryArtifactId).toBe("artifact-1");
  });

  test("rejects duplicate touched identities at the HTTP boundary", () => {
    const request = {
      documentId: "document-1",
      storeEpoch: "store-1",
      generation: 1,
      updateId: "update-1",
      clientSessionId: "client-1",
      baseHeadSeq: 0,
      touchedBlockIds: ["duplicate", "duplicate"],
      update: bytes(1),
    } as const;
    let rejected = false;
    try {
      decodeDocumentApplyHttpRequest(
        request.documentId,
        encodeDocumentApplyHttpRequest(request),
      );
    } catch {
      rejected = true;
    }
    expect(rejected).toBe(true);
  });
});
