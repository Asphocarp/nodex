import { randomUUID } from "node:crypto";
import type { ThreadForkParams } from "@nodex/codex-app-server-protocol/v2/ThreadForkParams";
import type { ThreadForkResponse } from "@nodex/codex-app-server-protocol/v2/ThreadForkResponse";
import type { ClientRequestParamsByMethod } from "@nodex/effect-codex-app-server/rpc";
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import {
  appendCodexCanonicalForkedFromConversationItem,
  appendCodexCanonicalWorktreeInitItem,
  type CodexCanonicalWorktreeInitItem,
} from "../../shared/codex-conversation-state/codex-conversation-state";
import type { CodexForkBrowserSceneContext } from "../../shared/codex-fork-browser-transfer";
import type {
  CodexComposerIntent,
  CodexConversationSnapshot,
  ProjectSession,
} from "../../shared/types";
import { buildCodexThreadConfigOverrides } from "../codex/codex-thread-capabilities";
import { CodexGateway } from "../codex-runtime/CodexGateway";
import { CoreModules } from "../core-runtime/CoreModules";
import { CodexConversationProjection } from "./CodexConversationProjection";
import { CodexForkSidePanelTransfer } from "./CodexForkSidePanelTransferRuntime";
import { CodexForkTitlePolicy } from "./CodexForkTitlePolicy";
import { CodexOwnerNotificationDrainRuntime } from "./CodexOwnerNotificationDrainRuntime";
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
  readonly target?: {
    readonly projectId: string | null;
    readonly cwd: string;
    readonly managedWorktreePath: string | null;
    readonly runtimeWorkspaceRoots: readonly string[];
  };
  readonly pendingWorktreeId?: string;
  readonly worktreeInit?: CodexCanonicalWorktreeInitItem;
  readonly titleOverride?: {
    readonly childTitle: string | null;
    readonly sourceTitle?: string | null;
  };
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
  | CodexForkTitlePolicy
  | CodexGateway
  | CodexOwnerNotificationDrainRuntime
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
  const rendererConversations = yield* CodexRendererConversationCoordinator;
  const sidePanelTransfers = yield* CodexForkSidePanelTransfer;
  const forkTitles = yield* CodexForkTitlePolicy;
  const catalog = yield* CodexThreadCatalog;
  const directory = yield* CodexThreadDirectory;
  const titles = yield* CodexThreadTitlePersistence;
  const conversations = yield* ConversationRuntimeMap;

  const error = (
    operation: CodexConversationForkError["operation"],
    sourceThreadId: string,
    cause: unknown,
  ) => new CodexConversationForkError({ operation, sourceThreadId, cause });

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
    const current = yield* projection
      .read(sourceThreadId)
      .pipe(Effect.mapError((cause) => error("admit", sourceThreadId, cause)));
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

    const derivedTitles = yield* forkTitles
      .derive({
        threadId: sourceThreadId,
        projectId: source.durable.projectId,
        forkedFromId: source.summary.forkedFromId ?? null,
        threadName: source.summary.threadName,
        canonical: current.canonical,
      })
      .pipe(Effect.mapError((cause) => error("project", sourceThreadId, cause)));
    const childTitle = input.titleOverride?.childTitle ?? derivedTitles.childTitle;
    const sourceTitle = input.titleOverride?.sourceTitle ?? derivedTitles.sourceTitle;
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
      cwd: input.target?.cwd ?? source.durable.cwd,
      runtimeWorkspaceRoots: [
        ...(input.target?.runtimeWorkspaceRoots ?? execution.value.context.thread.writable_roots),
      ],
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
      .acceptForkResult({
        sourceThreadId,
        response,
        ...(input.target ? { target: input.target } : {}),
      })
      .pipe(Effect.mapError((cause) => error("materialize", sourceThreadId, cause)));
    if (!child.canonical || !child.snapshot?.turnPagination) {
      return yield* error(
        "materialize",
        sourceThreadId,
        new Error(`Forked Thread '${child.summary.threadId}' was not fully hydrated`),
      );
    }
    const withForkMarker = appendCodexCanonicalForkedFromConversationItem(child.canonical, {
      id: randomUUID(),
      type: "forkedFromConversation",
      sourceConversationId: sourceThreadId,
      sourceConversationTitle: sourceTitle,
    });
    const canonical = input.worktreeInit
      ? appendCodexCanonicalWorktreeInitItem(withForkMarker, input.worktreeInit, "new-turn")
      : withForkMarker;
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
    yield* (
      input.pendingWorktreeId && input.target
        ? sidePanelTransfers.promotePending({
            pendingWorktreeId: input.pendingWorktreeId,
            targetConversationId: child.summary.threadId,
            targetWorkspaceRoot: input.target.cwd,
          })
        : sidePanelTransfers.stageDirect({
            sourceConversationId: sourceThreadId,
            targetConversationId: child.summary.threadId,
            ...(input.sourceSceneContext ? { sourceSceneContext: input.sourceSceneContext } : {}),
          })
    ).pipe(
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
      Effect.gen(function* () {
        const sourceThreadId = input.sourceThreadId.trim();
        if (!sourceThreadId) {
          return yield* error("admit", input.sourceThreadId, new Error("Fork source is required"));
        }
        const durable = yield* directory
          .resolve({ threadId: sourceThreadId, fidelity: "durable" })
          .pipe(Effect.mapError((cause) => error("admit", sourceThreadId, cause)));
        if (!durable) {
          return yield* error(
            "admit",
            sourceThreadId,
            new Error(`Thread '${sourceThreadId}' was not found`),
          );
        }
        yield* projection.read(sourceThreadId).pipe(
          Effect.catch(() =>
            directory
              .resolve({
                threadId: sourceThreadId,
                fidelity: "full",
                hostId: durable.durable.executionHostId,
              })
              .pipe(
                Effect.flatMap((entry) =>
                  entry?.canonical
                    ? Effect.void
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
        return yield* conversations.runExclusive(sourceThreadId, forkPhysical(input));
      }).pipe(
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
