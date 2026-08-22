import type { EventEmitter } from "node:events";
import { CodexAppServerNoResponse } from "@nodex/effect-codex-app-server/protocol";
import type { ClientRequest, ServerNotification } from "@nodex/codex-app-server-protocol";
import type { CodexServerRequest as ParsedCodexServerRequest } from "../codex/codex-app-server-message-parser";

export const CODEX_SERVER_REQUEST_OCCURRENCE_TOKEN = Symbol(
  "codex-server-request-occurrence-token",
);
export type CodexServerRequest = ParsedCodexServerRequest & {
  readonly [CODEX_SERVER_REQUEST_OCCURRENCE_TOKEN]?: number;
};

/** Temporary outer adapter contract while the remaining Codex application state is cut over. */
export interface CodexApplicationClient extends EventEmitter {
  hasHost(hostId: string): boolean;
  notify(method: string, params?: unknown): Promise<void>;
  registerProcessHost(hostId: string, options: CodexAppServerClientOptions): void;
  request<TMethod extends ClientRequestMethod, TResult>(
    method: TMethod,
    ...args: ClientRequestParams<TMethod> extends undefined
      ? [] | [params: ClientRequestParams<TMethod>]
      : [params: ClientRequestParams<TMethod>]
  ): Promise<TResult>;
  request<TResult>(method: string, params?: unknown): Promise<TResult>;
  requestOnHost<TResult>(hostId: string, method: string, params?: unknown): Promise<TResult>;
  setServerRequestHandler(handler: (request: CodexServerRequest) => Promise<unknown>): void;
  setThreadHostResolver?(resolver: (threadId: string) => string | null): void;
  start(): Promise<void>;
  stop(): Promise<void>;
  unregister(hostId: string): Promise<boolean>;
}

export interface CodexAppServerClientOptions {
  readonly binaryPath?: string;
  readonly args?: string[];
  readonly env?: NodeJS.ProcessEnv;
  readonly resolveEnv?: () => NodeJS.ProcessEnv | Promise<NodeJS.ProcessEnv>;
  readonly additionalSearchPaths?: string[];
  readonly missingBinaryMessage?: string;
  readonly initializeTimeoutMs?: number;
  readonly requestTimeoutMs?: number;
  readonly logStderr?: boolean;
  readonly expectedCodexHome?: string;
  readonly clientInfo?: { readonly name: string; readonly title: string; readonly version: string };
}

export type ClientRequestMethod = ClientRequest["method"];
export type ClientRequestParams<TMethod extends ClientRequestMethod> = Extract<
  ClientRequest,
  { method: TMethod }
>["params"];

export type CodexServerNotification = ServerNotification;
/** @deprecated Use the Effect protocol sentinel directly in new application Modules. */
export const CODEX_SERVER_REQUEST_NO_RESPONSE: typeof CodexAppServerNoResponse =
  CodexAppServerNoResponse;

// oxlint-disable-next-line effecttsgo/extends-native-error -- Promise adapter callers require Error identity; this type never enters an Effect failure channel.
export class CodexRpcError extends Error {
  readonly code: number;
  readonly data?: unknown;
  readonly retryable: boolean;

  constructor(message: string, code: number, data?: unknown) {
    super(message);
    this.name = "CodexRpcError";
    this.code = code;
    this.data = data;
    this.retryable = code === -32_001;
  }
}
