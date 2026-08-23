import { randomUUID } from "node:crypto";
import type { Thread, ThreadForkResponse, Turn } from "@nodex/codex-app-server-protocol/v2";
import type { ThreadResumeResponse } from "@nodex/codex-app-server-protocol/v2/ThreadResumeResponse";
import type { ThreadStartResponse } from "@nodex/codex-app-server-protocol/v2/ThreadStartResponse";
import type { ThreadListParams } from "@nodex/codex-app-server-protocol/v2/ThreadListParams";
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Schema from "effect/Schema";
import * as Scope from "effect/Scope";
import {
  createCodexCanonicalHydratedConversationState,
  createCodexCanonicalWorkspacePermissionContext,
} from "../../shared/codex-conversation-state/codex-conversation-state";
import { extractCodexThreadSubagentMetadata } from "../../shared/codex-subagent-metadata";
import type {
  CodexCanonicalConversationState,
  CodexConversationSnapshot,
  CodexConversationTurnPagination,
  CodexThreadSummary,
} from "../../shared/types";
import type { AgentExecutionProfile } from "../../shared/agent-runtime";
import type { DesktopProjectWorkspaceThread } from "../core-client/project-workspace-adapter";
import { CoreModuleResponseError } from "../core-client/core-client";
import { CodexGateway } from "../codex-runtime/CodexGateway";
import {
  projectCodexGatewayThreadReadThread,
  projectCodexGatewayThreadResumeResponse,
} from "../codex-runtime/CodexGatewayProtocolProjection";
import { CoreModules } from "../core-runtime/CoreModules";
import { CoreRuntimeError } from "../core-runtime/CoreRuntimeError";
import { CodexApplicationEventHub } from "./CodexApplicationEventHub";
import { CodexConversationProjection } from "./CodexConversationProjection";
import { ConversationRuntimeMap } from "./ConversationRuntimeMap";
import {
  buildWorkspaceThreadSummary,
  hasSidebarThreadSummaryChanged,
} from "./CodexThreadCatalogProjection";
import {
  projectCodexThreadDirectoryMaterialization,
  projectCoreWorkspaceThread,
} from "./CodexThreadDirectoryProjection";

export type CodexThreadDirectoryFidelity = "durable" | "metadata" | "full" | "live";

export interface CodexThreadDirectoryEntry {
  readonly fidelity: CodexThreadDirectoryFidelity;
  readonly durable: DesktopProjectWorkspaceThread;
  readonly summary: CodexThreadSummary;
  readonly canonical: CodexCanonicalConversationState | null;
  readonly snapshot: CodexConversationSnapshot | null;
}

export class CodexThreadDirectoryError extends Schema.TaggedError<CodexThreadDirectoryError>()(
  "CodexThreadDirectoryError",
  {
    operation: Schema.Literals(["read", "materialize", "discover"]),
    threadId: Schema.String,
    cause: Schema.Defect(),
  },
) {}

export class CodexThreadDirectory extends Context.Service<
  CodexThreadDirectory,
  {
    readonly resolve: (input: {
      readonly threadId: string;
      readonly fidelity: CodexThreadDirectoryFidelity;
      readonly hostId?: string;
    }) => Effect.Effect<CodexThreadDirectoryEntry | null, CodexThreadDirectoryError>;
    readonly descendants: (input: {
      readonly rootThreadId: string;
      readonly threadIds?: readonly string[];
      readonly fidelity: Exclude<CodexThreadDirectoryFidelity, "live">;
    }) => Effect.Effect<readonly CodexThreadDirectoryEntry[], CodexThreadDirectoryError>;
    /**
     * Accepts a Thread returned by a protocol mutation while the caller owns the Thread lane.
     * The Directory commits durable identity and refreshes the canonical aggregate as one
     * application projection outcome.
     */
    readonly acceptRollbackResult: (input: {
      readonly expectedThreadId: string;
      readonly thread: Thread;
      readonly executionHostId?: string;
      readonly fallbackCwd?: string | null;
    }) => Effect.Effect<CodexThreadDirectoryEntry, CodexThreadDirectoryError>;
    /** Accepts an exact persistent fork and inherits its durable execution authority. */
    readonly acceptForkResult: (input: {
      readonly sourceThreadId: string;
      readonly response: ThreadForkResponse;
    }) => Effect.Effect<CodexThreadDirectoryEntry, CodexThreadDirectoryError>;
    /** Accepts an imported rollout as a standalone local Thread. */
    readonly acceptImportResult: (input: {
      readonly response: ThreadForkResponse;
      readonly fallbackCwd: string;
      readonly executionHostId?: string;
    }) => Effect.Effect<CodexThreadDirectoryEntry, CodexThreadDirectoryError>;
    /** Links a newly accepted protocol Thread to its exact Session, then hydrates canonical state. */
    readonly acceptSessionStart: (input: {
      readonly response: ThreadStartResponse;
      readonly sessionId: string;
      readonly projectId: string | null;
      readonly executionProfile: AgentExecutionProfile | null;
      readonly runtimeWorkspaceRoots: readonly string[];
      readonly fallbackCwd: string;
      readonly projectlessOutputDirectory?: string | null;
      readonly projectlessWorkspaceBrowserRoot?: string | null;
    }) => Effect.Effect<CodexThreadDirectoryEntry, CodexThreadDirectoryError>;
    /** Commits one app-server catalog observation with an explicit initial ownership decision. */
    readonly observeMetadata: (input: {
      readonly thread: Thread;
      readonly inferredInitialProjectId: string | null;
      readonly executionHostId?: string;
    }) => Effect.Effect<CodexThreadDirectoryEntry, CodexThreadDirectoryError>;
  }
