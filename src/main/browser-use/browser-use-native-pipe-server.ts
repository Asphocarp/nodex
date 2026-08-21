import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import net, { type Server, type Socket } from "node:net";
import path from "node:path";
import {
  makeBrowserUseRpcError,
  makeBrowserUseRpcResult,
  parseBrowserUseRpcRequest,
  type BrowserUseRpcRequest,
} from "./browser-use-json-rpc";
import {
  BrowserUseNativePipeFrameDecoder,
  encodeBrowserUseNativePipeFrame,
} from "./native-pipe-framing";
import type {
  BrowserUsePeerAuthorizationResult,
  BrowserUseSocketPeerAuthorizer,
} from "./browser-use-peer-authorizer";

const BROWSER_USE_PIPE_PREFIX = "codex-browser-use";

export interface BrowserUseNativePipeRequestContext {
  connectionId: string;
  notification: boolean;
}

export type BrowserUseNativePipeRequestHandler = (
  request: BrowserUseRpcRequest,
  context: BrowserUseNativePipeRequestContext,
) => Promise<unknown> | unknown;

export interface BrowserUseNativePipeRequestEvent {
  connectionId: string;
  label: string;
  notification: boolean;
}

export interface BrowserUseNativePipeRequestCompletedEvent extends BrowserUseNativePipeRequestEvent {
  durationMs: number;
  outcome: "error" | "success";
}

export interface BrowserUseNativePipeServerEvents {
  onAuthorizationError?: (error: unknown) => void;
  onInvalidMessage?: (error: unknown) => void;
  onListening?: (pipePath: string) => void;
  onRejectedSocket?: (result: BrowserUsePeerAuthorizationResult) => void;
  onRequestCompleted?: (event: BrowserUseNativePipeRequestCompletedEvent) => void;
  onRequestStarted?: (event: BrowserUseNativePipeRequestEvent) => void;
  onSocketError?: (error: Error) => void;
}

interface BrowserUseNativePipeServerOptions {
  events?: BrowserUseNativePipeServerEvents;
  handler: BrowserUseNativePipeRequestHandler;
  nativePipeDirectory?: string;
  pipePath?: string;
  socketPeerAuthorizer: BrowserUseSocketPeerAuthorizer;
}

interface BrowserUseNativePipeConnection {
  decoder: BrowserUseNativePipeFrameDecoder;
  id: string;
  socket: Socket;
}

function boundedErrorMessage(error: unknown): string {
  return (error instanceof Error ? error.message : String(error)).slice(0, 2_048);
}

function requestLabel(request: BrowserUseRpcRequest): string {
  if (request.method !== "executeCdp") return request.method;
  if (
    typeof request.params !== "object" ||
    request.params === null ||
    !("method" in request.params) ||
    typeof request.params.method !== "string"
  ) {
    return request.method;
  }
  return `${request.method}:${request.params.method}`;
}

export function resolveBrowserUseNativePipeDirectory(
  platform: NodeJS.Platform = process.platform,
): string {
  if (platform === "win32") return String.raw`\\.\pipe\${BROWSER_USE_PIPE_PREFIX}`;
  return path.join("/tmp", BROWSER_USE_PIPE_PREFIX);
}

async function ensureUnixPipeDirectory(directory: string): Promise<void> {
  await fs.mkdir(directory, { recursive: true, mode: 0o700 });
  const stats = await fs.lstat(directory);
  if (!stats.isDirectory() || stats.isSymbolicLink()) {
    throw new Error("Browser Use native-pipe directory is not a regular directory");
  }
  const currentUserId = process.getuid?.();
  if (currentUserId !== undefined && stats.uid !== currentUserId) {
    throw new Error("Browser Use native-pipe directory is not owned by the current user");
  }
  await fs.chmod(directory, 0o700);
}

async function removeOwnedUnixPipe(pipePath: string): Promise<void> {
  try {
    const stats = await fs.lstat(pipePath);
    if (!stats.isSocket()) return;
    await fs.unlink(pipePath);
  } catch (error) {
    if (
      error instanceof Error &&
      "code" in error &&
      (error as NodeJS.ErrnoException).code === "ENOENT"
    ) {
      return;
    }
    throw error;
  }
}

export class BrowserUseNativePipeServer {
  private readonly connections = new Map<Socket, BrowserUseNativePipeConnection>();
  private readonly events: BrowserUseNativePipeServerEvents;
  private readonly handler: BrowserUseNativePipeRequestHandler;
  private readonly socketPeerAuthorizer: BrowserUseSocketPeerAuthorizer;
  private ownsPipePath = false;
  private server: Server | null = null;
  readonly pipePath: string;

  constructor(options: BrowserUseNativePipeServerOptions) {
    this.events = options.events ?? {};
    this.handler = options.handler;
    this.socketPeerAuthorizer = options.socketPeerAuthorizer;
    this.pipePath =
      options.pipePath ??
      (process.platform === "win32"
        ? `${options.nativePipeDirectory ?? resolveBrowserUseNativePipeDirectory()}-${randomUUID()}`
        : path.join(
            options.nativePipeDirectory ?? resolveBrowserUseNativePipeDirectory(),
            `${randomUUID()}.sock`,
          ));
  }

