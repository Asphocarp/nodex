import { describe, expect, test } from "vitest";
import {
  parseDatabaseId,
  parseDatabaseViewId,
  parseDataSourceId,
  parseDataSourcePropertyId,
} from "./database-identities";
import type {
  PageLifecycleMutationReceiptV2,
  PageLifecycleMutationRequestV2,
} from "./page-lifecycle-v2";
import {
  compilePageLifecycleRequestV2,
  executePageLifecycleIntentV2,
  type PageLifecycleOwnedBlockAuthorityV2,
  type PageLifecyclePreflightSnapshotV2,
} from "./page-lifecycle-v2-runtime";
import type { DatabasePage } from "./types";

const databaseId = parseDatabaseId("database-1");
const dataSourceId = parseDataSourceId("source-1");
const viewId = parseDatabaseViewId("view-1");

const authority = (
  lifecycle: "active" | "archived" | "deleted" = "active",
): PageLifecycleOwnedBlockAuthorityV2 => ({
  pageId: "page-1",
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
  membership: null,
  restoreEvidence: lifecycle === "deleted"
    ? {
        deleteOperationId: "delete-1",
        previousLifecycle: "active",
        membership: {
          membershipId: "membership-1",
          databaseId,
          dataSourceId,
          status: "triage",
          position: { viewId },
        },
      }
    : null,
});

const preflight = (
  page: PageLifecycleOwnedBlockAuthorityV2 | null,
): PageLifecyclePreflightSnapshotV2 => ({
  version: 2,
  projectId: "project-1",
  libraryId: "library-1",
  storeEpoch: "epoch-1",
  changeLogSeq: 21,
  value: {
    version: 2,
    reservedBlockType: null,
    page,
    tagsProperty: {
      propertyId: "tags",
      dataSourceId,
      valueType: "multi_select",
      lifecycle: "active",
      revision: 7,
      config: {
        options: [{ id: "o_AAAAAAAA", name: "Release" }],
      },
    },
    defaultView: {
      database: {
        databaseId,
        libraryId: "library-1",
        name: "Pages",
        lifecycle: "active",
        defaultViewId: viewId,
        accessRevision: 1,
        metadataRevision: 1,
        createdAt: "2026-07-18T00:00:00.000Z",
        updatedAt: "2026-07-18T00:00:00.000Z",
      },
      dataSource: {
        dataSourceId,
        libraryId: "library-1",
        homeDatabaseId: databaseId,
        name: "Pages",
        schemaKey: "nodex.pages",
        schemaRevision: 1,
        lifecycle: "active",
        rankKey: "m",
        createdAt: "2026-07-18T00:00:00.000Z",
        updatedAt: "2026-07-18T00:00:00.000Z",
      },
      view: {
        viewId,
        databaseId,
        dataSourceId,
        name: "Board",
        kind: "kanban",
        config: {
          schemaKey: "nodex.database-view",
          schemaVersion: 2,
          filter: { kind: "group", operator: "and", children: [] },
          sort: [{ field: { kind: "manual" }, direction: "asc", nulls: "last" }],
          group: null,
          display: { propertyIds: [], showTitle: true },
        },
        isDefault: true,
        revision: 4,
        rankKey: "m",
        lifecycle: "active",
        createdAt: "2026-07-18T00:00:00.000Z",
        updatedAt: "2026-07-18T00:00:00.000Z",
      },
      properties: [{
        propertyId: parseDataSourcePropertyId("tags"),
        dataSourceId,
        name: "Tags",
        valueType: "multi_select",
        config: { options: [{ id: "o_AAAAAAAA", name: "Release" }] },
        rankKey: "m",
        lifecycle: "active",
        revision: 7,
        createdAt: "2026-07-18T00:00:00.000Z",
        updatedAt: "2026-07-18T00:00:00.000Z",
      }],
      rows: [{
        page: { pageId: "draft-first" },
        effectiveGroupKey: "triage",
      }] as unknown as PageLifecyclePreflightSnapshotV2["value"]["defaultView"]["rows"],
    },
  },
});

