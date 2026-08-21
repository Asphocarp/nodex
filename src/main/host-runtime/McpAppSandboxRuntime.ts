import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import type { WebContents } from "electron";
import {
  McpAppSandboxCoordinator,
  type McpAppSandboxHost,
  type McpAppSandboxHostOptions,
} from "../mcp-app/mcp-app-sandbox-host";

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
  fromCoordinator(new McpAppSandboxCoordinator(options));
