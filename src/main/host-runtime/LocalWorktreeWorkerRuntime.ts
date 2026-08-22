import { randomUUID } from "node:crypto";
import { Worker } from "node:worker_threads";
import * as Context from "effect/Context";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as FiberSet from "effect/FiberSet";
import * as Layer from "effect/Layer";
import * as Ref from "effect/Ref";
import * as Schema from "effect/Schema";
import * as Semaphore from "effect/Semaphore";
import type {
  CodexWorktreeWorkerOperation,
  CodexWorktreeWorkerPort,
  CodexWorktreeWorkerRequest,
  CodexWorktreeWorkerRequestOptions,
  CodexWorktreeWorkerSuccess,
} from "../codex/codex-worktree-worker-port";
import {
  CODEX_WORKTREE_WORKER_PROTOCOL_VERSION,
  createCodexWorktreeWorkerRequestMessage,
  isCodexWorktreeWorkerThreadMessage,
  type CodexWorktreeWorkerHostMessage,
} from "../worktree-worker/worktree-worker-protocol";

export interface LocalWorktreeWorkerProcess {
  readonly send: (message: CodexWorktreeWorkerHostMessage) => void;
  readonly onMessage: (listener: (message: unknown) => void) => () => void;
  readonly onError: (listener: (error: Error) => void) => () => void;
  readonly onExit: (listener: (code: number) => void) => () => void;
  readonly terminate: () => Promise<number>;
}

export type LocalWorktreeWorkerProcessFactory = (input: {
  readonly epoch: number;
  readonly hostId: string;
  readonly workerPath: string;
}) => LocalWorktreeWorkerProcess;

interface WorkerSession {
  readonly epoch: number;
  readonly process: LocalWorktreeWorkerProcess;
  readonly releaseListeners: () => void;
}

interface PendingRequest {
  readonly operation: CodexWorktreeWorkerOperation;
  readonly onEvent: (event: Parameters<CodexWorktreeWorkerRequestOptions["onEvent"]>[0]) => void;
  readonly reply: Deferred.Deferred<CodexWorktreeWorkerSuccess, LocalWorktreeWorkerError>;
  readonly session: WorkerSession;
}

type SuccessValue<Operation extends CodexWorktreeWorkerOperation> = Extract<
  CodexWorktreeWorkerSuccess,
  { readonly operation: Operation }
>["value"];

export class LocalWorktreeWorkerError extends Schema.TaggedError<LocalWorktreeWorkerError>()(
  "LocalWorktreeWorkerError",
  {
    operation: Schema.String,
    message: Schema.String,
    cause: Schema.Defect(),
  },
) {}

export class LocalWorktreeWorkerRuntime extends Context.Service<
  LocalWorktreeWorkerRuntime,
  {
    readonly hostId: string;
    readonly request: <Operation extends CodexWorktreeWorkerOperation>(
      request: Extract<CodexWorktreeWorkerRequest, { readonly operation: Operation }>,
      options?: Partial<CodexWorktreeWorkerRequestOptions>,
    ) => Effect.Effect<SuccessValue<Operation>, LocalWorktreeWorkerError>;
    /** Promise transport projection for the execution-host registry; it owns no state. */
    readonly port: CodexWorktreeWorkerPort;
  }
>()("nodex/main/host-runtime/LocalWorktreeWorkerRuntime") {}

export interface LocalWorktreeWorkerRuntimeOptions {
  readonly hostId: string;
  readonly workerPath: string;
  readonly createProcess?: LocalWorktreeWorkerProcessFactory;
  readonly onInfrastructureError?: (error: Error) => void;
}

const createNodeProcess: LocalWorktreeWorkerProcessFactory = (input) => {
  const worker = new Worker(input.workerPath, {
    name: `worktree:${input.hostId}`,
    workerData: { epoch: input.epoch, hostId: input.hostId },
  });
  return {
    send: (message) => {
      // oxlint-disable-next-line unicorn/require-post-message-target-origin -- worker_threads messages do not accept a target origin.
      worker.postMessage(message);
    },
    onMessage: (listener) => {
      worker.on("message", listener);
      return () => worker.off("message", listener);
    },
    onError: (listener) => {
      worker.on("error", listener);
      return () => worker.off("error", listener);
    },
    onExit: (listener) => {
      worker.on("exit", listener);
      return () => worker.off("exit", listener);
    },
    terminate: () => worker.terminate(),
  };
};

