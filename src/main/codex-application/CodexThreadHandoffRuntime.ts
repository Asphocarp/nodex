import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Ref from "effect/Ref";
import * as Schema from "effect/Schema";
import * as Scope from "effect/Scope";
import * as Semaphore from "effect/Semaphore";
import * as Stream from "effect/Stream";
import * as SubscriptionRef from "effect/SubscriptionRef";
import {
  isTerminalCodexThreadHandoff,
  parseCodexThreadHandoffJournalEntry,
  retainCodexThreadHandoffJournalEntries,
  type CodexThreadExecutionLocation,
  type CodexThreadHandoffJournalEntry,
  type CodexThreadHandoffPhase,
  type CodexThreadHandoffPreparedArtifact,
} from "../codex/codex-thread-handoff-journal";
import type { CodexThreadHandoffJournalStorage } from "../platform/CodexThreadHandoffJournalStorage";

export interface CodexThreadHandoffPreparation {
  readonly destination: CodexThreadExecutionLocation;
  readonly prepared: CodexThreadHandoffPreparedArtifact;
}

export class CodexThreadHandoffEffectError extends Schema.TaggedError<CodexThreadHandoffEffectError>()(
  "CodexThreadHandoffEffectError",
  { cause: Schema.Defect() },
) {}

export interface CodexThreadHandoffEffects {
  readonly resolveSource: (
    threadId: string,
  ) => Effect.Effect<CodexThreadExecutionLocation, CodexThreadHandoffEffectError>;
  readonly readCanonicalLocation: (
    threadId: string,
  ) => Effect.Effect<CodexThreadExecutionLocation | null, CodexThreadHandoffEffectError>;
  readonly stopActiveTurn: (threadId: string) => Effect.Effect<void, CodexThreadHandoffEffectError>;
  readonly prepareDestination: (
    entry: CodexThreadHandoffJournalEntry,
    onPhase: (phase: string, status: "running" | "success" | "error") => Effect.Effect<void>,
  ) => Effect.Effect<CodexThreadHandoffPreparation, CodexThreadHandoffEffectError>;
  readonly switchRuntime: (
    threadId: string,
    location: CodexThreadExecutionLocation,
    preparation: CodexThreadHandoffPreparation | null,
  ) => Effect.Effect<void, CodexThreadHandoffEffectError>;
  readonly commitLocation: (
    threadId: string,
    location: CodexThreadExecutionLocation,
  ) => Effect.Effect<void, CodexThreadHandoffEffectError>;
  readonly projectLocation: (
    threadId: string,
    location: CodexThreadExecutionLocation,
  ) => Effect.Effect<void, CodexThreadHandoffEffectError>;
  readonly transferOwner: (
    threadId: string,
    preparation: CodexThreadHandoffPreparation,
  ) => Effect.Effect<void, CodexThreadHandoffEffectError>;
  readonly cleanup: (
    preparation: CodexThreadHandoffPreparation,
    outcome: "committed" | "rolled-back",
  ) => Effect.Effect<readonly string[], CodexThreadHandoffEffectError>;
  readonly rollbackPreparation: (
    preparation: CodexThreadHandoffPreparation,
  ) => Effect.Effect<readonly string[], CodexThreadHandoffEffectError>;
  readonly sendFollowUp: (
    threadId: string,
    prompt: string,
  ) => Effect.Effect<void, CodexThreadHandoffEffectError>;
}

export interface CodexThreadHandoffProgress {
  readonly entry: CodexThreadHandoffJournalEntry;
  readonly detail: string | null;
}

export interface CodexStartThreadHandoffInput {
  readonly operationId: string;
  readonly threadId: string;
  readonly destinationHostId: string | null;
  readonly followUpPrompt: string | null;
  readonly onProgress?: (progress: CodexThreadHandoffProgress) => void;
}

export type CodexAppHandoffStatusType = "running" | "success" | "warning" | "error";

export interface CodexAppHandoffStep {
  readonly id: string;
  readonly label: string;
  readonly status: CodexAppHandoffStatusType;
  readonly message: string | null;
  readonly updatedAt: number;
}

export interface CodexAppHandoffOperation {
  readonly operationId: string;
  readonly revision: number;
  readonly status: CodexAppHandoffStatusType;
  readonly threadId: string;
  readonly sourceThreadId: string;
  readonly destinationHostId: string;
  readonly destinationHostDisplayName: string | null;
  readonly message: string | null;
  readonly steps: readonly CodexAppHandoffStep[];
  readonly createdAt: number;
  readonly updatedAt: number;
  readonly completedAt: number | null;
}

