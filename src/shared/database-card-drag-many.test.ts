import { describe, expect, test } from "vitest";
import type { GeneralDatabaseViewConfig } from "./database-kernel";
import type {
  DatabaseReadSnapshot,
  GeneralDatabaseDescriptor,
  GeneralDatabaseViewQuery,
} from "./database-query";
import {
  compileDatabaseCardDragMany,
  DatabaseCardDragManyError,
  type DatabaseCardDragManySnapshot,
} from "./database-card-drag-many";
import {
  commitDatabaseCardDragMany,
  DatabaseCardDragManyMutationError,
} from "./database-card-drag-many-runtime";

const manualConfig = (
  direction: "asc" | "desc" = "asc",
): GeneralDatabaseViewConfig => ({
  schemaKey: "nodex.database-view",
  schemaVersion: 1,
  filter: { kind: "group", operator: "and", children: [] },
  sort: [{ field: { kind: "manual" }, direction, nulls: "last" }],
  group: { propertyId: "property-status" },
  display: { propertyIds: [], showTitle: true },
});

const propertyConfig = (): GeneralDatabaseViewConfig => ({
  ...manualConfig(),
  sort: [
    {
      field: { kind: "property", propertyId: "property-priority" },
      direction: "asc",
      nulls: "last",
    },
  ],
});

const makeSnapshot = (fixture: {
  readonly cardCount?: number;
  readonly config?: GeneralDatabaseViewConfig;
  readonly staleCardId?: string;
} = {}): DatabaseCardDragManySnapshot => {
  const config = fixture.config ?? manualConfig();
  const database = {
    blockId: "database-1",
    projectId: "project-1",
    name: "Cards",
    isPrimary: true,
    schemaKey: "nodex.database",
    schemaRevision: 4,
    metadataRevision: 8,
    createdAt: "2026-07-11T00:00:00.000Z",
    updatedAt: "2026-07-11T00:00:00.000Z",
  } as const;
  const properties = [
    {
      id: "property-status",
      databaseBlockId: database.blockId,
      key: "status",
      name: "Status",
      valueType: "select" as const,
      config: {},
      rankKey: "a",
      lifecycle: "active" as const,
      revision: 2,
      createdAt: database.createdAt,
      updatedAt: database.updatedAt,
    },
    {
      id: "property-priority",
      databaseBlockId: database.blockId,
      key: "priority",
      name: "Priority",
      valueType: "select" as const,
      config: {},
      rankKey: "b",
      lifecycle: "active" as const,
      revision: 3,
      createdAt: database.createdAt,
      updatedAt: database.updatedAt,
    },
  ];
  const view = {
    id: "view-1",
    databaseBlockId: database.blockId,
    projectId: database.projectId,
    name: "Board",
    kind: "kanban" as const,
    config,
    isPrimary: true,
    revision: 9,
    rankKey: "a",
    lifecycle: "active" as const,
    createdAt: database.createdAt,
    updatedAt: database.updatedAt,
  };
  const row = (input: {
    readonly blockId: string;
    readonly status: string;
    readonly priority: string;
    readonly rankKey: string;
    readonly index: number;
  }): GeneralDatabaseViewQuery["rows"][number] => ({
    membership: {
      id: `membership-${input.blockId}`,
      databaseBlockId: database.blockId,
      cardBlockId: input.blockId,
      revision: 1,
      createdAt: database.createdAt,
    },
    card: {
      blockId: input.blockId,
      projectId: database.projectId,
      lifecycle: "active",
      location: { kind: "space", rankKey: input.rankKey },
      locationRevision: 1,
      metadataRevision: 1,
      documentId: `document-${input.blockId}`,
      documentGeneration: 1,
      documentHeadSeq: 1,
      documentAuthority: "ydoc_primary",
      content: null,
      createdAt: database.createdAt,
      updatedAt: database.updatedAt,
    },
    values: {
      "property-status": {
        propertyId: "property-status",
        valueType: "select",
        value:
          input.blockId === fixture.staleCardId
            ? "in_review"
            : input.status,
        revision: input.index + 7,
      },
      "property-priority": {
        propertyId: "property-priority",
        valueType: "select",
        value: input.priority,
        revision: input.index + 107,
      },
    },
    position: {
      groupKey: input.status,
      rankKey: input.rankKey,
      revision: input.index + 207,
    },
    effectiveGroupKey: input.status,
  });
  const selectedRows = Array.from(
    { length: fixture.cardCount ?? 4 },
    (_, index) =>
      row({
        blockId: `card-${index.toString().padStart(2, "0")}`,
        status: "in_progress",
        priority: "p1-high",
        rankKey: `source-${index.toString().padStart(2, "0")}`,
        index,
      }),
  );
  const targetRows = [
    row({
      blockId: "target-before",
      status: "done",
      priority: "p2-medium",
      rankKey: "target-a",
      index: 100,
    }),
    row({
      blockId: "target-after",
      status: "done",
      priority: "p3-low",
      rankKey: "target-z",
      index: 101,
    }),
  ];
  const descriptor: GeneralDatabaseDescriptor = {
    database,
    properties,
    views: [view],
  };
  const query: GeneralDatabaseViewQuery = {
    database,
    view,
    properties,
    rows: [...selectedRows, ...targetRows],
  };
  const wrap = <T>(value: T): DatabaseReadSnapshot<T> => ({
    version: 1,
    projectId: database.projectId,
    storeEpoch: "epoch-1",
    changeLogSeq: 21,
    value,
  });
  return { descriptor: wrap(descriptor), query: wrap(query) };
};

