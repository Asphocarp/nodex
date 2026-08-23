import type { ThreadRollbackParams } from "@nodex/codex-app-server-protocol/v2/ThreadRollbackParams";
import type { ThreadRollbackResponse } from "@nodex/codex-app-server-protocol/v2/ThreadRollbackResponse";
import type { ClientRequestParamsByMethod } from "@nodex/effect-codex-app-server/rpc";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { CodexGateway } from "../codex-runtime/CodexGateway";
import type { CodexRuntimeError } from "../codex-runtime/CodexRuntimeError";
import { CodexOwnerNotificationDrainRuntime } from "./CodexOwnerNotificationDrainRuntime";
import { ConversationRuntimeMap } from "./ConversationRuntimeMap";

type GatewayThreadRollbackParams = ClientRequestParamsByMethod["thread/rollback"];

export interface CodexPreparedThreadRollback {
  readonly threadId: string;
  readonly request: ThreadRollbackParams;
  /** Opaque transaction state owned exclusively by the projection. */
  readonly state: object;
}

export class CodexThreadRollbackProjectionError extends Schema.TaggedError<CodexThreadRollbackProjectionError>()(
  "CodexThreadRollbackProjectionError",
  {
    operation: Schema.Literals(["prepare", "commit"]),
    threadId: Schema.String,
    cause: Schema.Defect(),
  },
) {}

export class CodexThreadRollbackProtocolError extends Schema.TaggedError<CodexThreadRollbackProtocolError>()(
  "CodexThreadRollbackProtocolError",
  {
    threadId: Schema.String,
    responseThreadId: Schema.String,
  },
) {}

export interface CodexThreadRollbackProjection {
  readonly prepareLatestForEdit: (input: {
    readonly threadId: string;
    readonly turnId: string;
    readonly numTurns: number;
  }) => Effect.Effect<CodexPreparedThreadRollback, CodexThreadRollbackProjectionError>;
  readonly commit: (
    prepared: CodexPreparedThreadRollback,
    response: ThreadRollbackResponse,
  ) => Effect.Effect<ThreadRollbackResponse, CodexThreadRollbackProjectionError>;
}

export class CodexThreadRollbackCommands extends Context.Service<
  CodexThreadRollbackCommands,
  {
    readonly rollbackLatestForEdit: (input: {
      readonly threadId: string;
      readonly turnId: string;
      readonly numTurns: number;
    }) => Effect.Effect<
      ThreadRollbackResponse,
      CodexRuntimeError | CodexThreadRollbackProjectionError | CodexThreadRollbackProtocolError
    >;
  }
>()("nodex/main/codex-application/CodexThreadRollbackCommands") {}

export const make = (
  projection: CodexThreadRollbackProjection,
): Effect.Effect<
  CodexThreadRollbackCommands["Service"],
  never,
  CodexGateway | CodexOwnerNotificationDrainRuntime | ConversationRuntimeMap
> =>
  Effect.gen(function* () {
    const gateway = yield* CodexGateway;
    const ownerNotificationDrain = yield* CodexOwnerNotificationDrainRuntime;
    const conversations = yield* ConversationRuntimeMap;

    const rollbackLatestForEdit = Effect.fn("CodexThreadRollbackCommands.rollbackLatestForEdit")(
      function* (input: {
        readonly threadId: string;
        readonly turnId: string;
        readonly numTurns: number;
      }) {
        return yield* conversations.runExclusive(
          input.threadId,
          Effect.gen(function* () {
            yield* ownerNotificationDrain.awaitCurrent(input.threadId);
            const prepared = yield* projection.prepareLatestForEdit(input);
            const response = yield* gateway.requestForThread(
              prepared.threadId,
              "thread/rollback",
              prepared.request as GatewayThreadRollbackParams,
            );
            if (response.thread.id !== prepared.threadId) {
              return yield* Effect.fail(
                new CodexThreadRollbackProtocolError({
                  threadId: prepared.threadId,
                  responseThreadId: response.thread.id,
                }),
              );
            }
            return yield* projection.commit(
              prepared,
              response as unknown as ThreadRollbackResponse,
            );
          }),
        );
      },
    );

    return CodexThreadRollbackCommands.of({ rollbackLatestForEdit });
  });
