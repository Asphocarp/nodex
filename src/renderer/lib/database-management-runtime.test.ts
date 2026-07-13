import { describe, expect, test } from "vitest";
import type {
  DatabaseMutationCommandResult,
  DatabaseMutationRequest,
} from "../../shared/database-kernel";
import type {
  DatabaseManagementSnapshotCommandResult,
  GeneralDatabaseCatalog,
  GeneralDatabaseManagement,
} from "../../shared/database-query";
import {
  commitDatabaseManagementIntent,
  DatabaseManagementMutationError,
  type DatabaseManagementRuntimeDependencies,
} from "./database-management-runtime";

const catalogValue = (schemaRevision = 3): GeneralDatabaseCatalog => ({
  databases: [
    {
      database: {
        blockId: "database-1",
        projectId: "project-1",
        name: "Tasks",
        isPrimary: true,
        schemaKey: "nodex.database",
        schemaRevision,
        metadataRevision: 1,
        createdAt: "2026-07-12T00:00:00.000Z",
        updatedAt: "2026-07-12T00:00:00.000Z",
      },
      properties: [],
      views: [],
    },
  ],
});

const managementValue = (schemaRevision = 3): GeneralDatabaseManagement => ({
  catalog: catalogValue(schemaRevision),
  cards: [],
});

const catalogResult = (
  changeLogSeq: number,
  schemaRevision = 3,
): DatabaseManagementSnapshotCommandResult => ({
  ok: true,
  value: {
    version: 1,
    projectId: "project-1",
    storeEpoch: "epoch-1",
    changeLogSeq,
    value: managementValue(schemaRevision),
  },
});

const success = (
  request: DatabaseMutationRequest,
  duplicate = false,
): DatabaseMutationCommandResult => ({
  ok: true,
  value: {
    version: 1,
    operationId: request.operationId,
    projectId: request.projectId,
    storeEpoch: request.storeEpoch,
    operationKinds: request.operations.map((operation) => operation.kind),
    affectedDatabaseBlockIds: ["database-1"],
    duplicate,
    payload: { operationResults: [] },
    changeLogSeq: 11,
    committedAt: "2026-07-12T00:00:01.000Z",
  },
});

const unusedTransfer: DatabaseManagementRuntimeDependencies["transfer"] =
  async () => {
    throw new Error("Block transfer is not expected in this test");
  };