const errorCode = (run: () => unknown): string => {
  try {
    run();
    return "none";
  } catch (error) {
    return error instanceof DatabaseCardDragManyError ? error.code : "unknown";
  }
};

describe("Database multi-Card drag compiler", () => {
  test("compresses eighty ordered logical writes into two bounded operations", () => {
    const cardIds = Array.from(
      { length: 40 },
      (_, index) => `card-${(39 - index).toString().padStart(2, "0")}`,
    );
    const compiled = compileDatabaseCardDragMany({
      move: {
        cardIds,
        fromStatus: "in_progress",
        toStatus: "done",
        newOrder: 1,
        fieldPatch: { priority: "p2-medium" },
      },
      snapshot: makeSnapshot({ cardCount: 40 }),
    });

    expect(compiled.operations.length).toBe(2);
    expect(compiled.operations.map((operation) => operation.kind).join(","))
      .toBe("set_values,position_cards");
    const values = compiled.operations[0];
    const positions = compiled.operations[1];
    if (values?.kind !== "set_values" || positions?.kind !== "position_cards") {
      throw new Error("Expected one bulk value operation and one bulk position");
    }
    expect(values.entries.length).toBe(80);
    expect(
      values.entries
        .filter((entry) => entry.propertyId === "property-status")
        .map((entry) => entry.cardBlockId)
        .join(","),
    ).toBe(cardIds.join(","));
    expect(values.entries[0]?.expectedValueRevision).toBe(46);
    expect(values.entries[1]?.expectedValueRevision).toBe(146);
    expect(positions.cards.map((entry) => entry.cardBlockId).join(",")).toBe(
      cardIds.join(","),
    );
    expect(positions.cards[0]?.expectedPositionRevision).toBe(246);
    expect(positions.beforeCardBlockId).toBe("target-after");
    expect(Object.hasOwn(positions, "rankKey")).toBe(false);
  });

  test("emits one position run for same-column reorder and no value write", () => {
    const compiled = compileDatabaseCardDragMany({
      move: {
        cardIds: ["target-after", "target-before"],
        fromStatus: "done",
        toStatus: "done",
        newOrder: 0,
      },
      snapshot: makeSnapshot(),
    });

    expect(compiled.operations.length).toBe(1);
    expect(compiled.operations[0]?.kind).toBe("position_cards");
    if (compiled.operations[0]?.kind !== "position_cards") return;
    expect(
      compiled.operations[0].cards.map((entry) => entry.cardBlockId).join(","),
    ).toBe("target-after,target-before");
    expect(compiled.operations[0].beforeCardBlockId === undefined).toBe(true);
  });

  test("does not claim manual authority for a property-sorted View", () => {
    const compiled = compileDatabaseCardDragMany({
      move: {
        cardIds: ["card-01", "card-00"],
        fromStatus: "in_progress",
        toStatus: "done",
        newOrder: 1,
        fieldPatch: { priority: "p2-medium" },
      },
      snapshot: makeSnapshot({ config: propertyConfig() }),
    });

    expect(compiled.operations.length).toBe(1);
    expect(compiled.operations[0]?.kind).toBe("set_values");
  });

  test("fails closed on one stale Card and unsupported descending manual order", () => {
    expect(
      errorCode(() =>
        compileDatabaseCardDragMany({
          move: {
            cardIds: ["card-00", "card-01"],
            fromStatus: "in_progress",
            toStatus: "done",
          },
          snapshot: makeSnapshot({ staleCardId: "card-01" }),
        }),
      ),
    ).toBe("source_status_conflict");
    expect(
      errorCode(() =>
        compileDatabaseCardDragMany({
          move: {
            cardIds: ["card-00", "card-01"],
            fromStatus: "in_progress",
            toStatus: "done",
          },
          snapshot: makeSnapshot({ config: manualConfig("desc") }),
        }),
      ),
    ).toBe("manual_direction_unsupported");
  });
});

