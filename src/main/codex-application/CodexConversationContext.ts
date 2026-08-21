import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { CoreModuleResponseError } from "../core-client/core-client";
import { CoreModules } from "../core-runtime/CoreModules";
import { ConversationRuntimeMap } from "./ConversationRuntimeMap";

export interface CodexConversationContextValue {
  readonly threadId: string;
  readonly parentThreadId: string | null;
  readonly rootThreadId: string;
  readonly projectId: string | null;
  readonly cwd: string | null;
  readonly writableRoots: readonly string[];
}

export class CodexConversationContextError extends Schema.TaggedError<CodexConversationContextError>()(
  "CodexConversationContextError",
  {
    threadId: Schema.String,
    cause: Schema.Defect(),
  },
) {}

export class CodexConversationContext extends Context.Service<
  CodexConversationContext,
  {
    readonly read: (
      threadId: string,
    ) => Effect.Effect<CodexConversationContextValue, CodexConversationContextError>;
  }
>()("nodex/main/codex-application/CodexConversationContext") {}

const normalized = (value: string | null | undefined): string | null => {
  const result = value?.trim() ?? "";
  return result ? result : null;
};

/**
 * Resolves live ephemeral topology first, then enriches it with durable execution context.
 * This is the shared lineage/workspace authority for Turn preparation and Nodex authority.
 */
export const make: Effect.Effect<
  CodexConversationContext["Service"],
  never,
  ConversationRuntimeMap | CoreModules
> = Effect.gen(function* () {
  const conversations = yield* ConversationRuntimeMap;
  const core = yield* CoreModules;

  const live = (threadId: string) => {
    const aggregate = conversations.currentConversation(threadId);
    return {
      snapshot: aggregate?.readSnapshot() ?? null,
      canonical: aggregate?.readCanonicalState() ?? null,
    };
  };

  const readCore = <A>(
    effect: Effect.Effect<A, import("../core-runtime/CoreRuntimeError").CoreRuntimeError>,
  ) =>
    effect.pipe(
      Effect.map((value) => value as A | null),
      Effect.catch((error) =>
        error.cause instanceof CoreModuleResponseError && error.cause.coreError.code === "not_found"
          ? Effect.succeed(null)
          : Effect.fail(error),
      ),
    );

  const durableThread = (threadId: string) =>
    readCore(core.workspace.read({ kind: "thread", thread_id: threadId })).pipe(
      Effect.flatMap((snapshot) => {
        if (snapshot === null) return Effect.succeed(null);
        return snapshot.value.kind === "thread"
          ? Effect.succeed(snapshot.value.thread)
          : Effect.fail(
              new CodexConversationContextError({
                threadId,
                cause: new Error("Core returned the wrong Project Workspace Thread read variant"),
              }),
            );
      }),
    );

  const executionContext = (threadId: string) =>
    readCore(core.workspace.read({ kind: "execution_context", thread_id: threadId })).pipe(
      Effect.flatMap((snapshot) => {
        if (snapshot === null) return Effect.succeed(null);
        return snapshot.value.kind === "execution_context"
          ? Effect.succeed(snapshot.value.context)
          : Effect.fail(
              new CodexConversationContextError({
                threadId,
                cause: new Error(
                  "Core returned the wrong Project Workspace execution read variant",
                ),
              }),
            );
      }),
    );

  return CodexConversationContext.of({
    read: (threadId) =>
      Effect.gen(function* () {
        const requestedThreadId = threadId.trim();
        const requestedLive = live(requestedThreadId);
        const requestedDurable = yield* durableThread(requestedThreadId);
        const execution = yield* executionContext(requestedThreadId);
        const ephemeral = requestedLive.snapshot?.ephemeral === true;
        const liveParent = normalized(requestedLive.snapshot?.source?.parentThreadId);
        const durableParent = normalized(requestedDurable?.parent_thread_id);
        const parentThreadId = ephemeral
          ? (liveParent ?? durableParent)
          : (durableParent ?? liveParent);
        const liveProjectId = normalized(requestedLive.snapshot?.projectId);
        const durableProjectId = normalized(requestedDurable?.project_id);
        let projectId = ephemeral
          ? (liveProjectId ?? durableProjectId)
          : (durableProjectId ?? liveProjectId);
        let rootThreadId = requestedThreadId;
        let cursor = parentThreadId;
        const visited = new Set([requestedThreadId]);
        while (cursor) {
          if (visited.has(cursor)) {
            rootThreadId = requestedThreadId;
            break;
          }
          visited.add(cursor);
          rootThreadId = cursor;
          const cursorLive = live(cursor).snapshot;
          const cursorDurable = yield* durableThread(cursor);
          const cursorEphemeral = cursorLive?.ephemeral === true;
          const cursorLiveProject = normalized(cursorLive?.projectId);
          const cursorDurableProject = normalized(cursorDurable?.project_id);
          projectId ??= cursorEphemeral
            ? (cursorLiveProject ?? cursorDurableProject)
            : (cursorDurableProject ?? cursorLiveProject);
          const cursorLiveParent = normalized(cursorLive?.source?.parentThreadId);
          const cursorDurableParent = normalized(cursorDurable?.parent_thread_id);
          cursor = cursorEphemeral
            ? (cursorLiveParent ?? cursorDurableParent)
            : (cursorDurableParent ?? cursorLiveParent);
        }
        const hydration = requestedLive.canonical?.sidecar.hydrationContext;
        const liveCwd = normalized(requestedLive.snapshot?.cwd) ?? normalized(hydration?.cwd);
        const durableCwd = normalized(requestedDurable?.cwd);
        const cwd = ephemeral ? (liveCwd ?? durableCwd) : (durableCwd ?? liveCwd);
        const writableRoots = execution?.thread.writable_roots.length
          ? [...execution.thread.writable_roots]
          : hydration?.currentPermissions.runtimeWorkspaceRoots.length
            ? [...hydration.currentPermissions.runtimeWorkspaceRoots]
            : cwd
              ? [cwd]
              : [];
        return {
          threadId: requestedThreadId,
          parentThreadId,
          rootThreadId,
          projectId,
          cwd,
          writableRoots,
        };
      }).pipe(
        Effect.mapError((cause) =>
          cause instanceof CodexConversationContextError
            ? cause
            : new CodexConversationContextError({ threadId, cause }),
        ),
      ),
  });
});
