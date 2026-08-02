import type { IpcEvents } from "../shared/ipc-api";
import type {
  CodexDesktopMessageFromView,
  RemoteHostedPipHostLayout,
  RemoteHostedPipStreamStateChangedMessage,
  RemoteHostedPipViewportRect,
} from "../shared/remote-hosted-pip";
import { parseRemoteHostedPipNotification } from "./browser-use/browser-use-pip-metadata";
import type { SkyNativeAddon } from "./sky-native";

export interface RemoteHostedPipWebContentsLike {
  id: number;
  once(eventName: "destroyed", listener: () => void): void;
}

export interface RemoteHostedPipWindowLike {
  readonly id: number;
  readonly webContents: RemoteHostedPipWebContentsLike;
  getContentBounds(): RemoteHostedPipViewportRect;
  getNativeWindowHandle?(): Buffer;
  getTitle(): string;
  isDestroyed(): boolean;
  isFocused(): boolean;
  on(eventName: "focus", listener: () => void): void;
  once(eventName: "closed", listener: () => void): void;
}

type RemoteHostedPipMessageChannel =
  | "remote-hosted-pip-hidden-thread-ids-requested"
  | "remote-hosted-pip-stream-state-changed";

interface RemoteHostedPipServiceDeps {
  addon: SkyNativeAddon | null;
  broadcast: <Channel extends RemoteHostedPipMessageChannel>(
    channel: Channel,
    payload: IpcEvents[Channel],
  ) => void;
  getFocusedWindow: () => RemoteHostedPipWindowLike | null;
  getWindowForSender: (
    sender: RemoteHostedPipWebContentsLike,
  ) => RemoteHostedPipWindowLike | null;
  isEnabled?: () => boolean;
  isThreadSurfacePresented?: (threadId: string) => boolean;
  readAlwaysHide?: () => boolean;
  readMaxDisplaySize?: () => number | null;
  sendToSender: <Channel extends RemoteHostedPipMessageChannel>(
    sender: RemoteHostedPipWebContentsLike,
    channel: Channel,
    payload: IpcEvents[Channel],
  ) => void;
  writeAlwaysHide?: (alwaysHide: boolean) => void;
  writeMaxDisplaySize?: (size: number) => void;
}

interface BrowserUsePipSession {
  presentationIdsByTabId: Map<string, string>;
  threadId: string;
}

interface PublishedStreamState {
  isActive: boolean;
  isAnyActive: boolean;
}

const REMOTE_HOSTED_PIP_POLL_INTERVAL_MS = 500;

export class RemoteHostedPipService {
  private readonly activeThreadByWindowId = new Map<number, string>();
  private readonly browserUsePipSessions = new Map<string, BrowserUsePipSession>();
  private readonly hiddenThreadIds = new Set<string>();
  private readonly hostIdByWindowId = new Map<number, string>();
  private readonly hostLayoutByWindowId = new Map<number, RemoteHostedPipHostLayout>();
  private readonly hostOwnerWindowIdByHostId = new Map<string, number>();
  private readonly publishedStreamStateByConversationId = new Map<string, PublishedStreamState>();
  private readonly trackedWindowIds = new Set<number>();
  private alwaysHide = false;
  private contentHostStarted = false;
  private disposed = false;
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private selectedThreadId: string | null = null;

  constructor(private readonly deps: RemoteHostedPipServiceDeps) {
    this.alwaysHide = deps.readAlwaysHide?.() ?? false;
  }

  handleDesktopMessageFromView(
    sender: RemoteHostedPipWebContentsLike,
    message: CodexDesktopMessageFromView,
  ): void {
    const window = this.trackSender(sender);
    if (!window) return;

    switch (message.type) {
      case "remote-hosted-pip-active-thread-changed": {
        if (message.conversationId === null) {
          this.activeThreadByWindowId.delete(window.id);
        } else {
          this.activeThreadByWindowId.set(window.id, message.conversationId);
        }
        this.reconcileNativeState();
        return;
      }
      case "remote-hosted-pip-hidden-thread-ids-changed": {
        this.setHiddenThreadIds(message.hiddenThreadIds);
        return;
      }
      case "remote-hosted-pip-host-layout-changed": {
        this.setHostLayout(window, message.layout);
        return;
      }
    }
  }

  handleBrowserUseStateSnapshot(): Promise<void> {
    this.reconcileNativeState();
    return Promise.resolve();
  }

