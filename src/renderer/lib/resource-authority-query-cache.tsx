import {
  type QueryClient,
  type QueryKey,
  useQueryClient,
} from "@tanstack/react-query";
import { useEffect } from "react";

import {
  projectionCursorCovers,
  projectionScopeKey,
  type ProjectionCursor,
  type ProjectionScope,
} from "../../shared/projection-stream";
import { useProjectionInvalidationRegistry } from "./projection-invalidation-context";
import {
  revocationMatches,
  type ProjectionDependencies,
  type ProjectionInvalidationRegistry,
} from "./projection-invalidation-registry";

const RESOURCE_AUTHORITY_META_KEY = "nodexResourceAuthority";

export interface ResourceAuthorityQueryResolution {
  readonly scope: ProjectionScope;
  readonly dependencies: ProjectionDependencies;
  readonly cursor: ProjectionCursor;
  /** Additional cached resources invalidated by the same authority loss. */
  readonly relatedQueryKeys?: readonly QueryKey[];
}

export interface ResourceAuthorityQueryMetadata {
  readonly resolve: (
    queryKey: QueryKey,
    data: unknown,
  ) => ResourceAuthorityQueryResolution | null;
}

export const resourceAuthorityQueryMeta = (
  resolve: ResourceAuthorityQueryMetadata["resolve"],
): Record<string, unknown> => ({
  [RESOURCE_AUTHORITY_META_KEY]: { resolve } satisfies ResourceAuthorityQueryMetadata,
});

const metadataFrom = (meta: unknown): ResourceAuthorityQueryMetadata | null => {
  if (!meta || typeof meta !== "object") return null;
  const candidate = (meta as Record<string, unknown>)[RESOURCE_AUTHORITY_META_KEY];
  if (!candidate || typeof candidate !== "object") return null;
  const resolve = (candidate as Partial<ResourceAuthorityQueryMetadata>).resolve;
  return typeof resolve === "function" ? { resolve } : null;
};

const evictExactQuery = (
  queryClient: QueryClient,
  queryKey: QueryKey,
): void => {
  const query = queryClient.getQueryCache().find({ queryKey, exact: true });
  if (!query) return;
  if (query.getObserversCount() === 0) {
    queryClient.removeQueries({ queryKey, exact: true });
    return;
  }
  // resetQueries synchronously removes current data and cancels the old read;
  // its returned promise only represents the canonical trailing refetch.
  void queryClient.resetQueries({ queryKey, exact: true }).catch(() => undefined);
};

interface ScopeRegistration {
  readonly release: () => void;
}

/**
 * Keeps revocation subscriptions alive for authorization-bearing query cache
 * entries, including entries whose React surface is currently unmounted.
 */
export class ResourceAuthorityQueryCache {
  readonly #queryClient: QueryClient;
  readonly #registry: ProjectionInvalidationRegistry;
  readonly #scopeRegistrations = new Map<string, ScopeRegistration>();
  #releaseCacheSubscription: (() => void) | null = null;
  #reconciling = false;
  #reconcileAgain = false;

  constructor(input: {
    readonly queryClient: QueryClient;
    readonly registry: ProjectionInvalidationRegistry;
  }) {
    this.#queryClient = input.queryClient;
    this.#registry = input.registry;
  }

  start(): () => void {
    if (this.#releaseCacheSubscription) return () => this.dispose();
    this.#reconcileScopes();
    this.#releaseCacheSubscription = this.#queryClient
      .getQueryCache()
      .subscribe(() => this.#reconcileScopes());
    return () => this.dispose();
  }

  dispose(): void {
    this.#releaseCacheSubscription?.();
    this.#releaseCacheSubscription = null;
    for (const registration of this.#scopeRegistrations.values()) {
      registration.release();
    }
    this.#scopeRegistrations.clear();
  }

  #reconcileScopes(): void {
    if (this.#reconciling) {
      this.#reconcileAgain = true;
      return;
    }
    this.#reconciling = true;
    try {
      do {
        this.#reconcileAgain = false;
        const desired = new Map<string, ProjectionScope>();
        for (const query of this.#queryClient.getQueryCache().getAll()) {
          const metadata = metadataFrom(query.meta);
          const resolution = metadata?.resolve(query.queryKey, query.state.data);
          if (!resolution) continue;
          desired.set(projectionScopeKey(resolution.scope), resolution.scope);
        }

        for (const [key, registration] of this.#scopeRegistrations) {
          if (desired.has(key)) continue;
          registration.release();
          this.#scopeRegistrations.delete(key);
        }
        for (const [key, scope] of desired) {
          if (this.#scopeRegistrations.has(key)) continue;
          const release = this.#registry.register({
            scope,
            consumerKey: `resource-authority-query-cache:${key}`,
            projectionEffects: "ignore",
            getDependencies: () => ({ aggregate: true }),
            getCursor: () => this.#scopeCursor(key),
            revoke: (cause) => {
              for (const query of this.#queryClient.getQueryCache().getAll()) {
                const metadata = metadataFrom(query.meta);
                const resolution = metadata?.resolve(query.queryKey, query.state.data);
                if (!resolution) continue;
                if (projectionScopeKey(resolution.scope) !== key) continue;
                if (!revocationMatches(
                  resolution.dependencies,
                  cause.delivery.revocation,
                )) continue;
                evictExactQuery(this.#queryClient, query.queryKey);
                for (const relatedQueryKey of resolution.relatedQueryKeys ?? []) {
                  evictExactQuery(this.#queryClient, relatedQueryKey);
                }
              }
            },
            fence: (cause) => {
              for (const query of this.#queryClient.getQueryCache().getAll()) {
                const metadata = metadataFrom(query.meta);
                const resolution = metadata?.resolve(query.queryKey, query.state.data);
                if (!resolution) continue;
                if (projectionScopeKey(resolution.scope) !== key) continue;
                if (
                  cause.kind === "checkpoint"
                  && projectionCursorCovers(resolution.cursor, cause.stream)
                ) continue;
                evictExactQuery(this.#queryClient, query.queryKey);
                for (const relatedQueryKey of resolution.relatedQueryKeys ?? []) {
                  evictExactQuery(this.#queryClient, relatedQueryKey);
                }
              }
            },
            invalidate: () => undefined,
          });
          this.#scopeRegistrations.set(key, { release });
        }
      } while (this.#reconcileAgain);
    } finally {
      this.#reconciling = false;
    }
  }

  #scopeCursor(key: string): ProjectionCursor | null {
    const cursors: ProjectionCursor[] = [];
    for (const query of this.#queryClient.getQueryCache().getAll()) {
      const metadata = metadataFrom(query.meta);
      const resolution = metadata?.resolve(query.queryKey, query.state.data);
      if (!resolution || projectionScopeKey(resolution.scope) !== key) continue;
      cursors.push(resolution.cursor);
    }
    const storeEpoch = cursors[0]?.storeEpoch;
    if (!storeEpoch || cursors.some((cursor) => cursor.storeEpoch !== storeEpoch)) {
      return null;
    }
    return {
      storeEpoch,
      commitSeq: Math.min(...cursors.map((cursor) => cursor.commitSeq)),
    };
  }
}

export function ResourceAuthorityQueryCacheBridge(): null {
  const queryClient = useQueryClient();
  const registry = useProjectionInvalidationRegistry();
  useEffect(() => {
    const cache = new ResourceAuthorityQueryCache({ queryClient, registry });
    return cache.start();
  }, [queryClient, registry]);
  return null;
}
