import type { ThreadRollbackParams } from "@nodex/codex-app-server-protocol/v2/ThreadRollbackParams";
import type { ThreadRollbackResponse } from "@nodex/codex-app-server-protocol/v2/ThreadRollbackResponse";
import type { ClientRequestParamsByMethod } from "@nodex/effect-codex-app-server/rpc";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import type { CodexConversationSnapshot } from "../../shared/types";
import { CodexGateway } from "../codex-runtime/CodexGateway";
import type { CodexRuntimeError } from "../codex-runtime/CodexRuntimeError";
import {
  CodexConversationProjection,
  type CodexConversationProjectionError,
} from "./CodexConversationProjection";
import { CodexOwnerNotificationDrainRuntime } from "./CodexOwnerNotificationDrainRuntime";
import { CodexThreadDirectory, type CodexThreadDirectoryError } from "./CodexThreadDirectory";
import { ConversationRuntimeMap } from "./ConversationRuntimeMap";

type GatewayThreadRollbackParams = ClientRequestParamsByMethod["thread/rollback"];

export class CodexThreadRollbackPolicyError extends Schema.TaggedError<CodexThreadRollbackPolicyError>()(
  "CodexThreadRollbackPolicyError",
  {
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

export class CodexThreadRollbackCommands extends Context.Service<
  CodexThreadRollbackCommands,
  {
    readonly rollbackLatestForEdit: (input: {
      readonly threadId: string;
      readonly turnId: string;
      readonly numTurns: number;
    }) => Effect.Effect<
      ThreadRollbackResponse,
      | CodexRuntimeError
      | CodexConversationProjectionError
      | CodexThreadDirectoryError
      | CodexThreadRollbackPolicyError
      | CodexThreadRollbackProtocolError
    >;
  }
>()("nodex/main/codex-application/CodexThreadRollbackCommands") {}

const latestEditableTurnId = (snapshot: CodexConversationSnapshot | null): string | null => {
  const latestTurn = snapshot?.turns.at(-1);
  if (!snapshot || !latestTurn || latestTurn.status === "inProgress") return null;
  const hasUserMessage = latestTurn.items.some(
    (entry) =>
      entry.turnId === latestTurn.turnId &&
      (entry.semanticKind === "userMessage" || entry.kind === "userMessage"),
  );
  return hasUserMessage ? latestTurn.turnId : null;
};

export const make: Effect.Effect<
  CodexThreadRollbackCommands["Service"],
  never,
  | CodexConversationProjection
  | CodexGateway
  | CodexOwnerNotificationDrainRuntime
  | CodexThreadDirectory
  | ConversationRuntimeMap
> = Effect.gen(function* () {
  const projection = yield* CodexConversationProjection;
  const gateway = yield* CodexGateway;
  const ownerNotificationDrain = yield* CodexOwnerNotificationDrainRuntime;
  const directory = yield* CodexThreadDirectory;
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
          if (input.numTurns !== 1) {
            return yield* new CodexThreadRollbackPolicyError({
              threadId: input.threadId,
              cause: new Error("Owner thread/rollback currently supports numTurns: 1"),
            });
          }
          const current = yield* projection.read(input.threadId);
          if (latestEditableTurnId(current.snapshot) !== input.turnId) {
            return yield* new CodexThreadRollbackPolicyError({
              threadId: input.threadId,
              cause: new Error("Only the latest completed user turn can be edited"),
            });
          }
          const request: ThreadRollbackParams = {
            threadId: input.threadId,
            numTurns: input.numTurns,
          };
          const response = yield* gateway.requestForThread(
            input.threadId,
            "thread/rollback",
            request as GatewayThreadRollbackParams,
          );
          if (response.thread.id !== input.threadId) {
            return yield* Effect.fail(
              new CodexThreadRollbackProtocolError({
                threadId: input.threadId,
                responseThreadId: response.thread.id,
              }),
            );
          }
          yield* directory.acceptRollbackResult({
            expectedThreadId: input.threadId,
            thread: response.thread as unknown as Parameters<
              CodexThreadDirectory["Service"]["acceptRollbackResult"]
            >[0]["thread"],
            fallbackCwd: current.snapshot?.cwd ?? null,
          });
          return response as unknown as ThreadRollbackResponse;
        }),
      );
    },
  );

  return CodexThreadRollbackCommands.of({ rollbackLatestForEdit });
});
