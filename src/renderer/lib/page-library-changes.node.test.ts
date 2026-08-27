import { describe, expect, test } from "vitest";

import { pageFileManifestRevisionFromLibraryEvent } from "./page-library-changes";

describe("Page File Library subscriptions", () => {
  test("ignores ordinary Page changes and exposes only exact manifest revisions", () => {
    expect(
      pageFileManifestRevisionFromLibraryEvent(
        {
          page_file_manifest_revisions: {},
        },
        "page-1",
      ),
    ).toBeNull();

    expect(
      pageFileManifestRevisionFromLibraryEvent(
        {
          page_file_manifest_revisions: { "page-1": 7, "page-2": 3 },
        },
        "page-1",
      ),
    ).toBe(7);
  });
});
