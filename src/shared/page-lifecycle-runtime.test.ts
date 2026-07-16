import { describe, expect, test } from "vitest";
import type {
  PageLifecycleMutationCommandResult,
  PageLifecycleMutationReceipt,
  PageLifecycleMutationRequest,
} from "./page-lifecycle";
import {
  PageLifecycleRuntimeError,
  compilePageLifecycleRequest,
  executePageLifecycleIntent,
  type PageLifecycleOwnedBlockAuthority,
  type PageLifecyclePreflightSnapshot,
} from "./page-lifecycle-runtime";
import type { DatabasePage } from "./types";

const authority = (
  lifecycle: "active" | "archived" | "deleted" = "active",
): PageLifecycleOwnedBlockAuthority => ({
  pageId: "card-1",
  lifecycle,
  parent: { kind: "library", libraryId: "library-1" },
  libraryRankKey: lifecycle === "deleted" ? null : "m",
  metadataRevision: 7,
  parentRevision: 9,
  document: {
    documentId: "document-1",
    generation: 1,
    headSeq: 3,
    readiness: "ready",
    authority: "ydoc_primary",
    schemaKey: "page",
    schemaVersion: 1,
  },
  membership: lifecycle === "deleted"
    ? null
    : {
        membershipId: "membership-1",
        databaseId: "database-1",
        dataSourceId: "source-1",
        membershipRevision: 2,
        viewId: "view-1",
        viewRevision: 4,
        statusPropertyId: "property-status",
        statusValueRevision: 5,
        status: "draft",
        position: { groupKey: "draft", rankKey: "m", revision: 6 },
      },
  restoreEvidence: lifecycle === "deleted"
    ? {
        deleteOperationId: "delete-1",
        previousLifecycle: "active",
        membership: {
          membershipId: "membership-1",
          databaseId: "database-1",
          dataSourceId: "source-1",
          status: "draft",
          position: { viewId: "view-1" },
        },
      }
    : null,
});

const preflight = (
  page: PageLifecycleOwnedBlockAuthority | null,
): PageLifecyclePreflightSnapshot => ({
  version: 1,
  projectId: "project-1",
  libraryId: "library-1",
  storeEpoch: "epoch-1",
  changeLogSeq: 21,
  value: {
    version: 1,
    reservedBlockType: null,
    page,
    defaultView: {
      database: {
        databaseId: "database-1",
        libraryId: "library-1",
        name: "Pages",
        lifecycle: "active",
        defaultViewId: "view-1",
        accessRevision: 1,
        metadataRevision: 1,
        createdAt: "2026-07-11T00:00:00.000Z",
        updatedAt: "2026-07-11T00:00:00.000Z",
      },
      dataSource: {
        dataSourceId: "source-1",
        libraryId: "library-1",
        homeDatabaseId: "database-1",
        name: "Pages",
        schemaKey: "nodex.pages",
        schemaRevision: 1,
        lifecycle: "active",
        rankKey: "m",
        createdAt: "2026-07-11T00:00:00.000Z",
        updatedAt: "2026-07-11T00:00:00.000Z",
      },
      view: {
        viewId: "view-1",
        databaseId: "database-1",
        dataSourceId: "source-1",
        name: "Board",
        kind: "kanban",
        config: {
          schemaKey: "nodex.database-view",
          schemaVersion: 1,
          filter: { kind: "group", operator: "and", children: [] },
          sort: [{ field: { kind: "manual" }, direction: "asc", nulls: "last" }],
          group: null,
          display: { propertyIds: [], showTitle: true },
        },
        isDefault: true,
        revision: 4,
        rankKey: "m",
        lifecycle: "active",
        createdAt: "2026-07-11T00:00:00.000Z",
        updatedAt: "2026-07-11T00:00:00.000Z",
      },
      properties: [],
      rows: [
        {
          effectiveGroupKey: "draft",
          page: { pageId: "draft-first" },
        },
      ] as unknown as PageLifecyclePreflightSnapshot["value"]["defaultView"]["rows"],
    },
  },
});

const receipt = (
  lifecycle: "active" | "archived" | "deleted" = "active",
): PageLifecycleMutationReceipt => ({
  version: 1,
  operationId: "operation-1",
  projectId: "project-1",
  storeEpoch: "epoch-1",
  operationKind: lifecycle === "deleted" ? "delete_page" : "create_page",
  pageId: "card-1",
  duplicate: false,
  metadataRevision: 1,
  parentRevision: 1,
  lifecycle,
  documentId: "document-1",
  documentGeneration: 1,
  documentHeadSeq: 1,
  databaseId: "database-1",
  dataSourceId: "source-1",
  membershipId: "membership-1",
  viewId: "view-1",
  libraryRankKey: "m",
  viewRankKey: "m",
  createdBlockIds: ["body-1"],
  changeLogSeq: 22,
  committedAt: "2026-07-11T00:00:00.000Z",
});

const canonicalCard = (archived = false): DatabasePage => ({
  id: "card-1",
  status: "draft",
  archived,
  title: "Page",
  richTitle: [{ type: "text", text: "Page", styles: {} }],
  description: "",
  tags: [],
  created: new Date("2026-07-11T00:00:00.000Z"),
  order: 0,
});

