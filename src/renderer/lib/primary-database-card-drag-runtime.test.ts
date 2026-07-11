import { describe, expect, test } from "bun:test";
import type {
  DatabaseMutationCommandResult,
  DatabaseMutationRequest,
} from "../../shared/database-kernel";
import type {
  DatabaseReadCommandResult,
  GeneralDatabaseDescriptor,
  GeneralDatabaseViewQuery,
} from "../../shared/database-query";
import {
  commitPrimaryDatabaseCardDrag,
  type PrimaryDatabaseCardDragRuntimeDependencies,
} from "./primary-database-card-drag-runtime";

const descriptorResult =
  (): DatabaseReadCommandResult<GeneralDatabaseDescriptor> => ({
    ok: true,
    value: {
      version: 1,
      projectId: "project-1",
      storeEpoch: "epoch-1",
      changeLogSeq: 4,
      value: {
        database: {
          blockId: "database-1",
          projectId: "project-1",
          name: "Cards",
          isPrimary: true,
          schemaKey: "nodex.database",
          schemaRevision: 1,
          metadataRevision: 1,
          createdAt: "2026-07-11T00:00:00.000Z",
          updatedAt: "2026-07-11T00:00:00.000Z",
        },
        properties: [
          {
            id: "status-property",
            databaseBlockId: "database-1",
            key: "status",
            name: "Status",
            valueType: "select",
            config: {},
            rankKey: "a",
            lifecycle: "active",
            revision: 1,
            createdAt: "2026-07-11T00:00:00.000Z",
            updatedAt: "2026-07-11T00:00:00.000Z",
          },
        ],
        views: [
          {
            id: "view-1",
            databaseBlockId: "database-1",
            projectId: "project-1",
            name: "Board",
            kind: "kanban",
            config: {
              schemaKey: "nodex.database-view",
              schemaVersion: 1,
              filter: { kind: "group", operator: "and", children: [] },
              sort: [
                {
                  field: { kind: "manual" },
                  direction: "asc",
                  nulls: "last",
                },
              ],
              group: { propertyId: "status-property" },
              display: { propertyIds: [], showTitle: true },
            },
            isPrimary: true,
            revision: 2,
            rankKey: "a",
            lifecycle: "active",
            createdAt: "2026-07-11T00:00:00.000Z",
            updatedAt: "2026-07-11T00:00:00.000Z",
          },
        ],
      },
    },
  });

const queryResult = (): DatabaseReadCommandResult<GeneralDatabaseViewQuery> => {
  const descriptor = descriptorResult();
  if (!descriptor.ok || !descriptor.value.value) {
    throw new Error("Fixture descriptor missing");
  }
  const view = descriptor.value.value.views[0];
  if (!view) throw new Error("Fixture View missing");
  return {
    ok: true,
    value: {
      version: 1,
      projectId: "project-1",
      storeEpoch: "epoch-1",
      changeLogSeq: 4,
      value: {
        database: descriptor.value.value.database,
        view,
        properties: descriptor.value.value.properties,
        rows: [
          {
            membership: {
              id: "membership-1",
              databaseBlockId: "database-1",
              cardBlockId: "card-1",
              revision: 1,
              createdAt: "2026-07-11T00:00:00.000Z",
            },
            card: {
              blockId: "card-1",
              projectId: "project-1",
              lifecycle: "active",
              location: { kind: "space", rankKey: "a" },
              locationRevision: 1,
              metadataRevision: 1,
              documentId: "document-1",
              documentGeneration: 1,
              documentHeadSeq: 1,
              documentAuthority: "ydoc_primary",
              content: null,
              createdAt: "2026-07-11T00:00:00.000Z",
              updatedAt: "2026-07-11T00:00:00.000Z",
            },
            values: {
              "status-property": {
                propertyId: "status-property",
                valueType: "select",
                value: "in_progress",
                revision: 6,
              },
            },
            position: {
              groupKey: "in_progress",
              rankKey: "a",
              revision: 7,
            },
            effectiveGroupKey: "in_progress",
          },
        ],
      },
    },
  };
};

