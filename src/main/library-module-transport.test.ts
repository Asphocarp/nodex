import { describe, expect, test } from "vitest";

import type {
  LibraryModuleApplyResult,
  LibraryModuleReadResult,
} from "../shared/library-module";
import {
  LIBRARY_MODULE_APPLY_IPC_CHANNEL,
  LIBRARY_MODULE_READ_IPC_CHANNEL,
  registerLibraryModuleIpcHandler,
} from "./library-module-ipc";

const result = (): LibraryModuleReadResult => ({
  ok: true,
  value: {
    version: 4,
    profileId: "profile-1",
    libraryId: "library-1",
    storeEpoch: "epoch-1",
    changeLogSeq: 0,
    value: { kind: "metadata" },
  },
});

const operationId = "019f7399-7676-70ae-b2aa-168692b64d18";
const pageId = "019f7399-7676-70ae-b2aa-168692b64d19";
const documentId = "019f7399-7676-70ae-b2aa-168692b64d1a";
const canvasId = "019f7399-7676-70ae-b2aa-168692b64d1b";
const canvasDocumentId = "019f7399-7676-70ae-b2aa-168692b64d1c";
const applyRequest = {
  version: 4,
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
  value: {
    version: 4,
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
    changeLogSeq: 1,
    committedAt: "2026-07-18T00:00:00.000Z",
  },
});

describe("Library Module IPC", () => {
  test("derives Library identity and rejects untrusted senders", async () => {
    const received: unknown[] = [];
    const handlers = new Map<
      string,
      (event: unknown, request: unknown) => Promise<unknown>
    >();
    registerLibraryModuleIpcHandler({
      registerHandle: (channel, handler) => handlers.set(channel, handler),
      isTrustedEvent: (event) => event === "trusted",
      read: async (request) => {
        received.push(request);
        return result();
      },
      apply: async (request) => {
        received.push(request);
        return applyResult();
      },
    });
    const request = { version: 4, read: { mode: "metadata" } };
    expect(await handlers.get(LIBRARY_MODULE_READ_IPC_CHANNEL)?.(
      "trusted",
      request,
    )).toEqual(result());
    expect(await handlers.get(LIBRARY_MODULE_READ_IPC_CHANNEL)?.(
      "subframe",
      request,
    )).toMatchObject({ ok: false, error: { code: "invalid_request" } });
    expect(await handlers.get(LIBRARY_MODULE_APPLY_IPC_CHANNEL)?.(
      "trusted",
      applyRequest,
    )).toEqual(applyResult());
    const canvasRequest = {
      version: 4,
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
    expect(await handlers.get(LIBRARY_MODULE_APPLY_IPC_CHANNEL)?.(
      "trusted",
      canvasRequest,
    )).toEqual(applyResult());
    expect(await handlers.get(LIBRARY_MODULE_APPLY_IPC_CHANNEL)?.(
      "trusted",
      {
        ...canvasRequest,
        operation: {
          ...canvasRequest.operation,
          sceneJson: "{}",
        },
      },
    )).toMatchObject({ ok: false, error: { code: "invalid_request" } });
    expect(await handlers.get(LIBRARY_MODULE_APPLY_IPC_CHANNEL)?.(
      "subframe",
      applyRequest,
    )).toMatchObject({ ok: false, error: { code: "invalid_request" } });

    expect(received).toEqual([request, applyRequest, canvasRequest]);
  });
});
