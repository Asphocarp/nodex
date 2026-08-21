import { describe, expect, test } from "vite-plus/test";
import { deriveBlockDocumentRecordsFromNfm } from "./derived-records";

describe("Page reference derived records", () => {
  test("classifies and aggregates Page mentions, links, and Reference Blocks", () => {
    const records = deriveBlockDocumentRecordsFromNfm(
      [
        { id: "paragraph-1", type: "paragraph", props: {}, children: [] },
        { id: "reference-1", type: "pageRef", props: {}, children: [] },
      ],
      [
        'See <mention-page url="nodex://pages/page-1" /> and ' +
          '<mention-page url="nodex://pages/page-1" /> or ' +
          "[the Page](nodex://pages/page-1)",
        '<page-ref url="nodex://pages/page-1" />',
      ].join("\n"),
    );

    expect(records.references).toEqual([
      {
        kind: "page",
        sourceBlockId: "paragraph-1",
        targetPageId: "page-1",
        presentation: "mention",
        occurrenceCount: 2,
      },
      {
        kind: "page",
        sourceBlockId: "paragraph-1",
        targetPageId: "page-1",
        presentation: "link",
        occurrenceCount: 1,
      },
      {
        kind: "page",
        sourceBlockId: "reference-1",
        targetPageId: "page-1",
        presentation: "reference_block",
        occurrenceCount: 1,
      },
    ]);
  });

  test("does not classify web links or owning Page shells as references", () => {
    const records = deriveBlockDocumentRecordsFromNfm(
      [
        { id: "paragraph-1", type: "paragraph", props: {}, children: [] },
        { id: "page-1", type: "page", props: {}, children: [] },
      ],
      '[docs](https://example.com)\n<page uuid="page-1" />',
    );

    expect(records.references).toEqual([]);
  });
});
