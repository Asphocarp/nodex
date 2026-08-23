import type { ServerNotification as CodexServerNotification } from "@nodex/codex-app-server-protocol";
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
import { CodexThreadDirectory } from "./CodexThreadDirectory";

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

export const make: Effect.Effect<
  CodexSubagentCatalog["Service"],
  never,
  CodexThreadDirectory | Scope.Scope
> = Effect.gen(function* () {
  const directory = yield* CodexThreadDirectory;
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

  const remember = (summaries: readonly CodexThreadSummary[], complete: boolean) => {
    for (const summary of summaries) {
      observe(summary.threadId);
      if (complete) fullFidelity.add(summary.threadId);
    }
    return summaries;
  };

  const hydrateBackground = (
    input: CodexBackgroundSubagentThreadsHydrateInput,
  ): Effect.Effect<readonly CodexThreadSummary[], CodexSubagentCatalogError> =>
    runOwned(
      directory
        .descendants({
          rootThreadId: input.rootThreadId,
          threadIds: normalizeIds(input.threadIds),
          fidelity: input.includeTurns === true ? "full" : "metadata",
        })
        .pipe(
          Effect.map((entries) =>
            remember(
              entries.map((entry) => entry.summary),
              input.includeTurns === true,
            ),
          ),
          Effect.mapError(
            (cause) => new CodexSubagentCatalogError({ operation: "hydrate", cause }),
          ),
        ),
    );

  const hydratePanel = (
    input: CodexSubagentPanelHydrateInput,
  ): Effect.Effect<readonly CodexThreadSummary[], CodexSubagentCatalogError> =>
    runOwned(
      directory
        .descendants({
          rootThreadId: input.rootThreadId,
          ...(input.threadIds === undefined ? {} : { threadIds: input.threadIds }),
          fidelity: input.includeTurns === true ? "full" : "metadata",
        })
        .pipe(
          Effect.map((entries) =>
            remember(
              entries.map((entry) => entry.summary),
              input.includeTurns === true,
            ),
          ),
          Effect.mapError(
            (cause) => new CodexSubagentCatalogError({ operation: "discover", cause }),
          ),
        ),
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
