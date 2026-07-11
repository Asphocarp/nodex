import { describe, expect, test } from "vitest";
import {
  CARD_HISTORY_CONTRACT_VERSION,
  MAX_CARD_HISTORY_PAGE_SIZE,
  type CardHistoryPage,
} from "./card-history";
import {
  CardHistoryContractError,
  parseCardHistoryCommandResult,
  parseListCardHistoryRequest,
} from "./card-history-transport";

const occurredAt = "2026-07-12T08:00:00.000Z";
const versionId = "version:history:1";

const page: CardHistoryPage = {
  version: CARD_HISTORY_CONTRACT_VERSION,
  projectId: "project:history",
  cardBlockId: "card:history",
  documentId: "document:history",
  entries: [
    {
      id: `document-version:${versionId}`,
      kind: "document_version",
      projectId: "project:history",
      cardBlockId: "card:history",
      documentId: "document:history",
      occurredAt,
      display: {
        category: "checkpoint",
        title: "Saved Card checkpoint",
        detail: "Before refactor",
        actorLabel: "Agent",
      },
      evidence: { status: "verified" },
      recovery: {
        kind: "restore_document_version",
        documentId: "document:history",
        versionId,
      },
      versionMetadata: {
        versionId,
        generation: 1,
        baseHeadSeq: 4,
        schemaKey: "nodex.card@1",
        schemaVersion: 1,
        cause: "manual",
        label: "Before refactor",
        checkpointHash: "a".repeat(64),
        byteLength: 42,
      },
    },
  ],
  nextCursor: {
    occurredAt,
    source: "document_version",
    versionId,
  },
};

const rejectsContract = (operation: () => unknown): boolean => {
  try {
    operation();
    return false;
  } catch (error) {
    return error instanceof CardHistoryContractError;
  }
};

describe("Card history transport contract", () => {
  test("parses one exact scoped request and source-specific cursor", () => {
    const request = parseListCardHistoryRequest({
      version: CARD_HISTORY_CONTRACT_VERSION,
      projectId: "project:history",
      cardBlockId: "card:history",
      pageSize: MAX_CARD_HISTORY_PAGE_SIZE,
      before: page.nextCursor,
    });
    expect(request.pageSize).toBe(MAX_CARD_HISTORY_PAGE_SIZE);
    expect(request.before?.source).toBe("document_version");
    expect(
      rejectsContract(() =>
        parseListCardHistoryRequest({
          ...request,
          unsupported: true,
        }),
      ),
    ).toBe(true);
    expect(
      rejectsContract(() =>
        parseListCardHistoryRequest({
          ...request,
          pageSize: MAX_CARD_HISTORY_PAGE_SIZE + 1,
        }),
      ),
    ).toBe(true);
    expect(
      rejectsContract(() =>
        parseListCardHistoryRequest({
          ...request,
          before: {
            occurredAt,
            source: "change_log",
            versionId,
          },
        }),
      ),
    ).toBe(true);
  });

  test("validates the complete page union, scope, and continuation cursor", () => {
    const result = parseCardHistoryCommandResult({ ok: true, value: page });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.entries[0]?.kind).toBe("document_version");
    expect(result.value.nextCursor?.source).toBe("document_version");

    expect(
      rejectsContract(() =>
        parseCardHistoryCommandResult({
          ok: true,
          value: {
            ...page,
            entries: [
              {
                ...page.entries[0],
                projectId: "project:foreign",
              },
            ],
          },
        }),
      ),
    ).toBe(true);
    expect(
      rejectsContract(() =>
        parseCardHistoryCommandResult({
          ok: true,
          value: {
            ...page,
            nextCursor: {
              occurredAt,
              source: "change_log",
              changeSeq: 7,
            },
          },
        }),
      ),
    ).toBe(true);
    expect(
      rejectsContract(() =>
        parseCardHistoryCommandResult({
          ok: true,
          value: {
            ...page,
            entries: [{ ...page.entries[0], rawUpdate: "secret" }],
          },
        }),
      ),
    ).toBe(true);
  });

  test("accepts only the stable typed error envelope", () => {
    const result = parseCardHistoryCommandResult({
      ok: false,
      error: {
        code: "card_not_found",
        message: "Card does not exist",
        retryable: false,
      },
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("card_not_found");
    expect(
      rejectsContract(() =>
        parseCardHistoryCommandResult({
          ok: false,
          error: {
            code: "sql_error",
            message: "SELECT * FROM private_table",
            retryable: false,
          },
        }),
      ),
    ).toBe(true);
  });
});
