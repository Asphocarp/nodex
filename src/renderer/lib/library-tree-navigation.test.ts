import { describe, expect, test } from "vitest";

import {
  findLibraryTreeTypeaheadTarget,
  resolveLibraryTreeKeyboardAction,
  updateLibraryTreeTypeaheadBuffer,
} from "./library-tree-navigation";

describe("Library tree navigation", () => {
  const base = {
    currentKey: "page:a",
    visibleKeys: ["page:a", "page:b", "database:c"],
    parentKey: null,
    expandable: true,
    expanded: false,
  } as const;

  test("follows the composite tree directional model", () => {
    expect(resolveLibraryTreeKeyboardAction({ ...base, key: "ArrowRight" }))
      .toEqual({ kind: "expand", key: "page:a" });
    expect(resolveLibraryTreeKeyboardAction({
      ...base,
      key: "ArrowLeft",
      currentKey: "page:b",
      parentKey: "page:a",
    })).toEqual({ kind: "focus", key: "page:a" });
    expect(resolveLibraryTreeKeyboardAction({ ...base, key: "End" }))
      .toEqual({ kind: "focus", key: "database:c" });
  });

  test("wraps buffered typeahead after the focused node", () => {
    expect(findLibraryTreeTypeaheadTarget({
      currentKey: "database:c",
      query: "pa",
      labels: [
        { key: "page:a", label: "Page alpha" },
        { key: "page:b", label: "Page beta" },
        { key: "database:c", label: "Database" },
      ],
    })).toBe("page:a");
  });

  test("accumulates nearby characters and restarts after the timeout", () => {
    const first = updateLibraryTreeTypeaheadBuffer({
      buffer: "",
      lastTypedAt: 0,
      key: "p",
      now: 1_000,
    });
    const second = updateLibraryTreeTypeaheadBuffer({
      ...first,
      key: "a",
      now: 1_400,
    });
    expect(second.buffer).toBe("pa");
    expect(updateLibraryTreeTypeaheadBuffer({
      ...second,
      key: "d",
      now: 2_200,
    }).buffer).toBe("d");
  });
});
