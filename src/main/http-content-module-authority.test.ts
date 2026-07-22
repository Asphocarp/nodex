import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import type {
  BlockTransferCommandResult,
  BlockTransferIntent,
} from "../shared/block-transfer";
import { decodeBlockTransferHttpResult } from "../shared/block-transfer-transport";
import type { LibraryModuleApplyResult } from "../shared/library-module";
import { CoreModuleResponseError } from "./core-client/core-client";
import {
  __resetHttpServerDependenciesForTests,
  __setHttpContentModuleDependenciesForTests,
  __setHttpServerDependenciesForTests,
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
    expect(listProjects).toHaveBeenCalledWith({ includeArchived: false });
    await expect(response.json()).resolves.toEqual({ projects: [] });
  });

  test("opts into archived Project collection reads through the query string", async () => {
    const listProjects = vi.fn(async () => []);
    __setHttpContentModuleDependenciesForTests({
      projectWorkspace: { listProjects } as never,
    });

    const response = await getHttpServerOptions(PORT).fetch(new Request(
      `http://127.0.0.1:${PORT}/api/projects?includeArchived=true`,
    ));

    expect(response.status).toBe(200);
    expect(listProjects).toHaveBeenCalledWith({ includeArchived: true });
  });

  test("restores a retained Project through the lifecycle route", async () => {
    const archivedProject = {
      id: "project-native",
      libraryId: "library-native",
      databaseId: "database-native",
      lifecycle: "archived" as const,
      bindingRevision: 3,
      name: "Native",
      description: "",
      sources: [],
      primaryWorkspaceRoot: null,
      pinned: false,
      pinnedOrder: null,
      created: new Date("2026-01-01T00:00:00.000Z"),
      updated: new Date("2026-07-22T00:00:00.000Z"),
    };
    const setProjectLifecycle = vi.fn(async (_projectId, lifecycle) => ({
      ...archivedProject,
      lifecycle,
      bindingRevision: 4,
    }));
    __setHttpContentModuleDependenciesForTests({
      projectWorkspace: {
        getProject: async () => archivedProject,
        setProjectLifecycle,
      } as never,
    });

    const response = await getHttpServerOptions(PORT).fetch(new Request(
      `http://127.0.0.1:${PORT}/api/projects/project-native/lifecycle`,
      {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ lifecycle: "active" }),
      },
    ));

    expect(response.status).toBe(200);
    expect(setProjectLifecycle).toHaveBeenCalledWith("project-native", "active");
    await expect(response.json()).resolves.toMatchObject({
      kind: "updated",
      changed: true,
      project: { id: "project-native", lifecycle: "active", bindingRevision: 4 },
    });
  });

  test("maps a Project restore binding conflict to HTTP 409", async () => {
    const archivedProject = {
      id: "project-native",
      lifecycle: "archived" as const,
    };
    __setHttpContentModuleDependenciesForTests({
      projectWorkspace: {
        getProject: async () => archivedProject,
        setProjectLifecycle: async () => {
          throw new CoreModuleResponseError({
            code: "revision_conflict",
            message: "Project binding is already active",
            retryable: false,
            recovery: { kind: "none" },
          });
        },
      } as never,
    });

    const response = await getHttpServerOptions(PORT).fetch(new Request(
      `http://127.0.0.1:${PORT}/api/projects/project-native/lifecycle`,
      {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ lifecycle: "active" }),
      },
    ));

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      error: "Project binding is already active",
    });
  });

  test("rejects unsupported inactive Project lifecycle requests", async () => {
    const getProject = vi.fn();
    __setHttpContentModuleDependenciesForTests({
      projectWorkspace: { getProject } as never,
    });

    const response = await getHttpServerOptions(PORT).fetch(new Request(
      `http://127.0.0.1:${PORT}/api/projects/project-native/lifecycle`,
      {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ lifecycle: "inactive" }),
      },
    ));

    expect(response.status).toBe(400);
    expect(getProject).not.toHaveBeenCalled();
  });

  test("returns typed archive blockers with HTTP 409", async () => {
    __setHttpServerDependenciesForTests({
      projectLifecycleService: {
        setLifecycle: async () => ({
          kind: "blocked",
          project: {
            id: "project-native",
            libraryId: "library-native",
            databaseId: "database-native",
            lifecycle: "active",
            bindingRevision: 3,
            name: "Native",
            description: "",
            sources: [],
            primaryWorkspaceRoot: null,
            pinned: false,
            pinnedOrder: null,
            created: new Date("2026-01-01T00:00:00.000Z"),
            updated: new Date("2026-07-22T00:00:00.000Z"),
          },
          blockers: [{ kind: "active-turn", threadId: "thread-native", label: null }],
        }),
      },
    });

    const response = await getHttpServerOptions(PORT).fetch(new Request(
      `http://127.0.0.1:${PORT}/api/projects/project-native/lifecycle`,
      {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ lifecycle: "archived" }),
      },
    ));

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      kind: "blocked",
      blockers: [{ kind: "active-turn", threadId: "thread-native" }],
    });
  });

  test("returns typed not-found lifecycle results with HTTP 404", async () => {
    __setHttpServerDependenciesForTests({
      projectLifecycleService: {
        setLifecycle: async () => ({ kind: "not-found" }),
      },
    });

    const response = await getHttpServerOptions(PORT).fetch(new Request(
      `http://127.0.0.1:${PORT}/api/projects/missing/lifecycle`,
      {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ lifecycle: "archived" }),
      },
    ));

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({ kind: "not-found" });
  });

  test("does not misclassify lifecycle dependency failures as bad input", async () => {
    __setHttpServerDependenciesForTests({
      projectLifecycleService: {
        setLifecycle: async () => {
          throw new Error("Core unavailable");
        },
      },
    });

    const response = await getHttpServerOptions(PORT).fetch(new Request(
      `http://127.0.0.1:${PORT}/api/projects/project-native/lifecycle`,
      {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ lifecycle: "active" }),
      },
    ));

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({ error: "Core unavailable" });
  });

  test("routes Board projections through the configured Database authority", async () => {
    const snapshot = {
      projectId: "project-native",
      libraryId: "library-native",
      databaseId: "database-native",
      dataSourceId: "data-source-native",
      viewId: "view-native",
      storeEpoch: "epoch-native",
      changeLogSeq: 42,
      board: { columns: [] },
    };
    const getBoardSummary = vi.fn(async () => snapshot);
    __setHttpContentModuleDependenciesForTests({
      databaseProjections: { getBoardSummary } as never,
    });

    const response = await getHttpServerOptions(PORT).fetch(new Request(
      `http://127.0.0.1:${PORT}/api/projects/project-native/board-summary`,
    ));

    expect(response.status).toBe(200);
    expect(getBoardSummary).toHaveBeenCalledWith("project-native");
    await expect(response.json()).resolves.toEqual(snapshot);
  });

  test("routes Page search through the configured Library authority", async () => {
    const searchPages = vi.fn(async () => []);
    __setHttpContentModuleDependenciesForTests({
      pageSearch: { searchPages },
    });

    const response = await getHttpServerOptions(PORT).fetch(new Request(
      `http://127.0.0.1:${PORT}/api/pages/search`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectIds: ["project-native"],
          query: "native",
          limit: 12,
        }),
      },
    ));

    expect(response.status).toBe(200);
    expect(searchPages).toHaveBeenCalledWith({
      projectIds: ["project-native"],
      query: "native",
      limit: 12,
    });
    await expect(response.json()).resolves.toEqual([]);
  });

  test("routes Calendar occurrences through the configured Automation authority", async () => {
    const listPageOccurrences = vi.fn(async () => []);
    __setHttpContentModuleDependenciesForTests({
      automation: { listPageOccurrences } as never,
    });

    const response = await getHttpServerOptions(PORT).fetch(new Request(
      `http://127.0.0.1:${PORT}/api/projects/project-native/calendar/occurrences?start=2026-07-20T00:00:00.000Z&end=2026-07-21T00:00:00.000Z&search=native`,
    ));

    expect(response.status).toBe(200);
    expect(listPageOccurrences).toHaveBeenCalledWith(
      "project-native",
      new Date("2026-07-20T00:00:00.000Z"),
      new Date("2026-07-21T00:00:00.000Z"),
      "native",
    );
    await expect(response.json()).resolves.toEqual({ occurrences: [] });
  });

  test("routes Backup inventory through Store Administration", async () => {
    const listBackups = vi.fn(async () => []);
    __setHttpContentModuleDependenciesForTests({
      storeAdministration: { port: { listBackups } } as never,
    });

    const response = await getHttpServerOptions(PORT).fetch(new Request(
      `http://127.0.0.1:${PORT}/api/backups`,
    ));

    expect(response.status).toBe(200);
    expect(listBackups).toHaveBeenCalledOnce();
    await expect(response.json()).resolves.toEqual({ backups: [] });
  });

  test("does not expose arbitrary SQL inspection", async () => {
    const response = await getHttpServerOptions(PORT).fetch(new Request(
      `http://127.0.0.1:${PORT}/api/projects/project-native/schema`,
    ));

    expect(response.status).toBe(404);
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
