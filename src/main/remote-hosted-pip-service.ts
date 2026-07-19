import type {
  BrowserSidebarBrowserUseStateSnapshot,
  BrowserUseTabState,
} from "../shared/browser-sidebar";
import { makeBrowserSidebarTabKey } from "../shared/browser-sidebar";
import type { IpcEvents } from "../shared/ipc-api";
import type {
  CodexDesktopMessageFromView,
  RemoteHostedPipHostLayout,
  RemoteHostedPipStreamStateChangedMessage,
} from "../shared/remote-hosted-pip";

export interface RemoteHostedPipWebContentsLike {
  id: number;
  once(eventName: "destroyed", listener: () => void): void;
}

type RemoteHostedPipMessageChannel =
  | "remote-hosted-pip-stream-state-changed"
  | "remote-hosted-pip-visibility-requested";

interface RemoteHostedPipServiceDeps {
  broadcast: <Channel extends RemoteHostedPipMessageChannel>(
    channel: Channel,
    payload: IpcEvents[Channel],
  ) => void;
  resolveThreadIdForSession: (sessionId: string) => Promise<string | null>;
  sendToSender: <Channel extends RemoteHostedPipMessageChannel>(
    sender: RemoteHostedPipWebContentsLike,
    channel: Channel,
    payload: IpcEvents[Channel],
  ) => void;
}

interface BrowserUsePipSource {
  conversationId: string;
  sourceId: string;
}

interface PublishedStreamState {
  isActive: boolean;
  isAnyActive: boolean;
}

export class RemoteHostedPipService {
  private readonly activeSourceConversationIdBySourceId = new Map<string, string>();
  private readonly activeThreadBySender = new Map<number, string | null>();
  private readonly hostLayoutsBySender = new Map<number, RemoteHostedPipHostLayout>();
  private readonly publishedStreamStateByConversationId = new Map<string, PublishedStreamState>();
  private readonly trackedSenderIds = new Set<number>();
  private browserUseSnapshotGeneration = 0;
  private isVisible = true;

  constructor(private readonly deps: RemoteHostedPipServiceDeps) {}

  handleDesktopMessageFromView(
    sender: RemoteHostedPipWebContentsLike,
    message: CodexDesktopMessageFromView,
  ): void {
    this.trackSender(sender);

    switch (message.type) {
      case "remote-hosted-pip-active-thread-changed": {
        this.setActiveThreadForSender(sender, message.conversationId);
        return;
      }
      case "remote-hosted-pip-host-layout-changed": {
        this.setHostLayoutForSender(sender, message.layout);
        return;
      }
      case "remote-hosted-pip-visibility-changed": {
        this.setVisible(message.isVisible);
        return;
      }
    }
  }

  async handleBrowserUseStateSnapshot(
    snapshot: BrowserSidebarBrowserUseStateSnapshot,
  ): Promise<void> {
    const generation = ++this.browserUseSnapshotGeneration;
    const previousConversationIds = new Set(this.activeSourceConversationIdBySourceId.values());
    const previousAnyActive = this.hasAnyActiveSource();
    const nextSources = await this.resolveBrowserUsePipSources(snapshot);
    if (generation !== this.browserUseSnapshotGeneration) return;

    this.activeSourceConversationIdBySourceId.clear();
    for (const source of nextSources) {
      this.activeSourceConversationIdBySourceId.set(source.sourceId, source.conversationId);
    }

    const nextConversationIds = new Set(this.activeSourceConversationIdBySourceId.values());
    const nextAnyActive = this.hasAnyActiveSource();
    const conversationIdsToPublish = new Set([
      ...previousConversationIds,
      ...nextConversationIds,
    ]);
    if (previousAnyActive !== nextAnyActive) {
      for (const conversationId of this.publishedStreamStateByConversationId.keys()) {
        conversationIdsToPublish.add(conversationId);
      }
      for (const conversationId of this.activeThreadBySender.values()) {
        if (conversationId) conversationIdsToPublish.add(conversationId);
      }
    }

    for (const conversationId of conversationIdsToPublish) {
      this.broadcastStreamState(conversationId);
    }
  }

  getBrowserUsePipConversationIds(): string[] {
    return [...new Set(this.activeSourceConversationIdBySourceId.values())].sort();
  }

