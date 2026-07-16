import { describe, expect, test } from "vitest";

import { plainTextToPortableRichText } from "../../shared/block-documents";
import type {
  BlockPropertyMutationCommandResult,
  BlockPropertyMutationRequest,
} from "../../shared/block-property-mutations";
import type {
  DatabaseApply,
  DatabaseApplyResult,
  DataSourcePropertyRecord,
} from "../../shared/database-module";
import type { PageDetail } from "../../shared/page-detail";
import {
  commitPageDetailMetadataPatch,
  type PageDetailMetadataRuntimeDependencies,
} from "./page-detail-metadata-runtime";

const timestamp = "2026-07-16T00:00:00.000Z";
const dataSourceId = "source-1";

const property = (
  key: string,
  valueType: DataSourcePropertyRecord["valueType"],
): DataSourcePropertyRecord => ({
  propertyId: `property-${key}`,
  dataSourceId,
  key,
  name: key,
  valueType,
  config: {},
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
    version: 1,
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
            databaseId: "database-1",
            libraryId: "library-1",
            name: "Database",
            lifecycle: "active",
            defaultViewId: "view-1",
            accessRevision: 1,
            metadataRevision: 1,
            createdAt: timestamp,
            updatedAt: timestamp,
          },
          dataSource: {
            dataSourceId,
            libraryId: "library-1",
            homeDatabaseId: "database-1",
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
            "property-priority": {
              propertyId: "property-priority",
              valueType: "select",
              value: "p2-medium",
              revision: 7,
            },
          },
        }
      : { kind: "standalone" },
  };
};

const databaseSuccess = (request: DatabaseApply): DatabaseApplyResult => ({
  ok: true,
  value: {
    version: 1,
    operationId: request.operationId,
    projectId: request.projectId,
    libraryId: "library-1",
    storeEpoch: request.storeEpoch,
    duplicate: false,
    operationKinds: request.operations.map((operation) => operation.kind),
    affectedDatabaseIds: ["database-1"],
    affectedDataSourceIds: [dataSourceId],
    affectedPageIds: ["page-1"],
    affectedViewIds: [],
    committedRevisions: {},
    changeLogSeq: 5,
    committedAt: timestamp,
  },
});

const intrinsicSuccess = (
  request: BlockPropertyMutationRequest,
): BlockPropertyMutationCommandResult => ({
  ok: true,
  value: {
    version: 1,
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
  readonly databaseRequests?: DatabaseApply[];
  readonly intrinsicRequests?: BlockPropertyMutationRequest[];
  readonly refreshes?: string[];
  readonly databaseResult?: DatabaseApplyResult;
} = {}): PageDetailMetadataRuntimeDependencies => ({
  readDetail: async () => input.detail ?? detail(),
  applyDatabase: async (_projectId, request) => {
    input.databaseRequests?.push(request);
    return input.databaseResult ?? databaseSuccess(request);
  },
  mutateIntrinsic: async (_projectId, request) => {
    input.intrinsicRequests?.push(request);
    return intrinsicSuccess(request);
  },
  refreshDetail: async (_projectId, pageId) => {
    input.refreshes?.push(pageId);
  },
});

describe("Page Detail metadata runtime", () => {
  test("writes Data Source values with the Page Detail value revision", async () => {
    const databaseRequests: DatabaseApply[] = [];
    const refreshes: string[] = [];

    const result = await commitPageDetailMetadataPatch({
      projectId: "project-1",
      pageId: "page-1",
      operationId: "set-priority",
      patch: { priority: "p1-high" },
      dependencies: dependencies({ databaseRequests, refreshes }),
    });

    expect(result).toEqual({ status: "updated", didMutate: true });
    expect(databaseRequests).toHaveLength(1);
    expect(databaseRequests[0]).toMatchObject({
      operationId: "set-priority:data-source",
      projectId: "project-1",
      storeEpoch: "epoch-1",
      operations: [{
        kind: "set_value",
        pageId: "page-1",
        dataSourceId,
        propertyId: "property-priority",
        expectedValueRevision: 7,
        value: "p1-high",
      }],
    });
    expect(refreshes).toEqual(["page-1"]);
  });

  test("writes Page intrinsic fields without inventing Data Source coordinates", async () => {
    const intrinsicRequests: BlockPropertyMutationRequest[] = [];
    const refreshes: string[] = [];

    const result = await commitPageDetailMetadataPatch({
      projectId: "project-1",
      pageId: "page-1",
      operationId: "set-base-branch",
      patch: { runInBaseBranch: "main" },
      dependencies: dependencies({
        detail: detail(false),
        intrinsicRequests,
        refreshes,
      }),
    });

    expect(result).toEqual({ status: "updated", didMutate: true });
    expect(intrinsicRequests).toHaveLength(1);
    expect(intrinsicRequests[0]).toMatchObject({
      mutationId: "set-base-branch:intrinsic",
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
        databaseResult: {
          ok: false,
          error: {
            code: "revision_conflict",
            message: "stale value",
            retryable: false,
          },
        },
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
    const databaseRequests: DatabaseApply[] = [];
    const refreshes: string[] = [];
    const result = await commitPageDetailMetadataPatch({
      projectId: "project-1",
      pageId: "page-1",
      operationId: "same-priority",
      patch: { priority: "p2-medium" },
      dependencies: dependencies({ databaseRequests, refreshes }),
    });

    expect(result).toEqual({ status: "updated", didMutate: false });
    expect(databaseRequests).toHaveLength(0);
    expect(refreshes).toEqual(["page-1"]);
  });
});