>()("nodex/main/codex-application/CodexThreadDirectory") {}

type CoreThread = Parameters<typeof projectCoreWorkspaceThread>[0];

interface DurableThread {
  readonly raw: CoreThread;
  readonly thread: DesktopProjectWorkspaceThread;
}

const normalizeIds = (threadIds: readonly string[]): readonly string[] =>
  Array.from(new Set(threadIds.map((threadId) => threadId.trim()).filter(Boolean)));

const normalizeTurn = (turn: Turn): Turn => ({
  ...turn,
  items: [...turn.items],
  itemsView: turn.itemsView ?? "full",
  error: turn.error ?? null,
  startedAt: turn.startedAt ?? null,
  completedAt: turn.completedAt ?? null,
  durationMs: turn.durationMs ?? null,
});

const normalizeThread = (thread: Thread): Thread => ({
  ...thread,
  turns: thread.turns.map(normalizeTurn),
});

const isCoreNotFound = (cause: unknown): boolean =>
  cause instanceof CoreRuntimeError &&
  cause.cause instanceof CoreModuleResponseError &&
  cause.cause.coreError.code === "not_found";

const isRolloutMaterializationFailure = (cause: unknown): boolean => {
  const seen = new Set<unknown>();
  let current: unknown = cause;
  while (current !== null && current !== undefined && !seen.has(current)) {
    seen.add(current);
    const record = current as { readonly cause?: unknown; readonly message?: unknown };
    const message = typeof record.message === "string" ? record.message.toLowerCase() : "";
    const isLegacyRolloutError =
      message.includes("failed to load rollout") &&
      (message.includes("empty session file") ||
        message.includes("materialized") ||
        message.includes("is empty"));
    const isPreMaterializedThreadError =
      message.includes("not materialized yet") ||
      (message.includes("includeturns") && message.includes("before first user message")) ||
      message.includes("includeturns is unavailable");
    if (isLegacyRolloutError || isPreMaterializedThreadError) {
      return true;
    }
    current = record.cause;
  }
  return false;
};

const fullPagination = (thread: Thread): CodexConversationTurnPagination => ({
  olderCursor: null,
  backwardsCursor: null,
  oldestLoadedTurnId: thread.turns[0]?.id ?? null,
  isLoadingOlder: false,
  hasLoadedOldest: true,
  loadedTurnCount: thread.turns.length,
  itemsView: "full",
});

export const make: Effect.Effect<
  CodexThreadDirectory["Service"],
  never,
  | CodexApplicationEventHub
  | CodexConversationProjection
  | CodexGateway
  | ConversationRuntimeMap
  | CoreModules
  | Scope.Scope
