import { describe, expect, test } from "vitest";
import {
  BLOCK_TRANSFER_CONTRACT_VERSION,
  BlockTransferContractError,
  canonicalizeBlockTransferIntent,
  canonicalizeBlockTransferLogicalIntent,
  blockTransferIntentFromRequest,
  parseBlockTransferIntent,
  parseBlockTransferRequest,
  type BlockTransferRequest,
} from "./block-transfer";

const request = (): BlockTransferRequest => ({
  version: BLOCK_TRANSFER_CONTRACT_VERSION,
  operationId: "transfer-1",
  projectId: "project-1",
  storeEpoch: "epoch-1",
  clientSessionId: "window-1",
  actor: { kind: "test", nested: { b: 2, a: 1 } },
  mode: "move",
  rootBlockIds: ["card-1"],
  expectedLocationRevisions: { "card-1": 3 },
  source: {
    kind: "database",
    databaseBlockId: "database-a",
    dataSourceId: "source-a",
    memberships: {
      "card-1": { membershipId: "membership-a", revision: 4 },
    },
  },
  target: {
    kind: "document",
    documentId: "document-b",
    generation: 1,
    expectedHeadSeq: 8,
    beforeBlockId: "paragraph-b",
  },
});

describe("BlockTransfer contract", () => {
  test("round-trips an exclusive Database-to-Document parent move", () => {
    expect(parseBlockTransferRequest(request())).toEqual(request());
  });

  test("excludes transport attempt identity from canonical intent", () => {
    const first = request();
    const second = { ...first, clientSessionId: "window-after-reconnect" };
    expect(canonicalizeBlockTransferIntent(first)).toBe(
      canonicalizeBlockTransferIntent(second),
    );
  });

  test("keeps freshness evidence out of the public logical intent", () => {
    const logical = blockTransferIntentFromRequest(request());
    expect(parseBlockTransferIntent(logical)).toEqual(logical);
    expect(logical.source).toEqual({
      kind: "data_source",
      dataSourceId: "source-a",
    });
    expect(logical.target).toEqual({
      kind: "document",
      documentId: "document-b",
      beforeBlockId: "paragraph-b",
    });
    expect(canonicalizeBlockTransferLogicalIntent(logical)).not.toContain(
      "expectedHeadSeq",
    );
    expect(canonicalizeBlockTransferLogicalIntent(logical)).not.toContain(
      "revision",
    );
  });

  test("rejects incomplete revision evidence and same-parent reorder seams", () => {
    expect(() =>
      parseBlockTransferRequest({
        ...request(),
        expectedLocationRevisions: {},
      }),
    ).toThrow(BlockTransferContractError);
    expect(() =>
      parseBlockTransferRequest({
        ...request(),
        source: {
          kind: "document",
          documentId: "document-b",
          generation: 1,
          expectedHeadSeq: 8,
        },
      }),
    ).toThrow(/reorder within one Document/);
    expect(() =>
      parseBlockTransferRequest({
        ...request(),
        source: {
          kind: "database",
          databaseBlockId: "database-b",
          memberships: {
            "card-1": { membershipId: "membership-b", revision: 1 },
          },
        },
        target: {
          kind: "database",
          databaseBlockId: "database-b",
          viewId: "view-b",
          groupKey: null,
        },
      }),
    ).toThrow(/reorder within one Data Source/);
  });

  test("allows a parent move between Data Sources in one Database", () => {
    expect(
      parseBlockTransferRequest({
        ...request(),
        target: {
          kind: "database",
          databaseBlockId: "database-a",
          dataSourceId: "source-b",
          viewId: "view-b",
          groupKey: "backlog",
        },
      }).target,
    ).toMatchObject({ dataSourceId: "source-b" });
  });

  test("rejects transferred roots as target anchors", () => {
    expect(() =>
      parseBlockTransferRequest({
        ...request(),
        target: {
          kind: "space",
          beforeBlockId: "card-1",
        },
      }),
    ).toThrow(/cannot be a transferred root/);
  });

  test("allows Copy into the same parent because it creates fresh identity", () => {
    expect(
      parseBlockTransferRequest({
        ...request(),
        mode: "copy",
        target: {
          kind: "database",
          databaseBlockId: "database-a",
          viewId: "view-a",
          groupKey: null,
        },
      }).mode,
    ).toBe("copy");
  });
});
