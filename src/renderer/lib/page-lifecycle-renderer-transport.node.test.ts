import { describe, expect, test } from "vite-plus/test";
import type { PageLifecycleMutationRequestV2 } from "../../shared/page-lifecycle-v2";
import {
  createElectronRendererTransport,
  type ElectronRendererBridge,
} from "./electron-renderer-transport";

const request: PageLifecycleMutationRequestV2 = {
  operationId: "page-lifecycle-transport",
  projectId: "project/one",
  storeEpoch: "epoch-1",
  actor: { kind: "renderer_test" },
  operation: {
    kind: "archive_page",
    pageId: "card/one",
    expectedMetadataRevision: 3,
  },
};

const preflightResult = {
  ok: false,
  error: {
    code: "page_not_found",
    message: "Page does not exist",
    retryable: false,
  },
} as const;

const mutationResult = {
  ok: true,
  value: {
    version: 2,
    operationId: request.operationId,
    projectId: request.projectId,
    storeEpoch: request.storeEpoch,
    operationKind: "archive_page",
    pageId: "card/one",
    duplicate: false,
    metadataRevision: 4,
    parentRevision: 2,
    lifecycle: "archived",
    documentId: "document-1",
    documentGeneration: 1,
    documentHeadSeq: 5,
    databaseId: "database-1",
    dataSourceId: "source-1",
    membershipId: "membership-1",
    viewId: "view-1",
    libraryRankKey: "7fffffffffffffffffffffffffffffff",
    viewRankKey: "7fffffffffffffffffffffffffffffff",
    createdBlockIds: [],
    createdTagOptionIds: [],
    commitSeq: 5,
    committedAt: "2026-07-11T00:00:00.000Z",
  },
} as const;

describe("Page lifecycle renderer IPC", () => {
  test("invokes the typed preflight and mutation channels", async () => {
    const calls: Array<{ readonly channel: string; readonly args: unknown[] }> = [];
    const bridge = {
      invoke: async (channel: string, ...args: unknown[]) => {
        calls.push({ channel, args });
        return channel === "pages:lifecycle:preflight" ? preflightResult : mutationResult;
      },
    } as unknown as ElectronRendererBridge;
    const electron = createElectronRendererTransport(bridge);

    await expect(
      electron.readPageLifecyclePreflight(request.projectId, "card/one"),
    ).resolves.toEqual(preflightResult);
    await expect(electron.mutatePageLifecycle(request.projectId, request)).resolves.toEqual(
      mutationResult,
    );
    expect(calls[0]).toEqual({
      channel: "pages:lifecycle:preflight",
      args: [request.projectId, "card/one"],
    });
    expect(calls[1]).toEqual({
      channel: "pages:lifecycle:apply",
      args: [request.projectId, request],
    });
  });
});
