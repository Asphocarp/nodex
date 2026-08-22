/* oxlint-disable effecttsgo/async-function -- This is the single Promise adapter borrowed by the remaining application reducer. */
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import type {
  ClientRequestMethod as EffectClientRequestMethod,
  ClientRequestParamsByMethod,
} from "@nodex/effect-codex-app-server/rpc";
import type { ClientRequest } from "@nodex/codex-app-server-protocol";
import type { ScopedCallbackRuntime } from "../app/ScopedCallbackRuntime";
import type { CodexGateway } from "./CodexGateway";
import { CodexAppServerRequestError } from "@nodex/effect-codex-app-server/errors";
import {
  CodexRuntimeError,
  type CodexRuntimeError as CodexRuntimeFailure,
} from "./CodexRuntimeError";

export type ClientRequestMethod = ClientRequest["method"];
export type ClientRequestParams<TMethod extends ClientRequestMethod> = Extract<
  ClientRequest,
  { method: TMethod }
>["params"];

export interface CodexGatewayPromiseRequestOptions {
  readonly signal?: AbortSignal;
}

/** Stateless Promise projection for the application reducer methods not yet migrated to Gateway. */
export interface CodexGatewayPromiseClient {
  request<TMethod extends ClientRequestMethod, TResult>(
    method: TMethod,
    ...args: ClientRequestParams<TMethod> extends undefined
      ?
          | []
          | [params: ClientRequestParams<TMethod>]
          | [params: ClientRequestParams<TMethod>, options: CodexGatewayPromiseRequestOptions]
      :
          | [params: ClientRequestParams<TMethod>]
          | [params: ClientRequestParams<TMethod>, options: CodexGatewayPromiseRequestOptions]
  ): Promise<TResult>;
  request<TResult>(
    method: string,
    params?: unknown,
    options?: CodexGatewayPromiseRequestOptions,
  ): Promise<TResult>;
  requestOnHost<TResult>(
    hostId: string,
    method: string,
    params?: unknown,
    options?: CodexGatewayPromiseRequestOptions,
  ): Promise<TResult>;
  start(options?: CodexGatewayPromiseRequestOptions): Promise<void>;
}

const directThreadId = (params: unknown): string | null => {
  if (typeof params !== "object" || params === null || Array.isArray(params)) return null;
  const threadId = (params as { readonly threadId?: unknown }).threadId;
  return typeof threadId === "string" && threadId.trim().length > 0 ? threadId.trim() : null;
};

const isRequestError = Schema.is(CodexAppServerRequestError);

const legacyRequestError = (error: unknown): unknown => {
  if (isRequestError(error)) return new CodexRpcError(error.message, error.code, error.data);
  if (Schema.is(CodexRuntimeError)(error) && isRequestError(error.cause)) {
    return new CodexRpcError(error.cause.message, error.cause.code, error.cause.data);
  }
  return error;
};

export const makeCodexGatewayPromiseClient = (
  gateway: CodexGateway["Service"],
  callbacks: Pick<ScopedCallbackRuntime["Service"], "runPromise">,
): CodexGatewayPromiseClient => {
  const requestOnHost = async <TResult>(
    hostId: string,
    method: string,
    params?: unknown,
    options?: CodexGatewayPromiseRequestOptions,
  ): Promise<TResult> => {
    const request = gateway.requestOnHost as (
      hostId: string,
      method: EffectClientRequestMethod,
      params: never,
    ) => Effect.Effect<unknown, CodexRuntimeFailure>;
    return (await callbacks
      .runPromise(request(hostId, method as EffectClientRequestMethod, params as never), options)
      .catch((error: unknown) => Promise.reject(legacyRequestError(error)))) as TResult;
  };

  return {
    request: async <TResult>(
      method: string,
      params?: unknown,
      options?: CodexGatewayPromiseRequestOptions,
    ): Promise<TResult> => {
      const threadId = directThreadId(params);
      if (threadId === null) {
        return await requestOnHost(gateway.localHostId, method, params, options);
      }
      const request = gateway.requestForThread as <M extends EffectClientRequestMethod>(
        threadId: string,
        method: M,
        params: ClientRequestParamsByMethod[M],
      ) => Effect.Effect<unknown, CodexRuntimeFailure>;
      return (await callbacks
        .runPromise(
          request(
            threadId,
            method as EffectClientRequestMethod,
            params as ClientRequestParamsByMethod[EffectClientRequestMethod],
          ),
          options,
        )
        .catch((error: unknown) => Promise.reject(legacyRequestError(error)))) as TResult;
    },
    requestOnHost,
    start: async (options) => {
      await callbacks.runPromise(gateway.awaitReady(gateway.localHostId), options);
    },
  };
};

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
