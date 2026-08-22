import { randomUUID } from "node:crypto";
import * as path from "node:path";
import * as Context from "effect/Context";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Ref from "effect/Ref";
import * as Schema from "effect/Schema";
import * as Scope from "effect/Scope";
import * as Semaphore from "effect/Semaphore";
import type {
  CodexManagedWorktreeRemovalReason,
  CodexWorktreeWorkerEvent,
  CodexWorktreeWorkerInspectResult,
  CodexWorktreeWorkerListResult,
  CodexWorktreeWorkerRemoveResult,
  CodexWorktreeWorkerRestoreResult,
} from "../codex/codex-worktree-worker-port";
import { normalizeWorktreePathForIdentity } from "../codex/codex-managed-worktree-effects";
import { snapshotPolicyForManagedWorktreeRemoval } from "../codex/codex-managed-worktree-lifecycle";
import { ExecutionHostRuntime } from "./ExecutionHostRuntime";

export interface ManagedWorktreeRemoveInput {
  readonly hostId: string;
  readonly worktreeGitRoot: string;
  readonly reason: CodexManagedWorktreeRemovalReason;
  readonly signal?: AbortSignal;
  readonly onEvent?: (event: CodexWorktreeWorkerEvent) => void;
}

export interface ManagedWorktreeInspectInput {
  readonly hostId: string;
  readonly worktreeGitRoot: string;
  readonly cwd: string;
  readonly candidateRepositoryPaths: readonly string[];
  readonly signal?: AbortSignal;
}

export interface ManagedWorktreeRestoreInput extends ManagedWorktreeInspectInput {
  readonly ownerThreadId: string | null;
  readonly onEvent?: (event: CodexWorktreeWorkerEvent) => void;
}

export interface ManagedWorktreeSetOwnerInput {
  readonly hostId: string;
  readonly worktreeGitRoot: string;
  readonly ownerThreadId: string;
  readonly signal?: AbortSignal;
}

export interface ManagedWorktreeNewborn {
  readonly hostId: string;
  readonly worktreeGitRoot: string;
}

export class ManagedWorktreeRuntimeError extends Schema.TaggedError<ManagedWorktreeRuntimeError>()(
  "ManagedWorktreeRuntimeError",
  {
    operation: Schema.String,
    hostId: Schema.String,
    worktreeGitRoot: Schema.optional(Schema.String),
    cause: Schema.Defect(),
  },
) {}

interface ManagedWorktreeLegacyNewbornAdapter {
  readonly register: (hostId: string, worktreeGitRoot: string) => void;
  readonly release: (hostId: string, worktreeGitRoot: string) => void;
  readonly has: (hostId: string, worktreeGitRoot: string) => boolean;
  readonly list: () => readonly ManagedWorktreeNewborn[];
}

export class ManagedWorktreeRuntime extends Context.Service<
  ManagedWorktreeRuntime,
  {
    readonly remove: (
      input: ManagedWorktreeRemoveInput,
    ) => Effect.Effect<CodexWorktreeWorkerRemoveResult, ManagedWorktreeRuntimeError>;
    readonly inspect: (
      input: ManagedWorktreeInspectInput,
    ) => Effect.Effect<CodexWorktreeWorkerInspectResult, ManagedWorktreeRuntimeError>;
    readonly list: (
      hostId: string,
    ) => Effect.Effect<CodexWorktreeWorkerListResult, ManagedWorktreeRuntimeError>;
    readonly restore: (
      input: ManagedWorktreeRestoreInput,
    ) => Effect.Effect<CodexWorktreeWorkerRestoreResult, ManagedWorktreeRuntimeError>;
    readonly setOwner: (
      input: ManagedWorktreeSetOwnerInput,
    ) => Effect.Effect<void, ManagedWorktreeRuntimeError>;
    /** Removed with CodexService; callback-driven newborn events need synchronous projection. */
    readonly legacyNewborns: ManagedWorktreeLegacyNewbornAdapter;
  }
>()("nodex/main/codex-application/ManagedWorktreeRuntime") {}

const operationSignal = (effectSignal: AbortSignal, external?: AbortSignal): AbortSignal =>
  external === undefined ? effectSignal : AbortSignal.any([effectSignal, external]);