const receipt = (
  lifecycle: "active" | "archived" | "deleted" = "active",
): PageLifecycleMutationReceiptV2 => ({
  version: 2,
  operationId: "operation-1",
  projectId: "project-1",
  storeEpoch: "epoch-1",
  operationKind: lifecycle === "deleted" ? "delete_page" : "create_page",
  pageId: "page-1",
  duplicate: false,
  metadataRevision: 1,
  parentRevision: 1,
  lifecycle,
  documentId: "document-1",
  documentGeneration: 1,
  documentHeadSeq: 1,
  databaseId,
  dataSourceId,
  membershipId: "membership-1",
  viewId,
  libraryRankKey: "m",
  viewRankKey: "m",
  createdBlockIds: ["body-1"],
  createdTagOptionIds: [],
  changeLogSeq: 22,
  committedAt: "2026-07-18T00:00:00.000Z",
});

const canonicalPage = (archived = false): DatabasePage => ({
  id: "page-1",
  status: "triage",
  archived,
  title: "Page",
  richTitle: [{ type: "text", text: "Page", styles: {} }],
  description: "",
  tags: [],
  created: new Date("2026-07-18T00:00:00.000Z"),
  order: 0,
});

describe("Page lifecycle v2 runtime", () => {
  test("compiles display names into scoped option IDs and preserves View placement", () => {
    const request = compilePageLifecycleRequestV2({
      intent: {
        kind: "create",
        projectId: "project-1",
        operationId: "operation-1",
        pageId: "page-1",
        status: "triage",
        input: { title: "Page", tags: ["Release", " 新标签 "] },
        placement: "top",
      },
      preflight: preflight(null),
    });
    expect(request.version).toBe(2);
    expect(request.operation.kind).toBe("create_page");
    if (request.operation.kind !== "create_page") return;
    expect(request.operation.dataSourceId).toBe(dataSourceId);
    expect(request.operation.beforeViewPageId).toBe("draft-first");
    expect(request.operation.tagOptionIds).toContain("o_AAAAAAAA");
    expect(request.operation.newTagOptions).toHaveLength(1);
    expect(request.operation.newTagOptions[0]?.name).toBe("新标签");
    expect(request.operation.newTagOptions[0]?.optionId).toMatch(
      /^o_[A-Za-z0-9_-]{8}$/u,
    );
  });

  test("compiles delete evidence and revision fences for restore", () => {
    const request = compilePageLifecycleRequestV2({
      intent: {
        kind: "restore",
        projectId: "project-1",
        operationId: "restore-1",
        pageId: "page-1",
        beforeBlockId: "library-anchor",
        beforeViewPageId: "view-anchor",
      },
      preflight: preflight(authority("deleted")),
    });
    expect(request.operation).toMatchObject({
      kind: "restore_page",
      deleteOperationId: "delete-1",
      expectedMetadataRevision: 7,
      expectedParentRevision: 9,
      beforeBlockId: "library-anchor",
      membership: {
        dataSourceId,
        position: { viewId, beforeViewPageId: "view-anchor" },
      },
    });
  });

  test("retries a lost response with the exact same v2 request", async () => {
    const requests: PageLifecycleMutationRequestV2[] = [];
    const result = await executePageLifecycleIntentV2(
      {
        kind: "create",
        projectId: "project-1",
        operationId: "operation-1",
        pageId: "page-1",
        status: "triage",
        input: { title: "Page" },
      },
      {
        readPreflight: async () => ({ ok: true, value: preflight(null) }),
        mutate: async (_projectId, request) => {
          requests.push(request);
          if (requests.length === 1) throw new Error("response lost");
          return { ok: true, value: receipt() };
        },
        readBoardProjection: async () => canonicalPage(),
      },
    );
    expect(requests).toHaveLength(2);
    expect(requests[0] === requests[1]).toBe(true);
    expect(result.boardProjection?.id).toBe("page-1");
  });
});
