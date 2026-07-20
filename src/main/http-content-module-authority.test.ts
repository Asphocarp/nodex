import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import type {
  BlockTransferCommandResult,
  BlockTransferIntent,
} from "../shared/block-transfer";
import { decodeBlockTransferHttpResult } from "../shared/block-transfer-transport";
import type { LibraryModuleApplyResult } from "../shared/library-module";
import {
  __resetHttpServerDependenciesForTests,
  __setHttpContentModuleDependenciesForTests,
  getHttpServerOptions,
} from "./http-server";

const PORT = 51_283;

describe("HTTP content Module authority", () => {
  beforeEach(() => {
    __resetHttpServerDependenciesForTests();
  });

  afterEach(() => {
    __resetHttpServerDependenciesForTests();
  });

  test("routes Page Detail reads through the configured authority", async () => {
    const read = vi.fn(async () => ({
      ok: false as const,
      error: {
        code: "page_not_found" as const,
        message: "native Page Detail sentinel",
        retryable: false,
      },
    }));
    __setHttpContentModuleDependenciesForTests({ pageDetail: { read } });

    const response = await getHttpServerOptions(PORT).fetch(new Request(
      `http://127.0.0.1:${PORT}/api/projects/project-native/pages/page-native`,
    ));

    expect(response.status).toBe(404);
    expect(read).toHaveBeenCalledWith("project-native", "page-native");
    await expect(response.json()).resolves.toMatchObject({
      error: { message: "native Page Detail sentinel" },
    });
  });

  test("routes Project Workspace reads through the configured authority", async () => {
    const listProjects = vi.fn(async () => []);
    __setHttpContentModuleDependenciesForTests({
      projectWorkspace: { listProjects } as never,
    });

    const response = await getHttpServerOptions(PORT).fetch(new Request(
      `http://127.0.0.1:${PORT}/api/projects`,
    ));

    expect(response.status).toBe(200);
    expect(listProjects).toHaveBeenCalledOnce();
    await expect(response.json()).resolves.toEqual({ projects: [] });
  });

  test("binds Block Transfer transport identity before the configured authority", async () => {
    const transfer = vi.fn(async (
      intent: BlockTransferIntent,
    ): Promise<BlockTransferCommandResult> => ({
      ok: true,
      value: {
        version: 1,
        operationId: intent.operationId,
        projectId: intent.projectId,
        storeEpoch: intent.storeEpoch,
        mode: intent.mode,
        duplicate: false,
        sourceRootBlockIds: [...intent.rootBlockIds],
        resultRootBlockIds: [...intent.rootBlockIds],
        copiedBlockIds: {},
        transformationEvidence: [],
        finalLocations: {
          "page-native": {
            kind: "space",
            projectId: intent.projectId,
            rankKey: "00000000000000000000000000000001",
          },
        },
        finalLocationRevisions: { "page-native": 2 },
        documentCommits: [],
        affectedDatabaseBlockIds: [],
        changeLogSeq: 9,
        committedAt: "2026-07-20T00:00:00.000Z",
      },
    }));
    __setHttpContentModuleDependenciesForTests({
      blockTransfer: { transfer },
    });

    const response = await getHttpServerOptions(PORT).fetch(new Request(
      `http://127.0.0.1:${PORT}/api/projects/project-native/block-transfers`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          version: 2,
          operationId: "transfer-native-http",
          projectId: "project-native",
          storeEpoch: "epoch-native",
          mode: "move",
          rootBlockIds: ["page-native"],
          source: { kind: "page", pageId: "parent-native" },
          target: { kind: "library", libraryId: "library-native" },
        }),
      },
    ));

    expect(response.status).toBe(200);
    expect(transfer).toHaveBeenCalledOnce();
    expect(transfer.mock.calls[0]?.[0]).toMatchObject({
      projectId: "project-native",
      clientSessionId: "http-loopback:block-transfer",
      actor: { kind: "http_loopback", transport: "json" },
    });
    expect(decodeBlockTransferHttpResult(await response.json())).toMatchObject({
      ok: true,
      value: { operationId: "transfer-native-http" },
    });
  });

  test("routes trusted Library writes without requiring a renderer event", async () => {
    const apply = vi.fn(async (request): Promise<LibraryModuleApplyResult> => ({
      ok: true,
      value: {
        version: 1,
        operationId: request.operationId,
        storeEpoch: request.storeEpoch,
        libraryId: "library-native",
        operationKind: request.operation.kind,
        duplicate: false,
        didMutate: true,
        createdTarget: {
          kind: "page",
          pageId: "019c2000-0000-7000-8000-000000000002",
        },
        affectedParentKeys: ["library"],
        affectedPageIds: ["019c2000-0000-7000-8000-000000000002"],
        affectedDatabaseIds: [],
        affectedViewIds: [],
        committedRevisions: {},
        changeLogSeq: 10,
        committedAt: "2026-07-20T00:00:00.000Z",
      },
    }));
    __setHttpContentModuleDependenciesForTests({
      library: {
        read: async () => {
          throw new Error("unexpected read");
        },
        apply,
      },
    });

    const response = await getHttpServerOptions(PORT).fetch(new Request(
      `http://127.0.0.1:${PORT}/api/library-module/apply`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          version: 1,
          operationId: "019c2000-0000-7000-8000-000000000001",
          storeEpoch: "epoch-native",
          operation: {
            kind: "create_page",
            pageId: "019c2000-0000-7000-8000-000000000002",
            documentId: "019c2000-0000-7000-8000-000000000003",
            title: "Native HTTP Page",
            parent: { kind: "library" },
          },
        }),
      },
    ));

    expect(response.status).toBe(200);
    expect(apply).toHaveBeenCalledOnce();
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      value: {
        libraryId: "library-native",
        operationKind: "create_page",
      },
    });
  });
});