describe("Page lifecycle runtime", () => {
  test("maps top creation only to the primary View anchor", () => {
    const request = compilePageLifecycleRequest({
      intent: {
        kind: "create",
        projectId: "project-1",
        operationId: "operation-1",
        pageId: "card-1",
        status: "draft",
        input: { title: "Page" },
        placement: "top",
      },
      preflight: preflight(null),
    });
    if (request.operation.kind !== "create_page") {
      throw new Error("Expected create_page");
    }
    expect(request.operation.beforeViewPageId).toBe("draft-first");
    expect("beforeBlockId" in request.operation).toBe(false);
  });

  test("preserves an explicit primary View anchor for pointer-position creation", () => {
    const request = compilePageLifecycleRequest({
      intent: {
        kind: "create",
        projectId: "project-1",
        operationId: "operation-1",
        pageId: "card-1",
        status: "draft",
        input: { title: "Page" },
        placement: { beforePageId: "draft-second" },
      },
      preflight: preflight(null),
    });
    if (request.operation.kind !== "create_page") {
      throw new Error("Expected create_page");
    }
    expect(request.operation.beforeViewPageId).toBe("draft-second");
    expect("beforeBlockId" in request.operation).toBe(false);
  });

  test("compiles exact revision/evidence fences for existing Cards", () => {
    const deleted = preflight(authority("deleted"));
    const restored = compilePageLifecycleRequest({
      intent: {
        kind: "restore",
        projectId: "project-1",
        operationId: "restore-1",
        pageId: "card-1",
        beforeBlockId: "space-anchor",
        beforeViewPageId: "view-anchor",
      },
      preflight: deleted,
    });
    if (restored.operation.kind !== "restore_page") {
      throw new Error("Expected restore_page");
    }
    expect(restored.operation.deleteOperationId).toBe("delete-1");
    expect(restored.operation.expectedMetadataRevision).toBe(7);
    expect(restored.operation.expectedParentRevision).toBe(9);
    expect(restored.operation.beforeBlockId).toBe("space-anchor");
    expect(restored.operation.membership?.position?.beforeViewPageId).toBe(
      "view-anchor",
    );

    const moved = compilePageLifecycleRequest({
      intent: {
        kind: "move_in_library",
        projectId: "project-1",
        operationId: "move-1",
        pageId: "card-1",
        beforeBlockId: "space-anchor",
      },
      preflight: preflight(authority()),
    });
    if (moved.operation.kind !== "move_page_in_library") {
      throw new Error("Expected move_page_in_library");
    }
    expect(moved.operation.expectedParentRevision).toBe(9);
  });

  test("retries a lost response with the exact same request object", async () => {
    const requests: PageLifecycleMutationRequest[] = [];
    const committed = receipt();
    const result = await executePageLifecycleIntent(
      {
        kind: "create",
        projectId: "project-1",
        operationId: "operation-1",
        pageId: "card-1",
        status: "draft",
        input: { title: "Page" },
      },
      {
        readPreflight: async () => ({ ok: true, value: preflight(null) }),
        mutate: async (_projectId, request) => {
          requests.push(request);
          if (requests.length === 1) throw new Error("response lost");
          return { ok: true, value: committed };
        },
        readBoardProjection: async () => canonicalCard(),
      },
    );
    expect(requests.length).toBe(2);
    expect(requests[0] === requests[1]).toBe(true);
    expect(result.boardProjection?.id).toBe("card-1");
  });

  test("retries one typed retryable response without recompiling intent", async () => {
    const requests: PageLifecycleMutationRequest[] = [];
    const retryable: PageLifecycleMutationCommandResult = {
      ok: false,
      error: {
        code: "unknown",
        message: "writer restarting",
        retryable: true,
        operationId: "operation-1",
        pageId: "card-1",
      },
    };
    await executePageLifecycleIntent(
      {
        kind: "delete",
        projectId: "project-1",
        operationId: "operation-1",
        pageId: "card-1",
      },
      {
        readPreflight: async () => ({
          ok: true,
          value: preflight(authority()),
        }),
        mutate: async (_projectId, request) => {
          requests.push(request);
          return requests.length === 1
            ? retryable
            : { ok: true, value: receipt("deleted") };
        },
        readBoardProjection: async () => null,
      },
    );
    expect(requests.length).toBe(2);
    expect(requests[0] === requests[1]).toBe(true);
  });

  test("fails typed when canonical authority remains stale", async () => {
    let reads = 0;
    let code = "";
    try {
      await executePageLifecycleIntent(
        {
          kind: "create",
          projectId: "project-1",
          operationId: "operation-1",
          pageId: "card-1",
          status: "draft",
          input: { title: "Page" },
        },
        {
          readPreflight: async () => ({ ok: true, value: preflight(null) }),
          mutate: async () => ({ ok: true, value: receipt() }),
          readBoardProjection: async () => {
            reads += 1;
            return null;
          },
        },
      );
    } catch (error) {
      if (error instanceof PageLifecycleRuntimeError) code = error.code;
    }
    expect(reads).toBe(3);
    expect(code).toBe("canonical_read_stale");
  });
});
