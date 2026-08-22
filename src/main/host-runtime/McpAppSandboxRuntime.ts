import * as Context from "effect/Context";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as FiberSet from "effect/FiberSet";
import * as Layer from "effect/Layer";
import { net, type WebContents } from "electron";
import {
  McpAppSandboxCoordinator,
  type McpAppSandboxHost,
  type McpAppSandboxHostOptions,
} from "../mcp-app/mcp-app-sandbox-host";
import { makeMcpAppSandboxProtocolCache } from "../mcp-app/mcp-app-sandbox-protocol";

export interface McpAppSandboxCoordinatorPort {
  readonly install: () => void;
  readonly createHost: (owner: WebContents) => McpAppSandboxHost;
  readonly dispose: () => void;
}

export class McpAppSandboxRuntime extends Context.Service<
  McpAppSandboxRuntime,
  { readonly createHost: (owner: WebContents) => McpAppSandboxHost }
>()("nodex/main/host-runtime/McpAppSandboxRuntime") {}

export const fromCoordinator = (
  coordinator: McpAppSandboxCoordinatorPort,
): Layer.Layer<McpAppSandboxRuntime> =>
  Layer.effect(
    McpAppSandboxRuntime,
    Effect.acquireRelease(
      Effect.sync(() => {
        coordinator.install();
        return McpAppSandboxRuntime.of({ createHost: coordinator.createHost.bind(coordinator) });
      }),
      () => Effect.sync(() => coordinator.dispose()),
    ),
  );

export const live = (options: McpAppSandboxHostOptions): Layer.Layer<McpAppSandboxRuntime> =>
  Layer.effect(
    McpAppSandboxRuntime,
    Effect.gen(function* () {
      const protocolCache = yield* makeMcpAppSandboxProtocolCache(options.fetch ?? net.fetch);
      const runTimer = yield* FiberSet.makeRuntime();
      const coordinator = new McpAppSandboxCoordinator(options, protocolCache, {
        schedule: (delayMs, task) => {
          const fiber = runTimer(
            Effect.sleep(Duration.millis(delayMs)).pipe(Effect.andThen(Effect.sync(task))),
          );
          return () => {
            void runTimer(Fiber.interrupt(fiber));
          };
        },
      });
      yield* Effect.acquireRelease(
        Effect.sync(() => coordinator.install()),
        () => Effect.sync(() => coordinator.dispose()),
      );
      return McpAppSandboxRuntime.of({
        createHost: coordinator.createHost.bind(coordinator),
      });
    }),
  );
