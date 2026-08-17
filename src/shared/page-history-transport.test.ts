import { describe, expect, test } from "vitest";
import {
  MAX_PAGE_HISTORY_PAGE_SIZE,
  type PageHistoryPage,
} from "./page-history";
import {
  PageHistoryContractError,
  parsePageHistoryCommandResult,
  parseListPageHistoryRequest,
} from "./page-history-transport";

const occurredAt = "2026-07-12T08:00:00.000Z";
const versionId = "version:history:1";

const page: PageHistoryPage = {
  libraryId: "library:history",
  pageId: "card:history",
  documentId: "document:history",
  entries: [
    {
      id: `document-version:${versionId}`,
      kind: "document_version",
      libraryId: "library:history",
      pageId: "card:history",
      documentId: "document:history",
      occurredAt,
      display: {
        category: "checkpoint",
        title: "Saved Page checkpoint",
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
        schemaKey: "nodex.page@1",
        schemaVersion: 1,
        cause: "manual",
        label: "Before refactor",
        revisionKind: "manual",
        sourceMutationId: null,
        sourceChangeSeq: null,
        pinned: true,
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
    return error instanceof PageHistoryContractError;
  }
};

describe("Page history transport contract", () => {
  test("parses one exact scoped request and source-specific cursor", () => {
    const request = parseListPageHistoryRequest({
      requestingProjectId: "project:history",
      pageId: "card:history",
      pageSize: MAX_PAGE_HISTORY_PAGE_SIZE,
      before: page.nextCursor,
    });
    expect(request.pageSize).toBe(MAX_PAGE_HISTORY_PAGE_SIZE);
    expect(request.before?.source).toBe("document_version");
    expect(
      rejectsContract(() =>
        parseListPageHistoryRequest({
          ...request,
          unsupported: true,
        }),
      ),
    ).toBe(true);
    expect(
      rejectsContract(() =>
        parseListPageHistoryRequest({
          ...request,
          pageSize: MAX_PAGE_HISTORY_PAGE_SIZE + 1,
        }),
      ),
    ).toBe(true);
    expect(
      rejectsContract(() =>
        parseListPageHistoryRequest({
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
    const result = parsePageHistoryCommandResult({ ok: true, value: page });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.entries[0]?.kind).toBe("document_version");
    expect(result.value.nextCursor?.source).toBe("document_version");

    expect(
      rejectsContract(() =>
        parsePageHistoryCommandResult({
          ok: true,
          value: {
            ...page,
            entries: [
              {
                ...page.entries[0],
                libraryId: "library:foreign",
              },
            ],
          },
        }),
      ),
    ).toBe(true);
    expect(
      rejectsContract(() =>
        parsePageHistoryCommandResult({
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
        parsePageHistoryCommandResult({
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
    const result = parsePageHistoryCommandResult({
      ok: false,
      error: {
        code: "page_not_found",
        message: "Page does not exist",
        retryable: false,
      },
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("page_not_found");
    expect(
      rejectsContract(() =>
        parsePageHistoryCommandResult({
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
