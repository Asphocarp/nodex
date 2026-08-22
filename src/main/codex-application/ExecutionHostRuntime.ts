import type { ChildProcessWithoutNullStreams } from "node:child_process";
import * as path from "node:path";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as LayerMap from "effect/LayerMap";
import * as Ref from "effect/Ref";
import * as Schema from "effect/Schema";
import * as Semaphore from "effect/Semaphore";
import * as Scope from "effect/Scope";
import * as SubscriptionRef from "effect/SubscriptionRef";
import type {
  CodexExecutionHostSettings,
  CodexSshExecutionHostConfig,
  ManagedWorktreeSettings,
  UpdateCodexExecutionHostSettingsInput,
} from "../../shared/types";
import { CodexGateway, CodexThreadHostResolver } from "../codex-runtime/CodexGateway";
import { codexRuntimeError } from "../codex-runtime/CodexRuntimeError";
import { CoreModules } from "../core-runtime/CoreModules";
import {
  CODEX_APP_LOCAL_HOST_DISPLAY_NAME,
  CODEX_APP_LOCAL_HOST_ID,
} from "../codex/codex-app-meta-thread-tools";
import { CodexExecutionHostRegistry } from "../codex/codex-execution-host-registry";
import {
  CodexLocalExecutionHostFileTransfer,
  type CodexExecutionHostFileTransferPort,
} from "../codex/codex-execution-host-file-transfer";
import { makeCodexRemoteWorktreeWorker } from "../codex/codex-remote-worktree-worker-port";
import {
  CodexSshExecutionHostTransport,
  type CodexSshExecutionHostHealth,
} from "../codex/codex-ssh-execution-host";
import type {
  CodexWorktreeWorkerOperation,
  CodexWorktreeWorkerPort,
} from "../codex/codex-worktree-worker-port";
import { getLogger } from "../logging/logger";
import { makeCodexProcessExecutionHost } from "../platform/node/CodexProcessExecutionHost";

const WORKTREE_CAPABILITIES = [
  "create",
  "list",
  "inspect",
  "snapshot",
  "remove",
  "restore",
  "set-owner",
  "prepare-handoff",
  "rollback-handoff",
  "cleanup-handoff",
  "export-handoff",
  "import-handoff",
  "cleanup-transfer-handoff",
] as const satisfies readonly CodexWorktreeWorkerOperation[];

export interface CodexExecutionHostSettingsPort {
  readonly read: () => CodexExecutionHostSettings;
  readonly update: (input: UpdateCodexExecutionHostSettingsInput) => CodexExecutionHostSettings;
}

export interface LocalManagedWorktreeSettingsPort {
  readonly read: () => ManagedWorktreeSettings;
  readonly listKnownRoots: () => readonly string[];
}

export interface RemoteExecutionHostTransport extends CodexExecutionHostFileTransferPort {
  readonly hostId: string;
  readonly config: CodexSshExecutionHostConfig;
  readonly ensureReady: (signal?: AbortSignal) => Promise<CodexSshExecutionHostHealth>;
  readonly openWorktreeWorker: (signal?: AbortSignal) => Promise<ChildProcessWithoutNullStreams>;
  readonly appServerClientOptions: CodexSshExecutionHostTransport["appServerClientOptions"];
}

export interface ExecutionHostRuntimeFactories {
  readonly makeTransport: (input: {
    readonly config: CodexSshExecutionHostConfig;
    readonly workerBundlePath: string;
  }) => RemoteExecutionHostTransport;
  readonly makeWorker: (input: {
    readonly hostId: string;
    readonly openWorker: (signal: AbortSignal) => Promise<ChildProcessWithoutNullStreams>;
    readonly onInfrastructureError: (error: Error) => void;
  }) => Effect.Effect<CodexWorktreeWorkerPort, never, Scope.Scope>;
}

export interface ExecutionHostRuntimeOptions {
  readonly runtimeStateHome: string;
  readonly nodexHome: string;
  readonly remoteWorktreeWorkerBundlePath: string;
  readonly localWorktreeWorker: CodexWorktreeWorkerPort;
  readonly settings: CodexExecutionHostSettingsPort;
  readonly managedWorktrees: LocalManagedWorktreeSettingsPort;
  readonly factories?: ExecutionHostRuntimeFactories;
}

export interface LocalExecutionHostOptions {
  readonly runtimeStateHome: string;
  readonly nodexHome: string;
  readonly localWorktreeWorker: CodexWorktreeWorkerPort;
  readonly managedWorktrees: LocalManagedWorktreeSettingsPort;
}

