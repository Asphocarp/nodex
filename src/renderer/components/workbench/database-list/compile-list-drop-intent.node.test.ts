import { describe, expect, test } from "vitest";

import type { EffectiveDatabaseViewPresentation } from "../../../../shared/database-kernel";
import type { DatabaseViewRenderModel } from "@/lib/database-view-render-model";
import { compileDatabaseListDropIntent } from "./compile-list-drop-intent";

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

const hierarchy = (parentPageId: string, siblingRank: string, revision = 1) => ({
  parentPageId,
  siblingRank,
  revision,
});

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
      { page: { pageId: "parent" }, position: { revision: 1 }, effectiveGroupKey: null, effectiveSubgroupKey: null },
      { page: { pageId: "child-a" }, position: { revision: 2 }, taskHierarchy: hierarchy("parent", "a"), effectiveGroupKey: null, effectiveSubgroupKey: null },
      { page: { pageId: "child-b" }, position: { revision: 3 }, taskHierarchy: hierarchy("parent", "b", 2), effectiveGroupKey: null, effectiveSubgroupKey: null },
      { page: { pageId: "root-b" }, position: { revision: 4 }, effectiveGroupKey: null, effectiveSubgroupKey: null },
    ],
  },
} as unknown as DatabaseViewRenderModel;

describe("compileDatabaseListDropIntent", () => {
  test("nests a deduplicated selection with hierarchy CAS revisions", () => {
    const result = compileDatabaseListDropIntent({
      model,
      effective,
      pageIds: ["root-b", "root-b"],
      targetPageId: "parent",
      position: "nest",
      groupKey: null,
      subgroupKey: null,
    });
    expect(result).toMatchObject({
      ok: true,
      value: {
        pageIds: ["root-b"],
        hierarchyMutations: [{
          kind: "set_task_parent",
          parentPageId: "parent",
          pages: [{ pageId: "root-b", expectedHierarchyRevision: 0 }],
        }],
      },
    });
  });

  test("orders one nested sibling after another through the next sibling anchor", () => {
    const result = compileDatabaseListDropIntent({
      model,
      effective,
      pageIds: ["child-a"],
      targetPageId: "child-b",
      position: "after",
      groupKey: null,
      subgroupKey: null,
    });
    expect(result).toMatchObject({
      ok: true,
      value: {
        hierarchyMutations: [{
          parentPageId: "parent",
          pages: [{ pageId: "child-a", expectedHierarchyRevision: 1 }],
        }],
      },
    });
  });

  test("promotes a sub-page to root and restores View-global positioning", () => {
    const result = compileDatabaseListDropIntent({
      model,
      effective,
      pageIds: ["child-a"],
      targetPageId: "root-b",
      position: "before",
      groupKey: null,
      subgroupKey: null,
    });
    expect(result).toMatchObject({
      ok: true,
      value: {
        hierarchyMutations: [{
          kind: "set_task_parent",
          pages: [{ pageId: "child-a", expectedHierarchyRevision: 1 }],
        }],
        positionMutations: [{ kind: "position_pages", beforePageId: "root-b" }],
      },
    });
  });

  test("rejects moving a parent beneath its descendant", () => {
    expect(compileDatabaseListDropIntent({
      model,
      effective,
      pageIds: ["parent"],
      targetPageId: "child-b",
      position: "nest",
      groupKey: null,
      subgroupKey: null,
    })).toEqual({ ok: false, reason: "This nesting would create a cycle" });
  });

  test("moves only selected multi-value group occurrences and preserves other values", () => {
    const multiSelectEffective: EffectiveDatabaseViewPresentation = {
      ...effective,
      presentation: {
        ...effective.presentation,
        group: { propertyId: "tags" },
      },
    };
    const multiSelectModel = {
      ...model,
      query: {
        ...model.query,
        view: {
          ...model.query.view,
          config: {
            ...model.query.view.config,
            presentation: multiSelectEffective.presentation,
          },
        },
        properties: [{
          propertyId: "tags",
          lifecycle: "active",
          valueType: "multi_select",
        }],
        rows: [{
          page: { pageId: "multi" },
          membership: { membershipId: "membership-multi" },
          values: {
            tags: {
              propertyId: "tags",
              valueType: "multi_select",
              value: ["o_AAAAAAAA", "o_BBBBBBBB", "o_KEEPMEEE"],
              revision: 3,
            },
          },
          position: { revision: 1 },
          effectiveGroupKey: "[\"o_AAAAAAAA\",\"o_BBBBBBBB\",\"o_KEEPMEEE\"]",
          effectiveSubgroupKey: null,
        }, {
          page: { pageId: "target" },
          membership: { membershipId: "membership-target" },
          values: {},
          position: { revision: 2 },
          effectiveGroupKey: "o_CCCCCCCC",
          effectiveSubgroupKey: null,
        }],
      },
    } as unknown as DatabaseViewRenderModel;
    const result = compileDatabaseListDropIntent({
      model: multiSelectModel,
      effective: multiSelectEffective,
      pageIds: ["multi", "multi"],
      sourceOccurrences: [{
        occurrenceKey: "alpha",
        pageId: "multi",
        groupKey: "o_AAAAAAAA",
        subgroupKey: null,
      }, {
        occurrenceKey: "beta",
        pageId: "multi",
        groupKey: "o_BBBBBBBB",
        subgroupKey: null,
      }],
      targetPageId: "target",
      position: "before",
      groupKey: "o_CCCCCCCC",
      subgroupKey: null,
    });
    if (!result.ok) throw new Error(result.reason);

    expect(result.value.pageIds).toEqual(["multi"]);
    expect(result.value.propertyMutations).toEqual([{
      pageId: "multi",
      dataSourceId: "source-1",
      propertyId: "tags",
      edit: {
        kind: "patch_set",
        delta: {
          kind: "multi_select",
          addOptionIds: ["o_CCCCCCCC"],
          removeOptionIds: ["o_AAAAAAAA", "o_BBBBBBBB"],
        },
      },
    }]);
  });
});
