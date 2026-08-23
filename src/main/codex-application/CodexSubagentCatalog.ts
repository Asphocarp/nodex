import type { ServerNotification as CodexServerNotification } from "@nodex/codex-app-server-protocol";
import type { ThreadListParams } from "@nodex/codex-app-server-protocol/v2/ThreadListParams";
import * as Context from "effect/Context";
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Scope from "effect/Scope";
import type {
  CodexBackgroundSubagentThreadsHydrateInput,
  CodexSubagentPanelHydrateInput,
  CodexThreadSummary,
} from "../../shared/types";
import { extractCodexThreadSubagentMetadata } from "../../shared/codex-subagent-metadata";
import type { DesktopProjectWorkspaceThread } from "../core-client/project-workspace-adapter";
import { CodexGateway } from "../codex-runtime/CodexGateway";
import type { CodexGatewayThreadReadThread } from "../codex-runtime/CodexGatewayProtocolProjection";
import { buildWorkspaceThreadSummary } from "./CodexThreadCatalogProjection";

const BACKGROUND_DELTA_METHODS = new Set<CodexServerNotification["method"]>([
  "item/agentMessage/delta",
  "item/plan/delta",
  "item/reasoning/summaryTextDelta",
  "item/reasoning/textDelta",
  "item/commandExecution/outputDelta",
] satisfies readonly CodexServerNotification["method"][]);

export class CodexSubagentCatalogError extends Data.TaggedError("CodexSubagentCatalogError")<{
  readonly operation: "discover" | "hydrate";
  readonly cause: unknown;
}> {}

export interface CodexSubagentCatalogOptions {
  readonly materializeRead: (
    thread: CodexGatewayThreadReadThread,
    includeTurns: boolean,
  ) => Effect.Effect<void, CodexSubagentCatalogError>;
  readonly shouldRetryReadWithoutTurns: (cause: unknown) => boolean;
  readonly readWorkspaceThread: (
    threadId: string,
  ) => Effect.Effect<DesktopProjectWorkspaceThread | null, CodexSubagentCatalogError>;
  readonly readCanonicalParent: (threadId: string) => string | null | undefined;
  readonly materialize: (input: {
    readonly thread: Record<string, unknown>;
    readonly parentThreadId: string;
    readonly fallbackCwd: string | null;
  }) => Effect.Effect<CodexThreadSummary | null, CodexSubagentCatalogError>;
  readonly publishSummary: (summary: CodexThreadSummary) => void;
}

export class CodexSubagentCatalog extends Context.Service<
  CodexSubagentCatalog,
  {
    readonly hydrateBackground: (
      input: CodexBackgroundSubagentThreadsHydrateInput,
    ) => Effect.Effect<readonly CodexThreadSummary[], CodexSubagentCatalogError>;
    readonly hydratePanel: (
      input: CodexSubagentPanelHydrateInput,
    ) => Effect.Effect<readonly CodexThreadSummary[], CodexSubagentCatalogError>;
    readonly open: (threadId: string) => Effect.Effect<boolean>;
    readonly observe: (threadId: string) => void;
    readonly shouldDropDelta: (
      method: CodexServerNotification["method"],
      threadId: string | null,
    ) => boolean;
    readonly clear: (threadId: string) => void;
  }
>()("nodex/main/codex-application/CodexSubagentCatalog") {}

const normalizeIds = (threadIds: readonly string[]): readonly string[] =>
  Array.from(new Set(threadIds.map((threadId) => threadId.trim()).filter(Boolean)));

const asRecord = (value: unknown): Record<string, unknown> | null =>
  typeof value === "object" && value !== null ? (value as Record<string, unknown>) : null;

