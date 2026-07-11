import { describe, expect, test } from "vitest";
import {
  bindTrustedDocumentVersionCheckpoint,
  DocumentHistoryContractError,
  parseListDocumentVersions,
} from "./document-history-transport";
import {
  canonicalizeDocumentVersionRestoreIntent,
  parseDocumentVersionRestore,
} from "./document-operations";

const restoreRequest = {
  version: 1,
  mutationId: "restore:version-1",
  projectId: "project-1",
  storeEpoch: "epoch-1",
  documentId: "document-1",
  versionId: `document-version:${"a".repeat(64)}`,
  generation: 3,
  expectedHeadSeq: 17,
  clientSessionId: "untrusted-window",
  actor: { kind: "untrusted" },
} as const;

describe("Document history transport contracts", () => {
  test("parses restore as a bounded stable checkpoint identity", () => {
    const parsed = parseDocumentVersionRestore(restoreRequest);
    expect(parsed.versionId).toBe(restoreRequest.versionId);
    expect(parsed.expectedHeadSeq).toBe(17);
  });

  test("keeps host audit identity outside exact restore semantics", () => {
    const first = canonicalizeDocumentVersionRestoreIntent(restoreRequest);
    const retried = canonicalizeDocumentVersionRestoreIntent({
      ...restoreRequest,
      clientSessionId: "replacement-window",
      actor: { kind: "trusted", retry: true },
    });
    expect(first).toBe(retried);
  });

  test("binds checkpoint actor at the trusted transport boundary", () => {
    const bound = bindTrustedDocumentVersionCheckpoint(
      {
        version: 1,
        projectId: "project-1",
        storeEpoch: "epoch-1",
        documentId: "document-1",
        expectedGeneration: 2,
        expectedHeadSeq: 9,
        cause: "manual",
        actor: { kind: "spoofed" },
      },
      "project-1",
      "document-1",
      { kind: "electron_renderer", clientId: "window-1" },
    );
    expect(bound.actor.kind).toBe("electron_renderer");
    expect(bound.actor.clientId).toBe("window-1");
  });

  test("rejects partial pagination cursors and cross-scope checkpoints", () => {
    let cursorError: unknown;
    let scopeError: unknown;
    try {
      parseListDocumentVersions({
        projectId: "project-1",
        documentId: "document-1",
        before: { baseHeadSeq: 4 },
      });
    } catch (error) {
      cursorError = error;
    }
    try {
      bindTrustedDocumentVersionCheckpoint(
        {
          version: 1,
          projectId: "project-2",
          storeEpoch: "epoch-1",
          documentId: "document-1",
          expectedGeneration: 2,
          expectedHeadSeq: 9,
          cause: "manual",
          actor: {},
        },
        "project-1",
        "document-1",
        {},
      );
    } catch (error) {
      scopeError = error;
    }
    expect(cursorError instanceof DocumentHistoryContractError).toBe(true);
    expect(scopeError instanceof DocumentHistoryContractError).toBe(true);
  });
});
