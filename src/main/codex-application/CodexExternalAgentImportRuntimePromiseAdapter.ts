import type { ExternalAgentConfigImportCompletedNotification } from "@nodex/codex-app-server-protocol/v2/ExternalAgentConfigImportCompletedNotification";
import type { ExternalAgentConfigImportProgressNotification } from "@nodex/codex-app-server-protocol/v2/ExternalAgentConfigImportProgressNotification";
import type { ExternalAgentConfigMigrationItem } from "@nodex/codex-app-server-protocol/v2/ExternalAgentConfigMigrationItem";
import * as Effect from "effect/Effect";
import type { ScopedCallbackRuntime } from "../app/ScopedCallbackRuntime";
import type { CodexExternalAgentImportRuntime } from "./CodexExternalAgentImportRuntime";

export interface CodexExternalAgentImportRuntimePromiseAdapter {
  readonly run: (
    items: readonly ExternalAgentConfigMigrationItem[],
    onProgress: (progress: ExternalAgentConfigImportProgressNotification) => void,
  ) => Promise<ExternalAgentConfigImportCompletedNotification>;
}

/** Stateless projection for AgentImportCoordinator until that policy becomes Effect-native. */
export const makeCodexExternalAgentImportRuntimePromiseAdapter = (
  runtime: CodexExternalAgentImportRuntime["Service"],
  callbacks: Pick<ScopedCallbackRuntime["Service"], "runPromise">,
): CodexExternalAgentImportRuntimePromiseAdapter => ({
  run: (items, onProgress) =>
    callbacks.runPromise(runtime.run(items, (progress) => Effect.sync(() => onProgress(progress)))),
});
