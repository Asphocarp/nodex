import { randomUUID } from "node:crypto";
import {
  makeBrowserSidebarTabKey,
  type BrowserSidebarHostRouteIdentity,
  type BrowserSidebarTabIdentity,
  type BrowserSidebarWebviewHostKind,
} from "../../shared/browser-sidebar";

export type BrowserPagePersistence = "durable" | "browser-use";

export interface BrowserRendererSessionRegistration {
  browserViewScopeId: string;
  ownerWebContentsId: number;
  rendererInstanceId: string;
}

export interface BrowserHostRegistration extends BrowserSidebarTabIdentity {
  browserStorageId: string;
  hostGeneration: number;
  hostKind: BrowserSidebarWebviewHostKind;
  mountGeneration: number;
  pagePersistence: BrowserPagePersistence;
  rendererInstanceId: string;
}

export interface BrowserAttachmentRoute
extends BrowserSidebarHostRouteIdentity {
  browserStorageId: string;
}

export interface BrowserAuthorizedAttachment extends BrowserAttachmentRoute {
  attachToken: string;
  ownerWebContentsId: number;
}

export interface BrowserAttachedGuestOwnership extends BrowserAttachmentRoute {
  guestWebContentsId: number;
  ownerWebContentsId: number;
}

export type BrowserHostRegistrationResult =
  | { ok: true; registration: BrowserHostRegistration }
  | {
      ok: false;
      reason:
        | "generation-stale"
        | "owned-by-another-window"
        | "renderer-session-missing"
        | "renderer-session-mismatch";
    };

export type BrowserAttachmentAuthorizationResult =
  | { ok: true; authorization: BrowserAuthorizedAttachment }
  | {
      ok: false;
      reason:
        | "host-missing"
        | "host-mismatch"
        | "pending-teardown"
        | "renderer-session-missing";
    };

export type BrowserHostRouteMatchResult =
  | { ok: true; registration: BrowserHostRegistration }
  | {
      ok: false;
      reason:
        | "host-missing"
        | "host-mismatch"
        | "renderer-session-missing";
    };

interface StoredRendererSession extends BrowserRendererSessionRegistration {
  registeredAt: number;
}

interface StoredHostRegistration extends BrowserHostRegistration {
  ownerWebContentsId: number;
  pendingTeardown: boolean;
  registeredAt: number;
}

interface BrowserRuntimeRegistryOptions {
  now?: () => number;
  tokenFactory?: () => string;
}

function isSameHostRoute(
  left: BrowserAttachmentRoute,
  right: BrowserSidebarHostRouteIdentity,
): boolean {
  return left.browserConversationId === right.browserConversationId
    && left.browserViewScopeId === right.browserViewScopeId
    && left.browserTabId === right.browserTabId
    && left.rendererInstanceId === right.rendererInstanceId
    && left.hostGeneration === right.hostGeneration
    && left.mountGeneration === right.mountGeneration;
}

export class BrowserRuntimeRegistry {
  private readonly rendererSessions = new Map<string, StoredRendererSession>();
  private readonly rendererInstanceIdByOwner = new Map<number, string>();
  private readonly hosts = new Map<string, StoredHostRegistration>();
  private readonly hostKeyByStorageId = new Map<string, string>();
  private readonly pendingAttachments =
    new Map<string, BrowserAuthorizedAttachment>();
  private readonly guestOwnership =
    new Map<number, BrowserAttachedGuestOwnership>();
  private readonly now: () => number;
  private readonly tokenFactory: () => string;

  constructor(options: BrowserRuntimeRegistryOptions = {}) {
    this.now = options.now ?? Date.now;
    this.tokenFactory = options.tokenFactory ?? randomUUID;
  }

