import * as Context from "effect/Context";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as FiberMap from "effect/FiberMap";
import * as FiberSet from "effect/FiberSet";
import * as PubSub from "effect/PubSub";
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";
import type * as Scope from "effect/Scope";
import * as Semaphore from "effect/Semaphore";
import * as Stream from "effect/Stream";
import type {
  CodexPendingWorktreeEntry,
  CodexPendingWorktreeRequest,
  CodexPendingWorktreeThreadResolution,
} from "../../shared/codex-pending-worktree";
import {
  createCodexPendingWorktreeState,
  getCodexPendingWorktreeSnapshot,
  reduceCodexPendingWorktreeState,
  resolveCodexPendingWorktreeThread,
  type CodexPendingWorktreeAction,
  type CodexPendingWorktreeEffect,
  type CodexPendingWorktreeMetadataUpdate,
  type CodexPendingWorktreeState,
} from "../codex/codex-pending-worktree-state";
import type { CodexWorktreeWorkerEvent } from "../codex/codex-worktree-worker-protocol";

export interface CodexPendingWorktreeCreationResult {
  readonly worktreeGitRoot: string;
  readonly worktreeWorkspaceRoot: string;
  readonly setupError?: string | null;
}

export class CodexPendingWorktreeEffectError extends Schema.TaggedError<CodexPendingWorktreeEffectError>()(
  "CodexPendingWorktreeEffectError",
  {
    operation: Schema.String,
    cause: Schema.Defect(),
  },
) {}

export class CodexPendingWorktreeRuntimeError extends Schema.TaggedError<CodexPendingWorktreeRuntimeError>()(
  "CodexPendingWorktreeRuntimeError",
  {
    operation: Schema.String,
    pendingWorktreeId: Schema.String,
    message: Schema.String,
    cause: Schema.Defect(),
  },
) {}

export interface CodexPendingWorktreeRuntimeOptions {
  readonly createWorktree: (
    entry: CodexPendingWorktreeEntry,
    onEvent: (event: CodexWorktreeWorkerEvent) => void,
  ) => Effect.Effect<CodexPendingWorktreeCreationResult, CodexPendingWorktreeEffectError>;
  readonly launchConversation: (
    entry: CodexPendingWorktreeEntry,
    workspaceRoot: string,
    context: {
      readonly onThreadCreated: (threadId: string) => void;
      readonly includeWorktreeInit: boolean;
    },
  ) => Effect.Effect<{ readonly threadId: string }, CodexPendingWorktreeEffectError>;
  readonly removeWorktree: (
    hostId: string,
    worktreeGitRoot: string,
  ) => Effect.Effect<void, CodexPendingWorktreeEffectError>;
  readonly cleanupGoalSources: (
    entry: CodexPendingWorktreeEntry,
  ) => Effect.Effect<void, CodexPendingWorktreeEffectError>;
  readonly registerStableProject: (
    workspaceRoots: readonly string[],
    label: string,
  ) => Effect.Effect<void, CodexPendingWorktreeEffectError>;
}

export class CodexPendingWorktreeRuntime extends Context.Service<
  CodexPendingWorktreeRuntime,
  {
    /** Synchronous immutable projection for the remaining callback-driven Codex application. */
    readonly list: () => readonly CodexPendingWorktreeEntry[];
    readonly resolveThread: (clientThreadId: string) => CodexPendingWorktreeThreadResolution | null;
    readonly changes: Stream.Stream<readonly CodexPendingWorktreeEntry[]>;
    readonly create: (request: CodexPendingWorktreeRequest, createdAt?: number) => void;
    readonly retry: (pendingWorktreeId: string) => void;
    readonly workLocally: (
      pendingWorktreeId: string,
    ) => Effect.Effect<{ readonly threadId: string }, CodexPendingWorktreeRuntimeError>;
    readonly continueWithoutSetup: (pendingWorktreeId: string) => void;
    readonly cancel: (pendingWorktreeId: string) => void;
    readonly dismiss: (pendingWorktreeId: string) => void;
    readonly rename: (pendingWorktreeId: string, label: string) => void;
    readonly setPinned: (pendingWorktreeId: string, isPinned: boolean) => void;
    readonly setPinnedBeforeThreadId: (
      pendingWorktreeId: string,
      beforeThreadId: string | null,
    ) => void;
    readonly clearAttention: (pendingWorktreeId: string) => void;
  }
