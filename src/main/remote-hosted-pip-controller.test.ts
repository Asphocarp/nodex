import { describe, expect } from "vite-plus/test";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Scope from "effect/Scope";
import { it } from "@effect/vitest";
import type { RemoteHostedPipHostLayout } from "../shared/remote-hosted-pip";
import {
  makeRemoteHostedPipController,
  type RemoteHostedPipController,
  type RemoteHostedPipWebContentsLike,
  type RemoteHostedPipWindowLike,
} from "./remote-hosted-pip-controller";
import type { SkyNativeAddon, SkyRemoteHostedPipHostRegistration } from "./sky-native";

class FakeSender implements RemoteHostedPipWebContentsLike {
  private readonly destroyedListeners: Array<() => void> = [];

  constructor(readonly id: number) {}

  once(eventName: "destroyed", listener: () => void): void {
    if (eventName === "destroyed") this.destroyedListeners.push(listener);
  }

  removeListener(eventName: "destroyed", listener: () => void): void {
    if (eventName !== "destroyed") return;
    const index = this.destroyedListeners.indexOf(listener);
    if (index >= 0) this.destroyedListeners.splice(index, 1);
  }

  listenerCount(): number {
    return this.destroyedListeners.length;
  }

  destroy(): void {
    for (const listener of [...this.destroyedListeners]) listener();
  }
}

class FakeWindow implements RemoteHostedPipWindowLike {
  private readonly closedListeners: Array<() => void> = [];
  private readonly focusListeners: Array<() => void> = [];
  destroyed = false;
  focused = true;

  constructor(
    readonly id: number,
    readonly webContents = new FakeSender(id * 10),
  ) {}

  getContentBounds() {
    return { height: 800, width: 1200, x: 10, y: 20 };
  }

  getNativeWindowHandle(): Buffer {
    return Buffer.from([1, 2, 3]);
  }

  getTitle(): string {
    return `Window ${this.id}`;
  }

  isDestroyed(): boolean {
    return this.destroyed;
  }

  isFocused(): boolean {
    return this.focused;
  }

  on(eventName: "focus", listener: () => void): void {
    if (eventName === "focus") this.focusListeners.push(listener);
  }

  once(eventName: "closed", listener: () => void): void {
    if (eventName === "closed") this.closedListeners.push(listener);
  }

  removeListener(eventName: "focus" | "closed", listener: () => void): void {
    const listeners = eventName === "focus" ? this.focusListeners : this.closedListeners;
    const index = listeners.indexOf(listener);
    if (index >= 0) listeners.splice(index, 1);
  }

  listenerCount(eventName: "focus" | "closed"): number {
    return eventName === "focus" ? this.focusListeners.length : this.closedListeners.length;
  }

  focus(): void {
    this.focused = true;
    for (const listener of [...this.focusListeners]) listener();
  }

  close(): void {
    this.destroyed = true;
    for (const listener of [...this.closedListeners]) listener();
  }
}

class FakeSkyAddon implements SkyNativeAddon {
  activeTaskIds: string[] = [];
  anyPresentation = false;
  activeThreadIds: Array<string | null> = [];
  completedThreads: string[] = [];
  invalidatedPresentations: string[] = [];
  invalidatedTurns: Array<[string, string]> = [];
  maxDisplaySizeChangedHandler: ((size: number) => void) | null = null;
  maxDisplaySizes: number[] = [];
  privacySettingsTerminationRequest = false;
  registrations: SkyRemoteHostedPipHostRegistration[] = [];
  suppressedThreadIds: string[][] = [];
  upserts: Array<[string, string, string, string | null]> = [];
  unregisteredHostIds: string[] = [];
  refreshVisibilityCalls: Array<string[] | undefined> = [];
  shouldShowTaskHandler: ((threadId: string) => boolean) | null = null;
  visibilityHandler: ((isVisible: boolean, threadIds: string[]) => void) | null = null;

  completeRemoteHostedPIPContentThread(threadId: string): boolean {
    this.completedThreads.push(threadId);
    return true;
  }

