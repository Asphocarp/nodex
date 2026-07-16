import { describe, expect, test } from "vitest";

import {
  assertPageUpdateExcludesDocumentContent,
  findPageDocumentPatchFields,
} from "./page-content-authority";

describe("Page content authority boundary", () => {
  test("accepts relational metadata without classifying it as Document content", () => {
    const patch = {
      priority: "p1-high",
      tags: ["release"],
      dueDate: null,
    };

    assertPageUpdateExcludesDocumentContent(patch);

    expect(findPageDocumentPatchFields(patch).length).toBe(0);
  });

  test("rejects title and body snapshots before a compatibility Page update", () => {
    const fields = findPageDocumentPatchFields({
      title: "stale title",
      description: "stale body",
      priority: "p2-medium",
    });
    let message = "";

    try {
      assertPageUpdateExcludesDocumentContent({ description: "stale body" });
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }

    expect(JSON.stringify(fields)).toBe(JSON.stringify(["title", "description"]));
    expect(message.includes("Y.Doc Document mutation")).toBe(true);
    expect(message.includes("generation/head-CAS")).toBe(true);
  });
});
