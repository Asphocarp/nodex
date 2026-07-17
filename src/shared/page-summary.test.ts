import { describe, expect, test } from "vitest";

import { pageInputToSummaryPatch, toDatabasePageSummary } from "./page-summary";

describe("Card summary rich-title projection", () => {
  test("preserves canonical rich title content while deriving body summary fields", () => {
    const richTitle = [
      { type: "text" as const, text: "Rich ", styles: {} },
      { type: "text" as const, text: "title", styles: { bold: true as const } },
    ];

    expect(toDatabasePageSummary({
      id: "card-1",
      status: "triage",
      archived: false,
      title: "Rich title",
      richTitle,
      description: "Body",
      tags: [],
      created: new Date("2026-01-01T00:00:00.000Z"),
      order: 0,
    })).toMatchObject({
      title: "Rich title",
      richTitle,
      descriptionPreview: "Body",
      descriptionLength: 4,
      hasDescription: true,
    });
  });

  test("turns an explicit plain-title mutation into one coherent rich-title projection", () => {
    expect(pageInputToSummaryPatch({ title: "Renamed" })).toEqual({
      title: "Renamed",
      richTitle: [{ type: "text", text: "Renamed", styles: {} }],
    });
  });
});
