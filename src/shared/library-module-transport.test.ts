import { describe, expect, test } from "vitest";

import {
  bindLibraryModuleRead,
  parseLibraryModuleReadResult,
} from "./library-module-transport";

describe("Library Module transport", () => {
  test("binds bounded navigation requests without caller Library identity", () => {
    expect(
      bindLibraryModuleRead({
        version: 2,
        read: {
          mode: "children",
          parent: { kind: "page", pageId: "page-1" },
          limit: 50,
        },
      }),
    ).toEqual({
      version: 2,
      read: {
        mode: "children",
        parent: { kind: "page", pageId: "page-1" },
        limit: 50,
      },
    });
    expect(() =>
      bindLibraryModuleRead({
        version: 2,
        libraryId: "forged-library",
        read: { mode: "metadata" },
      }),
    ).toThrow("libraryId is not supported");
  });

  test("rejects unbounded and structurally ambiguous requests", () => {
    expect(() =>
      bindLibraryModuleRead({
        version: 2,
        read: {
          mode: "children",
          parent: { kind: "library" },
          limit: 101,
        },
      }),
    ).toThrow("between 1 and 100");
    expect(() =>
      bindLibraryModuleRead({
        version: 2,
        read: {
          mode: "catalog",
          kinds: ["page", "page"],
        },
      }),
    ).toThrow("unique kinds");
  });

  test("parses an authoritative children snapshot", () => {
    expect(
      parseLibraryModuleReadResult({
        ok: true,
        value: {
          version: 2,
          profileId: "profile-1",
          libraryId: "library-1",
          storeEpoch: "epoch-1",
          changeLogSeq: 3,
          value: {
            kind: "children",
            parent: { kind: "library" },
            items: [
              {
                kind: "database",
                databaseId: "database-1",
                title: "Tasks",
                defaultViewId: "view-1",
                hasMultipleViews: false,
                metadataRevision: 1,
                locationRevision: 1,
                updatedAt: "2026-07-18T00:00:00.000Z",
              },
            ],
            nextCursor: null,
            hasMore: false,
            total: 1,
          },
        },
      }),
    ).toMatchObject({
      ok: true,
      value: {
        profileId: "profile-1",
        value: { kind: "children", total: 1 },
      },
    });
  });
});
