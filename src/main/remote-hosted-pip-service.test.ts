import { describe, expect, test } from "vitest";
import type {
  BrowserSidebarBrowserUseStateSnapshot,
  BrowserUseTabState,
} from "../shared/browser-sidebar";
import { RemoteHostedPipService, type RemoteHostedPipWebContentsLike } from "./remote-hosted-pip-service";

interface CapturedMessage {
  channel: string;
  payload: unknown;
  senderId?: number;
}

class FakeSender implements RemoteHostedPipWebContentsLike {
  private readonly destroyedListeners: Array<() => void> = [];

  constructor(readonly id: number) {}

  once(eventName: "destroyed", listener: () => void): void {
    if (eventName !== "destroyed") return;
    this.destroyedListeners.push(listener);
  }

  destroy(): void {
    for (const listener of this.destroyedListeners) {
      listener();
    }
  }
}

function createHarness() {
  const broadcasts: CapturedMessage[] = [];
  const sentMessages: CapturedMessage[] = [];
  const sessionThreads = new Map([
    ["session-1", "thread-1"],
    ["session-2", "thread-2"],
  ]);
  const service = new RemoteHostedPipService({
    broadcast: (channel, payload) => {
      broadcasts.push({ channel, payload });
    },
    resolveThreadIdForSession: (sessionId) => sessionThreads.get(sessionId) ?? null,
    sendToSender: (sender, channel, payload) => {
      sentMessages.push({ channel, payload, senderId: sender.id });
    },
  });

  return {
    broadcasts,
    sentMessages,
    service,
    sessionThreads,
  };
}

function createBrowserUseTab(overrides: Partial<BrowserUseTabState> = {}): BrowserUseTabState {
  return {
    browserConversationId: "session-1",
    browserTabId: "tab-1",
    captureActive: true,
    projectId: "project-1",
    released: false,
    title: "Example",
    updatedAt: 1,
    url: "https://example.com",
    viewport: {
      height: 768,
      presetId: "responsive",
      width: 1024,
      zoomPercent: 100,
    },
    webContentsId: 101,
    ...overrides,
  };
}

function createBrowserUseSnapshot(
  tabs: BrowserUseTabState[],
): BrowserSidebarBrowserUseStateSnapshot {
  return {
    activeBrowserTabIdsByConversation: Object.fromEntries(
      tabs.map((tab) => [tab.browserConversationId, tab.browserTabId]),
    ),
    cursors: [],
    tabs,
  };
}

