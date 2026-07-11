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
  operation: {
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
    expect(parsed.operation.kind).toBe("create_database");
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
      operation: { ...request().operation, rankKey: "client-owned" },
    };
    expect(fails(() => parseDatabaseMutationRequest(untrustedRank))).toBeTrue();
  });

  test("requires strict versioned View configs and stable option identities", () => {
    const looseConfig = {
      ...request(),
      operation: {
        ...request().operation,
        initialView: {
          viewId: "view-1",
          name: "Loose",
          viewKind: "list",
          config: {},
        },
      },
    };
    expect(fails(() => parseDatabaseMutationRequest(looseConfig))).toBeTrue();

    const duplicateOptions = {
      ...request(),
      operation: {
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
    };
    expect(
      fails(() => parseDatabaseMutationRequest(duplicateOptions)),
    ).toBeTrue();
    expect(
      fails(() =>
        parseDatabaseMutationRequest({
          ...duplicateOptions,
          operation: {
            ...duplicateOptions.operation,
            valueType: "text",
            config: { optons: [] },
          },
        }),
      ),
    ).toBeTrue();
    expect(
      fails(() =>
        parseDatabaseMutationRequest({
          ...duplicateOptions,
          operation: {
            ...duplicateOptions.operation,
            config: {},
          },
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
      operation: {
        kind: "add_remove_value",
        cardBlockId: "card-1",
        databaseBlockId: "database-1",
        propertyId: "property-1",
        add: ["b", "a", "a"],
        remove: ["c"],
      },
    };
    const parsed = parseDatabaseMutationRequest(delta);
    if (parsed.operation.kind !== "add_remove_value") {
      throw new Error("Expected add_remove_value operation");
    }
    expect(parsed.operation.add.join(",")).toBe("a,b");
    expect(parsed.operation.remove.join(",")).toBe("c");
    expect(
      fails(() =>
        parseDatabaseMutationRequest({
          ...delta,
          operation: { ...delta.operation, remove: ["a"] },
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
