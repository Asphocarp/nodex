import { describe, expect, test } from "vitest";

import type { DatabaseListPageRow } from "./database-list-model";
import { databaseListNestingContinuations } from "./database-list-nesting-lines";

const page = (
  key: string,
  pageId: string,
  ancestorPageIds: readonly string[],
): DatabaseListPageRow => ({
  kind: "page",
  key,
  pageId,
  row: {
    pageId,
    groupKey: "build",
    subgroupKey: null,
    title: pageId,
    preview: "",
    plainText: "",
    tags: [],
    taskParentValueRevision: 1,
    metadataRevision: 1,
    createdAt: new Date("2026-08-12T00:00:00.000Z"),
  },
  groupKey: "build",
  subgroupKey: null,
  ancestorPageIds,
  depth: ancestorPageIds.length,
  hasChildren: false,
  collapsed: false,
  transientKind: "none",
  firstInGroup: false,
  lastInGroup: false,
  height: 44,
});

describe("Database List nesting guides", () => {
  test("continues only ancestor branches with a later direct sibling", () => {
    const rows = [
      page("root", "root", []),
      page("child-a", "child-a", ["root"]),
      page("grandchild", "grandchild", ["root", "child-a"]),
      page("child-b", "child-b", ["root"]),
    ];

    const continuations = databaseListNestingContinuations(rows);

    expect(continuations.get("child-a")).toEqual([true]);
    expect(continuations.get("grandchild")).toEqual([true, false]);
    expect(continuations.get("child-b")).toEqual([false]);
  });

  test("keeps identical Page ids in separate group occurrence trees", () => {
    const duplicate = page("other-group", "child-a", ["root"]);
    const rows = [
      page("first", "child-a", ["root"]),
      {
        ...duplicate,
        groupKey: "ship",
        row: { ...duplicate.row, groupKey: "ship" },
      },
    ];

    const continuations = databaseListNestingContinuations(rows);

    expect(continuations.get("first")).toEqual([false]);
    expect(continuations.get("other-group")).toEqual([false]);
  });
});
