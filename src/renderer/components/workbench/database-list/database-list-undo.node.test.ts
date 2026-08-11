import { describe, expect, test } from "vitest";

import type { EffectiveDatabaseViewPresentation } from "../../../../shared/database-kernel";
import type { DatabaseViewMutationReceipt } from "@/lib/database-view-row-mutations";
import type { DatabaseViewRenderModel } from "@/lib/database-view-render-model";
import { compileDatabaseListDropIntent } from "./compile-list-drop-intent";
import { buildDatabaseListDropUndoOperations } from "./database-list-undo";

const effective: EffectiveDatabaseViewPresentation = {
  layout: "list",
  presentation: {
    sort: [{ field: { kind: "manual" }, direction: "asc", nulls: "last" }],
    group: null,
    subgroup: null,
    groupDirection: "asc",
    completion: { range: "all", orderByRecency: false },
    hierarchy: { showSubPages: true, nestedSubPages: true },
    layouts: {
      board: { fields: [], showEmptyGroups: false },
      list: { fields: [], showEmptyGroups: false },
    },
  },
};

const model = {
  readOnlyReason: null,
  commitSeq: 17,
  dataSourceId: "source-1",
  databaseViewId: "view-1",
  query: {
    view: {
      defaultLayout: "list",
      config: {
        schemaKey: "nodex.database-view",
        schemaVersion: 4,
        filter: { kind: "group", operator: "and", children: [] },
        presentation: effective.presentation,
      },
    },
    properties: [],
    rows: [
      { page: { pageId: "parent" }, membership: { membershipId: "m-parent" }, position: { revision: 1 }, effectiveGroupKey: null, effectiveSubgroupKey: null },
      { page: { pageId: "child-a" }, membership: { membershipId: "m-a" }, position: { revision: 2 }, taskHierarchy: { parentPageId: "parent", siblingRank: "a", revision: 4 }, effectiveGroupKey: null, effectiveSubgroupKey: null },
      { page: { pageId: "child-b" }, membership: { membershipId: "m-b" }, position: { revision: 3 }, taskHierarchy: { parentPageId: "parent", siblingRank: "b", revision: 2 }, effectiveGroupKey: null, effectiveSubgroupKey: null },
      { page: { pageId: "root-b" }, membership: { membershipId: "m-root" }, position: { revision: 4 }, effectiveGroupKey: null, effectiveSubgroupKey: null },
    ],
  },
} as unknown as DatabaseViewRenderModel;

describe("Database List drop undo", () => {
  test("restores the previous parent and ordered run with acknowledged CAS revisions", () => {
    const compiled = compileDatabaseListDropIntent({
      model,
      effective,
      pageIds: ["child-a"],
      targetPageId: "root-b",
      position: "before",
      groupKey: null,
      subgroupKey: null,
    });
    if (!compiled.ok) throw new Error(compiled.reason);
    const receipt = {
      committedRevisions: {
        "task_hierarchy:child-a": 0,
        "position:view-1:child-a": 5,
      },
    } as unknown as DatabaseViewMutationReceipt;

    expect(buildDatabaseListDropUndoOperations({
      model,
      compiled: compiled.value,
      receipt,
    })).toEqual([
      {
        kind: "set_task_parent",
        dataSourceId: "source-1",
        pages: [{ pageId: "child-a", expectedHierarchyRevision: 0 }],
        parentPageId: "parent",
        beforePageId: "child-b",
      },
      {
        kind: "position_pages",
        viewId: "view-1",
        pages: [{ pageId: "child-a", expectedPositionRevision: 5 }],
        beforePageId: "child-b",
      },
    ]);
  });

  test("restores disjoint Pages as separate original runs in one atomic batch", () => {
    const disjointModel = {
      ...model,
      query: {
        ...model.query,
        rows: [
          { page: { pageId: "one" }, membership: { membershipId: "m-one" }, position: { revision: 1 }, effectiveGroupKey: null, effectiveSubgroupKey: null },
          { page: { pageId: "two" }, membership: { membershipId: "m-two" }, position: { revision: 2 }, effectiveGroupKey: null, effectiveSubgroupKey: null },
          { page: { pageId: "three" }, membership: { membershipId: "m-three" }, position: { revision: 3 }, effectiveGroupKey: null, effectiveSubgroupKey: null },
          { page: { pageId: "four" }, membership: { membershipId: "m-four" }, position: { revision: 4 }, effectiveGroupKey: null, effectiveSubgroupKey: null },
          { page: { pageId: "target" }, membership: { membershipId: "m-target" }, position: { revision: 5 }, effectiveGroupKey: null, effectiveSubgroupKey: null },
        ],
      },
    } as unknown as DatabaseViewRenderModel;
    const compiled = compileDatabaseListDropIntent({
      model: disjointModel,
      effective,
      pageIds: ["one", "three"],
      targetPageId: "target",
      position: "after",
      groupKey: null,
      subgroupKey: null,
    });
    if (!compiled.ok) throw new Error(compiled.reason);
    const receipt = {
      committedRevisions: {
        "position:view-1:one": 6,
        "position:view-1:three": 7,
      },
    } as unknown as DatabaseViewMutationReceipt;

    expect(buildDatabaseListDropUndoOperations({
      model: disjointModel,
      compiled: compiled.value,
      receipt,
    })).toEqual([
      {
        kind: "position_pages",
        viewId: "view-1",
        pages: [{ pageId: "three", expectedPositionRevision: 7 }],
        beforePageId: "four",
      },
      {
        kind: "position_pages",
        viewId: "view-1",
        pages: [{ pageId: "one", expectedPositionRevision: 6 }],
        beforePageId: "two",
      },
    ]);
  });
});