export const live = (
  options: LocalWorktreeWorkerRuntimeOptions,
): Layer.Layer<LocalWorktreeWorkerRuntime> =>
  Layer.effect(
    LocalWorktreeWorkerRuntime,
    Effect.gen(function* () {
      const hostId = options.hostId.trim();
      if (!hostId) {
        return yield* Effect.die(
          new LocalWorktreeWorkerError({
            operation: "configure",
            message: "Worktree worker host id is required",
            cause: new Error("Worktree worker host id is required"),
          }),
        );
      }
      const createProcess = options.createProcess ?? createNodeProcess;
      const onInfrastructureError = options.onInfrastructureError ?? (() => undefined);
      const stateLock = yield* Semaphore.make(1);
      const current = yield* Ref.make<WorkerSession | null>(null);
      const nextEpoch = yield* Ref.make(1);
      const closed = yield* Ref.make(false);
      const requests = yield* Ref.make<ReadonlyMap<string, PendingRequest>>(new Map());
      const callbackFibers = yield* FiberSet.make();
      const runCallback = yield* FiberSet.runtime(callbackFibers)();
      const runPromise = yield* FiberSet.runtimePromise(callbackFibers)();

      const failure = (operation: string, message: string, cause: unknown = new Error(message)) =>
        new LocalWorktreeWorkerError({ operation, message, cause });
      const failPending = (
        pending: ReadonlyMap<string, PendingRequest>,
        error: LocalWorktreeWorkerError,
      ) =>
        Effect.forEach(pending.values(), (entry) => Deferred.fail(entry.reply, error), {
          discard: true,
        });
      const takePending = (id: string) =>
        Ref.modify(requests, (state) => {
          const pending = state.get(id);
          if (!pending) return [undefined, state] as const;
          const next = new Map(state);
          next.delete(id);
          return [pending, next] as const;
        });
      const sendBestEffort = (
        process: LocalWorktreeWorkerProcess,
        message: CodexWorktreeWorkerHostMessage,
      ): Effect.Effect<void> =>
        Effect.sync(() => {
          try {
            process.send(message);
          } catch {
            // A concurrent worker failure owns request rejection and cleanup.
          }
        });

      const handleFailure = (error: Error, session: WorkerSession): Effect.Effect<void> =>
        stateLock.withPermits(1)(
          Effect.gen(function* () {
            if ((yield* Ref.get(current)) !== session) return;
            yield* Ref.set(current, null);
            session.releaseListeners();
            const pending = yield* Ref.getAndSet(requests, new Map());
            yield* Effect.sync(() => onInfrastructureError(error));
            yield* failPending(
              pending,
              failure("worker-failure", "Worktree worker is temporarily unavailable", error),
            );
            yield* Effect.tryPromise(() => session.process.terminate()).pipe(Effect.ignore);
          }),
        );

      const handleMessage = (raw: unknown, session: WorkerSession): Effect.Effect<void> =>
        Effect.gen(function* () {
          if ((yield* Ref.get(current)) !== session) return;
          if (!isCodexWorktreeWorkerThreadMessage(raw)) {
            return yield* handleFailure(
              new Error("Worktree worker sent an invalid message"),
              session,
            );
          }
          if (raw.type === "ready") {
            if (raw.epoch === session.epoch && raw.hostId === hostId) return;
            return yield* handleFailure(new Error("Worktree worker identity mismatch"), session);
          }
          const pending = (yield* Ref.get(requests)).get(raw.id);
          if (!pending) return;
          if (raw.operation !== pending.operation) {
            return yield* handleFailure(new Error("Worktree worker operation mismatch"), session);
          }
          if (raw.type === "event") {
            const delivered = yield* Effect.result(
              Effect.try({
                try: () => pending.onEvent(raw.event),
                catch: (cause) =>
                  failure(
                    "deliver-event",
                    cause instanceof Error ? cause.message : String(cause),
                    cause,
                  ),
              }),
            );
            if (delivered._tag === "Success") return;
            yield* takePending(raw.id);
            yield* sendBestEffort(session.process, {
              type: "cancel",
              protocolVersion: CODEX_WORKTREE_WORKER_PROTOCOL_VERSION,
              id: raw.id,
              operation: raw.operation,
            });
            yield* Deferred.fail(pending.reply, delivered.failure);
            return;
          }
          yield* takePending(raw.id);
          if (raw.result.type === "error") {
            yield* Deferred.fail(
              pending.reply,
              failure("worker-result", raw.result.message, new Error(raw.result.message)),
            );
            return;
          }
          yield* Deferred.succeed(pending.reply, raw.result.success);
        });

      const ensureWorker = (): Effect.Effect<WorkerSession, LocalWorktreeWorkerError> =>
        Effect.gen(function* () {
          const existing = yield* Ref.get(current);
          if (existing) return existing;
          const epoch = yield* Ref.getAndUpdate(nextEpoch, (value) => value + 1);
          const process = yield* Effect.try({
            try: () => createProcess({ epoch, hostId, workerPath: options.workerPath }),
            catch: (cause) => failure("start-worker", "Could not start the Worktree worker", cause),
          });
          let releaseListeners = () => undefined;
          const session: WorkerSession = {
            epoch,
            process,
            releaseListeners: () => releaseListeners(),
          };
          const removeMessage = process.onMessage((message) => {
            void runCallback(handleMessage(message, session));
          });
          const removeError = process.onError((error) => {
            void runCallback(handleFailure(error, session));
          });
          const removeExit = process.onExit((code) => {
            void runCallback(
              handleFailure(new Error(`Worktree worker exited with code ${String(code)}`), session),
            );
          });
          releaseListeners = () => {
            removeMessage();
            removeError();
            removeExit();
          };
          yield* Ref.set(current, session);
          return session;
        });

      const cancelPending = (id: string, pending: PendingRequest): Effect.Effect<void> =>
        Effect.gen(function* () {
          const removed = yield* Ref.modify(requests, (state) => {
            if (state.get(id) !== pending) return [false, state] as const;
            const next = new Map(state);
            next.delete(id);
            return [true, next] as const;
          });
          if (!removed) return;
          yield* sendBestEffort(pending.session.process, {
            type: "cancel",
            protocolVersion: CODEX_WORKTREE_WORKER_PROTOCOL_VERSION,
            id,
            operation: pending.operation,
          });
        });

      const externalCancellation = (
        signal: AbortSignal,
      ): Effect.Effect<never, LocalWorktreeWorkerError> =>
        Effect.callback((resume) => {
          const error = () =>
            failure(
              "cancel-request",
              "Request canceled",
              signal.reason ?? new Error("Request canceled"),
            );
          if (signal.aborted) {
            resume(Effect.fail(error()));
            return;
          }
          const cancel = () => resume(Effect.fail(error()));
          signal.addEventListener("abort", cancel, { once: true });
          return Effect.sync(() => signal.removeEventListener("abort", cancel));
        });

      const request = <Operation extends CodexWorktreeWorkerOperation>(
        request: Extract<CodexWorktreeWorkerRequest, { readonly operation: Operation }>,
        requestOptions: Partial<CodexWorktreeWorkerRequestOptions> = {},
      ): Effect.Effect<SuccessValue<Operation>, LocalWorktreeWorkerError> =>
        Effect.gen(function* () {
          if (request.input.hostId !== hostId) {
            return yield* failure(
              "validate-host",
              `Worktree request host ${request.input.hostId} does not match ${hostId}`,
            );
          }
          if (requestOptions.signal?.aborted) {
            return yield* failure(
              "cancel-request",
              "Request canceled",
              requestOptions.signal.reason ?? new Error("Request canceled"),
            );
          }
          const id = `${request.operation}:${randomUUID()}`;
          const message = yield* Effect.try({
            try: () => createCodexWorktreeWorkerRequestMessage({ id, request }),
            catch: (cause) =>
              failure(
                "encode-request",
                cause instanceof Error ? cause.message : String(cause),
                cause,
              ),
          });
          const reply = yield* Deferred.make<
            CodexWorktreeWorkerSuccess,
            LocalWorktreeWorkerError
          >();
          let admittedSession: WorkerSession | null = null;
          const admission = yield* Effect.result(
            stateLock.withPermits(1)(
              Effect.gen(function* () {
                if (yield* Ref.get(closed)) {
                  return yield* failure("admit-request", "Worktree worker is shutting down");
                }
                const session = yield* ensureWorker();
                admittedSession = session;
                const pending: PendingRequest = {
                  operation: request.operation,
                  onEvent: requestOptions.onEvent ?? (() => undefined),
                  reply,
                  session,
                };
                yield* Ref.update(requests, (state) => new Map(state).set(id, pending));
                yield* Effect.try({
                  try: () => session.process.send(message),
                  catch: (cause) =>
                    failure("send-request", "Could not send the Worktree worker request", cause),
                });
                return pending;
              }),
            ),
          );
          if (admission._tag === "Failure") {
            const session = admittedSession;
            if (session) {
              yield* takePending(id);
              yield* handleFailure(
                admission.failure.cause instanceof Error
                  ? admission.failure.cause
                  : new Error(admission.failure.message),
                session,
              );
            }
            return yield* admission.failure;
          }
          const pending = admission.success;
          const response = requestOptions.signal
            ? Effect.raceFirst(Deferred.await(reply), externalCancellation(requestOptions.signal))
            : Deferred.await(reply);
          const success = yield* response.pipe(Effect.ensuring(cancelPending(id, pending)));
          if (success.operation !== request.operation) {
            return yield* failure("decode-result", "Worktree worker result mismatch");
          }
          return success.value as SuccessValue<Operation>;
        });

      const run = <Operation extends CodexWorktreeWorkerOperation>(
        requestValue: Extract<CodexWorktreeWorkerRequest, { readonly operation: Operation }>,
        requestOptions?: Partial<CodexWorktreeWorkerRequestOptions>,
      ): Promise<SuccessValue<Operation>> => runPromise(request(requestValue, requestOptions));

      const port: CodexWorktreeWorkerPort = {
        hostId,
        create: (input, requestOptions) => run({ operation: "create", input }, requestOptions),
        list: (input, requestOptions) => run({ operation: "list", input }, requestOptions),
        inspect: (input, requestOptions) => run({ operation: "inspect", input }, requestOptions),
        snapshot: (input, requestOptions) => run({ operation: "snapshot", input }, requestOptions),
        remove: (input, requestOptions) => run({ operation: "remove", input }, requestOptions),
        restore: (input, requestOptions) => run({ operation: "restore", input }, requestOptions),
        setOwner: (input, requestOptions) => run({ operation: "set-owner", input }, requestOptions),
        prepareHandoff: (input, requestOptions) =>
          run({ operation: "prepare-handoff", input }, requestOptions),
        rollbackHandoff: (input, requestOptions) =>
          run({ operation: "rollback-handoff", input }, requestOptions),
        cleanupHandoff: (input, requestOptions) =>
          run({ operation: "cleanup-handoff", input }, requestOptions),
        exportHandoff: (input, requestOptions) =>
          run({ operation: "export-handoff", input }, requestOptions),
        importHandoff: (input, requestOptions) =>
          run({ operation: "import-handoff", input }, requestOptions),
        cleanupTransferHandoff: (input, requestOptions) =>
          run({ operation: "cleanup-transfer-handoff", input }, requestOptions),
      };

      yield* Effect.addFinalizer(() =>
        stateLock.withPermits(1)(
          Effect.gen(function* () {
            yield* Ref.set(closed, true);
            const session = yield* Ref.getAndSet(current, null);
            const pending = yield* Ref.getAndSet(requests, new Map());
            yield* failPending(pending, failure("shutdown", "Worktree worker is shutting down"));
            if (!session) return;
            session.releaseListeners();
            yield* sendBestEffort(session.process, {
              type: "shutdown",
              protocolVersion: CODEX_WORKTREE_WORKER_PROTOCOL_VERSION,
            });
            yield* Effect.tryPromise(() => session.process.terminate()).pipe(Effect.ignore);
          }),
        ),
      );

      return LocalWorktreeWorkerRuntime.of({ hostId, port, request });
    }),
  );
