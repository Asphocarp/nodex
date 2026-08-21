/* oxlint-disable effecttsgo/async-function, effecttsgo/global-date, effecttsgo/node-builtin-import, effecttsgo/process-env-in-effect -- This is the single Promise/EventEmitter adapter for the legacy Electron application surface. */
import { EventEmitter } from "node:events";
import { delimiter as pathDelimiter } from "node:path";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import { CodexAppServerRequestError } from "@nodex/effect-codex-app-server/errors";
import { CodexAppServerNoResponse } from "@nodex/effect-codex-app-server/protocol";
import type {
  ClientNotificationMethod,
  ClientRequestMethod as EffectClientRequestMethod,
} from "@nodex/effect-codex-app-server/rpc";
import type { CodexConnectionState } from "../../shared/types";
import { ScopedCallbackRuntime } from "../app/ScopedCallbackRuntime";
import {
  CODEX_SERVER_REQUEST_NO_RESPONSE,
  CodexRpcError,
  type CodexApplicationClient,
  type CodexAppServerClientOptions,
  type CodexServerNotification,
  type CodexServerRequest,
} from "./CodexApplicationClient";
import { parseCodexAppServerMessage } from "../codex/codex-app-server-message-parser";
import { live as sessionLive } from "./CodexAppServerSession";
import { CodexEndpointMap } from "./CodexEndpointMap";
import type { CodexEndpointConnection, CodexEndpointEvent } from "./CodexEventHub";
import { CodexGateway } from "./CodexGateway";
import { codexRuntimeError, CodexRuntimeError } from "./CodexRuntimeError";
import { CodexServerRequestRuntime } from "./CodexServerRequestRuntime";

const directThreadId = (params: unknown): string | null => {
  if (typeof params !== "object" || params === null || Array.isArray(params)) return null;
  const threadId = (params as { readonly threadId?: unknown }).threadId;
  return typeof threadId === "string" && threadId.trim().length > 0 ? threadId.trim() : null;
};

const withSearchPath = (
  env: Readonly<Record<string, string | undefined>>,
  entries: readonly string[],
): Readonly<Record<string, string | undefined>> => {
  const inherited = env.PATH?.split(pathDelimiter).filter(Boolean) ?? [];
  return { ...env, PATH: [...new Set([...entries, ...inherited])].join(pathDelimiter) };
};

const isRequestError = Schema.is(CodexAppServerRequestError);

const legacyRequestError = (error: unknown): unknown => {
  if (isRequestError(error)) return new CodexRpcError(error.message, error.code, error.data);
  if (Schema.is(CodexRuntimeError)(error) && isRequestError(error.cause)) {
    return new CodexRpcError(error.cause.message, error.cause.code, error.cause.data);
  }
  return error;
};

const requestHandlerError = (error: unknown, method: string): CodexAppServerRequestError => {
  if (error instanceof CodexRpcError) {
    return new CodexAppServerRequestError({
      code: error.code,
      errorMessage: error.message,
      ...(error.data === undefined ? {} : { data: error.data }),
      method,
      operation: "handle-request",
      cause: error,
    });
  }
  return CodexAppServerRequestError.internalError(
    `Nodex could not handle Codex request '${method}'`,
    undefined,
    { method, operation: "handle-request", cause: error },
  );
};

const initializeParams = (options: CodexAppServerClientOptions) => ({
  clientInfo: options.clientInfo ?? { name: "nodex", title: "Nodex", version: "0.0.0" },
  capabilities: {
    experimentalApi: true,
    extensions: { "openai/form": {} },
    requestAttestation: false,
  },
});

/**
 * Temporary outer-boundary adapter while Codex application state moves to Effect Modules.
 * It never owns a process, retry timer, or request deadline; the root-scoped Gateway does.
 */
export class CodexGatewayBridge extends EventEmitter implements CodexApplicationClient {
  readonly #callbacks: ScopedCallbackRuntime["Service"];
  #gateway: CodexGateway["Service"] | null = null;
  #endpoints: CodexEndpointMap["Service"] | null = null;
  #serverRequestHandler: ((request: CodexServerRequest) => Promise<unknown>) | null = null;
  #threadHostResolver: (threadId: string) => string | null = () => null;
  #connectionByHost = new Map<string, CodexConnectionState>();
  #stopped = false;

