import { describe, expect, test } from "bun:test";
import type {
  RelocationCommandError,
  RelocationIntent,
  RelocationResult,
} from "./contracts";
import {
  decodeRelocationHttpError,
  decodeRelocationHttpRequest,
  decodeRelocationHttpResult,
  encodeRelocationHttpError,
  encodeRelocationHttpRequest,
  encodeRelocationHttpResult,
} from "./relocation-transport";

const intent: RelocationIntent = {
  relocationId: "move-1",
  projectId: "project-1",
  storeEpoch: "epoch-1",
  rootBlockIds: ["block-a"],
  sourceDocumentId: "document-a",
  sourceGeneration: 2,
  target: {
    kind: "document",
    documentId: "document-b",
    generation: 3,
    beforeBlockId: "block-b",
  },
};

const result: RelocationResult = {
  relocationId: "move-1",
  projectId: "project-1",
  storeEpoch: "epoch-1",
  duplicate: false,
  rootBlockIds: ["block-a"],
  movedBlockIds: ["block-a", "block-a-child"],
  finalLocations: {
    "block-a": { kind: "document", documentId: "document-b" },
    "block-a-child": { kind: "document", documentId: "document-b" },
  },
  finalLocationRevisions: {
    "block-a": 2,
    "block-a-child": 4,
  },
  sourceCommit: {
    documentId: "document-a",
    generation: 2,
    baseHeadSeq: 4,
    headSeq: 5,
    updateId: "relocation:source",
    update: new Uint8Array([1, 2, 3]),
    stateVector: new Uint8Array([4, 5]),
  },
  targetCommit: {
    documentId: "document-b",
    generation: 3,
    baseHeadSeq: 7,
    headSeq: 8,
    updateId: "relocation:target",
    update: new Uint8Array([6, 7]),
    stateVector: new Uint8Array([8, 9, 10]),
  },
  changeLogSeq: 9,
  committedAt: "2026-07-11T01:02:03.000Z",
};

const throws = (operation: () => unknown): boolean => {
  try {
    operation();
    return false;
  } catch {
    return true;
  }
};

describe("Block relocation HTTP transport", () => {
  test("round-trips a route-scoped logical request", () => {
    const encoded = encodeRelocationHttpRequest("surface-1", intent);
    const decoded = decodeRelocationHttpRequest(
      encoded,
      "project-1",
      "document-a",
    );

    expect(decoded.clientSessionId).toBe("surface-1");
    expect(JSON.stringify(decoded.intent)).toBe(JSON.stringify(intent));
    expect(
      throws(() =>
        decodeRelocationHttpRequest(encoded, "project-2", "document-a"),
      ),
    ).toBeTrue();
  });

  test("round-trips both binary Document commits without base64 metadata", () => {
    const encoded = encodeRelocationHttpResult(result);
    const decoded = decodeRelocationHttpResult(encoded, intent);

    expect(decoded.sourceCommit.update?.join(",")).toBe("1,2,3");
    expect(decoded.sourceCommit.stateVector.join(",")).toBe("4,5");
    expect(decoded.targetCommit?.update?.join(",")).toBe("6,7");
    expect(decoded.targetCommit?.stateVector.join(",")).toBe("8,9,10");
    expect(JSON.stringify(decoded.finalLocations)).toBe(
      JSON.stringify(result.finalLocations),
    );
  });

  test("preserves compacted null updates on duplicate receipts", () => {
    const compacted: RelocationResult = {
      ...result,
      duplicate: true,
      sourceCommit: { ...result.sourceCommit, update: null },
      targetCommit: { ...result.targetCommit!, update: null },
    };
    const decoded = decodeRelocationHttpResult(
      encodeRelocationHttpResult(compacted),
      intent,
    );

    expect(decoded.duplicate).toBeTrue();
    expect(decoded.sourceCommit.update === null).toBeTrue();
    expect(decoded.targetCommit?.update === null).toBeTrue();
  });

  test("rejects a response from a different logical move", () => {
    expect(
      throws(() =>
        decodeRelocationHttpResult(encodeRelocationHttpResult(result), {
          ...intent,
          target: { ...intent.target, documentId: "document-c" },
        }),
      ),
    ).toBeTrue();
  });

  test("round-trips typed relocation failures", () => {
    const failure: RelocationCommandError = {
      code: "relocation_lease_timeout",
      message: "A surface did not flush",
      retryable: true,
      reloadRequired: false,
      relocationId: "move-1",
    };
    const decoded = decodeRelocationHttpError(
      encodeRelocationHttpError(failure),
    );

    expect(JSON.stringify(decoded)).toBe(JSON.stringify(failure));
  });
});
