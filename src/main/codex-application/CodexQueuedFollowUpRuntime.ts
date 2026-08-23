import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import * as FiberMap from "effect/FiberMap";
import type * as Scope from "effect/Scope";
import type {
  CodexCollaborationModeKind,
  CodexPromptInput,
  CodexQueuedFollowUp,
  CodexServiceTier,
} from "../../shared/types";

export class CodexQueuedFollowUpRuntimeError extends Data.TaggedError(
  "CodexQueuedFollowUpRuntimeError",
)<{
  readonly operation: "enqueue" | "submit";
  readonly threadId: string;
  readonly followUpId: string | null;
  readonly cause: unknown;
}> {}

export interface CodexQueuedFollowUpEnqueueInput {
  readonly threadId: string;
  readonly prompt: string;
  readonly collaborationMode?: CodexCollaborationModeKind | null;
  readonly serviceTier?: CodexServiceTier;
  readonly pausedReason?: string | null;
  readonly promptInput?: CodexPromptInput;
  readonly summary?: CodexQueuedFollowUp["summary"];
}

export interface CodexQueuedFollowUpRuntimeOptions {
  /** Whether the canonical turn state currently permits a new submission. */
  readonly isSubmissionEligible: (threadId: string) => boolean;
  readonly submit: (
    threadId: string,
    followUp: CodexQueuedFollowUp,
  ) => Effect.Effect<void, CodexQueuedFollowUpRuntimeError>;
  /** Projects one already-committed queue revision into the accepted conversation document. */
  readonly project: (threadId: string, entries: readonly CodexQueuedFollowUp[]) => void;
}

export class CodexQueuedFollowUpRuntime extends Context.Service<
  CodexQueuedFollowUpRuntime,
  {
    readonly list: (threadId: string) => readonly CodexQueuedFollowUp[];
    readonly enqueue: (
      input: CodexQueuedFollowUpEnqueueInput,
    ) => Effect.Effect<string, CodexQueuedFollowUpRuntimeError>;
    readonly remove: (threadId: string, followUpId: string) => Effect.Effect<boolean>;
    readonly reorder: (
      threadId: string,
      orderedFollowUpIds: readonly string[],
    ) => Effect.Effect<void>;
    readonly sendNow: (
      threadId: string,
      followUpId: string,
    ) => Effect.Effect<void, CodexQueuedFollowUpRuntimeError>;
    readonly request: (threadId: string) => void;
    readonly clearPaused: (threadId: string, publish?: boolean) => boolean;
    /** Clears queued content without cancelling an already claimed submission. */
    readonly reset: (threadId: string) => void;
    /** Removes the Thread generation and interrupts its claimed submission. */
    readonly clear: (threadId: string) => void;
  }
>()("nodex/main/codex-application/CodexQueuedFollowUpRuntime") {}

interface ClaimedFollowUp {
  readonly generation: number;
  readonly followUp: CodexQueuedFollowUp;
}

const normalizeId = (value: string): string => value.trim();

const normalizeServiceTier = (value: CodexServiceTier | undefined): CodexServiceTier => {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return normalized && normalized !== "standard" ? normalized : null;
};

const copyEntries = (entries: readonly CodexQueuedFollowUp[]): readonly CodexQueuedFollowUp[] => [
  ...entries,
];

const errorReason = (error: CodexQueuedFollowUpRuntimeError): string =>
  error.cause instanceof Error ? error.cause.message : String(error.cause);

