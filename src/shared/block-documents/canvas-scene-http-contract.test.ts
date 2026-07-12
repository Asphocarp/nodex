import { describe, expect, test } from "vitest";
import {
  decodeCanvasSceneMutationRequestHttp,
  decodeCanvasSceneSyncRequestHttp,
  encodeCanvasSceneMutationRequestHttp,
  encodeCanvasSceneSyncRequestHttp,
} from "./canvas-scene-http-contract";

describe("Canvas scene HTTP contract", () => {
  test("round-trips bounded sync and mutation requests with exact route scope", () => {
    const sync = decodeCanvasSceneSyncRequestHttp(
      encodeCanvasSceneSyncRequestHttp({
        version: 1,
        projectId: "project-1",
        documentId: "canvas-1",
        clientSessionId: "client-1",
        knownStoreEpoch: "store-1",
        knownGeneration: 1,
        knownHeadSeq: 2,
      }),
      "project-1",
      "canvas-1",
    );
    expect(sync.knownHeadSeq).toBe(2);
    const mutation = decodeCanvasSceneMutationRequestHttp(
      encodeCanvasSceneMutationRequestHttp({
        version: 1,
        mutationId: "mutation-1",
        projectId: "project-1",
        documentId: "canvas-1",
        storeEpoch: "store-1",
        generation: 1,
        baseHeadSeq: 2,
        clientSessionId: "client-1",
        elementCandidates: [],
        appStateIntents: {},
        fileAdditions: {},
      }),
      "project-1",
      "canvas-1",
    );
    expect(mutation.mutationId).toBe("mutation-1");
  });

  test("rejects a request whose Project route does not match", () => {
    const serialized = encodeCanvasSceneSyncRequestHttp({
      version: 1,
      projectId: "project-1",
      documentId: "canvas-1",
      clientSessionId: "client-1",
    });
    expect(() =>
      decodeCanvasSceneSyncRequestHttp(serialized, "project-2", "canvas-1"),
    ).toThrow("does not match its route");
  });
});
