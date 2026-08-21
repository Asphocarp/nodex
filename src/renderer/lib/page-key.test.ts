import { describe, expect, it } from "vite-plus/test";
import {
  buildCurrentPageKeyIndex,
  matchPageKeySearchQuery,
  parsePageKeySearchQuery,
  searchCurrentPageKeyIndex,
} from "./page-key";

describe("Page key search", () => {
  it.each([
    { query: "LAB-13", explicit: false, kind: "exact" },
    { query: "#lab-13", explicit: true, kind: "exact" },
    { query: "  lab-13  ", explicit: false, kind: "exact" },
    { query: "lab13", explicit: false, kind: "exact" },
    { query: "lab-1", explicit: false, kind: "prefix" },
    { query: "#", explicit: true, kind: null },
    { query: "##lab-13", explicit: true, kind: null },
    { query: "lab-13 polish", explicit: false, kind: null },
    { query: "#lab-13 polish", explicit: true, kind: null },
    { query: "lxb-13", explicit: false, kind: null },
  ])("treats '$query' as a whole-query Page-key lookup", ({ query, explicit, kind }) => {
    const parsed = parsePageKeySearchQuery(query);
    const match = matchPageKeySearchQuery("LAB-13", parsed);

    expect(parsed.explicit).toBe(explicit);
    expect(match?.kind ?? null).toBe(kind);
  });

  it("lets one compact query match every loaded canonical split", () => {
    const parsed = parsePageKeySearchQuery("lab13");

    expect(matchPageKeySearchQuery("LAB-13", parsed)?.kind).toBe("exact");
    expect(matchPageKeySearchQuery("LAB1-3", parsed)?.kind).toBe("exact");
  });

  it("uses an exact map and bounded sorted prefix range for loaded current keys", () => {
    const pages = Array.from({ length: 10_000 }, (_, index) => ({
      id: `page-${index + 1}`,
      pageKey: `LAB-${index + 10_000}`,
    }));
    const index = buildCurrentPageKeyIndex(
      pages,
      (page) => page.id,
      (page) => page.pageKey,
    );

    expect(
      searchCurrentPageKeyIndex(index, parsePageKeySearchQuery("#LAB-19999")).map(
        (hit) => hit.value.id,
      ),
    ).toEqual(["page-10000"]);
    const prefix = searchCurrentPageKeyIndex(index, parsePageKeySearchQuery("#LAB-1999"), 4);
    expect(prefix).toHaveLength(4);
    expect(prefix.every((hit) => hit.value.pageKey.startsWith("LAB-1999"))).toBe(true);

    let candidateReads = 0;
    const measured = {
      ...index,
      sorted: new Proxy(index.sorted, {
        get(target, property, receiver) {
          if (typeof property === "string" && /^\d+$/.test(property)) {
            candidateReads += 1;
          }
          return Reflect.get(target, property, receiver);
        },
      }),
    };
    searchCurrentPageKeyIndex(measured, parsePageKeySearchQuery("#LAB-1999"), 4);
    expect(candidateReads).toBeLessThan(100);
  });
});
