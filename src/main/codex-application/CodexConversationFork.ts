import { randomUUID } from "node:crypto";
import type { ThreadForkParams } from "@nodex/codex-app-server-protocol/v2/ThreadForkParams";
import type { ThreadForkResponse } from "@nodex/codex-app-server-protocol/v2/ThreadForkResponse";
import type { ClientRequestParamsByMethod } from "@nodex/effect-codex-app-server/rpc";
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import { appendCodexCanonicalForkedFromConversationItem } from "../../shared/codex-conversation-state/codex-conversation-state";
import type { CodexForkBrowserSceneContext } from "../../shared/codex-fork-browser-transfer";
import {
  resolveCodexForkChildThreadTitleFromCatalog,
  resolveCodexForkSourceConversationTitle,
  type CodexForkTitleThread,
} from "../../shared/codex-thread-title";
import type {
  CodexComposerIntent,
  CodexConversationSnapshot,
  ProjectSession,
} from "../../shared/types";
import { buildCodexThreadConfigOverrides } from "../codex/codex-thread-capabilities";
import { CodexGateway } from "../codex-runtime/CodexGateway";
import type { ProjectWorkspaceReadSnapshot } from "../core-client/types";
import { CoreModules } from "../core-runtime/CoreModules";
import { CodexConversationProjection } from "./CodexConversationProjection";
import { CodexForkSidePanelTransfer } from "./CodexForkSidePanelTransferRuntime";
import { CodexOwnerNotificationDrainRuntime } from "./CodexOwnerNotificationDrainRuntime";
import { CodexPendingWorktreeRuntime } from "./CodexPendingWorktreeRuntime";
import { CodexRendererConversationCoordinator } from "./CodexRendererConversationCoordinator";
import { CodexThreadCatalog } from "./CodexThreadCatalog";
import { CodexThreadDirectory } from "./CodexThreadDirectory";
import { CodexThreadTitlePersistence } from "./CodexThreadTitlePersistence";
import { ConversationRuntimeMap } from "./ConversationRuntimeMap";

type GatewayThreadForkParams = ClientRequestParamsByMethod["thread/fork"];

export interface CodexConversationForkInput {
  readonly sourceThreadId: string;
  readonly lastTurnId?: string | null;
  readonly threadSource: NonNullable<ThreadForkParams["threadSource"]>;
  readonly ownerClientId?: string | null;
  readonly sourceSceneContext?: CodexForkBrowserSceneContext;
}

export interface CodexConversationForkResult {
  readonly threadId: string;
  readonly session: ProjectSession;
  readonly conversation: CodexConversationSnapshot;
  readonly composerIntent: CodexComposerIntent;
}

export class CodexConversationForkError extends Data.TaggedError("CodexConversationForkError")<{
  readonly operation: "admit" | "fork" | "materialize" | "project" | "session" | "adopt";
  readonly sourceThreadId: string;
  readonly cause: unknown;
}> {}

export class CodexConversationFork extends Context.Service<
  CodexConversationFork,
  {
    readonly fork: (
      input: CodexConversationForkInput,
    ) => Effect.Effect<CodexConversationForkResult, CodexConversationForkError>;
  }
>()("nodex/main/codex-application/CodexConversationFork") {}

/**
 * Owns a persistent same-directory fork from protocol mutation through durable Session identity.
 * App-server `thread/started` observations may arrive before the response, but they are merely
 * idempotent observations: this transaction commits the authoritative fork result and exact
 * Session ownership, so launch callers never need a notification deferral fence.
 */
export const make: Effect.Effect<
  CodexConversationFork["Service"],
  never,
  | CodexConversationProjection
  | CodexForkSidePanelTransfer
  | CodexGateway
  | CodexOwnerNotificationDrainRuntime
  | CodexPendingWorktreeRuntime
  | CodexRendererConversationCoordinator
  | CodexThreadCatalog
  | CodexThreadDirectory
  | CodexThreadTitlePersistence
  | ConversationRuntimeMap
  | CoreModules