  private trackSender(sender: RemoteHostedPipWebContentsLike): void {
    const senderId = sender.id;
    if (this.trackedSenderIds.has(senderId)) return;

    this.trackedSenderIds.add(senderId);
    this.sendVisibilityRequested(sender);
    sender.once("destroyed", () => {
      this.activeThreadBySender.delete(senderId);
      this.hostLayoutsBySender.delete(senderId);
      this.trackedSenderIds.delete(senderId);
    });
  }

  private setActiveThreadForSender(
    sender: RemoteHostedPipWebContentsLike,
    conversationId: string | null,
  ): void {
    if (conversationId === null) {
      this.activeThreadBySender.delete(sender.id);
      return;
    }

    this.activeThreadBySender.set(sender.id, conversationId);
    this.sendStreamState(sender, conversationId);
  }

  private setHostLayoutForSender(
    sender: RemoteHostedPipWebContentsLike,
    layout: RemoteHostedPipHostLayout,
  ): void {
    if (layout.anchorRect === null || layout.anchors === null) {
      this.hostLayoutsBySender.delete(sender.id);
      return;
    }

    this.hostLayoutsBySender.set(sender.id, layout);
  }

  private setVisible(isVisible: boolean): void {
    this.isVisible = isVisible;
    this.deps.broadcast("remote-hosted-pip-visibility-requested", {
      type: "remote-hosted-pip-visibility-requested",
      isVisible,
    });
  }

  private async resolveBrowserUsePipSources(
    snapshot: BrowserSidebarBrowserUseStateSnapshot,
  ): Promise<BrowserUsePipSource[]> {
    const sources = await Promise.all(
      snapshot.tabs.map(async (tab) => await this.resolveBrowserUsePipSource(tab)),
    );
    return sources.filter((source): source is BrowserUsePipSource => source !== null);
  }

  private async resolveBrowserUsePipSource(
    tab: BrowserUseTabState,
  ): Promise<BrowserUsePipSource | null> {
    if (tab.released) return null;
    if (!tab.captureActive) return null;
    if (tab.webContentsId === null) return null;
    const conversationId = await this.deps.resolveThreadIdForSession(
      tab.browserConversationId,
    );
    if (!conversationId) return null;

    return {
      conversationId,
      sourceId: `browser-use:${makeBrowserSidebarTabKey(tab)}`,
    };
  }

  private sendVisibilityRequested(sender: RemoteHostedPipWebContentsLike): void {
    this.deps.sendToSender(sender, "remote-hosted-pip-visibility-requested", {
      type: "remote-hosted-pip-visibility-requested",
      isVisible: this.isVisible,
    });
  }

  private sendStreamState(
    sender: RemoteHostedPipWebContentsLike,
    conversationId: string,
  ): void {
    this.deps.sendToSender(
      sender,
      "remote-hosted-pip-stream-state-changed",
      this.buildStreamStateMessage(conversationId),
    );
  }

  private broadcastStreamState(conversationId: string): void {
    const nextState = this.buildPublishedStreamState(conversationId);
    const previousState = this.publishedStreamStateByConversationId.get(conversationId);
    if (
      previousState?.isActive === nextState.isActive
      && previousState.isAnyActive === nextState.isAnyActive
    ) {
      return;
    }

    this.publishedStreamStateByConversationId.set(conversationId, nextState);
    this.deps.broadcast(
      "remote-hosted-pip-stream-state-changed",
      this.buildStreamStateMessage(conversationId, nextState),
    );
  }

  private buildStreamStateMessage(
    conversationId: string,
    state = this.buildPublishedStreamState(conversationId),
  ): RemoteHostedPipStreamStateChangedMessage {
    return {
      type: "remote-hosted-pip-stream-state-changed",
      conversationId,
      isActive: state.isActive,
      isAnyActive: state.isAnyActive,
    };
  }

  private buildPublishedStreamState(conversationId: string): PublishedStreamState {
    return {
      isActive: this.isConversationActive(conversationId),
      isAnyActive: this.hasAnyActiveSource(),
    };
  }

  private isConversationActive(conversationId: string): boolean {
    for (const activeConversationId of this.activeSourceConversationIdBySourceId.values()) {
      if (activeConversationId === conversationId) return true;
    }
    return false;
  }

  private hasAnyActiveSource(): boolean {
    return this.activeSourceConversationIdBySourceId.size > 0;
  }
}
