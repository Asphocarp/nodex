import { Cause, Data, Deferred, Effect, Exit, Fiber, Queue, Ref } from "effect";
import type { JsonRpcResponseEnvelope } from "../codex/codex-app-server-message-parser";
import { forkControlPlane, makeControlPlaneQueue, runControlPlanePromise } from "./runtime";

interface RequestCommand {
  readonly _tag: "Request";
  readonly deferred: Deferred.Deferred<unknown, CodexSessionFailure>;
  readonly id: number;
  readonly method: string;
  readonly send: (id: number) => void;
  readonly startedAt: number;
  readonly timeoutMs: number;
}

interface ResponseCommand {
  readonly _tag: "Response";
  readonly response: JsonRpcResponseEnvelope;
}

interface CloseCommand {
  readonly _tag: "Close";
  readonly acknowledged: Deferred.Deferred<void>;
  readonly failure: CodexSessionFailure;
}

type SessionCommand = CloseCommand | RequestCommand | ResponseCommand;

interface PendingRequest {
  readonly deferred: Deferred.Deferred<unknown, CodexSessionFailure>;
  readonly method: string;
  readonly startedAt: number;
  readonly timeout: Fiber.Fiber<void>;
}

export interface CodexAppServerSessionRuntime {
  close(error: Error): Promise<void>;
  handleResponse(response: JsonRpcResponseEnvelope): void;
  pendingCount(): number;
  request(method: string, send: (id: number) => void, timeoutMs?: number): Promise<unknown>;
}

interface CodexAppServerSessionOptions {
  readonly createRpcError: (error: {
    readonly code: number;
    readonly data?: unknown;
    readonly message: string;
  }) => Error;
  readonly now?: () => number;
  readonly onClose?: () => Promise<void>;
  readonly onRequestCompleted?: (input: {
    readonly durationMs: number;
    readonly id: number | string;
    readonly method: string;
  }) => void;
  readonly onRequestFailed?: (input: {
    readonly durationMs: number;
    readonly errorCode: number;
    readonly errorMessage: string;
    readonly id: number | string;
    readonly method: string;
  }) => void;
  readonly onRequestTimedOut?: (input: {
    readonly id: number;
    readonly method: string;
    readonly timeoutMs: number;
  }) => void;
  readonly requestTimeoutMs: number;
}

export class CodexSessionFailure extends Data.TaggedError("CodexSessionFailure")<{
  readonly cause: unknown;
}> {}

const complete = <E>(deferred: Deferred.Deferred<void, E>): void => {
  Deferred.doneUnsafe(deferred, Effect.void);
};

const fail = <A>(
  deferred: Deferred.Deferred<A, CodexSessionFailure>,
  error: CodexSessionFailure,
): void => {
  Deferred.doneUnsafe(deferred, Effect.fail(error));
};

const succeed = <A>(deferred: Deferred.Deferred<A, CodexSessionFailure>, value: A): void => {
  Deferred.doneUnsafe(deferred, Effect.succeed(value));
};

const observe = (callback: (() => void) | undefined): void => {
  if (callback === undefined) return;
  try {
    callback();
  } catch {
    // Diagnostics must not terminate an RPC session.
  }
};

const unwrapSessionFailure = (error: unknown): unknown =>
  error instanceof CodexSessionFailure ? error.cause : error;

/** The request deadline effect, exported so the contract can use TestClock. */
export const waitForCodexRequestTimeout = (timeoutMs: number): Effect.Effect<void> =>
  Effect.sleep(timeoutMs);

