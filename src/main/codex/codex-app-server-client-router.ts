import { EventEmitter } from "node:events";
import type { InitializeResponse } from "@nodex/codex-app-server-protocol";
import type { CodexConnectionState } from "../../shared/types";
import type {
  ClientRequestMethod,
  ClientRequestParams,
  CodexAppServerClientPort,
  CodexServerRequest,
} from "./codex-app-server-client";

type RoutedClient = {
  readonly client: CodexAppServerClientPort;
  readonly disposeListeners: () => void;
};

function directThreadId(params: unknown): string | null {
  if (typeof params !== "object" || params === null || Array.isArray(params)) return null;
  const threadId = (params as { readonly threadId?: unknown }).threadId;
  return typeof threadId === "string" && threadId.trim() ? threadId.trim() : null;
}

/**
 * Routes thread-scoped JSON-RPC to the execution host that owns the Task.
 * Global runtime/config/account requests deliberately stay on the local host.
 */
export class CodexAppServerClientRouter extends EventEmitter implements CodexAppServerClientPort {
  readonly #clients = new Map<string, RoutedClient>();
  readonly #localHostId: string;
  readonly #resolveThreadHostId: (threadId: string) => string | null;
  #serverRequestHandler: ((request: CodexServerRequest) => Promise<unknown>) | null = null;

  constructor(options: {
    readonly localHostId: string;
    readonly localClient: CodexAppServerClientPort;
    readonly resolveThreadHostId: (threadId: string) => string | null;
  }) {
    super();
    this.#localHostId = options.localHostId;
    this.#resolveThreadHostId = options.resolveThreadHostId;
    this.register(options.localHostId, options.localClient);
  }

  register(hostId: string, client: CodexAppServerClientPort): void {
    const normalizedHostId = hostId.trim();
    if (!normalizedHostId) throw new Error("App-server execution host id is required");
    const previous = this.#clients.get(normalizedHostId);
    if (previous?.client === client) return;
    previous?.disposeListeners();

    const onNotification = (notification: unknown) => this.emit("notification", notification);
    const onProtocolError = (message: unknown) => this.emit("protocolError", message);
    const onConnection = (connection: unknown) => {
      if (normalizedHostId === this.#localHostId) this.emit("connection", connection);
      else this.emit("hostConnection", { hostId: normalizedHostId, connection });
    };
    client.on("notification", onNotification);
    client.on("protocolError", onProtocolError);
    client.on("connection", onConnection);
    if (this.#serverRequestHandler) client.setServerRequestHandler(this.#serverRequestHandler);
    this.#clients.set(normalizedHostId, {
      client,
      disposeListeners: () => {
        client.off("notification", onNotification);
        client.off("protocolError", onProtocolError);
        client.off("connection", onConnection);
      },
    });
  }

  async unregister(hostId: string): Promise<boolean> {
    const normalizedHostId = hostId.trim();
    if (normalizedHostId === this.#localHostId) {
      throw new Error("The local app-server client cannot be unregistered");
    }
    const registration = this.#clients.get(normalizedHostId);
    if (!registration) return false;
    this.#clients.delete(normalizedHostId);
    registration.disposeListeners();
    await registration.client.dispose();
    return true;
  }

  hasHost(hostId: string): boolean {
    return this.#clients.has(hostId.trim());
  }

  clientForHost(hostId: string): CodexAppServerClientPort {
    const normalizedHostId = hostId.trim();
    const registration = this.#clients.get(normalizedHostId);
    if (!registration) {
      throw new Error(`Execution host app-server is unavailable: ${normalizedHostId || "<empty>"}`);
    }
    return registration.client;
  }

  getState(): CodexConnectionState {
    return this.clientForHost(this.#localHostId).getState();
  }

  getInitializeResponse(): InitializeResponse | null {
    return this.clientForHost(this.#localHostId).getInitializeResponse();
  }

  setServerRequestHandler(handler: (request: CodexServerRequest) => Promise<unknown>): void {
    this.#serverRequestHandler = handler;
    for (const registration of this.#clients.values()) {
      registration.client.setServerRequestHandler(handler);
    }
  }

  async start(): Promise<void> {
    await this.clientForHost(this.#localHostId).start();
  }

  async stop(): Promise<void> {
    await Promise.allSettled(
      [...this.#clients.values()].map(({ client }) => client.stop()),
    );
  }

  async dispose(): Promise<void> {
    const registrations = [...this.#clients.values()];
    this.#clients.clear();
    for (const registration of registrations) registration.disposeListeners();
    await Promise.allSettled(registrations.map(({ client }) => client.dispose()));
  }

  async request<TMethod extends ClientRequestMethod, TResult>(
    method: TMethod,
    ...args: ClientRequestParams<TMethod> extends undefined
      ? [] | [params: ClientRequestParams<TMethod>]
      : [params: ClientRequestParams<TMethod>]
  ): Promise<TResult>;
  async request<TResult>(method: string, params?: unknown): Promise<TResult>;
  async request<TResult>(method: string, params?: unknown): Promise<TResult> {
    const threadId = directThreadId(params);
    const hostId = threadId ? this.#resolveThreadHostId(threadId) : null;
    return await this.requestOnHost<TResult>(hostId ?? this.#localHostId, method, params);
  }

  async requestOnHost<TResult>(
    hostId: string,
    method: string,
    params?: unknown,
  ): Promise<TResult> {
    return await this.clientForHost(hostId).request<TResult>(method, params);
  }

  async notify(method: string, params?: unknown): Promise<void> {
    const threadId = directThreadId(params);
    const hostId = threadId ? this.#resolveThreadHostId(threadId) : null;
    await this.clientForHost(hostId ?? this.#localHostId).notify(method, params);
  }
}
