import type { ScopedCallbackRuntime } from "../app/ScopedCallbackRuntime";
import type { RendererClientRequestPromisePort } from "../codex/renderer-client-runtime-contracts";
import type { RendererClientRuntime } from "./RendererClientRuntime";

/**
 * Temporary projection for legacy callers whose own interface is still
 * Promise-based. It owns no state, timer, listener, or request lifecycle.
 */
export const makeRendererClientRequestPromiseAdapter = (
  runtime: RendererClientRuntime["Service"],
  callbacks: ScopedCallbackRuntime["Service"],
): RendererClientRequestPromisePort => ({
  sendRequest: (targetClientId, method, params, options) =>
    callbacks.runPromise(runtime.request(targetClientId, method, params, options)),
});
