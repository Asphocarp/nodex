import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import type { ServerRequestMethod } from "@nodex/effect-codex-app-server/rpc";
import {
  CodexAppServerRequestError,
  type CodexAppServerError,
} from "@nodex/effect-codex-app-server/errors";

export class CodexServerRequestRuntime extends Context.Service<
  CodexServerRequestRuntime,
  {
    readonly handle: (
      hostId: string,
      generation: number,
      requestId: string | number,
      method: ServerRequestMethod,
      params: unknown,
    ) => Effect.Effect<unknown, CodexAppServerError>;
  }
>()("nodex/main/codex-runtime/CodexServerRequestRuntime") {}

export const unhandled: Layer.Layer<CodexServerRequestRuntime> = Layer.succeed(
  CodexServerRequestRuntime,
  CodexServerRequestRuntime.of({
    handle: (_hostId, _generation, _requestId, method) =>
      Effect.fail(CodexAppServerRequestError.methodNotFound(method)),
  }),
);
