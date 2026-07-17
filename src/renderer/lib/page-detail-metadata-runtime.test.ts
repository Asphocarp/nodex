import { describe, expect, test } from "vitest";

import { plainTextToPortableRichText } from "../../shared/block-documents";
import type {
  BlockPropertyMutationCommandResultV2,
  BlockPropertyMutationRequestV2,
} from "../../shared/block-property-mutations-v2";
import type { DataSourcePropertyRecordV2 } from "../../shared/database-module-v2";
import {
  parseDatabaseId,
  parseDatabaseViewId,
  parseDataSourceId,
  parseDataSourcePropertyId,
} from "../../shared/database-identities";
import type { PageDetail } from "../../shared/page-detail";
import {
  commitPageDetailMetadataPatch,
  type PageDetailMetadataRuntimeDependencies,
} from "./page-detail-metadata-runtime";

const timestamp = "2026-07-16T00:00:00.000Z";
const databaseId = parseDatabaseId("019f714b-0000-7000-8000-000000000021");
const dataSourceId = parseDataSourceId("019f714b-0000-7000-8000-000000000022");
const viewId = parseDatabaseViewId("019f714b-0000-7000-8000-000000000023");
const priorityPropertyId = parseDataSourcePropertyId("priority");
const tagsPropertyId = parseDataSourcePropertyId("tags");
const uiOptionId = "o_AAAAAAAA";
const backendOptionId = "o_BBBBBBBB";

const property = (
  key: string,
  valueType: DataSourcePropertyRecordV2["valueType"],
): DataSourcePropertyRecordV2 => ({
  propertyId: parseDataSourcePropertyId(key),
  dataSourceId,
  name: key,
  valueType,
  config: valueType === "multi_select"
    ? {
        options: [
          { id: uiOptionId, name: "ui" },
          { id: backendOptionId, name: "backend" },
        ],
      }
    : {},
  rankKey: key,
  lifecycle: "active",
  revision: 1,
  createdAt: timestamp,
  updatedAt: timestamp,
});

const detail = (member = true): PageDetail => {
  const properties = [
    property("status", "select"),
    property("priority", "select"),
    property("estimate", "select"),
    property("tags", "multi_select"),
    property("due_date", "date"),
    property("scheduled_start", "datetime"),
    property("scheduled_end", "datetime"),
    property("assignee", "person"),
  ];
  return {
    version: 2,
    projectId: "project-1",
    libraryId: "library-1",
    storeEpoch: "epoch-1",
    changeLogSeq: 4,
    page: {
      pageId: "page-1",
      libraryId: "library-1",
      parent: member
        ? { kind: "data_source", dataSourceId }
        : { kind: "library", libraryId: "library-1" },
      lifecycle: "active",
      parentRevision: 1,
      metadataRevision: 2,
      documentId: "document-1",
      documentGeneration: 1,
      documentHeadSeq: 1,
      title: "Page",
      richTitle: plainTextToPortableRichText("Page"),
      preview: "",
      plainText: "",
      createdAt: timestamp,
      updatedAt: timestamp,
    },
    document: {
      readiness: "ready",
      schemaKey: "nodex.page",
      schemaVersion: 2,
    },
    intrinsicProperties: [
      {
        key: "run.baseBranch",
        valueType: "null",
        value: null,
        revision: 3,
      },
    ],
    dataSourceContext: member
      ? {
          kind: "member",
          membership: {
            membershipId: "membership-1",
            dataSourceId,
            revision: 2,
            createdAt: timestamp,
          },
          database: {
            databaseId,
            libraryId: "library-1",
            name: "Database",
            lifecycle: "active",
            defaultViewId: viewId,
            accessRevision: 1,
            metadataRevision: 1,
            createdAt: timestamp,
            updatedAt: timestamp,
          },
          dataSource: {
            dataSourceId,
            libraryId: "library-1",
            homeDatabaseId: databaseId,
            name: "Pages",
            schemaKey: "nodex.data-source",
            schemaRevision: 1,
            lifecycle: "active",
            rankKey: "a0",
            createdAt: timestamp,
            updatedAt: timestamp,
          },
          properties,
          values: {
            priority: {
              propertyId: priorityPropertyId,
              valueType: "select",
              value: "p2-medium",
              revision: 7,
            },
            tags: {
              propertyId: tagsPropertyId,
              valueType: "multi_select",
              value: [uiOptionId],
              revision: 4,
            },
          },
        }
      : { kind: "standalone" },
  };
};

const mutationSuccess = (
  request: BlockPropertyMutationRequestV2,
): BlockPropertyMutationCommandResultV2 => ({
  ok: true,
  value: {
    version: 2,
    mutationId: request.mutationId,
    projectId: request.projectId,
    storeEpoch: request.storeEpoch,
    duplicate: false,
    fields: [],
    blockMetadataRevisions: { "page-1": 3 },
    changeLogSeq: 5,
    committedAt: timestamp,
  },
});

const dependencies = (input: {
  readonly detail?: PageDetail;
  readonly requests?: BlockPropertyMutationRequestV2[];
  readonly refreshes?: string[];
  readonly results?: BlockPropertyMutationCommandResultV2[];
} = {}): PageDetailMetadataRuntimeDependencies => ({
  readDetail: async () => input.detail ?? detail(),
  mutateProperties: async (_projectId, request) => {
    input.requests?.push(request);
    return input.results?.shift() ?? mutationSuccess(request);
  },
  refreshDetail: async (_projectId, pageId) => {
    input.refreshes?.push(pageId);
  },
});