  registerRendererSession(
    input: BrowserRendererSessionRegistration,
  ): BrowserRendererSessionRegistration {
    const existingById = this.rendererSessions.get(input.rendererInstanceId);
    if (
      existingById
      && (
        existingById.ownerWebContentsId !== input.ownerWebContentsId
        || existingById.browserViewScopeId !== input.browserViewScopeId
      )
    ) {
      throw new Error("Renderer instance is already bound to another window");
    }

    const previousRendererId = this.rendererInstanceIdByOwner.get(
      input.ownerWebContentsId,
    );
    if (previousRendererId && previousRendererId !== input.rendererInstanceId) {
      this.releaseRendererSession(previousRendererId);
    }
    this.rendererSessions.set(input.rendererInstanceId, {
      ...input,
      registeredAt: this.now(),
    });
    this.rendererInstanceIdByOwner.set(
      input.ownerWebContentsId,
      input.rendererInstanceId,
    );
    return input;
  }

  registerHost(
    ownerWebContentsId: number,
    input: BrowserHostRegistration,
  ): BrowserHostRegistrationResult {
    const rendererSession = this.rendererSessions.get(input.rendererInstanceId);
    if (!rendererSession) {
      return { ok: false, reason: "renderer-session-missing" };
    }
    if (
      rendererSession.ownerWebContentsId !== ownerWebContentsId
      || rendererSession.browserViewScopeId !== input.browserViewScopeId
    ) {
      return { ok: false, reason: "renderer-session-mismatch" };
    }

    const key = makeBrowserSidebarTabKey(input);
    const storageOwnerKey = this.hostKeyByStorageId.get(input.browserStorageId);
    if (storageOwnerKey && storageOwnerKey !== key) {
      return { ok: false, reason: "owned-by-another-window" };
    }
    const current = this.hosts.get(key);
    if (current && input.hostGeneration < current.hostGeneration) {
      return { ok: false, reason: "generation-stale" };
    }
    if (
      current
      && input.hostGeneration === current.hostGeneration
      && (
        input.rendererInstanceId !== current.rendererInstanceId
        || input.mountGeneration < current.mountGeneration
        || input.browserStorageId !== current.browserStorageId
      )
    ) {
      return { ok: false, reason: "generation-stale" };
    }

    const registration: StoredHostRegistration = {
      ...input,
      ownerWebContentsId,
      pendingTeardown: false,
      registeredAt: this.now(),
    };
    this.hosts.set(key, registration);
    this.hostKeyByStorageId.set(input.browserStorageId, key);
    return { ok: true, registration: input };
  }

  matchHost(
    ownerWebContentsId: number,
    input: BrowserSidebarHostRouteIdentity,
  ): BrowserHostRouteMatchResult {
    const rendererSession = this.rendererSessions.get(input.rendererInstanceId);
    if (
      !rendererSession
      || rendererSession.ownerWebContentsId !== ownerWebContentsId
    ) {
      return { ok: false, reason: "renderer-session-missing" };
    }
    const host = this.hosts.get(makeBrowserSidebarTabKey(input));
    if (!host) return { ok: false, reason: "host-missing" };
    if (
      host.ownerWebContentsId !== ownerWebContentsId
      || !isSameHostRoute(host, input)
    ) {
      return { ok: false, reason: "host-mismatch" };
    }
    return { ok: true, registration: host };
  }

  authorizeAttachment(
    ownerWebContentsId: number,
    input: BrowserSidebarHostRouteIdentity,
  ): BrowserAttachmentAuthorizationResult {
    const rendererSession = this.rendererSessions.get(input.rendererInstanceId);
    if (
      !rendererSession
      || rendererSession.ownerWebContentsId !== ownerWebContentsId
    ) {
      return { ok: false, reason: "renderer-session-missing" };
    }
    const host = this.hosts.get(makeBrowserSidebarTabKey(input));
    if (!host) return { ok: false, reason: "host-missing" };
    if (host.pendingTeardown) {
      return { ok: false, reason: "pending-teardown" };
    }
    if (
      host.ownerWebContentsId !== ownerWebContentsId
      || !isSameHostRoute(host, input)
    ) {
      return { ok: false, reason: "host-mismatch" };
    }

    const attachToken = this.tokenFactory();
    const authorization: BrowserAuthorizedAttachment = {
      ...host,
      attachToken,
      ownerWebContentsId,
    };
    this.pendingAttachments.set(attachToken, authorization);
    return { ok: true, authorization };
  }