export class ExecutionHostRuntimeError extends Schema.TaggedError<ExecutionHostRuntimeError>()(
  "ExecutionHostRuntimeError",
  {
    operation: Schema.String,
    hostId: Schema.optional(Schema.String),
    cause: Schema.Defect(),
  },
) {}

export class ExecutionHostRuntime extends Context.Service<
  ExecutionHostRuntime,
  {
    /** Transitional capability borrowed by ManagedWorktreeRuntime during the Codex cut-over. */
    readonly registry: CodexExecutionHostRegistry;
    readonly activeSshHosts: SubscriptionRef.SubscriptionRef<
      ReadonlyMap<string, CodexSshExecutionHostConfig>
    >;
    readonly settings: Effect.Effect<CodexExecutionHostSettings, ExecutionHostRuntimeError>;
    readonly updateSettings: (
      input: UpdateCodexExecutionHostSettingsInput,
    ) => Effect.Effect<CodexExecutionHostSettings, ExecutionHostRuntimeError>;
    readonly reconcile: (
      settings?: CodexExecutionHostSettings,
    ) => Effect.Effect<void, ExecutionHostRuntimeError>;
  }
>()("nodex/main/codex-application/ExecutionHostRuntime") {}

class ActiveRemoteHost extends Context.Service<
  ActiveRemoteHost,
  {
    readonly config: CodexSshExecutionHostConfig;
    readonly worker: CodexWorktreeWorkerPort;
  }
>()("nodex/main/codex-application/ExecutionHostRuntime/ActiveRemoteHost") {}

const defaultFactories: ExecutionHostRuntimeFactories = {
  makeTransport: (input) => new CodexSshExecutionHostTransport(input),
  makeWorker: makeCodexRemoteWorktreeWorker,
};

const sameConfig = (
  left: CodexSshExecutionHostConfig | undefined,
  right: CodexSshExecutionHostConfig | undefined,
): boolean =>
  left !== undefined && right !== undefined && JSON.stringify(left) === JSON.stringify(right);

/** Builds the local host capability set shared by production and isolated application fixtures. */
export const makeLocalExecutionHostRegistry = (
  options: LocalExecutionHostOptions,
): CodexExecutionHostRegistry => {
  const runtimeStateHome = path.resolve(options.runtimeStateHome);
  const nodexHome = path.resolve(options.nodexHome);
  const localManagedRoot =
    options.managedWorktrees.read().worktreeRoot ?? path.join(nodexHome, "worktrees");
  const localKnownManagedRoots = [
    path.join(nodexHome, "worktrees"),
    ...options.managedWorktrees.listKnownRoots(),
  ];
  const handoffStagingRoot = path.join(runtimeStateHome, "handoffs");
  const localFileTransfer = new CodexLocalExecutionHostFileTransfer({
    hostId: CODEX_APP_LOCAL_HOST_ID,
    stagingRoot: handoffStagingRoot,
    allowedReadRoots: [runtimeStateHome, localManagedRoot, ...localKnownManagedRoots],
  });
  const registry = new CodexExecutionHostRegistry();
  registry.register({
    hostId: CODEX_APP_LOCAL_HOST_ID,
    displayName: CODEX_APP_LOCAL_HOST_DISPLAY_NAME ?? "Local",
    kind: "local",
    nodexHome,
    codexHome: runtimeStateHome,
    managedRoot: localManagedRoot,
    handoffStagingRoot,
    knownManagedRoots: localKnownManagedRoots,
    worktreeWorker: options.localWorktreeWorker,
    fileTransfer: localFileTransfer,
    capabilities: WORKTREE_CAPABILITIES,
  });
  return registry;
};

