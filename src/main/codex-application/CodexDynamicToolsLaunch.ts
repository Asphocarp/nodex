import type { DynamicToolSpec } from "@nodex/codex-app-server-protocol/v2/DynamicToolSpec";
import * as Context from "effect/Context";
import * as Data from "effect/Data";
import type * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";

export const DEFAULT_CODEX_DYNAMIC_TOOLS_LAUNCH_TIMEOUT = "5 seconds";

export class CodexDynamicToolsLaunchError extends Data.TaggedError("CodexDynamicToolsLaunchError")<{
  readonly cause: unknown;
}> {}

export class CodexDynamicToolsLaunch extends Context.Service<
  CodexDynamicToolsLaunch,
  {
    readonly load: (
      operation: Effect.Effect<readonly DynamicToolSpec[], CodexDynamicToolsLaunchError>,
    ) => Effect.Effect<readonly DynamicToolSpec[], CodexDynamicToolsLaunchError>;
  }
>()("nodex/main/codex-application/CodexDynamicToolsLaunch") {}

export const make = (
  timeout: Duration.Input = DEFAULT_CODEX_DYNAMIC_TOOLS_LAUNCH_TIMEOUT,
): CodexDynamicToolsLaunch["Service"] =>
  CodexDynamicToolsLaunch.of({
    load: (operation) =>
      Effect.raceFirst(
        operation,
        Effect.sleep(timeout).pipe(Effect.as<readonly DynamicToolSpec[]>([])),
      ),
  });