export interface CodexLaunchThreadHandoffInput extends CodexStartThreadHandoffInput {
  readonly destinationHostDisplayName: string;
}

export class CodexThreadHandoffRuntimeError extends Schema.TaggedError<CodexThreadHandoffRuntimeError>()(
  "CodexThreadHandoffRuntimeError",
  {
    operation: Schema.String,
    message: Schema.String,
    cause: Schema.Defect(),
    operationId: Schema.optional(Schema.String),
    threadId: Schema.optional(Schema.String),
  },
) {}

export class CodexThreadHandoffRuntime extends Context.Service<
  CodexThreadHandoffRuntime,
  {
    readonly start: (
      input: CodexStartThreadHandoffInput,
      effects: CodexThreadHandoffEffects,
    ) => Effect.Effect<CodexThreadHandoffJournalEntry, CodexThreadHandoffRuntimeError>;
    readonly recover: (
      effects: CodexThreadHandoffEffects,
      onProgress?: (progress: CodexThreadHandoffProgress) => void,
    ) => Effect.Effect<readonly CodexThreadHandoffJournalEntry[], CodexThreadHandoffRuntimeError>;
    readonly launch: (
      input: CodexLaunchThreadHandoffInput,
      effects: CodexThreadHandoffEffects,
    ) => Effect.Effect<CodexAppHandoffOperation>;
    readonly get: (operationId: string) => Effect.Effect<CodexAppHandoffOperation | null>;
    readonly waitForRevision: (
      operationId: string,
      afterRevision: number | null,
      waitMs: number,
    ) => Effect.Effect<CodexAppHandoffOperation | null>;
  }
>()("nodex/main/codex-application/CodexThreadHandoffRuntime") {}

const terminalPhases = new Set<CodexThreadHandoffPhase>([
  "completed",
  "completed-with-warning",
  "failed",
]);
const MAX_STATUS_OPERATIONS = 128;

const failureMessage = (cause: unknown): string => {
  if (cause instanceof Error && cause.message.trim()) return cause.message;
  if (typeof cause === "object" && cause !== null && "cause" in cause && cause.cause !== cause) {
    return failureMessage(cause.cause);
  }
  return String(cause);
};

const locationsEqual = (
  left: CodexThreadExecutionLocation,
  right: CodexThreadExecutionLocation,
): boolean =>
  left.hostId === right.hostId &&
  left.cwd === right.cwd &&
  left.managedWorktreePath === right.managedWorktreePath &&
  left.projectId === right.projectId &&
  left.projectlessOutputDirectory === right.projectlessOutputDirectory &&
  left.projectlessWorkspaceBrowserRoot === right.projectlessWorkspaceBrowserRoot &&
  left.workspaceRoots.length === right.workspaceRoots.length &&
  left.workspaceRoots.every((root, index) => root === right.workspaceRoots[index]);

const isTerminalStatus = (status: CodexAppHandoffStatusType): boolean => status !== "running";

const retainStatusOperations = (
  operations: Iterable<CodexAppHandoffOperation>,
): ReadonlyMap<string, CodexAppHandoffOperation> => {
  const all = [...operations];
  if (all.length <= MAX_STATUS_OPERATIONS) {
    return new Map(all.map((operation) => [operation.operationId, operation]));
  }
  const active = all.filter((operation) => !isTerminalStatus(operation.status));
  const terminal = all
    .filter((operation) => isTerminalStatus(operation.status))
    .sort((left, right) => right.updatedAt - left.updatedAt)
    .slice(0, Math.max(0, MAX_STATUS_OPERATIONS - active.length));
  return new Map([...active, ...terminal].map((operation) => [operation.operationId, operation]));
};

const buildStep = (
  id: string,
  label: string,
  status: CodexAppHandoffStatusType,
  message: string | null,
  updatedAt: number,
): CodexAppHandoffStep => ({ id, label, status, message, updatedAt });

const buildInitialOperation = (
  input: CodexLaunchThreadHandoffInput,
  now: number,
): CodexAppHandoffOperation => ({
  operationId: input.operationId,
  revision: 0,
  status: "running",
  threadId: input.threadId,
  sourceThreadId: input.threadId,
  destinationHostId: input.destinationHostId ?? "local",
  destinationHostDisplayName: input.destinationHostDisplayName,
  message: "Preparing thread handoff.",
  steps: [
    buildStep("resolve-thread", "Resolve thread", "success", null, now),
    buildStep("handoff", "Move thread", "running", "Preparing thread handoff.", now),
  ],
  createdAt: now,
  updatedAt: now,
  completedAt: null,
});

