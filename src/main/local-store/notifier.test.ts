import { describe, expect, test, vi } from "vite-plus/test";

import type { DatabaseChangeEvent } from "../../shared/database-events";
import { parseDatabaseViewId } from "../../shared/database-identities";
import { DatabaseNotifier } from "./notifier";

const event = (overrides: Partial<DatabaseChangeEvent> = {}): DatabaseChangeEvent => ({
  version: 3,
  projectId: "project:test",
  libraryId: "library:test",
  storeEpoch: "epoch:test",
  operationId: "operation:test",
  sourceKind: "database_module",
  affectedDatabaseIds: [],
  affectedDataSourceIds: [],
  affectedPageIds: [],
  affectedViewIds: [],
  personalViewChanges: [],
  commitSeq: 4,
  ...overrides,
});

describe("DatabaseNotifier", () => {
  test("delivers personal View state without invalidating Library navigation", () => {
    const notifier = new DatabaseNotifier();
    const databaseListener = vi.fn();
    const libraryListener = vi.fn();
    notifier.on("database-changed", databaseListener);
    notifier.on("library-navigation-changed", libraryListener);
    const personalEvent = event({
      personalViewChanges: [
        {
          kind: "occurrence_disclosure",
          viewId: parseDatabaseViewId("view:test"),
          target: { kind: "page", occurrenceKey: "ITEM_parent/child" },
          collapsed: true,
        },
      ],
    });

    notifier.notifyDatabaseChanged(personalEvent);

    expect(databaseListener).toHaveBeenCalledWith(personalEvent);
    expect(libraryListener).not.toHaveBeenCalled();
  });

  test("continues to invalidate navigation for shared Data Source resources", () => {
    const notifier = new DatabaseNotifier();
    const libraryListener = vi.fn();
    notifier.on("library-navigation-changed", libraryListener);

    notifier.notifyDatabaseChanged(
      event({
        affectedDataSourceIds: ["source:test"],
      }),
    );

    expect(libraryListener).toHaveBeenCalledWith(
      expect.objectContaining({
        changeKind: "database",
      }),
    );
  });
});
