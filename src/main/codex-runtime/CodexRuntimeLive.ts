import type * as Duration from "effect/Duration";
import * as Layer from "effect/Layer";
import type { CodexSessionTransport } from "../platform/node/CodexSessionTransport";
import { live as sessionLive, type CodexAppServerSessionOptions } from "./CodexAppServerSession";
import type { CodexEndpointConfig } from "./CodexEndpoint";
import { CodexEndpointMap, live as endpointMapLive } from "./CodexEndpointMap";
import { CodexEventHub, live as eventHubLive } from "./CodexEventHub";
import { CodexGateway, CodexThreadHostResolver, live as gatewayLive } from "./CodexGateway";
import type { CodexServerRequestRuntime } from "./CodexServerRequestRuntime";

export interface CodexRuntimeOptions {
  readonly local: Omit<CodexAppServerSessionOptions, "generation">;
  readonly requestTimeout: Duration.Input;
  readonly retryBase?: Duration.Input;
  readonly retryCap?: Duration.Input;
  readonly jitter?: boolean;
}

export const localEndpointConfig = (options: CodexRuntimeOptions): CodexEndpointConfig => ({
  hostId: options.local.hostId,
  sessionLayer: (generation) => sessionLive({ ...options.local, generation }),
  ...(options.retryBase === undefined ? {} : { retryBase: options.retryBase }),
  ...(options.retryCap === undefined ? {} : { retryCap: options.retryCap }),
  ...(options.jitter === undefined ? {} : { jitter: options.jitter }),
});

/** The complete process-scoped Codex transport graph; application Modules depend on CodexGateway. */
export const live = (
  options: CodexRuntimeOptions,
): Layer.Layer<
  CodexGateway | CodexEndpointMap | CodexEventHub,
  never,
  CodexSessionTransport | CodexServerRequestRuntime | CodexThreadHostResolver
> => {
  const events = eventHubLive;
  const endpoints = endpointMapLive({
    ...localEndpointConfig(options),
    kind: "local",
  }).pipe(Layer.provideMerge(events));
  return gatewayLive({ requestTimeout: options.requestTimeout }).pipe(
    Layer.provideMerge(Layer.merge(endpoints, events)),
  );
};