const buildOperationFromJournal = (input: {
  readonly entry: CodexThreadHandoffJournalEntry;
  readonly detail: string | null;
  readonly existing: CodexAppHandoffOperation | undefined;
  readonly resolveHostDisplayName: (hostId: string) => string;
}): CodexAppHandoffOperation => {
  const { entry, existing } = input;
  const definitions: readonly {
    readonly id: string;
    readonly label: string;
    readonly phase: CodexThreadHandoffPhase;
  }[] = [
    { id: "resolve-thread", label: "Resolve task", phase: "queued" },
    { id: "stop-active-turn", label: "Stop active turn", phase: "stopping-turn" },
    { id: "prepare-destination", label: "Prepare destination", phase: "preparing-destination" },
    { id: "switch-runtime", label: "Switch task runtime", phase: "switching-runtime" },
    { id: "commit-location", label: "Save execution location", phase: "committing-location" },
    { id: "transfer-owner", label: "Update worktree owner", phase: "transferring-owner" },
    { id: "cleanup-source", label: "Clean up source", phase: "cleaning-source" },
  ];
  const phaseIndex = new Map(definitions.map((definition, index) => [definition.phase, index]));
  const terminal = terminalPhases.has(entry.phase);
  const currentIndex =
    entry.phase === "rolling-back" || entry.phase === "failed"
      ? (phaseIndex.get(entry.failedPhase ?? "queued") ?? 0)
      : entry.phase === "completed" || entry.phase === "completed-with-warning"
        ? definitions.length
        : (phaseIndex.get(entry.phase) ?? 0);
  const steps = definitions
    .filter((_definition, index) => index <= currentIndex || terminal)
    .map((definition, index) => {
      const failed = entry.phase === "failed" && index === currentIndex;
      const warning = entry.phase === "completed-with-warning" && index === definitions.length - 1;
      const running = !terminal && index === currentIndex;
      return buildStep(
        definition.id,
        definition.label,
        failed ? "error" : warning ? "warning" : running ? "running" : "success",
        failed
          ? entry.lastError
          : running && input.detail
            ? input.detail
            : warning
              ? (entry.warnings.at(-1) ?? null)
              : null,
        entry.updatedAt,
      );
    });
  if (entry.phase === "rolling-back" || entry.phase === "failed") {
    steps.push(
      buildStep(
        "rollback",
        "Restore source",
        entry.phase === "rolling-back"
          ? "running"
          : entry.warnings.length > 0
            ? "warning"
            : "success",
        entry.warnings.at(-1) ?? null,
        entry.updatedAt,
      ),
    );
  }
  if (
    entry.followUpPrompt &&
    (entry.followUpDispatchStarted ||
      entry.phase === "completed" ||
      entry.phase === "completed-with-warning")
  ) {
    steps.push(
      buildStep(
        "follow-up",
        "Send follow-up",
        entry.followUpDispatchStarted ? "success" : "running",
        null,
        entry.updatedAt,
      ),
    );
  }
  const status: CodexAppHandoffStatusType =
    entry.phase === "completed"
      ? "success"
      : entry.phase === "completed-with-warning"
        ? "warning"
        : entry.phase === "failed"
          ? "error"
          : "running";
  const destinationHostId =
    entry.destination?.hostId ?? entry.requestedDestinationHostId ?? entry.source.hostId;
  return {
    operationId: entry.operationId,
    revision: (existing?.revision ?? -1) + 1,
    status,
    threadId: entry.threadId,
    sourceThreadId: entry.threadId,
    destinationHostId,
    destinationHostDisplayName: input.resolveHostDisplayName(destinationHostId),
    message:
      status === "success"
        ? "Task handoff completed."
        : status === "warning"
          ? (entry.warnings.at(-1) ?? "Task handoff completed with a warning.")
          : status === "error"
            ? (entry.lastError ?? "Task handoff failed.")
            : (input.detail ?? "Moving task to its destination."),
    steps,
    createdAt: existing?.createdAt ?? entry.createdAt,
    updatedAt: entry.updatedAt,
    completedAt: entry.completedAt,
  };
};

interface ActiveHandoff {
  readonly operationId: string;
  readonly result: Deferred.Deferred<
    CodexThreadHandoffJournalEntry,
    CodexThreadHandoffRuntimeError
  >;
}

type StatusAdmission =
  | { readonly isNew: false; readonly operation: CodexAppHandoffOperation }
  | { readonly isNew: true; readonly operation: CodexAppHandoffOperation };

