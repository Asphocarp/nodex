import type { BrowserRuntimeBackend } from "../../shared/browser-runtime-metadata";

export function resolveAvailableBrowserUseBackends(
  supportedBackends: readonly BrowserRuntimeBackend[],
  requestedBackends: readonly BrowserRuntimeBackend[],
): BrowserRuntimeBackend[] {
  const supported = new Set(supportedBackends);
  return requestedBackends.filter(
    (backend, index) => supported.has(backend) && requestedBackends.indexOf(backend) === index,
  );
}
