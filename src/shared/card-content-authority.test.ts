import { describe, expect, test } from "vitest";

import {
  assertCardUpdateExcludesDocumentContent,
  findCardDocumentPatchFields,
} from "./card-content-authority";

describe("Card content authority boundary", () => {
  test("accepts relational metadata without classifying it as Document content", () => {
    const patch = {
      priority: "p1-high",
      tags: ["release"],
      dueDate: null,
    };

    assertCardUpdateExcludesDocumentContent(patch);

    expect(findCardDocumentPatchFields(patch).length).toBe(0);
  });

  test("rejects title and body snapshots before a compatibility Card update", () => {
    const fields = findCardDocumentPatchFields({
      title: "stale title",
      description: "stale body",
      priority: "p2-medium",
    });
    let message = "";

    try {
      assertCardUpdateExcludesDocumentContent({ description: "stale body" });
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }

    expect(JSON.stringify(fields)).toBe(JSON.stringify(["title", "description"]));
    expect(message.includes("Y.Doc Document mutation")).toBe(true);
    expect(message.includes("generation/head-CAS")).toBe(true);
  });
});
