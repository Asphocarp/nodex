import { resolveRendererTransport } from "./renderer-transport";
import { ProjectionInvalidationRegistry } from "./projection-invalidation-registry";

let rendererRegistry: ProjectionInvalidationRegistry | null = null;

/**
 * Renderer-lifetime projection authority. External stores are not owned by a
 * React tree, so their causal subscriptions must not depend on Provider
 * mount/cleanup ordering (including StrictMode's lifecycle probe).
 */
export const getRendererProjectionInvalidationRegistry = () => {
  rendererRegistry ??= new ProjectionInvalidationRegistry({
    subscribeProjection: (scope, listener) =>
      resolveRendererTransport().subscribeProjectionStream(scope, listener),
    subscribeRevocations: (scope, listener) =>
      resolveRendererTransport().subscribeResourceRevocations(scope, listener),
  });
  return rendererRegistry;
};