export const live: Layer.Layer<ManagedWorktreeRuntime, never, ExecutionHostRuntime> = Layer.effect(
  ManagedWorktreeRuntime,
  Effect.gen(function* () {
    const executionHosts = yield* ExecutionHostRuntime;
    const scope = yield* Scope.Scope;
    const removalLock = yield* Semaphore.make(1);
    const inspectionLock = yield* Semaphore.make(1);
    const removals = yield* Ref.make<
      ReadonlyMap<
        string,
        Deferred.Deferred<CodexWorktreeWorkerRemoveResult, ManagedWorktreeRuntimeError>
      >
    >(new Map());
    const inspections = yield* Ref.make<
      ReadonlyMap<
        string,
        Deferred.Deferred<CodexWorktreeWorkerInspectResult, ManagedWorktreeRuntimeError>
      >
    >(new Map());
    const newborns = new Set<string>();

    const key = (hostId: string, worktreeGitRoot: string): string =>
      `${hostId.trim()}\0${normalizeWorktreePathForIdentity(path.resolve(worktreeGitRoot))}`;
    const error = (operation: string, hostId: string, cause: unknown, worktreeGitRoot?: string) =>
      new ManagedWorktreeRuntimeError({
        operation,
        hostId,
        cause,
        ...(worktreeGitRoot ? { worktreeGitRoot } : {}),
      });
    const worker = (
      hostId: string,
      operation: Parameters<typeof executionHosts.registry.requireWorktreeWorker>[1],
    ) =>
      Effect.try({
        try: () => executionHosts.registry.requireWorktreeWorker(hostId, operation),
        catch: (cause) => error(`resolve-${operation}-worker`, hostId, cause),
      });
    const managedRoot = (hostId: string, worktreeGitRoot: string) =>
      Effect.try({
        try: () => executionHosts.registry.resolveManagedRoot(hostId, worktreeGitRoot),
        catch: (cause) => error("resolve-managed-root", hostId, cause, worktreeGitRoot),
      });
    const inspectionKey = (input: ManagedWorktreeInspectInput): string =>
      [
        key(input.hostId, input.worktreeGitRoot),
        normalizeWorktreePathForIdentity(path.resolve(input.cwd)),
        ...input.candidateRepositoryPaths
          .map((candidate) => normalizeWorktreePathForIdentity(path.resolve(candidate)))
          .sort(),
      ].join("\0");

    yield* Effect.addFinalizer(() =>
      Effect.sync(() => {
        newborns.clear();
      }),
    );

    const runRemoval = Effect.fn("ManagedWorktreeRuntime.runRemoval")(function* (
      input: ManagedWorktreeRemoveInput,
      removalKey: string,
      deferred: Deferred.Deferred<CodexWorktreeWorkerRemoveResult, ManagedWorktreeRuntimeError>,
    ) {
      const operation = Effect.gen(function* () {
        const target = yield* worker(input.hostId, "remove");
        const root = yield* managedRoot(input.hostId, input.worktreeGitRoot);
        return yield* Effect.tryPromise({
          try: (signal) =>
            target.remove(
              {
                requestId: `lifecycle:remove:${randomUUID()}`,
                hostId: input.hostId,
                managedRoot: root,
                worktreeGitRoot: input.worktreeGitRoot,
                reason: input.reason,
                snapshotPolicy: snapshotPolicyForManagedWorktreeRemoval(input.reason),
              },
              {
                signal: operationSignal(signal, input.signal),
                onEvent: input.onEvent,
              },
            ),
          catch: (cause) => error("remove", input.hostId, cause, input.worktreeGitRoot),
        });
      }).pipe(
        Effect.ensuring(
          Ref.update(removals, (current) => {
            if (current.get(removalKey) !== deferred) return current;
            const next = new Map(current);
            next.delete(removalKey);
            return next;
          }).pipe(
            Effect.andThen(
              Effect.sync(() => {
                newborns.delete(removalKey);
              }),
            ),
          ),
        ),
        Effect.onExit((exit) => Deferred.done(deferred, exit)),
      );
      yield* Effect.forkIn(operation, scope, { startImmediately: true });
    });

    const remove = (
      input: ManagedWorktreeRemoveInput,
    ): Effect.Effect<CodexWorktreeWorkerRemoveResult, ManagedWorktreeRuntimeError> =>
      Effect.gen(function* () {
        const removalKey = key(input.hostId, input.worktreeGitRoot);
        const deferred = yield* removalLock.withPermits(1)(
          Effect.gen(function* () {
            const current = yield* Ref.get(removals);
            const existing = current.get(removalKey);
            if (existing !== undefined) return existing;
            const created = yield* Deferred.make<
              CodexWorktreeWorkerRemoveResult,
              ManagedWorktreeRuntimeError
            >();
            yield* Ref.update(removals, (state) => new Map(state).set(removalKey, created));
            yield* runRemoval(input, removalKey, created);
            return created;
          }),
        );
        return yield* Deferred.await(deferred);
      });

    const runInspection = Effect.fn("ManagedWorktreeRuntime.runInspection")(function* (
      input: ManagedWorktreeInspectInput,
      operationKey: string,
      deferred: Deferred.Deferred<CodexWorktreeWorkerInspectResult, ManagedWorktreeRuntimeError>,
    ) {
      const operation = Effect.gen(function* () {
        const target = yield* worker(input.hostId, "inspect");
        const root = yield* managedRoot(input.hostId, input.worktreeGitRoot);
        return yield* Effect.tryPromise({
          try: (signal) =>
            target.inspect(
              {
                requestId: `lifecycle:inspect:${randomUUID()}`,
                hostId: input.hostId,
                managedRoot: root,
                worktreeGitRoot: input.worktreeGitRoot,
                cwd: input.cwd,
                candidateRepositoryPaths: input.candidateRepositoryPaths,
              },
              { signal: operationSignal(signal, input.signal) },
            ),
          catch: (cause) => error("inspect", input.hostId, cause, input.worktreeGitRoot),
        });
      }).pipe(
        Effect.ensuring(
          Ref.update(inspections, (current) => {
            if (current.get(operationKey) !== deferred) return current;
            const next = new Map(current);
            next.delete(operationKey);
            return next;
          }),
        ),
        Effect.onExit((exit) => Deferred.done(deferred, exit)),
      );
      yield* Effect.forkIn(operation, scope, { startImmediately: true });
    });

    const inspect = (
      input: ManagedWorktreeInspectInput,
    ): Effect.Effect<CodexWorktreeWorkerInspectResult, ManagedWorktreeRuntimeError> =>
      Effect.gen(function* () {
        const operationKey = inspectionKey(input);
        const deferred = yield* inspectionLock.withPermits(1)(
          Effect.gen(function* () {
            const current = yield* Ref.get(inspections);
            const existing = current.get(operationKey);
            if (existing !== undefined) return existing;
            const created = yield* Deferred.make<
              CodexWorktreeWorkerInspectResult,
              ManagedWorktreeRuntimeError
            >();
            yield* Ref.update(inspections, (state) => new Map(state).set(operationKey, created));
            yield* runInspection(input, operationKey, created);
            return created;
          }),
        );
        return yield* Deferred.await(deferred);
      });

    const list = (
      hostId: string,
    ): Effect.Effect<CodexWorktreeWorkerListResult, ManagedWorktreeRuntimeError> =>
      Effect.gen(function* () {
        const target = yield* worker(hostId, "list");
        const roots = yield* Effect.try({
          try: () => executionHosts.registry.listManagedRoots(hostId),
          catch: (cause) => error("list-managed-roots", hostId, cause),
        });
        const inventories = yield* Effect.forEach(
          roots,
          (root) =>
            Effect.tryPromise({
              try: (signal) =>
                target.list(
                  {
                    requestId: `lifecycle:list:${randomUUID()}`,
                    hostId,
                    managedRoot: root,
                  },
                  { signal },
                ),
              catch: (cause) => error("list", hostId, cause),
            }),
          { concurrency: "unbounded" },
        );
        const entries = new Map<string, CodexWorktreeWorkerListResult["entries"][number]>();
        for (const inventory of inventories) {
          for (const entry of inventory.entries) {
            entries.set(normalizeWorktreePathForIdentity(entry.worktreeGitRoot), entry);
          }
        }
        return { entries: [...entries.values()] };
      });

    const restore = (
      input: ManagedWorktreeRestoreInput,
    ): Effect.Effect<CodexWorktreeWorkerRestoreResult, ManagedWorktreeRuntimeError> =>
      Effect.gen(function* () {
        const target = yield* worker(input.hostId, "restore");
        const root = yield* managedRoot(input.hostId, input.worktreeGitRoot);
        return yield* Effect.tryPromise({
          try: (signal) =>
            target.restore(
              {
                requestId: `lifecycle:restore:${randomUUID()}`,
                hostId: input.hostId,
                managedRoot: root,
                worktreeGitRoot: input.worktreeGitRoot,
                cwd: input.cwd,
                candidateRepositoryPaths: input.candidateRepositoryPaths,
                ownerThreadId: input.ownerThreadId,
              },
              {
                signal: operationSignal(signal, input.signal),
                onEvent: input.onEvent ?? (() => undefined),
              },
            ),
          catch: (cause) => error("restore", input.hostId, cause, input.worktreeGitRoot),
        });
      });

    const setOwner = (
      input: ManagedWorktreeSetOwnerInput,
    ): Effect.Effect<void, ManagedWorktreeRuntimeError> =>
      Effect.gen(function* () {
        const target = yield* worker(input.hostId, "set-owner");
        const root = yield* managedRoot(input.hostId, input.worktreeGitRoot);
        yield* Effect.tryPromise({
          try: (signal) =>
            target.setOwner(
              {
                requestId: `lifecycle:set-owner:${randomUUID()}`,
                hostId: input.hostId,
                managedRoot: root,
                worktreeGitRoot: input.worktreeGitRoot,
                ownerThreadId: input.ownerThreadId,
              },
              { signal: operationSignal(signal, input.signal) },
            ),
          catch: (cause) => error("set-owner", input.hostId, cause, input.worktreeGitRoot),
        });
      });

    return ManagedWorktreeRuntime.of({
      remove,
      inspect,
      list,
      restore,
      setOwner,
      legacyNewborns: {
        register: (hostId, worktreeGitRoot) => {
          newborns.add(key(hostId, worktreeGitRoot));
        },
        release: (hostId, worktreeGitRoot) => {
          newborns.delete(key(hostId, worktreeGitRoot));
        },
        has: (hostId, worktreeGitRoot) => newborns.has(key(hostId, worktreeGitRoot)),
        list: () =>
          [...newborns].map((entry) => {
            const separator = entry.indexOf("\0");
            return {
              hostId: entry.slice(0, separator),
              worktreeGitRoot: entry.slice(separator + 1),
            };
          }),
      },
    });
  }),
);