const success = (duplicate: boolean) => ({
  ok: true as const,
  value: {
    version: 1 as const,
    operationId: "drag-many-1",
    projectId: "project-1",
    storeEpoch: "epoch-1",
    operationKinds: ["set_values", "position_cards"] as const,
    affectedDatabaseBlockIds: ["database-1"],
    duplicate,
    payload: {},
    changeLogSeq: 22,
    committedAt: "2026-07-11T00:00:01.000Z",
  },
});

describe("Database multi-Card drag runtime", () => {
  test("compiles one snapshot and retries a lost response with the exact request", async () => {
    let snapshotReads = 0;
    const requests: unknown[] = [];
    const committed = await commitDatabaseCardDragMany({
      projectId: "project-1",
      operationId: "drag-many-1",
      move: {
        cardIds: ["card-00", "card-01"],
        fromStatus: "in_progress",
        toStatus: "done",
      },
      dependencies: {
        readSnapshot: async () => {
          snapshotReads += 1;
          return makeSnapshot();
        },
        mutate: async (_projectId, request) => {
          requests.push(request);
          if (requests.length === 1) throw new Error("response lost");
          return success(true);
        },
      },
    });

    expect(committed).toBe(true);
    expect(snapshotReads).toBe(1);
    expect(requests.length).toBe(2);
    expect(requests[0] === requests[1]).toBe(true);
  });

  test("retries one typed transient result but refreshes a conflict without replay", async () => {
    const retryRequests: unknown[] = [];
    const retried = await commitDatabaseCardDragMany({
      projectId: "project-1",
      operationId: "drag-many-1",
      move: {
        cardIds: ["card-00", "card-01"],
        fromStatus: "in_progress",
        toStatus: "done",
      },
      dependencies: {
        readSnapshot: async () => makeSnapshot(),
        mutate: async (_projectId, request) => {
          retryRequests.push(request);
          if (retryRequests.length === 1) {
            return {
              ok: false,
              error: {
                code: "unknown",
                message: "writer unavailable",
                retryable: true,
              },
            };
          }
          return success(false);
        },
      },
    });
    expect(retried).toBe(true);
    expect(retryRequests.length).toBe(2);
    expect(retryRequests[0] === retryRequests[1]).toBe(true);

    let snapshotReads = 0;
    let mutationCalls = 0;
    let code = "none";
    try {
      await commitDatabaseCardDragMany({
        projectId: "project-1",
        operationId: "drag-many-conflict",
        move: {
          cardIds: ["card-00", "card-01"],
          fromStatus: "in_progress",
          toStatus: "done",
        },
        dependencies: {
          readSnapshot: async () => {
            snapshotReads += 1;
            return makeSnapshot();
          },
          mutate: async () => {
            mutationCalls += 1;
            return {
              ok: false,
              error: {
                code: "position_conflict",
                message: "stale position",
                retryable: false,
              },
            };
          },
        },
      });
    } catch (error) {
      if (error instanceof DatabaseCardDragManyMutationError) {
        code = error.commandError.code;
      }
    }
    expect(code).toBe("position_conflict");
    expect(mutationCalls).toBe(1);
    expect(snapshotReads).toBe(2);
  });
});
