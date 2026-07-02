import { randomUUID } from "node:crypto";
import type {
  CodexRendererClientRequestMessage,
  CodexRendererClientResponseMessage,
  CodexRendererThreadRole,
  CodexRendererThreadRoleRequest,
} from "../../shared/types";
import {
  safeSendToWebContents,
  type SafeSendWebContentsLike,
} from "../ipc-safe-send";
import { getLogger, type BackendLogger } from "../logging/logger";

export const DEFAULT_RENDERER_CLIENT_REQUEST_TIMEOUT_MS = 5_000;
export const COMPLETE_HISTORY_RENDERER_CLIENT_REQUEST_TIMEOUT_MS = 300_000;
export const RENDERER_CLIENT_REQUEST_CHANNEL = "codex:renderer-client:request";
export const THREAD_ROLE_RENDERER_CLIENT_REQUEST_METHOD = "thread-role";

type RendererClientTimer = unknown;

export interface RendererClientWebContents extends SafeSendWebContentsLike {
  id: number;
  once?: (event: "destroyed", listener: () => void) => unknown;
  off?: (event: "destroyed", listener: () => void) => unknown;
}

export interface RendererClientRegistration {
  clientId: string;
  webContentsId: number;
  dispose: () => void;
}

export interface RendererClientRequestOptions {
  timeoutMs?: number;
}

export interface RendererClientBroadcastOptions {
  sourceClientId?: string | null;
  includeSource?: boolean;
}

export interface RendererClientDisposedEvent {
  clientId: string;
  webContentsId: number;
  reason: string;
}

interface RegisteredRendererClient {
  clientId: string;
  webContents: RendererClientWebContents;
  destroyListener: () => void;
}

interface PendingRendererClientRequest {
  requestId: string;
  method: string;
  targetClientId: string;
  targetWebContentsId: number;
  timeout: RendererClientTimer;
  resolve: (result: unknown) => void;
  reject: (error: Error) => void;
}

export interface RendererClientRouterOptions {
  clientIdFactory?: () => string;
  requestIdFactory?: () => string;
  defaultRequestTimeoutMs?: number;
  logger?: Pick<BackendLogger, "debug" | "warn">;
  setTimeout?: (callback: () => void, ms: number) => RendererClientTimer;
  clearTimeout?: (timer: RendererClientTimer) => void;
  send?: (
    target: RendererClientWebContents,
    channel: string,
    args: readonly unknown[],
  ) => boolean;
}

const routerLogger = getLogger({ subsystem: "codex", component: "renderer-client-router" });

function createRendererClientId(): string {
  return `renderer:${randomUUID()}`;
}

function createRendererRequestId(): string {
  return `renderer-request:${randomUUID()}`;
}

function scheduleTimeout(callback: () => void, ms: number): RendererClientTimer {
  return setTimeout(callback, ms);
}

function clearScheduledTimeout(timer: RendererClientTimer): void {
  clearTimeout(timer as ReturnType<typeof setTimeout>);
}

function sendRendererClientMessage(
  target: RendererClientWebContents,
  channel: string,
  args: readonly unknown[],
): boolean {
  return safeSendToWebContents(target, channel, args, {
    logger: routerLogger,
  });
}

export class RendererClientRouter {
  private readonly clientsByWebContentsId = new Map<number, RegisteredRendererClient>();
  private readonly webContentsIdByClientId = new Map<string, number>();
  private readonly pendingRequests = new Map<string, PendingRendererClientRequest>();
  private readonly clientDisposedListeners = new Set<(event: RendererClientDisposedEvent) => void>();
  private readonly clientIdFactory: () => string;
  private readonly requestIdFactory: () => string;
  private readonly defaultRequestTimeoutMs: number;
  private readonly logger: Pick<BackendLogger, "debug" | "warn">;
  private readonly setTimeoutFn: (callback: () => void, ms: number) => RendererClientTimer;
  private readonly clearTimeoutFn: (timer: RendererClientTimer) => void;
  private readonly sendFn: (
    target: RendererClientWebContents,
    channel: string,
    args: readonly unknown[],
  ) => boolean;

