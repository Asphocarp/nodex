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

    const affectedConversationIds: string[] = [];
    for (const conversationId of this.viewsByConversationId.keys()) {
      if (!this.removeView(conversationId, normalizedClientId)) continue;
      affectedConversationIds.push(conversationId);
    }
    return affectedConversationIds;
  }

  clearConversation(conversationId: string): void {
    this.viewsByConversationId.delete(conversationId.trim());
  }

  private removeView(conversationId: string, clientId: string): boolean {
    const views = this.viewsByConversationId.get(conversationId);
    if (!views?.delete(clientId)) return false;
    if (views.size === 0) this.viewsByConversationId.delete(conversationId);
    return true;
  }
}
