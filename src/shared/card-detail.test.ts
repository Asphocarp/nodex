import { describe, expect, test } from "vitest";

import {
  CARD_DETAIL_CONTRACT_VERSION,
  parseCardDetail,
  parseCardDetailCommandResult,
} from "./card-detail";
import { plainTextToPortableRichText } from "./block-documents";

const intrinsicFields = [
  ["isAllDay", false],
  ["recurrence", null],
  ["reminders", []],
  ["scheduleTimezone", null],
  ["runInTarget", "localProject"],
  ["runInLocalPath", null],
  ["runInBaseBranch", null],
  ["runInWorktreePath", null],
  ["runInEnvironmentPath", null],
] as const;

const detail = () => ({
  version: CARD_DETAIL_CONTRACT_VERSION,
  card: {
    blockId: "card-1",
    projectId: "project-1",
    lifecycle: "active",
    location: { kind: "document", documentId: "document-host" },
    locationRevision: 2,
    metadataRevision: 1,
    documentId: "document-card-1",
    documentGeneration: 1,
    documentHeadSeq: 4,
    documentAuthority: "ydoc_primary",
    content: {
      projectedSeq: 4,
      title: "Nested Card",
      richTitle: plainTextToPortableRichText("Nested Card"),
      preview: "Body",
      plainText: "Nested Card\nBody",
    },
    createdAt: "2026-07-14T00:00:00.000Z",
    updatedAt: "2026-07-14T00:00:00.000Z",
  },
  document: {
    readiness: "ready",
    schemaKey: "nodex.card",
    schemaVersion: 2,
  },
  properties: {
    projectId: "project-1",
    storeEpoch: "epoch-1",
    changeLogSeq: 9,
    cardBlockId: "card-1",
    metadataRevision: 1,
    fields: intrinsicFields.map(([field, value]) => ({
      scope: "intrinsic",
      field,
      revision: 1,
      value,
    })),
  },
  databaseContext: { kind: "standalone" },
});

describe("Card Detail contract", () => {
  test("rejects the retired v1 Card property vocabulary", () => {
    const legacy = { ...detail(), version: 1 };

    expect(() => parseCardDetail(legacy)).toThrow(
      "cardDetail.version must be 2",
    );
  });

  test("accepts a Document-parented Card without Database coordinates", () => {
    const parsed = parseCardDetail(detail());

    expect(parsed.card.blockId).toBe("card-1");
    expect(parsed.card.location).toEqual({
      kind: "document",
      documentId: "document-host",
    });
    expect(parsed.databaseContext).toEqual({ kind: "standalone" });
  });

  test("rejects a standalone context carrying Database authority", () => {
    const input = detail();
    input.properties.fields.push({
      scope: "database",
      field: "status",
      databaseBlockId: "database-1",
      propertyId: "property-status",
      revision: 1,
      value: "draft",
    } as never);

    expect(() => parseCardDetail(input)).toThrow(
      "Standalone Card cannot include Database property coordinates",
    );
  });

  test("preserves typed not-found outcomes", () => {
    expect(parseCardDetailCommandResult({
      ok: false,
      error: {
        code: "card_not_found",
        message: "Card was not found",
        retryable: false,
      },
    })).toEqual({
      ok: false,
      error: {
        code: "card_not_found",
        message: "Card was not found",
        retryable: false,
      },
    });
  });
});
