import { describe, expect, test } from "vitest";
import {
  deduplicatePageReferenceCandidates,
  presentPageReferenceCandidates,
  resolvePageReferenceDisabledReason,
  selectPageReferenceCandidate,
} from "./candidate-model";
import type { PageReferenceCandidate } from "./types";

const candidate = (pageId: string): PageReferenceCandidate => ({
  pageId,
  title: pageId,
  pageKey: null,
  status: null,
  locationLabel: "Library",
  lifecycle: "active",
  matchExcerpt: null,
  matchSource: "recent",
  titleParts: [{ text: pageId, highlighted: false }],
  matchExcerptParts: [],
  matches: [],
  disabledReason: null,
});

describe("Page reference candidate model", () => {
  test("blocks recursive embeds without blocking mentions or links", () => {
    const context = {
      pageId: "host",
      hostPageId: "host",
      ancestorPageIds: ["ancestor"],
    } as const;
    expect(resolvePageReferenceDisabledReason({ ...context, intent: "reference_block" })).toBe(
      "self",
    );
    expect(
      resolvePageReferenceDisabledReason({
        ...context,
        pageId: "ancestor",
        intent: "reference_block",
      }),
    ).toBe("ancestor_cycle");
    expect(resolvePageReferenceDisabledReason({ ...context, intent: "mention" })).toBeNull();
  });

  test("uses Page identity for deduplication and selection", () => {
    expect(
      deduplicatePageReferenceCandidates(
        [candidate("one"), candidate("one"), candidate("two")],
        2,
      ).map((item) => item.pageId),
    ).toEqual(["one", "two"]);
    expect(selectPageReferenceCandidate(candidate("active"))).toEqual({
      pageId: "active",
      titleSnapshot: "active",
    });
  });

  test("preserves Core order and renders Core-provided evidence", () => {
    const items = presentPageReferenceCandidates([
      {
        ...candidate("body-first"),
        title: "Architecture",
        matchSource: "content",
        matchExcerpt: "The projection stays bounded.",
        matchExcerptParts: [
          { text: "The ", highlighted: false },
          { text: "projection", highlighted: true },
          { text: " stays bounded.", highlighted: false },
        ],
        matches: [
          {
            source: "body",
            quality: "exact",
            blockId: "block:one",
            blockType: "paragraph",
            parts: [
              { text: "The ", highlighted: false },
              { text: "projection", highlighted: true },
              { text: " stays bounded.", highlighted: false },
            ],
          },
        ],
      },
      {
        ...candidate("title-second"),
        title: "Projection notes",
        matchSource: "title",
        titleParts: [
          { text: "Projection", highlighted: true },
          { text: " notes", highlighted: false },
        ],
        matches: [
          {
            source: "title",
            quality: "prefix",
            parts: [
              { text: "Projection", highlighted: true },
              { text: " notes", highlighted: false },
            ],
          },
        ],
      },
    ]);

    expect(items.map((item) => item.candidate.pageId)).toEqual(["body-first", "title-second"]);
    expect(items[0]).toMatchObject({ match: "content", detail: "The projection stays bounded." });
    expect(items[1]).toMatchObject({ match: "prefix_title", detail: null });
    expect(items[1]?.titleSegments?.[0]).toEqual({ text: "Projection", highlight: true });
  });
});
