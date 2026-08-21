import * as Effect from "effect/Effect";
import * as Scope from "effect/Scope";
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
  readonly id: number;
  readonly once: (eventName: "destroyed", listener: () => void) => void;
  readonly removeListener: (eventName: "destroyed", listener: () => void) => void;
}

export interface RemoteHostedPipWindowLike {
  readonly id: number;
  readonly webContents: RemoteHostedPipWebContentsLike;
  readonly getContentBounds: () => RemoteHostedPipViewportRect;
  readonly getNativeWindowHandle?: () => Buffer;
  readonly getTitle: () => string;
  readonly isDestroyed: () => boolean;
  readonly isFocused: () => boolean;
  readonly on: (eventName: "focus", listener: () => void) => void;
  readonly once: (eventName: "closed", listener: () => void) => void;
  readonly removeListener: (eventName: "focus" | "closed", listener: () => void) => void;
}

type RemoteHostedPipMessageChannel =
  | "remote-hosted-pip-hidden-thread-ids-requested"
  | "remote-hosted-pip-stream-state-changed";

export interface RemoteHostedPipControllerOptions {
  readonly addon: SkyNativeAddon | null;
  readonly broadcast: <Channel extends RemoteHostedPipMessageChannel>(
    channel: Channel,
    payload: IpcEvents[Channel],
  ) => void;
  readonly getFocusedWindow: () => RemoteHostedPipWindowLike | null;
  readonly getWindowForSender: (
    sender: RemoteHostedPipWebContentsLike,
  ) => RemoteHostedPipWindowLike | null;
  readonly isEnabled?: () => boolean;
  readonly isThreadSurfacePresented?: (threadId: string) => boolean;
  readonly readAlwaysHide?: () => boolean;
  readonly readMaxDisplaySize?: () => number | null;
  readonly sendToSender: <Channel extends RemoteHostedPipMessageChannel>(
    sender: RemoteHostedPipWebContentsLike,
    channel: Channel,
    payload: IpcEvents[Channel],
  ) => void;
  readonly writeAlwaysHide?: (alwaysHide: boolean) => void;
  readonly writeMaxDisplaySize?: (size: number) => void;
}

interface BrowserUsePipSession {
  readonly presentationIdsByTabId: Map<string, string>;
  readonly threadId: string;
}

interface PublishedStreamState {
  readonly isActive: boolean;
  readonly isAnyActive: boolean;
}

interface TrackedWindow {
  readonly onClosed: () => void;
  readonly onDestroyed: () => void;
  readonly onFocus: () => void;
  readonly sender: RemoteHostedPipWebContentsLike;
  readonly window: RemoteHostedPipWindowLike;
}

export interface RemoteHostedPipController {
  readonly getAlwaysHide: () => boolean;
  readonly getHiddenThreadIds: () => readonly string[];
  readonly handleBrowserUseStateSnapshot: () => void;
  readonly handleCodexNotification: (notification: unknown) => void;
  readonly handleDesktopMessageFromView: (
    sender: RemoteHostedPipWebContentsLike,
    message: CodexDesktopMessageFromView,
  ) => void;
  readonly isPrivacySettingsTerminationRequest: () => boolean;
  readonly pollNativePresentationState: () => void;
  readonly setAlwaysHide: (alwaysHide: boolean) => void;
}

/**
 * Owns the synchronous native PiP state machine and all callback leases.
 * Time and stream consumption remain in RemoteHostedPipRuntime.
 */
