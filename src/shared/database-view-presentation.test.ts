import { describe, expect, test } from "vitest";
import type {
  DatabaseViewConfigV2,
  DatabaseViewPresentationConfig,
} from "./database-kernel";
import {
  DatabaseMutationContractError,
  parseDatabaseViewConfigV4,
  parseDatabaseViewPresentationOverride,
} from "./database-kernel";
import {
  compactDatabaseViewPresentationOverride,
  resolveEffectiveDatabaseView,
  upgradeDatabaseViewConfigV2,
  type DatabaseViewCapabilities,
} from "./database-view-presentation";

const capabilities: DatabaseViewCapabilities = {
  properties: [
    { propertyId: "status", sortable: true, groupable: true, finite: true },
    { propertyId: "priority", sortable: true, groupable: true, finite: true },
    { propertyId: "estimate", sortable: true, groupable: false, finite: false },
    { propertyId: "notes", sortable: false, groupable: false, finite: false },
  ],
  taskStatusPropertyId: "status",
};

const presentation: DatabaseViewPresentationConfig = {
  sort: [
    { field: { kind: "manual" }, direction: "asc", nulls: "last" },
  ],
  group: { propertyId: "status" },
  subgroup: null,
  groupDirection: "asc",
  completion: { range: "all", orderByRecency: false },
  hierarchy: { showSubPages: true, nestedSubPages: false },
  layouts: {
    board: {
      fields: [{ kind: "property", propertyId: "priority" }],
      showEmptyGroups: false,
    },
    list: {
      fields: [
        { kind: "property", propertyId: "priority" },
        { kind: "intrinsic", field: "updated_at" },
      ],
      showEmptyGroups: false,
    },
  },
};

describe("Database View presentation", () => {
  test("accepts Page ID as an optional intrinsic display field", () => {
    const parsed = parseDatabaseViewConfigV4({
      schemaKey: "nodex.database-view",
      schemaVersion: 4,
      filter: { kind: "group", operator: "and", children: [] },
      presentation: {
        ...presentation,
        layouts: {
          ...presentation.layouts,
          list: {
            ...presentation.layouts.list,
            fields: [
              { kind: "intrinsic", field: "page_id" },
              ...presentation.layouts.list.fields,
            ],
          },
        },
      },
    });

    expect(parsed.presentation.layouts.list.fields[0]).toEqual({
      kind: "intrinsic",
      field: "page_id",
    });
  });

  test("parses sparse Profile overrides without accepting query fields", () => {
    expect(parseDatabaseViewPresentationOverride({
      layout: "list",
      group: null,
      groupDirection: "desc",
      completion: { range: "past_week" },
      layouts: {
        list: {
          fields: [{ kind: "property", propertyId: "priority" }],
        },
      },
    })).toEqual({
      layout: "list",
      group: null,
      groupDirection: "desc",
      completion: { range: "past_week" },
      layouts: {
        list: {
          fields: [{ kind: "property", propertyId: "priority" }],
        },
      },
    });
    expect(() => parseDatabaseViewPresentationOverride({
      filter: { kind: "group", operator: "and", children: [] },
    })).toThrow(DatabaseMutationContractError);
  });

  test("upgrades v2 without preserving title visibility as a presentation option", () => {
    const config: DatabaseViewConfigV2 = {
      schemaKey: "nodex.database-view",
      schemaVersion: 2,
      filter: { kind: "group", operator: "and", children: [] },
      sort: [
        { field: { kind: "manual" }, direction: "asc", nulls: "last" },
      ],
      group: { propertyId: "status" },
      display: { propertyIds: ["priority", "estimate"], showTitle: false },
    };

    expect(upgradeDatabaseViewConfigV2(config)).toEqual({
      schemaKey: "nodex.database-view",
      schemaVersion: 4,
      filter: config.filter,
      presentation: {
        sort: config.sort,
        group: config.group,
        subgroup: null,
        groupDirection: "asc",
        completion: { range: "all", orderByRecency: false },
        hierarchy: { showSubPages: true, nestedSubPages: false },
        layouts: {
          board: {
            fields: [
              { kind: "property", propertyId: "priority" },
              { kind: "property", propertyId: "estimate" },
            ],
            showEmptyGroups: false,
          },
          list: {
            fields: [
              { kind: "property", propertyId: "priority" },
              { kind: "property", propertyId: "estimate" },
            ],
            showEmptyGroups: false,
          },
        },
      },
    });
  });

  test("normalizes stale properties and capability-dependent controls", () => {
    const effective = resolveEffectiveDatabaseView(
      "board",
      presentation,
      {
        layout: "list",
        sort: [
          { field: { kind: "property", propertyId: "notes" }, direction: "asc", nulls: "last" },
          { field: { kind: "property", propertyId: "priority" }, direction: "desc", nulls: "last" },
          { field: { kind: "property", propertyId: "priority" }, direction: "asc", nulls: "first" },
        ],
        group: { propertyId: "priority" },
        subgroup: { propertyId: "priority" },
        completion: { range: "past_week", orderByRecency: true },
        layouts: {
          list: {
            fields: [
              { kind: "property", propertyId: "missing" },
              { kind: "property", propertyId: "estimate" },
              { kind: "property", propertyId: "estimate" },
            ],
            showEmptyGroups: true,
          },
        },
      },
      capabilities,
    );

    expect(effective).toMatchObject({
      layout: "list",
      presentation: {
        sort: [
          { field: { kind: "property", propertyId: "priority" }, direction: "desc", nulls: "last" },
        ],
        group: { propertyId: "priority" },
        subgroup: null,
        completion: { range: "past_week", orderByRecency: true },
        layouts: {
          list: {
            fields: [{ kind: "property", propertyId: "estimate" }],
            showEmptyGroups: true,
          },
        },
      },
    });
  });

  test("hides completion and empty-group semantics without real capabilities", () => {
    const effective = resolveEffectiveDatabaseView(
      "list",
      presentation,
      {
        completion: { range: "past_day", orderByRecency: true },
        group: { propertyId: "estimate" },
        layouts: { list: { showEmptyGroups: true } },
      },
      { properties: capabilities.properties },
    );

    expect(effective.presentation.group).toBeNull();
    expect(effective.presentation.completion).toEqual({
      range: "all",
      orderByRecency: false,
    });
    expect(effective.presentation.layouts.list.showEmptyGroups).toBe(false);
  });

  test("compacts overrides and round-trips through the effective resolver", () => {
    const durable = resolveEffectiveDatabaseView(
      "board",
      presentation,
      undefined,
      capabilities,
    );
    const desired = resolveEffectiveDatabaseView(
      "board",
      presentation,
      {
        layout: "list",
        group: { propertyId: "priority" },
        groupDirection: "desc",
        completion: { range: "past_month" },
        layouts: {
          list: {
            fields: [{ kind: "property", propertyId: "estimate" }],
          },
        },
      },
      capabilities,
    );
    const compact = compactDatabaseViewPresentationOverride(durable, desired);

    expect(compact).toEqual({
      layout: "list",
      group: { propertyId: "priority" },
      groupDirection: "desc",
      completion: { range: "past_month" },
      layouts: {
        list: { fields: [{ kind: "property", propertyId: "estimate" }] },
      },
    });
    expect(
      resolveEffectiveDatabaseView(
        "board",
        presentation,
        compact ?? undefined,
        capabilities,
      ),
    ).toEqual(desired);
    expect(
      compactDatabaseViewPresentationOverride(durable, durable),
    ).toBeNull();
  });
});