  handleCodexNotification(notification: unknown): void {
    const event = parseRemoteHostedPipNotification(notification);
    if (!event || !this.ensureContentHostStarted()) return;

    if (event.kind === "thread-ended") {
      this.invalidateBrowserUseThread(event.threadId);
      return;
    }
    if (event.kind === "turn-ended") {
      if (event.completed) {
        this.deps.addon?.completeRemoteHostedPIPContentThread(event.threadId);
      } else {
        this.deps.addon?.invalidateRemoteHostedPIPContentTurn(event.threadId, event.turnId);
      }
      this.pollNativePresentationState();
      return;
    }

    const sessionId = JSON.stringify([event.threadId, event.surface.browserId]);
    if (event.surface.sessionEnded === true) {
      this.invalidateBrowserUseSession(sessionId);
      return;
    }

    let session = this.browserUsePipSessions.get(sessionId);
    if (event.surface.screenshot) {
      const { screenshot } = event.surface;
      const presentationId = `browser:${JSON.stringify([
        event.threadId,
        event.surface.browserId,
        screenshot.tabId,
      ])}`;
      const inserted = this.deps.addon?.upsertBrowserUsePIPContent(
        presentationId,
        event.threadId,
        screenshot.url,
        null,
      ) === true;
      if (inserted) {
        session ??= {
          presentationIdsByTabId: new Map(),
          threadId: event.threadId,
        };
        session.presentationIdsByTabId.set(screenshot.tabId, presentationId);
        this.browserUsePipSessions.set(sessionId, session);
      }
    }

    if (event.surface.openTabIds && session) {
      const openTabIds = new Set(event.surface.openTabIds);
      for (const [tabId, presentationId] of session.presentationIdsByTabId) {
        if (openTabIds.has(tabId)) continue;
        this.deps.addon?.invalidateBrowserUsePIPContent(presentationId);
        session.presentationIdsByTabId.delete(tabId);
      }
      if (session.presentationIdsByTabId.size === 0) {
        this.browserUsePipSessions.delete(sessionId);
      }
    }
    this.reconcileNativeState();
    this.pollNativePresentationState();
  }

  getHiddenThreadIds(): string[] {
    return [...this.hiddenThreadIds].sort();
  }

  getAlwaysHide(): boolean {
    return this.alwaysHide;
  }

  setAlwaysHide(alwaysHide: boolean): void {
    this.alwaysHide = alwaysHide;
    this.deps.writeAlwaysHide?.(alwaysHide);
    if (this.contentHostStarted) {
      this.deps.addon?.setRemoteHostedPIPContentVisible(!alwaysHide);
    }
    this.reconcileNativeState();
  }

  isPrivacySettingsTerminationRequest(): boolean {
    try {
      return this.deps.addon?.isPrivacySettingsTerminationRequest() === true;
    } catch {
      return false;
    }
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    if (this.pollTimer) clearInterval(this.pollTimer);
    this.pollTimer = null;
    for (const sessionId of [...this.browserUsePipSessions.keys()]) {
      this.invalidateBrowserUseSession(sessionId);
    }
    for (const hostId of new Set(this.hostIdByWindowId.values())) {
      this.deps.addon?.unregisterRemoteHostedPIPContentHost(hostId);
    }
    this.hostIdByWindowId.clear();
    this.hostOwnerWindowIdByHostId.clear();
    this.deps.addon?.setRemoteHostedPIPContentVisibilityRequestHandler(null);
    this.deps.addon?.setRemoteHostedPIPContentMaxDisplaySizeChangedHandler(null);
    this.deps.addon?.setRemoteHostedPIPContentComputerUseCursorLocationHandler(null);
    this.deps.addon?.setRemoteHostedPIPContentPetWakeRequestHandler(null);
    if (this.contentHostStarted) this.deps.addon?.stopRemoteHostedPIPContentHost();
    this.contentHostStarted = false;
  }

  private trackSender(
    sender: RemoteHostedPipWebContentsLike,
  ): RemoteHostedPipWindowLike | null {
    const window = this.deps.getWindowForSender(sender);
    if (!window || window.isDestroyed()) return null;
    if (!this.trackedWindowIds.has(window.id)) {
      this.trackedWindowIds.add(window.id);
      window.on("focus", () => this.reconcileNativeState());
      window.once("closed", () => this.removeWindow(window.id));
      sender.once("destroyed", () => this.removeWindow(window.id));
    }
    this.sendHiddenThreadIdsRequested(sender);
    return window;
  }

  private removeWindow(windowId: number): void {
    if (!this.trackedWindowIds.delete(windowId)) return;
    this.activeThreadByWindowId.delete(windowId);
    this.hostLayoutByWindowId.delete(windowId);
    this.unregisterWindowHost(windowId);
    this.reconcileNativeState();
  }

