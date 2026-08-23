import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Queue from "effect/Queue";
import * as Schema from "effect/Schema";
import type * as Scope from "effect/Scope";
import type {
  CodexCollaborationModeKind,
  CodexPromptInput,
  CodexQueuedFollowUp,
  CodexServiceTier,
} from "../../shared/types";
import type { CodexQueuedFollowUpClaim } from "./CodexConversationAggregate";
import { CodexRendererConversationRegistry } from "./CodexRendererConversationRegistry";
import { ConversationRuntimeMap } from "./ConversationRuntimeMap";

export class CodexQueuedFollowUpsError extends Schema.TaggedError<CodexQueuedFollowUpsError>()(
  "CodexQueuedFollowUpsError",
  {
    operation: Schema.Literals(["enqueue", "claim", "restore"]),
    threadId: Schema.String,
    cause: Schema.Defect(),
  },
) {}

export interface CodexQueuedFollowUpEnqueueInput {
  readonly threadId: string;
  readonly prompt: string;
  readonly collaborationMode?: CodexCollaborationModeKind | null;
  readonly serviceTier?: CodexServiceTier;
  readonly pausedReason?: string | null;
  readonly promptInput?: CodexPromptInput;
  readonly summary?: CodexQueuedFollowUp["summary"];
}

export interface CodexQueuedFollowUpDispatchIntent {
  readonly threadId: string;
}

export class CodexQueuedFollowUps extends Context.Service<
  CodexQueuedFollowUps,
  {
    readonly list: (threadId: string) => readonly CodexQueuedFollowUp[];
    readonly enqueue: (
      input: CodexQueuedFollowUpEnqueueInput,
    ) => Effect.Effect<string, CodexQueuedFollowUpsError>;
    readonly remove: (threadId: string, followUpId: string) => Effect.Effect<boolean>;
    readonly reorder: (
      threadId: string,
      orderedFollowUpIds: readonly string[],
    ) => Effect.Effect<void>;
    readonly clearPaused: (threadId: string) => Effect.Effect<boolean>;
    /** Clears the visible queue without invalidating an already claimed submission. */
    readonly reset: (threadId: string) => Effect.Effect<void>;
    /** Invalidates the Thread generation. Callers must cancel its dispatcher fiber first. */
    readonly clear: (threadId: string) => Effect.Effect<void>;
    readonly requestDispatch: (threadId: string) => Effect.Effect<void>;
    readonly takeDispatchIntent: Effect.Effect<CodexQueuedFollowUpDispatchIntent>;
    readonly claim: (
      threadId: string,
      followUpId?: string,
    ) => Effect.Effect<CodexQueuedFollowUpClaim | null, CodexQueuedFollowUpsError>;
    readonly restore: (
      threadId: string,
      claim: CodexQueuedFollowUpClaim,
      reason: string,
    ) => Effect.Effect<boolean, CodexQueuedFollowUpsError>;
  }
>()("nodex/main/codex-application/CodexQueuedFollowUps") {}

const normalizeId = (value: string): string => value.trim();

const normalizeServiceTier = (value: CodexServiceTier | undefined): CodexServiceTier => {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return normalized && normalized !== "standard" ? normalized : null;
};

export const make: Effect.Effect<
  CodexQueuedFollowUps["Service"],
  never,
  ConversationRuntimeMap | CodexRendererConversationRegistry | Scope.Scope