export const make = (options: {
  readonly scope: Scope.Scope;
  readonly storage: CodexThreadHandoffJournalStorage;
  readonly resolveHostDisplayName: (hostId: string) => string;
}): Effect.Effect<CodexThreadHandoffRuntime["Service"]> =>
  Effect.gen(function* () {
    const journalLock = yield* Semaphore.make(1);
    const journalLoaded = yield* Ref.make(false);
    const journalEntries = yield* Ref.make<ReadonlyMap<string, CodexThreadHandoffJournalEntry>>(
      new Map(),
    );
    const activeLock = yield* Semaphore.make(1);
    const activeByThreadId = yield* Ref.make<ReadonlyMap<string, ActiveHandoff>>(new Map());
    const statuses = yield* SubscriptionRef.make<ReadonlyMap<string, CodexAppHandoffOperation>>(
      new Map(),
    );

    const runtimeError = (
      operation: string,
      cause: unknown,
      identity?: { readonly operationId?: string; readonly threadId?: string },
    ) =>
      new CodexThreadHandoffRuntimeError({
        operation,
        message: failureMessage(cause),
        cause,
        ...identity,
      });
    const invoke = <A>(
      operation: string,
      effect: Effect.Effect<A, CodexThreadHandoffEffectError>,
      identity?: { readonly operationId?: string; readonly threadId?: string },
    ): Effect.Effect<A, CodexThreadHandoffRuntimeError> =>
      effect.pipe(Effect.mapError((failure) => runtimeError(operation, failure.cause, identity)));

    const loadJournalUnlocked = Effect.gen(function* () {
      if (yield* Ref.get(journalLoaded)) return;
      const loaded = yield* options.storage.load.pipe(
        Effect.mapError((cause) => runtimeError("journal-load", cause)),
      );
      yield* Ref.set(
        journalEntries,
        new Map(loaded.map((entry) => [entry.operationId, entry] as const)),
      );
      yield* Ref.set(journalLoaded, true);
    });
    const listJournal = journalLock.withPermits(1)(
      Effect.gen(function* () {
        yield* loadJournalUnlocked;
        return [...(yield* Ref.get(journalEntries)).values()].sort(
          (left, right) => left.createdAt - right.createdAt,
        );
      }),
    );
    const getJournal = (operationId: string) =>
      journalLock.withPermits(1)(
        Effect.gen(function* () {
          yield* loadJournalUnlocked;
          return (yield* Ref.get(journalEntries)).get(operationId) ?? null;
        }),
      );
    const putJournal = (entry: CodexThreadHandoffJournalEntry) =>
      journalLock.withPermits(1)(
        Effect.gen(function* () {
          yield* loadJournalUnlocked;
          const parsed = yield* Effect.try({
            try: () => parseCodexThreadHandoffJournalEntry(entry),
            catch: (cause) =>
              runtimeError("journal-validate", cause, {
                operationId: entry.operationId,
                threadId: entry.threadId,
              }),
          });
          const current = yield* Ref.get(journalEntries);
          const next = new Map(current).set(parsed.operationId, parsed);
          const retained = retainCodexThreadHandoffJournalEntries(next.values());
          yield* options.storage.persist(retained).pipe(
            Effect.mapError((cause) =>
              runtimeError("journal-persist", cause, {
                operationId: entry.operationId,
                threadId: entry.threadId,
              }),
            ),
          );
          yield* Ref.set(
            journalEntries,
            new Map(retained.map((retainedEntry) => [retainedEntry.operationId, retainedEntry])),
          );
        }),
      );

    const recordProgress = (progress: CodexThreadHandoffProgress) =>
      SubscriptionRef.modify(statuses, (current) => {
        const operation = buildOperationFromJournal({
          entry: progress.entry,
          detail: progress.detail,
          existing: current.get(progress.entry.operationId),
          resolveHostDisplayName: options.resolveHostDisplayName,
        });
        const next = new Map(current).set(operation.operationId, operation);
        return [operation, retainStatusOperations(next.values())];
      });
    const emitProgress = (
      progress: CodexThreadHandoffProgress,
      observer?: (progress: CodexThreadHandoffProgress) => void,
    ) =>
      recordProgress(progress).pipe(
        Effect.andThen(
          observer === undefined ? Effect.void : Effect.sync(() => observer(progress)),
        ),
        Effect.asVoid,
      );

    const save = (
      entry: CodexThreadHandoffJournalEntry,
      observer: ((progress: CodexThreadHandoffProgress) => void) | undefined,
      detail: string | null,
    ) =>
      putJournal(entry).pipe(
        Effect.andThen(emitProgress({ entry, detail }, observer)),
        Effect.asVoid,
      );
    const patchEntry = (
      entry: CodexThreadHandoffJournalEntry,
      patch: Partial<CodexThreadHandoffJournalEntry>,
      observer: ((progress: CodexThreadHandoffProgress) => void) | undefined,
      detail: string | null,
    ) =>
      Effect.gen(function* () {
        const next: CodexThreadHandoffJournalEntry = {
          ...entry,
          ...patch,
          schemaVersion: 1,
          operationId: entry.operationId,
          threadId: entry.threadId,
          createdAt: entry.createdAt,
          updatedAt: yield* Clock.currentTimeMillis,
        };
        yield* save(next, observer, detail);
        return next;
      });
    const phase = (
      entry: CodexThreadHandoffJournalEntry,
      nextPhase: CodexThreadHandoffPhase,
      observer?: (progress: CodexThreadHandoffProgress) => void,
    ) => patchEntry(entry, { phase: nextPhase }, observer, null);
    const addWarning = (
      entry: CodexThreadHandoffJournalEntry,
      cause: unknown,
      observer?: (progress: CodexThreadHandoffProgress) => void,
    ) => {
      const warning = failureMessage(cause);
      return patchEntry(entry, { warnings: [...entry.warnings, warning] }, observer, warning);
    };

    const rollback = Effect.fn("CodexThreadHandoffRuntime.rollback")(function* (
      initial: CodexThreadHandoffJournalEntry,
      cause: unknown,
      effects: CodexThreadHandoffEffects,
      observer?: (progress: CodexThreadHandoffProgress) => void,
    ) {
      let entry = yield* patchEntry(
        initial,
        {
          phase: "rolling-back",
          lastError: failureMessage(cause),
          failedPhase: initial.phase,
        },
        observer,
        "Rolling back task handoff.",
      );
      const warnings: string[] = [];
      const preparation =
        entry.destination && entry.prepared
          ? { destination: entry.destination, prepared: entry.prepared }
          : null;
      const collectFailure = (label: string) => (rollbackCause: unknown) =>
        Effect.sync(() => {
          warnings.push(`${label}: ${failureMessage(rollbackCause)}`);
        });

      if (preparation) {
        yield* invoke(
          "switch-runtime-source",
          effects.switchRuntime(entry.threadId, entry.source, preparation),
          { operationId: entry.operationId, threadId: entry.threadId },
        ).pipe(Effect.catch(collectFailure("runtime rollback")));
      }
      if (entry.coreCommitted) {
        yield* invoke(
          "commit-source-location",
          effects.commitLocation(entry.threadId, entry.source),
          { operationId: entry.operationId, threadId: entry.threadId },
        ).pipe(Effect.catch(collectFailure("Core rollback")));
      }
      if (preparation) {
        const preparedWarnings = yield* invoke(
          "rollback-preparation",
          effects.rollbackPreparation(preparation),
          { operationId: entry.operationId, threadId: entry.threadId },
        ).pipe(
          Effect.catch((rollbackCause) =>
            Effect.sync(() => {
              warnings.push(`Git rollback: ${failureMessage(rollbackCause)}`);
              return [] as readonly string[];
            }),
          ),
        );
        warnings.push(...preparedWarnings);
        yield* invoke("cleanup-rolled-back", effects.cleanup(preparation, "rolled-back"), {
          operationId: entry.operationId,
          threadId: entry.threadId,
        }).pipe(Effect.catch(collectFailure("artifact cleanup")));
      }
      yield* invoke(
        "project-source-location",
        effects.projectLocation(entry.threadId, entry.source),
        { operationId: entry.operationId, threadId: entry.threadId },
      ).pipe(Effect.catch(collectFailure("projection rollback")));

      entry = yield* patchEntry(
        entry,
        {
          phase: "failed",
          runtimeSwitched: false,
          coreCommitted: false,
          warnings: [...entry.warnings, ...warnings],
          completedAt: yield* Clock.currentTimeMillis,
        },
        observer,
        warnings.at(-1) ?? entry.lastError,
      );
      return entry;
    });

    const finishCommitted = Effect.fn("CodexThreadHandoffRuntime.finishCommitted")(function* (
      initial: CodexThreadHandoffJournalEntry,
      effects: CodexThreadHandoffEffects,
      observer?: (progress: CodexThreadHandoffProgress) => void,
    ) {
      if (!initial.destination || !initial.prepared) {
        return yield* rollback(
          initial,
          new Error("Committed handoff is missing its destination artifact."),
          effects,
          observer,
        );
      }
      const preparation = { destination: initial.destination, prepared: initial.prepared };
      let entry = yield* phase(initial, "cleaning-source", observer);
      entry = yield* invoke("cleanup-committed", effects.cleanup(preparation, "committed"), {
        operationId: entry.operationId,
        threadId: entry.threadId,
      }).pipe(
        Effect.flatMap((warnings) =>
          warnings.length === 0
            ? Effect.succeed(entry)
            : patchEntry(
                entry,
                { warnings: [...entry.warnings, ...warnings] },
                observer,
                warnings.join("; "),
              ),
        ),
        Effect.catch((cleanupCause) => addWarning(entry, cleanupCause, observer)),
      );
      const followUpPrompt = entry.followUpPrompt;
      if (followUpPrompt && !entry.followUpDispatchStarted) {
        entry = yield* patchEntry(
          entry,
          { followUpDispatchStarted: true },
          observer,
          "Dispatching follow-up.",
        );
        entry = yield* invoke(
          "send-follow-up",
          effects.sendFollowUp(entry.threadId, followUpPrompt),
          { operationId: entry.operationId, threadId: entry.threadId },
        ).pipe(
          Effect.as(entry),
          Effect.catch((followUpCause) => addWarning(entry, followUpCause, observer)),
        );
      }
      return yield* patchEntry(
        entry,
        {
          phase: entry.warnings.length > 0 ? "completed-with-warning" : "completed",
          completedAt: yield* Clock.currentTimeMillis,
          lastError: null,
        },
        observer,
        entry.warnings.at(-1) ?? null,
      );
    });

    const runTransaction = Effect.fn("CodexThreadHandoffRuntime.runTransaction")(function* (
      initial: CodexThreadHandoffJournalEntry,
      effects: CodexThreadHandoffEffects,
      observer?: (progress: CodexThreadHandoffProgress) => void,
    ) {
      let entry = initial;
      return yield* Effect.gen(function* () {
        entry = yield* phase(entry, "stopping-turn", observer);
        yield* invoke("stop-active-turn", effects.stopActiveTurn(entry.threadId), {
          operationId: entry.operationId,
          threadId: entry.threadId,
        });
        entry = yield* phase(entry, "preparing-destination", observer);
        const preparation = yield* invoke(
          "prepare-destination",
          effects.prepareDestination(entry, (detail, status) =>
            emitProgress({ entry, detail: `${detail}:${status}` }, observer),
          ),
          { operationId: entry.operationId, threadId: entry.threadId },
        );
        entry = yield* patchEntry(
          entry,
          {
            destination: preparation.destination,
            prepared: preparation.prepared,
            warnings: [...entry.warnings, ...preparation.prepared.warnings],
          },
          observer,
          null,
        );
        entry = yield* phase(entry, "switching-runtime", observer);
        yield* invoke(
          "switch-runtime-destination",
          effects.switchRuntime(entry.threadId, preparation.destination, preparation),
          { operationId: entry.operationId, threadId: entry.threadId },
        );
        entry = yield* patchEntry(entry, { runtimeSwitched: true }, observer, null);
        entry = yield* phase(entry, "committing-location", observer);
        yield* invoke(
          "commit-destination-location",
          effects.commitLocation(entry.threadId, preparation.destination),
          { operationId: entry.operationId, threadId: entry.threadId },
        );
        entry = yield* patchEntry(entry, { coreCommitted: true }, observer, null);
        yield* invoke(
          "project-destination-location",
          effects.projectLocation(entry.threadId, preparation.destination),
          { operationId: entry.operationId, threadId: entry.threadId },
        );
        entry = yield* phase(entry, "transferring-owner", observer);
        entry = yield* invoke(
          "transfer-owner",
          effects.transferOwner(entry.threadId, preparation),
          { operationId: entry.operationId, threadId: entry.threadId },
        ).pipe(
          Effect.as(entry),
          Effect.catch((ownerCause) => addWarning(entry, ownerCause, observer)),
        );
        return yield* finishCommitted(entry, effects, observer);
      }).pipe(
        Effect.catch((transactionCause) => rollback(entry, transactionCause, effects, observer)),
      );
    });

    const resumeCommitted = Effect.fn("CodexThreadHandoffRuntime.resumeCommitted")(function* (
      initial: CodexThreadHandoffJournalEntry,
      effects: CodexThreadHandoffEffects,
      observer?: (progress: CodexThreadHandoffProgress) => void,
    ) {
      if (!initial.destination || !initial.prepared) {
        return yield* rollback(
          initial,
          new Error("Committed handoff is missing its destination artifact."),
          effects,
          observer,
        );
      }
      const preparation = { destination: initial.destination, prepared: initial.prepared };
      let entry = initial;
      return yield* Effect.gen(function* () {
        yield* invoke(
          "recover-runtime-destination",
          effects.switchRuntime(entry.threadId, preparation.destination, preparation),
          { operationId: entry.operationId, threadId: entry.threadId },
        );
        yield* invoke(
          "recover-project-destination",
          effects.projectLocation(entry.threadId, preparation.destination),
          { operationId: entry.operationId, threadId: entry.threadId },
        );
        entry = yield* phase(entry, "transferring-owner", observer);
        entry = yield* invoke(
          "recover-transfer-owner",
          effects.transferOwner(entry.threadId, preparation),
          { operationId: entry.operationId, threadId: entry.threadId },
        ).pipe(
          Effect.as(entry),
          Effect.catch((ownerCause) => addWarning(entry, ownerCause, observer)),
        );
        return yield* finishCommitted(entry, effects, observer);
      }).pipe(Effect.catch((recoveryCause) => rollback(entry, recoveryCause, effects, observer)));
    });

    const recoverEntry = Effect.fn("CodexThreadHandoffRuntime.recoverEntry")(function* (
      entry: CodexThreadHandoffJournalEntry,
      effects: CodexThreadHandoffEffects,
      observer?: (progress: CodexThreadHandoffProgress) => void,
    ) {
      const canonicalRead = yield* invoke(
        "read-canonical-location",
        effects.readCanonicalLocation(entry.threadId),
        { operationId: entry.operationId, threadId: entry.threadId },
      ).pipe(
        Effect.map((canonical) => ({ kind: "read" as const, canonical })),
        Effect.catch((canonicalCause) =>
          emitProgress(
            {
              entry,
              detail: `Recovery deferred: ${failureMessage(canonicalCause)}`,
            },
            observer,
          ).pipe(Effect.as({ kind: "failed" as const })),
        ),
      );
      if (canonicalRead.kind === "failed") return entry;
      if (!canonicalRead.canonical) {
        yield* emitProgress(
          { entry, detail: "Recovery deferred: canonical task location is unavailable." },
          observer,
        );
        return entry;
      }
      const canonical = canonicalRead.canonical;
      const coreCommitted =
        entry.destination !== null && locationsEqual(canonical, entry.destination);
      const coreAtSource = locationsEqual(canonical, entry.source);
      if (!coreCommitted && !coreAtSource) {
        yield* emitProgress(
          { entry, detail: "Recovery deferred: canonical task location is ambiguous." },
          observer,
        );
        return entry;
      }
      const reconciled =
        entry.coreCommitted === coreCommitted
          ? entry
          : yield* patchEntry(
              entry,
              { coreCommitted },
              observer,
              coreCommitted ? "Recovered durable location." : "Recovered source location.",
            );
      if (reconciled.coreCommitted && reconciled.destination && reconciled.prepared) {
        return yield* resumeCommitted(reconciled, effects, observer);
      }
      return yield* rollback(
        reconciled,
        new Error("Recovered an interrupted task handoff."),
        effects,
        observer,
      );
    });

    const runOwned = (
      threadId: string,
      operationId: string,
      operation: Effect.Effect<CodexThreadHandoffJournalEntry, CodexThreadHandoffRuntimeError>,
    ) =>
      Effect.gen(function* () {
        const allocation = yield* activeLock.withPermits(1)(
          Effect.gen(function* () {
            const current = yield* Ref.get(activeByThreadId);
            const existing = current.get(threadId);
            if (existing?.operationId === operationId) {
              return { owned: false as const, active: existing };
            }
            if (existing) {
              return yield* Effect.fail(
                runtimeError("admit", new Error("This task already has a handoff in progress."), {
                  operationId,
                  threadId,
                }),
              );
            }
            const active: ActiveHandoff = {
              operationId,
              result: yield* Deferred.make<
                CodexThreadHandoffJournalEntry,
                CodexThreadHandoffRuntimeError
              >(),
            };
            yield* Ref.set(activeByThreadId, new Map(current).set(threadId, active));
            return { owned: true as const, active };
          }),
        );
        if (allocation.owned) {
          const owned = operation.pipe(
            Effect.onExit((exit) =>
              activeLock.withPermits(1)(
                Ref.update(activeByThreadId, (current) => {
                  if (current.get(threadId) !== allocation.active) return current;
                  const next = new Map(current);
                  next.delete(threadId);
                  return next;
                }).pipe(Effect.andThen(Deferred.done(allocation.active.result, exit))),
              ),
            ),
          );
          yield* Effect.forkIn(owned, options.scope, { startImmediately: true });
        }
        return yield* Deferred.await(allocation.active.result);
      });

    const start = (input: CodexStartThreadHandoffInput, effects: CodexThreadHandoffEffects) =>
      runOwned(
        input.threadId,
        input.operationId,
        Effect.gen(function* () {
          const existing = yield* getJournal(input.operationId);
          if (existing) {
            yield* emitProgress({ entry: existing, detail: null }, input.onProgress);
            return existing;
          }
          const persisted = (yield* listJournal).find(
            (entry) => entry.threadId === input.threadId && !isTerminalCodexThreadHandoff(entry),
          );
          if (persisted) {
            return yield* Effect.fail(
              runtimeError(
                "admit",
                new Error("This task has an unfinished handoff that must be recovered first."),
                { operationId: input.operationId, threadId: input.threadId },
              ),
            );
          }
          const source = yield* invoke("resolve-source", effects.resolveSource(input.threadId), {
            operationId: input.operationId,
            threadId: input.threadId,
          });
          const now = yield* Clock.currentTimeMillis;
          const entry: CodexThreadHandoffJournalEntry = {
            schemaVersion: 1,
            operationId: input.operationId,
            threadId: input.threadId,
            phase: "queued",
            source,
            requestedDestinationHostId: input.destinationHostId,
            destination: null,
            prepared: null,
            runtimeSwitched: false,
            coreCommitted: false,
            followUpPrompt: input.followUpPrompt,
            followUpDispatchStarted: false,
            warnings: [],
            lastError: null,
            failedPhase: null,
            createdAt: now,
            updatedAt: now,
            completedAt: null,
          };
          yield* save(entry, input.onProgress, null);
          return yield* runTransaction(entry, effects, input.onProgress);
        }),
      );

    const recover = (
      effects: CodexThreadHandoffEffects,
      observer?: (progress: CodexThreadHandoffProgress) => void,
    ) =>
      Effect.gen(function* () {
        const entries = yield* listJournal;
        const recovered: CodexThreadHandoffJournalEntry[] = [];
        for (const entry of entries) {
          if (isTerminalCodexThreadHandoff(entry)) continue;
          recovered.push(
            yield* runOwned(
              entry.threadId,
              entry.operationId,
              recoverEntry(entry, effects, observer),
            ),
          );
        }
        return recovered;
      });

    const get = (operationId: string) =>
      SubscriptionRef.get(statuses).pipe(Effect.map((current) => current.get(operationId) ?? null));
    const waitForRevision = (operationId: string, afterRevision: number | null, waitMs: number) =>
      Effect.gen(function* () {
        const existing = yield* get(operationId);
        if (
          !existing ||
          waitMs <= 0 ||
          afterRevision === null ||
          existing.revision > afterRevision ||
          isTerminalStatus(existing.status)
        ) {
          return existing;
        }
        yield* SubscriptionRef.changes(statuses).pipe(
          Stream.filter((current) => {
            const operation = current.get(operationId);
            return (
              operation !== undefined &&
              (operation.revision > afterRevision || isTerminalStatus(operation.status))
            );
          }),
          Stream.runHead,
          Effect.asVoid,
          Effect.raceFirst(Effect.sleep(waitMs)),
        );
        return yield* get(operationId);
      });
    const launch = (input: CodexLaunchThreadHandoffInput, effects: CodexThreadHandoffEffects) =>
      Effect.gen(function* () {
        const now = yield* Clock.currentTimeMillis;
        const admitted = yield* SubscriptionRef.modify(
          statuses,
          (current): readonly [StatusAdmission, ReadonlyMap<string, CodexAppHandoffOperation>] => {
            const existing = current.get(input.operationId);
            if (existing) return [{ isNew: false as const, operation: existing }, current];
            const operation = buildInitialOperation(input, now);
            const next = new Map(current).set(operation.operationId, operation);
            return [{ isNew: true as const, operation }, retainStatusOperations(next.values())];
          },
        );
        if (!admitted.isNew) return admitted.operation;
        const background = start(input, effects).pipe(
          Effect.catch((cause) =>
            Effect.gen(function* () {
              const failedAt = yield* Clock.currentTimeMillis;
              yield* SubscriptionRef.update(statuses, (current) => {
                const existing = current.get(input.operationId);
                if (!existing || isTerminalStatus(existing.status)) return current;
                const failed: CodexAppHandoffOperation = {
                  ...existing,
                  revision: existing.revision + 1,
                  status: "error",
                  message: cause.message,
                  steps: [
                    buildStep("resolve-thread", "Resolve thread", "success", null, failedAt),
                    buildStep("handoff", "Move thread", "error", cause.message, failedAt),
                  ],
                  updatedAt: failedAt,
                  completedAt: failedAt,
                };
                return retainStatusOperations(
                  new Map(current).set(input.operationId, failed).values(),
                );
              });
            }),
          ),
        );
        yield* Effect.forkIn(background, options.scope, { startImmediately: true });
        return admitted.operation;
      });

    return CodexThreadHandoffRuntime.of({ start, recover, launch, get, waitForRevision });
  });
