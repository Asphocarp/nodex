import { describe, expect, test } from "vitest";
import type { PageLifecycleMutationRequestV2 } from "../../shared/page-lifecycle-v2";
import { browserRendererTransport } from "./browser-renderer-transport";
import {
  createElectronRendererTransport,
  type ElectronRendererBridge,
} from "./electron-renderer-transport";

const request: PageLifecycleMutationRequestV2 = {
  version: 2,
  operationId: "page-lifecycle-transport",
  projectId: "project/one",
  storeEpoch: "epoch-1",
  actor: { kind: "renderer_test" },
  operation: {
    kind: "archive_page",
    pageId: "card/one",
    expectedMetadataRevision: 3,
  },
};

const preflightResult = {
  ok: false,
  error: {
    code: "page_not_found",
    message: "Page does not exist",
    retryable: false,
  },
} as const;

const mutationResult = {
  ok: true,
  value: {
    version: 2,
    operationId: request.operationId,
    projectId: request.projectId,
    storeEpoch: request.storeEpoch,
    operationKind: "archive_page",
    pageId: "card/one",
    duplicate: false,
    metadataRevision: 4,
    parentRevision: 2,
    lifecycle: "archived",
    documentId: "document-1",
    documentGeneration: 1,
    documentHeadSeq: 5,
    databaseId: "database-1",
    dataSourceId: "source-1",
    membershipId: "membership-1",
    viewId: "view-1",
    libraryRankKey: "7fffffffffffffffffffffffffffffff",
    viewRankKey: "7fffffffffffffffffffffffffffffff",
    createdBlockIds: [],
    createdTagOptionIds: [],
    changeLogSeq: 5,
    committedAt: "2026-07-11T00:00:00.000Z",
  },
} as const;

describe("Page lifecycle renderer transport", () => {
  test("keeps browser and Electron lifecycle command surfaces in parity", async () => {
    const originalFetch = globalThis.fetch;
    const urls: string[] = [];
    const bodies: unknown[] = [];
    const responses: unknown[] = [preflightResult, mutationResult];
    globalThis.fetch = (async (input, init) => {
      urls.push(String(input));
      if (init?.body) bodies.push(JSON.parse(String(init.body)) as unknown);
      return new Response(JSON.stringify(responses.shift()), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }) as typeof fetch;

    try {
      const preflight = await browserRendererTransport.readPageLifecyclePreflight(
        request.projectId,
        "card/one",
      );
      const mutation = await browserRendererTransport.mutatePageLifecycle(
        request.projectId,
        request,
      );
      expect(preflight.ok).toBe(false);
      expect(mutation.ok).toBe(true);
      expect(
        urls[0]?.endsWith(
          "/api/projects/project%2Fone/page-lifecycle-preflight?pageId=card%2Fone",
        ) ?? false,
      ).toBe(true);
      expect(
        urls[1]?.endsWith(
          "/api/projects/project%2Fone/page-lifecycle-mutations",
        ) ?? false,
      ).toBe(true);
      expect(
        (bodies[0] as { readonly operationId?: string }).operationId,
      ).toBe(request.operationId);
    } finally {
      globalThis.fetch = originalFetch;
    }

    const calls: Array<{ readonly channel: string; readonly args: unknown[] }> = [];
    const bridge = {
      invoke: async (channel: string, ...args: unknown[]) => {
        calls.push({ channel, args });
        return channel === "pages:lifecycle:preflight"
          ? preflightResult
          : mutationResult;
      },
    } as unknown as ElectronRendererBridge;
    const electron = createElectronRendererTransport(bridge);
    await electron.readPageLifecyclePreflight(request.projectId, "card/one");
    await electron.mutatePageLifecycle(request.projectId, request);
    expect(calls[0]?.channel).toBe("pages:lifecycle:preflight");
    expect(calls[1]?.channel).toBe("pages:lifecycle:apply");
    expect(calls[1]?.args[1] === request).toBe(true);
  });

  test("fans a lifecycle change to every window subscribed to the Project", () => {
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
    let firstWindow = 0;
    let secondWindow = 0;
    let unsubscribeFirst: () => void = () => undefined;
    let unsubscribeSecond: () => void = () => undefined;
    try {
      unsubscribeFirst = browserRendererTransport.subscribeDatabaseChanges(
        "project-1",
        () => {
          firstWindow += 1;
        },
      );
      unsubscribeSecond = browserRendererTransport.subscribeDatabaseChanges(
        "project-1",
        () => {
          secondWindow += 1;
        },
      );
      expect(FakeEventSource.instances.length).toBe(1);
      FakeEventSource.instances[0]?.onmessage?.({
        data: JSON.stringify({
          event: "database-changed",
          version: 2,
          projectId: "project-1",
          storeEpoch: "epoch-1",
          operationId: "lifecycle-1",
          sourceKind: "page_lifecycle",
          affectedDatabaseIds: ["database-1"],
          changeLogSeq: 9,
        }),
      } as MessageEvent<string>);
      expect(firstWindow).toBe(1);
      expect(secondWindow).toBe(1);
    } finally {
      unsubscribeFirst();
      unsubscribeSecond();
      globalThis.EventSource = originalEventSource;
    }
  });
});
