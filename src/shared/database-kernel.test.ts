import { describe, expect, test } from "bun:test";
import {
  canonicalizeDatabaseMutationIntent,
  evaluateDatabaseViewFilter,
  normalizeDatabasePropertyValue,
  parseDatabaseMutationRequest,
  parseDatabasePropertyConfig,
  parseGeneralDatabaseViewConfig,
  type DatabaseMutationRequest,
  type GeneralDatabaseViewConfig,
} from "./database-kernel";

const viewConfig = (): GeneralDatabaseViewConfig => ({
  schemaKey: "nodex.database-view",
  schemaVersion: 1,
  filter: { kind: "group", operator: "and", children: [] },
  sort: [{ field: { kind: "manual" }, direction: "asc", nulls: "last" }],
  group: null,
  display: { propertyIds: [], showTitle: true },
});

const request = (): DatabaseMutationRequest => ({
  version: 1,
  operationId: "operation-1",
  projectId: "project-1",
  storeEpoch: "epoch-1",
  clientSessionId: "session-1",
  actor: { kind: "test" },
  operations: [
    {
      kind: "create_database",
      databaseBlockId: "database-1",
      name: "Tasks",
      isPrimary: false,
      initialView: {
        viewId: "view-1",
        name: "Table",
        viewKind: "list",
        config: viewConfig(),
      },
    },
  ],
});

const fails = (operation: () => void): boolean => {
  try {
    operation();
    return false;
  } catch {
    return true;
  }
};

