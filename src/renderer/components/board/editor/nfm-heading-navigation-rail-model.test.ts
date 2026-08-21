import { describe, expect, test } from "vite-plus/test";
import {
  collectNfmHeadingNavigationItems,
  isNfmHeadingNavigationEligible,
} from "./nfm-heading-navigation-rail-model";

describe("NFM heading navigation rail model", () => {
  test("collects nested heading blocks with normalized levels and fallback labels", () => {
    const headings = collectNfmHeadingNavigationItems([
      {
        id: "a",
        type: "heading",
        props: { level: 1 },
        content: [{ text: "Intro" }],
        children: [
          {
            id: "b",
            type: "heading",
            props: { level: 3 },
            content: [{ text: "Nested" }],
          },
        ],
      },
      {
        id: "c",
        type: "heading",
        props: { level: 9 },
        content: [],
      },
    ]);

    expect(
      JSON.stringify(
        headings.map(
          (heading) =>
            `${heading.id}:${heading.ordinal}:${heading.level}:${heading.depth}:${heading.label}`,
        ),
      ),
    ).toBe(JSON.stringify(["a:1:1:0:Intro", "b:2:3:2:Nested", "c:3:4:3:Untitled"]));
  });

  test("uses rail eligibility gates", () => {
    expect(
      isNfmHeadingNavigationEligible({
        itemCount: 3,
        isActivePanelTab: true,
        isRawContent: false,
        isCoarsePointer: false,
      }),
    ).toBe(false);

    expect(
      isNfmHeadingNavigationEligible({
        itemCount: 4,
        isActivePanelTab: true,
        isRawContent: false,
        isCoarsePointer: false,
      }),
    ).toBe(true);

    expect(
      isNfmHeadingNavigationEligible({
        itemCount: 8,
        isActivePanelTab: false,
        isRawContent: false,
        isCoarsePointer: false,
      }),
    ).toBe(false);

    expect(
      isNfmHeadingNavigationEligible({
        itemCount: 8,
        isActivePanelTab: true,
        isRawContent: true,
        isCoarsePointer: false,
      }),
    ).toBe(false);

    expect(
      isNfmHeadingNavigationEligible({
        itemCount: 8,
        isActivePanelTab: true,
        isRawContent: false,
        isCoarsePointer: true,
      }),
    ).toBe(false);
  });
});