describe("RemoteHostedPipService", () => {
  test("derives stream state from active BrowserUse capture tabs", () => {
    const { broadcasts, sentMessages, service } = createHarness();
    const sender = new FakeSender(7);

    service.handleDesktopMessageFromView(sender, {
      type: "remote-hosted-pip-active-thread-changed",
      conversationId: "thread-1",
    });

    expect(JSON.stringify(sentMessages)).toBe(JSON.stringify([
      {
        channel: "remote-hosted-pip-visibility-requested",
        payload: {
          type: "remote-hosted-pip-visibility-requested",
          isVisible: true,
        },
        senderId: 7,
      },
      {
        channel: "remote-hosted-pip-stream-state-changed",
        payload: {
          type: "remote-hosted-pip-stream-state-changed",
          conversationId: "thread-1",
          isActive: false,
          isAnyActive: false,
        },
        senderId: 7,
      },
    ]));

    service.handleBrowserUseStateSnapshot(createBrowserUseSnapshot([
      createBrowserUseTab(),
    ]));

    expect(JSON.stringify(service.getBrowserUsePipConversationIds())).toBe(JSON.stringify(["thread-1"]));
    expect(JSON.stringify(broadcasts)).toBe(JSON.stringify([
      {
        channel: "remote-hosted-pip-stream-state-changed",
        payload: {
          type: "remote-hosted-pip-stream-state-changed",
          conversationId: "thread-1",
          isActive: true,
          isAnyActive: true,
        },
      },
    ]));

    service.handleBrowserUseStateSnapshot(createBrowserUseSnapshot([
      createBrowserUseTab({ title: "Same stream, new metadata" }),
    ]));
    expect(broadcasts.length).toBe(1);

    service.handleBrowserUseStateSnapshot(createBrowserUseSnapshot([
      createBrowserUseTab({ released: true }),
    ]));

    expect(JSON.stringify(service.getBrowserUsePipConversationIds())).toBe(JSON.stringify([]));
    expect(JSON.stringify(broadcasts[1])).toBe(JSON.stringify({
      channel: "remote-hosted-pip-stream-state-changed",
      payload: {
        type: "remote-hosted-pip-stream-state-changed",
        conversationId: "thread-1",
        isActive: false,
        isAnyActive: false,
      },
    }));
  });

  test("ignores BrowserUse tabs that cannot back a real PiP stream", () => {
    const { broadcasts, service } = createHarness();

    service.handleBrowserUseStateSnapshot(createBrowserUseSnapshot([
      createBrowserUseTab({ captureActive: false, browserTabId: "tab-inactive" }),
      createBrowserUseTab({ released: true, browserTabId: "tab-released" }),
      createBrowserUseTab({ browserTabId: "tab-detached", webContentsId: null }),
      createBrowserUseTab({ browserConversationId: "session-unmapped", browserTabId: "tab-unmapped" }),
    ]));

    expect(JSON.stringify(service.getBrowserUsePipConversationIds())).toBe(JSON.stringify([]));
    expect(broadcasts.length).toBe(0);
  });

  test("publishes any-active changes for the renderer's active thread", () => {
    const { broadcasts, service } = createHarness();
    const sender = new FakeSender(9);

    service.handleDesktopMessageFromView(sender, {
      type: "remote-hosted-pip-active-thread-changed",
      conversationId: "thread-2",
    });
    service.handleBrowserUseStateSnapshot(createBrowserUseSnapshot([
      createBrowserUseTab({ browserConversationId: "session-1" }),
    ]));

    expect(JSON.stringify(broadcasts)).toBe(JSON.stringify([
      {
        channel: "remote-hosted-pip-stream-state-changed",
        payload: {
          type: "remote-hosted-pip-stream-state-changed",
          conversationId: "thread-1",
          isActive: true,
          isAnyActive: true,
        },
      },
      {
        channel: "remote-hosted-pip-stream-state-changed",
        payload: {
          type: "remote-hosted-pip-stream-state-changed",
          conversationId: "thread-2",
          isActive: false,
          isAnyActive: true,
        },
      },
    ]));
  });

  test("tracks equal browser tab ids as distinct conversation-scoped PiP sources", () => {
    const { service } = createHarness();

    service.handleBrowserUseStateSnapshot(createBrowserUseSnapshot([
      createBrowserUseTab({ browserConversationId: "session-1", browserTabId: "shared" }),
      createBrowserUseTab({ browserConversationId: "session-2", browserTabId: "shared", webContentsId: 202 }),
    ]));

    expect(JSON.stringify(service.getBrowserUsePipConversationIds())).toBe(
      JSON.stringify(["thread-1", "thread-2"]),
    );

    service.handleBrowserUseStateSnapshot(createBrowserUseSnapshot([
      createBrowserUseTab({ browserConversationId: "session-2", browserTabId: "shared", webContentsId: 202 }),
    ]));

    expect(JSON.stringify(service.getBrowserUsePipConversationIds())).toBe(
      JSON.stringify(["thread-2"]),
    );
  });

  test("broadcasts visibility requests from renderer messages", () => {
    const { broadcasts, service } = createHarness();

    service.handleDesktopMessageFromView(new FakeSender(11), {
      type: "remote-hosted-pip-visibility-changed",
      isVisible: false,
    });

    expect(JSON.stringify(broadcasts)).toBe(JSON.stringify([
      {
        channel: "remote-hosted-pip-visibility-requested",
        payload: {
          type: "remote-hosted-pip-visibility-requested",
          isVisible: false,
        },
      },
    ]));
  });
});