>()("nodex/main/codex-application/CodexPendingWorktreeRuntime") {}

type CodexPendingWorktreeProgressAction = Extract<
  CodexPendingWorktreeAction,
  { readonly type: "appendOutput" | "setupStarted" }
>;

const failureMessage = (cause: unknown): string => {
  if (cause instanceof Error && cause.message.trim()) return cause.message;
  if (typeof cause === "object" && cause !== null && "cause" in cause && cause.cause !== cause) {
    return failureMessage(cause.cause);
  }
  return String(cause);
};

const runtimeError = (
  operation: string,
  pendingWorktreeId: string,
  cause: unknown,
): CodexPendingWorktreeRuntimeError =>
  new CodexPendingWorktreeRuntimeError({
    operation,
    pendingWorktreeId,
    message: failureMessage(cause),
    cause,
  });

function assertNeverCodexPendingWorktreeRuntimeVariant(value: never, owner: string): never {
  throw new Error(`Unhandled ${owner}: ${JSON.stringify(value)}`);
}

/** Projects transport progress into the pure pending-worktree reducer vocabulary. */
export function projectCodexWorktreeWorkerEventToPendingAction(
  identity: {
    readonly pendingWorktreeId: string;
    readonly attempt: number;
  },
  event: CodexWorktreeWorkerEvent,
): CodexPendingWorktreeProgressAction | null {
  if (event.operation !== "create") return null;
  switch (event.type) {
    case "output":
      if (!event.data || (event.phase !== "worktree" && event.phase !== "setup")) return null;
      return {
        type: "appendOutput",
        pendingWorktreeId: identity.pendingWorktreeId,
        attempt: identity.attempt,
        phase: event.phase,
        output: event.data,
      };
    case "path-allocated":
      return null;
    case "setup-started":
      return {
        type: "setupStarted",
        pendingWorktreeId: identity.pendingWorktreeId,
        attempt: identity.attempt,
      };
  }
}