describe("Database management runtime", () => {
  test("derives schema revisions from one catalog and returns a fresh catalog", async () => {
    let reads = 0;
    const requests: DatabaseMutationRequest[] = [];
    const dependencies: DatabaseManagementRuntimeDependencies = {
      readManagement: async () => catalogResult(reads++ === 0 ? 10 : 11, reads === 1 ? 3 : 4),
      mutate: async (_projectId, request) => {
        requests.push(request);
        return success(request);
      },
      transfer: unusedTransfer,
    };
    const result = await commitDatabaseManagementIntent({
      projectId: "project-1",
      operationId: "property-create",
      buildIntent: (authority) => ({
        kind: "put_property",
        mode: "create",
        descriptor: authority.descriptor("database-1"),
        property: {
          id: "property-score",
          key: "score",
          name: "Score",
          valueType: "number",
          config: {},
        },
      }),
      dependencies,
    });

    expect(requests.length).toBe(1);
    expect(requests[0]?.operations[0]?.kind).toBe("put_property");
    expect(
      requests[0]?.operations[0]?.kind === "put_property"
        ? requests[0].operations[0].expectedDatabaseSchemaRevision
        : -1,
    ).toBe(3);
    expect(result.changeLogSeq).toBe(11);
  });

  test("retries an ambiguous response with the exact compiled request", async () => {
    const requests: DatabaseMutationRequest[] = [];
    let reads = 0;
    const result = await commitDatabaseManagementIntent({
      projectId: "project-1",
      operationId: "database-create",
      buildIntent: () => ({
        kind: "create_database",
        databaseBlockId: "database-2",
        name: "Research",
        initialView: {
          id: "view-2",
          name: "All",
          kind: "list",
          config: {
            schemaKey: "nodex.database-view",
            schemaVersion: 1,
            filter: { kind: "group", operator: "and", children: [] },
            sort: [],
            group: null,
            display: { propertyIds: [], showTitle: true },
          },
        },
      }),
      dependencies: {
        readManagement: async () => catalogResult(reads++ === 0 ? 10 : 11),
        mutate: async (_projectId, request) => {
          requests.push(request);
          if (requests.length === 1) throw new Error("response lost");
          return success(request, true);
        },
        transfer: unusedTransfer,
      },
    });

    expect(result.changeLogSeq).toBe(11);
    expect(requests.length).toBe(2);
    expect(requests[0] === requests[1]).toBe(true);
  });

  test("surfaces terminal typed mutation failures", async () => {
    let code = "";
    try {
      await commitDatabaseManagementIntent({
        projectId: "project-1",
        operationId: "delete-stale-view",
        buildIntent: () => ({
          kind: "create_database",
          databaseBlockId: "database-2",
          name: "Research",
          initialView: {
            id: "view-2",
            name: "All",
            kind: "list",
            config: {
              schemaKey: "nodex.database-view",
              schemaVersion: 1,
              filter: { kind: "group", operator: "and", children: [] },
              sort: [],
              group: null,
              display: { propertyIds: [], showTitle: true },
            },
          },
        }),
        dependencies: {
          readManagement: async () => catalogResult(10),
          mutate: async (_projectId, request) => ({
            ok: false,
            error: {
              code: "database_schema_conflict",
              message: "schema changed",
              retryable: false,
              operationId: request.operationId,
            },
          }),
          transfer: unusedTransfer,
        },
      });
    } catch (error) {
      code = error instanceof DatabaseManagementMutationError
        ? error.commandError.code
        : "unexpected";
    }
    expect(code).toBe("database_schema_conflict");
  });

  test("routes Card membership through BlockTransfer instead of Database mutation", async () => {
    const management: GeneralDatabaseManagement = {
      catalog: {
        databases: [
          {
            ...catalogValue().databases[0]!,
            views: [
              {
                id: "view-1",
                databaseBlockId: "database-1",
                projectId: "project-1",
                name: "All",
                kind: "list",
                config: {
                  schemaKey: "nodex.database-view",
                  schemaVersion: 1,
                  filter: { kind: "group", operator: "and", children: [] },
                  sort: [],
                  group: null,
                  display: { propertyIds: [], showTitle: true },
                },
                isPrimary: true,
                revision: 1,
                rankKey: "a0",
                lifecycle: "active",
                createdAt: "2026-07-12T00:00:00.000Z",
                updatedAt: "2026-07-12T00:00:00.000Z",
              },
            ],
          },
        ],
      },
      cards: [
        {
          card: {
            blockId: "card-1",
            projectId: "project-1",
            lifecycle: "active",
            location: { kind: "space", rankKey: "a0" },
            locationRevision: 1,
            metadataRevision: 1,
            documentId: "document-card-1",
            documentGeneration: 1,
            documentHeadSeq: 1,
            documentAuthority: "ydoc_primary",
            content: null,
            createdAt: "2026-07-12T00:00:00.000Z",
            updatedAt: "2026-07-12T00:00:00.000Z",
          },
          membership: null,
          positions: [],
        },
      ],
    };
    let reads = 0;
    let capturedMode = "";
    let capturedSource = "";
    const result = await commitDatabaseManagementIntent({
      projectId: "project-1",
      operationId: "membership-operation",
      buildIntent: (authority) => ({
        kind: "set_membership",
        authority: authority.management,
        cardBlockId: "card-1",
        target: {
          databaseBlockId: "database-1",
          viewId: "view-1",
        },
      }),
      dependencies: {
        readManagement: async () => ({
          ok: true,
          value: {
            version: 1,
            projectId: "project-1",
            storeEpoch: "epoch-1",
            changeLogSeq: reads++ === 0 ? 10 : 11,
            value: management,
          },
        }),
        mutate: async () => {
          throw new Error("Membership must not use Database mutation");
        },
        transfer: async (_projectId, intent) => {
          capturedMode = intent.mode;
          capturedSource = intent.source.kind;
          return {
            ok: true,
            value: {
              version: 1,
              operationId: intent.operationId,
              projectId: intent.projectId,
              storeEpoch: intent.storeEpoch,
              mode: intent.mode,
              duplicate: false,
              sourceRootBlockIds: ["card-1"],
              resultRootBlockIds: ["card-1"],
              copiedBlockIds: {},
              transformationEvidence: [],
              finalLocations: {
                "card-1": {
                  kind: "database",
                  databaseBlockId: "database-1",
                },
              },
              finalLocationRevisions: { "card-1": 2 },
              documentCommits: [],
              affectedDatabaseBlockIds: ["database-1"],
              changeLogSeq: 11,
              committedAt: "2026-07-12T00:00:01.000Z",
            },
          };
        },
      },
    });

    expect(result.changeLogSeq).toBe(11);
    expect(capturedMode).toBe("move");
    expect(capturedSource).toBe("space");
  });
});
