import { describe, expect, test } from "vitest";

import {
  buildMoveBlockOperation,
  buildPromoteBlockToPageOperation,
} from "./operations";

const precondition = {
  blockRevision: 3,
  placementRevision: 4,
  observedCursor: { storeEpoch: "epoch:test", commitSeq: 8 },
} as const;

test("builds a stable move batch that can be retried without changing semantics", () => {
  const input = {
    operationId: "move:title-a",
    intentHash: "hash:move:title-a",
    libraryId: "library:test",
    actorId: "actor:test",
    sessionId: "session:test",
    rootBlockId: "title-a",
    from: { kind: "block", blockId: "page-a" } as const,
    to: { kind: "block", blockId: "page-b" } as const,
    rankKey: "00000000000000000020",
    precondition,
  };

  expect(buildMoveBlockOperation(input)).toEqual(buildMoveBlockOperation(input));
  expect(buildMoveBlockOperation(input).operations[0]).toMatchObject({
    kind: "move_block",
    rootBlockId: "title-a",
    to: { kind: "block", blockId: "page-b" },
  });
});

test("promotion retains the root identity and explicitly carries Board membership", () => {
  const batch = buildPromoteBlockToPageOperation({
    operationId: "promote:title-a",
    intentHash: "hash:promote:title-a",
    libraryId: "library:test",
    actorId: "actor:test",
    sessionId: "session:test",
    rootBlockId: "title-a",
    from: { kind: "block", blockId: "page-a" },
    targetDataSourceId: "data-source:board",
    viewId: "view:board",
    viewRankKey: "00000000000000000030",
    precondition,
  });

  expect(batch.operations).toEqual([{
    kind: "promote_block_to_page",
    rootBlockId: "title-a",
    from: { kind: "block", blockId: "page-a" },
    targetDataSourceId: "data-source:board",
    viewId: "view:board",
    viewRankKey: "00000000000000000030",
    precondition,
  }]);
});

describe("operation validation", () => {
  test("rejects self-parent moves before transport", () => {
    expect(() => buildMoveBlockOperation({
      operationId: "move:self",
      intentHash: "hash:self",
      libraryId: "library:test",
      actorId: "actor:test",
      sessionId: "session:test",
      rootBlockId: "title-a",
      from: { kind: "block", blockId: "page-a" },
      to: { kind: "block", blockId: "title-a" },
      rankKey: "10",
      precondition,
    })).toThrow("under itself");
  });

  test("rejects blank identity and rank values", () => {
    expect(() => buildMoveBlockOperation({
      operationId: " ",
      intentHash: "hash",
      libraryId: "library:test",
      actorId: "actor:test",
      sessionId: "session:test",
      rootBlockId: "title-a",
      from: { kind: "library", libraryId: "library:test" },
      to: { kind: "library", libraryId: "library:test" },
      rankKey: "10",
      precondition,
    })).toThrow("operationId");
    expect(() => buildMoveBlockOperation({
      operationId: "move:title-a",
      intentHash: "hash",
      libraryId: "library:test",
      actorId: "actor:test",
      sessionId: "session:test",
      rootBlockId: "title-a",
      from: { kind: "library", libraryId: "library:test" },
      to: { kind: "library", libraryId: "library:test" },
      rankKey: " ",
      precondition,
    })).toThrow("rankKey");
  });
});