describe("Page Detail metadata runtime", () => {
  test("writes Data Source values with the Page Detail value revision", async () => {
    const requests: BlockPropertyMutationRequestV2[] = [];
    const refreshes: string[] = [];

    const result = await commitPageDetailMetadataPatch({
      projectId: "project-1",
      pageId: "page-1",
      operationId: "set-priority",
      patch: { priority: "p1-high" },
      dependencies: dependencies({ requests, refreshes }),
    });

    expect(result).toEqual({ status: "updated", didMutate: true });
    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({
      version: 2,
      mutationId: "set-priority",
      projectId: "project-1",
      storeEpoch: "epoch-1",
      fields: [{
        scope: "data_source",
        pageId: "page-1",
        dataSourceId,
        propertyId: "priority",
        operation: "set",
        expectedRevision: 7,
        value: "p1-high",
      }],
    });
    expect(refreshes).toEqual(["page-1"]);
  });

  test("writes Page intrinsic fields without inventing Data Source coordinates", async () => {
    const requests: BlockPropertyMutationRequestV2[] = [];
    const refreshes: string[] = [];

    const result = await commitPageDetailMetadataPatch({
      projectId: "project-1",
      pageId: "page-1",
      operationId: "set-base-branch",
      patch: { runInBaseBranch: "main" },
      dependencies: dependencies({
        detail: detail(false),
        requests,
        refreshes,
      }),
    });

    expect(result).toEqual({ status: "updated", didMutate: true });
    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({
      mutationId: "set-base-branch",
      fields: [{
        scope: "intrinsic",
        blockId: "page-1",
        propertyKey: "run.baseBranch",
        expectedRevision: 3,
        value: "main",
      }],
    });
    expect(refreshes).toEqual(["page-1"]);
  });

  test("returns a conflict and refreshes after a stale Data Source value", async () => {
    const refreshes: string[] = [];
    const result = await commitPageDetailMetadataPatch({
      projectId: "project-1",
      pageId: "page-1",
      operationId: "stale-priority",
      patch: { priority: "p1-high" },
      dependencies: dependencies({
        refreshes,
        results: [{
          ok: false,
          error: {
            code: "property_conflict",
            message: "stale value",
            retryable: false,
            mutationId: "stale-priority",
            fieldPath: "data_source/source-1/page-1/priority",
            expectedRevision: 7,
            actualRevision: 8,
          },
        }],
      }),
    });

    expect(result).toEqual({ status: "conflict" });
    expect(refreshes).toEqual(["page-1"]);
  });

  test("rejects a Data Source field on a standalone Page", async () => {
    await expect(commitPageDetailMetadataPatch({
      projectId: "project-1",
      pageId: "page-1",
      operationId: "standalone-priority",
      patch: { priority: "p1-high" },
      dependencies: dependencies({ detail: detail(false) }),
    })).rejects.toThrow("This Page has no Data Source properties");
  });

  test("does not write an already represented value", async () => {
    const requests: BlockPropertyMutationRequestV2[] = [];
    const refreshes: string[] = [];
    const result = await commitPageDetailMetadataPatch({
      projectId: "project-1",
      pageId: "page-1",
      operationId: "same-priority",
      patch: { priority: "p2-medium" },
      dependencies: dependencies({ requests, refreshes }),
    });

    expect(result).toEqual({ status: "updated", didMutate: false });
    expect(requests).toHaveLength(0);
    expect(refreshes).toEqual(["page-1"]);
  });

  test("commits Data Source and intrinsic fields atomically", async () => {
    const requests: BlockPropertyMutationRequestV2[] = [];
    const result = await commitPageDetailMetadataPatch({
      projectId: "project-1",
      pageId: "page-1",
      operationId: "atomic-metadata",
      patch: { priority: "p1-high", runInBaseBranch: "main" },
      dependencies: dependencies({ requests }),
    });

    expect(result).toEqual({ status: "updated", didMutate: true });
    expect(requests).toHaveLength(1);
    expect(requests[0]?.fields).toEqual(expect.arrayContaining([
      expect.objectContaining({ scope: "data_source", propertyId: "priority" }),
      expect.objectContaining({ scope: "intrinsic", propertyKey: "run.baseBranch" }),
    ]));
  });

  test("translates tag display names into source-scoped option IDs", async () => {
    const requests: BlockPropertyMutationRequestV2[] = [];
    const result = await commitPageDetailMetadataPatch({
      projectId: "project-1",
      pageId: "page-1",
      operationId: "set-tags",
      patch: { tags: ["backend"] },
      dependencies: dependencies({ requests }),
    });

    expect(result).toEqual({ status: "updated", didMutate: true });
    expect(requests[0]?.fields).toEqual([
      expect.objectContaining({
        scope: "data_source",
        propertyId: "tags",
        operation: "add_remove",
        add: [backendOptionId],
        remove: [uiOptionId],
      }),
    ]);
  });

  test("retries the exact v2 request once after a retryable outage", async () => {
    const requests: BlockPropertyMutationRequestV2[] = [];
    const result = await commitPageDetailMetadataPatch({
      projectId: "project-1",
      pageId: "page-1",
      operationId: "retry-priority",
      patch: { priority: "p1-high" },
      dependencies: dependencies({
        requests,
        results: [{
          ok: false,
          error: {
            code: "unknown",
            message: "worker unavailable",
            retryable: true,
            mutationId: "retry-priority",
          },
        }],
      }),
    });

    expect(result).toEqual({ status: "updated", didMutate: true });
    expect(requests).toHaveLength(2);
    expect(requests[1]).toEqual(requests[0]);
  });
});
