import { describe, expect, test } from "bun:test";
import type { RelocateBlocks } from "./contracts";
import {
  canonicalizeRelocationRequest,
  encodeRelocationRequestHashInput,
  isRelocationRequestHash,
  makeRelocationDocumentUpdateId,
  parseRelocateBlocks,
  parseRelocationResult,
} from "./relocation";

const bytes = (...values: number[]): Uint8Array => Uint8Array.from(values);

const makeRequest = (): RelocateBlocks => ({
  relocationId: "relocation-1",
  projectId: "project-1",
  storeEpoch: "epoch-1",
  rootBlockIds: ["block-b", "block-a"],
  sourceDocumentId: "document-source",
  sourceGeneration: 2,
  expectedSourceHeadSeq: 7,
  expectedLocationRevisions: {
    "block-b": 4,
    "block-a": 9,
  },
  target: {
    kind: "document",
    documentId: "document-target",
    generation: 3,
    expectedHeadSeq: 11,
    parentBlockId: "target-parent",
    beforeBlockId: "target-anchor",
  },
});

const rejects = (run: () => unknown): boolean => {
  try {
    run();
    return false;
  } catch {
    return true;
  }
};

describe("atomic Block relocation contracts", () => {
  test("parses every source and target concurrency boundary", () => {
    const request = parseRelocateBlocks(makeRequest());
    expect(request.projectId).toBe("project-1");
    expect(request.sourceGeneration).toBe(2);
    expect(request.expectedSourceHeadSeq).toBe(7);
    expect(request.expectedLocationRevisions["block-a"]).toBe(9);
    expect(request.target.kind).toBe("document");
    if (request.target.kind !== "document") return;
    expect(request.target.generation).toBe(3);
    expect(request.target.expectedHeadSeq).toBe(11);
  });

  test("canonicalizes equivalent revision-map order to identical hash input", () => {
    const first = makeRequest();
    const second: RelocateBlocks = {
      ...first,
      rootBlockIds: ["block-a", "block-b"],
      expectedLocationRevisions: {
        "block-a": 9,
        "block-b": 4,
      },
    };
    expect(canonicalizeRelocationRequest(first)).toBe(
      canonicalizeRelocationRequest(second),
    );
    expect(Array.from(encodeRelocationRequestHashInput(first)).join(",")).toBe(
      Array.from(encodeRelocationRequestHashInput(second)).join(","),
    );
  });

  test("derives deterministic source and target update identities from a request hash", () => {
    const hash = "a".repeat(64);
    expect(isRelocationRequestHash(hash)).toBeTrue();
    expect(isRelocationRequestHash("A".repeat(64))).toBeFalse();
    expect(makeRelocationDocumentUpdateId(hash, "source")).toBe(
      `relocation:${hash}:source`,
    );
    expect(makeRelocationDocumentUpdateId(hash, "target")).toBe(
      `relocation:${hash}:target`,
    );
    expect(
      rejects(() => makeRelocationDocumentUpdateId("not-a-hash", "source")),
    ).toBeTrue();
  });

  test("rejects ambiguous roots, preconditions, target cycles, and unknown fields", () => {
    const base = makeRequest();
    expect(
      rejects(() =>
        parseRelocateBlocks({
          ...base,
          rootBlockIds: ["block-a", "block-a"],
        }),
      ),
    ).toBeTrue();
    expect(
      rejects(() =>
        parseRelocateBlocks({
          ...base,
          expectedLocationRevisions: { "block-a": 9 },
        }),
      ),
    ).toBeTrue();
    expect(
      rejects(() =>
        parseRelocateBlocks({
          ...base,
          target: {
            kind: "document",
            documentId: base.sourceDocumentId,
            generation: 2,
            expectedHeadSeq: 7,
          },
        }),
      ),
    ).toBeTrue();
    expect(
      rejects(() =>
        parseRelocateBlocks({
          ...base,
          target: {
            kind: "document",
            documentId: "document-target",
            generation: 3,
            expectedHeadSeq: 11,
            parentBlockId: "block-a",
          },
        }),
      ),
    ).toBeTrue();
    expect(
      rejects(() => parseRelocateBlocks({ ...base, unexpected: true })),
    ).toBeTrue();
  });

  test("validates a relocation result against both Document commits", () => {
    const request = makeRequest();
    const sourceUpdate = bytes(1, 2, 3);
    const targetUpdate = bytes(4, 5, 6);
    const result = parseRelocationResult(
      {
        relocationId: request.relocationId,
        projectId: request.projectId,
        storeEpoch: request.storeEpoch,
        duplicate: false,
        rootBlockIds: ["block-b", "block-a"],
        movedBlockIds: ["block-b", "block-a", "block-child"],
        finalLocations: {
          "block-a": { kind: "document", documentId: "document-target" },
          "block-b": { kind: "document", documentId: "document-target" },
          "block-child": {
            kind: "document",
            documentId: "document-target",
          },
        },
        finalLocationRevisions: {
          "block-a": 10,
          "block-b": 5,
          "block-child": 2,
        },
        sourceCommit: {
          documentId: "document-source",
          generation: 2,
          baseHeadSeq: 7,
          headSeq: 8,
          updateId: "source-update",
          update: sourceUpdate,
          stateVector: bytes(7),
        },
        targetCommit: {
          documentId: "document-target",
          generation: 3,
          baseHeadSeq: 11,
          headSeq: 12,
          updateId: "target-update",
          update: targetUpdate,
          stateVector: bytes(8),
        },
        changeLogSeq: 3,
        committedAt: "2026-07-11T12:00:00.000Z",
      },
      request,
    );
    expect(result.sourceCommit.update === sourceUpdate).toBeTrue();
    expect(result.targetCommit?.update === targetUpdate).toBeTrue();
    expect(result.finalLocationRevisions["block-child"]).toBe(2);
  });

  test("requires a target commit only for Document targets", () => {
    const request: RelocateBlocks = {
      ...makeRequest(),
      target: { kind: "space", projectId: "project-2" },
    };
    const baseResult = {
      relocationId: request.relocationId,
      projectId: request.projectId,
      storeEpoch: request.storeEpoch,
      duplicate: true,
      rootBlockIds: ["block-b", "block-a"],
      movedBlockIds: ["block-a", "block-b"],
      finalLocations: {
        "block-a": { kind: "space", projectId: "project-2", rankKey: "a0" },
        "block-b": { kind: "space", projectId: "project-2", rankKey: "a1" },
      },
      finalLocationRevisions: { "block-a": 10, "block-b": 5 },
      sourceCommit: {
        documentId: "document-source",
        generation: 2,
        baseHeadSeq: 7,
        headSeq: 8,
        updateId: "source-update",
        update: null,
        stateVector: bytes(2),
      },
      changeLogSeq: 3,
      committedAt: "2026-07-11T12:00:00.000Z",
    };
    expect(parseRelocationResult(baseResult, request).duplicate).toBeTrue();
    expect(
      rejects(() =>
        parseRelocationResult(
          {
            ...baseResult,
            targetCommit: {
              documentId: "unexpected",
              generation: 1,
              baseHeadSeq: 0,
              headSeq: 1,
              updateId: "unexpected",
              update: bytes(1),
              stateVector: bytes(2),
            },
          },
          request,
        ),
      ),
    ).toBeTrue();
  });
});