export function createCodexAppServerSessionRuntime(
  options: CodexAppServerSessionOptions,
): CodexAppServerSessionRuntime {
  const commands = makeControlPlaneQueue<SessionCommand>();
  const pendingCount = Ref.makeUnsafe(0);
  const now = options.now ?? Date.now;
  let closedError: Error | null = null;
  let closePromise: Promise<void> | null = null;
  let nextRequestId = 1;

  const loop = Effect.scoped(
    Effect.gen(function* () {
      const pending = new Map<string, PendingRequest>();
      if (options.onClose !== undefined) {
        yield* Effect.addFinalizer(() => Effect.promise(options.onClose!));
      }
      while (true) {
        const command = yield* Queue.take(commands);
        if (command._tag === "Close") {
          for (const request of pending.values()) {
            yield* Fiber.interrupt(request.timeout);
            fail(request.deferred, command.failure);
          }
          pending.clear();
          yield* Ref.set(pendingCount, 0);
          complete(command.acknowledged);
          return;
        }

        if (command._tag === "Response") {
          const key = String(command.response.id);
          const request = pending.get(key);
          if (request === undefined) continue;
          pending.delete(key);
          yield* Ref.set(pendingCount, pending.size);
          yield* Fiber.interrupt(request.timeout);
          const durationMs = now() - request.startedAt;
          if ("error" in command.response) {
            const responseError = command.response.error;
            observe(() =>
              options.onRequestFailed?.({
                durationMs,
                errorCode: responseError.code,
                errorMessage: responseError.message,
                id: command.response.id,
                method: request.method,
              }),
            );
            fail(
              request.deferred,
              new CodexSessionFailure({
                cause: options.createRpcError(responseError),
              }),
            );
            continue;
          }
          observe(() =>
            options.onRequestCompleted?.({
              durationMs,
              id: command.response.id,
              method: request.method,
            }),
          );
          succeed(request.deferred, command.response.result);
          continue;
        }

        const key = String(command.id);
        const timeout = yield* Effect.gen(function* () {
          yield* waitForCodexRequestTimeout(command.timeoutMs);
          const request = pending.get(key);
          if (request === undefined) return;
          pending.delete(key);
          yield* Ref.set(pendingCount, pending.size);
          observe(() =>
            options.onRequestTimedOut?.({
              id: command.id,
              method: command.method,
              timeoutMs: command.timeoutMs,
            }),
          );
          fail(
            request.deferred,
            new CodexSessionFailure({
              cause: new Error(`Codex request timed out: ${command.method}`),
            }),
          );
        }).pipe(Effect.forkScoped);
        pending.set(key, {
          deferred: command.deferred,
          method: command.method,
          startedAt: command.startedAt,
          timeout,
        });
        yield* Ref.set(pendingCount, pending.size);
        const sent = yield* Effect.result(
          Effect.try({
            try: () => command.send(command.id),
            catch: (cause) => new CodexSessionFailure({ cause }),
          }),
        );
        if (sent._tag === "Failure") {
          pending.delete(key);
          yield* Ref.set(pendingCount, pending.size);
          yield* Fiber.interrupt(timeout);
          fail(command.deferred, sent.failure);
        }
      }
    }),
  );
  const fiber = forkControlPlane(loop);

  return {
    close: (error) => {
      if (closePromise !== null) return closePromise;
      closedError = error;
      const acknowledged = Deferred.makeUnsafe<void>();
      Queue.offerUnsafe(commands, {
        _tag: "Close",
        acknowledged,
        failure: new CodexSessionFailure({ cause: error }),
      });
      closePromise = runControlPlanePromise(Deferred.await(acknowledged))
        .then(() => fiber.result)
        .then((exit) => {
          if (Exit.isFailure(exit)) throw Cause.squash(exit.cause);
        });
      return closePromise;
    },
    handleResponse: (response) => {
      if (closedError !== null) return;
      Queue.offerUnsafe(commands, { _tag: "Response", response });
    },
    pendingCount: () => Ref.getUnsafe(pendingCount),
    request: (method, send, timeoutMs = options.requestTimeoutMs) => {
      if (closedError !== null) return Promise.reject(closedError);
      const deferred = Deferred.makeUnsafe<unknown, CodexSessionFailure>();
      const id = nextRequestId;
      nextRequestId += 1;
      Queue.offerUnsafe(commands, {
        _tag: "Request",
        deferred,
        id,
        method,
        send,
        startedAt: now(),
        timeoutMs,
      });
      return runControlPlanePromise(Deferred.await(deferred)).catch((error: unknown) => {
        throw unwrapSessionFailure(error);
      });
    },
  };
}