  private setHostLayout(
    window: RemoteHostedPipWindowLike,
    layout: RemoteHostedPipHostLayout,
  ): void {
    if (layout.anchorRect === null || layout.anchors === null) {
      this.hostLayoutByWindowId.delete(window.id);
      this.unregisterWindowHost(window.id);
      this.reconcileNativeState();
      return;
    }
    this.hostLayoutByWindowId.set(window.id, layout);
    if (window.isFocused()) this.registerWindowHost(window, layout);
    this.reconcileNativeState();
  }

  private registerWindowHost(
    window: RemoteHostedPipWindowLike,
    layout: RemoteHostedPipHostLayout,
  ): boolean {
    if (!this.ensureContentHostStarted()) return false;
    const existingOwnerWindowId = this.hostOwnerWindowIdByHostId.get(layout.hostId);
    if (existingOwnerWindowId !== undefined && existingOwnerWindowId !== window.id) {
      this.unregisterWindowHost(existingOwnerWindowId);
    }
    const registered = this.deps.addon?.registerRemoteHostedPIPContentHost({
      anchors: layout.anchors,
      anchorRect: layout.anchorRect,
      animated: layout.animated && this.deps.addon.hasRemoteHostedPIPContentAnyPresentation(),
      contentBounds: window.getContentBounds(),
      id: layout.hostId,
      nativeWindowHandle: window.getNativeWindowHandle?.() ?? null,
      presentationScope: layout.presentationScope,
      title: window.getTitle(),
    }) === true;
    if (!registered) return false;
    this.hostIdByWindowId.set(window.id, layout.hostId);
    this.hostOwnerWindowIdByHostId.set(layout.hostId, window.id);
    return true;
  }

  private unregisterWindowHost(windowId: number): void {
    const hostId = this.hostIdByWindowId.get(windowId);
    if (!hostId) return;
    this.hostIdByWindowId.delete(windowId);
    if (this.hostOwnerWindowIdByHostId.get(hostId) !== windowId) return;
    this.hostOwnerWindowIdByHostId.delete(hostId);
    this.deps.addon?.unregisterRemoteHostedPIPContentHost(hostId);
  }

  private ensureContentHostStarted(): boolean {
    if (this.disposed || this.deps.isEnabled?.() === false || !this.deps.addon) return false;
    if (this.contentHostStarted) return true;
    this.contentHostStarted = this.deps.addon.startRemoteHostedPIPContentHost({
      hide: "Hide",
      placement: "Send Picture-in-Picture to Pet",
    });
    if (!this.contentHostStarted) return false;
    this.deps.addon.setRemoteHostedPIPContentVisibilityRequestHandler(
      (isVisible, threadIds) => this.handleNativeVisibilityRequest(isVisible, threadIds),
    );
    this.deps.addon.setRemoteHostedPIPContentMaxDisplaySizeChangedHandler(
      (size) => {
        if (Number.isFinite(size) && size > 0) {
          this.deps.writeMaxDisplaySize?.(size);
        }
      },
    );
    const maxDisplaySize = this.deps.readMaxDisplaySize?.() ?? null;
    if (maxDisplaySize !== null && Number.isFinite(maxDisplaySize) && maxDisplaySize > 0) {
      this.deps.addon.setRemoteHostedPIPContentMaxDisplaySize(maxDisplaySize);
    }
    this.deps.addon.setRemoteHostedPIPContentComputerUseCursorLocationHandler(null);
    this.deps.addon.setRemoteHostedPIPContentPetWakeRequestHandler(null);
    this.alwaysHide = this.deps.readAlwaysHide?.() ?? false;
    this.deps.addon.setRemoteHostedPIPContentVisible(!this.alwaysHide);
    this.pollTimer = setInterval(
      () => this.pollNativePresentationState(),
      REMOTE_HOSTED_PIP_POLL_INTERVAL_MS,
    );
    this.pollTimer.unref?.();
    return true;
  }

