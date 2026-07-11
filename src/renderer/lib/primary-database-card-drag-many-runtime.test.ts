import { describe, expect, test } from "vitest";
import type {
  DatabaseMutationCommandResult,
  DatabaseMutationRequest,
} from "../../shared/database-kernel";
import type {
  DatabaseReadCommandResult,
  GeneralDatabaseDescriptor,
  GeneralDatabaseViewQuery,
} from "../../shared/database-query";
import { DatabaseCardDragManyMutationError } from "../../shared/database-card-drag-many-runtime";
import {
  commitPrimaryDatabaseCardDragMany,
  type PrimaryDatabaseCardDragManyRuntimeDependencies,
} from "./primary-database-card-drag-many-runtime";

const createdAt = "2026-07-12T00:00:00.000Z";

const descriptorResult =
  (): DatabaseReadCommandResult<GeneralDatabaseDescriptor> => ({
    ok: true,
    value: {
      version: 1,
      projectId: "project-1",
      storeEpoch: "epoch-1",
      changeLogSeq: 12,
      value: {
        database: {
          blockId: "database-1",
          projectId: "project-1",
          name: "Cards",
          isPrimary: true,
          schemaKey: "nodex.database",
          schemaRevision: 3,
          metadataRevision: 4,
          createdAt,
          updatedAt: createdAt,
        },
        properties: [
          {
            id: "property-status",
            databaseBlockId: "database-1",
            key: "status",
            name: "Status",
            valueType: "select",
            config: {},
            rankKey: "a",
            lifecycle: "active",
            revision: 2,
            createdAt,
            updatedAt: createdAt,
          },
          {
            id: "property-priority",
            databaseBlockId: "database-1",
            key: "priority",
            name: "Priority",
            valueType: "select",
            config: {},
            rankKey: "b",
            lifecycle: "active",
            revision: 2,
            createdAt,
            updatedAt: createdAt,
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
              group: { propertyId: "property-status" },
              display: { propertyIds: [], showTitle: true },
            },
            isPrimary: true,
            revision: 5,
            rankKey: "a",
            lifecycle: "active",
            createdAt,
            updatedAt: createdAt,
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
  const row = (
    cardBlockId: string,
    status: string,
    rankKey: string,
    revision: number,
  ): GeneralDatabaseViewQuery["rows"][number] => ({
    membership: {
      id: `membership-${cardBlockId}`,
      databaseBlockId: "database-1",
      cardBlockId,
      revision: 1,
      createdAt,
    },
    card: {
      blockId: cardBlockId,
      projectId: "project-1",
      lifecycle: "active",
      location: { kind: "space", rankKey },
      locationRevision: 1,
      metadataRevision: 1,
      documentId: `document-${cardBlockId}`,
      documentGeneration: 1,
      documentHeadSeq: 1,
      documentAuthority: "ydoc_primary",
      content: null,
      createdAt,
      updatedAt: createdAt,
    },
    values: {
      "property-status": {
        propertyId: "property-status",
        valueType: "select",
        value: status,
        revision,
      },
      "property-priority": {
        propertyId: "property-priority",
        valueType: "select",
        value: "p1-high",
        revision: revision + 10,
      },
    },
    position: { groupKey: status, rankKey, revision: revision + 20 },
    effectiveGroupKey: status,
  });
  return {
    ok: true,
    value: {
      version: 1,
      projectId: "project-1",
      storeEpoch: "epoch-1",
      changeLogSeq: 12,
      value: {
        database: descriptor.value.value.database,
        view,
        properties: descriptor.value.value.properties,
        rows: [
          row("card-a", "in_progress", "a", 2),
          row("card-b", "in_progress", "b", 3),
          row("target", "done", "c", 4),
        ],
      },
    },
  };
};

const snapshotResult = () => {
  const descriptor = descriptorResult();
  const query = queryResult();
  if (!descriptor.ok || !query.ok) {
    throw new Error("Fixture snapshot missing");
  }
  return {
    ok: true as const,
    value: {
      descriptor: descriptor.value,
      query: query.value,
    },
  };
};

const committedResult = (
  request: DatabaseMutationRequest,
  duplicate: boolean,
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
    payload: {},
    changeLogSeq: 13,
    committedAt: "2026-07-12T00:00:01.000Z",
  },
});

describe("primary Database multi-Card drag runtime", () => {
  test("compiles one authority snapshot into one ordered bulk request and retries it exactly", async () => {
    let snapshotReads = 0;
    const requests: DatabaseMutationRequest[] = [];
    const dependencies: PrimaryDatabaseCardDragManyRuntimeDependencies = {
      readSnapshot: async () => {
        snapshotReads += 1;
        return snapshotResult();
      },
      mutate: async (_projectId, request) => {
        requests.push(request);
        if (requests.length === 1) throw new Error("response lost");
        return committedResult(request, true);
      },
    };

    const committed = await commitPrimaryDatabaseCardDragMany({
      projectId: "project-1",
      clientSessionId: "window-1",
      operationId: "multi-drag-1",
      move: {
        cardIds: ["card-b", "card-a"],
        fromStatus: "in_progress",
        toStatus: "done",
        newOrder: 0,
        fieldPatch: { priority: "p2-medium" },
      },
      dependencies,
    });

    expect(committed).toBe(true);
    expect(snapshotReads).toBe(1);
    expect(requests.length).toBe(2);
    expect(requests[0] === requests[1]).toBe(true);
    expect(requests[0]?.operationId).toBe("multi-drag-1");
    expect(requests[0]?.clientSessionId).toBe("window-1");
    expect(
      requests[0]?.operations.map((operation) => operation.kind).join(","),
    ).toBe("set_values,position_cards");
    const positions = requests[0]?.operations[1];
    if (positions?.kind !== "position_cards") {
      throw new Error("Expected one ordered position run");
    }
    expect(positions.cards.map((entry) => entry.cardBlockId).join(",")).toBe(
      "card-b,card-a",
    );
    expect(positions.beforeCardBlockId).toBe("target");
  });

  test("refreshes the full snapshot after one typed stale conflict without replaying Cards", async () => {
    let snapshotReads = 0;
    let mutationCalls = 0;
    const dependencies: PrimaryDatabaseCardDragManyRuntimeDependencies = {
      readSnapshot: async () => {
        snapshotReads += 1;
        return snapshotResult();
      },
      mutate: async () => {
        mutationCalls += 1;
        return {
          ok: false,
          error: {
            code: "property_value_conflict",
            message: "one selected Card changed",
            retryable: false,
          },
        };
      },
    };

    let code = "none";
    try {
      await commitPrimaryDatabaseCardDragMany({
        projectId: "project-1",
        operationId: "multi-drag-stale",
        move: {
          cardIds: ["card-a", "card-b"],
          fromStatus: "in_progress",
          toStatus: "done",
        },
        dependencies,
      });
    } catch (error) {
      if (error instanceof DatabaseCardDragManyMutationError) {
        code = error.commandError.code;
      }
    }

    expect(code).toBe("property_value_conflict");
    expect(mutationCalls).toBe(1);
    expect(snapshotReads).toBe(2);
  });
});