export const make = (
  options: CodexQueuedFollowUpRuntimeOptions,
): Effect.Effect<CodexQueuedFollowUpRuntime["Service"], never, Scope.Scope> =>
  Effect.gen(function* () {
    const dispatches = yield* FiberMap.make<string, void, never>();
    const runDispatch = yield* FiberMap.runtime(dispatches)();
    const entriesByThread = new Map<string, readonly CodexQueuedFollowUp[]>();
    const generationByThread = new Map<string, number>();
    let nextId = 0;
    let closed = false;

    yield* Effect.addFinalizer(() =>
      Effect.sync(() => {
        closed = true;
        entriesByThread.clear();
        generationByThread.clear();
      }),
    );

    const generation = (threadId: string): number => generationByThread.get(threadId) ?? 0;
    const list = (threadId: string): readonly CodexQueuedFollowUp[] =>
      copyEntries(entriesByThread.get(normalizeId(threadId)) ?? []);
    const write = (
      threadId: string,
      entries: readonly CodexQueuedFollowUp[],
      publish = true,
    ): void => {
      if (closed) return;
      const normalizedThreadId = normalizeId(threadId);
      if (!normalizedThreadId) return;
      const copied = copyEntries(entries);
      if (copied.length === 0) entriesByThread.delete(normalizedThreadId);
      else entriesByThread.set(normalizedThreadId, copied);
      if (publish) options.project(normalizedThreadId, copied);
    };
    const claim = (
      threadId: string,
      predicate: (entry: CodexQueuedFollowUp) => boolean,
    ): ClaimedFollowUp | null => {
      const normalizedThreadId = normalizeId(threadId);
      if (closed || !normalizedThreadId) return null;
      const entries = list(normalizedThreadId);
      const index = entries.findIndex(predicate);
      const followUp = entries[index];
      if (!followUp) return null;
      write(
        normalizedThreadId,
        entries.filter((_, entryIndex) => entryIndex !== index),
      );
      return { generation: generation(normalizedThreadId), followUp };
    };
    const restore = (claimed: ClaimedFollowUp, reason: string): void => {
      const threadId = claimed.followUp.threadId;
      if (closed || generation(threadId) !== claimed.generation) return;
      write(threadId, [
        {
          ...claimed.followUp,
          pausedReason: reason,
        },
        ...list(threadId).filter((entry) => entry.followUpId !== claimed.followUp.followUpId),
      ]);
    };
    const submitClaim = (
      claimed: ClaimedFollowUp,
    ): Effect.Effect<void, CodexQueuedFollowUpRuntimeError> =>
      options.submit(claimed.followUp.threadId, claimed.followUp).pipe(
        Effect.tapError((error) =>
          Effect.sync(() => {
            restore(claimed, errorReason(error));
          }),
        ),
        Effect.onInterrupt(() =>
          Effect.sync(() => {
            restore(claimed, "Queued follow-up submission was interrupted");
          }),
        ),
      );
    const clear = (threadId: string): void => {
      const normalizedThreadId = normalizeId(threadId);
      if (closed || !normalizedThreadId) return;
      generationByThread.set(normalizedThreadId, generation(normalizedThreadId) + 1);
      entriesByThread.delete(normalizedThreadId);
      runDispatch(normalizedThreadId, Effect.void);
    };
    const dispatch = (threadId: string): Effect.Effect<void> =>
      Effect.suspend(() => {
        if (!options.isSubmissionEligible(threadId)) return Effect.void;
        const head = list(threadId)[0];
        if (!head || head.pausedReason) return Effect.void;
        const claimed = claim(threadId, (entry) => entry.followUpId === head.followUpId);
        if (!claimed) return Effect.void;
        return submitClaim(claimed).pipe(Effect.catch(() => Effect.void));
      });

    return CodexQueuedFollowUpRuntime.of({
      list,
      enqueue: (input) =>
        Effect.gen(function* () {
          const threadId = normalizeId(input.threadId);
          const prompt = input.prompt.trim();
          if (!threadId || !prompt) {
            return yield* Effect.fail(
              new CodexQueuedFollowUpRuntimeError({
                operation: "enqueue",
                threadId,
                followUpId: null,
                cause: new Error("Queued follow-up requires a Thread and a non-empty prompt"),
              }),
            );
          }
          if (closed) {
            return yield* Effect.fail(
              new CodexQueuedFollowUpRuntimeError({
                operation: "enqueue",
                threadId,
                followUpId: null,
                cause: new Error("Queued follow-up runtime is closed"),
              }),
            );
          }
          const createdAt = yield* Clock.currentTimeMillis;
          nextId += 1;
          const followUpId = `follow-up:${threadId}:${createdAt}:${nextId.toString(36)}`;
          const followUp: CodexQueuedFollowUp = {
            followUpId,
            threadId,
            prompt,
            ...(input.promptInput ? { promptInput: input.promptInput } : {}),
            createdAt,
            collaborationMode: input.collaborationMode ?? null,
            serviceTier: normalizeServiceTier(input.serviceTier),
            ...(input.summary !== undefined ? { summary: input.summary } : {}),
            pausedReason: input.pausedReason ?? null,
          };
          yield* Effect.sync(() => write(threadId, [...list(threadId), followUp]));
          return followUpId;
        }),
      remove: (threadId, followUpId) =>
        Effect.sync(() => {
          const normalizedFollowUpId = normalizeId(followUpId);
          const entries = list(threadId);
          if (
            !normalizedFollowUpId ||
            !entries.some((entry) => entry.followUpId === normalizedFollowUpId)
          ) {
            return false;
          }
          write(
            threadId,
            entries.filter((entry) => entry.followUpId !== normalizedFollowUpId),
          );
          return true;
        }),
      reorder: (threadId, orderedFollowUpIds) =>
        Effect.sync(() => {
          const entries = list(threadId);
          if (entries.length <= 1) return;
          const byId = new Map(entries.map((entry) => [entry.followUpId, entry] as const));
          const seen = new Set<string>();
          const ordered: CodexQueuedFollowUp[] = [];
          for (const rawId of orderedFollowUpIds) {
            const followUpId = normalizeId(rawId);
            const entry = byId.get(followUpId);
            if (!entry || seen.has(followUpId)) continue;
            seen.add(followUpId);
            ordered.push(entry);
          }
          write(threadId, [...ordered, ...entries.filter((entry) => !seen.has(entry.followUpId))]);
        }),
      sendNow: (threadId, followUpId) =>
        Effect.suspend(() => {
          const claimed = claim(threadId, (entry) => entry.followUpId === normalizeId(followUpId));
          return claimed ? submitClaim(claimed) : Effect.void;
        }),
      request: (threadId) => {
        const normalizedThreadId = normalizeId(threadId);
        if (
          closed ||
          !normalizedThreadId ||
          FiberMap.hasUnsafe(dispatches, normalizedThreadId) ||
          !options.isSubmissionEligible(normalizedThreadId)
        ) {
          return;
        }
        const head = list(normalizedThreadId)[0];
        if (!head || head.pausedReason) return;
        runDispatch(normalizedThreadId, dispatch(normalizedThreadId));
      },
      clearPaused: (threadId, publish = true) => {
        const entries = list(threadId);
        if (!entries.some((entry) => Boolean(entry.pausedReason))) return false;
        write(
          threadId,
          entries.map((entry) =>
            entry.pausedReason
              ? {
                  ...entry,
                  pausedReason: null,
                }
              : entry,
          ),
          publish,
        );
        return true;
      },
      reset: (threadId) => {
        if (closed) return;
        entriesByThread.delete(normalizeId(threadId));
      },
      clear,
    });
  });
