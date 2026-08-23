import * as Context from "effect/Context";
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as RcMap from "effect/RcMap";
import * as Scope from "effect/Scope";
import * as Semaphore from "effect/Semaphore";
import * as Stream from "effect/Stream";
import { DEFAULT_CODEX_HOST_ID } from "../../shared/codex-host";
import type { DesktopProjectWorkspacePort } from "../core-client/project-workspace-adapter";
import { CodexApplicationEventHub } from "./CodexApplicationEventHub";
import { CodexRendererConversationRegistry } from "./CodexRendererConversationRegistry";
import { ConversationRuntimeMap } from "./ConversationRuntimeMap";

export interface CodexThreadReadStateSnapshot {
  readonly exists: boolean;
  readonly archived: boolean;
  readonly conversationHasUnreadTurn: boolean | null;
  readonly workspaceHasUnreadTurn: boolean | null;
}

export interface CodexThreadReadStateUpdate {
  readonly threadId: string;
  readonly hasUnreadTurn: boolean;
}

export class CodexThreadReadStateError extends Data.TaggedError("CodexThreadReadStateError")<{
  readonly operation: "inspect" | "persist" | "project";
  readonly cause: unknown;
}> {}

export interface CodexThreadReadStateOptions {
  readonly inspect: (
    threadId: string,
  ) => Effect.Effect<CodexThreadReadStateSnapshot, CodexThreadReadStateError>;
  readonly persist: (
    input: CodexThreadReadStateUpdate,
  ) => Effect.Effect<boolean, CodexThreadReadStateError>;
  readonly project: (
    input: CodexThreadReadStateUpdate,
  ) => Effect.Effect<void, CodexThreadReadStateError>;
}

export class CodexThreadReadState extends Context.Service<
  CodexThreadReadState,
  {
    /** Commits a user-requested read-state transition durable-first. */
    readonly set: (
      input: CodexThreadReadStateUpdate,
    ) => Effect.Effect<boolean, CodexThreadReadStateError>;
    /** Persists a state already committed by the synchronous conversation reducer. */
    readonly persistProjected: (input: CodexThreadReadStateUpdate) => Effect.Effect<void>;
  }
>()("nodex/main/codex-application/CodexThreadReadState") {}

const makeWithOperations = (
  options: CodexThreadReadStateOptions,
): Effect.Effect<CodexThreadReadState["Service"], never, Scope.Scope> =>
  Effect.gen(function* () {
    const ownerScope = yield* Scope.Scope;
    const lanes = yield* RcMap.make({
      lookup: (_threadId: string) => Semaphore.make(1),
    });

    const runOwned = <A, E>(operation: Effect.Effect<A, E>): Effect.Effect<A, E> =>
      Effect.acquireUseRelease(
        operation.pipe(Effect.forkIn(ownerScope, { startImmediately: true })),
        Fiber.join,
        Fiber.interrupt,
      );

    const runSerial = <A, E>(
      threadId: string,
      operation: Effect.Effect<A, E>,
    ): Effect.Effect<A, E> =>
      runOwned(
        Effect.scoped(
          Effect.gen(function* () {
            const lane = yield* RcMap.get(lanes, threadId);
            return yield* lane.withPermit(operation);
          }),
        ),
      );

    const persistBestEffort = (input: CodexThreadReadStateUpdate): Effect.Effect<boolean> =>
      options.persist(input).pipe(
        Effect.catch((error) =>
          Effect.logWarning("Could not persist Thread read state").pipe(
            Effect.annotateLogs({
              threadId: input.threadId,
              hasUnreadTurn: input.hasUnreadTurn,
              error: String(error.cause),
            }),
            Effect.as(false),
          ),
        ),
      );

    const set = (
      input: CodexThreadReadStateUpdate,
    ): Effect.Effect<boolean, CodexThreadReadStateError> => {
      const threadId = input.threadId.trim();
      if (!threadId) return Effect.succeed(false);
      const normalized = { ...input, threadId };
      return runSerial(
        threadId,
        Effect.gen(function* () {
          const current = yield* options.inspect(threadId);
          if (!current.exists) return false;
          if (normalized.hasUnreadTurn && current.archived) return false;
          const changed =
            (current.conversationHasUnreadTurn !== null &&
              current.conversationHasUnreadTurn !== normalized.hasUnreadTurn) ||
            (current.workspaceHasUnreadTurn !== null &&
              current.workspaceHasUnreadTurn !== normalized.hasUnreadTurn);
          if (!changed) return false;
          if (!(yield* persistBestEffort(normalized))) return false;
          yield* options.project(normalized);
          return true;
        }),
      );
    };

    const persistProjected = (input: CodexThreadReadStateUpdate): Effect.Effect<void> => {
      const threadId = input.threadId.trim();
      if (!threadId) return Effect.void;
      const normalized = { ...input, threadId };
      return runSerial(
        threadId,
        persistBestEffort(normalized).pipe(
          Effect.flatMap((persisted) =>
            persisted
              ? options.project(normalized).pipe(
                  Effect.catch((error) =>
                    Effect.logWarning("Could not reconcile projected Thread read state").pipe(
                      Effect.annotateLogs({
                        threadId,
                        hasUnreadTurn: input.hasUnreadTurn,
                        error: String(error.cause),
                      }),
                    ),
                  ),
                )
              : Effect.void,
          ),
        ),
      );
    };

    return CodexThreadReadState.of({ set, persistProjected });
  });

