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
  private readonly foregroundClientIds = new Set<string>();
  private readonly presentedClientIdsByConversationId = new Map<
    string,
    Set<string>
  >();
  private readonly viewsByConversationId = new Map<
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
    return this.presentedClientIdsByConversationId
      .get(conversationId.trim())
      ?.has(clientId.trim()) === true;
  }

  setPresented(
    conversationId: string,
    clientId: string,
    presented: boolean,
  ): void {
    const normalizedConversationId = conversationId.trim();
    const normalizedClientId = clientId.trim();
    if (!normalizedConversationId || !normalizedClientId) return;

    if (!presented) {
      const presentedClientIds = this.presentedClientIdsByConversationId.get(
        normalizedConversationId,
      );
      if (!presentedClientIds?.delete(normalizedClientId)) return;
      if (presentedClientIds.size === 0) {
        this.presentedClientIdsByConversationId.delete(normalizedConversationId);
      }
      return;
    }

    const presentedClientIds = this.presentedClientIdsByConversationId.get(
      normalizedConversationId,
    ) ?? new Set<string>();
    presentedClientIds.add(normalizedClientId);
    this.presentedClientIdsByConversationId.set(
      normalizedConversationId,
      presentedClientIds,
    );
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
      const [conversationId, clientIds]
      of this.presentedClientIdsByConversationId
    ) {
      if (clientIds.has(normalizedClientId)) {
        affectedConversationIds.push(conversationId);
      }
    }
    return affectedConversationIds;
  }

  isPresentedInForeground(conversationId: string): boolean {
    const clientIds = this.presentedClientIdsByConversationId.get(
      conversationId.trim(),
    );
    if (!clientIds) return false;
    for (const clientId of clientIds) {
      if (this.foregroundClientIds.has(clientId)) return true;
    }
    return false;
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
      const [conversationId, clientIds]
      of this.presentedClientIdsByConversationId
    ) {
      if (!clientIds.delete(normalizedClientId)) continue;
      affectedConversationIds.add(conversationId);
      if (clientIds.size === 0) {
        this.presentedClientIdsByConversationId.delete(conversationId);
      }
    }
    return [...affectedConversationIds];
  }

  clearConversation(conversationId: string): void {
    const normalizedConversationId = conversationId.trim();
    this.viewsByConversationId.delete(normalizedConversationId);
    this.presentedClientIdsByConversationId.delete(normalizedConversationId);
  }

  private removeView(conversationId: string, clientId: string): boolean {
    const views = this.viewsByConversationId.get(conversationId);
    if (!views?.delete(clientId)) return false;
    if (views.size === 0) this.viewsByConversationId.delete(conversationId);
    return true;
  }
}
