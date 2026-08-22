import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as Data from "effect/Data";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as FiberHandle from "effect/FiberHandle";
import * as FiberMap from "effect/FiberMap";
import * as Option from "effect/Option";
import * as Semaphore from "effect/Semaphore";
import type * as Scope from "effect/Scope";
import type {
  CodexSidebarRefreshPolicy,
  CodexSidebarRefreshReason,
  CodexSidebarSnapshot,
  CodexSidebarSyncResult,
} from "../../shared/types";

export const DEFAULT_CODEX_SIDEBAR_SYNC_STALE_AFTER = "1 minute";
export const DEFAULT_CODEX_SIDEBAR_SYNC_BACKOFF_INITIAL = "2 seconds";
export const DEFAULT_CODEX_SIDEBAR_SYNC_BACKOFF_MAX = "1 minute";
export const DEFAULT_CODEX_SIDEBAR_NOTIFICATION_SYNC_DEBOUNCE = "300 millis";

export interface CodexSidebarSyncMetadata {
  readonly changedProjectIds: readonly string[];
  readonly projectlessChanged: boolean;
  readonly materializedSessionIds: readonly string[];
  readonly failedThreadIds: readonly string[];
}

export interface CodexSidebarSyncInput {
  readonly includeArchived?: boolean;
  readonly policy?: CodexSidebarRefreshPolicy;
  readonly reason?: CodexSidebarRefreshReason;
}

export interface CodexSidebarProjectionInput {
  readonly includeArchived: boolean;
  readonly source: "core" | "app-server";
  readonly refreshed: boolean;
  readonly refreshedAt?: number;
  readonly metadata: CodexSidebarSyncMetadata;
  readonly reason: CodexSidebarRefreshReason;
  readonly forceEmit?: boolean;
}

export interface CodexSidebarSyncNotification {
  readonly notificationMethod: string;
  readonly threadId: string;
}

export interface CodexSidebarSyncDecisionEvent {
  readonly decision:
    | "read"
    | "fresh-cache-hit"
    | "backoff-stale-last-known"
    | "join-in-flight"
    | "refresh";
  readonly policy: CodexSidebarRefreshPolicy;
  readonly reason: CodexSidebarRefreshReason;
  readonly includeArchived: boolean;
  readonly result: CodexSidebarSyncResult;
  readonly durationMs: number;
  readonly cacheAgeMs?: number;
  readonly backoffRemainingMs?: number;
}

export interface CodexSidebarRefreshOutcomeEvent {
  readonly outcome: "success" | "error";
  readonly reason: CodexSidebarRefreshReason;
  readonly includeArchived: boolean;
  readonly durationMs: number;
  readonly result?: CodexSidebarSyncResult;
  readonly error?: unknown;
  readonly nextBackoffMs?: number;
}

export class CodexSidebarSyncError extends Data.TaggedError("CodexSidebarSyncError")<{
  readonly cause: unknown;
}> {}

export interface CodexSidebarSyncRuntimeOptions {
  readonly refresh: (input: {
    readonly includeArchived: boolean;
    readonly reason: CodexSidebarRefreshReason;
  }) => Effect.Effect<CodexSidebarSyncMetadata, CodexSidebarSyncError>;
  readonly buildSnapshot: (
    includeArchived: boolean,
    revision: number,
  ) => Effect.Effect<CodexSidebarSnapshot, CodexSidebarSyncError>;
  readonly emit: (result: CodexSidebarSyncResult, reason: CodexSidebarRefreshReason) => void;
  readonly subscribeInvalidation?: (
    invalidate: () => void,
  ) => Effect.Effect<void, never, Scope.Scope>;
  readonly observeDecision?: (event: CodexSidebarSyncDecisionEvent) => void;
  readonly observeRefresh?: (event: CodexSidebarRefreshOutcomeEvent) => void;
  readonly observeNotificationScheduled?: (
    request: CodexSidebarSyncNotification & { readonly minimumSyncGeneration: number },
  ) => void;
  readonly staleAfter?: Duration.Input;
  readonly backoffInitial?: Duration.Input;
  readonly backoffMax?: Duration.Input;
  readonly notificationDebounce?: Duration.Input;
}

export class CodexSidebarSyncRuntime extends Context.Service<
  CodexSidebarSyncRuntime,
  {
    readonly sync: (
      input?: CodexSidebarSyncInput,
    ) => Effect.Effect<CodexSidebarSyncResult, CodexSidebarSyncError>;
    readonly publish: (
      input: CodexSidebarProjectionInput,
    ) => Effect.Effect<CodexSidebarSyncResult, CodexSidebarSyncError>;
    readonly invalidate: () => void;
    readonly scheduleNotification: (request: CodexSidebarSyncNotification) => void;
  }