export type CodexThreadReadStateWorkspace = Pick<
  DesktopProjectWorkspacePort,
  "getThread" | "setThreadUnread"
>;

/** Final construction path: durable Workspace + canonical aggregate + application projection. */
export const make = (
  workspace: CodexThreadReadStateWorkspace,
): Effect.Effect<
  CodexThreadReadState["Service"],
  never,
  | CodexApplicationEventHub
  | CodexRendererConversationRegistry
  | ConversationRuntimeMap
  | Scope.Scope
> =>
  Effect.gen(function* () {
    const conversations = yield* ConversationRuntimeMap;
    const events = yield* CodexApplicationEventHub;
    const rendererConversations = yield* CodexRendererConversationRegistry;
    const readState = yield* makeWithOperations({
      inspect: (threadId) =>
        Effect.tryPromise({
          try: () => workspace.getThread(threadId),
          catch: (cause) => new CodexThreadReadStateError({ operation: "inspect", cause }),
        }).pipe(
          Effect.map((thread) => {
            const aggregate = conversations.currentConversation(threadId);
            const accepted = aggregate?.read().acceptedReplica?.conversation ?? null;
            return {
              exists: aggregate !== null || thread !== null,
              archived: Boolean(thread?.archived || accepted?.archived),
              conversationHasUnreadTurn: aggregate?.readHasUnreadTurn() ?? null,
              workspaceHasUnreadTurn: thread?.hasUnreadTurn ?? null,
            };
          }),
        ),
      persist: ({ threadId, hasUnreadTurn }) =>
        Effect.tryPromise({
          try: () => workspace.setThreadUnread(threadId, hasUnreadTurn),
          catch: (cause) => new CodexThreadReadStateError({ operation: "persist", cause }),
        }).pipe(Effect.map((thread) => thread !== null)),
      project: ({ threadId, hasUnreadTurn }) =>
        Effect.sync(() => {
          conversations
            .currentConversation(threadId)
            ?.setHasUnreadTurn(hasUnreadTurn, !rendererConversations.hasOwner(threadId));
          events.publish({
            kind: "hostMessage",
            value: {
              type: "threadReadStateChanged",
              hostId: DEFAULT_CODEX_HOST_ID,
              conversationId: threadId,
              hasUnreadTurn,
            },
          });
        }),
    });
    yield* events.events.pipe(
      Stream.filter((event) => event.kind === "conversationReadStateCommitted"),
      Stream.mapEffect((event) => readState.persistProjected(event.value)),
      Stream.runDrain,
      Effect.forkScoped({ startImmediately: true }),
    );
    return readState;
  });
