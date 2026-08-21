import type { AgentExecutionProfile, AgentProviderCatalog } from "../../shared/agent-runtime";
import type { ScopedCallbackRuntime } from "../app/ScopedCallbackRuntime";
import type { AgentProviderRuntime } from "./AgentProviderRuntime";

export interface AgentProviderRuntimePromiseAdapter {
  readonly list: (options?: { readonly refresh?: boolean }) => Promise<AgentProviderCatalog>;
  readonly resolveExecutionProfile: (
    requested: AgentExecutionProfile,
  ) => Promise<AgentExecutionProfile>;
  readonly ensureRuntimeReady: () => Promise<void>;
}

export const makeAgentProviderRuntimePromiseAdapter = (
  runtime: AgentProviderRuntime["Service"],
  callbacks: ScopedCallbackRuntime["Service"],
): AgentProviderRuntimePromiseAdapter => ({
  list: (options) => callbacks.runPromise(runtime.list(options)),
  resolveExecutionProfile: (requested) =>
    callbacks.runPromise(runtime.resolveExecutionProfile(requested)),
  ensureRuntimeReady: () => callbacks.runPromise(runtime.ensureRuntimeReady),
});