  consumeAuthorizedAttachment(
    attachToken: string,
    ownerWebContentsId: number,
    guestWebContentsId: number,
  ): BrowserAttachedGuestOwnership | null {
    const authorization = this.pendingAttachments.get(attachToken);
    this.pendingAttachments.delete(attachToken);
    if (
      !authorization
      || authorization.ownerWebContentsId !== ownerWebContentsId
    ) {
      return null;
    }
    const ownership: BrowserAttachedGuestOwnership = {
      ...authorization,
      guestWebContentsId,
    };
    this.guestOwnership.set(guestWebContentsId, ownership);
    return ownership;
  }

  revokeAuthorizedAttachment(attachToken: string): void {
    this.pendingAttachments.delete(attachToken);
  }

  getGuestOwnership(
    guestWebContentsId: number,
  ): BrowserAttachedGuestOwnership | null {
    return this.guestOwnership.get(guestWebContentsId) ?? null;
  }

  markPendingTeardown(
    identity: BrowserSidebarTabIdentity,
    pending: boolean,
  ): void {
    const key = makeBrowserSidebarTabKey(identity);
    const host = this.hosts.get(key);
    if (!host) return;
    this.hosts.set(key, { ...host, pendingTeardown: pending });
  }

  releaseGuest(guestWebContentsId: number): void {
    this.guestOwnership.delete(guestWebContentsId);
  }

  releaseHost(identity: BrowserSidebarTabIdentity): void {
    const key = makeBrowserSidebarTabKey(identity);
    const host = this.hosts.get(key);
    if (!host) return;
    this.hosts.delete(key);
    if (this.hostKeyByStorageId.get(host.browserStorageId) === key) {
      this.hostKeyByStorageId.delete(host.browserStorageId);
    }
    for (const [token, pending] of this.pendingAttachments) {
      if (makeBrowserSidebarTabKey(pending) === key) {
        this.pendingAttachments.delete(token);
      }
    }
  }

  releaseOwner(ownerWebContentsId: number): void {
    const rendererInstanceId =
      this.rendererInstanceIdByOwner.get(ownerWebContentsId);
    if (rendererInstanceId) this.releaseRendererSession(rendererInstanceId);
    for (const [guestId, ownership] of this.guestOwnership) {
      if (ownership.ownerWebContentsId === ownerWebContentsId) {
        this.guestOwnership.delete(guestId);
      }
    }
  }

  getDiagnosticSnapshot(): {
    guests: number;
    hosts: number;
    pendingAttachments: number;
    rendererSessions: number;
  } {
    return {
      guests: this.guestOwnership.size,
      hosts: this.hosts.size,
      pendingAttachments: this.pendingAttachments.size,
      rendererSessions: this.rendererSessions.size,
    };
  }

  private releaseRendererSession(rendererInstanceId: string): void {
    const renderer = this.rendererSessions.get(rendererInstanceId);
    if (!renderer) return;
    this.rendererSessions.delete(rendererInstanceId);
    if (
      this.rendererInstanceIdByOwner.get(renderer.ownerWebContentsId)
      === rendererInstanceId
    ) {
      this.rendererInstanceIdByOwner.delete(renderer.ownerWebContentsId);
    }
    for (const host of [...this.hosts.values()]) {
      if (host.rendererInstanceId === rendererInstanceId) {
        this.releaseHost(host);
      }
    }
    for (const [token, pending] of this.pendingAttachments) {
      if (pending.rendererInstanceId === rendererInstanceId) {
        this.pendingAttachments.delete(token);
      }
    }
  }
}
