import { EventEmitter } from "node:events";
import { mkdirSync, realpathSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn, spawnSync, type ChildProcessWithoutNullStreams } from "node:child_process";
import type {
  ClientRequest,
  InitializeParams,
  InitializeResponse,
  ServerNotification,
} from "@nodex/codex-app-server-protocol";
import type { CodexConnectionState } from "../../shared/types";
import { getLogger } from "../logging/logger";
import {
  parseCodexAppServerMessage,
  type CodexServerRequest,
  type JsonRpcNotificationEnvelope,
  type JsonRpcRequestEnvelope,
  type JsonRpcResponseEnvelope,
} from "./codex-app-server-message-parser";

export type {
  CodexInboxItemsCreateServerRequest,
  CodexServerRequest,
} from "./codex-app-server-message-parser";

const DEFAULT_CONNECT_TIMEOUT_MS = 20_000;
const DEFAULT_REQUEST_TIMEOUT_MS = 120_000;
const CHILD_TERMINATION_TIMEOUT_MS = 2_000;
const CHILD_FORCE_TERMINATION_TIMEOUT_MS = 1_000;
const MAX_RECONNECT_DELAY_MS = 30_000;
const PATH_DELIMITER = process.platform === "win32" ? ";" : ":";

const DEFAULT_EXTRA_BINARY_SEARCH_PATHS =
  process.platform === "darwin"
    ? [
        "/opt/homebrew/bin",
        "/usr/local/bin",
        `${os.homedir()}/.bun/bin`,
        `${os.homedir()}/.npm-global/bin`,
        `${os.homedir()}/.local/bin`,
      ]
    : [`${os.homedir()}/.bun/bin`, `${os.homedir()}/.local/bin`];
const logger = getLogger({ subsystem: "codex", component: "app-server-client" });
const ANSI_ESCAPE_PATTERN = /\u001B\[[0-?]*[ -/]*[@-~]/g;
const TRACING_LEVEL_PREFIX = /^(?:\d{4}-\d{2}-\d{2}T\S+\s+)?(TRACE|DEBUG|INFO|WARN|ERROR)\b/i;

/**
 * A server request can be withdrawn by the app-server before the local handler
 * finishes. Returning this sentinel settles local work without writing a late
 * JSON-RPC response for a request the server no longer owns.
 */
export const CODEX_SERVER_REQUEST_NO_RESPONSE = Symbol("codex-server-request-no-response");

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T | PromiseLike<T>) => void;
  reject: (reason?: unknown) => void;
}