  private reconcileNativeState(): void {
    if (!this.ensureContentHostStarted()) return;
    const focusedWindow = this.deps.getFocusedWindow();
    if (focusedWindow && !focusedWindow.isDestroyed()) {
      const layout = this.hostLayoutByWindowId.get(focusedWindow.id);
      if (layout && this.hostIdByWindowId.get(focusedWindow.id) !== layout.hostId) {
        this.registerWindowHost(focusedWindow, layout);
      }
    }

    const surfaceSuppressedThreadIds = new Set<string>();
    for (const threadId of this.activeThreadByWindowId.values()) {
      if (this.deps.isThreadSurfacePresented?.(threadId) === true) {
        surfaceSuppressedThreadIds.add(threadId);
      }
    }
    const suppressedThreadIds = new Set([
      ...this.hiddenThreadIds,
      ...surfaceSuppressedThreadIds,
    ]);
    this.deps.addon?.setRemoteHostedPIPContentSuppressedThreadIDs(
      [...suppressedThreadIds].sort(),
    );

    const focusedThreadId = focusedWindow
      ? this.activeThreadByWindowId.get(focusedWindow.id) ?? null
      : null;
    const hostRegistered = focusedWindow
      ? this.hostIdByWindowId.has(focusedWindow.id)
      : false;
    const nextSelectedThreadId = hostRegistered
      && focusedThreadId
      && !surfaceSuppressedThreadIds.has(focusedThreadId)
      ? focusedThreadId
      : null;
    const previousSelectedThreadId = this.selectedThreadId;
    if (previousSelectedThreadId !== nextSelectedThreadId) {
      this.selectedThreadId = nextSelectedThreadId;
      this.deps.addon?.setRemoteHostedPIPContentActiveThreadID(nextSelectedThreadId);
      if (previousSelectedThreadId) this.publishStreamState(previousSelectedThreadId, false);
    }
    this.pollNativePresentationState();
  }

  private pollNativePresentationState(): void {
    if (!this.contentHostStarted || !this.deps.addon) return;
    const selectedThreadId = this.selectedThreadId;
    if (!selectedThreadId) return;
    this.publishStreamState(
      selectedThreadId,
      this.deps.addon.hasRemoteHostedPIPContentActivePresentation(),
    );
  }

  private publishStreamState(conversationId: string, isActive: boolean): void {
    const state = {
      isActive,
      isAnyActive: this.deps.addon?.hasRemoteHostedPIPContentAnyPresentation() === true,
    };
    const previousState = this.publishedStreamStateByConversationId.get(conversationId);
    if (
      previousState?.isActive === state.isActive
      && previousState.isAnyActive === state.isAnyActive
    ) {
      return;
    }
    this.publishedStreamStateByConversationId.set(conversationId, state);
    this.deps.broadcast(
      "remote-hosted-pip-stream-state-changed",
      this.buildStreamStateMessage(conversationId, state),
    );
  }

  private buildStreamStateMessage(
    conversationId: string,
    state: PublishedStreamState,
  ): RemoteHostedPipStreamStateChangedMessage {
    return {
      conversationId,
      isActive: state.isActive,
      isAnyActive: state.isAnyActive,
      type: "remote-hosted-pip-stream-state-changed",
    };
  }

  private setHiddenThreadIds(threadIds: readonly string[]): void {
    this.hiddenThreadIds.clear();
    for (const threadId of threadIds) {
      const normalized = threadId.trim();
      if (normalized) this.hiddenThreadIds.add(normalized);
    }
    this.broadcastHiddenThreadIdsRequested();
    this.reconcileNativeState();
  }

  private handleNativeVisibilityRequest(
    isVisible: boolean,
    threadIds: readonly string[],
  ): void {
    for (const threadId of threadIds) {
      if (isVisible) {
        this.hiddenThreadIds.delete(threadId);
      } else {
        this.hiddenThreadIds.add(threadId);
      }
    }
    this.broadcastHiddenThreadIdsRequested();
    this.reconcileNativeState();
  }

  private sendHiddenThreadIdsRequested(sender: RemoteHostedPipWebContentsLike): void {
    this.deps.sendToSender(sender, "remote-hosted-pip-hidden-thread-ids-requested", {
      hiddenThreadIds: this.getHiddenThreadIds(),
      type: "remote-hosted-pip-hidden-thread-ids-requested",
    });
  }

  private broadcastHiddenThreadIdsRequested(): void {
    this.deps.broadcast("remote-hosted-pip-hidden-thread-ids-requested", {
      hiddenThreadIds: this.getHiddenThreadIds(),
      type: "remote-hosted-pip-hidden-thread-ids-requested",
    });
  }

  private invalidateBrowserUseThread(threadId: string): void {
    for (const [sessionId, session] of this.browserUsePipSessions) {
      if (session.threadId === threadId) this.invalidateBrowserUseSession(sessionId);
    }
    this.deps.addon?.completeRemoteHostedPIPContentThread(threadId);
    this.pollNativePresentationState();
  }

  private invalidateBrowserUseSession(sessionId: string): void {
    const session = this.browserUsePipSessions.get(sessionId);
    if (!session) return;
    for (const presentationId of session.presentationIdsByTabId.values()) {
      this.deps.addon?.invalidateBrowserUsePIPContent(presentationId);
    }
    this.browserUsePipSessions.delete(sessionId);
    this.pollNativePresentationState();
  }
}
