import {
  type Query,
  type QueryCacheNotifyEvent,
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

interface IndexedAuthorityQuery {
  readonly queryHash: string;
  readonly queryKey: QueryKey;
  readonly resolution: ResourceAuthorityQueryResolution;
}

/**
 * Keeps revocation subscriptions alive for authorization-bearing query cache
 * entries, including entries whose React surface is currently unmounted.
 */
export class ResourceAuthorityQueryCache {
  readonly #queryClient: QueryClient;
  readonly #registry: ProjectionInvalidationRegistry;
  readonly #scopeRegistrations = new Map<string, ScopeRegistration>();
  readonly #indexedQueries = new Map<string, IndexedAuthorityQuery>();
  readonly #queriesByScope = new Map<string, Map<string, IndexedAuthorityQuery>>();
  #releaseCacheSubscription: (() => void) | null = null;

  constructor(input: {
    readonly queryClient: QueryClient;
    readonly registry: ProjectionInvalidationRegistry;
  }) {
    this.#queryClient = input.queryClient;
    this.#registry = input.registry;
  }

  start(): () => void {
    if (this.#releaseCacheSubscription) return () => this.dispose();
    for (const query of this.#queryClient.getQueryCache().getAll()) {
      this.#indexQuery(query);
    }
    this.#releaseCacheSubscription = this.#queryClient
      .getQueryCache()
      .subscribe((event) => this.#handleCacheEvent(event));
    return () => this.dispose();
  }

  dispose(): void {
    this.#releaseCacheSubscription?.();
    this.#releaseCacheSubscription = null;
    for (const registration of this.#scopeRegistrations.values()) {
      registration.release();
    }
    this.#scopeRegistrations.clear();
    this.#indexedQueries.clear();
    this.#queriesByScope.clear();
  }

  #handleCacheEvent(event: QueryCacheNotifyEvent): void {
    if (event.type === "removed") {
      this.#removeIndexedQuery(event.query.queryHash);
      return;
    }
    this.#indexQuery(event.query);
  }

  #indexQuery(query: Query): void {
    const metadata = metadataFrom(query.meta);
    const resolution = metadata?.resolve(query.queryKey, query.state.data);
    if (!resolution) {
      this.#removeIndexedQuery(query.queryHash);
      return;
    }

    const key = projectionScopeKey(resolution.scope);
    const indexed = {
      queryHash: query.queryHash,
      queryKey: query.queryKey,
      resolution,
    } satisfies IndexedAuthorityQuery;
    const existing = this.#indexedQueries.get(query.queryHash);
    if (
      existing
      && projectionScopeKey(existing.resolution.scope) === key
    ) {
      this.#indexedQueries.set(query.queryHash, indexed);
      const scoped = this.#queriesByScope.get(key);
      if (scoped) scoped.set(query.queryHash, indexed);
      this.#ensureScopeRegistration(key, resolution.scope);
      return;
    }

    this.#removeIndexedQuery(query.queryHash);
    const scoped = this.#queriesByScope.get(key)
      ?? new Map<string, IndexedAuthorityQuery>();
    scoped.set(query.queryHash, indexed);
    this.#queriesByScope.set(key, scoped);
    this.#indexedQueries.set(query.queryHash, indexed);
    this.#ensureScopeRegistration(key, resolution.scope);
  }

  #removeIndexedQuery(queryHash: string): void {
    const indexed = this.#indexedQueries.get(queryHash);
    if (!indexed) return;
    this.#indexedQueries.delete(queryHash);
    const key = projectionScopeKey(indexed.resolution.scope);
    const scoped = this.#queriesByScope.get(key);
    scoped?.delete(queryHash);
    if (scoped && scoped.size > 0) return;
    this.#queriesByScope.delete(key);
    this.#scopeRegistrations.get(key)?.release();
    this.#scopeRegistrations.delete(key);
  }

  #ensureScopeRegistration(key: string, scope: ProjectionScope): void {
    if (this.#scopeRegistrations.has(key)) return;
    // Registration may synchronously deliver the initial checkpoint. Install
    // a placeholder first so a resulting cache event cannot double-register.
    this.#scopeRegistrations.set(key, { release: () => undefined });
    const release = this.#registry.register({
      scope,
      consumerKey: `resource-authority-query-cache:${key}`,
      projectionEffects: "ignore",
      getDependencies: () => ({ aggregate: true }),
      getCursor: () => this.#scopeCursor(key),
      revoke: (cause) => {
        for (const indexed of this.#scopeQueries(key)) {
          if (!revocationMatches(
            indexed.resolution.dependencies,
            cause.delivery.revocation,
          )) continue;
          this.#evictIndexedQuery(indexed);
        }
      },
      fence: (cause) => {
        for (const indexed of this.#scopeQueries(key)) {
          if (
            cause.kind === "checkpoint"
            && projectionCursorCovers(indexed.resolution.cursor, cause.stream)
          ) continue;
          this.#evictIndexedQuery(indexed);
        }
      },
      invalidate: () => undefined,
    });
    if (!this.#queriesByScope.has(key)) {
      release();
      this.#scopeRegistrations.delete(key);
      return;
    }
    this.#scopeRegistrations.set(key, { release });
  }

  #scopeQueries(key: string): IndexedAuthorityQuery[] {
    return [...(this.#queriesByScope.get(key)?.values() ?? [])];
  }

  #evictIndexedQuery(indexed: IndexedAuthorityQuery): void {
    evictExactQuery(this.#queryClient, indexed.queryKey);
    for (const relatedQueryKey of indexed.resolution.relatedQueryKeys ?? []) {
      evictExactQuery(this.#queryClient, relatedQueryKey);
    }
  }

  #scopeCursor(key: string): ProjectionCursor | null {
    const cursors = this.#scopeQueries(key)
      .map((indexed) => indexed.resolution.cursor);
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
