import { Hono } from "hono";
import { describe, expect, test } from "vitest";

import type {
  LibraryModuleApplyResult,
  LibraryModuleReadResult,
} from "../shared/library-module";
import { registerLibraryModuleHttpRoute } from "./library-module-http";
import {
  LIBRARY_MODULE_APPLY_IPC_CHANNEL,
  LIBRARY_MODULE_READ_IPC_CHANNEL,
  registerLibraryModuleIpcHandler,
} from "./library-module-ipc";

const result = (): LibraryModuleReadResult => ({
  ok: true,
  value: {
    version: 1,
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
const applyRequest = {
  version: 1,
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
    version: 1,
    operationId,
    storeEpoch: "epoch-1",
    libraryId: "library-1",
    operationKind: "create_page",
    duplicate: false,
    didMutate: true,
    createdTarget: { kind: "page", pageId },
    affectedParentKeys: ["library"],
    affectedPageIds: [pageId],
    affectedDatabaseIds: [],
    affectedViewIds: [],
    committedRevisions: { [`blockLocation:${pageId}`]: 1 },
    changeLogSeq: 1,
    committedAt: "2026-07-18T00:00:00.000Z",
  },
});

describe("Library Module IPC/HTTP transport", () => {
  test("derives Library identity instead of accepting one from either transport", async () => {
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
    const request = { version: 1, read: { mode: "metadata" } };
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
    expect(await handlers.get(LIBRARY_MODULE_APPLY_IPC_CHANNEL)?.(
      "subframe",
      applyRequest,
    )).toMatchObject({ ok: false, error: { code: "invalid_request" } });

    const app = new Hono();
    registerLibraryModuleHttpRoute(app, {
      read: async (bound) => {
        received.push(bound);
        return result();
      },
      apply: async (bound) => {
        received.push(bound);
        return applyResult();
      },
    });
    const response = await app.request("/api/library-module/read", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(request),
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(result());
    const applyResponse = await app.request("/api/library-module/apply", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(applyRequest),
    });
    expect(applyResponse.status).toBe(200);
    expect(await applyResponse.json()).toEqual(applyResult());
    expect(received).toEqual([request, applyRequest, request, applyRequest]);

    const forged = await app.request("/api/library-module/read", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...request, libraryId: "forged" }),
    });
    expect(forged.status).toBe(400);
    expect(received).toHaveLength(4);
  });
});