function createDeferred<T>(): Deferred<T> {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

interface PendingRequest {
  method: string;
  startedAt: number;
  timeout: NodeJS.Timeout;
  resolve: (value: unknown) => void;
  reject: (reason?: unknown) => void;
}

export type CodexServerNotification = ServerNotification;

export interface CodexAppServerClientOptions {
  binaryPath?: string;
  args?: string[];
  env?: NodeJS.ProcessEnv;
  resolveEnv?: () => NodeJS.ProcessEnv | Promise<NodeJS.ProcessEnv>;
  additionalSearchPaths?: string[];
  missingBinaryMessage?: string;
  initializeTimeoutMs?: number;
  requestTimeoutMs?: number;
  logStderr?: boolean;
  expectedCodexHome?: string;
  clientInfo?: {
    name: string;
    title: string;
    version: string;
  };
}

export class CodexRpcError extends Error {
  code: number;
  data?: unknown;
  retryable: boolean;

  constructor(message: string, code: number, data?: unknown) {
    super(message);
    this.name = "CodexRpcError";
    this.code = code;
    this.data = data;
    this.retryable = code === -32001;
  }
}

function splitPathEntries(pathValue: string | undefined): string[] {
  if (!pathValue) return [];
  return pathValue
    .split(PATH_DELIMITER)
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

function dedupePathEntries(entries: string[]): string[] {
  const seen = new Set<string>();
  const deduped: string[] = [];

  for (const entry of entries) {
    if (!entry || seen.has(entry)) continue;
    seen.add(entry);
    deduped.push(entry);
  }

  return deduped;
}

function resolvePathEnvKey(env: NodeJS.ProcessEnv): string {
  const explicit = Object.keys(env).find((key) => key.toLowerCase() === "path");
  return explicit ?? "PATH";
}

function createSpawnEnv(baseEnv: NodeJS.ProcessEnv, additionalSearchPaths: string[]): NodeJS.ProcessEnv {
  const pathKey = resolvePathEnvKey(baseEnv);
  const currentPathEntries = splitPathEntries(baseEnv[pathKey]);
  const mergedPathEntries = dedupePathEntries([
    ...currentPathEntries,
    ...DEFAULT_EXTRA_BINARY_SEARCH_PATHS,
    ...additionalSearchPaths,
  ]);

  return {
    ...baseEnv,
    [pathKey]: mergedPathEntries.join(PATH_DELIMITER),
  };
}

function truncatePreview(value: string, maxLength = 160): string {
  if (value.length <= maxLength) return value;
  return `${value.slice(0, Math.max(0, maxLength - 1))}…`;
}

export function resolveCodexStderrLogLevel(
  line: string,
): "trace" | "debug" | "info" | "warn" | "error" {
  const normalized = line.replace(ANSI_ESCAPE_PATTERN, "").trim();
  if (normalized.startsWith("{")) {
    try {
      const parsed = JSON.parse(normalized) as { level?: unknown };
      if (typeof parsed.level === "string") {
        const level = parsed.level.trim().toLowerCase();
        if (level === "trace" || level === "debug" || level === "info" || level === "warn" || level === "error") {
          return level;
        }
      }
    } catch {
      // Fall through to the tracing text parser.
    }
  }

  const match = TRACING_LEVEL_PREFIX.exec(normalized);
  const level = match?.[1]?.toLowerCase();
  if (level === "trace" || level === "debug" || level === "info" || level === "warn" || level === "error") {
    return level;
  }
  return "info";
}

function logCodexStderrLine(line: string): void {
  const level = resolveCodexStderrLogLevel(line);
  const fields = { line, source: "stderr" };
  if (level === "trace") {
    logger.trace("Codex app-server diagnostic", fields);
    return;
  }
  if (level === "debug") {
    logger.debug("Codex app-server diagnostic", fields);
    return;
  }
  if (level === "info") {
    logger.info("Codex app-server diagnostic", fields);
    return;
  }
  if (level === "warn") {
    logger.warn("Codex app-server diagnostic", fields);
    return;
  }
  logger.error("Codex app-server diagnostic", fields);
}

function formatServiceTierForReporting(value: unknown): "standard" | "fast" {
  return value === "fast" ? "fast" : "standard";
}

function summarizeRpcParams(method: string, params: unknown): Record<string, unknown> | undefined {
  if (typeof params !== "object" || params === null) return undefined;
  const candidate = params as Record<string, unknown>;

  if (method === "thread/start") {
    return {
      cwd: typeof candidate.cwd === "string" ? candidate.cwd : null,
      model: typeof candidate.model === "string" ? candidate.model : null,
      serviceTier: formatServiceTierForReporting(candidate.serviceTier),
    };
  }

  if (method === "turn/start" || method === "turn/steer") {
    const input = Array.isArray(candidate.input) ? candidate.input : [];
    const firstText = input.find((item) => {
      return typeof item === "object" && item !== null && (item as Record<string, unknown>).type === "text";
    }) as Record<string, unknown> | undefined;
    const prompt = typeof firstText?.text === "string" ? firstText.text : "";

    return {
      threadId: typeof candidate.threadId === "string" ? candidate.threadId : null,
      cwd: typeof candidate.cwd === "string" ? candidate.cwd : null,
      model: typeof candidate.model === "string" ? candidate.model : null,
      serviceTier: formatServiceTierForReporting(candidate.serviceTier),
      effort: typeof candidate.effort === "string" ? candidate.effort : null,
      promptLength: prompt.length,
      promptPreview: prompt ? truncatePreview(prompt) : null,
    };
  }

  if (
    method === "thread/read"
    || method === "thread/resume"
    || method === "thread/turns/list"
    || method === "thread/archive"
    || method === "thread/unarchive"
    || method === "thread/delete"
    || method === "thread/backgroundTerminals/list"
    || method === "thread/backgroundTerminals/terminate"
    || method === "thread/backgroundTerminals/clean"
  ) {
    return {
      threadId: typeof candidate.threadId === "string" ? candidate.threadId : null,
      includeTurns: typeof candidate.includeTurns === "boolean" ? candidate.includeTurns : undefined,
      hasCursor: typeof candidate.cursor === "string" && candidate.cursor.length > 0 ? true : undefined,
      limit: typeof candidate.limit === "number" ? candidate.limit : undefined,
      sortDirection: typeof candidate.sortDirection === "string" ? candidate.sortDirection : undefined,
      itemsView: typeof candidate.itemsView === "string" ? candidate.itemsView : undefined,
    };
  }

  if (method === "turn/interrupt") {
    return {
      threadId: typeof candidate.threadId === "string" ? candidate.threadId : null,
      turnId: typeof candidate.turnId === "string" ? candidate.turnId : null,
    };
  }

  if (method.startsWith("account/")) {
    return {
      refreshToken: typeof candidate.refreshToken === "boolean" ? candidate.refreshToken : undefined,
      loginId: typeof candidate.loginId === "string" ? candidate.loginId : undefined,
    };
  }

  return {
    keys: Object.keys(candidate).slice(0, 12),
  };
}

export type ClientRequestMethod = ClientRequest["method"];
export type ClientRequestParams<TMethod extends ClientRequestMethod> = Extract<
  ClientRequest,
  { method: TMethod }
>["params"];

/**
 * Narrow process boundary consumed by CodexService. Keeping this structural
 * lets a host router preserve the generated protocol overloads without making
 * the service aware of child-process placement.
 */
export interface CodexAppServerClientPort extends EventEmitter {
  dispose(): Promise<void>;
  getInitializeResponse(): InitializeResponse | null;
  getState(): CodexConnectionState;
  notify(method: string, params?: unknown): Promise<void>;
  request<TMethod extends ClientRequestMethod, TResult>(
    method: TMethod,
    ...args: ClientRequestParams<TMethod> extends undefined
      ? [] | [params: ClientRequestParams<TMethod>]
      : [params: ClientRequestParams<TMethod>]
  ): Promise<TResult>;
  request<TResult>(method: string, params?: unknown): Promise<TResult>;
  setServerRequestHandler(handler: (request: CodexServerRequest) => Promise<unknown>): void;
  start(): Promise<void>;
  stop(): Promise<void>;
}

export class CodexAppServerClient extends EventEmitter {
  private readonly binaryPath: string;
  private readonly args: string[];
  private readonly env: NodeJS.ProcessEnv;
  private readonly resolveEnv: (() => NodeJS.ProcessEnv | Promise<NodeJS.ProcessEnv>) | null;
  private readonly additionalSearchPaths: string[];
  private readonly missingBinaryMessage: string;
  private readonly initializeTimeoutMs: number;
  private readonly requestTimeoutMs: number;
  private readonly logStderr: boolean;
  private readonly expectedCodexHome: string | null;
  private readonly clientInfo: { name: string; title: string; version: string };

  private child: ChildProcessWithoutNullStreams | null = null;
  private stdoutBuffer = "";
  private stderrBuffer = "";
  private requestIdCounter = 1;
  private pendingRequests = new Map<string, PendingRequest>();
  private readyDeferred!: Deferred<void>;
  private isDisposed = false;
  private initialized = false;
  private isStopping = false;
  private lifecycleGeneration = 0;
  private startInFlight: Promise<void> | null = null;
  private retirementInFlight: Promise<void> | null = null;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private reconnectAttempts = 0;
  private initializeResponse: InitializeResponse | null = null;
  private connectionState: CodexConnectionState = {
    status: "disconnected",
    retries: 0,
  };
  private serverRequestHandler: ((request: CodexServerRequest) => Promise<unknown>) | null = null;

  constructor(options?: CodexAppServerClientOptions) {
    super();
    this.binaryPath = options?.binaryPath ?? "codex";
    this.args = options?.args ?? ["app-server", "--listen", "stdio://"];
    this.env = { ...(options?.env ?? process.env) };
    this.resolveEnv = options?.resolveEnv ?? null;
    this.additionalSearchPaths = options?.additionalSearchPaths ?? [];
    this.missingBinaryMessage = options?.missingBinaryMessage ?? "Configured Agent runtime is missing or unavailable.";
    this.initializeTimeoutMs = options?.initializeTimeoutMs ?? DEFAULT_CONNECT_TIMEOUT_MS;
    this.requestTimeoutMs = options?.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
    this.logStderr = options?.logStderr ?? true;
    this.expectedCodexHome = options?.expectedCodexHome
      ? path.resolve(options.expectedCodexHome)
      : null;
    this.clientInfo = options?.clientInfo ?? {
      name: "nodex",
      title: "Nodex",
      version: "0.0.0",
    };
    this.resetReadyDeferred();
  }

  getState(): CodexConnectionState {
    return this.connectionState;
  }

  getInitializeResponse(): InitializeResponse | null {
    return this.initializeResponse;
  }

  setServerRequestHandler(handler: (request: CodexServerRequest) => Promise<unknown>): void {
    this.serverRequestHandler = handler;
  }

  async start(): Promise<void> {
    if (this.isDisposed) throw new Error("Codex app-server client was disposed");
    if (this.initialized && this.connectionState.status === "connected") return;
    if (this.startInFlight) return await this.startInFlight;
    if (this.child) return await this.waitUntilReady();

    this.isStopping = false;
    this.clearReconnectTimer();
    const generation = ++this.lifecycleGeneration;
    logger.info("Starting Codex app-server client", {
      binaryPath: this.binaryPath,
      args: this.args,
      additionalSearchPaths: this.additionalSearchPaths,
      generation,
    });

    const operation = Promise.resolve()
      .then(async () => await this.spawnAndInitialize(generation))
      .finally(() => {
        if (this.startInFlight === operation) this.startInFlight = null;
      });
    this.startInFlight = operation;
    return await operation;
  }

  async stop(): Promise<void> {
    const stoppedError = new Error("Codex app-server client stopped");
    this.isStopping = true;
    this.lifecycleGeneration += 1;
    this.startInFlight = null;
    this.clearReconnectTimer();
    logger.info("Stopping Codex app-server client", {
      hadChild: Boolean(this.child),
      pendingRequests: this.pendingRequests.size,
    });

    const current = this.child;

    this.child = null;
    this.initialized = false;
    this.initializeResponse = null;
    this.rejectAllPending(stoppedError);
    this.readyDeferred.reject(stoppedError);
    this.resetReadyDeferred();
    this.reconnectAttempts = 0;
    this.setConnectionState({ status: "disconnected", retries: 0 });

    if (current) await this.retireChild(current);
    else if (this.retirementInFlight) await this.retirementInFlight;
  }

  /** Permanently closes this client; unlike stop(), a disposed client cannot restart. */
  async dispose(): Promise<void> {
    this.isDisposed = true;
    await this.stop();
  }

  async waitUntilReady(): Promise<void> {
    if (this.initialized && this.connectionState.status === "connected") return;
    if (this.startInFlight) return await this.startInFlight;
    await this.readyDeferred.promise;
  }

  async request<TMethod extends ClientRequestMethod, TResult>(
    method: TMethod,
    ...args: ClientRequestParams<TMethod> extends undefined ? [] | [params: ClientRequestParams<TMethod>] : [params: ClientRequestParams<TMethod>]
  ): Promise<TResult>;
  async request<TResult>(method: string, params?: unknown): Promise<TResult>;
  async request(
    method: string,
    ...args: [params?: unknown]
  ): Promise<unknown> {
    await this.start();
    return this.requestRaw(method, args[0]);
  }

  async notify(method: string, params?: unknown): Promise<void> {
    await this.start();
    this.writeMessage({ method, params } satisfies JsonRpcNotificationEnvelope);
  }

  private setMissingBinaryState(): void {
    this.setConnectionState({
      status: "missingBinary",
      retries: this.reconnectAttempts,
      message: this.missingBinaryMessage,
    });
  }

  private async spawnAndInitialize(generation: number): Promise<void> {
    if (this.retirementInFlight) await this.retirementInFlight;
    this.assertStartupIsCurrent(generation);
    this.stdoutBuffer = "";
    this.stderrBuffer = "";
    this.resetReadyDeferred();
    this.initialized = false;
    this.initializeResponse = null;
    if (this.expectedCodexHome) {
      mkdirSync(this.expectedCodexHome, { recursive: true, mode: 0o700 });
    }
    const resolvedEnv = this.resolveEnv ? await this.resolveEnv() : this.env;
    this.assertStartupIsCurrent(generation);
    const spawnEnv = createSpawnEnv(resolvedEnv, this.additionalSearchPaths);
    const startedAt = Date.now();

    const probe = spawnSync(this.binaryPath, ["--version"], {
      stdio: "ignore",
      env: spawnEnv,
    });
    if (probe.error && (probe.error as NodeJS.ErrnoException).code === "ENOENT") {
      const error = new Error(`Missing Codex binary: ${this.binaryPath}`);
      logger.error("Codex binary probe failed", {
        binaryPath: this.binaryPath,
        error,
      });
      this.setMissingBinaryState();
      this.readyDeferred.reject(error);
      throw error;
    }

    this.setConnectionState({ status: "starting", retries: this.reconnectAttempts });

    const child = spawn(this.binaryPath, this.args, {
      stdio: ["pipe", "pipe", "pipe"],
      env: spawnEnv,
    });

    this.child = child;
    logger.info("Spawned Codex app-server process", {
      pid: child.pid ?? null,
      binaryPath: this.binaryPath,
      args: this.args,
    });

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");

    child.stdout.on("data", (chunk: string) => {
      if (!this.isCurrentChildGeneration(child, generation)) return;
      this.handleStdoutData(chunk);
    });

    child.stderr.on("data", (chunk: string) => {
      if (!this.isCurrentChildGeneration(child, generation)) return;
      this.handleStderrData(chunk);
    });

    child.on("error", (error) => {
      void this.handleChildError(child, generation, error);
    });

    child.on("exit", (code, signal) => {
      this.handleChildExit(child, generation, code, signal);
    });

    try {
      await this.initializeHandshake();
      this.assertChildIsCurrent(child, generation);
      const completedReconnectAttempts = this.reconnectAttempts;
      this.reconnectAttempts = 0;
      logger.info("Codex app-server client connected", {
        pid: child.pid ?? null,
        durationMs: Date.now() - startedAt,
        generation,
        reconnectAttempts: completedReconnectAttempts,
      });
      this.setConnectionState({
        status: "connected",
        retries: completedReconnectAttempts,
        lastConnectedAt: Date.now(),
      });
      this.readyDeferred.resolve();
    } catch (error) {
      if (!this.isCurrentChildGeneration(child, generation)) throw error;
      const message = error instanceof Error ? error.message : String(error);
      if (
        this.connectionState.status === "missingBinary" ||
        message.includes("Missing Codex binary")
      ) {
        this.readyDeferred.reject(error);
        throw error;
      }

      logger.error("Codex app-server initialization failed", {
        error,
        durationMs: Date.now() - startedAt,
        generation,
      });
      await this.abandonCurrentChild(child, error instanceof Error ? error : new Error(message));
      this.setConnectionState({
        status: "error",
        retries: this.reconnectAttempts,
        message,
      });
      this.readyDeferred.reject(error);
      if (!this.isStopping) {
        void this.scheduleReconnect();
      }
      throw error;
    }
  }

  private async initializeHandshake(): Promise<void> {
    const initializeParams: InitializeParams = {
      clientInfo: this.clientInfo,
      capabilities: {
        experimentalApi: true,
        mcpServerOpenaiFormElicitation: true,
        requestAttestation: false,
      },
    };

    const initializePromise = this.requestRaw<"initialize", InitializeResponse>(
      "initialize",
      initializeParams,
      true,
    );

    const timeoutPromise = sleep(this.initializeTimeoutMs).then(() => {
      throw new Error(`Codex app-server initialize timed out after ${this.initializeTimeoutMs}ms`);
    });

    this.initializeResponse = await Promise.race([initializePromise, timeoutPromise]);
    if (this.expectedCodexHome) {
      const actualHome = realpathSync(this.initializeResponse.codexHome);
      const expectedHome = realpathSync(this.expectedCodexHome);
      if (actualHome !== expectedHome) {
        throw new Error(`Agent runtime initialized with ${actualHome}; expected ${expectedHome}`);
      }
    }
    this.writeMessage({ method: "initialized" } satisfies JsonRpcNotificationEnvelope);
    this.initialized = true;
  }

  private async requestRaw<TMethod extends ClientRequestMethod, TResult>(
    method: TMethod,
    params: ClientRequestParams<TMethod> | undefined,
    skipInitialization?: boolean,
  ): Promise<TResult>;
  private async requestRaw<TResult>(method: string, params?: unknown, skipInitialization?: boolean): Promise<TResult>;
  private async requestRaw(
    method: string,
    params?: unknown,
    skipInitialization = false,
  ): Promise<unknown> {
    if (!this.child || this.child.stdin.destroyed) {
      throw new Error("Codex app-server is not running");
    }

    if (!skipInitialization && !this.initialized) {
      throw new Error("Codex app-server is not initialized");
    }

    const id = this.requestIdCounter;
    this.requestIdCounter += 1;

    const message: JsonRpcRequestEnvelope = { id, method, params };
    logger.debug("Sending Codex RPC request", {
      rpcId: id,
      method,
      params: summarizeRpcParams(method, params),
    });

    const promise = new Promise<unknown>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pendingRequests.delete(String(id));
        logger.error("Codex RPC request timed out", {
          rpcId: id,
          method,
          timeoutMs: this.requestTimeoutMs,
        });
        reject(new Error(`Codex request timed out: ${method}`));
      }, this.requestTimeoutMs);

      this.pendingRequests.set(String(id), {
        method,
        startedAt: Date.now(),
        timeout,
        resolve,
        reject,
      });
    });

    this.writeMessage(message);
    return promise;
  }

  private writeMessage(
    message: JsonRpcRequestEnvelope | JsonRpcNotificationEnvelope | JsonRpcResponseEnvelope,
  ): void {
    if (!this.child || this.child.stdin.destroyed) {
      throw new Error("Cannot write to Codex app-server; process is not available");
    }

    const payload = `${JSON.stringify(message)}\n`;
    this.child.stdin.write(payload);
  }

  private handleStdoutData(chunk: string): void {
    this.stdoutBuffer += chunk;

    while (true) {
      const newlineIndex = this.stdoutBuffer.indexOf("\n");
      if (newlineIndex < 0) break;

      const line = this.stdoutBuffer.slice(0, newlineIndex).trim();
      this.stdoutBuffer = this.stdoutBuffer.slice(newlineIndex + 1);
      if (!line) continue;

      this.handleStdoutLine(line);
    }
  }

  private handleStderrData(chunk: string): void {
    this.stderrBuffer += chunk;

    while (true) {
      const newlineIndex = this.stderrBuffer.indexOf("\n");
      if (newlineIndex < 0) break;

      const line = this.stderrBuffer.slice(0, newlineIndex).trim();
      this.stderrBuffer = this.stderrBuffer.slice(newlineIndex + 1);
      if (!line) continue;
      if (this.logStderr) logCodexStderrLine(line);
    }
  }

  private handleStdoutLine(line: string): void {
    let parsed: unknown;

    try {
      parsed = JSON.parse(line);
    } catch {
      logger.error("Codex app-server emitted invalid JSON", { line: truncatePreview(line, 300) });
      this.emit("protocolError", `Invalid JSON from codex app-server: ${line}`);
      return;
    }

    const result = parseCodexAppServerMessage(parsed);
    if (!result.success) {
      logger.error("Codex app-server emitted an invalid protocol message", {
        error: result.error,
        line: truncatePreview(line, 300),
      });
      this.emit("protocolError", result.error);
      return;
    }

    if (result.data.kind === "notification") {
      this.emit("notification", result.data.notification);
      return;
    }

    if (result.data.kind === "request") {
      void this.handleServerRequest(result.data.request);
      return;
    }

    if (result.data.kind === "unknownRequest") {
      this.writeMessage({
        id: result.data.request.id,
        error: {
          code: -32601,
          message: `Unknown server request method '${result.data.request.method}'`,
        },
      });
      return;
    }

    this.handleResponse(result.data.response);
  }

  private handleResponse(response: JsonRpcResponseEnvelope): void {
    const pending = this.pendingRequests.get(String(response.id));
    if (!pending) return;

    clearTimeout(pending.timeout);
    this.pendingRequests.delete(String(response.id));
    const durationMs = Date.now() - pending.startedAt;

    if ("error" in response) {
      logger.error("Codex RPC request failed", {
        rpcId: response.id,
        method: pending.method,
        durationMs,
        errorCode: response.error.code,
        errorMessage: truncatePreview(response.error.message, 600),
      });
      pending.reject(
        new CodexRpcError(response.error.message, response.error.code, response.error.data),
      );
      return;
    }

    logger.debug("Codex RPC request completed", {
      rpcId: response.id,
      method: pending.method,
      durationMs,
    });
    pending.resolve(response.result);
  }

  private async handleServerRequest(request: CodexServerRequest): Promise<void> {
    const requestChild = this.child;
    logger.debug("Received Codex server request", {
      requestId: request.id,
      method: request.method,
      params: summarizeRpcParams(request.method, request.params),
    });
    this.emit("serverRequest", request);

    if (!this.serverRequestHandler) {
      this.writeMessage({
        id: request.id,
        error: {
          code: -32601,
          message: `No server request handler registered for '${request.method}'`,
        },
      } satisfies JsonRpcResponseEnvelope);
      return;
    }

    try {
      const result = await this.serverRequestHandler(request);
      if (result === CODEX_SERVER_REQUEST_NO_RESPONSE) {
        logger.debug("Codex server request completed without a client response", {
          requestId: request.id,
          method: request.method,
        });
        return;
      }
      logger.debug("Resolved Codex server request", {
        requestId: request.id,
        method: request.method,
      });
      if (!this.isCurrentChild(requestChild)) {
        logger.debug("Dropped stale Codex server request response after reconnect", {
          requestId: request.id,
          method: request.method,
        });
        return;
      }
      this.writeMessage({
        id: request.id,
        result: result ?? {},
      } satisfies JsonRpcResponseEnvelope);
    } catch (error) {
      logger.error("Failed Codex server request handler", {
        requestId: request.id,
        method: request.method,
        error,
      });
      if (!this.isCurrentChild(requestChild)) {
        logger.debug("Dropped stale Codex server request error after reconnect", {
          requestId: request.id,
          method: request.method,
        });
        return;
      }
      this.writeMessage({
        id: request.id,
        error: {
          code: -32000,
          message: error instanceof Error ? error.message : String(error),
        },
      } satisfies JsonRpcResponseEnvelope);
    }
  }

  private isCurrentChild(
    child: ChildProcessWithoutNullStreams | null,
  ): child is ChildProcessWithoutNullStreams {
    return child !== null && this.child === child && !child.stdin.destroyed;
  }

  private isCurrentChildGeneration(
    child: ChildProcessWithoutNullStreams,
    generation: number,
  ): boolean {
    return this.lifecycleGeneration === generation && this.child === child;
  }

  private assertStartupIsCurrent(generation: number): void {
    if (!this.isStopping && this.lifecycleGeneration === generation) return;
    throw new Error("Codex app-server startup was superseded");
  }

  private assertChildIsCurrent(
    child: ChildProcessWithoutNullStreams,
    generation: number,
  ): void {
    this.assertStartupIsCurrent(generation);
    if (this.child === child) return;
    throw new Error("Codex app-server startup was superseded");
  }

  private async terminateChild(child: ChildProcessWithoutNullStreams): Promise<void> {
    child.removeAllListeners();
    child.stdout.removeAllListeners();
    child.stderr.removeAllListeners();
    if (child.exitCode !== null || child.signalCode !== null) return;

    const exit = new Promise<void>((resolve) => {
      child.once("exit", () => resolve());
      child.once("error", () => resolve());
    });
    child.kill();
    const exitedGracefully = await Promise.race([
      exit.then(() => true),
      sleep(CHILD_TERMINATION_TIMEOUT_MS).then(() => false),
    ]);
    if (exitedGracefully || child.exitCode !== null || child.signalCode !== null) return;

    logger.warn("Codex app-server did not exit after termination request; forcing shutdown", {
      pid: child.pid ?? null,
      timeoutMs: CHILD_TERMINATION_TIMEOUT_MS,
    });
    child.kill("SIGKILL");
    await Promise.race([
      exit,
      sleep(CHILD_FORCE_TERMINATION_TIMEOUT_MS),
    ]);
  }

  private async retireChild(child: ChildProcessWithoutNullStreams): Promise<void> {
    if (this.retirementInFlight) return await this.retirementInFlight;

    const retirement = this.terminateChild(child).finally(() => {
      if (this.retirementInFlight === retirement) this.retirementInFlight = null;
    });
    this.retirementInFlight = retirement;
    return await retirement;
  }

  private async abandonCurrentChild(child: ChildProcessWithoutNullStreams, error: Error): Promise<void> {
    if (this.child !== child) return;
    this.child = null;
    this.initialized = false;
    this.initializeResponse = null;
    this.rejectAllPending(error);
    await this.retireChild(child);
  }

  private async handleChildError(
    child: ChildProcessWithoutNullStreams,
    generation: number,
    error: Error,
  ): Promise<void> {
    if (!this.isCurrentChildGeneration(child, generation)) return;
    const missingBinary = (error as NodeJS.ErrnoException).code === "ENOENT";
    const failure = missingBinary
      ? new Error(`Missing Codex binary: ${this.binaryPath}`)
      : error;

    logger.error(
      missingBinary
        ? "Codex app-server spawn failed because binary was not found"
        : "Codex app-server child emitted process error",
      { error, binaryPath: this.binaryPath, generation },
    );
    this.readyDeferred.reject(failure);
    await this.abandonCurrentChild(child, failure);
    if (missingBinary) {
      this.setMissingBinaryState();
    } else {
      this.setConnectionState({
        status: "error",
        retries: this.reconnectAttempts,
        message: failure.message,
      });
    }
    if (!missingBinary && !this.isStopping) void this.scheduleReconnect();
  }

  private handleChildExit(
    child: ChildProcessWithoutNullStreams,
    generation: number,
    code: number | null,
    signal: NodeJS.Signals | null,
  ): void {
    if (!this.isCurrentChildGeneration(child, generation)) {
      logger.debug("Ignored stale Codex app-server exit", { code, signal, generation });
      return;
    }

    const error = new Error(`Codex app-server exited (code=${code ?? "null"}, signal=${signal ?? "null"})`);
    this.child = null;
    this.initialized = false;
    this.initializeResponse = null;
    this.rejectAllPending(error);
    this.readyDeferred.reject(error);
    logger.warn("Codex app-server process exited", {
      code,
      signal,
      generation,
      isStopping: this.isStopping,
      reconnectAttempts: this.reconnectAttempts,
    });

    if (this.isStopping) {
      this.setConnectionState({ status: "disconnected", retries: this.reconnectAttempts });
      return;
    }

    this.setConnectionState({
      status: "disconnected",
      retries: this.reconnectAttempts,
      message: `Codex app-server exited (code=${code ?? "null"})`,
    });

    void this.scheduleReconnect();
  }

  private async scheduleReconnect(): Promise<void> {
    if (this.isStopping) return;
    if (this.connectionState.status === "missingBinary") return;
    if (this.reconnectTimer) return;

    this.reconnectAttempts += 1;
    const expDelay = Math.min(MAX_RECONNECT_DELAY_MS, 500 * (2 ** (this.reconnectAttempts - 1)));
    const jitter = Math.floor(Math.random() * 250);
    const delayMs = expDelay + jitter;
    logger.warn("Scheduling Codex app-server reconnect", {
      reconnectAttempts: this.reconnectAttempts,
      delayMs,
    });

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      void this.start().catch(() => {
        // Errors already reflected in connection state; keep retrying.
      });
    }, delayMs);

    this.setConnectionState({
      status: "starting",
      retries: this.reconnectAttempts,
      message: `Reconnecting in ${delayMs}ms`,
    });
  }

  private clearReconnectTimer(): void {
    if (!this.reconnectTimer) return;
    clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
  }

  private resetReadyDeferred(): void {
    this.readyDeferred = createDeferred<void>();
    void this.readyDeferred.promise.catch(() => {
      // Prevent unhandled-rejection warnings when startup fails before consumers await readiness.
    });
  }

  private rejectAllPending(error: Error): void {
    for (const pending of this.pendingRequests.values()) {
      clearTimeout(pending.timeout);
      pending.reject(error);
    }
    this.pendingRequests.clear();
  }

  private setConnectionState(next: CodexConnectionState): void {
    if (
      this.connectionState.status !== next.status
      || this.connectionState.retries !== next.retries
      || this.connectionState.message !== next.message
    ) {
      logger.info("Codex connection state changed", next);
    }
    this.connectionState = next;
    this.emit("connection", next);
  }
}
