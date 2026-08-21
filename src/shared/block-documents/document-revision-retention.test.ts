import { describe, expect, test } from "vitest";
import {
  MAX_UNPINNED_DOCUMENT_REVISIONS,
  planDocumentRevisionRetention,
} from "./document-revision-retention";

const NOW = "2026-07-16T12:00:00.000Z";
const ago = (milliseconds: number): string =>
  new Date(Date.parse(NOW) - milliseconds).toISOString();
const day = 24 * 60 * 60_000;

describe("Document revision retention", () => {
  test("keeps recent and pinned revisions while selecting hourly and daily representatives", () => {
    const plan = planDocumentRevisionRetention(
      [
        { versionId: "recent-a", createdAt: ago(day), pinned: false },
        { versionId: "recent-b", createdAt: ago(6 * day), pinned: false },
        {
          versionId: "hour-new",
          createdAt: ago(8 * day + 60_000),
          pinned: false,
        },
        {
          versionId: "hour-old",
          createdAt: new Date(Date.parse(ago(8 * day + 60_000)) - 1_000).toISOString(),
          pinned: false,
        },
        { versionId: "day-new", createdAt: ago(31 * day), pinned: false },
        {
          versionId: "day-old",
          createdAt: new Date(Date.parse(ago(31 * day)) - 60_000).toISOString(),
          pinned: false,
        },
        { versionId: "expired", createdAt: ago(91 * day), pinned: false },
        { versionId: "pinned", createdAt: ago(500 * day), pinned: true },
      ],
      NOW,
    );
    expect(plan.retainedVersionIds).toEqual([
      "recent-a",
      "recent-b",
      "hour-new",
      "day-new",
      "pinned",
    ]);
    expect(plan.deletedVersionIds).toEqual(["hour-old", "day-old", "expired"]);
  });

  test("caps only unpinned survivors", () => {
    const candidates = Array.from({ length: MAX_UNPINNED_DOCUMENT_REVISIONS + 20 }, (_, index) => ({
      versionId: `auto-${index.toString().padStart(3, "0")}`,
      createdAt: new Date(Date.parse(NOW) - index * 1_000).toISOString(),
      pinned: false,
    }));
    candidates.push({
      versionId: "named",
      createdAt: ago(1_000 * day),
      pinned: true,
    });
    const plan = planDocumentRevisionRetention(candidates, NOW);
    expect(plan.retainedVersionIds).toHaveLength(MAX_UNPINNED_DOCUMENT_REVISIONS + 1);
    expect(plan.retainedVersionIds).toContain("named");
    expect(plan.deletedVersionIds).toHaveLength(20);
  });
});