export const make = (
  options: CodexSubagentCatalogOptions,
): Effect.Effect<CodexSubagentCatalog["Service"], never, CodexGateway | Scope.Scope> =>
  Effect.gen(function* () {
    const gateway = yield* CodexGateway;
    const ownerScope = yield* Scope.Scope;
    const known = new Set<string>();
    const fullFidelity = new Set<string>();

    const runOwned = <A>(
      operation: Effect.Effect<A, CodexSubagentCatalogError>,
    ): Effect.Effect<A, CodexSubagentCatalogError> =>
      Effect.acquireUseRelease(
        operation.pipe(Effect.forkIn(ownerScope, { startImmediately: true })),
        Fiber.join,
        Fiber.interrupt,
      );

    const observe = (threadId: string): void => {
      const normalized = threadId.trim();
      if (normalized) known.add(normalized);
    };

    const readSummary = (
      threadId: string,
    ): Effect.Effect<CodexThreadSummary | null, CodexSubagentCatalogError> =>
      options
        .readWorkspaceThread(threadId)
        .pipe(Effect.map((thread) => (thread ? buildWorkspaceThreadSummary(thread) : null)));

    const readThread = (
      threadId: string,
      includeTurns: boolean,
    ): Effect.Effect<void, CodexSubagentCatalogError> => {
      const read = (withTurns: boolean): Effect.Effect<void, CodexSubagentCatalogError> =>
        gateway.requestLocal("thread/read", { threadId, includeTurns: withTurns }).pipe(
          Effect.mapError(
            (cause) => new CodexSubagentCatalogError({ operation: "hydrate", cause }),
          ),
          Effect.flatMap((response) => {
            if (response.thread.id !== threadId) {
              return Effect.fail(
                new CodexSubagentCatalogError({
                  operation: "hydrate",
                  cause: new Error(
                    `Codex thread/read expected '${threadId}' but received '${response.thread.id}'`,
                  ),
                }),
              );
            }
            return options.materializeRead(response.thread, withTurns);
          }),
        );
      if (!includeTurns) return read(false);
      return read(true).pipe(
        Effect.catch((error) =>
          options.shouldRetryReadWithoutTurns(error.cause) ? read(false) : Effect.fail(error),
        ),
      );
    };

    const isKnownDescendant = (
      rootThreadId: string,
      threadId: string,
    ): Effect.Effect<boolean, CodexSubagentCatalogError> =>
      Effect.gen(function* () {
        if (rootThreadId === threadId) return false;
        const visited = new Set<string>();
        let currentThreadId: string | null = threadId;
        while (currentThreadId && !visited.has(currentThreadId)) {
          visited.add(currentThreadId);
          const canonicalParent = options.readCanonicalParent(currentThreadId);
          const persisted: DesktopProjectWorkspaceThread | null =
            canonicalParent === undefined
              ? yield* options.readWorkspaceThread(currentThreadId)
              : null;
          const parentThreadId: string | null =
            canonicalParent ?? persisted?.parentThreadId ?? null;
          if (parentThreadId === rootThreadId) return true;
          currentThreadId = parentThreadId;
        }
        return false;
      });

    const discover = (
      rootThreadId: string,
    ): Effect.Effect<readonly CodexThreadSummary[], CodexSubagentCatalogError> =>
      Effect.gen(function* () {
        const summaries: CodexThreadSummary[] = [];
        const root = yield* options.readWorkspaceThread(rootThreadId);
        const rootCreatedAtSeconds = Math.floor((root?.createdAt ?? 0) / 1_000);
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
            ancestorThreadId: rootThreadId,
          };
          const response = yield* gateway
            .requestLocal("thread/list", params)
            .pipe(
              Effect.mapError(
                (cause) => new CodexSubagentCatalogError({ operation: "discover", cause }),
              ),
            );
          for (const thread of response.data) {
            const record = asRecord(thread);
            if (!record) continue;
            const parentThreadId = extractCodexThreadSubagentMetadata(record).parentThreadId;
            if (!parentThreadId) continue;
            const summary = yield* options.materialize({
              thread: record,
              parentThreadId,
              fallbackCwd: typeof record.cwd === "string" ? record.cwd : null,
            });
            if (!summary) continue;
            observe(summary.threadId);
            summaries.push(summary);
            options.publishSummary(summary);
          }
          const reachedThreadsOlderThanRoot =
            rootCreatedAtSeconds > 0 &&
            response.data.some(
              (thread) =>
                typeof thread.createdAt === "number" && thread.createdAt < rootCreatedAtSeconds,
            );
          cursor = reachedThreadsOlderThanRoot ? null : (response.nextCursor ?? null);
        } while (cursor);

        return summaries;
      });

    const hydrateBackground = (
      input: CodexBackgroundSubagentThreadsHydrateInput,
    ): Effect.Effect<readonly CodexThreadSummary[], CodexSubagentCatalogError> =>
      runOwned(
        Effect.gen(function* () {
          const threadIds = normalizeIds(input.threadIds);
          const summaries: CodexThreadSummary[] = [];
          for (const threadId of threadIds) {
            yield* readThread(threadId, input.includeTurns === true);
            const summary = yield* readSummary(threadId);
            if (summary) {
              observe(summary.threadId);
              summaries.push(summary);
            }
          }
          return summaries;
        }),
      );

    const hydratePanel = (
      input: CodexSubagentPanelHydrateInput,
    ): Effect.Effect<readonly CodexThreadSummary[], CodexSubagentCatalogError> =>
      runOwned(
        Effect.gen(function* () {
          const rootThreadId = input.rootThreadId.trim();
          if (!rootThreadId) return [];
          const requestedThreadIds = normalizeIds(input.threadIds ?? []);
          if (requestedThreadIds.length === 0) return yield* discover(rootThreadId);

          const knownDescendants = yield* Effect.all(
            requestedThreadIds.map((threadId) => isKnownDescendant(rootThreadId, threadId)),
            { concurrency: "unbounded" },
          );
          if (knownDescendants.some((isKnown) => !isKnown)) yield* discover(rootThreadId);

          const summaries: CodexThreadSummary[] = [];
          for (const threadId of requestedThreadIds) {
            if (!(yield* isKnownDescendant(rootThreadId, threadId))) continue;
            if (input.includeTurns === true) fullFidelity.add(threadId);
            yield* readThread(threadId, input.includeTurns === true);
            const summary = yield* readSummary(threadId);
            if (summary) {
              observe(summary.threadId);
              summaries.push(summary);
            }
          }
          return summaries;
        }),
      );

    const clear = (threadId: string): void => {
      const normalized = threadId.trim();
      if (!normalized) return;
      known.delete(normalized);
      fullFidelity.delete(normalized);
    };

    yield* Effect.addFinalizer(() =>
      Effect.sync(() => {
        known.clear();
        fullFidelity.clear();
      }),
    );

    return CodexSubagentCatalog.of({
      hydrateBackground,
      hydratePanel,
      open: (threadId) =>
        Effect.sync(() => {
          const normalized = threadId.trim();
          if (!normalized) return false;
          known.add(normalized);
          fullFidelity.add(normalized);
          return true;
        }),
      observe,
      shouldDropDelta: (method, threadId) => {
        const normalized = threadId?.trim() ?? "";
        return (
          normalized.length > 0 &&
          BACKGROUND_DELTA_METHODS.has(method) &&
          known.has(normalized) &&
          !fullFidelity.has(normalized)
        );
      },
      clear,
    });
  });
