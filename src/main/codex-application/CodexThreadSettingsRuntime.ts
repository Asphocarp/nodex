import { CodexAppServerRequestError } from "@nodex/effect-codex-app-server/errors";
import type { ClientRequestParamsByMethod } from "@nodex/effect-codex-app-server/rpc";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as RcMap from "effect/RcMap";
import * as Schema from "effect/Schema";
import * as Scope from "effect/Scope";
import * as Semaphore from "effect/Semaphore";
import type {
  CodexConversationThreadSettings,
  CodexConversationThreadSettingsPatch,
} from "../../shared/types";
import { CodexGateway } from "../codex-runtime/CodexGateway";
import type { CodexRuntimeError } from "../codex-runtime/CodexRuntimeError";

export type CodexThreadSettingsUpdateSupport = "unknown" | "supported" | "unsupported";

export interface CodexThreadSettingsUpdateCommand {
  readonly threadId: string;
  readonly patch: CodexConversationThreadSettingsPatch;
  readonly syncDormantConversationUpdates?: boolean;
}

export interface CodexPreparedThreadSettingsUpdate {
  readonly nextSettings: CodexConversationThreadSettings;
  readonly params: ClientRequestParamsByMethod["thread/settings/update"];
}

export interface CodexThreadSettingsRuntimeOptions {
  readonly prepare: (
    input: CodexThreadSettingsUpdateCommand,
  ) => Effect.Effect<CodexPreparedThreadSettingsUpdate, CodexThreadSettingsOperationError>;
}

export class CodexThreadSettingsOperationError extends Schema.TaggedError<CodexThreadSettingsOperationError>()(
  "CodexThreadSettingsOperationError",
  {
    operation: Schema.Literal("prepare-update"),
    threadId: Schema.String,
    cause: Schema.Defect(),
  },
) {}

export type CodexThreadSettingsError = CodexRuntimeError | CodexThreadSettingsOperationError;

/**
 * Owns the complete next-turn settings transaction.
 *
 * Updates are FIFO per Thread but independent across Threads. Local validation
 * and projection commit before the typed remote update, matching the durable
 * fallback contract for unloaded or older app-server Threads.
 */
export class CodexThreadSettingsRuntime extends Context.Service<
  CodexThreadSettingsRuntime,
  {
    readonly update: (
      input: CodexThreadSettingsUpdateCommand,
    ) => Effect.Effect<CodexConversationThreadSettings, CodexThreadSettingsError>;
    readonly awaitCurrent: (threadId: string) => Effect.Effect<void>;
    readonly remoteUpdateSupport: () => CodexThreadSettingsUpdateSupport;
    readonly recordRemoteUpdateSupported: () => void;
    readonly recordRemoteUpdateUnsupported: () => void;
  }
>()("nodex/main/codex-application/CodexThreadSettingsRuntime") {}

const isRequestError = Schema.is(CodexAppServerRequestError);

const requestError = (error: CodexRuntimeError): CodexAppServerRequestError | null =>
  isRequestError(error.cause) ? error.cause : null;

const isThreadNotFoundError = (error: CodexRuntimeError): boolean => {
  const message = requestError(error)?.message.toLowerCase();
  return Boolean(
    message &&
    !message.includes("method not found") &&
    (message.includes("thread not found") ||
      (message.includes("thread") && message.includes("not found"))),
  );
};

const isUnsupportedUpdateError = (error: CodexRuntimeError): boolean => {
  const request = requestError(error);
  if (!request) return false;
  if (request.code === -32601) return true;
  const message = request.message.toLowerCase();
  return (
    message.includes("method not found") ||
    message.includes("unknown method") ||
    (message.includes("thread/settings/update") && message.includes("unsupported"))
  );
};

export const make = (
  options: CodexThreadSettingsRuntimeOptions,
): Effect.Effect<CodexThreadSettingsRuntime["Service"], never, CodexGateway | Scope.Scope> =>
  Effect.gen(function* () {
    const gateway = yield* CodexGateway;
    const ownerScope = yield* Scope.Scope;
    const lanes = yield* RcMap.make({
      lookup: (_threadId: string) => Semaphore.make(1),
    });
    let remoteUpdateSupport: CodexThreadSettingsUpdateSupport = "unknown";
    const recordRemoteUpdateSupported = (): void => {
      if (remoteUpdateSupport === "unsupported") return;
      remoteUpdateSupport = "supported";
    };
    const recordRemoteUpdateUnsupported = (): void => {
      remoteUpdateSupport = "unsupported";
    };

    const runOwned = <A, E, R>(operation: Effect.Effect<A, E, R>): Effect.Effect<A, E, R> =>
      Effect.acquireUseRelease(
        operation.pipe(Effect.forkIn(ownerScope, { startImmediately: true })),
        Fiber.join,
        Fiber.interrupt,
      );

    const runMutation = <A, E, R>(
      threadId: string,
      mutation: Effect.Effect<A, E, R>,
    ): Effect.Effect<A, E, R> =>
      runOwned(
        Effect.scoped(
          Effect.gen(function* () {
            const lane = yield* RcMap.get(lanes, threadId);
            return yield* lane.withPermit(mutation);
          }),
        ),
      );

    const update = Effect.fn("CodexThreadSettingsRuntime.update")(function* (
      input: CodexThreadSettingsUpdateCommand,
    ) {
      return yield* runMutation(
        input.threadId,
        Effect.gen(function* () {
          const prepared = yield* options.prepare(input);
          if (remoteUpdateSupport === "unsupported") return prepared.nextSettings;

          const result = yield* gateway
            .requestForThread(input.threadId, "thread/settings/update", prepared.params)
            .pipe(Effect.result);
          if (result._tag === "Success") {
            recordRemoteUpdateSupported();
            return prepared.nextSettings;
          }

          const error = result.failure;
          if (isThreadNotFoundError(error)) {
            yield* Effect.logInfo(
              "Task settings will be applied when the unloaded task starts its next turn",
            ).pipe(Effect.annotateLogs({ threadId: input.threadId }));
            return prepared.nextSettings;
          }
          if (!isUnsupportedUpdateError(error)) return yield* Effect.fail(error);

          recordRemoteUpdateUnsupported();
          yield* Effect.logWarning(
            "Codex app-server does not support thread/settings/update; using local next-turn settings fallback",
          ).pipe(Effect.annotateLogs({ threadId: input.threadId }));
          return prepared.nextSettings;
        }),
      );
    });

    return CodexThreadSettingsRuntime.of({
      update,
      awaitCurrent: (threadId) => runMutation(threadId, Effect.void),
      remoteUpdateSupport: () => remoteUpdateSupport,
      recordRemoteUpdateSupported,
      recordRemoteUpdateUnsupported,
    });
  });
