import { describe, expect, test } from "vitest";

import { browserRendererTransport } from "./browser-renderer-transport";

describe("Library Module renderer transport", () => {
  test("multiplexes one Library event stream and closes it after the last subscriber", () => {
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
    let first = 0;
    let second = 0;
    const subscribe = browserRendererTransport.subscribeLibraryChanges;
    if (!subscribe) throw new Error("Library events are unavailable");
    const unsubscribeFirst = subscribe(() => { first += 1; });
    const unsubscribeSecond = subscribe(() => { second += 1; });
    try {
      expect(FakeEventSource.instances).toHaveLength(1);
      expect(String(FakeEventSource.instances[0]?.url)).toContain(
        "/api/library-module/events",
      );
      FakeEventSource.instances[0]?.onmessage?.({
        data: JSON.stringify({
          event: "library-navigation-changed",
          version: 1,
          libraryId: "library-1",
          storeEpoch: null,
          changeLogSeq: null,
          changeKind: "content",
          affectedParentKeys: ["catalog"],
          affectedPageIds: ["page-1"],
          affectedDatabaseIds: [],
          affectedViewIds: [],
        }),
      } as MessageEvent<string>);
      expect(first).toBe(1);
      expect(second).toBe(1);
      unsubscribeFirst();
      expect(FakeEventSource.instances[0]?.closed).toBe(false);
      unsubscribeSecond();
      expect(FakeEventSource.instances[0]?.closed).toBe(true);
    } finally {
      unsubscribeFirst();
      unsubscribeSecond();
      globalThis.EventSource = originalEventSource;
    }
  });
});