describe("primary Database Card drag runtime", () => {
  test("retains one operation ID and never calls the legacy move seam", async () => {
    const requests: DatabaseMutationRequest[] = [];
    const dependencies: PrimaryDatabaseCardDragRuntimeDependencies = {
      readPrimaryDescriptor: async () => descriptorResult(),
      queryView: async () => queryResult(),
      mutate: async (_projectId, request) => {
        requests.push(request);
        return {
          ok: true,
          value: {
            version: 1,
            operationId: request.operationId,
            projectId: request.projectId,
            storeEpoch: request.storeEpoch,
            operationKinds: request.operations.map((operation) =>
              operation.kind,
            ),
            affectedDatabaseBlockIds: ["database-1"],
            duplicate: false,
            payload: {},
            changeLogSeq: 5,
            committedAt: "2026-07-11T00:00:01.000Z",
          },
        };
      },
    };

    const committed = await commitPrimaryDatabaseCardDrag({
      projectId: "project-1",
      clientSessionId: "window-1",
      operationId: "drag-operation-1",
      move: {
        cardId: "card-1",
        fromStatus: "in_progress",
        toStatus: "done",
      },
      dependencies,
    });

    expect(committed).toBeTrue();
    expect(requests.length).toBe(1);
    expect(requests[0]?.operationId).toBe("drag-operation-1");
    expect(
      requests[0]?.operations.map((operation) => operation.kind).join(","),
    ).toBe("set_value,position_card");
  });

  test("refreshes descriptor and query after a typed position conflict", async () => {
    let descriptorReads = 0;
    let queryReads = 0;
    let mutationCalls = 0;
    const conflict: DatabaseMutationCommandResult = {
      ok: false,
      error: {
        code: "position_conflict",
        message: "position changed",
        retryable: false,
        operationId: "drag-operation-2",
        expectedRevision: 7,
        actualRevision: 8,
      },
    };
    const dependencies: PrimaryDatabaseCardDragRuntimeDependencies = {
      readPrimaryDescriptor: async () => {
        descriptorReads += 1;
        return descriptorResult();
      },
      queryView: async () => {
        queryReads += 1;
        return queryResult();
      },
      mutate: async () => {
        mutationCalls += 1;
        return conflict;
      },
    };

    let message = "";
    try {
      await commitPrimaryDatabaseCardDrag({
        projectId: "project-1",
        operationId: "drag-operation-2",
        move: {
          cardId: "card-1",
          fromStatus: "in_progress",
          toStatus: "done",
        },
        dependencies,
      });
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }
    expect(message).toBe("position changed");
    expect(descriptorReads).toBe(2);
    expect(queryReads).toBe(2);
    expect(mutationCalls).toBe(1);
  });

  test("retries a lost response once with the exact same durable intent", async () => {
    const requests: DatabaseMutationRequest[] = [];
    let descriptorReads = 0;
    let queryReads = 0;
    const dependencies: PrimaryDatabaseCardDragRuntimeDependencies = {
      readPrimaryDescriptor: async () => {
        descriptorReads += 1;
        return descriptorResult();
      },
      queryView: async () => {
        queryReads += 1;
        return queryResult();
      },
      mutate: async (_projectId, request) => {
        requests.push(request);
        if (requests.length === 1) {
          throw new Error("response lost after commit");
        }
        return {
          ok: true,
          value: {
            version: 1,
            operationId: request.operationId,
            projectId: request.projectId,
            storeEpoch: request.storeEpoch,
            operationKinds: request.operations.map((operation) =>
              operation.kind,
            ),
            affectedDatabaseBlockIds: ["database-1"],
            duplicate: true,
            payload: {},
            changeLogSeq: 5,
            committedAt: "2026-07-11T00:00:01.000Z",
          },
        };
      },
    };

    const committed = await commitPrimaryDatabaseCardDrag({
      projectId: "project-1",
      operationId: "drag-operation-lost-response",
      move: {
        cardId: "card-1",
        fromStatus: "in_progress",
        toStatus: "done",
      },
      dependencies,
    });

    expect(committed).toBeTrue();
    expect(requests.length).toBe(2);
    expect(requests[0]).toBe(requests[1]);
    expect(requests[1]?.operationId).toBe("drag-operation-lost-response");
    expect(descriptorReads).toBe(1);
    expect(queryReads).toBe(1);
  });
});
