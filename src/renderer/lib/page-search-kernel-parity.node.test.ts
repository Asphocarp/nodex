import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, test } from "vitest";
import {
  initSync,
  PageSearchPreviewIndex,
} from "../generated/page-search-wasm/nodex_page_search_kernel.js";
import fixture from "../../../crates/nodex-page-search-kernel/tests/fixtures/parity.json";

describe("Page search WASM adapter", () => {
  test("satisfies the same corpus contract as native Rust", () => {
    initSync({
      module: readFileSync(resolve(
        import.meta.dirname,
        "../generated/page-search-wasm/nodex_page_search_kernel_bg.wasm",
      )),
    });
    const index = new PageSearchPreviewIndex(fixture.documents);
    for (const parityCase of fixture.cases) {
      const hits = index.search(parityCase.request) as { pageId: string }[];
      expect(hits.map((hit) => hit.pageId), parityCase.name)
        .toEqual(parityCase.expectedPageIds);
    }
  });

  test("applies upserts and removals without retaining stale postings", () => {
    initSync({
      module: readFileSync(resolve(
        import.meta.dirname,
        "../generated/page-search-wasm/nodex_page_search_kernel_bg.wasm",
      )),
    });
    const index = new PageSearchPreviewIndex(fixture.documents);
    const replacement = {
      ...fixture.documents[0],
      title: "Replacement title",
      properties: [],
    };
    index.applyDelta([replacement], []);

    const request = {
      ...fixture.cases[0].request,
      query: "replacement",
    };
    expect((index.search(request) as { pageId: string }[]).map((hit) => hit.pageId))
      .toEqual(["page-canonical"]);

    index.applyDelta([], ["page-canonical"]);
    expect(index.search(request)).toEqual([]);
  });
});