>()("nodex/main/codex-application/CodexSidebarSyncRuntime") {}

interface SidebarCacheEntry {
  readonly revision: number;
  readonly snapshot: CodexSidebarSnapshot;
}

interface SidebarCatalogState {
  lastSuccessfulGeneration: number;
  lastOutcomeGeneration: number;
  lastSuccessfulRefreshAt: number;
  failureBackoffUntil: number;
  failureBackoffMs: number;
  lastFailure: CodexSidebarSyncError | null;
}

const emptyMetadata: CodexSidebarSyncMetadata = {
  changedProjectIds: [],
  projectlessChanged: false,
  materializedSessionIds: [],
  failedThreadIds: [],
};

const shouldEmit = (result: CodexSidebarSyncResult): boolean =>
  !(
    !result.refreshed &&
    result.changedProjectIds.length === 0 &&
    !result.projectlessChanged &&
    result.materializedSessionIds.length === 0 &&
    result.failedThreadIds.length === 0
  );

export const make = (
  options: CodexSidebarSyncRuntimeOptions,
): Effect.Effect<CodexSidebarSyncRuntime["Service"], never, Scope.Scope> =>
  Effect.gen(function* () {
    const refreshes = yield* FiberMap.make<
      boolean,
      CodexSidebarSyncResult,
      CodexSidebarSyncError
    >();
    const refreshAdmission = yield* Semaphore.make(1);
    const notificationRepair = yield* FiberHandle.make<void, never>();
    const runNotificationRepair = yield* FiberHandle.runtime(notificationRepair)();
    const cache = new Map<boolean, SidebarCacheEntry>();
    const catalogStates = new Map<boolean, SidebarCatalogState>();
    const staleAfterMs = Duration.toMillis(
      options.staleAfter ?? DEFAULT_CODEX_SIDEBAR_SYNC_STALE_AFTER,
    );
    const backoffInitialMs = Duration.toMillis(
      options.backoffInitial ?? DEFAULT_CODEX_SIDEBAR_SYNC_BACKOFF_INITIAL,
    );
    const backoffMaxMs = Duration.toMillis(
      options.backoffMax ?? DEFAULT_CODEX_SIDEBAR_SYNC_BACKOFF_MAX,
    );
    let revision = 0;
    let generation = 0;

    const stateFor = (includeArchived: boolean): SidebarCatalogState => {
      const existing = catalogStates.get(includeArchived);
      if (existing) return existing;
      const state: SidebarCatalogState = {
        lastSuccessfulGeneration: 0,
        lastOutcomeGeneration: 0,
        lastSuccessfulRefreshAt: 0,
        failureBackoffUntil: 0,
        failureBackoffMs: backoffInitialMs,
        lastFailure: null,
      };
      catalogStates.set(includeArchived, state);
      return state;
    };

    const cachedResult = (input: {
      readonly includeArchived: boolean;
      readonly requireCurrentRevision: boolean;
      readonly source: "core" | "stale-last-known";
    }): CodexSidebarSyncResult | null => {
      const entry = cache.get(input.includeArchived);
      if (!entry) return null;
      if (input.requireCurrentRevision && entry.revision !== revision) return null;
      const state = stateFor(input.includeArchived);
      return {
        snapshot: entry.snapshot,
        source: input.source,
        refreshed: false,
        refreshedAt: state.lastSuccessfulRefreshAt,
        changedProjectIds: [],
        projectlessChanged: false,
        materializedSessionIds: [],
        failedThreadIds: [],
      };
    };

    const project = (
      input: CodexSidebarProjectionInput,
    ): Effect.Effect<CodexSidebarSyncResult, CodexSidebarSyncError> =>
      Effect.gen(function* () {
        const revisionAtStart = revision;
        const snapshot = yield* options.buildSnapshot(input.includeArchived, revisionAtStart);
        const state = stateFor(input.includeArchived);
        const result: CodexSidebarSyncResult = {
          snapshot,
          source: input.source,
          refreshed: input.refreshed,
          refreshedAt: input.refreshedAt ?? state.lastSuccessfulRefreshAt,
          changedProjectIds: [...input.metadata.changedProjectIds],
          projectlessChanged: input.metadata.projectlessChanged,
          materializedSessionIds: [...input.metadata.materializedSessionIds],
          failedThreadIds: [...input.metadata.failedThreadIds],
        };
        cache.set(input.includeArchived, { revision: revisionAtStart, snapshot });
        if (input.forceEmit || shouldEmit(result)) options.emit(result, input.reason);
        return result;
      });

    const recordSuccess = (
      includeArchived: boolean,
      completedGeneration: number,
      refreshedAt: number,
    ): void => {
      const state = stateFor(includeArchived);
      state.lastSuccessfulGeneration = Math.max(
        state.lastSuccessfulGeneration,
        completedGeneration,
      );
      state.lastSuccessfulRefreshAt = Math.max(state.lastSuccessfulRefreshAt, refreshedAt);
      if (completedGeneration < state.lastOutcomeGeneration) return;
      state.lastOutcomeGeneration = completedGeneration;
      state.failureBackoffMs = backoffInitialMs;
      state.failureBackoffUntil = 0;
      state.lastFailure = null;
    };

    const recordFailure = (
      includeArchived: boolean,
      completedGeneration: number,
      error: CodexSidebarSyncError,
      failedAt: number,
    ): number => {
      const state = stateFor(includeArchived);
      if (completedGeneration < state.lastOutcomeGeneration) return state.failureBackoffMs;
      state.lastOutcomeGeneration = completedGeneration;
      state.lastFailure = error;
      state.failureBackoffUntil = failedAt + state.failureBackoffMs;
      state.failureBackoffMs = Math.min(state.failureBackoffMs * 2, backoffMaxMs);
      return state.failureBackoffMs;
    };

    const runRefresh = (input: {
      readonly includeArchived: boolean;
      readonly reason: CodexSidebarRefreshReason;
      readonly generation: number;
    }): Effect.Effect<CodexSidebarSyncResult, CodexSidebarSyncError> =>
      Effect.gen(function* () {
        const startedAt = yield* Clock.currentTimeMillis;
        const attempt = yield* options
          .refresh({ includeArchived: input.includeArchived, reason: input.reason })
          .pipe(Effect.result);
        if (attempt._tag === "Failure") {
          const failedAt = yield* Clock.currentTimeMillis;
          const nextBackoffMs = recordFailure(
            input.includeArchived,
            input.generation,
            attempt.failure,
            failedAt,
          );
          const fallback = cachedResult({
            includeArchived: input.includeArchived,
            requireCurrentRevision: false,
            source: "stale-last-known",
          });
          options.observeRefresh?.({
            outcome: "error",
            reason: input.reason,
            includeArchived: input.includeArchived,
            durationMs: Math.max(0, failedAt - startedAt),
            ...(fallback ? { result: fallback } : {}),
            error: attempt.failure.cause,
            nextBackoffMs,
          });
          if (fallback) return fallback;
          return yield* Effect.fail(attempt.failure);
        }

        const refreshedAt = yield* Clock.currentTimeMillis;
        const projected = yield* project({
          includeArchived: input.includeArchived,
          source: "app-server",
          refreshed: true,
          refreshedAt,
          metadata: attempt.success,
          reason: input.reason,
        }).pipe(Effect.result);
        if (projected._tag === "Failure") {
          const failedAt = yield* Clock.currentTimeMillis;
          const nextBackoffMs = recordFailure(
            input.includeArchived,
            input.generation,
            projected.failure,
            failedAt,
          );
          const fallback = cachedResult({
            includeArchived: input.includeArchived,
            requireCurrentRevision: false,
            source: "stale-last-known",
          });
          options.observeRefresh?.({
            outcome: "error",
            reason: input.reason,
            includeArchived: input.includeArchived,
            durationMs: Math.max(0, failedAt - startedAt),
            ...(fallback ? { result: fallback } : {}),
            error: projected.failure.cause,
            nextBackoffMs,
          });
          if (fallback) return fallback;
          return yield* Effect.fail(projected.failure);
        }

        recordSuccess(input.includeArchived, input.generation, refreshedAt);
        options.observeRefresh?.({
          outcome: "success",
          reason: input.reason,
          includeArchived: input.includeArchived,
          durationMs: Math.max(0, refreshedAt - startedAt),
          result: projected.success,
        });
        return projected.success;
      });

    const acquireRefresh = (input: {
      readonly includeArchived: boolean;
      readonly reason: CodexSidebarRefreshReason;
    }) =>
      refreshAdmission.withPermits(1)(
        Effect.gen(function* () {
          const existing = yield* FiberMap.get(refreshes, input.includeArchived);
          if (Option.isSome(existing)) return { fiber: existing.value, joined: true } as const;
          const refreshGeneration = ++generation;
          const fiber = yield* FiberMap.run(
            refreshes,
            input.includeArchived,
            runRefresh({ ...input, generation: refreshGeneration }),
            { startImmediately: true },
          );
          return { fiber, joined: false } as const;
        }),
      );

    const sync = (
      input: CodexSidebarSyncInput = {},
    ): Effect.Effect<CodexSidebarSyncResult, CodexSidebarSyncError> =>
      Effect.gen(function* () {
        const startedAt = yield* Clock.currentTimeMillis;
        const includeArchived = input.includeArchived === true;
        const policy = input.policy ?? "stale";
        const reason = input.reason ?? "manual";
        const state = stateFor(includeArchived);
        const finish = (
          decision: CodexSidebarSyncDecisionEvent["decision"],
          result: CodexSidebarSyncResult,
          extra: Pick<CodexSidebarSyncDecisionEvent, "cacheAgeMs" | "backoffRemainingMs"> = {},
        ): Effect.Effect<CodexSidebarSyncResult> =>
          Clock.currentTimeMillis.pipe(
            Effect.map((completedAt) => {
              options.observeDecision?.({
                decision,
                policy,
                reason,
                includeArchived,
                result,
                durationMs: Math.max(0, completedAt - startedAt),
                ...extra,
              });
              return result;
            }),
          );

        if (policy === "read") {
          return yield* finish(
            "read",
            yield* project({
              includeArchived,
              source: "core",
              refreshed: false,
              refreshedAt: state.lastSuccessfulRefreshAt,
              metadata: emptyMetadata,
              reason,
            }),
          );
        }

        const now = yield* Clock.currentTimeMillis;
        const isFresh =
          state.lastSuccessfulGeneration > 0 && now - state.lastSuccessfulRefreshAt < staleAfterMs;
        if (policy === "stale" && isFresh && state.failureBackoffUntil <= now) {
          const cached = cachedResult({
            includeArchived,
            requireCurrentRevision: true,
            source: "core",
          });
          if (cached) {
            return yield* finish("fresh-cache-hit", cached, {
              cacheAgeMs: now - state.lastSuccessfulRefreshAt,
            });
          }
        }

        if (policy === "stale" && state.failureBackoffUntil > now) {
          const cached = cachedResult({
            includeArchived,
            requireCurrentRevision: false,
            source: "stale-last-known",
          });
          if (cached) {
            return yield* finish("backoff-stale-last-known", cached, {
              backoffRemainingMs: state.failureBackoffUntil - now,
            });
          }
          return yield* Effect.fail(
            state.lastFailure ?? new CodexSidebarSyncError({ cause: new Error("Core is busy") }),
          );
        }

        const acquired = yield* acquireRefresh({ includeArchived, reason });
        return yield* finish(
          acquired.joined ? "join-in-flight" : "refresh",
          yield* Fiber.join(acquired.fiber),
        );
      });

    const repairAfterNotification = (
      minimumSyncGeneration: number,
    ): Effect.Effect<void, CodexSidebarSyncError> =>
      Effect.gen(function* () {
        const state = stateFor(false);
        if (state.lastSuccessfulGeneration >= minimumSyncGeneration) return;
        const current = yield* refreshAdmission.withPermits(1)(FiberMap.get(refreshes, false));
        if (Option.isSome(current)) {
          yield* Fiber.join(current.value).pipe(Effect.ignore);
        }
        if (state.lastSuccessfulGeneration >= minimumSyncGeneration) return;
        yield* sync({ policy: "force", reason: "host-message" });
      });

    const scheduleNotification = (request: CodexSidebarSyncNotification): void => {
      const minimumSyncGeneration = generation + 1;
      options.observeNotificationScheduled?.({ ...request, minimumSyncGeneration });
      runNotificationRepair(
        Effect.sleep(
          options.notificationDebounce ?? DEFAULT_CODEX_SIDEBAR_NOTIFICATION_SYNC_DEBOUNCE,
        ).pipe(
          Effect.andThen(repairAfterNotification(minimumSyncGeneration)),
          Effect.catch((error) =>
            Effect.logDebug("Sidebar notification sync failed").pipe(
              Effect.annotateLogs({
                cause: String(error.cause),
                notificationMethod: request.notificationMethod,
                threadId: request.threadId,
              }),
            ),
          ),
        ),
      );
    };

    const invalidate = (): void => {
      revision += 1;
    };

    if (options.subscribeInvalidation) yield* options.subscribeInvalidation(invalidate);
    yield* Effect.addFinalizer(() =>
      Effect.sync(() => {
        cache.clear();
        catalogStates.clear();
      }),
    );

    return CodexSidebarSyncRuntime.of({
      sync,
      publish: project,
      invalidate,
      scheduleNotification,
    });
  });
