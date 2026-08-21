import { describe, expect, it } from "vite-plus/test";

import {
  buildCurrentPageKeySearchAliases,
  isPlausiblePageKeyPrefixDraft,
  isExplicitPageKeySearch,
  normalizePageKeyPrefixInput,
} from "./page-key";

describe("Page key prefix", () => {
  it("normalizes drafts and gives immediate non-authoritative feedback", () => {
    expect(normalizePageKeyPrefixInput(" lab ")).toBe("LAB");
    expect(isPlausiblePageKeyPrefixDraft("LAB")).toBe(true);
    expect(isPlausiblePageKeyPrefixDraft("1LAB")).toBe(false);
  });

  it("builds canonical and compact aliases without accepting malformed keys", () => {
    expect(buildCurrentPageKeySearchAliases("LAB-13")).toEqual(["LAB-13", "LAB13"]);
    expect(buildCurrentPageKeySearchAliases("LAB-01")).toEqual([]);
    expect(isExplicitPageKeySearch(" #lab-13 ")).toBe(true);
    expect(isExplicitPageKeySearch("lab-13")).toBe(false);
  });
});