  computerUseServiceProcessMatchesExecutablePath(): boolean {
    return true;
  }
  getRemoteHostedPIPContentActiveTaskIDs(): string[] {
    return this.activeTaskIds;
  }
  hasRemoteHostedPIPContentAnyPresentation(): boolean {
    return this.anyPresentation;
  }
  invalidateBrowserUsePIPContent(id: string): boolean {
    this.invalidatedPresentations.push(id);
    return true;
  }
  invalidateRemoteHostedPIPContentTurn(threadId: string, turnId: string): boolean {
    this.invalidatedTurns.push([threadId, turnId]);
    return true;
  }
  isPrivacySettingsTerminationRequest(): boolean {
    return this.privacySettingsTerminationRequest;
  }
  registerRemoteHostedPIPContentHost(input: SkyRemoteHostedPipHostRegistration): boolean {
    this.registrations.push(input);
    return true;
  }
  setRemoteHostedPIPContentActiveThreadID(threadId: string | null): boolean {
    this.activeThreadIds.push(threadId);
    return true;
  }
  setRemoteHostedPIPContentComputerUseCursorLocationHandler(): boolean {
    return true;
  }
  setRemoteHostedPIPContentMaxDisplaySize(size: number): boolean {
    this.maxDisplaySizes.push(size);
    return true;
  }
  setRemoteHostedPIPContentMaxDisplaySizeChangedHandler(
    handler: ((size: number) => void) | null,
  ): boolean {
    this.maxDisplaySizeChangedHandler = handler;
    return true;
  }
  setRemoteHostedPIPContentPetWakeRequestHandler(): boolean {
    return true;
  }
  setRemoteHostedPIPContentSuppressedThreadIDs(threadIds: string[]): boolean {
    this.suppressedThreadIds.push(threadIds);
    return true;
  }
  setRemoteHostedPIPContentVisibilityRequestHandler(
    handler: ((isVisible: boolean, threadIds: string[]) => void) | null,
  ): boolean {
    this.visibilityHandler = handler;
    return true;
  }
  refreshRemoteHostedPIPContentVisibility(threadIds?: string[]): boolean {
    this.refreshVisibilityCalls.push(threadIds);
    return true;
  }
  setRemoteHostedPIPContentShouldShowTaskHandler(
    handler: ((threadId: string) => boolean) | null,
  ): boolean {
    this.shouldShowTaskHandler = handler;
    return true;
  }
  async spawnComputerUseService(): Promise<number | null> {
    return 123;
  }
  startRemoteHostedPIPContentHost(): boolean {
    return true;
  }
  stopRemoteHostedPIPContentHost(): boolean {
    return true;
  }
  unregisterRemoteHostedPIPContentHost(hostId: string): boolean {
    this.unregisteredHostIds.push(hostId);
    return true;
  }
  upsertBrowserUsePIPContent(
    id: string,
    threadId: string,
    imageDataUrl: string,
    appIconPath: string | null,
  ): boolean {
    this.upserts.push([id, threadId, imageDataUrl, appIconPath]);
    this.anyPresentation = true;
    return true;
  }
}

const layout: RemoteHostedPipHostLayout = {
  anchorRect: { height: 700, width: 900, x: 0, y: 0 },
  anchors: [{ alignment: "bottom-right", point: { x: 860, y: 660 } }],
  animated: false,
  hostId: "codex-main-thread",
  presentationScope: "thread",
};

function createHarness(): Effect.Effect<
  {
    readonly addon: FakeSkyAddon;
    readonly broadcasts: Array<{ channel: string; payload: unknown }>;
    readonly sent: Array<{ channel: string; payload: unknown }>;
    readonly service: RemoteHostedPipController;
    readonly getMaxDisplaySize: () => number | null;
    readonly getAlwaysHide: () => boolean;
    readonly setSurfacePresented: (value: boolean) => void;
    readonly window: FakeWindow;
  },
  never,
  Scope.Scope