> = Effect.gen(function* () {
  const core = yield* CoreModules;
  const gateway = yield* CodexGateway;
  const projection = yield* CodexConversationProjection;
  const notificationDrain = yield* CodexOwnerNotificationDrainRuntime;
  const pendingWorktrees = yield* CodexPendingWorktreeRuntime;
  const rendererConversations = yield* CodexRendererConversationCoordinator;
  const sidePanelTransfers = yield* CodexForkSidePanelTransfer;
  const catalog = yield* CodexThreadCatalog;
  const directory = yield* CodexThreadDirectory;
  const titles = yield* CodexThreadTitlePersistence;
  const conversations = yield* ConversationRuntimeMap;

  const error = (
    operation: CodexConversationForkError["operation"],
    sourceThreadId: string,
    cause: unknown,
  ) => new CodexConversationForkError({ operation, sourceThreadId, cause });

  const listTitleCatalog = Effect.fn("CodexConversationFork.listTitleCatalog")(function* (
    sourceThreadId: string,
    projectId: string | null,
  ) {
    const known: CodexForkTitleThread[] = [];
    const seenCursors = new Set<string>();
    let after: string | null = null;
    do {
      const response: ProjectWorkspaceReadSnapshot = yield* core.workspace
        .read({
          kind: "task_window",
          project_id: projectId,
          include_archived: false,
          window: { after, first: 200 },
        })
        .pipe(Effect.mapError((cause) => error("project", sourceThreadId, cause)));
      if (response.value.kind !== "task_window") {
        return yield* error(
          "project",
          sourceThreadId,
          new Error("Core returned a non-task-window read variant for fork title derivation"),
        );
      }
      for (const task of response.value.tasks.items) {
        if (!task.thread) continue;
        known.push({
          conversationId: task.thread.thread_id,
          forkedFromId: task.thread.forked_from_id ?? null,
          title: task.thread.thread_name ?? null,
        });
      }
      const next: string | null = response.value.tasks.next_cursor ?? null;
      if (!next || seenCursors.has(next)) break;
      seenCursors.add(next);
      after = next;
    } while (after);
    return known;
  });

  const forkPhysical = Effect.fn("CodexConversationFork.forkPhysical")(function* (
    input: CodexConversationForkInput,
  ): Effect.fn.Return<CodexConversationForkResult, CodexConversationForkError> {
    const sourceThreadId = input.sourceThreadId.trim();
    const lastTurnId = input.lastTurnId?.trim() || null;
    if (!sourceThreadId) {
      return yield* error("admit", input.sourceThreadId, new Error("Fork source is required"));
    }
    yield* notificationDrain.awaitCurrent(sourceThreadId);
    const source = yield* directory
      .resolve({ threadId: sourceThreadId, fidelity: "durable" })
      .pipe(Effect.mapError((cause) => error("admit", sourceThreadId, cause)));
    if (!source) {
      return yield* error(
        "admit",
        sourceThreadId,
        new Error(`Thread '${sourceThreadId}' was not found`),
      );
    }
    const current = yield* projection.read(sourceThreadId).pipe(
      Effect.catch(() =>
        directory
          .resolve({
            threadId: sourceThreadId,
            fidelity: "full",
            hostId: source.durable.executionHostId,
          })
          .pipe(
            Effect.flatMap((entry) =>
              entry?.canonical
                ? Effect.succeed({ canonical: entry.canonical, snapshot: entry.snapshot })
                : Effect.fail(
                    error(
                      "admit",
                      sourceThreadId,
                      new Error(`Thread '${sourceThreadId}' has no canonical projection`),
                    ),
                  ),
            ),
            Effect.mapError((cause) =>
              cause instanceof CodexConversationForkError
                ? cause
                : error("admit", sourceThreadId, cause),
            ),
          ),
      ),
    );
    if (lastTurnId) {
      const turn = current.canonical.turns.find(
        (candidate) => candidate.protocol.id === lastTurnId,
      );
      if (!turn) {
        return yield* error(
          "admit",
          sourceThreadId,
          new Error(`Turn '${lastTurnId}' was not found in Thread '${sourceThreadId}'`),
        );
      }
      if (turn.protocol.status === "inProgress") {
        return yield* error(
          "admit",
          sourceThreadId,
          new Error(`Turn '${lastTurnId}' is still in progress`),
        );
      }
    }

    const knownTitles = yield* listTitleCatalog(sourceThreadId, source.durable.projectId);
    const sourceTitle = resolveCodexForkSourceConversationTitle({
      explicitTitle: source.summary.threadName,
      firstTurnInput: current.canonical.turns[0]?.sidecar.params?.input,
      firstTurnCommentAttachments: current.canonical.turns[0]?.sidecar.params?.commentAttachments,
    });
    const childTitle = resolveCodexForkChildThreadTitleFromCatalog({
      source: {
        conversationId: sourceThreadId,
        forkedFromId: source.summary.forkedFromId ?? null,
        title: source.summary.threadName,
      },
      storedThreads: knownTitles,
      activeThreads: [],
      pendingForks: pendingWorktrees
        .list()
        .filter((entry) => entry.launchMode === "fork-conversation" && entry.sourceConversationId)
        .map((entry) => ({
          conversationId: entry.id,
          forkedFromId: entry.sourceConversationId,
          title: entry.initialThreadTitle ?? entry.label,
        })),
    });
    const execution = yield* core.workspace
      .read({ kind: "execution_context", thread_id: sourceThreadId })
      .pipe(Effect.mapError((cause) => error("project", sourceThreadId, cause)));
    if (execution.value.kind !== "execution_context") {
      return yield* error(
        "project",
        sourceThreadId,
        new Error("Core returned a non-execution-context read variant for fork"),
      );
    }
    const profile = source.durable.executionProfile;
    const request = {
      threadId: sourceThreadId,
      ...(lastTurnId ? { lastTurnId } : {}),
      path: null,
      model: profile?.modelId ?? null,
      modelProvider: profile?.providerId ?? null,
      serviceTier: profile?.serviceTier ?? null,
      cwd: source.durable.cwd,
      runtimeWorkspaceRoots: [...execution.value.context.thread.writable_roots],
      threadSource: input.threadSource,
      config: {
        ...(profile?.harnessId ? { harness: profile.harnessId } : {}),
        ...(profile?.reasoningEffort ? { model_reasoning_effort: profile.reasoningEffort } : {}),
        ...buildCodexThreadConfigOverrides(),
      },
    } satisfies ThreadForkParams;
    const response = (yield* gateway
      .requestOnHost(
        source.durable.executionHostId,
        "thread/fork",
        request as GatewayThreadForkParams,
      )
      .pipe(
        Effect.mapError((cause) => error("fork", sourceThreadId, cause)),
      )) as unknown as ThreadForkResponse;
    if (lastTurnId && response.thread.turns.at(-1)?.id !== lastTurnId) {
      return yield* error(
        "fork",
        sourceThreadId,
        new Error(`Thread fork did not return the requested exact cut through '${lastTurnId}'`),
      );
    }
    const child = yield* directory
      .acceptForkResult({ sourceThreadId, response })
      .pipe(Effect.mapError((cause) => error("materialize", sourceThreadId, cause)));
    if (!child.canonical || !child.snapshot?.turnPagination) {
      return yield* error(
        "materialize",
        sourceThreadId,
        new Error(`Forked Thread '${child.summary.threadId}' was not fully hydrated`),
      );
    }
    const canonical = appendCodexCanonicalForkedFromConversationItem(child.canonical, {
      id: randomUUID(),
      type: "forkedFromConversation",
      sourceConversationId: sourceThreadId,
      sourceConversationTitle: sourceTitle,
    });
    const observedAtMs = yield* Clock.currentTimeMillis;
    yield* projection
      .hydrate({
        threadId: child.summary.threadId,
        summary: child.summary,
        canonical,
        pagination: child.snapshot.turnPagination,
        observedAtMs,
      })
      .pipe(Effect.mapError((cause) => error("project", sourceThreadId, cause)));
    if (childTitle) {
      yield* titles
        .set({
          threadId: child.summary.threadId,
          name: childTitle,
          normalization: "manual",
          syncDormantConversationUpdates: false,
        })
        .pipe(Effect.mapError((cause) => error("project", sourceThreadId, cause)));
    }
    const session = yield* catalog
      .ensureSession(child.summary.threadId)
      .pipe(Effect.mapError((cause) => error("session", sourceThreadId, cause)));
    if (!session?.thread || session.thread.threadId !== child.summary.threadId) {
      return yield* error(
        "session",
        sourceThreadId,
        new Error(`Forked Thread '${child.summary.threadId}' has no owning Session`),
      );
    }
    const accepted = yield* projection
      .read(child.summary.threadId)
      .pipe(Effect.mapError((cause) => error("project", sourceThreadId, cause)));
    if (!accepted.snapshot) {
      return yield* error(
        "project",
        sourceThreadId,
        new Error(`Forked Thread '${child.summary.threadId}' has no canonical projection`),
      );
    }
    const ownerClientId = input.ownerClientId?.trim() || null;
    if (ownerClientId) {
      const adoption = yield* rendererConversations
        .adoptRendererOwner({
          conversationId: child.summary.threadId,
          ownerClientId,
          conversation: accepted.snapshot,
        })
        .pipe(Effect.mapError((cause) => error("adopt", sourceThreadId, cause)));
      if (adoption.ownerClientId !== ownerClientId) {
        return yield* error(
          "adopt",
          sourceThreadId,
          new Error(`Renderer client '${ownerClientId}' could not own the fork`),
        );
      }
    }
    yield* sidePanelTransfers
      .stageDirect({
        sourceConversationId: sourceThreadId,
        targetConversationId: child.summary.threadId,
        ...(input.sourceSceneContext ? { sourceSceneContext: input.sourceSceneContext } : {}),
      })
      .pipe(
        Effect.catchCause((cause) =>
          Effect.logWarning("Forked Thread could not inherit side-panel state").pipe(
            Effect.annotateLogs({
              sourceThreadId,
              childThreadId: child.summary.threadId,
              cause: String(cause),
            }),
          ),
        ),
      );
    return {
      threadId: child.summary.threadId,
      session,
      conversation: accepted.snapshot,
      composerIntent: { prompt: "", focusNonce: observedAtMs },
    };
  });

  return CodexConversationFork.of({
    fork: (input) =>
      conversations.runExclusive(input.sourceThreadId.trim(), forkPhysical(input)).pipe(
        Effect.mapError((cause) =>
          cause instanceof CodexConversationForkError
            ? cause
            : error("fork", input.sourceThreadId, cause),
        ),
        Effect.withSpan("CodexConversationFork.fork", {
          attributes: { sourceThreadId: input.sourceThreadId },
        }),
      ),
  });
});
