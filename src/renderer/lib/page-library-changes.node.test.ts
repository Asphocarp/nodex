import { describe, expect, test } from "vitest";

import {
  pageFileBodyUsageRevisionFromLibraryEvent,
  pageFileManifestRevisionFromLibraryEvent,
} from "./page-library-changes";

describe("Page File Library subscriptions", () => {
  test("ignores ordinary Page changes and exposes only exact manifest revisions", () => {
    expect(
      pageFileManifestRevisionFromLibraryEvent(
        {
          page_file_manifest_revisions: {},
          page_file_body_usage_revisions: {},
        },
        "page-1",
      ),
    ).toBeNull();

    expect(
      pageFileManifestRevisionFromLibraryEvent(
        {
          page_file_manifest_revisions: { "page-1": 7, "page-2": 3 },
          page_file_body_usage_revisions: {},
        },
        "page-1",
      ),
    ).toBe(7);
  });

  test("projects only a valid exact Page File body usage revision", () => {
    const event = {
      page_file_manifest_revisions: {},
      page_file_body_usage_revisions: {
        "page-1": 9,
      },
    };

    expect(pageFileBodyUsageRevisionFromLibraryEvent(event, "page-1")).toBe(9);
    expect(pageFileBodyUsageRevisionFromLibraryEvent(event, "page-2")).toBeNull();
    expect(
      pageFileBodyUsageRevisionFromLibraryEvent(
        {
          page_file_manifest_revisions: {},
          page_file_body_usage_revisions: {
            "page-1": -1,
          },
        },
        "page-1",
      ),
    ).toBeNull();
  });
});
