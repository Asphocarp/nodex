import type { ThreadResumeResponse, Turn } from "@nodex/codex-app-server-protocol/v2";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { createCodexCanonicalHydratedConversationState } from "../../shared/codex-conversation-state/codex-conversation-state";
import { CodexGateway } from "../codex-runtime/CodexGateway";
import { ConversationEntityMap } from "./internal/ConversationEntityMap";

export class CodexConversationMaterializationError extends Schema.TaggedError<CodexConversationMaterializationError>()(
  "CodexConversationMaterializationError",
  {
    threadId: Schema.String,
    cause: Schema.Defect(),
  },
) {}

export class CodexConversationMaterialization extends Context.Service<
  CodexConversationMaterialization,
  {
    readonly ensure: (
      threadId: string,
    ) => Effect.Effect<void, CodexConversationMaterializationError>;
    readonly reload: (
      threadId: string,
    ) => Effect.Effect<void, CodexConversationMaterializationError>;
  }
>()("nodex/main/codex-application/CodexConversationMaterialization") {}

const normalizeTurn = (turn: unknown): Turn => {
  const protocol = turn as Turn;
  return {
    ...protocol,
    items: [...protocol.items],
    itemsView: protocol.itemsView ?? "full",
    error: protocol.error ?? null,
    startedAt: protocol.startedAt ?? null,
    completedAt: protocol.completedAt ?? null,
    durationMs: protocol.durationMs ?? null,
  };
};

/**
 * Makes an app-server Thread live and installs its complete canonical application state.
 * Commands use this before admission and for the single thread-not-found recovery retry.
 */
export const make: Effect.Effect<
  CodexConversationMaterialization["Service"],
  never,
  CodexGateway | ConversationEntityMap
> = Effect.gen(function* () {
  const gateway = yield* CodexGateway;
  const conversations = yield* ConversationEntityMap;

  const reload = (threadId: string) =>
    Effect.gen(function* () {
      const aggregate = conversations.entity(threadId);
      const response = yield* gateway.requestForThread(threadId, "thread/resume", {
        threadId,
        initialTurnsPage: {
          limit: 5,
          sortDirection: "desc",
          itemsView: "full",
        },
      });
      const resume = response as unknown as ThreadResumeResponse;
      if (resume.thread.id !== threadId) {
        return yield* new CodexConversationMaterializationError({
          threadId,
          cause: new Error(
            `Canonical materialization expected Thread '${threadId}' but received '${resume.thread.id}'`,
          ),
        });
      }
      const initialPage = resume.initialTurnsPage;
      const turns = (initialPage ? [...initialPage.data].reverse() : [...resume.thread.turns]).map(
        normalizeTurn,
      );
      const thread = { ...resume.thread, turns };
      const canonical = createCodexCanonicalHydratedConversationState(thread, {
        model: resume.model,
        reasoningEffort: resume.reasoningEffort,
        cwd: resume.cwd || resume.thread.cwd || "/",
        approvalPolicy: resume.approvalPolicy,
        approvalsReviewer: resume.approvalsReviewer,
        sandboxPolicy: resume.sandbox,
        activePermissionProfile: resume.activePermissionProfile,
        runtimeWorkspaceRoots: [...resume.runtimeWorkspaceRoots],
        pendingRequests: aggregate.readServerRequests(),
        hasUnreadTurn: aggregate.readHasUnreadTurn(),
      });
      aggregate.acceptCanonicalState(canonical);
      aggregate.setResumeState("resumed");
      if (initialPage) {
        aggregate.initializeHistory(
          {
            olderCursor: initialPage.nextCursor ?? null,
            backwardsCursor: resume.turnsBackwardsCursor ?? null,
            oldestLoadedTurnId: turns[0]?.id ?? null,
            isLoadingOlder: false,
            hasLoadedOldest: initialPage.nextCursor == null,
            loadedTurnCount: turns.length,
            itemsView: "full",
          },
          turns.length,
        );
      }
    }).pipe(
      Effect.mapError((cause) =>
        cause instanceof CodexConversationMaterializationError
          ? cause
          : new CodexConversationMaterializationError({ threadId, cause }),
      ),
      Effect.withSpan("CodexConversationMaterialization.reload", {
        attributes: { threadId },
      }),
    );

  return CodexConversationMaterialization.of({
    ensure: (threadId) =>
      conversations.current(threadId)?.readCanonicalState()?.sidecar.hydrationContext
        ? Effect.void
        : reload(threadId),
    reload,
  });
});
