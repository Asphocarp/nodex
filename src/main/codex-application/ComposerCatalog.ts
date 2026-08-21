import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import type {
  ClientRequestParamsByMethod,
  ClientRequestResponsesByMethod,
} from "@nodex/effect-codex-app-server/rpc";
import { CodexGateway } from "../codex-runtime/CodexGateway";
import type { CodexRuntimeError } from "../codex-runtime/CodexRuntimeError";

export class ComposerCatalog extends Context.Service<
  ComposerCatalog,
  {
    readonly models: (
      params: ClientRequestParamsByMethod["model/list"],
    ) => Effect.Effect<ClientRequestResponsesByMethod["model/list"], CodexRuntimeError>;
    readonly plugins: (
      params: ClientRequestParamsByMethod["plugin/list"],
    ) => Effect.Effect<ClientRequestResponsesByMethod["plugin/list"], CodexRuntimeError>;
    readonly skills: (
      params: ClientRequestParamsByMethod["skills/list"],
    ) => Effect.Effect<ClientRequestResponsesByMethod["skills/list"], CodexRuntimeError>;
    readonly apps: (
      params: ClientRequestParamsByMethod["app/list"],
    ) => Effect.Effect<ClientRequestResponsesByMethod["app/list"], CodexRuntimeError>;
  }
>()("nodex/main/codex-application/ComposerCatalog") {}

export const live: Layer.Layer<ComposerCatalog, never, CodexGateway> = Layer.effect(
  ComposerCatalog,
  CodexGateway.use((gateway) =>
    Effect.succeed(
      ComposerCatalog.of({
        models: (params) => gateway.requestLocal("model/list", params),
        plugins: (params) => gateway.requestLocal("plugin/list", params),
        skills: (params) => gateway.requestLocal("skills/list", params),
        apps: (params) => gateway.requestLocal("app/list", params),
      }),
    ),
  ),
);