export const live = (
  options: ExecutionHostRuntimeOptions,
): Layer.Layer<ExecutionHostRuntime, ExecutionHostRuntimeError, CodexGateway> =>
  Layer.effect(
    ExecutionHostRuntime,
    Effect.gen(function* () {
      const gateway = yield* CodexGateway;
      const factories = options.factories ?? defaultFactories;
      const logger = getLogger({ component: "execution-host-runtime" });
      const runtimeStateHome = path.resolve(options.runtimeStateHome);
      const nodexHome = path.resolve(options.nodexHome);
      const remoteWorktreeWorkerBundlePath = path.resolve(options.remoteWorktreeWorkerBundlePath);
      const error = (operation: string, cause: unknown, hostId?: string) =>
        new ExecutionHostRuntimeError({ operation, cause, ...(hostId ? { hostId } : {}) });
      const activeSshHosts = yield* SubscriptionRef.make<
        ReadonlyMap<string, CodexSshExecutionHostConfig>
      >(new Map());
      const desiredSshHosts = yield* Ref.make<ReadonlyMap<string, CodexSshExecutionHostConfig>>(
        new Map(),
      );
      const mutationLock = yield* Semaphore.make(1);
      const registry = yield* Effect.try({
        try: () =>
          makeLocalExecutionHostRegistry({
            runtimeStateHome,
            nodexHome,
            localWorktreeWorker: options.localWorktreeWorker,
            managedWorktrees: options.managedWorktrees,
          }),
        catch: (cause) => error("register-local-host", cause, CODEX_APP_LOCAL_HOST_ID),
      });
      yield* Effect.addFinalizer(() =>
        Effect.sync(() => {
          registry.unregister(CODEX_APP_LOCAL_HOST_ID, options.localWorktreeWorker);
        }),
      );

      const releaseRemoteHost = (host: ActiveRemoteHost["Service"]): Effect.Effect<void> =>
        Effect.gen(function* () {
          registry.unregister(host.config.id, host.worker);
          const release = yield* gateway.removeHost(host.config.id).pipe(Effect.result);
          yield* SubscriptionRef.update(activeSshHosts, (current) => {
            const next = new Map(current);
            next.delete(host.config.id);
            return next;
          });
          if (release._tag === "Success") return;
          yield* Effect.logWarning("Could not fully release SSH execution host").pipe(
            Effect.annotateLogs({ hostId: host.config.id, cause: String(release.failure) }),
          );
        });

      const remoteHostLayer = (
        hostId: string,
      ): Layer.Layer<ActiveRemoteHost, ExecutionHostRuntimeError> =>
        Layer.unwrap(
          Ref.get(desiredSshHosts).pipe(
            Effect.map((desired) => {
              const config = desired.get(hostId);
              if (config === undefined) {
                return Layer.effect(
                  ActiveRemoteHost,
                  Effect.fail(
                    error("resolve-config", new Error("Execution host is not desired"), hostId),
                  ),
                );
              }
              return Layer.effect(
                ActiveRemoteHost,
                Effect.acquireRelease(
                  Effect.uninterruptibleMask((restore) =>
                    Effect.gen(function* () {
                      const transport = yield* Effect.try({
                        try: () =>
                          factories.makeTransport({
                            config,
                            workerBundlePath: remoteWorktreeWorkerBundlePath,
                          }),
                        catch: (cause) => error("construct-transport", cause, hostId),
                      });
                      const health = yield* restore(
                        Effect.tryPromise({
                          try: (signal) => transport.ensureReady(signal),
                          catch: (cause) => error("prepare", cause, hostId),
                        }),
                      );
                      const worker = yield* factories.makeWorker({
                        hostId,
                        openWorker: (signal) => transport.openWorktreeWorker(signal),
                        onInfrastructureError: (cause) => {
                          logger.error("Remote worktree worker failed", {
                            hostId,
                            error: cause.message,
                          });
                        },
                      });
                      const host = ActiveRemoteHost.of({ config, worker });
                      yield* Effect.gen(function* () {
                        const endpointConfig = yield* Effect.try({
                          try: () =>
                            makeCodexProcessExecutionHost(
                              hostId,
                              transport.appServerClientOptions(),
                            ),
                          catch: (cause) => error("configure-endpoint", cause, hostId),
                        });
                        yield* gateway
                          .reconcileHost(endpointConfig)
                          .pipe(
                            Effect.mapError((cause) => error("register-endpoint", cause, hostId)),
                          );
                        yield* Effect.try({
                          try: () =>
                            registry.register({
                              hostId,
                              displayName: config.displayName,
                              kind: "ssh",
                              nodexHome: path.posix.join(health.home, ".nodex"),
                              codexHome: health.codexHome,
                              managedRoot: config.managedRoot,
                              handoffStagingRoot: path.posix.join(
                                health.codexHome,
                                "nodex-handoffs",
                              ),
                              repositoryRoots: config.repositoryRoots,
                              worktreeWorker: worker,
                              fileTransfer: transport,
                              capabilities: WORKTREE_CAPABILITIES,
                            }),
                          catch: (cause) => error("register-worker", cause, hostId),
                        });
                        yield* SubscriptionRef.update(activeSshHosts, (current) => {
                          const next = new Map(current);
                          next.set(hostId, config);
                          return next;
                        });
                      }).pipe(
                        Effect.onError(() =>
                          Effect.sync(() => registry.unregister(hostId, worker)).pipe(
                            Effect.andThen(gateway.removeHost(hostId).pipe(Effect.ignore)),
                          ),
                        ),
                      );
                      return host;
                    }),
                  ),
                  releaseRemoteHost,
                ),
              );
            }),
          ),
        );

      const remoteHosts = yield* LayerMap.make(remoteHostLayer, { idleTimeToLive: "Infinity" });

      const readSettings = Effect.try({
        try: options.settings.read,
        catch: (cause) => error("read-settings", cause),
      });

      const reconcileUnlocked = Effect.fn("ExecutionHostRuntime.reconcileUnlocked")(function* (
        settings: CodexExecutionHostSettings,
      ) {
        const desired = new Map(
          settings.sshHosts.filter((host) => host.enabled).map((host) => [host.id, host]),
        );
        const active = yield* SubscriptionRef.get(activeSshHosts);
        yield* Ref.set(desiredSshHosts, desired);

        const staleHostIds = [...active.entries()].flatMap(([hostId, config]) =>
          sameConfig(config, desired.get(hostId)) ? [] : [hostId],
        );
        yield* Effect.forEach(staleHostIds, remoteHosts.invalidate, {
          concurrency: "unbounded",
          discard: true,
        });
        yield* Effect.forEach(
          [...desired.keys()].filter((hostId) => !active.has(hostId)),
          remoteHosts.invalidate,
          { concurrency: "unbounded", discard: true },
        );

        const outcomes = yield* Effect.forEach(
          [...desired.keys()],
          (hostId) =>
            Effect.scoped(remoteHosts.contextEffect(hostId)).pipe(
              Effect.matchEffect({
                onFailure: (cause) =>
                  remoteHosts.invalidate(hostId).pipe(Effect.as({ hostId, cause })),
                onSuccess: () => Effect.succeed(null),
              }),
            ),
          { concurrency: 2 },
        );
        const failures = outcomes.flatMap((outcome) => (outcome === null ? [] : [outcome]));
        if (failures.length === 0) return;
        return yield* error(
          "reconcile",
          new AggregateError(
            failures.map(
              ({ hostId, cause }) =>
                new Error(`Could not activate SSH execution host ${hostId}: ${cause.message}`, {
                  cause,
                }),
            ),
            "One or more SSH execution hosts are unavailable",
          ),
        );
      });

      const reconcile = (
        settings?: CodexExecutionHostSettings,
      ): Effect.Effect<void, ExecutionHostRuntimeError> =>
        (settings === undefined ? readSettings : Effect.succeed(settings)).pipe(
          Effect.flatMap(reconcileUnlocked),
          mutationLock.withPermits(1),
        );

      return ExecutionHostRuntime.of({
        registry,
        activeSshHosts,
        settings: readSettings,
        reconcile,
        updateSettings: (input) =>
          Effect.try({
            try: () => options.settings.update(input),
            catch: (cause) => error("update-settings", cause),
          }).pipe(Effect.tap(reconcileUnlocked), mutationLock.withPermits(1)),
      });
    }),
  );

/** Resolves routing from Core's durable Workspace authority, never from RPC payload heuristics. */
export const threadHostResolverLive: Layer.Layer<CodexThreadHostResolver, never, CoreModules> =
  Layer.effect(
    CodexThreadHostResolver,
    CoreModules.use((core) =>
      Effect.succeed(
        CodexThreadHostResolver.of({
          resolve: (threadId) =>
            core.workspace.read({ kind: "thread", thread_id: threadId }).pipe(
              Effect.mapError((cause) =>
                codexRuntimeError({
                  operation: "thread-host.resolve",
                  reason: "host-unavailable",
                  retryable: cause.retryable,
                  cause,
                }),
              ),
              Effect.flatMap((snapshot) =>
                snapshot.value.kind === "thread"
                  ? Effect.succeed(snapshot.value.thread.execution_host_id)
                  : Effect.fail(
                      codexRuntimeError({
                        operation: "thread-host.resolve-variant",
                        reason: "protocol",
                        retryable: false,
                        cause: new Error("Core returned a non-thread Workspace read variant"),
                      }),
                    ),
              ),
            ),
        }),
      ),
    ),
  );
