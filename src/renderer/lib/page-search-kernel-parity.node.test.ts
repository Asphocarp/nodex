import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeAll, describe, expect, test } from "vitest";
import {
  initSync,
  PageSearchPreviewIndex,
} from "../generated/page-search-wasm/nodex_page_search_kernel.js";
import fixture from "../../../crates/nodex-page-search-kernel/tests/fixtures/parity.json";

describe("Page search WASM adapter", () => {
  beforeAll(() => {
    initSync({
      module: readFileSync(resolve(
        import.meta.dirname,
        "../generated/page-search-wasm/nodex_page_search_kernel_bg.wasm",
      )),
    });
  });

  test("satisfies the same corpus contract as native Rust", () => {
    const index = new PageSearchPreviewIndex(fixture.documents);
    for (const parityCase of fixture.cases) {
      const hits = index.search(parityCase.request) as { pageId: string }[];
      expect(hits.map((hit) => hit.pageId), parityCase.name)
        .toEqual(parityCase.expectedPageIds);
    }
  });

  test("applies upserts and removals without retaining stale postings", () => {
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
      .toEqual([replacement.pageId]);

    index.applyDelta([], [replacement.pageId]);
    expect(index.search(request)).toEqual([]);
  });
});