  async start(): Promise<void> {
    if (this.server) return;
    if (process.platform !== "win32") {
      await ensureUnixPipeDirectory(path.dirname(this.pipePath));
      await removeOwnedUnixPipe(this.pipePath);
    }
    const server = net.createServer((socket) => {
      this.handleConnection(socket);
    });
    try {
      await new Promise<void>((resolve, reject) => {
        const onError = (error: Error) => {
          server.off("listening", onListening);
          reject(error);
        };
        const onListening = () => {
          server.off("error", onError);
          resolve();
        };
        server.once("error", onError);
        server.once("listening", onListening);
        server.listen(this.pipePath);
      });
      if (process.platform !== "win32") await fs.chmod(this.pipePath, 0o600);
      this.server = server;
      this.ownsPipePath = true;
      this.events.onListening?.(this.pipePath);
    } catch (error) {
      server.close();
      throw error;
    }
  }

  broadcast(method: string, params?: unknown): void {
    const frame = encodeBrowserUseNativePipeFrame(
      JSON.stringify({
        jsonrpc: "2.0",
        method,
        ...(params === undefined ? {} : { params }),
      }),
    );
    for (const connection of this.connections.values()) {
      if (!connection.socket.destroyed) connection.socket.write(frame);
    }
  }

  async close(): Promise<void> {
    for (const connection of this.connections.values()) {
      connection.decoder.reset();
      connection.socket.destroy();
    }
    this.connections.clear();

    const server = this.server;
    this.server = null;
    if (server) {
      await new Promise<void>((resolve) => {
        server.close(() => resolve());
      });
    }
    const shouldRemovePipe = this.ownsPipePath && process.platform !== "win32";
    this.ownsPipePath = false;
    if (shouldRemovePipe) await removeOwnedUnixPipe(this.pipePath);
  }

  private handleConnection(socket: Socket): void {
    let authorization: BrowserUsePeerAuthorizationResult;
    try {
      authorization = this.socketPeerAuthorizer(socket);
    } catch (error) {
      this.events.onAuthorizationError?.(error);
      socket.destroy();
      return;
    }
    if (!authorization.authorized) {
      this.events.onRejectedSocket?.(authorization);
      socket.destroy();
      return;
    }

    const connection: BrowserUseNativePipeConnection = {
      decoder: new BrowserUseNativePipeFrameDecoder(),
      id: randomUUID(),
      socket,
    };
    this.connections.set(socket, connection);
    socket.setNoDelay(true);
    socket.on("data", (chunk) => {
      this.handleSocketData(connection, chunk);
    });
    socket.on("error", (error) => {
      this.events.onSocketError?.(error);
    });
    socket.on("close", () => {
      connection.decoder.reset();
      this.connections.delete(socket);
    });
  }

  private handleSocketData(connection: BrowserUseNativePipeConnection, chunk: Buffer): void {
    let messages: string[];
    try {
      messages = connection.decoder.push(chunk);
    } catch (error) {
      this.events.onInvalidMessage?.(error);
      connection.socket.destroy();
      return;
    }
    for (const message of messages) {
      let request: BrowserUseRpcRequest;
      try {
        request = parseBrowserUseRpcRequest(message);
      } catch (error) {
        this.events.onInvalidMessage?.(error);
        connection.socket.destroy();
        return;
      }
      void this.dispatch(connection, request);
    }
  }

  private async dispatch(
    connection: BrowserUseNativePipeConnection,
    request: BrowserUseRpcRequest,
  ): Promise<void> {
    const notification = request.id === undefined;
    const requestEvent: BrowserUseNativePipeRequestEvent = {
      connectionId: connection.id,
      label: requestLabel(request),
      notification,
    };
    const startedAt = performance.now();
    this.events.onRequestStarted?.(requestEvent);
    try {
      const result = await this.handler(request, {
        connectionId: connection.id,
        notification,
      });
      this.events.onRequestCompleted?.({
        ...requestEvent,
        durationMs: performance.now() - startedAt,
        outcome: "success",
      });
      if (notification || connection.socket.destroyed) return;
      connection.socket.write(
        encodeBrowserUseNativePipeFrame(
          JSON.stringify(makeBrowserUseRpcResult(request.id!, result)),
        ),
      );
    } catch (error) {
      this.events.onRequestCompleted?.({
        ...requestEvent,
        durationMs: performance.now() - startedAt,
        outcome: "error",
      });
      if (notification || connection.socket.destroyed) return;
      connection.socket.write(
        encodeBrowserUseNativePipeFrame(
          JSON.stringify(makeBrowserUseRpcError(request.id!, 1, boundedErrorMessage(error))),
        ),
      );
    }
  }
}