export const make = (
  options: CodexPendingWorktreeRuntimeOptions,
): Effect.Effect<CodexPendingWorktreeRuntime["Service"], never, Scope.Scope> =>
  Effect.gen(function* () {
    let accepting = true;
    let state: CodexPendingWorktreeState = createCodexPendingWorktreeState();
    let snapshot: readonly CodexPendingWorktreeEntry[] = [];
    const changes = yield* PubSub.unbounded<readonly CodexPendingWorktreeEntry[]>();
    const attemptFibers = yield* FiberMap.make<string, void>();
    const launchFibers = yield* FiberMap.make<string, void>();
    const runBackground = yield* FiberSet.makeRuntime<never, void, never>();
    const localLaunchAdmission = yield* Semaphore.make(1);
    const localLaunches = new Map<
      string,
      Deferred.Deferred<{ readonly threadId: string }, CodexPendingWorktreeRuntimeError>
    >();

    const reportFailure = (
      phase: "create" | "launch" | "remove" | "cleanup-goal-sources" | "register-stable-project",
      error: CodexPendingWorktreeEffectError,
      pendingWorktreeId: string,
    ) =>
      Effect.logError("Pending worktree lifecycle failed").pipe(
        Effect.annotateLogs({
          cause: failureMessage(error.cause),
          pendingWorktreeId,
          phase,
        }),
      );

    const dispatch = (
      action: CodexPendingWorktreeAction,
    ): readonly CodexPendingWorktreeEffect[] => {
      if (!accepting) return [];
      const transition = reduceCodexPendingWorktreeState(state, action);
      if (transition.state !== state) {
        state = transition.state;
        snapshot = getCodexPendingWorktreeSnapshot(state);
        PubSub.publishUnsafe(changes, snapshot);
      }
      for (const effect of transition.effects) executeEffect(effect);
      return transition.effects;
    };

    const isCurrentAttempt = (pendingWorktreeId: string, attempt: number): boolean => {
      const entry = state.entriesById.get(pendingWorktreeId);
      return (
        accepting &&
        entry?.attempt === attempt &&
        (entry.phase === "queued" || entry.phase === "creating" || entry.phase === "setting-up")
      );
    };

    const removeBestEffort = (pendingWorktreeId: string, hostId: string, worktreeGitRoot: string) =>
      options
        .removeWorktree(hostId, worktreeGitRoot)
        .pipe(Effect.catch((error) => reportFailure("remove", error, pendingWorktreeId)));

    const startWorktree = Effect.fn("CodexPendingWorktreeRuntime.startWorktree")(function* (
      pendingWorktreeId: string,
      attempt: number,
    ) {
      const entry = state.entriesById.get(pendingWorktreeId);
      if (!entry || entry.attempt !== attempt) return;
      dispatch({ type: "start", pendingWorktreeId, attempt });
      const onEvent = (event: CodexWorktreeWorkerEvent): void => {
        if (!isCurrentAttempt(pendingWorktreeId, attempt)) return;
        const action = projectCodexWorktreeWorkerEventToPendingAction(
          { pendingWorktreeId, attempt },
          event,
        );
        if (action) dispatch(action);
      };
      yield* options.createWorktree(entry, onEvent).pipe(
        Effect.flatMap((result) => {
          if (!isCurrentAttempt(pendingWorktreeId, attempt)) {
            return removeBestEffort(pendingWorktreeId, entry.hostId, result.worktreeGitRoot);
          }
          if (result.setupError) {
            dispatch({
              type: "setupFailed",
              pendingWorktreeId,
              attempt,
              errorMessage: result.setupError,
              worktreeGitRoot: result.worktreeGitRoot,
              worktreeWorkspaceRoot: result.worktreeWorkspaceRoot,
            });
            return Effect.void;
          }
          dispatch({
            type: "worktreeReady",
            pendingWorktreeId,
            attempt,
            worktreeGitRoot: result.worktreeGitRoot,
            worktreeWorkspaceRoot: result.worktreeWorkspaceRoot,
          });
          return Effect.void;
        }),
        Effect.catch((error) => {
          if (!isCurrentAttempt(pendingWorktreeId, attempt)) return Effect.void;
          dispatch({
            type: "worktreeFailed",
            pendingWorktreeId,
            attempt,
            errorMessage: failureMessage(error.cause),
          });
          return reportFailure("create", error, pendingWorktreeId);
        }),
      );
    });

    const completeLocalLaunch = (
      pendingWorktreeId: string,
      completion:
        | { readonly _tag: "Success"; readonly threadId: string }
        | { readonly _tag: "Failure"; readonly error: CodexPendingWorktreeRuntimeError },
    ) =>
      Effect.gen(function* () {
        const pending = localLaunches.get(pendingWorktreeId);
        if (!pending) return;
        localLaunches.delete(pendingWorktreeId);
        if (completion._tag === "Success") {
          yield* Deferred.succeed(pending, { threadId: completion.threadId });
          return;
        }
        yield* Deferred.fail(pending, completion.error);
      });

    const launchConversation = Effect.fn("CodexPendingWorktreeRuntime.launchConversation")(
      function* (
        effect: Extract<CodexPendingWorktreeEffect, { readonly type: "launchConversation" }>,
      ) {
        const { attempt, entry, includeWorktreeInit, pendingWorktreeId, workspaceRoot } = effect;
        const currentEntry = state.entriesById.get(pendingWorktreeId);
        if (includeWorktreeInit) {
          if (
            !currentEntry ||
            currentEntry.attempt !== attempt ||
            currentEntry.phase !== "worktree-ready"
          ) {
            return;
          }
        } else if (!localLaunches.has(pendingWorktreeId)) {
          return;
        }

        let mappedThreadId: string | null = null;
        const onThreadCreated = (threadId: string): void => {
          if (mappedThreadId !== null || !threadId) return;
          const current = state.entriesById.get(pendingWorktreeId);
          if (
            includeWorktreeInit
              ? !current || current.attempt !== attempt || current.phase !== "worktree-ready"
              : !localLaunches.has(pendingWorktreeId)
          ) {
            return;
          }
          mappedThreadId = threadId;
        };
        const result = yield* options
          .launchConversation(entry, workspaceRoot, { onThreadCreated, includeWorktreeInit })
          .pipe(Effect.result);
        if (Result.isSuccess(result)) onThreadCreated(result.success.threadId);

        if (mappedThreadId !== null) {
          if (includeWorktreeInit) {
            dispatch({ type: "conversationStartSucceeded", pendingWorktreeId, attempt });
          } else {
            yield* completeLocalLaunch(pendingWorktreeId, {
              _tag: "Success",
              threadId: mappedThreadId,
            });
          }
          if (Result.isFailure(result)) {
            yield* reportFailure("launch", result.failure, pendingWorktreeId);
          }
          return;
        }

        if (Result.isSuccess(result)) return;
        const error = runtimeError("launch-conversation", pendingWorktreeId, result.failure.cause);
        yield* reportFailure("launch", result.failure, pendingWorktreeId);
        if (includeWorktreeInit) {
          dispatch({
            type: "conversationStartFailed",
            pendingWorktreeId,
            attempt,
            errorMessage: error.message,
          });
        } else {
          yield* completeLocalLaunch(pendingWorktreeId, { _tag: "Failure", error });
        }
      },
    );

    function executeEffect(effect: CodexPendingWorktreeEffect): void {
      if (!accepting) return;
      switch (effect.type) {
        case "startWorktree":
          runBackground(
            FiberMap.run(
              attemptFibers,
              effect.pendingWorktreeId,
              startWorktree(effect.pendingWorktreeId, effect.attempt),
              { startImmediately: true },
            ).pipe(Effect.asVoid),
          );
          return;
        case "launchConversation":
          runBackground(
            FiberMap.run(launchFibers, effect.pendingWorktreeId, launchConversation(effect), {
              startImmediately: true,
            }).pipe(Effect.asVoid),
          );
          return;
        case "abort":
          runBackground(
            FiberMap.run(attemptFibers, effect.pendingWorktreeId, Effect.void, {
              startImmediately: true,
            }).pipe(Effect.asVoid),
          );
          return;
        case "delete":
          runBackground(
            removeBestEffort(effect.pendingWorktreeId, effect.hostId, effect.worktreeGitRoot),
          );
          return;
        case "remove":
          runBackground(
            FiberMap.run(attemptFibers, effect.pendingWorktreeId, Effect.void, {
              startImmediately: true,
            }).pipe(Effect.asVoid),
          );
          return;
        case "cleanupGoalSources":
          runBackground(
            options
              .cleanupGoalSources(effect.entry)
              .pipe(
                Effect.catch((error) =>
                  reportFailure("cleanup-goal-sources", error, effect.pendingWorktreeId),
                ),
              ),
          );
          return;
        case "registerStableProject":
          runBackground(
            options.registerStableProject(effect.workspaceRoots, effect.label).pipe(
              Effect.matchEffect({
                onFailure: (error) =>
                  Effect.sync(() => {
                    dispatch({
                      type: "workspaceRootAddFailed",
                      pendingWorktreeId: effect.pendingWorktreeId,
                      attempt: effect.attempt,
                      errorMessage: failureMessage(error.cause),
                    });
                  }).pipe(
                    Effect.andThen(
                      reportFailure("register-stable-project", error, effect.pendingWorktreeId),
                    ),
                  ),
                onSuccess: () =>
                  Effect.sync(() => {
                    dispatch({
                      type: "stableProjectRegistered",
                      pendingWorktreeId: effect.pendingWorktreeId,
                      attempt: effect.attempt,
                    });
                  }),
              }),
            ),
          );
          return;
        default:
          return assertNeverCodexPendingWorktreeRuntimeVariant(
            effect,
            "Codex pending worktree effect",
          );
      }
    }

    const updateMetadata = (
      pendingWorktreeId: string,
      update: CodexPendingWorktreeMetadataUpdate,
    ): void => {
      dispatch({ type: "updateMetadata", pendingWorktreeId, update });
    };

    const interruptLaunch = (pendingWorktreeId: string): void => {
      runBackground(
        FiberMap.run(launchFibers, pendingWorktreeId, Effect.void, {
          startImmediately: true,
        }).pipe(Effect.asVoid),
      );
    };

    const rejectLocalLaunch = (pendingWorktreeId: string, message: string): void => {
      const pending = localLaunches.get(pendingWorktreeId);
      if (!pending) return;
      localLaunches.delete(pendingWorktreeId);
      runBackground(
        Deferred.fail(
          pending,
          runtimeError("work-locally", pendingWorktreeId, new Error(message)),
        ).pipe(Effect.asVoid),
      );
    };

    yield* Effect.addFinalizer(() =>
      Effect.gen(function* () {
        accepting = false;
        const closing = runtimeError(
          "close",
          "*",
          new Error("Pending worktree runtime is shut down"),
        );
        const pending = [...localLaunches.values()];
        localLaunches.clear();
        yield* Effect.forEach(pending, (deferred) => Deferred.fail(deferred, closing), {
          discard: true,
        });
      }),
    );

    return CodexPendingWorktreeRuntime.of({
      list: () => snapshot,
      resolveThread: (clientThreadId) => resolveCodexPendingWorktreeThread(state, clientThreadId),
      changes: Stream.fromPubSub(changes),
      create: (request, createdAt = Date.now()) => {
        dispatch({ type: "create", request, createdAt });
      },
      retry: (pendingWorktreeId) => {
        const entry = state.entriesById.get(pendingWorktreeId);
        const conversationStart =
          state.conversationStartsByPendingWorktreeId.get(pendingWorktreeId);
        if (entry?.phase === "worktree-ready" && conversationStart?.value.state === "failed") {
          dispatch({ type: "retryConversationStart", pendingWorktreeId });
          return;
        }
        dispatch({ type: "retry", pendingWorktreeId });
      },
      workLocally: (pendingWorktreeId) =>
        localLaunchAdmission
          .withPermits(1)(
            Effect.gen(function* () {
              if (!accepting) {
                return yield* runtimeError(
                  "work-locally",
                  pendingWorktreeId,
                  new Error("Pending worktree runtime is shut down"),
                );
              }
              const existing = localLaunches.get(pendingWorktreeId);
              if (existing) return existing;
              const deferred = yield* Deferred.make<
                { readonly threadId: string },
                CodexPendingWorktreeRuntimeError
              >();
              localLaunches.set(pendingWorktreeId, deferred);
              const effects = dispatch({ type: "workLocally", pendingWorktreeId });
              const started = effects.some(
                (effect) =>
                  effect.type === "launchConversation" && effect.includeWorktreeInit === false,
              );
              if (started) return deferred;
              localLaunches.delete(pendingWorktreeId);
              yield* Deferred.fail(
                deferred,
                runtimeError(
                  "work-locally",
                  pendingWorktreeId,
                  new Error(`Pending worktree cannot start locally: ${pendingWorktreeId}`),
                ),
              );
              return deferred;
            }),
          )
          .pipe(Effect.flatMap(Deferred.await)),
      continueWithoutSetup: (pendingWorktreeId) => {
        dispatch({ type: "continueWithoutSetup", pendingWorktreeId });
      },
      cancel: (pendingWorktreeId) => {
        rejectLocalLaunch(pendingWorktreeId, "Pending worktree launch canceled");
        interruptLaunch(pendingWorktreeId);
        dispatch({ type: "cancel", pendingWorktreeId });
      },
      dismiss: (pendingWorktreeId) => {
        rejectLocalLaunch(pendingWorktreeId, "Pending worktree launch dismissed");
        interruptLaunch(pendingWorktreeId);
        dispatch({ type: "dismiss", pendingWorktreeId });
      },
      rename: (pendingWorktreeId, label) => {
        const nextLabel = label.trim();
        if (!nextLabel) return;
        updateMetadata(pendingWorktreeId, { type: "label", label: nextLabel });
        updateMetadata(pendingWorktreeId, { type: "labelEdited", labelEdited: true });
      },
      setPinned: (pendingWorktreeId, isPinned) => {
        updateMetadata(pendingWorktreeId, { type: "isPinned", isPinned });
        if (isPinned) return;
        updateMetadata(pendingWorktreeId, {
          type: "pinnedBeforeThreadId",
          beforeThreadId: null,
        });
      },
      setPinnedBeforeThreadId: (pendingWorktreeId, beforeThreadId) => {
        updateMetadata(pendingWorktreeId, { type: "pinnedBeforeThreadId", beforeThreadId });
      },
      clearAttention: (pendingWorktreeId) => {
        updateMetadata(pendingWorktreeId, { type: "needsAttention", needsAttention: false });
      },
    });
  });
