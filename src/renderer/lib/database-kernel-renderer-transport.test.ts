import { describe, expect, test } from "vitest";
import { browserRendererTransport } from "./browser-renderer-transport";

describe("Database event renderer transport", () => {
  test("keeps global Session invalidations separate from multiplexed Project events", () => {
    const originalEventSource = globalThis.EventSource;
    class FakeEventSource {
      static readonly instances: FakeEventSource[] = [];
      onmessage: ((event: MessageEvent<string>) => void) | null = null;
      closed = false;

      constructor(readonly url: string | URL) {
        FakeEventSource.instances.push(this);
      }

      close(): void {
        this.closed = true;
      }
    }
    globalThis.EventSource = FakeEventSource as unknown as typeof EventSource;
    let firstWindowEvents = 0;
    let secondWindowEvents = 0;
    let boardEvents = 0;
    let sessionEvents = 0;
    let pageTargetEvents = 0;
    let authorityResyncEvents = 0;
    let ownershipPathEvents = 0;
    let unsubscribeFirst = () => {};
    let unsubscribeSecond = () => {};
    let unsubscribeBoard = () => {};
    let unsubscribeSessions = () => {};
    let unsubscribePageTarget = () => {};
    let unsubscribeAuthorityResync = () => {};
    let unsubscribeOwnershipPath = () => {};
    try {
      unsubscribeFirst =
        browserRendererTransport.subscribeDatabaseChanges(
          "project-1",
          () => {
            firstWindowEvents += 1;
          },
        );
      unsubscribeSecond =
        browserRendererTransport.subscribeDatabaseChanges(
          "project-1",
          () => {
            secondWindowEvents += 1;
          },
        );
      unsubscribeBoard = browserRendererTransport.subscribeBoardChanges(
        "project-1",
        () => {
          boardEvents += 1;
        },
      );
      unsubscribePageTarget =
        browserRendererTransport.subscribePageTargetChanges(
          "project-1",
          () => {
            pageTargetEvents += 1;
          },
        );
      unsubscribeAuthorityResync =
        browserRendererTransport.subscribeAuthorityResync(
          "project-1",
          () => {
            authorityResyncEvents += 1;
          },
        );
      unsubscribeOwnershipPath =
        browserRendererTransport.subscribePageOwnershipPathChanges(
          "project-1",
          () => {
            ownershipPathEvents += 1;
          },
        );
      unsubscribeSessions =
        browserRendererTransport.subscribeProjectSessionChanges(
          () => {
            sessionEvents += 1;
          },
        );
      expect(FakeEventSource.instances.length).toBe(2);
      FakeEventSource.instances[0]?.onmessage?.({
        data: JSON.stringify({ event: "connected" }),
      } as MessageEvent<string>);
      expect(authorityResyncEvents).toBe(1);
      const sessionSource = FakeEventSource.instances.find((source) =>
        String(source.url).includes("/api/project-sessions/events")
      );
      sessionSource?.onmessage?.({
        data: JSON.stringify({ event: "connected" }),
      } as MessageEvent<string>);
      expect(sessionEvents).toBe(1);
      const payload = JSON.stringify({
        event: "database-changed",
        version: 2,
        projectId: "project-1",
        storeEpoch: "epoch-1",
        operationId: "operation-1",
        sourceKind: "database_module",
        affectedDatabaseIds: ["database-1"],
        changeLogSeq: 4,
      });
      for (const source of FakeEventSource.instances) {
        source.onmessage?.({ data: payload } as MessageEvent<string>);
      }
      expect(firstWindowEvents).toBe(1);
      expect(secondWindowEvents).toBe(1);
      expect(boardEvents).toBe(0);
      expect(sessionEvents).toBe(1);
      expect(pageTargetEvents).toBe(0);
      expect(ownershipPathEvents).toBe(0);

      FakeEventSource.instances[0]?.onmessage?.({
        data: JSON.stringify({
          event: "board-changed",
          projectId: "project-1",
          changeType: "update",
          columnId: "ship",
          status: "ship",
          pageId: "card-1",
        }),
      } as MessageEvent<string>);
      FakeEventSource.instances[0]?.onmessage?.({
        data: JSON.stringify({
          event: "page-target-changed",
          version: 1,
          libraryId: "library-1",
          storeEpoch: "epoch-1",
          changeLogSeq: 1,
          targetPageId: "card-1",
          changeKind: "content",
          affectedDatabaseIds: ["database-1"],
          affectedDataSourceIds: ["source-1"],
        }),
      } as MessageEvent<string>);
      FakeEventSource.instances[0]?.onmessage?.({
        data: JSON.stringify({
          event: "page-ownership-paths-changed",
          changeKind: "location",
        }),
      } as MessageEvent<string>);
      sessionSource?.onmessage?.({
        data: JSON.stringify({
          event: "project-sessions-changed",
          summaryScopes: [{ kind: "projectless" }],
          detailInvalidation: {
            kind: "sessions",
            sessionIds: ["session-1"],
          },
          changeType: "update",
        }),
      } as MessageEvent<string>);
      expect(boardEvents).toBe(1);
      expect(sessionEvents).toBe(2);
      expect(pageTargetEvents).toBe(1);
      expect(ownershipPathEvents).toBe(1);

      const wrongProject = JSON.stringify({
        ...JSON.parse(payload),
        projectId: "project-2",
      });
      for (const source of FakeEventSource.instances) {
        source.onmessage?.({ data: wrongProject } as MessageEvent<string>);
      }
      expect(firstWindowEvents).toBe(1);
      expect(secondWindowEvents).toBe(1);
      unsubscribeFirst();
      unsubscribeSecond();
      expect(FakeEventSource.instances[0]?.closed).toBe(false);
      unsubscribeBoard();
      unsubscribePageTarget();
      unsubscribeAuthorityResync();
      unsubscribeOwnershipPath();
      unsubscribeSessions();
      expect(FakeEventSource.instances.every((source) => source.closed)).toBe(true);
    } finally {
      unsubscribeFirst();
      unsubscribeSecond();
      unsubscribeBoard();
      unsubscribePageTarget();
      unsubscribeAuthorityResync();
      unsubscribeOwnershipPath();
      unsubscribeSessions();
      globalThis.EventSource = originalEventSource;
    }
  });

});