describe("general Database mutation contract", () => {
  test("uses logical anchors and excludes transport attribution from retry identity", () => {
    const parsed = parseDatabaseMutationRequest(request());
    expect(parsed.operations[0]?.kind).toBe("create_database");
    const retry = {
      ...request(),
      clientSessionId: "session-2",
      actor: { kind: "cli", user: "same-human" },
    };
    expect(canonicalizeDatabaseMutationIntent(retry)).toBe(
      canonicalizeDatabaseMutationIntent(request()),
    );

    const untrustedRank = {
      ...request(),
      operations: [{ ...request().operations[0], rankKey: "client-owned" }],
    };
    expect(fails(() => parseDatabaseMutationRequest(untrustedRank))).toBeTrue();
  });

  test("accepts one connected Board intent and rejects duplicate, reversed, or unrelated writes", () => {
    const value = {
      kind: "set_value" as const,
      cardBlockId: "card-1",
      databaseBlockId: "database-1",
      propertyId: "status-property",
      expectedValueRevision: 1,
      value: "done",
    };
    const position = {
      kind: "position_card" as const,
      viewId: "view-1",
      cardBlockId: "card-1",
      expectedPositionRevision: 2,
      groupKey: "done",
      beforeCardBlockId: "card-2",
    };
    const boardDrag = parseDatabaseMutationRequest({
      ...request(),
      operations: [value, position],
    });
    expect(boardDrag.operations.length).toBe(2);
    expect(
      fails(() =>
        parseDatabaseMutationRequest({
          ...request(),
          operations: [value, { ...value, value: "backlog" }],
        }),
      ),
    ).toBeTrue();
    expect(
      fails(() =>
        parseDatabaseMutationRequest({
          ...request(),
          operations: [position, value],
        }),
      ),
    ).toBeTrue();
    expect(
      fails(() =>
        parseDatabaseMutationRequest({
          ...request(),
          operations: [
            value,
            {
              kind: "put_view",
              databaseBlockId: "unrelated-database",
              viewId: "unrelated-view",
              expectedRevision: 0,
              name: "Unrelated",
              viewKind: "list",
              config: viewConfig(),
              isPrimary: false,
            },
          ],
        }),
      ),
    ).toBeTrue();
    expect(
      fails(() =>
        parseDatabaseMutationRequest({
          ...request(),
          operations: Array.from({ length: 65 }, (_, index) => ({
            ...value,
            propertyId: `property-${index}`,
          })),
        }),
      ),
    ).toBeTrue();
  });

  test("compresses a bounded ordered multi-Card drag without weakening field conflicts", () => {
    const entries = Array.from({ length: 40 }, (_, index) => ({
      cardBlockId: `card-${index}`,
      propertyId: "status-property",
      expectedValueRevision: index + 1,
      value: "done",
    }));
    const cards = entries.map((entry, index) => ({
      cardBlockId: entry.cardBlockId,
      expectedPositionRevision: index + 2,
    }));
    const parsed = parseDatabaseMutationRequest({
      ...request(),
      operations: [
        {
          kind: "set_values",
          databaseBlockId: "database-1",
          entries,
        },
        {
          kind: "position_cards",
          viewId: "view-1",
          cards,
          groupKey: "done",
          beforeCardBlockId: "external-anchor",
        },
      ],
    });
    expect(parsed.operations.length).toBe(2);
    expect(parsed.operations[0]?.kind).toBe("set_values");
    expect(parsed.operations[1]?.kind).toBe("position_cards");
    if (parsed.operations[1]?.kind !== "position_cards") {
      throw new Error("Expected bulk position operation");
    }
    expect(
      parsed.operations[1].cards.map((entry) => entry.cardBlockId).join(","),
    ).toBe(cards.map((entry) => entry.cardBlockId).join(","));

    expect(
      fails(() =>
        parseDatabaseMutationRequest({
          ...request(),
          operations: [
            {
              kind: "set_values",
              databaseBlockId: "database-1",
              entries: [entries[0], entries[0]],
            },
          ],
        }),
      ),
    ).toBeTrue();
    expect(
      fails(() =>
        parseDatabaseMutationRequest({
          ...request(),
          operations: [
            {
              kind: "position_cards",
              viewId: "view-1",
              cards,
              groupKey: "done",
              beforeCardBlockId: cards[0]?.cardBlockId,
            },
          ],
        }),
      ),
    ).toBeTrue();
    expect(
      fails(() =>
        parseDatabaseMutationRequest({
          ...request(),
          operations: [
            {
              kind: "position_cards",
              viewId: "view-1",
              cards,
              groupKey: "done",
            },
            {
              kind: "set_values",
              databaseBlockId: "database-1",
              entries,
            },
          ],
        }),
      ),
    ).toBeTrue();
  });

  test("requires strict versioned View configs and stable option identities", () => {
    const looseConfig = {
      ...request(),
      operations: [
        {
          ...request().operations[0],
          initialView: {
            viewId: "view-1",
            name: "Loose",
            viewKind: "list",
            config: {},
          },
        },
      ],
    };
    expect(fails(() => parseDatabaseMutationRequest(looseConfig))).toBeTrue();

    const duplicateOptions = {
      ...request(),
      operations: [
        {
          kind: "put_property",
          databaseBlockId: "database-1",
          propertyId: "property-1",
          expectedDatabaseSchemaRevision: 1,
          expectedPropertyRevision: 0,
          key: "stage",
          name: "Stage",
          valueType: "select",
          config: {
            options: [
              { id: "stable", name: "First" },
              { id: "stable", name: "Renamed" },
            ],
          },
        },
      ],
    };
    expect(
      fails(() => parseDatabaseMutationRequest(duplicateOptions)),
    ).toBeTrue();
    expect(
      fails(() =>
        parseDatabaseMutationRequest({
          ...duplicateOptions,
          operations: [
            {
              ...duplicateOptions.operations[0],
              valueType: "text",
              config: { optons: [] },
            },
          ],
        }),
      ),
    ).toBeTrue();
    expect(
      fails(() =>
        parseDatabaseMutationRequest({
          ...duplicateOptions,
          operations: [
            {
              ...duplicateOptions.operations[0],
              config: {},
            },
          ],
        }),
      ),
    ).toBeTrue();
  });

  test("evaluates bounded recursive DNF filters with explicit empty-group semantics", () => {
    const filter = parseGeneralDatabaseViewConfig({
      ...viewConfig(),
      filter: {
        kind: "group",
        operator: "or",
        children: [
          {
            kind: "group",
            operator: "and",
            children: [
              {
                kind: "clause",
                propertyId: "stage",
                operator: "equals",
                value: "doing",
              },
              {
                kind: "clause",
                propertyId: "score",
                operator: "equals",
                value: 3,
              },
            ],
          },
          {
            kind: "group",
            operator: "and",
            children: [
              {
                kind: "clause",
                propertyId: "tags",
                operator: "contains",
                value: "urgent",
              },
              {
                kind: "clause",
                propertyId: "owner",
                operator: "is_not_empty",
              },
            ],
          },
        ],
      },
    }).filter;
    const values = new Map<string, string | number | readonly string[]>([
      ["stage", "backlog"],
      ["score", 3],
      ["tags", ["urgent", "customer"]],
      ["owner", "person-1"],
    ]);
    expect(
      evaluateDatabaseViewFilter(filter, (id) => values.get(id)),
    ).toBeTrue();
    expect(
      evaluateDatabaseViewFilter(
        { kind: "group", operator: "and", children: [] },
        () => undefined,
      ),
    ).toBeTrue();
    expect(
      evaluateDatabaseViewFilter(
        { kind: "group", operator: "or", children: [] },
        () => undefined,
      ),
    ).toBeFalse();
  });

  test("rejects recursive filters with unknown fields or excessive bounds", () => {
    expect(
      fails(() =>
        parseGeneralDatabaseViewConfig({
          ...viewConfig(),
          filter: {
            kind: "clause",
            propertyId: "stage",
            operator: "is_empty",
            typo: true,
          },
        }),
      ),
    ).toBeTrue();

    let tooDeep: unknown = {
      kind: "clause",
      propertyId: "stage",
      operator: "is_empty",
    };
    for (let depth = 0; depth < 8; depth += 1) {
      tooDeep = { kind: "group", operator: "and", children: [tooDeep] };
    }
    expect(
      fails(() =>
        parseGeneralDatabaseViewConfig({
          ...viewConfig(),
          filter: tooDeep,
        }),
      ),
    ).toBeTrue();
    expect(
      fails(() =>
        parseGeneralDatabaseViewConfig({
          ...viewConfig(),
          filter: {
            kind: "group",
            operator: "and",
            children: Array.from({ length: 1_024 }, (_, index) => ({
              kind: "clause",
              propertyId: `property-${index}`,
              operator: "is_empty",
            })),
          },
        }),
      ),
    ).toBeTrue();
  });

  test("canonicalizes set intent and rejects overlapping set deltas", () => {
    const delta = {
      ...request(),
      operations: [
        {
          kind: "add_remove_value",
          cardBlockId: "card-1",
          databaseBlockId: "database-1",
          propertyId: "property-1",
          add: ["b", "a", "a"],
          remove: ["c"],
        },
      ],
    };
    const parsed = parseDatabaseMutationRequest(delta);
    const operation = parsed.operations[0];
    if (operation?.kind !== "add_remove_value") {
      throw new Error("Expected add_remove_value operation");
    }
    expect(operation.add.join(",")).toBe("a,b");
    expect(operation.remove.join(",")).toBe("c");
    expect(
      fails(() =>
        parseDatabaseMutationRequest({
          ...delta,
          operations: [{ ...delta.operations[0], remove: ["a"] }],
        }),
      ),
    ).toBeTrue();
  });

  test("normalizes values against the authoritative stable option registry", () => {
    const emptySelect = parseDatabasePropertyConfig("select", { options: [] });
    expect(
      fails(() =>
        normalizeDatabasePropertyValue(
          { valueType: "select", config: emptySelect },
          "invented",
        ),
      ),
    ).toBeTrue();
    const multi = parseDatabasePropertyConfig("multi_select", {
      options: [
        { id: "a", name: "A" },
        { id: "b", name: "B" },
      ],
    });
    const normalized = normalizeDatabasePropertyValue(
      { valueType: "multi_select", config: multi },
      ["b", "a", "b"],
    );
    expect(Array.isArray(normalized) ? normalized.join(",") : "invalid").toBe(
      "a,b",
    );
  });
});