> = Effect.gen(function* () {
  const conversations = yield* ConversationRuntimeMap;
  const rendererConversations = yield* CodexRendererConversationRegistry;
  const dispatchIntents = yield* Queue.unbounded<CodexQueuedFollowUpDispatchIntent>();
  let nextId = 0;
  let closed = false;

  yield* Effect.addFinalizer(() =>
    Effect.sync(() => {
      closed = true;
    }).pipe(Effect.andThen(Queue.shutdown(dispatchIntents))),
  );

  const projectReplica = (threadId: string): boolean => !rendererConversations.hasOwner(threadId);
  const current = (threadId: string) => conversations.currentConversation(threadId);

  return CodexQueuedFollowUps.of({
    list: (threadId) => current(threadId)?.listQueuedFollowUps() ?? [],
    enqueue: (input) => {
      const threadId = normalizeId(input.threadId);
      const prompt = input.prompt.trim();
      if (!threadId || !prompt || closed) {
        return Effect.fail(
          new CodexQueuedFollowUpsError({
            operation: "enqueue",
            threadId,
            cause: new Error(
              closed
                ? "Queued follow-up state is closed"
                : "Queued follow-up requires a Thread and a non-empty prompt",
            ),
          }),
        );
      }
      return conversations.runExclusive(
        threadId,
        Effect.gen(function* () {
          const aggregate = current(threadId);
          if (!aggregate) {
            return yield* new CodexQueuedFollowUpsError({
              operation: "enqueue",
              threadId,
              cause: new Error(`Conversation '${threadId}' is not loaded`),
            });
          }
          const createdAt = yield* Clock.currentTimeMillis;
          nextId += 1;
          const followUpId = `follow-up:${threadId}:${createdAt}:${nextId.toString(36)}`;
          aggregate.appendQueuedFollowUp(
            {
              followUpId,
              threadId,
              prompt,
              ...(input.promptInput ? { promptInput: input.promptInput } : {}),
              createdAt,
              collaborationMode: input.collaborationMode ?? null,
              serviceTier: normalizeServiceTier(input.serviceTier),
              ...(input.summary !== undefined ? { summary: input.summary } : {}),
              pausedReason: input.pausedReason ?? null,
            },
            projectReplica(threadId),
          );
          return followUpId;
        }),
      );
    },
    remove: (threadId, followUpId) =>
      conversations.runExclusive(
        threadId,
        Effect.sync(
          () =>
            current(threadId)?.removeQueuedFollowUp(
              normalizeId(followUpId),
              projectReplica(threadId),
            ) ?? false,
        ),
      ),
    reorder: (threadId, orderedFollowUpIds) =>
      conversations.runExclusive(
        threadId,
        Effect.sync(() => {
          current(threadId)?.reorderQueuedFollowUps(orderedFollowUpIds, projectReplica(threadId));
        }),
      ),
    clearPaused: (threadId) =>
      conversations.runExclusive(
        threadId,
        Effect.sync(
          () => current(threadId)?.clearPausedQueuedFollowUps(projectReplica(threadId)) ?? false,
        ),
      ),
    reset: (threadId) =>
      conversations.runExclusive(
        threadId,
        Effect.sync(() => {
          current(threadId)?.resetQueuedFollowUps(projectReplica(threadId));
        }),
      ),
    clear: (threadId) =>
      conversations.runExclusive(
        threadId,
        Effect.sync(() => {
          current(threadId)?.clearQueuedFollowUps();
        }),
      ),
    requestDispatch: (threadId) => {
      const normalized = normalizeId(threadId);
      return !closed && normalized
        ? Queue.offer(dispatchIntents, { threadId: normalized }).pipe(Effect.asVoid)
        : Effect.void;
    },
    takeDispatchIntent: Queue.take(dispatchIntents),
    claim: (threadId, followUpId) =>
      conversations
        .runExclusive(
          threadId,
          Effect.sync(
            () =>
              current(threadId)?.claimQueuedFollowUp(
                followUpId ? normalizeId(followUpId) : null,
                projectReplica(threadId),
              ) ?? null,
          ),
        )
        .pipe(
          Effect.mapError(
            (cause) => new CodexQueuedFollowUpsError({ operation: "claim", threadId, cause }),
          ),
        ),
    restore: (threadId, claim, reason) =>
      conversations
        .runExclusive(
          threadId,
          Effect.sync(
            () =>
              current(threadId)?.restoreQueuedFollowUp(claim, reason, projectReplica(threadId)) ??
              false,
          ),
        )
        .pipe(
          Effect.mapError(
            (cause) => new CodexQueuedFollowUpsError({ operation: "restore", threadId, cause }),
          ),
        ),
  });
});