  constructor(options: RendererClientRouterOptions = {}) {
    this.clientIdFactory = options.clientIdFactory ?? createRendererClientId;
    this.requestIdFactory = options.requestIdFactory ?? createRendererRequestId;
    this.defaultRequestTimeoutMs =
      options.defaultRequestTimeoutMs ?? DEFAULT_RENDERER_CLIENT_REQUEST_TIMEOUT_MS;
    this.logger = options.logger ?? routerLogger;
    this.setTimeoutFn = options.setTimeout ?? scheduleTimeout;
    this.clearTimeoutFn = options.clearTimeout ?? clearScheduledTimeout;
    this.sendFn = options.send ?? sendRendererClientMessage;
  }

  register(webContents: RendererClientWebContents): RendererClientRegistration {
    if (webContents.isDestroyed()) {
      throw new Error(`Cannot register destroyed renderer webContents ${webContents.id}`);
    }

    const existing = this.clientsByWebContentsId.get(webContents.id);
    if (existing) {
      return this.createRegistration(existing.clientId, webContents.id);
    }

    const clientId = this.clientIdFactory();
    const destroyListener = () => {
      this.disposeWebContents(webContents.id, "destroyed");
    };

    this.clientsByWebContentsId.set(webContents.id, {
      clientId,
      webContents,
      destroyListener,
    });
    this.webContentsIdByClientId.set(clientId, webContents.id);
    webContents.once?.("destroyed", destroyListener);

    return this.createRegistration(clientId, webContents.id);
  }

  ensureClient(webContents: RendererClientWebContents): RendererClientRegistration {
    return this.register(webContents);
  }

  getClientIdForWebContentsId(webContentsId: number): string | null {
    return this.clientsByWebContentsId.get(webContentsId)?.clientId ?? null;
  }

  getWebContentsIdForClientId(clientId: string): number | null {
    return this.webContentsIdByClientId.get(clientId) ?? null;
  }

  getClientCount(): number {
    return this.clientsByWebContentsId.size;
  }

  getPendingRequestCount(): number {
    return this.pendingRequests.size;
  }

  addClientDisposedListener(listener: (event: RendererClientDisposedEvent) => void): () => void {
    this.clientDisposedListeners.add(listener);
    return () => {
      this.clientDisposedListeners.delete(listener);
    };
  }

  sendToClient(clientId: string, channel: string, args: readonly unknown[]): boolean {
    const client = this.findClient(clientId);
    if (!client) return false;

    return this.sendFn(client.webContents, channel, args);
  }

  broadcast(
    channel: string,
    args: readonly unknown[],
    options: RendererClientBroadcastOptions = {},
  ): number {
    let sentCount = 0;
    for (const client of this.clientsByWebContentsId.values()) {
      if (options.includeSource === false && options.sourceClientId === client.clientId) {
        continue;
      }
      if (this.sendFn(client.webContents, channel, args)) {
        sentCount += 1;
      }
    }
    return sentCount;
  }

  sendRequest<TResult = unknown>(
    targetClientId: string,
    method: string,
    params: unknown,
    options: RendererClientRequestOptions = {},
  ): Promise<TResult> {
    const target = this.findClient(targetClientId);
    if (!target) {
      return Promise.reject(new Error(`Renderer client ${targetClientId} is unavailable`));
    }

    const requestId = this.requestIdFactory();
    const timeoutMs = options.timeoutMs ?? this.defaultRequestTimeoutMs;
    const message: CodexRendererClientRequestMessage = {
      requestId,
      method,
      params,
    };

    return new Promise<TResult>((resolve, reject) => {
      const timeout = this.setTimeoutFn(() => {
        this.rejectPendingRequest(
          requestId,
          new Error(`Renderer client request ${method} timed out after ${timeoutMs}ms`),
        );
      }, timeoutMs);

      this.pendingRequests.set(requestId, {
        requestId,
        method,
        targetClientId,
        targetWebContentsId: target.webContents.id,
        timeout,
        resolve: (result) => resolve(result as TResult),
        reject,
      });

      if (this.sendFn(target.webContents, RENDERER_CLIENT_REQUEST_CHANNEL, [message])) {
        return;
      }

      this.rejectPendingRequest(
        requestId,
        new Error(`Renderer client ${targetClientId} is unavailable`),
      );
    });
  }

