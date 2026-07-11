import { describe, expect, test } from "vitest";
import type { GeneralDatabaseViewConfig } from "../../shared/database-kernel";
import type {
  DatabaseReadSnapshot,
  GeneralDatabaseDescriptor,
  GeneralDatabaseViewQuery,
} from "../../shared/database-query";
import {
  compilePrimaryDatabaseCardDrag,
  PrimaryDatabaseCardDragError,
  type PrimaryDatabaseCardDragSnapshot,
} from "./primary-database-card-drag";

const manualConfig = (): GeneralDatabaseViewConfig => ({
  schemaKey: "nodex.database-view",
  schemaVersion: 1,
  filter: { kind: "group", operator: "and", children: [] },
  sort: [{ field: { kind: "manual" }, direction: "asc", nulls: "last" }],
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

const snapshot = (input: {
  readonly config?: GeneralDatabaseViewConfig;
  readonly status?: string;
  readonly priority?: string | null;
  readonly positionRevision?: number;
} = {}): PrimaryDatabaseCardDragSnapshot => {
  const config = input.config ?? manualConfig();
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
      databaseBlockId: "database-1",
      key: "status",
      name: "Status",
      valueType: "select" as const,
      config: {},
      rankKey: "a",
      lifecycle: "active" as const,
      revision: 2,
      createdAt: "2026-07-11T00:00:00.000Z",
      updatedAt: "2026-07-11T00:00:00.000Z",
    },
    {
      id: "property-priority",
      databaseBlockId: "database-1",
      key: "priority",
      name: "Priority",
      valueType: "select" as const,
      config: {},
      rankKey: "b",
      lifecycle: "active" as const,
      revision: 3,
      createdAt: "2026-07-11T00:00:00.000Z",
      updatedAt: "2026-07-11T00:00:00.000Z",
    },
  ];
  const view = {
    id: "view-1",
    databaseBlockId: "database-1",
    projectId: "project-1",
    name: "Board",
    kind: "kanban" as const,
    config,
    isPrimary: true,
    revision: 9,
    rankKey: "a",
    lifecycle: "active" as const,
    createdAt: "2026-07-11T00:00:00.000Z",
    updatedAt: "2026-07-11T00:00:00.000Z",
  };
  const descriptor: GeneralDatabaseDescriptor = {
    database,
    properties,
    views: [view],
  };
  const row = (
    blockId: string,
    status: string,
    priority: string | null,
    rankKey: string,
    revision: number,
  ): GeneralDatabaseViewQuery["rows"][number] => ({
    membership: {
      id: `membership-${blockId}`,
      databaseBlockId: "database-1",
      cardBlockId: blockId,
      revision: 1,
      createdAt: "2026-07-11T00:00:00.000Z",
    },
    card: {
      blockId,
      projectId: "project-1",
      lifecycle: "active",
      location: { kind: "space", rankKey: "a" },
      locationRevision: 1,
      metadataRevision: 1,
      documentId: `document-${blockId}`,
      documentGeneration: 1,
      documentHeadSeq: 1,
      documentAuthority: "ydoc_primary",
      content: null,
      createdAt: "2026-07-11T00:00:00.000Z",
      updatedAt: "2026-07-11T00:00:00.000Z",
    },
    values: {
      "property-status": {
        propertyId: "property-status",
        valueType: "select",
        value: status,
        revision: blockId === "card-1" ? 7 : 1,
      },
      "property-priority": {
        propertyId: "property-priority",
        valueType: "select",
        value: priority,
        revision: blockId === "card-1" ? 5 : 1,
      },
    },
    position: { groupKey: status, rankKey, revision },
    effectiveGroupKey: status,
  });
  const query: GeneralDatabaseViewQuery = {
    database,
    view,
    properties,
    rows: [
      row(
        "card-1",
        input.status ?? "in_progress",
        input.priority ?? "p1-high",
        "b",
        input.positionRevision ?? 11,
      ),
      row("card-sibling", "in_progress", "p1-high", "c", 2),
      row("card-before", "done", "p2-medium", "a", 2),
      row("card-after", "done", "p3-low", "c", 3),
    ],
  };
  const wrap = <T>(value: T): DatabaseReadSnapshot<T> => ({
    version: 1,
    projectId: "project-1",
    storeEpoch: "epoch-1",
    changeLogSeq: 21,
    value,
  });
  return { descriptor: wrap(descriptor), query: wrap(query) };
};

describe("primary Database Card drag compiler", () => {
  test("positions a same-column manual drag with a logical anchor only", () => {
    const compiled = compilePrimaryDatabaseCardDrag({
      move: {
        cardId: "card-1",
        fromStatus: "in_progress",
        toStatus: "in_progress",
        newOrder: 0,
      },
      snapshot: snapshot(),
    });

    expect(compiled.operations.length).toBe(1);
    expect(compiled.operations[0]?.kind).toBe("position_card");
    if (compiled.operations[0]?.kind !== "position_card") {
      throw new Error("Expected position_card");
    }
    expect(compiled.operations[0].expectedPositionRevision).toBe(11);
    expect(compiled.operations[0].beforeCardBlockId).toBe("card-sibling");
    expect(Object.hasOwn(compiled.operations[0], "rankKey")).toBe(false);
  });

  test("commits cross-column status, sort-field patch, and manual position in order", () => {
    const compiled = compilePrimaryDatabaseCardDrag({
      move: {
        cardId: "card-1",
        fromStatus: "in_progress",
        toStatus: "done",
        newOrder: 1,
        fieldPatch: { priority: "p2-medium" },
      },
      snapshot: snapshot(),
    });

    expect(
      compiled.operations.map((operation) => operation.kind).join(","),
    ).toBe("set_value,set_value,position_card");
    const status = compiled.operations[0];
    const priority = compiled.operations[1];
    const position = compiled.operations[2];
    if (
      status?.kind !== "set_value" ||
      priority?.kind !== "set_value" ||
      position?.kind !== "position_card"
    ) {
      throw new Error("Expected value/value/position operations");
    }
    expect(status.propertyId).toBe("property-status");
    expect(status.expectedValueRevision).toBe(7);
    expect(priority.propertyId).toBe("property-priority");
    expect(priority.expectedValueRevision).toBe(5);
    expect(position.beforeCardBlockId).toBe("card-after");
    expect(position.expectedPositionRevision).toBe(11);
  });

  test("does not pretend a manual position controls a property-sorted View", () => {
    const compiled = compilePrimaryDatabaseCardDrag({
      move: {
        cardId: "card-1",
        fromStatus: "in_progress",
        toStatus: "done",
        newOrder: 1,
        fieldPatch: { priority: "p2-medium" },
      },
      snapshot: snapshot({ config: propertyConfig() }),
    });

    expect(
      compiled.operations.map((operation) => operation.kind).join(","),
    ).toBe("set_value,set_value");
  });

  test("blocks a stale source status instead of replaying a legacy move", () => {
    let code = "";
    try {
      compilePrimaryDatabaseCardDrag({
        move: {
          cardId: "card-1",
          fromStatus: "in_progress",
          toStatus: "done",
        },
        snapshot: snapshot({ status: "in_review" }),
      });
    } catch (error) {
      if (error instanceof PrimaryDatabaseCardDragError) code = error.code;
    }
    expect(code).toBe("source_status_conflict");
  });
});