export const makeRemoteHostedPipController = (
  options: RemoteHostedPipControllerOptions,
): Effect.Effect<RemoteHostedPipController, never, Scope.Scope> =>
  Effect.gen(function* () {
    const activeThreadByWindowId = new Map<number, string>();
    const browserUsePipSessions = new Map<string, BrowserUsePipSession>();
    const hiddenThreadIds = new Set<string>();
    const hostIdByWindowId = new Map<number, string>();
    const hostLayoutByWindowId = new Map<number, RemoteHostedPipHostLayout>();
    const hostOwnerWindowIdByHostId = new Map<string, number>();
    const publishedStreamStateByConversationId = new Map<string, PublishedStreamState>();
    const trackedWindows = new Map<number, TrackedWindow>();
    let accepting = true;
    let alwaysHide = options.readAlwaysHide?.() ?? false;
    let contentHostStarted = false;
    let selectedThreadId: string | null = null;

    function getHiddenThreadIds(): readonly string[] {
      return [...hiddenThreadIds].sort();
    }

    function buildStreamStateMessage(
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

    function publishStreamState(conversationId: string, isActive: boolean): void {
      const state = {
        isActive,
        isAnyActive: options.addon?.hasRemoteHostedPIPContentAnyPresentation() === true,
      };
      const previousState = publishedStreamStateByConversationId.get(conversationId);
      if (
        previousState?.isActive === state.isActive &&
        previousState.isAnyActive === state.isAnyActive
      ) {
        return;
      }
      publishedStreamStateByConversationId.set(conversationId, state);
      options.broadcast(
        "remote-hosted-pip-stream-state-changed",
        buildStreamStateMessage(conversationId, state),
      );
    }

    function pollNativePresentationState(): void {
      if (!accepting || !contentHostStarted || !options.addon || !selectedThreadId) return;
      const activeThreadIds = options.addon.getRemoteHostedPIPContentActiveTaskIDs();
      publishStreamState(selectedThreadId, activeThreadIds.includes(selectedThreadId));
    }

    function shouldShowNativeTask(threadId: string): boolean {
      if (!accepting || alwaysHide || hiddenThreadIds.has(threadId)) return false;
      return options.isThreadSurfacePresented?.(threadId) !== true;
    }

    function sendHiddenThreadIdsRequested(sender: RemoteHostedPipWebContentsLike): void {
      options.sendToSender(sender, "remote-hosted-pip-hidden-thread-ids-requested", {
        hiddenThreadIds: [...getHiddenThreadIds()],
        type: "remote-hosted-pip-hidden-thread-ids-requested",
      });
    }

    function broadcastHiddenThreadIdsRequested(): void {
      options.broadcast("remote-hosted-pip-hidden-thread-ids-requested", {
        hiddenThreadIds: [...getHiddenThreadIds()],
        type: "remote-hosted-pip-hidden-thread-ids-requested",
      });
    }

    function handleNativeVisibilityRequest(isVisible: boolean, threadIds: readonly string[]): void {
      if (!accepting) return;
      for (const threadId of threadIds) {
        if (isVisible) hiddenThreadIds.delete(threadId);
        else hiddenThreadIds.add(threadId);
      }
      broadcastHiddenThreadIdsRequested();
      reconcileNativeState();
    }

    function ensureContentHostStarted(): boolean {
      if (!accepting || options.isEnabled?.() === false || !options.addon) return false;
      if (contentHostStarted) return true;
      contentHostStarted = options.addon.startRemoteHostedPIPContentHost({
        hide: "Hide",
        placement: "Send Picture-in-Picture to Pet",
      });
      if (!contentHostStarted) return false;
      options.addon.setRemoteHostedPIPContentVisibilityRequestHandler((isVisible, threadIds) =>
        handleNativeVisibilityRequest(isVisible, threadIds),
      );
      options.addon.setRemoteHostedPIPContentShouldShowTaskHandler(shouldShowNativeTask);
      options.addon.setRemoteHostedPIPContentMaxDisplaySizeChangedHandler((size) => {
        if (accepting && Number.isFinite(size) && size > 0) {
          options.writeMaxDisplaySize?.(size);
        }
      });
      const maxDisplaySize = options.readMaxDisplaySize?.() ?? null;
      if (maxDisplaySize !== null && Number.isFinite(maxDisplaySize) && maxDisplaySize > 0) {
        options.addon.setRemoteHostedPIPContentMaxDisplaySize(maxDisplaySize);
      }
      options.addon.setRemoteHostedPIPContentComputerUseCursorLocationHandler(null);
      options.addon.setRemoteHostedPIPContentPetWakeRequestHandler(null);
      alwaysHide = options.readAlwaysHide?.() ?? false;
      options.addon.refreshRemoteHostedPIPContentVisibility();
      return true;
    }

    function unregisterWindowHost(windowId: number): void {
      const hostId = hostIdByWindowId.get(windowId);
      if (!hostId) return;
      hostIdByWindowId.delete(windowId);
      if (hostOwnerWindowIdByHostId.get(hostId) !== windowId) return;
      hostOwnerWindowIdByHostId.delete(hostId);
      options.addon?.unregisterRemoteHostedPIPContentHost(hostId);
    }

    function registerWindowHost(
      window: RemoteHostedPipWindowLike,
      layout: RemoteHostedPipHostLayout,
    ): boolean {
      if (!ensureContentHostStarted()) return false;
      const existingOwnerWindowId = hostOwnerWindowIdByHostId.get(layout.hostId);
      if (existingOwnerWindowId !== undefined && existingOwnerWindowId !== window.id) {
        unregisterWindowHost(existingOwnerWindowId);
      }
      const registered =
        options.addon?.registerRemoteHostedPIPContentHost({
          anchors: layout.anchors,
          anchorRect: layout.anchorRect,
          animated: layout.animated && options.addon.hasRemoteHostedPIPContentAnyPresentation(),
          contentBounds: window.getContentBounds(),
          id: layout.hostId,
          isCodexHomeAvailable: false,
          nativeWindowHandle: window.getNativeWindowHandle?.() ?? null,
          presentationScope: layout.presentationScope,
          title: window.getTitle(),
        }) === true;
      if (!registered) return false;
      hostIdByWindowId.set(window.id, layout.hostId);
      hostOwnerWindowIdByHostId.set(layout.hostId, window.id);
      return true;
    }

    function reconcileNativeState(): void {
      if (!ensureContentHostStarted()) return;
      const focusedWindow = options.getFocusedWindow();
      if (focusedWindow && !focusedWindow.isDestroyed()) {
        const layout = hostLayoutByWindowId.get(focusedWindow.id);
        if (layout && hostIdByWindowId.get(focusedWindow.id) !== layout.hostId) {
          registerWindowHost(focusedWindow, layout);
        }
      }

      const surfaceSuppressedThreadIds = new Set<string>();
      for (const threadId of activeThreadByWindowId.values()) {
        if (options.isThreadSurfacePresented?.(threadId) === true) {
          surfaceSuppressedThreadIds.add(threadId);
        }
      }
      const suppressedThreadIds = new Set([...hiddenThreadIds, ...surfaceSuppressedThreadIds]);
      options.addon?.setRemoteHostedPIPContentSuppressedThreadIDs([...suppressedThreadIds].sort());

      const focusedThreadId = focusedWindow
        ? (activeThreadByWindowId.get(focusedWindow.id) ?? null)
        : null;
      const hostRegistered = focusedWindow ? hostIdByWindowId.has(focusedWindow.id) : false;
      const nextSelectedThreadId =
        hostRegistered && focusedThreadId && !surfaceSuppressedThreadIds.has(focusedThreadId)
          ? focusedThreadId
          : null;
      const previousSelectedThreadId = selectedThreadId;
      if (previousSelectedThreadId !== nextSelectedThreadId) {
        selectedThreadId = nextSelectedThreadId;
        options.addon?.setRemoteHostedPIPContentActiveThreadID(nextSelectedThreadId);
        if (previousSelectedThreadId) publishStreamState(previousSelectedThreadId, false);
      }
      pollNativePresentationState();
    }

    function removeWindow(windowId: number): void {
      const tracked = trackedWindows.get(windowId);
      if (!tracked) return;
      trackedWindows.delete(windowId);
      tracked.window.removeListener("focus", tracked.onFocus);
      tracked.window.removeListener("closed", tracked.onClosed);
      tracked.sender.removeListener("destroyed", tracked.onDestroyed);
      activeThreadByWindowId.delete(windowId);
      hostLayoutByWindowId.delete(windowId);
      unregisterWindowHost(windowId);
      reconcileNativeState();
    }

    function trackSender(sender: RemoteHostedPipWebContentsLike): RemoteHostedPipWindowLike | null {
      if (!accepting) return null;
      const window = options.getWindowForSender(sender);
      if (!window || window.isDestroyed()) return null;
      if (!trackedWindows.has(window.id)) {
        const onFocus = () => reconcileNativeState();
        const onClosed = () => removeWindow(window.id);
        const onDestroyed = () => removeWindow(window.id);
        trackedWindows.set(window.id, { onClosed, onDestroyed, onFocus, sender, window });
        window.on("focus", onFocus);
        window.once("closed", onClosed);
        sender.once("destroyed", onDestroyed);
      }
      sendHiddenThreadIdsRequested(sender);
      return window;
    }

    function setHostLayout(
      window: RemoteHostedPipWindowLike,
      layout: RemoteHostedPipHostLayout,
    ): void {
      if (layout.anchorRect === null || layout.anchors === null) {
        hostLayoutByWindowId.delete(window.id);
        unregisterWindowHost(window.id);
        reconcileNativeState();
        return;
      }
      hostLayoutByWindowId.set(window.id, layout);
      if (window.isFocused()) registerWindowHost(window, layout);
      reconcileNativeState();
    }

    function setHiddenThreadIds(threadIds: readonly string[]): void {
      hiddenThreadIds.clear();
      for (const threadId of threadIds) {
        const normalized = threadId.trim();
        if (normalized) hiddenThreadIds.add(normalized);
      }
      broadcastHiddenThreadIdsRequested();
      reconcileNativeState();
    }

    function invalidateBrowserUseSession(sessionId: string): void {
      const session = browserUsePipSessions.get(sessionId);
      if (!session) return;
      for (const presentationId of session.presentationIdsByTabId.values()) {
        options.addon?.invalidateBrowserUsePIPContent(presentationId);
      }
      browserUsePipSessions.delete(sessionId);
      pollNativePresentationState();
    }

    function invalidateBrowserUseThread(threadId: string): void {
      for (const [sessionId, session] of browserUsePipSessions) {
        if (session.threadId === threadId) invalidateBrowserUseSession(sessionId);
      }
      options.addon?.completeRemoteHostedPIPContentThread(threadId);
      pollNativePresentationState();
    }

    function handleDesktopMessageFromView(
      sender: RemoteHostedPipWebContentsLike,
      message: CodexDesktopMessageFromView,
    ): void {
      const window = trackSender(sender);
      if (!window) return;
      switch (message.type) {
        case "remote-hosted-pip-active-thread-changed":
          if (message.conversationId === null) activeThreadByWindowId.delete(window.id);
          else activeThreadByWindowId.set(window.id, message.conversationId);
          reconcileNativeState();
          return;
        case "remote-hosted-pip-hidden-thread-ids-changed":
          setHiddenThreadIds(message.hiddenThreadIds);
          return;
        case "remote-hosted-pip-host-layout-changed":
          setHostLayout(window, message.layout);
          return;
      }
    }

    function handleCodexNotification(notification: unknown): void {
      if (!accepting) return;
      const event = parseRemoteHostedPipNotification(notification);
      if (!event || !ensureContentHostStarted()) return;
      if (event.kind === "thread-ended") {
        invalidateBrowserUseThread(event.threadId);
        return;
      }
      if (event.kind === "turn-ended") {
        if (event.completed) options.addon?.completeRemoteHostedPIPContentThread(event.threadId);
        else options.addon?.invalidateRemoteHostedPIPContentTurn(event.threadId, event.turnId);
        pollNativePresentationState();
        return;
      }

      const sessionId = JSON.stringify([event.threadId, event.surface.browserId]);
      if (event.surface.sessionEnded === true) {
        invalidateBrowserUseSession(sessionId);
        return;
      }

      let session = browserUsePipSessions.get(sessionId);
      if (event.surface.screenshot) {
        const { screenshot } = event.surface;
        const presentationId = `browser:${JSON.stringify([
          event.threadId,
          event.surface.browserId,
          screenshot.tabId,
        ])}`;
        const inserted =
          options.addon?.upsertBrowserUsePIPContent(
            presentationId,
            event.threadId,
            screenshot.url,
            null,
          ) === true;
        if (inserted) {
          session ??= { presentationIdsByTabId: new Map(), threadId: event.threadId };
          session.presentationIdsByTabId.set(screenshot.tabId, presentationId);
          browserUsePipSessions.set(sessionId, session);
        }
      }

      if (event.surface.openTabIds && session) {
        const openTabIds = new Set(event.surface.openTabIds);
        for (const [tabId, presentationId] of session.presentationIdsByTabId) {
          if (openTabIds.has(tabId)) continue;
          options.addon?.invalidateBrowserUsePIPContent(presentationId);
          session.presentationIdsByTabId.delete(tabId);
        }
        if (session.presentationIdsByTabId.size === 0) browserUsePipSessions.delete(sessionId);
      }
      reconcileNativeState();
      pollNativePresentationState();
    }

    function setAlwaysHide(value: boolean): void {
      if (!accepting) return;
      alwaysHide = value;
      options.writeAlwaysHide?.(value);
      if (contentHostStarted) options.addon?.refreshRemoteHostedPIPContentVisibility();
      reconcileNativeState();
    }

    const releaseBestEffort = (release: () => unknown): void => {
      try {
        release();
      } catch {
        // One broken native/window lease must not prevent the remaining graph from releasing.
      }
    };

    function release(): void {
      if (!accepting) return;
      accepting = false;
      for (const windowId of [...trackedWindows.keys()]) {
        releaseBestEffort(() => removeWindow(windowId));
      }
      for (const sessionId of [...browserUsePipSessions.keys()]) {
        releaseBestEffort(() => invalidateBrowserUseSession(sessionId));
      }
      for (const hostId of new Set(hostIdByWindowId.values())) {
        releaseBestEffort(() => options.addon?.unregisterRemoteHostedPIPContentHost(hostId));
      }
      hostIdByWindowId.clear();
      hostOwnerWindowIdByHostId.clear();
      releaseBestEffort(() =>
        options.addon?.setRemoteHostedPIPContentVisibilityRequestHandler(null),
      );
      releaseBestEffort(() =>
        options.addon?.setRemoteHostedPIPContentMaxDisplaySizeChangedHandler(null),
      );
      releaseBestEffort(() =>
        options.addon?.setRemoteHostedPIPContentComputerUseCursorLocationHandler(null),
      );
      releaseBestEffort(() => options.addon?.setRemoteHostedPIPContentPetWakeRequestHandler(null));
      releaseBestEffort(() => options.addon?.setRemoteHostedPIPContentShouldShowTaskHandler(null));
      if (contentHostStarted) {
        releaseBestEffort(() => options.addon?.stopRemoteHostedPIPContentHost());
      }
      contentHostStarted = false;
      selectedThreadId = null;
      activeThreadByWindowId.clear();
      browserUsePipSessions.clear();
      hiddenThreadIds.clear();
      hostLayoutByWindowId.clear();
      publishedStreamStateByConversationId.clear();
      trackedWindows.clear();
    }

    yield* Effect.addFinalizer(() => Effect.sync(release));

    return {
      getAlwaysHide: () => alwaysHide,
      getHiddenThreadIds,
      handleBrowserUseStateSnapshot: reconcileNativeState,
      handleCodexNotification,
      handleDesktopMessageFromView,
      isPrivacySettingsTerminationRequest: () => {
        if (!accepting) return false;
        try {
          return options.addon?.isPrivacySettingsTerminationRequest() === true;
        } catch {
          return false;
        }
      },
      pollNativePresentationState,
      setAlwaysHide,
    };
  });
