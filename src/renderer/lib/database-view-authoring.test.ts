import { describe, expect, test } from "vitest";
import type {
  DatabaseViewFilterNode,
  GeneralDatabaseViewConfig,
} from "../../shared/database-kernel";
import type {
  GeneralDatabasePropertyDefinition,
  GeneralDatabaseViewDefinition,
} from "../../shared/database-query";
import {
  appendDatabaseViewFilterChild,
  createDatabaseViewFilterClause,
  databaseFilterClauseWithOperator,
  filterOperatorsForProperty,
  databaseViewConfigsEqual,
  databaseViewMoveBeforeId,
  moveDatabaseViewSort,
  removeDatabaseViewFilterNode,
  updateDatabaseViewFilterNode,
} from "./database-view-authoring";

const timestamp = "2026-07-12T00:00:00.000Z";

const property = (valueType: GeneralDatabasePropertyDefinition["valueType"]): GeneralDatabasePropertyDefinition => ({
  id: `property-${valueType}`,
  databaseBlockId: "database-1",
  key: valueType,
  name: valueType,
  valueType,
  config: valueType === "select" || valueType === "multi_select"
    ? { options: [{ id: "one", name: "One" }] }
    : {},
  rankKey: "a",
  lifecycle: "active",
  revision: 1,
  createdAt: timestamp,
  updatedAt: timestamp,
});

const view = (id: string): GeneralDatabaseViewDefinition => ({
  id,
  databaseBlockId: "database-1",
  projectId: "project-1",
  name: id,
  kind: "list",
  config: {
    schemaKey: "nodex.database-view",
    schemaVersion: 1,
    filter: { kind: "group", operator: "and", children: [] },
    sort: [],
    group: null,
    display: { propertyIds: [], showTitle: true },
  },
  isPrimary: id === "a",
  revision: 1,
  rankKey: id,
  lifecycle: "active",
  createdAt: timestamp,
  updatedAt: timestamp,
});

describe("durable Database View authoring", () => {
  test("derives server-owned logical anchors for adjacent View moves", () => {
    const views = [view("a"), view("b"), view("c")];
    expect(databaseViewMoveBeforeId(views, "b", "up")).toBe("a");
    expect(databaseViewMoveBeforeId(views, "a", "down")).toBe("c");
    expect(databaseViewMoveBeforeId(views, "b", "down")).toBe(null);
    expect(databaseViewMoveBeforeId(views, "a", "up")).toBeUndefined();
    expect(databaseViewMoveBeforeId(views, "c", "down")).toBeUndefined();
  });

  test("updates nested filters immutably and preserves value arity", () => {
    const text = property("text");
    const number = property("number");
    const initial: DatabaseViewFilterNode = {
      kind: "group",
      operator: "and",
      children: [createDatabaseViewFilterClause(text)],
    };
    const nested = appendDatabaseViewFilterChild(initial, [], {
      kind: "group",
      operator: "or",
      children: [createDatabaseViewFilterClause(number)],
    });
    const withoutValue = databaseFilterClauseWithOperator(number, "is_empty");
    const updated = updateDatabaseViewFilterNode(nested, [1, 0], withoutValue);
    const removed = removeDatabaseViewFilterNode(updated, [0]);

    expect(initial.kind === "group" ? initial.children.length : -1).toBe(1);
    expect(JSON.stringify(updated).includes('"value"')).toBe(true);
    expect(JSON.stringify(withoutValue).includes('"value"')).toBe(false);
    expect(removed.kind === "group" ? removed.children.length : -1).toBe(1);
  });

  test("authors negative membership filters with scalar set members", () => {
    const multiSelect = property("multi_select");
    expect(filterOperatorsForProperty(multiSelect)).toContain("not_contains");
    expect(
      databaseFilterClauseWithOperator(multiSelect, "not_contains"),
    ).toEqual({
      kind: "clause",
      propertyId: multiSelect.id,
      operator: "not_contains",
      value: "one",
    });
  });

  test("compares canonical configs and reorders sort precedence", () => {
    const base: GeneralDatabaseViewConfig = {
      schemaKey: "nodex.database-view",
      schemaVersion: 1,
      filter: { kind: "group", operator: "and", children: [] },
      sort: [
        { field: { kind: "title" }, direction: "asc", nulls: "last" },
        { field: { kind: "manual" }, direction: "asc", nulls: "last" },
      ],
      group: null,
      display: { propertyIds: [], showTitle: true },
    };
    const moved = moveDatabaseViewSort(base.sort, 1, "up");
    expect(moved[0]?.field.kind).toBe("manual");
    expect(databaseViewConfigsEqual(base, { ...base, sort: [...base.sort] })).toBe(true);
    expect(databaseViewConfigsEqual(base, { ...base, sort: moved })).toBe(false);
  });
});
