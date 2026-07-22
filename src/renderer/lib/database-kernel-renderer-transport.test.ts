import { describe, expect, test } from "vitest";
import { browserRendererTransport } from "./browser-renderer-transport";
import { createElectronRendererTransport } from "./electron-renderer-transport";

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
    let ownershipPathEvents = 0;
    let projectionEvents = 0;
    let unsubscribeFirst = () => {};
    let unsubscribeSecond = () => {};
    let unsubscribeBoard = () => {};
    let unsubscribeSessions = () => {};
    let unsubscribeOwnershipPath = () => {};
    let unsubscribeProjection = () => {};
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
      unsubscribeOwnershipPath =
        browserRendererTransport.subscribePageOwnershipPathChanges(
          "project-1",
          () => {
            ownershipPathEvents += 1;
          },
        );
      unsubscribeProjection = browserRendererTransport.subscribeProjectionStream(
        {
          kind: "project",
          libraryId: "library-1",
          projectId: "project-1",
        },
        () => {
          projectionEvents += 1;
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
      expect(ownershipPathEvents).toBe(1);
      FakeEventSource.instances[0]?.onmessage?.({
        data: JSON.stringify({
          event: "projection-stream",
          message: {
            version: 1,
            kind: "checkpoint",
            scope: {
              kind: "project",
              libraryId: "library-1",
              projectId: "project-1",
            },
            cursor: { storeEpoch: "epoch-1", changeLogSeq: 4 },
          },
        }),
      } as MessageEvent<string>);
      expect(projectionEvents).toBe(1);

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
      unsubscribeOwnershipPath();
      unsubscribeProjection();
      unsubscribeSessions();
      expect(FakeEventSource.instances.every((source) => source.closed)).toBe(true);
    } finally {
      unsubscribeFirst();
      unsubscribeSecond();
      unsubscribeBoard();
      unsubscribeOwnershipPath();
      unsubscribeProjection();
      unsubscribeSessions();
      globalThis.EventSource = originalEventSource;
    }
  });

  test("delivers the same scoped projection message contract over browser SSE", () => {
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
    const messages: unknown[] = [];
    let release = () => {};
    try {
      release = browserRendererTransport.subscribeProjectionStream({
        kind: "project",
        libraryId: "library-1",
        projectId: "project-1",
      }, (message) => messages.push(message));
      const source = FakeEventSource.instances[0];
      expect(String(source?.url)).toContain("/api/projects/project-1/events");
      const message = {
        version: 1 as const,
        kind: "changed" as const,
        scope: {
          kind: "project" as const,
          libraryId: "library-1",
          projectId: "project-1",
        },
        cursor: { storeEpoch: "epoch-1", changeLogSeq: 7 },
        impact: {
          kind: "resources" as const,
          page_ids: ["page-1"],
          database_ids: [],
          data_source_ids: [],
          view_ids: [],
          document_heads: [],
        },
      };
      source?.onmessage?.({
        data: JSON.stringify({ event: "projection-stream", message }),
      } as MessageEvent<string>);
      source?.onmessage?.({
        data: JSON.stringify({
          event: "projection-stream",
          message: {
            ...message,
            scope: { ...message.scope, projectId: "project-2" },
          },
        }),
      } as MessageEvent<string>);

      expect(messages).toEqual([message]);
      release();
      expect(source?.closed).toBe(true);
    } finally {
      release();
      globalThis.EventSource = originalEventSource;
    }
  });

  test("subscribes and filters the equivalent scoped projection contract over Electron IPC", async () => {
    const projection = {
      listener: null as ((...args: unknown[]) => void) | null,
    };
    const invocations: Array<{ channel: string; args: unknown[] }> = [];
    const bridge = {
      invoke: async (channel: string, ...args: unknown[]) => {
        invocations.push({ channel, args });
      },
      on: (channel: string, listener: (...args: unknown[]) => void) => {
        if (channel === "projection-stream:message") projection.listener = listener;
        return () => {
          projection.listener = null;
        };
      },
    };
    const transport = createElectronRendererTransport(bridge as never);
    const scope = {
      kind: "project" as const,
      libraryId: "library-1",
      projectId: "project-1",
    };
    const messages: unknown[] = [];
    const release = transport.subscribeProjectionStream(
      scope,
      (message) => messages.push(message),
    );
    await Promise.resolve();
    const message = {
      version: 1 as const,
      kind: "checkpoint" as const,
      scope,
      cursor: { storeEpoch: "epoch-1", changeLogSeq: 7 },
    };
    projection.listener?.(message);
    projection.listener?.({
      ...message,
      scope: { ...scope, projectId: "project-2" },
    });
    release();
    await Promise.resolve();

    expect(messages).toEqual([message]);
    expect(invocations).toEqual([
      { channel: "projection-stream:subscribe", args: [scope] },
      { channel: "projection-stream:unsubscribe", args: [scope] },
    ]);
  });

});
