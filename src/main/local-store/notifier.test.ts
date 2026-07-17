import { describe, expect, test } from "vitest";
import type { PageOwnershipPathsChangedEvent } from "../../shared/page-ownership-path-events";
import { DatabaseNotifier } from "./notifier";

describe("Page ownership path invalidation", () => {
  test("publishes identity-free invalidation for structural Page changes only", () => {
    const events: PageOwnershipPathsChangedEvent[] = [];
    const notifier = new DatabaseNotifier();
    const listener = (event: PageOwnershipPathsChangedEvent) => {
      events.push(event);
    };
    notifier.on("page-ownership-paths-changed", listener);
    try {
      notifier.notifyPageTargetChanged({
        libraryId: "library-1",
        targetPageId: "page-secret",
        changeKind: "content",
      });
      notifier.notifyPageTargetChanged({
        libraryId: "library-1",
        targetPageId: "page-secret",
        changeKind: "location",
      });
      notifier.notifyPageTargetChanged({
        libraryId: "library-1",
        targetPageId: "page-secret",
        changeKind: "lifecycle",
      });
    } finally {
      notifier.removeListener("page-ownership-paths-changed", listener);
    }

    expect(events).toEqual([
      { libraryId: "library-1", changeKind: "location" },
      { libraryId: "library-1", changeKind: "lifecycle" },
    ]);
  });
});
