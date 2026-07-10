import { describe, expect, test } from "bun:test";
import {
  decodeDocumentApplyHttpAck,
  decodeDocumentApplyHttpRequest,
  decodeDocumentAwarenessHttpRequest,
  decodeDocumentHttpError,
  decodeDocumentRealtimeSseEvent,
  decodeDocumentSyncHttpRequest,
  decodeDocumentSyncHttpResponse,
  encodeDocumentApplyHttpAck,
  encodeDocumentApplyHttpRequest,
  encodeDocumentAwarenessHttpRequest,
  encodeDocumentHttpError,
  encodeDocumentRealtimeSseEvent,
  encodeDocumentSyncHttpRequest,
  encodeDocumentSyncHttpResponse,
} from "./http-contract";

const bytes = (...values: number[]): Uint8Array => Uint8Array.from(values);

describe("Document HTTP contract", () => {
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
    expect(Array.from(decodedSyncRequest.stateVector).join(",")).toBe("0,128,255");

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
    expect(decodedApplyRequest.touchedBlockIds.join(",")).toBe("block-a,block-b");
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
      { kind: "connection", documentId: "document-1", state: "connected" },
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
    ] as const;
    const decodedKinds = events.map((event) =>
      decodeDocumentRealtimeSseEvent(
        encodeDocumentRealtimeSseEvent(event),
      ).kind,
    );
    expect(decodedKinds.join(",")).toBe(
      "connection,document-update,awareness,resync-required",
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
    expect(rejected).toBeTrue();
  });
});
