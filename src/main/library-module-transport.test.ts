import { describe, expect, test } from "vite-plus/test";

import type { LibraryModuleApplyResult, LibraryModuleReadResult } from "../shared/library-module";
import { libraryContentAccess, projectContentAccess } from "../shared/content-access-context";
import {
  LIBRARY_MODULE_APPLY_IPC_CHANNEL,
  LIBRARY_MODULE_READ_IPC_CHANNEL,
  registerLibraryModuleIpcHandler,
} from "./library-module-ipc";

const result = (): LibraryModuleReadResult => ({
  ok: true,
  value: {
    profileId: "profile-1",
    libraryId: "library-1",
    storeEpoch: "epoch-1",
    commitSeq: 0,
    authorization: null,
    value: { kind: "metadata" },
  },
});

const operationId = "019f7399-7676-70ae-b2aa-168692b64d18";
const pageId = "019f7399-7676-70ae-b2aa-168692b64d19";
const documentId = "019f7399-7676-70ae-b2aa-168692b64d1a";
const canvasId = "019f7399-7676-70ae-b2aa-168692b64d1b";
const canvasDocumentId = "019f7399-7676-70ae-b2aa-168692b64d1c";
const applyRequest = {
  operationId,
  storeEpoch: "epoch-1",
  operation: {
    kind: "create_page",
    pageId,
    documentId,
    title: "Research",
    parent: { kind: "library" },
  },
} as const;
const applyResult = (): LibraryModuleApplyResult => ({
  ok: true,
  localCommit: {
    status: "no_op",
    observed: { store_epoch: "epoch-1", commit_head: 1 },
  },
  value: {
    operationId,
    storeEpoch: "epoch-1",
    libraryId: "library-1",
    operationKind: "create_page",
    duplicate: false,
    didMutate: true,
    createdTarget: { kind: "page", pageId },
    canvasMutation: null,
    affectedParentKeys: ["library"],
    affectedPageIds: [pageId],
    affectedDatabaseIds: [],
    affectedViewIds: [],
    committedRevisions: { [`blockLocation:${pageId}`]: 1 },
    commitSeq: 1,
    committedAt: "2026-07-18T00:00:00.000Z",
  },
});

describe("Library Module IPC", () => {
  test("derives Library identity and rejects untrusted senders", async () => {
    const received: unknown[] = [];
    const handlers = new Map<
      string,
      (event: unknown, accessContext: unknown, request: unknown) => Promise<unknown>
    >();
    registerLibraryModuleIpcHandler({
      registerHandle: (channel, handler) => handlers.set(channel, handler),
      isTrustedEvent: (event) => event === "trusted",
      read: async (accessContext, request) => {
        received.push({ accessContext, request });
        return result();
      },
      apply: async (accessContext, request) => {
        received.push({ accessContext, request });
        return applyResult();
      },
    });
    const request = {
      read: { mode: "metadata" },
    } as const;
    expect(
      await handlers.get(LIBRARY_MODULE_READ_IPC_CHANNEL)?.(
        "trusted",
        libraryContentAccess,
        request,
      ),
    ).toEqual(result());
    expect(
      await handlers.get(LIBRARY_MODULE_READ_IPC_CHANNEL)?.(
        "subframe",
        libraryContentAccess,
        request,
      ),
    ).toMatchObject({ ok: false, error: { code: "invalid_request" } });
    expect(
      await handlers.get(LIBRARY_MODULE_APPLY_IPC_CHANNEL)?.(
        "trusted",
        libraryContentAccess,
        applyRequest,
      ),
    ).toEqual(applyResult());
    const canvasRequest = {
      operationId: "019f7399-7676-70ae-b2aa-168692b64d1d",
      storeEpoch: "epoch-1",
      operation: {
        kind: "create_canvas",
        canvasId,
        documentId: canvasDocumentId,
        displayName: "Research map",
        destination: {
          kind: "page",
          pageId,
          expectedDocumentGeneration: 1,
          expectedDocumentHeadSeq: 3,
          insertion: {
            kind: "replace_empty_paragraph",
            blockId: documentId,
          },
        },
      },
    } as const;
    expect(
      await handlers.get(LIBRARY_MODULE_APPLY_IPC_CHANNEL)?.(
        "trusted",
        projectContentAccess("project:test"),
        canvasRequest,
      ),
    ).toEqual(applyResult());
    expect(
      await handlers.get(LIBRARY_MODULE_APPLY_IPC_CHANNEL)?.(
        "trusted",
        projectContentAccess("project:test"),
        {
          ...canvasRequest,
          operation: {
            ...canvasRequest.operation,
            sceneJson: "{}",
          },
        },
      ),
    ).toMatchObject({ ok: false, error: { code: "invalid_request" } });
    expect(
      await handlers.get(LIBRARY_MODULE_APPLY_IPC_CHANNEL)?.(
        "subframe",
        libraryContentAccess,
        applyRequest,
      ),
    ).toMatchObject({ ok: false, error: { code: "invalid_request" } });

    expect(
      await handlers.get(LIBRARY_MODULE_APPLY_IPC_CHANNEL)?.(
        "trusted",
        { kind: "project", projectId: " project:test" },
        applyRequest,
      ),
    ).toMatchObject({ ok: false, error: { code: "invalid_request" } });

    expect(received).toEqual([
      { accessContext: libraryContentAccess, request },
      { accessContext: libraryContentAccess, request: applyRequest },
      {
        accessContext: projectContentAccess("project:test"),
        request: canvasRequest,
      },
    ]);
  });
});
