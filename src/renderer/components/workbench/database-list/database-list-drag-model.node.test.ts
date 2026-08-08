import { describe, expect, test } from "vitest";

import {
  databaseListDragTargetChangesPlacement,
  databaseListDropTargetIdentity,
  normalizeDatabaseListDropTarget,
  resolveDatabaseListDragSources,
  resolveDatabaseListRawEdge,
} from "./database-list-drag-model";
import {
  emptyDatabaseListSelection,
  type DatabaseListPageRow,
  type DatabaseListProjectionRow,
} from "./database-list-model";

const page = (input: {
  readonly key: string;
  readonly pageId: string;
  readonly depth?: number;
  readonly ancestors?: readonly string[];
  readonly transientKind?: DatabaseListPageRow["transientKind"];
  readonly subtreeOccurrenceCount?: number;
  readonly concreteSubtreePageCount?: number;
  readonly hasChildren?: boolean;
  readonly groupKey?: string;
}): DatabaseListPageRow => ({
  kind: "page",
  key: input.key,
  pageId: input.pageId,
  row: {
    pageId: input.pageId,
    pageKey: null,
    groupKey: input.groupKey ?? "build",
    subgroupKey: null,
    title: input.pageId,
    preview: "",
    plainText: "",
    tags: [],
    taskParentValueRevision: 1,
    metadataRevision: 1,
    createdAt: new Date("2026-08-13T00:00:00.000Z"),
  },
  groupKey: input.groupKey ?? "build",
  subgroupKey: null,
  ancestorPageIds: input.ancestors ?? [],
  depth: input.depth ?? 0,
  hasChildren: input.hasChildren ?? false,
  transientKind: input.transientKind ?? "none",
  subtreeOccurrenceCount: input.subtreeOccurrenceCount ?? 1,
  concreteSubtreePageCount: input.concreteSubtreePageCount ?? 1,
  subtreeHeight: 0,
  firstChildOccurrenceKey: null,
  firstInGroup: false,
  lastInGroup: false,
  height: 44,
});

const selected = (...occurrenceKeys: readonly string[]) => ({
  ...emptyDatabaseListSelection(),
  selectedOccurrenceKeys: new Set(occurrenceKeys),
  activeOccurrenceKey: occurrenceKeys[0] ?? null,
});

const subtree = (): readonly DatabaseListProjectionRow[] => [
  page({
    key: "a",
    pageId: "A",
    hasChildren: true,
    subtreeOccurrenceCount: 4,
    concreteSubtreePageCount: 4,
  }),
  page({
    key: "b",
    pageId: "B",
    depth: 1,
    ancestors: ["A"],
    hasChildren: true,
    subtreeOccurrenceCount: 2,
    concreteSubtreePageCount: 2,
  }),
  page({ key: "c", pageId: "C", depth: 2, ancestors: ["A", "B"] }),
  page({ key: "d", pageId: "D", depth: 1, ancestors: ["A"] }),
  page({ key: "e", pageId: "E" }),
];

