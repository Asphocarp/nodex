interface ActiveRendererView {
  readonly clientId: string;
  readonly activationOrder: number;
}

/**
 * Tracks which renderer clients are currently presenting a conversation.
 *
 * This is intentionally independent from conversation stream ownership. A
 * main-owned or follower-rendered conversation can still present local UI such
 * as a Nodex authorization request without becoming the canonical state owner.
 */
export class CodexRendererViewRegistry {
  private activationOrder = 0;
  private presentationOrder = 0;
  private readonly foregroundClientIds = new Set<string>();
  private readonly presentedSurfaceIdsByConversationAndClient = new Map<
    string,
    Map<string, Set<string>>
  >();
  private readonly viewsByConversationId = new Map<
    string,
    Map<string, ActiveRendererView>
  >();
  private readonly presentedViewsByConversationId = new Map<
    string,
    Map<string, ActiveRendererView>
  >();

  setActive(conversationId: string, clientId: string, active: boolean): void {
    const normalizedConversationId = conversationId.trim();
    const normalizedClientId = clientId.trim();
    if (!normalizedConversationId || !normalizedClientId) return;

    if (!active) {
      this.removeView(normalizedConversationId, normalizedClientId);
      return;
    }

    const views = this.viewsByConversationId.get(normalizedConversationId)
      ?? new Map<string, ActiveRendererView>();
    this.activationOrder += 1;
    views.set(normalizedClientId, {
      clientId: normalizedClientId,
      activationOrder: this.activationOrder,
    });
    this.viewsByConversationId.set(normalizedConversationId, views);
  }

  hasActiveView(conversationId: string): boolean {
    return (this.viewsByConversationId.get(conversationId.trim())?.size ?? 0) > 0;
  }

  isClientPresenting(conversationId: string, clientId: string): boolean {
    return this.presentedSurfaceIdsByConversationAndClient
      .get(conversationId.trim())
      ?.has(clientId.trim()) === true;
  }

  setPresented(
    conversationId: string,
    clientId: string,
    surfaceId: string,
    presented: boolean,
  ): void {
    const normalizedConversationId = conversationId.trim();
    const normalizedClientId = clientId.trim();
    const normalizedSurfaceId = surfaceId.trim();
    if (!normalizedConversationId || !normalizedClientId || !normalizedSurfaceId) return;

    if (!presented) {
      const surfacesByClient = this.presentedSurfaceIdsByConversationAndClient.get(
        normalizedConversationId,
      );
      const surfaceIds = surfacesByClient?.get(normalizedClientId);
      if (!surfaceIds?.delete(normalizedSurfaceId)) return;
      if (surfaceIds.size === 0) {
        surfacesByClient?.delete(normalizedClientId);
        this.removePresentedView(normalizedConversationId, normalizedClientId);
      }
      if (surfacesByClient?.size === 0) {
        this.presentedSurfaceIdsByConversationAndClient.delete(normalizedConversationId);
      }
      return;
    }

    const surfacesByClient = this.presentedSurfaceIdsByConversationAndClient.get(
      normalizedConversationId,
    ) ?? new Map<string, Set<string>>();
    const surfaceIds = surfacesByClient.get(normalizedClientId) ?? new Set<string>();
    const wasClientPresented = surfaceIds.size > 0;
    surfaceIds.add(normalizedSurfaceId);
    surfacesByClient.set(normalizedClientId, surfaceIds);
    this.presentedSurfaceIdsByConversationAndClient.set(
      normalizedConversationId,
      surfacesByClient,
    );
    if (!wasClientPresented) {
      const presentedViews = this.presentedViewsByConversationId.get(
        normalizedConversationId,
      ) ?? new Map<string, ActiveRendererView>();
      this.presentationOrder += 1;
      presentedViews.set(normalizedClientId, {
        clientId: normalizedClientId,
        activationOrder: this.presentationOrder,
      });
      this.presentedViewsByConversationId.set(
        normalizedConversationId,
        presentedViews,
      );
    }
  }

  setClientForegrounded(clientId: string, foregrounded: boolean): string[] {
    const normalizedClientId = clientId.trim();
    if (!normalizedClientId) return [];

    if (foregrounded) {
      this.foregroundClientIds.add(normalizedClientId);
    } else {
      this.foregroundClientIds.delete(normalizedClientId);
    }

    const affectedConversationIds: string[] = [];
    for (
      const [conversationId, surfacesByClient]
      of this.presentedSurfaceIdsByConversationAndClient
    ) {
      if (surfacesByClient.has(normalizedClientId)) {
        affectedConversationIds.push(conversationId);
      }
    }
    return affectedConversationIds;
  }

  isPresentedInForeground(conversationId: string): boolean {
    const surfacesByClient = this.presentedSurfaceIdsByConversationAndClient.get(
      conversationId.trim(),
    );
    if (!surfacesByClient) return false;
    for (const clientId of surfacesByClient.keys()) {
      if (this.foregroundClientIds.has(clientId)) return true;
    }
    return false;
  }

  hasForegroundClient(): boolean {
    return this.foregroundClientIds.size > 0;
  }

  resolvePresentationClient(conversationId: string): string | null {
    const views = this.viewsByConversationId.get(conversationId.trim());
    if (!views) return null;

    let latest: ActiveRendererView | null = null;
    for (const view of views.values()) {
      if (!latest || view.activationOrder > latest.activationOrder) {
        latest = view;
      }
    }
    return latest?.clientId ?? null;
  }

  resolvePresentedSurfaceClient(conversationId: string): string | null {
    const views = this.presentedViewsByConversationId.get(conversationId.trim());
    if (!views) return null;

    let latest: ActiveRendererView | null = null;
    for (const view of views.values()) {
      if (!latest || view.activationOrder > latest.activationOrder) {
        latest = view;
      }
    }
    return latest?.clientId ?? null;
  }

  removeClient(clientId: string): string[] {
    const normalizedClientId = clientId.trim();
    if (!normalizedClientId) return [];
    this.foregroundClientIds.delete(normalizedClientId);

    const affectedConversationIds = new Set<string>();
    for (const conversationId of this.viewsByConversationId.keys()) {
      if (!this.removeView(conversationId, normalizedClientId)) continue;
      affectedConversationIds.add(conversationId);
    }
    for (
      const [conversationId, surfacesByClient]
      of this.presentedSurfaceIdsByConversationAndClient
    ) {
      if (!surfacesByClient.delete(normalizedClientId)) continue;
      affectedConversationIds.add(conversationId);
      this.removePresentedView(conversationId, normalizedClientId);
      if (surfacesByClient.size === 0) {
        this.presentedSurfaceIdsByConversationAndClient.delete(conversationId);
      }
    }
    return [...affectedConversationIds];
  }

  clearConversation(conversationId: string): void {
    const normalizedConversationId = conversationId.trim();
    this.viewsByConversationId.delete(normalizedConversationId);
    this.presentedSurfaceIdsByConversationAndClient.delete(normalizedConversationId);
    this.presentedViewsByConversationId.delete(normalizedConversationId);
  }

  private removeView(conversationId: string, clientId: string): boolean {
    const views = this.viewsByConversationId.get(conversationId);
    if (!views?.delete(clientId)) return false;
    if (views.size === 0) this.viewsByConversationId.delete(conversationId);
    return true;
  }

  private removePresentedView(conversationId: string, clientId: string): void {
    const views = this.presentedViewsByConversationId.get(conversationId);
    if (!views?.delete(clientId)) return;
    if (views.size === 0) this.presentedViewsByConversationId.delete(conversationId);
  }
}