> {
  const addon = new FakeSkyAddon();
  const broadcasts: Array<{ channel: string; payload: unknown }> = [];
  const sent: Array<{ channel: string; payload: unknown }> = [];
  const window = new FakeWindow(1);
  let surfacePresented = false;
  let alwaysHide = false;
  let maxDisplaySize: number | null = 280;
  return makeRemoteHostedPipController({
    addon,
    broadcast: (channel, payload) => broadcasts.push({ channel, payload }),
    getFocusedWindow: () => (window.focused && !window.destroyed ? window : null),
    getWindowForSender: (sender) => (sender.id === window.webContents.id ? window : null),
    isThreadSurfacePresented: () => surfacePresented,
    readAlwaysHide: () => alwaysHide,
    readMaxDisplaySize: () => maxDisplaySize,
    sendToSender: (_sender, channel, payload) => sent.push({ channel, payload }),
    writeAlwaysHide: (value) => {
      alwaysHide = value;
    },
    writeMaxDisplaySize: (size) => {
      maxDisplaySize = size;
    },
  }).pipe(
    Effect.map((service) => ({
      addon,
      broadcasts,
      sent,
      service,
      getMaxDisplaySize: () => maxDisplaySize,
      getAlwaysHide: () => alwaysHide,
      setSurfacePresented: (value: boolean) => {
        surfacePresented = value;
      },
      window,
    })),
  );
}

function attachThread(service: RemoteHostedPipController, window: FakeWindow): void {
  service.handleDesktopMessageFromView(window.webContents, {
    layout,
    type: "remote-hosted-pip-host-layout-changed",
  });
  service.handleDesktopMessageFromView(window.webContents, {
    conversationId: "thread-1",
    type: "remote-hosted-pip-active-thread-changed",
  });
}

function browserNotification(surface: Record<string, unknown>): unknown {
  return {
    method: "item/completed",
    params: {
      item: {
        result: {
          _meta: {
            "codex/toolSurface": {
              backend: "iab",
              browserId: "browser-1",
              kind: "browserUse",
              ...surface,
            },
          },
        },
        server: "node_repl",
        type: "mcpToolCall",
      },
      threadId: "thread-1",
    },
  };
}