describe("Database List subtree drag model", () => {
  test("classifies the exact row midpoint as after", () => {
    expect(resolveDatabaseListRawEdge({
      pointerY: 122,
      top: 100,
      height: 44,
      explicitInside: false,
    })).toBe("after");
    expect(resolveDatabaseListRawEdge({
      pointerY: 121.999,
      top: 100,
      height: 44,
      explicitInside: false,
    })).toBe("before");
  });

  test("normalizes an ancestor plus descendant selection to one visible subtree root", () => {
    const rows = subtree();
    const sources = resolveDatabaseListDragSources({
      rows,
      selection: selected("a", "b", "c"),
      initiatorOccurrenceKey: "a",
    });

    expect(sources?.rootRows.map((row) => row.key)).toEqual(["a"]);
    expect([...sources!.visibleClosurePageIds]).toEqual(["A", "B", "C", "D"]);
    expect(sources?.concretePageCount).toBe(4);
  });

  test("skips a transient occurrence without truncating its concrete descendants", () => {
    const rows = [
      page({
        key: "root",
        pageId: "root",
        hasChildren: true,
        subtreeOccurrenceCount: 3,
        concreteSubtreePageCount: 2,
      }),
      page({
        key: "context",
        pageId: "context",
        depth: 1,
        ancestors: ["root"],
        transientKind: "child",
        hasChildren: true,
        subtreeOccurrenceCount: 2,
        concreteSubtreePageCount: 1,
      }),
      page({
        key: "deep",
        pageId: "deep",
        depth: 2,
        ancestors: ["root", "context"],
      }),
    ];
    const sources = resolveDatabaseListDragSources({
      rows,
      selection: selected("root"),
      initiatorOccurrenceKey: "root",
    });

    expect([...sources!.visibleClosurePageIds]).toEqual(["root", "deep"]);
    expect(sources?.concretePageCount).toBe(2);
    expect(resolveDatabaseListDragSources({
      rows,
      selection: selected("context"),
      initiatorOccurrenceKey: "context",
    })).toBeNull();
  });

  test("previews after a parent as the first child slot", () => {
    const rows = subtree();
    const sources = resolveDatabaseListDragSources({
      rows,
      selection: selected("e"),
      initiatorOccurrenceKey: "e",
    });
    const target = normalizeDatabaseListDropTarget({
      rows,
      row: rows[0]!,
      rawEdge: "after",
      sources: sources!,
    });

    expect(target).toMatchObject({
      kind: "page",
      overOccurrenceKey: "a",
      occurrenceKey: "b",
      pointerEdge: "after",
      indicatorEdge: "before",
      prospectiveDepth: 1,
      target: { kind: "page", occurrenceKey: "a", edge: "after" },
    });
  });

  test("canonicalizes both halves of one sibling gap to one stable slot", () => {
    const rows = [
      page({ key: "x", pageId: "X" }),
      page({ key: "y", pageId: "Y" }),
      page({ key: "z", pageId: "Z" }),
    ];
    const sources = resolveDatabaseListDragSources({
      rows,
      selection: selected("z"),
      initiatorOccurrenceKey: "z",
    })!;
    const lowerHalf = normalizeDatabaseListDropTarget({
      rows,
      row: rows[0]!,
      rawEdge: "after",
      sources,
    });
    const upperHalf = normalizeDatabaseListDropTarget({
      rows,
      row: rows[1]!,
      rawEdge: "before",
      sources,
    });

    expect(lowerHalf).toMatchObject({
      overOccurrenceKey: "x",
      occurrenceKey: "y",
      indicatorEdge: "before",
      target: { kind: "page", occurrenceKey: "x", edge: "after" },
    });
    expect(upperHalf).toMatchObject({
      overOccurrenceKey: "y",
      occurrenceKey: "y",
      indicatorEdge: "before",
    });
    expect(databaseListDropTargetIdentity(lowerHalf))
      .toBe(databaseListDropTargetIdentity(upperHalf));
  });

  test("treats a drop back into the source's current sibling slot as a no-op", () => {
    const rows = [
      page({ key: "x", pageId: "X" }),
      page({ key: "y", pageId: "Y" }),
      page({ key: "z", pageId: "Z" }),
    ];
    const sources = resolveDatabaseListDragSources({
      rows,
      selection: selected("y"),
      initiatorOccurrenceKey: "y",
    })!;
    const target = normalizeDatabaseListDropTarget({
      rows,
      row: rows[0]!,
      rawEdge: "after",
      sources,
    });

    expect(target).toMatchObject({
      overOccurrenceKey: "x",
      occurrenceKey: "x",
      indicatorEdge: "after",
    });
    expect(databaseListDragTargetChangesPlacement({
      rows,
      sources,
      target: target!,
    })).toBe(false);
  });

  test("leaves bounded all-matching no-op authority to Core", () => {
    const rows = [
      page({ key: "x", pageId: "X" }),
      page({ key: "y", pageId: "Y" }),
    ];
    const sources = resolveDatabaseListDragSources({
      rows,
      selection: {
        ...emptyDatabaseListSelection(),
        allMatching: true,
        excludedOccurrenceKeys: new Set(["x"]),
      },
      initiatorOccurrenceKey: "y",
    })!;
    const target = normalizeDatabaseListDropTarget({
      rows,
      row: rows[0]!,
      rawEdge: "after",
      sources,
    });

    expect(sources.previewClosureComplete).toBe(false);
    expect(databaseListDragTargetChangesPlacement({
      rows,
      sources,
      target: target!,
    })).toBe(true);
  });

  test("rejects every Page target inside the concrete closure", () => {
    const rows = subtree();
    const sources = resolveDatabaseListDragSources({
      rows,
      selection: selected("a"),
      initiatorOccurrenceKey: "a",
    });

    expect(normalizeDatabaseListDropTarget({
      rows,
      row: rows[2]!,
      rawEdge: "before",
      sources: sources!,
    })).toBeNull();
  });

  test("deduplicates a fully visible Page closure for the overlay count", () => {
    const rows = [
      page({ key: "first", pageId: "same" }),
      page({ key: "second", pageId: "same", groupKey: "ship" }),
    ];
    const sources = resolveDatabaseListDragSources({
      rows,
      selection: selected("first", "second"),
      initiatorOccurrenceKey: "first",
    });

    expect(sources?.rootRows).toHaveLength(2);
    expect(sources?.concretePageCount).toBe(1);
  });
});
