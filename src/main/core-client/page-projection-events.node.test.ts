import { describe, expect, test } from "vitest";

import type { CoreEventEnvelope } from "./types";
import { mapCorePageProjectionEvents } from "./page-projection-events";

const envelope = (
  payload: CoreEventEnvelope["event"]["payload"],
): CoreEventEnvelope => ({
  protocol_version: 1,
  event: {
    version: 1,
    sequence: 42,
    store_epoch: "epoch:test",
    operation_id: "projection:update",
    committed_at: "2026-07-22T00:00:00.000Z",
    payload,
  },
});

describe("Core Page projection event mapping", () => {
  test("maps a Page Document commit with exact authority coordinates", () => {
    expect(mapCorePageProjectionEvents(envelope({
      module: "owned_document",
      event: {
        kind: "document_updated",
        document_id: "document:page",
        generation: 2,
        head_seq: 7,
        update: [1, 2, 3],
        page_impact: {
          library_id: "library:test",
          page_id: "page:test",
          database: {
            database_id: "database:test",
            data_source_id: "data-source:test",
          },
        },
      },
    }), "library:test")).toEqual([{
      version: 1,
      libraryId: "library:test",
      storeEpoch: "epoch:test",
      changeLogSeq: 42,
      targetPageId: "page:test",
      changeKind: "content",
      affectedDatabaseIds: ["database:test"],
      affectedDataSourceIds: ["data-source:test"],
      document: { id: "document:page", generation: 2, headSeq: 7 },
    }]);
  });

  test("maps restore, Library, Database, and Automation Page effects", () => {
    const restored = mapCorePageProjectionEvents(envelope({
      module: "owned_document",
      event: {
        kind: "document_invalidated",
        document_id: "document:page",
        reason: "restored",
        page_impact: {
          library_id: "library:test",
          page_id: "page:test",
        },
      },
    }), "library:test");
    expect(restored[0]).toMatchObject({
      targetPageId: "page:test",
      affectedDatabaseIds: [],
      affectedDataSourceIds: [],
    });

    const cases: CoreEventEnvelope["event"]["payload"][] = [{
      module: "library",
      event: {
        kind: "library_changed",
        page_ids: ["page:library"],
        database_ids: ["database:library"],
        parent_keys: ["library"],
      },
    }, {
      module: "database",
      event: {
        kind: "database_changed",
        project_id: "project:test",
        page_ids: ["page:database"],
        database_ids: ["database:test"],
        data_source_ids: ["data-source:test"],
        view_ids: [],
      },
    }, {
      module: "automation",
      event: {
        kind: "automation_changed",
        automation_ids: [],
        database_ids: ["database:automation"],
        document_ids: [],
        lease_ids: [],
        page_ids: ["page:automation"],
        reminder_lease_ids: [],
        run_ids: [],
        snooze_ids: [],
      },
    }];
    expect(cases.map((payload) =>
      mapCorePageProjectionEvents(envelope(payload), "library:test")[0]
    )).toMatchObject([
      {
        targetPageId: "page:library",
        affectedDatabaseIds: ["database:library"],
      },
      {
        targetPageId: "page:database",
        affectedDataSourceIds: ["data-source:test"],
      },
      {
        targetPageId: "page:automation",
        affectedDatabaseIds: ["database:automation"],
      },
    ]);
  });

  test("ignores non-Page Document events", () => {
    expect(mapCorePageProjectionEvents(envelope({
      module: "owned_document",
      event: {
        kind: "document_updated",
        document_id: "document:synced-block",
        generation: 1,
        head_seq: 3,
        update: [4],
      },
    }), "library:test")).toEqual([]);
  });
});