  constructor(callbacks: ScopedCallbackRuntime["Service"]) {
    super();
    this.#callbacks = callbacks;
  }

  attach(gateway: CodexGateway["Service"], endpoints: CodexEndpointMap["Service"]): void {
    if (this.#gateway !== null) throw new Error("Codex Gateway bridge is already attached");
    this.#gateway = gateway;
    this.#endpoints = endpoints;
    this.#connectionByHost.set(gateway.localHostId, { status: "disconnected", retries: 0 });
  }

  readonly events: Stream.Stream<CodexEndpointEvent> = Stream.unwrap(
    Effect.sync(() => this.#requireGateway().events),
  );

  observe(event: CodexEndpointEvent): void {
    if (event.kind === "notification") {
      this.emit("notification", event.value as CodexServerNotification);
      return;
    }
    if (event.kind === "request") return;
    this.#observeConnection(event.value);
  }

  serverRequests(): CodexServerRequestRuntime["Service"] {
    const handle = (
      requestId: string | number,
      method: string,
      params: unknown,
    ): Effect.Effect<unknown, CodexAppServerRequestError> => {
      const parsed = parseCodexAppServerMessage({ id: requestId, method, params });
      if (!parsed.success || parsed.data.kind !== "request") {
        return Effect.fail(
          CodexAppServerRequestError.invalidParams(parsed.success ? undefined : parsed.error),
        );
      }
      const request = parsed.data.request;
      const handler = this.#serverRequestHandler;
      if (handler === null) {
        return Effect.fail(CodexAppServerRequestError.methodNotFound(method));
      }
      return Effect.tryPromise({
        try: () => handler(request),
        catch: (error) => requestHandlerError(error, method),
      }).pipe(
        Effect.map((result) =>
          result === CODEX_SERVER_REQUEST_NO_RESPONSE ? CodexAppServerNoResponse : result,
        ),
      );
    };
    return CodexServerRequestRuntime.of({
      handle: (_hostId, _generation, requestId, method, params) =>
        handle(requestId, method, params),
      handleUnknown: (_hostId, _generation, requestId, method, params) =>
        handle(requestId, method, params),
    });
  }

  resolveThreadHost(threadId: string): Effect.Effect<string, CodexRuntimeError> {
    return Effect.succeed(this.#threadHostResolver(threadId) ?? this.#requireGateway().localHostId);
  }

  setThreadHostResolver(resolver: (threadId: string) => string | null): void {
    this.#threadHostResolver = resolver;
  }

  setServerRequestHandler(handler: (request: CodexServerRequest) => Promise<unknown>): void {
    this.#serverRequestHandler = handler;
  }

  getState(): CodexConnectionState {
    const gateway = this.#gateway;
    if (gateway === null) return { status: "disconnected", retries: 0 };
    return (
      this.#connectionByHost.get(gateway.localHostId) ?? { status: "disconnected", retries: 0 }
    );
  }

  hasHost(hostId: string): boolean {
    const endpoints = this.#requireEndpoints();
    // The authoritative map is Effect-owned; this synchronous query is only a legacy decision seam.
    return this.#connectionByHost.has(hostId.trim()) || hostId.trim() === endpoints.localHostId;
  }

  async start(): Promise<void> {
    const gateway = this.#requireGateway();
    if (this.#stopped) this.#stopped = false;
    await this.#callbacks.runPromise(gateway.awaitReady(gateway.localHostId));
  }

  async stop(): Promise<void> {
    if (this.#stopped) return;
    this.#stopped = true;
    const gateway = this.#requireGateway();
    await this.#callbacks.runPromise(gateway.restartHost(gateway.localHostId));
  }

  async dispose(): Promise<void> {
    // The Main Scope is the only owner and releases all endpoints after application finalizers.
  }

  async request<TResult>(method: string, params?: unknown): Promise<TResult> {
    const gateway = this.#requireGateway();
    const threadId = directThreadId(params);
    const hostId = threadId
      ? (this.#threadHostResolver(threadId) ?? gateway.localHostId)
      : gateway.localHostId;
    return await this.requestOnHost<TResult>(hostId, method, params);
  }

  async requestOnHost<TResult>(hostId: string, method: string, params?: unknown): Promise<TResult> {
    const gateway = this.#requireGateway();
    const request = gateway.requestOnHost as (
      hostId: string,
      method: EffectClientRequestMethod,
      params: never,
    ) => Effect.Effect<unknown, CodexRuntimeError>;
    return (await this.#callbacks
      .runPromise(request(hostId, method as EffectClientRequestMethod, params as never))
      .catch((error: unknown) => Promise.reject(legacyRequestError(error)))) as TResult;
  }

  async notify(method: string, params?: unknown): Promise<void> {
    const gateway = this.#requireGateway();
    const notify = gateway.notifyLocal as (
      method: ClientNotificationMethod,
      params: never,
    ) => Effect.Effect<void, CodexRuntimeError>;
    await this.#callbacks
      .runPromise(notify(method as ClientNotificationMethod, params as never))
      .catch((error: unknown) => Promise.reject(legacyRequestError(error)));
  }

  registerProcessHost(hostId: string, options: CodexAppServerClientOptions): void {
    const gateway = this.#requireGateway();
    const resolveEnv = () =>
      Effect.tryPromise({
        try: async () =>
          withSearchPath(
            options.resolveEnv === undefined
              ? (options.env ?? process.env)
              : await options.resolveEnv(),
            options.additionalSearchPaths ?? [],
          ),
        catch: (cause) =>
          codexRuntimeError({
            operation: "session.resolve-environment",
            reason: "spawn",
            retryable: false,
            hostId,
            cause,
          }),
      });
    const registration = gateway.reconcileHost({
      kind: hostId === gateway.localHostId ? "local" : "remote",
      hostId,
      sessionLayer: (generation) =>
        sessionLive({
          hostId,
          generation,
          command: options.binaryPath ?? "codex",
          args: options.args ?? ["app-server", "--listen", "stdio://"],
          env: {},
          resolveEnv,
          forceTermination: "2 seconds",
          initializeParams: initializeParams(options),
          initializeTimeout: Duration.millis(options.initializeTimeoutMs ?? 20_000),
          ...(options.expectedCodexHome === undefined
            ? {}
            : { expectedCodexHome: options.expectedCodexHome }),
        }),
    });
    this.#connectionByHost.set(hostId.trim(), { status: "disconnected", retries: 0 });
    const fiber = this.#callbacks.fork(registration);
    if (fiber === null) throw new Error("Main runtime is closing");
  }

  async unregister(hostId: string): Promise<boolean> {
    const key = hostId.trim();
    if (!this.#connectionByHost.has(key)) return false;
    await this.#callbacks.runPromise(this.#requireGateway().removeHost(key));
    this.#connectionByHost.delete(key);
    return true;
  }

  #observeConnection(connection: CodexEndpointConnection): void {
    const previous = this.#connectionByHost.get(connection.hostId) ?? {
      status: "disconnected" as const,
      retries: 0,
    };
    const next: CodexConnectionState = (() => {
      switch (connection.kind) {
        case "connecting":
          return { status: "starting", retries: previous.retries };
        case "ready":
          return { status: "connected", retries: previous.retries, lastConnectedAt: Date.now() };
        case "backing-off":
          return {
            status: connection.error.reason === "spawn" ? "missingBinary" : "error",
            retries: Math.max(previous.retries, connection.attempt),
            message: connection.error.message,
          };
        case "failed":
          return {
            status: connection.error.reason === "spawn" ? "missingBinary" : "error",
            retries: previous.retries,
            message: connection.error.message,
          };
        case "closing":
        case "stopped":
          return { status: "disconnected", retries: previous.retries };
      }
    })();
    this.#connectionByHost.set(connection.hostId, next);
    const gateway = this.#requireGateway();
    if (connection.hostId === gateway.localHostId) this.emit("connection", next);
    else this.emit("hostConnection", { hostId: connection.hostId, connection: next });
  }

  #requireGateway(): CodexGateway["Service"] {
    if (this.#gateway === null) throw new Error("Codex Gateway bridge is not attached");
    return this.#gateway;
  }

  #requireEndpoints(): CodexEndpointMap["Service"] {
    if (this.#endpoints === null) throw new Error("Codex Gateway bridge is not attached");
    return this.#endpoints;
  }
}
