import { describe, expect, test } from "vitest";
import type { DatabaseMutationRequest } from "../../shared/database-kernel";
import { browserRendererTransport } from "./browser-renderer-transport";

const request: DatabaseMutationRequest = {
  version: 1,
  operationId: "renderer-database-operation",
  projectId: "project/one",
  storeEpoch: "epoch-1",
  clientSessionId: "renderer-session",
  actor: { kind: "renderer_test" },
  operations: [
    {
      kind: "position_card",
      viewId: "view/one",
      cardBlockId: "card/one",
      expectedPositionRevision: 1,
      groupKey: null,
    },
  ],
};

describe("Database renderer transport", () => {
  test("multiplexes one Project SSE across Board, Database, sessions, and two windows", () => {
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
    let unsubscribeFirst = () => {};
    let unsubscribeSecond = () => {};
    let unsubscribeBoard = () => {};
    let unsubscribeSessions = () => {};
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
      unsubscribeSessions =
        browserRendererTransport.subscribeProjectSessionChanges(
          "project-1",
          () => {
            sessionEvents += 1;
          },
        );
      expect(FakeEventSource.instances.length).toBe(1);
      const payload = JSON.stringify({
        event: "database-changed",
        version: 1,
        projectId: "project-1",
        storeEpoch: "epoch-1",
        operationId: "operation-1",
        sourceKind: "database_mutation",
        affectedDatabaseBlockIds: ["database-1"],
        changeLogSeq: 4,
      });
      for (const source of FakeEventSource.instances) {
        source.onmessage?.({ data: payload } as MessageEvent<string>);
      }
      expect(firstWindowEvents).toBe(1);
      expect(secondWindowEvents).toBe(1);
      expect(boardEvents).toBe(0);
      expect(sessionEvents).toBe(0);

      FakeEventSource.instances[0]?.onmessage?.({
        data: JSON.stringify({
          event: "board-changed",
          projectId: "project-1",
          changeType: "update",
          columnId: "done",
          status: "done",
          cardId: "card-1",
        }),
      } as MessageEvent<string>);
      FakeEventSource.instances[0]?.onmessage?.({
        data: JSON.stringify({ event: "project-sessions-changed" }),
      } as MessageEvent<string>);
      expect(boardEvents).toBe(1);
      expect(sessionEvents).toBe(1);

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
      unsubscribeSessions();
      expect(FakeEventSource.instances.every((source) => source.closed)).toBe(true);
    } finally {
      unsubscribeFirst();
      unsubscribeSecond();
      unsubscribeBoard();
      unsubscribeSessions();
      globalThis.EventSource = originalEventSource;
    }
  });

  test("maps typed mutation and read commands to encoded browser routes", async () => {
    const originalFetch = globalThis.fetch;
    const urls: string[] = [];
    const bodies: unknown[] = [];
    const responses = [
      {
        ok: true,
        value: {
          version: 1,
          operationId: request.operationId,
          projectId: request.projectId,
          storeEpoch: request.storeEpoch,
          operationKinds: ["position_card"],
          affectedDatabaseBlockIds: ["database-1"],
          duplicate: false,
          payload: { operationResults: [] },
          changeLogSeq: 4,
          committedAt: "2026-07-11T00:00:00.000Z",
        },
      },
      {
        ok: true,
        value: {
          version: 1,
          projectId: request.projectId,
          storeEpoch: request.storeEpoch,
          changeLogSeq: 4,
          value: null,
        },
      },
      {
        ok: true,
        value: {
          version: 1,
          projectId: request.projectId,
          storeEpoch: request.storeEpoch,
          changeLogSeq: 4,
          value: null,
        },
      },
      {
        ok: true,
        value: {
          version: 1,
          projectId: request.projectId,
          storeEpoch: request.storeEpoch,
          changeLogSeq: 4,
          value: { catalog: { databases: [] }, cards: [] },
        },
      },
      {
        ok: true,
        value: {
          descriptor: {
            version: 1,
            projectId: request.projectId,
            storeEpoch: request.storeEpoch,
            changeLogSeq: 4,
            value: null,
          },
          query: {
            version: 1,
            projectId: request.projectId,
            storeEpoch: request.storeEpoch,
            changeLogSeq: 4,
            value: null,
          },
        },
      },
      {
        ok: true,
        value: {
          descriptor: {
            version: 1,
            projectId: request.projectId,
            storeEpoch: request.storeEpoch,
            changeLogSeq: 4,
            value: null,
          },
          query: {
            version: 1,
            projectId: request.projectId,
            storeEpoch: request.storeEpoch,
            changeLogSeq: 4,
            value: null,
          },
        },
      },
      {
        ok: true,
        value: {
          version: 1,
          projectId: request.projectId,
          storeEpoch: request.storeEpoch,
          changeLogSeq: 4,
          value: null,
        },
      },
    ];
    globalThis.fetch = (async (input, init) => {
      urls.push(String(input));
      if (init?.body) bodies.push(JSON.parse(String(init.body)) as unknown);
      const response = responses.shift();
      if (!response) throw new Error("Unexpected Database renderer request");
      return new Response(JSON.stringify(response), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }) as typeof fetch;

    try {
      const mutation = (await browserRendererTransport.invoke(
        "databases:mutate",
        request.projectId,
        request,
      )) as { readonly ok: boolean };
      expect(mutation.ok).toBe(true);
      const descriptor = (await browserRendererTransport.invoke(
        "databases:descriptor:get",
        request.projectId,
        "database/one",
      )) as { readonly ok: boolean };
      expect(descriptor.ok).toBe(true);
      const primary = (await browserRendererTransport.invoke(
        "databases:primary:get",
        request.projectId,
      )) as { readonly ok: boolean };
      expect(primary.ok).toBe(true);
      const management = (await browserRendererTransport.invoke(
        "databases:management:get",
        request.projectId,
      )) as { readonly ok: boolean };
      expect(management.ok).toBe(true);
      const primaryViewSnapshot = (await browserRendererTransport.invoke(
        "database-views:primary:snapshot",
        request.projectId,
      )) as { readonly ok: boolean };
      expect(primaryViewSnapshot.ok).toBe(true);
      const selectedViewSnapshot = (await browserRendererTransport.invoke(
        "database-views:snapshot",
        request.projectId,
        "view/one",
      )) as { readonly ok: boolean };
      expect(selectedViewSnapshot.ok).toBe(true);
      const query = (await browserRendererTransport.invoke(
        "database-views:query",
        request.projectId,
        "view/one",
      )) as { readonly ok: boolean };
      expect(query.ok).toBe(true);
      expect((bodies[0] as { readonly operationId?: string }).operationId).toBe(
        "renderer-database-operation",
      );
      expect(
        urls[0]?.endsWith("/api/projects/project%2Fone/database-mutations"),
      ).toBe(true);
      expect(
        urls[1]?.endsWith(
          "/api/projects/project%2Fone/databases/database%2Fone",
        ),
      ).toBe(true);
      expect(
        urls[2]?.endsWith("/api/projects/project%2Fone/databases/primary"),
      ).toBe(true);
      expect(
        urls[3]?.endsWith(
          "/api/projects/project%2Fone/databases/management",
        ),
      ).toBe(true);
      expect(
        urls[4]?.endsWith(
          "/api/projects/project%2Fone/database-views/primary/snapshot",
        ),
      ).toBe(true);
      expect(
        urls[5]?.endsWith(
          "/api/projects/project%2Fone/database-views/view%2Fone/snapshot",
        ),
      ).toBe(true);
      expect(
        urls[6]?.endsWith(
          "/api/projects/project%2Fone/database-views/view%2Fone/query",
        ),
      ).toBe(true);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
