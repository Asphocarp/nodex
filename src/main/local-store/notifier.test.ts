import { describe, expect, test } from "vitest";
import type { PageOwnershipPathsChangedEvent } from "../../shared/page-ownership-path-events";
import { PAGE_TARGET_CHANGE_EVENT_VERSION } from "../../shared/page-target-events";
import type { LibraryNavigationChangedEvent } from "../../shared/library-events";
import { DatabaseNotifier } from "./notifier";

describe("Page ownership path invalidation", () => {
  test("publishes identity-free invalidation for structural Page changes only", () => {
    const events: PageOwnershipPathsChangedEvent[] = [];
    const navigationEvents: LibraryNavigationChangedEvent[] = [];
    const notifier = new DatabaseNotifier();
    const listener = (event: PageOwnershipPathsChangedEvent) => {
      events.push(event);
    };
    notifier.on("page-ownership-paths-changed", listener);
    notifier.on("library-navigation-changed", (event) => {
      navigationEvents.push(event as LibraryNavigationChangedEvent);
    });
    try {
      notifier.notifyPageTargetChanged({
        version: PAGE_TARGET_CHANGE_EVENT_VERSION,
        libraryId: "library-1",
        storeEpoch: "epoch-1",
        changeLogSeq: 1,
        targetPageId: "page-secret",
        changeKind: "content",
        affectedDatabaseIds: ["database-1"],
        affectedDataSourceIds: ["data-source-1"],
      });
      notifier.notifyPageTargetChanged({
        version: PAGE_TARGET_CHANGE_EVENT_VERSION,
        libraryId: "library-1",
        storeEpoch: "epoch-1",
        changeLogSeq: 2,
        targetPageId: "page-secret",
        changeKind: "location",
        affectedDatabaseIds: [],
        affectedDataSourceIds: [],
      });
      notifier.notifyPageTargetChanged({
        version: PAGE_TARGET_CHANGE_EVENT_VERSION,
        libraryId: "library-1",
        storeEpoch: "epoch-1",
        changeLogSeq: 3,
        targetPageId: "page-secret",
        changeKind: "lifecycle",
        affectedDatabaseIds: [],
        affectedDataSourceIds: [],
      });
    } finally {
      notifier.removeListener("page-ownership-paths-changed", listener);
    }

    expect(events).toEqual([
      { libraryId: "library-1", changeKind: "location" },
      { libraryId: "library-1", changeKind: "lifecycle" },
    ]);
    expect(navigationEvents[0]).toMatchObject({
      libraryId: "library-1",
      storeEpoch: "epoch-1",
      changeLogSeq: 1,
      changeKind: "content",
      affectedPageIds: ["page-secret"],
      affectedDatabaseIds: ["database-1"],
    });
  });
});
