import { describe, expect, test } from "bun:test";
import {
  parseCardProjectTransferCommandResult,
  parseCardProjectTransferRequest,
} from "./card-project-transfer";

const request = () => ({
  version: 1,
  operationId: "transfer:1",
  storeEpoch: "epoch:1",
  sourceProjectId: "project:a",
  targetProjectId: "project:b",
  cardId: "card:1",
  expectedTopLevelRankKey: "1000",
  expectedBlocks: [
    {
      blockId: "block:body",
      type: "paragraph",
      lifecycle: "active",
      location: { kind: "document", documentId: "document:card:1" },
      locationRevision: 1,
      metadataRevision: 2,
    },
    {
      blockId: "card:1",
      type: "card",
      lifecycle: "active",
      location: { kind: "space" },
      locationRevision: 3,
      metadataRevision: 4,
    },
  ],
  expectedDocuments: [
    {
      ownerBlockId: "card:1",
      documentId: "document:card:1",
      generation: 1,
      headSeq: 5,
      schemaKey: "nodex.card",
      schemaVersion: 1,
    },
  ],
  expectedMemberships: [
    {
      cardBlockId: "card:1",
      membershipId: "membership:card:1",
      databaseBlockId: "database:project:a:primary",
      databaseSchemaRevision: 1,
      membershipRevision: 2,
      statusPropertyId: "database:project:a:primary:property:status",
      statusValueRevision: 3,
      status: "in_progress",
    },
  ],
  target: {
    databaseBlockId: "database:project:b:primary",
    databaseSchemaRevision: 7,
    viewId: "database-view:project:b:primary-kanban",
    viewRevision: 8,
    status: "in_review",
    beforeBlockId: "card:target",
    beforeViewCardId: "card:target",
  },
  clientSessionId: "session:1",
  actor: { kind: "test", nested: { answer: 42 } },
});

describe("Card Project transfer contract", () => {
  test("parses one exact closure and rejects unstable ordering", () => {
    const parsed = parseCardProjectTransferRequest(request());
    expect(parsed.expectedBlocks.length).toBe(2);
    expect(parsed.target.status).toBe("in_review");
    expect(parsed.actor.kind).toBe("test");

    const reversed = request();
    reversed.expectedBlocks.reverse();
    let rejected = false;
    try {
      parseCardProjectTransferRequest(reversed);
    } catch {
      rejected = true;
    }
    expect(rejected).toBeTrue();
  });

  test("parses committed and rejected exact-retry results", () => {
    const committed = parseCardProjectTransferCommandResult({
      ok: true,
      value: {
        version: 1,
        operationId: "transfer:1",
        storeEpoch: "epoch:1",
        sourceProjectId: "project:a",
        targetProjectId: "project:b",
        cardId: "card:1",
        duplicate: false,
        movedBlockIds: ["block:body", "card:1"],
        movedDocumentIds: ["document:card:1"],
        sourceMembershipIds: ["membership:card:1"],
        targetMembershipIds: { "card:1": "membership:target" },
        blockMetadataRevisions: { "block:body": 3, "card:1": 5 },
        rootLocationRevision: 4,
        documentHeads: {
          "document:card:1": { generation: 1, headSeq: 5 },
        },
        targetDatabaseBlockId: "database:project:b:primary",
        targetDatabaseSchemaRevision: 8,
        targetViewId: "database-view:project:b:primary-kanban",
        targetStatus: "in_review",
        targetTopLevelRankKey: "2000",
        targetViewRankKey: "3000",
        changeLogSeq: 9,
        committedAt: "2026-07-12T00:00:00.000Z",
      },
    });
    expect(committed.ok).toBeTrue();

    const rejected = parseCardProjectTransferCommandResult({
      ok: false,
      error: {
        code: "document_authority_conflict",
        message: "Document head changed",
        retryable: false,
        operationId: "transfer:1",
        cardId: "card:1",
      },
    });
    expect(rejected.ok).toBeFalse();
  });
});
