import { describe, expect, test } from "vitest";
import {
  clearPageDraftOverlay,
  getPageDraftOverlay,
  mergePageDraftOverlay,
  resetPageDraftStoreForTest,
  setPageDraftOverlay,
} from "./page-draft-store";

describe("page draft store", () => {
  test("stores and clears scoped draft overlays", () => {
    resetPageDraftStoreForTest();

    setPageDraftOverlay("default", "page-1", {
      title: "Draft title",
    });

    const stored = getPageDraftOverlay("default", "page-1");
    expect(stored?.title).toBe("Draft title");

    clearPageDraftOverlay("default", "page-1");
    expect(getPageDraftOverlay("default", "page-1")).toBe(null);
  });

  test("merges overlays without touching unrelated fields", () => {
    const merged = mergePageDraftOverlay({
      id: "page-1",
      title: "Persisted title",
      description: "Persisted body",
      priority: "p2-medium",
    }, {
      title: "Draft title",
    });

    expect(merged?.title).toBe("Draft title");
    expect(merged?.description).toBe("Persisted body");
    expect(merged?.priority).toBe("p2-medium");
  });
});