describe("RemoteHostedPipController", () => {
  it.effect(
    "registers the focused BrowserWindow as a native host and publishes real native state",
    () =>
      Effect.scoped(
        Effect.gen(function* () {
          const { addon, broadcasts, service, window } = yield* createHarness();
          attachThread(service, window);
          expect(addon.registrations.at(-1)).toMatchObject({
            contentBounds: { height: 800, width: 1200, x: 10, y: 20 },
            id: "codex-main-thread",
            isCodexHomeAvailable: false,
            presentationScope: "thread",
            title: "Window 1",
          });
          expect(addon.activeThreadIds.at(-1)).toBe("thread-1");
          expect(addon.maxDisplaySizes).toEqual([280]);

          addon.maxDisplaySizeChangedHandler?.(340);
          addon.activeTaskIds = ["thread-1"];
          addon.anyPresentation = true;
          service.handleCodexNotification(
            browserNotification({
              screenshot: { tabId: "tab-1", url: "data:image/png;base64,YQ==" },
            }),
          );
          expect(broadcasts.at(-1)).toEqual({
            channel: "remote-hosted-pip-stream-state-changed",
            payload: {
              conversationId: "thread-1",
              isActive: true,
              isAnyActive: true,
              type: "remote-hosted-pip-stream-state-changed",
            },
          });
        }),
      ),
  );

  it.effect("releases native callbacks and window listeners with its Scope", () =>
    Effect.gen(function* () {
      const scope = yield* Scope.make();
      const { addon, getMaxDisplaySize, service, window } = yield* createHarness().pipe(
        Effect.provideService(Scope.Scope, scope),
      );
      attachThread(service, window);

      addon.maxDisplaySizeChangedHandler?.(360);
      expect(getMaxDisplaySize()).toBe(360);
      addon.privacySettingsTerminationRequest = true;
      expect(service.isPrivacySettingsTerminationRequest()).toBe(true);
      expect(window.listenerCount("focus")).toBe(1);
      expect(window.listenerCount("closed")).toBe(1);
      expect(window.webContents.listenerCount()).toBe(1);

      yield* Scope.close(scope, Exit.void);
      expect(addon.maxDisplaySizeChangedHandler).toBeNull();
      expect(addon.shouldShowTaskHandler).toBeNull();
      expect(window.listenerCount("focus")).toBe(0);
      expect(window.listenerCount("closed")).toBe(0);
      expect(window.webContents.listenerCount()).toBe(0);
      expect(service.isPrivacySettingsTerminationRequest()).toBe(false);
    }),
  );

  it.effect("persists the global always-hide setting and refreshes native visibility", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { addon, getAlwaysHide, service, window } = yield* createHarness();
        attachThread(service, window);

        service.setAlwaysHide(true);
        expect(getAlwaysHide()).toBe(true);
        expect(service.getAlwaysHide()).toBe(true);
        expect(addon.refreshVisibilityCalls.length).toBeGreaterThan(0);

        service.setAlwaysHide(false);
        expect(addon.refreshVisibilityCalls.length).toBeGreaterThan(1);
      }),
    ),
  );

  it.effect("ingests completed Browser metadata and prunes exact presentations", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { addon, service, window } = yield* createHarness();
        attachThread(service, window);
        service.handleCodexNotification(
          browserNotification({
            screenshot: { tabId: "tab-1", url: "data:image/png;base64,YQ==" },
          }),
        );
        service.handleCodexNotification(
          browserNotification({
            screenshot: { tabId: "tab-2", url: "data:image/png;base64,Yg==" },
          }),
        );
        expect(addon.upserts.map(([id]) => id)).toEqual([
          'browser:["thread-1","browser-1","tab-1"]',
          'browser:["thread-1","browser-1","tab-2"]',
        ]);

        service.handleCodexNotification(browserNotification({ openTabIds: ["tab-2"] }));
        expect(addon.invalidatedPresentations).toEqual([
          'browser:["thread-1","browser-1","tab-1"]',
        ]);
        service.handleCodexNotification(browserNotification({ sessionEnded: true }));
        expect(addon.invalidatedPresentations.at(-1)).toBe(
          'browser:["thread-1","browser-1","tab-2"]',
        );
      }),
    ),
  );

  it.effect("keeps user-hidden threads separate from Browser surface suppression", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { addon, broadcasts, service, setSurfacePresented, window } = yield* createHarness();
        attachThread(service, window);
        service.handleDesktopMessageFromView(window.webContents, {
          hiddenThreadIds: ["thread-hidden"],
          type: "remote-hosted-pip-hidden-thread-ids-changed",
        });
        expect(addon.suppressedThreadIds.at(-1)).toEqual(["thread-hidden"]);
        expect(addon.shouldShowTaskHandler?.("thread-1")).toBe(true);
        expect(addon.shouldShowTaskHandler?.("thread-hidden")).toBe(false);

        setSurfacePresented(true);
        service.handleBrowserUseStateSnapshot();
        expect(addon.suppressedThreadIds.at(-1)).toEqual(["thread-1", "thread-hidden"]);
        expect(addon.activeThreadIds.at(-1)).toBe(null);
        expect(addon.shouldShowTaskHandler?.("thread-1")).toBe(false);

        addon.visibilityHandler?.(false, ["thread-1"]);
        expect(service.getHiddenThreadIds()).toEqual(["thread-1", "thread-hidden"]);
        expect(broadcasts.at(-1)).toEqual({
          channel: "remote-hosted-pip-hidden-thread-ids-requested",
          payload: {
            hiddenThreadIds: ["thread-1", "thread-hidden"],
            type: "remote-hosted-pip-hidden-thread-ids-requested",
          },
        });
      }),
    ),
  );

  it.effect("maps terminal turn lifecycle to complete versus invalidate", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { addon, service, window } = yield* createHarness();
        attachThread(service, window);
        service.handleCodexNotification({
          method: "turn/completed",
          params: { threadId: "thread-1", turn: { id: "turn-1", status: "completed" } },
        });
        service.handleCodexNotification({
          method: "turn/completed",
          params: { threadId: "thread-1", turn: { id: "turn-2", status: "failed" } },
        });
        expect(addon.completedThreads).toEqual(["thread-1"]);
        expect(addon.invalidatedTurns).toEqual([["thread-1", "turn-2"]]);
      }),
    ),
  );
});
