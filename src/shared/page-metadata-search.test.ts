import { describe, expect, test } from "vitest";
import { searchPageMetadata } from "./page-metadata-search";

const documents = [
  {
    id: "card-1",
    identity: "card-1",
    title: "Dynamic tool protocol",
    properties: [
      {
        propertyId: "priority",
        propertyName: "Priority",
        text: "High priority",
      },
    ],
  },
  {
    id: "card-2",
    identity: "card-2",
    title: "Unrelated notes",
    properties: [],
  },
];

describe("searchPageMetadata", () => {
  test("shares prefix and typo thresholds while retaining typed evidence", () => {
    const hits = searchPageMetadata(documents, "dynamc high");
    const hit = hits.find((candidate) => candidate.id === "card-1");

    expect(hit ? [...hit.matchedTerms].sort() : null).toEqual(["dynamc", "high"]);
    expect(hit?.evidence.some((item) => item.source === "title" && item.quality === "fuzzy")).toBe(
      true,
    );
    expect(
      hit?.evidence.some(
        (item) =>
          item.source === "property" && item.propertyId === "priority" && item.quality === "exact",
      ),
    ).toBe(true);
  });

  test("does not fuzzy match terms of three characters or fewer", () => {
    expect(searchPageMetadata(documents, "dun")).toEqual([]);
  });

  test("keeps stable identity matching exact or prefix only", () => {
    const [prefix] = searchPageMetadata(documents, "card-1");
    expect(prefix?.evidence[0]).toMatchObject({
      source: "identity",
      quality: "exact",
    });
    expect(searchPageMetadata(documents, "crd-1")).toEqual([]);
  });

  test("attributes fuzzy evidence to the property that actually matched", () => {
    const hits = searchPageMetadata(
      [
        {
          id: "card-3",
          identity: "card-3",
          title: "Release",
          properties: [
            { propertyId: "owner", propertyName: "Owner", text: "Ada" },
            { propertyId: "status", propertyName: "Status", text: "Completed" },
          ],
        },
      ],
      "completd",
    );

    expect(hits[0]?.evidence).toEqual([
      {
        term: "completd",
        source: "property",
        quality: "fuzzy",
        propertyId: "status",
        propertyName: "Status",
        excerpt: "Completed",
      },
    ]);
  });
});