> = Effect.gen(function* () {
  const ownerScope = yield* Scope.Scope;
  const events = yield* CodexApplicationEventHub;
  const projection = yield* CodexConversationProjection;
  const gateway = yield* CodexGateway;
  const conversations = yield* ConversationRuntimeMap;
  const core = yield* CoreModules;

  const error = (
    operation: CodexThreadDirectoryError["operation"],
    threadId: string,
    cause: unknown,
  ) => new CodexThreadDirectoryError({ operation, threadId, cause });

  const runOwned = <A>(
    operation: Effect.Effect<A, CodexThreadDirectoryError>,
  ): Effect.Effect<A, CodexThreadDirectoryError> =>
    Effect.acquireUseRelease(
      operation.pipe(Effect.forkIn(ownerScope, { startImmediately: true })),
      Fiber.join,
      Fiber.interrupt,
    );

  const readDurable = (
    threadId: string,
  ): Effect.Effect<DurableThread | null, CodexThreadDirectoryError> =>
    core.workspace.read({ kind: "thread", thread_id: threadId }).pipe(
      Effect.flatMap((response) =>
        response.value.kind === "thread"
          ? Effect.succeed({
              raw: response.value.thread,
              thread: projectCoreWorkspaceThread(response.value.thread),
            })
          : Effect.fail(
              error("read", threadId, new Error("Core returned a non-thread read variant")),
            ),
      ),
      Effect.catch((cause) =>
        isCoreNotFound(cause)
          ? Effect.succeed(null)
          : Effect.fail(
              cause instanceof CodexThreadDirectoryError ? cause : error("read", threadId, cause),
            ),
      ),
    );

  const entry = (
    durable: DurableThread,
    fidelity: CodexThreadDirectoryFidelity,
  ): CodexThreadDirectoryEntry => {
    const aggregate = conversations.currentConversation(durable.thread.threadId);
    const state = aggregate?.read();
    return {
      fidelity,
      durable: durable.thread,
      summary: buildWorkspaceThreadSummary(durable.thread),
      canonical: state?.canonicalState ?? null,
      snapshot:
        state?.streamRole === "owner"
          ? (state.snapshot ?? null)
          : (state?.acceptedReplica?.conversation ?? state?.snapshot ?? null),
    };
  };

  const persistObservation = Effect.fn("CodexThreadDirectory.persistObservation")(
    function* (input: {
      readonly thread: Thread | Record<string, unknown>;
      readonly parentThreadId?: string | null;
      readonly lineageRootThreadId?: string;
      readonly forkedFromId?: string | null;
      readonly executionProfile?: AgentExecutionProfile | null;
      readonly managedWorktreePath?: string | null;
      readonly inferredInitialProjectId?: string | null;
      readonly executionHostId?: string;
      readonly fallbackCwd?: string | null;
      readonly hasUnreadTurn?: boolean;
    }): Effect.fn.Return<DurableThread, CodexThreadDirectoryError> {
      const record = input.thread as unknown as Record<string, unknown>;
      const threadId = typeof record.id === "string" ? record.id.trim() : "";
      if (!threadId) {
        return yield* error(
          "materialize",
          "unknown",
          new Error("App-server Thread identity is missing"),
        );
      }
      const previous = yield* readDurable(threadId);
      const parentThreadId =
        input.parentThreadId ?? extractCodexThreadSubagentMetadata(record).parentThreadId;
      const parent = parentThreadId ? yield* readDurable(parentThreadId) : null;
      const lineageRoot =
        !parent && input.lineageRootThreadId ? yield* readDurable(input.lineageRootThreadId) : null;
      const nowMs = yield* Clock.currentTimeMillis;
      const materialization = projectCodexThreadDirectoryMaterialization({
        thread: input.thread,
        existing: previous?.thread ?? null,
        parent: parent?.thread ?? lineageRoot?.thread ?? null,
        explicitParentThreadId: parentThreadId,
        ...(input.forkedFromId !== undefined ? { explicitForkedFromId: input.forkedFromId } : {}),
        ...(input.executionProfile !== undefined
          ? { executionProfile: input.executionProfile }
          : {}),
        ...(input.managedWorktreePath !== undefined
          ? { managedWorktreePath: input.managedWorktreePath }
          : {}),
        ...(input.inferredInitialProjectId !== undefined
          ? { inferredInitialProjectId: input.inferredInitialProjectId }
          : {}),
        observedExecutionHostId: input.executionHostId,
        fallbackCwd: input.fallbackCwd,
        nowMs,
      });
      if (!materialization) {
        return yield* error(
          "materialize",
          threadId,
          new Error("App-server Thread could not be materialized"),
        );
      }
      const patch = {
        ...materialization.patch,
        ...(input.hasUnreadTurn !== undefined ? { has_unread_turn: input.hasUnreadTurn } : {}),
      };
      yield* core.workspace
        .apply({
          operationId: `electron:thread-directory:${threadId}:${randomUUID()}`,
          intent: {
            kind: "upsert_thread",
            thread_id: threadId,
            patch,
          },
        })
        .pipe(Effect.mapError((cause) => error("materialize", threadId, cause)));
      const persisted = yield* readDurable(threadId);
      if (!persisted) {
        return yield* error(
          "materialize",
          threadId,
          new Error("Core did not return the materialized Thread"),
        );
      }
      const previousSummary = previous ? buildWorkspaceThreadSummary(previous.thread) : null;
      const summary = buildWorkspaceThreadSummary(persisted.thread);
      if (hasSidebarThreadSummaryChanged(previousSummary, summary)) {
        events.publish({ kind: "codex", value: { type: "threadSummary", thread: summary } });
      }
      return persisted;
    },
  );

  const hydrate = Effect.fn("CodexThreadDirectory.hydrate")(function* (input: {
    readonly durable: DurableThread;
    readonly thread: Thread;
    readonly context?: ThreadResumeResponse;
    readonly pagination: CodexConversationTurnPagination;
    readonly pendingRequests?: readonly [];
    readonly hasUnreadTurn?: boolean;
  }): Effect.fn.Return<CodexThreadDirectoryEntry, CodexThreadDirectoryError> {
    const threadId = input.durable.thread.threadId;
    const aggregate = conversations.conversation(threadId);
    const existingPermissions =
      aggregate.readCanonicalState()?.sidecar.hydrationContext?.currentPermissions;
    const fallbackPermissions = createCodexCanonicalWorkspacePermissionContext(
      input.durable.raw.writable_roots,
    );
    const permissions = input.context
      ? {
          activePermissionProfile: input.context.activePermissionProfile,
          runtimeWorkspaceRoots: [...input.context.runtimeWorkspaceRoots],
          approvalPolicy: input.context.approvalPolicy,
          approvalsReviewer: input.context.approvalsReviewer,
          sandboxPolicy: input.context.sandbox,
        }
      : (existingPermissions ?? fallbackPermissions);
    const canonical = yield* Effect.try({
      try: () =>
        createCodexCanonicalHydratedConversationState(input.thread, {
          model:
            input.context?.model ??
            input.durable.thread.executionProfile?.modelId ??
            input.durable.thread.modelProvider,
          reasoningEffort:
            input.context?.reasoningEffort ??
            input.durable.thread.executionProfile?.reasoningEffort ??
            null,
          cwd: input.context?.cwd || input.durable.thread.cwd || input.thread.cwd || "/",
          approvalPolicy: permissions.approvalPolicy,
          approvalsReviewer: permissions.approvalsReviewer,
          sandboxPolicy: permissions.sandboxPolicy,
          activePermissionProfile: permissions.activePermissionProfile,
          runtimeWorkspaceRoots: [...permissions.runtimeWorkspaceRoots],
          pendingRequests: input.pendingRequests ?? aggregate.readServerRequests(),
          hasUnreadTurn: input.hasUnreadTurn ?? input.durable.thread.hasUnreadTurn,
        }),
      catch: (cause) => error("materialize", threadId, cause),
    });
    const observedAtMs = yield* Clock.currentTimeMillis;
    const snapshot = yield* projection
      .hydrate({
        threadId,
        summary: buildWorkspaceThreadSummary(input.durable.thread),
        canonical,
        pagination: input.pagination,
        observedAtMs,
      })
      .pipe(Effect.mapError((cause) => error("materialize", threadId, cause)));
    return {
      fidelity: input.context ? "live" : "full",
      durable: input.durable.thread,
      summary: buildWorkspaceThreadSummary(input.durable.thread),
      canonical,
      snapshot,
    };
  });

  const readRemote = Effect.fn("CodexThreadDirectory.readRemote")(function* (
    threadId: string,
    fidelity: Exclude<CodexThreadDirectoryFidelity, "durable">,
    hostId: string,
  ): Effect.fn.Return<CodexThreadDirectoryEntry, CodexThreadDirectoryError> {
    if (fidelity === "live") {
      const gatewayResponse = yield* gateway
        .requestOnHost(hostId, "thread/resume", {
          threadId,
          initialTurnsPage: { limit: 20, sortDirection: "desc", itemsView: "full" },
        })
        .pipe(Effect.mapError((cause) => error("read", threadId, cause)));
      const response = projectCodexGatewayThreadResumeResponse(gatewayResponse);
      if (response.thread.id !== threadId) {
        return yield* error(
          "read",
          threadId,
          new Error(`Expected Thread '${threadId}' but received '${response.thread.id}'`),
        );
      }
      const page = response.initialTurnsPage;
      const thread = normalizeThread({
        ...response.thread,
        turns: page ? [...page.data].reverse() : [...response.thread.turns],
      });
      const durable = yield* persistObservation({ thread, executionHostId: hostId });
      const pagination: CodexConversationTurnPagination = page
        ? {
            olderCursor: page.nextCursor ?? null,
            backwardsCursor: response.turnsBackwardsCursor ?? null,
            oldestLoadedTurnId: thread.turns[0]?.id ?? null,
            isLoadingOlder: false,
            hasLoadedOldest: page.nextCursor == null,
            loadedTurnCount: thread.turns.length,
            itemsView: "full",
          }
        : fullPagination(thread);
      return yield* hydrate({ durable, thread, context: response, pagination });
    }

    const read = (includeTurns: boolean) =>
      gateway
        .requestOnHost(hostId, "thread/read", { threadId, includeTurns })
        .pipe(Effect.mapError((cause) => error("read", threadId, cause)));
    const response = yield* fidelity === "full"
      ? read(true).pipe(
          Effect.catch((failure) =>
            isRolloutMaterializationFailure(failure.cause) ? read(false) : Effect.fail(failure),
          ),
        )
      : read(false);
    if (response.thread.id !== threadId) {
      return yield* error(
        "read",
        threadId,
        new Error(`Expected Thread '${threadId}' but received '${response.thread.id}'`),
      );
    }
    const thread = normalizeThread(projectCodexGatewayThreadReadThread(response.thread));
    const durable = yield* persistObservation({ thread, executionHostId: hostId });
    return fidelity === "full"
      ? yield* hydrate({ durable, thread, pagination: fullPagination(thread) })
      : entry(durable, "metadata");
  });

  const resolvePhysical = Effect.fn("CodexThreadDirectory.resolve")(function* (input: {
    readonly threadId: string;
    readonly fidelity: CodexThreadDirectoryFidelity;
    readonly hostId?: string;
  }): Effect.fn.Return<CodexThreadDirectoryEntry | null, CodexThreadDirectoryError> {
    const threadId = input.threadId.trim();
    if (!threadId) return null;
    const durable = yield* readDurable(threadId);
    if (input.fidelity === "durable" && durable) return entry(durable, "durable");
    const hostId = durable?.thread.executionHostId ?? input.hostId?.trim();
    if (!hostId) return null;
    if (input.fidelity === "durable") {
      return yield* conversations.runExclusive(threadId, readRemote(threadId, "metadata", hostId));
    }
    return yield* conversations.runExclusive(
      threadId,
      readRemote(threadId, input.fidelity, hostId),
    );
  });

  const discover = Effect.fn("CodexThreadDirectory.discover")(function* (
    root: DurableThread,
  ): Effect.fn.Return<readonly CodexThreadDirectoryEntry[], CodexThreadDirectoryError> {
    const summaries: CodexThreadDirectoryEntry[] = [];
    const seenCursors = new Set<string>();
    const rootCreatedAtSeconds = Math.floor(root.thread.createdAt / 1_000);
    let cursor: string | null = null;
    do {
      const params: ThreadListParams = {
        cursor,
        limit: 200,
        sortKey: "created_at",
        sortDirection: "desc",
        sourceKinds: ["subAgentThreadSpawn"],
        archived: false,
        useStateDbOnly: true,
        ancestorThreadId: root.thread.threadId,
      };
      const response = yield* gateway
        .requestOnHost(root.thread.executionHostId, "thread/list", params)
        .pipe(Effect.mapError((cause) => error("discover", root.thread.threadId, cause)));
      for (const thread of response.data) {
        const record = thread as unknown as Record<string, unknown>;
        const parentThreadId = extractCodexThreadSubagentMetadata(record).parentThreadId;
        if (!parentThreadId) continue;
        const durable = yield* persistObservation({
          thread: record,
          parentThreadId,
          lineageRootThreadId: root.thread.threadId,
          executionHostId: root.thread.executionHostId,
          fallbackCwd: typeof record.cwd === "string" ? record.cwd : root.thread.cwd,
        });
        summaries.push(entry(durable, "metadata"));
      }
      const reachedOlderThreads =
        rootCreatedAtSeconds > 0 &&
        response.data.some(
          (thread) =>
            typeof thread.createdAt === "number" && thread.createdAt < rootCreatedAtSeconds,
        );
      const nextCursor = reachedOlderThreads ? null : (response.nextCursor ?? null);
      if (!nextCursor || seenCursors.has(nextCursor)) break;
      seenCursors.add(nextCursor);
      cursor = nextCursor;
    } while (cursor);
    return summaries;
  });

  const isDescendant = Effect.fn("CodexThreadDirectory.isDescendant")(function* (
    rootThreadId: string,
    threadId: string,
  ): Effect.fn.Return<boolean, CodexThreadDirectoryError> {
    if (rootThreadId === threadId) return false;
    const visited = new Set<string>();
    let current: string | null = threadId;
    while (current && !visited.has(current)) {
      visited.add(current);
      const durable: DurableThread | null = yield* readDurable(current);
      const parentThreadId: string | null = durable?.thread.parentThreadId ?? null;
      if (parentThreadId === rootThreadId) return true;
      current = parentThreadId;
    }
    return false;
  });

  const descendants = (input: {
    readonly rootThreadId: string;
    readonly threadIds?: readonly string[];
    readonly fidelity: Exclude<CodexThreadDirectoryFidelity, "live">;
  }): Effect.Effect<readonly CodexThreadDirectoryEntry[], CodexThreadDirectoryError> =>
    runOwned(
      Effect.gen(function* () {
        const rootThreadId = input.rootThreadId.trim();
        if (!rootThreadId) return [];
        const root = yield* resolvePhysical({ threadId: rootThreadId, fidelity: "durable" });
        if (!root) return [];
        const rootDurable = yield* readDurable(rootThreadId);
        if (!rootDurable) return [];
        const requested = normalizeIds(input.threadIds ?? []);
        if (requested.length === 0) {
          const discovered = yield* discover(rootDurable);
          if (input.fidelity === "metadata") return discovered;
          if (input.fidelity === "durable") {
            return discovered.map((candidate): CodexThreadDirectoryEntry => ({
              ...candidate,
              fidelity: "durable",
            }));
          }
          return yield* Effect.forEach(
            discovered,
            (candidate) =>
              resolvePhysical({ threadId: candidate.summary.threadId, fidelity: input.fidelity }),
            { concurrency: 4 },
          ).pipe(Effect.map((entries) => entries.filter((value) => value !== null)));
        }

        const known = yield* Effect.forEach(
          requested,
          (threadId) => isDescendant(rootThreadId, threadId),
          { concurrency: 4 },
        );
        if (known.some((value) => !value)) yield* discover(rootDurable);
        const accepted = yield* Effect.filter(
          requested,
          (threadId) => isDescendant(rootThreadId, threadId),
          { concurrency: 4 },
        );
        return yield* Effect.forEach(
          accepted,
          (threadId) => resolvePhysical({ threadId, fidelity: input.fidelity }),
          { concurrency: 4 },
        ).pipe(Effect.map((entries) => entries.filter((value) => value !== null)));
      }).pipe(
        Effect.mapError((cause) =>
          cause instanceof CodexThreadDirectoryError
            ? cause
            : error("discover", input.rootThreadId, cause),
        ),
      ),
    );

  const acceptRollbackResult = Effect.fn("CodexThreadDirectory.acceptRollbackResult")(
    function* (input: {
      readonly expectedThreadId: string;
      readonly thread: Thread;
      readonly executionHostId?: string;
      readonly fallbackCwd?: string | null;
    }): Effect.fn.Return<CodexThreadDirectoryEntry, CodexThreadDirectoryError> {
      const expectedThreadId = input.expectedThreadId.trim();
      if (!expectedThreadId || input.thread.id !== expectedThreadId) {
        return yield* error(
          "materialize",
          expectedThreadId || input.thread.id,
          new Error(`Expected Thread '${expectedThreadId}' but received '${input.thread.id}'`),
        );
      }
      const thread = normalizeThread(input.thread);
      const durable = yield* persistObservation({
        thread,
        ...(input.executionHostId ? { executionHostId: input.executionHostId } : {}),
        ...(input.fallbackCwd !== undefined ? { fallbackCwd: input.fallbackCwd } : {}),
        hasUnreadTurn: false,
      });
      return yield* hydrate({
        durable,
        thread,
        pagination: fullPagination(thread),
        pendingRequests: [],
        hasUnreadTurn: false,
      });
    },
  );

  const acceptForkResult = Effect.fn("CodexThreadDirectory.acceptForkResult")(function* (input: {
    readonly sourceThreadId: string;
    readonly response: ThreadForkResponse;
  }): Effect.fn.Return<CodexThreadDirectoryEntry, CodexThreadDirectoryError> {
    const sourceThreadId = input.sourceThreadId.trim();
    const childThreadId = input.response.thread.id.trim();
    if (!sourceThreadId || !childThreadId || childThreadId !== input.response.thread.id) {
      return yield* error(
        "materialize",
        childThreadId || sourceThreadId,
        new Error("Thread fork did not return a valid source and child identity"),
      );
    }
    if (
      input.response.thread.forkedFromId !== null &&
      input.response.thread.forkedFromId !== sourceThreadId
    ) {
      return yield* error(
        "materialize",
        childThreadId,
        new Error(
          `Fork '${childThreadId}' belongs to '${input.response.thread.forkedFromId}', not '${sourceThreadId}'`,
        ),
      );
    }
    const source = yield* readDurable(sourceThreadId);
    if (!source) {
      return yield* error(
        "materialize",
        sourceThreadId,
        new Error(`Fork source Thread '${sourceThreadId}' was not found`),
      );
    }
    const execution = yield* core.workspace
      .read({ kind: "execution_context", thread_id: sourceThreadId })
      .pipe(Effect.mapError((cause) => error("read", sourceThreadId, cause)));
    if (execution.value.kind !== "execution_context") {
      return yield* error(
        "read",
        sourceThreadId,
        new Error("Core returned a non-execution-context read variant"),
      );
    }
    const executionProfile: AgentExecutionProfile | null = source.thread.executionProfile
      ? {
          ...source.thread.executionProfile,
          providerId: input.response.modelProvider,
          modelId: input.response.model,
          reasoningEffort:
            input.response.reasoningEffort ?? source.thread.executionProfile.reasoningEffort,
          serviceTier: input.response.serviceTier,
        }
      : input.response.model
        ? {
            providerId: input.response.modelProvider,
            modelId: input.response.model,
            harnessId: null,
            reasoningEffort: input.response.reasoningEffort,
            serviceTier: input.response.serviceTier,
          }
        : null;
    const thread = normalizeThread({
      ...input.response.thread,
      forkedFromId: sourceThreadId,
    });
    yield* persistObservation({
      thread,
      lineageRootThreadId: sourceThreadId,
      forkedFromId: sourceThreadId,
      executionProfile,
      managedWorktreePath: source.thread.managedWorktreePath,
      executionHostId: source.thread.executionHostId,
      fallbackCwd: source.thread.cwd,
      hasUnreadTurn: false,
    });
    yield* core.workspace
      .apply({
        operationId: `electron:thread-directory-fork-catalogs:${childThreadId}:${randomUUID()}`,
        intent: {
          kind: "replace_thread_dynamic_tool_catalogs",
          thread_id: childThreadId,
          catalogs: execution.value.context.thread.dynamic_tool_catalogs,
        },
      })
      .pipe(Effect.mapError((cause) => error("materialize", childThreadId, cause)));
    yield* core.workspace
      .apply({
        operationId: `electron:thread-directory-fork-roots:${childThreadId}:${randomUUID()}`,
        intent: {
          kind: "replace_thread_writable_roots",
          thread_id: childThreadId,
          roots: input.response.runtimeWorkspaceRoots,
        },
      })
      .pipe(Effect.mapError((cause) => error("materialize", childThreadId, cause)));
    const durable = yield* readDurable(childThreadId);
    if (!durable) {
      return yield* error(
        "materialize",
        childThreadId,
        new Error("Core did not return the materialized fork Thread"),
      );
    }
    return yield* hydrate({
      durable,
      thread,
      context: input.response as unknown as ThreadResumeResponse,
      pagination: fullPagination(thread),
      pendingRequests: [],
      hasUnreadTurn: false,
    });
  });

  const acceptImportResult = Effect.fn("CodexThreadDirectory.acceptImportResult")(
    function* (input: {
      readonly response: ThreadForkResponse;
      readonly fallbackCwd: string;
      readonly executionHostId?: string;
    }): Effect.fn.Return<CodexThreadDirectoryEntry, CodexThreadDirectoryError> {
      const thread = normalizeThread(input.response.thread);
      const threadId = thread.id.trim();
      if (!threadId || threadId !== thread.id) {
        return yield* error(
          "materialize",
          threadId,
          new Error("Imported rollout did not return a valid Thread id"),
        );
      }
      const durable = yield* persistObservation({
        thread,
        executionProfile: null,
        managedWorktreePath: null,
        executionHostId: input.executionHostId,
        fallbackCwd: input.fallbackCwd,
        hasUnreadTurn: false,
      });
      return yield* hydrate({
        durable,
        thread,
        pagination: fullPagination(thread),
        pendingRequests: [],
        hasUnreadTurn: false,
      });
    },
  );

  const acceptSessionStart = Effect.fn("CodexThreadDirectory.acceptSessionStart")(
    function* (input: {
      readonly response: ThreadStartResponse;
      readonly sessionId: string;
      readonly projectId: string | null;
      readonly executionProfile: AgentExecutionProfile | null;
      readonly runtimeWorkspaceRoots: readonly string[];
      readonly fallbackCwd: string;
      readonly projectlessOutputDirectory?: string | null;
      readonly projectlessWorkspaceBrowserRoot?: string | null;
    }): Effect.fn.Return<CodexThreadDirectoryEntry, CodexThreadDirectoryError> {
      const thread = normalizeThread(input.response.thread as unknown as Thread);
      const threadId = thread.id.trim();
      if (!threadId || threadId !== thread.id) {
        return yield* error(
          "materialize",
          threadId,
          new Error("Thread start did not return a valid Thread id"),
        );
      }
      const cwd = input.response.cwd || thread.cwd || input.fallbackCwd;
      yield* core.workspace
        .apply({
          operationId: `electron:session-thread-start:${input.sessionId}:${threadId}`,
          intent: {
            kind: "mutate_session",
            session_id: input.sessionId,
            intent: {
              kind: "link_thread",
              thread_id: threadId,
              expected_project_id: input.projectId,
              thread_patch: {
                project_id: input.projectId,
                thread_preview: thread.preview,
                model_provider: input.executionProfile?.providerId ?? thread.modelProvider,
                model_id: input.executionProfile?.modelId ?? input.response.model,
                harness_id: input.executionProfile?.harnessId ?? null,
                reasoning_effort:
                  input.executionProfile?.reasoningEffort ?? input.response.reasoningEffort,
                service_tier: input.executionProfile?.serviceTier ?? null,
                execution_host_id: gateway.localHostId,
                cwd,
                projectless_output_directory: input.projectlessOutputDirectory ?? null,
                projectless_workspace_browser_root: input.projectlessWorkspaceBrowserRoot ?? null,
              },
            },
          },
        })
        .pipe(Effect.mapError((cause) => error("materialize", threadId, cause)));
      const durable = yield* readDurable(threadId);
      if (!durable) {
        return yield* error(
          "materialize",
          threadId,
          new Error("Core did not return the Session-linked Thread"),
        );
      }
      return yield* hydrate({
        durable,
        thread: { ...thread, cwd },
        context: input.response as unknown as ThreadResumeResponse,
        pagination: fullPagination(thread),
      });
    },
  );

  return CodexThreadDirectory.of({
    resolve: (input) => runOwned(resolvePhysical(input)),
    descendants,
    acceptRollbackResult: (input) => runOwned(acceptRollbackResult(input)),
    acceptForkResult: (input) => runOwned(acceptForkResult(input)),
    acceptImportResult: (input) => runOwned(acceptImportResult(input)),
    acceptSessionStart: (input) => runOwned(acceptSessionStart(input)),
    observeMetadata: (input) =>
      runOwned(
        persistObservation({
          thread: normalizeThread(input.thread),
          inferredInitialProjectId: input.inferredInitialProjectId,
          executionHostId: input.executionHostId,
        }).pipe(Effect.map((durable) => entry(durable, "metadata"))),
      ),
  });
});