  async queryThreadRole(
    targetClientId: string,
    conversationId: string,
    options: RendererClientRequestOptions = {},
  ): Promise<CodexRendererThreadRole> {
    const result = await this.sendRequest<unknown>(
      targetClientId,
      THREAD_ROLE_RENDERER_CLIENT_REQUEST_METHOD,
      { conversationId } satisfies CodexRendererThreadRoleRequest,
      options,
    );
    return result === "owner" ? "owner" : "follower";
  }

  async requireThreadOwner(
    targetClientId: string,
    conversationId: string,
    options: RendererClientRequestOptions = {},
  ): Promise<void> {
    const role = await this.queryThreadRole(targetClientId, conversationId, options);
    if (role === "owner") return;

    throw new Error(`no-client-found: renderer client ${targetClientId} is not owner for ${conversationId}`);
  }

  handleResponse(
    webContents: RendererClientWebContents,
    response: CodexRendererClientResponseMessage,
  ): boolean {
    const pending = this.pendingRequests.get(response.requestId);
    if (!pending) {
      this.logger.debug("Ignored renderer response for unknown request", {
        requestId: response.requestId,
        webContentsId: webContents.id,
      });
      return false;
    }

    if (pending.targetWebContentsId !== webContents.id) {
      this.logger.warn("Ignored renderer response from non-target webContents", {
        requestId: response.requestId,
        expectedWebContentsId: pending.targetWebContentsId,
        actualWebContentsId: webContents.id,
      });
      return false;
    }

    this.pendingRequests.delete(response.requestId);
    this.clearTimeoutFn(pending.timeout);

    if (response.type === "error") {
      pending.reject(new Error(response.error || `Renderer client request ${pending.method} failed`));
      return true;
    }

    pending.resolve(response.result);
    return true;
  }

  disposeClient(clientId: string, reason = "disposed"): void {
    const webContentsId = this.webContentsIdByClientId.get(clientId);
    if (webContentsId === undefined) return;

    this.disposeWebContents(webContentsId, reason);
  }

  disposeWebContents(webContentsId: number, reason = "disposed"): void {
    const client = this.clientsByWebContentsId.get(webContentsId);
    if (!client) return;

    client.webContents.off?.("destroyed", client.destroyListener);
    this.clientsByWebContentsId.delete(webContentsId);
    this.webContentsIdByClientId.delete(client.clientId);
    this.rejectPendingRequestsForWebContents(
      webContentsId,
      new Error(`Renderer client ${client.clientId} was ${reason}`),
    );
    this.emitClientDisposed({
      clientId: client.clientId,
      webContentsId,
      reason,
    });
  }

  dispose(): void {
    for (const webContentsId of [...this.clientsByWebContentsId.keys()]) {
      this.disposeWebContents(webContentsId, "disposed");
    }
    for (const requestId of [...this.pendingRequests.keys()]) {
      this.rejectPendingRequest(
        requestId,
        new Error("Renderer client router was disposed"),
      );
    }
  }

  private createRegistration(clientId: string, webContentsId: number): RendererClientRegistration {
    return {
      clientId,
      webContentsId,
      dispose: () => {
        const currentClientId = this.getClientIdForWebContentsId(webContentsId);
        if (currentClientId !== clientId) return;

        this.disposeWebContents(webContentsId);
      },
    };
  }

  private findClient(clientId: string): RegisteredRendererClient | null {
    const webContentsId = this.webContentsIdByClientId.get(clientId);
    if (webContentsId === undefined) return null;

    const client = this.clientsByWebContentsId.get(webContentsId);
    if (!client || client.webContents.isDestroyed()) {
      this.disposeWebContents(webContentsId, "destroyed");
      return null;
    }

    return client;
  }

  private rejectPendingRequestsForWebContents(webContentsId: number, error: Error): void {
    for (const pending of [...this.pendingRequests.values()]) {
      if (pending.targetWebContentsId !== webContentsId) continue;

      this.rejectPendingRequest(pending.requestId, error);
    }
  }

  private rejectPendingRequest(requestId: string, error: Error): void {
    const pending = this.pendingRequests.get(requestId);
    if (!pending) return;

    this.pendingRequests.delete(requestId);
    this.clearTimeoutFn(pending.timeout);
    pending.reject(error);
  }

  private emitClientDisposed(event: RendererClientDisposedEvent): void {
    for (const listener of this.clientDisposedListeners) {
      listener(event);
    }
  }
}
