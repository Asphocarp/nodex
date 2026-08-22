import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import * as HashMap from "effect/HashMap";
import * as Option from "effect/Option";
import * as Ref from "effect/Ref";
import type * as Scope from "effect/Scope";
import * as Semaphore from "effect/Semaphore";
import type {
  CodexForkBrowserSidePanelSnapshot,
  CodexForkBrowserSceneContext,
} from "../../shared/codex-fork-browser-transfer";

export interface CodexForkSidePanelDirectStageInput {
  readonly sourceConversationId: string;
  readonly targetConversationId: string;
  readonly sourceSceneContext?: CodexForkBrowserSceneContext;
}

export interface CodexForkSidePanelPendingCaptureInput {
  readonly pendingWorktreeId: string;
  readonly sourceConversationId: string;
  readonly sourceWorkspaceRoot: string;
  readonly sourceSceneContext?: CodexForkBrowserSceneContext;
}

export interface CodexForkSidePanelPendingPromotionInput {
  readonly pendingWorktreeId: string;
  readonly targetConversationId: string;
  readonly targetWorkspaceRoot: string;
}

export interface CodexForkSidePanelTargetConsumeInput {
  readonly routeKind: "local-thread" | string;
  readonly targetConversationId: string;
  readonly targetProjectSessionId: string;
  readonly targetBrowserViewScopeId?: string;
}

export interface CodexForkSidePanelSnapshotAdapter<Snapshot> {
  readonly capture: (
    sourceConversationId: string,
    sourceSceneContext?: CodexForkBrowserSceneContext,
  ) => Effect.Effect<Snapshot, CodexForkSidePanelAdapterError>;
  readonly rebase: (
    snapshot: Snapshot,
    input: {
      readonly targetConversationId: string;
      readonly sourceWorkspaceRoot?: string;
      readonly targetWorkspaceRoot?: string;
    },
  ) => Effect.Effect<Snapshot, CodexForkSidePanelAdapterError>;
  readonly apply: (
    snapshot: Snapshot,
    input: {
      readonly targetConversationId: string;
      readonly targetProjectSessionId: string;
      readonly targetBrowserViewScopeId: string;
    },
  ) => Effect.Effect<Snapshot | void, CodexForkSidePanelAdapterError>;
}

export class CodexForkSidePanelAdapterError extends Data.TaggedError(
  "CodexForkSidePanelAdapterError",
)<{ readonly cause: unknown }> {}

export class CodexForkSidePanelTransferError extends Data.TaggedError(
  "CodexForkSidePanelTransferError",
)<{
  readonly operation: "capture" | "rebase" | "apply" | "admission";
  readonly cause: unknown;
}> {}

interface PendingForkSidePanelSnapshot<Snapshot> {
  readonly sourceWorkspaceRoot: string;
  readonly snapshot: Snapshot;
}

interface TransferState<Snapshot> {
  readonly closed: boolean;
  readonly pendingByWorktreeId: HashMap.HashMap<string, PendingForkSidePanelSnapshot<Snapshot>>;
  readonly targetByConversationId: HashMap.HashMap<string, Snapshot>;
}

export interface CodexForkSidePanelTransferRuntimeService<
  Snapshot = CodexForkBrowserSidePanelSnapshot,
> {
  readonly stageDirect: (
    input: CodexForkSidePanelDirectStageInput,
  ) => Effect.Effect<void, CodexForkSidePanelTransferError>;
  readonly capturePending: (
    input: CodexForkSidePanelPendingCaptureInput,
  ) => Effect.Effect<void, CodexForkSidePanelTransferError>;
  readonly promotePending: (
    input: CodexForkSidePanelPendingPromotionInput,
  ) => Effect.Effect<boolean, CodexForkSidePanelTransferError>;
  readonly discardPending: (
    pendingWorktreeId: string,
  ) => Effect.Effect<void, CodexForkSidePanelTransferError>;
  readonly consumeTarget: (
    input: CodexForkSidePanelTargetConsumeInput,
  ) => Effect.Effect<Snapshot | null, CodexForkSidePanelTransferError>;
  readonly getPendingSnapshot: (pendingWorktreeId: string) => Effect.Effect<Snapshot | null>;
  readonly getTargetSnapshot: (targetConversationId: string) => Effect.Effect<Snapshot | null>;
}

const emptyState = <Snapshot>(): TransferState<Snapshot> => ({
  closed: false,
  pendingByWorktreeId: HashMap.empty(),
  targetByConversationId: HashMap.empty(),
});

const transferError = (operation: CodexForkSidePanelTransferError["operation"], cause: unknown) =>
  new CodexForkSidePanelTransferError({ operation, cause });

export const make = <Snapshot = CodexForkBrowserSidePanelSnapshot>(
  adapter: CodexForkSidePanelSnapshotAdapter<Snapshot>,
): Effect.Effect<CodexForkSidePanelTransferRuntimeService<Snapshot>, never, Scope.Scope> =>
  Effect.gen(function* () {
    const state = yield* Ref.make(emptyState<Snapshot>());
    const transitions = yield* Semaphore.make(1);

    yield* Effect.addFinalizer(() =>
      Ref.set(state, {
        closed: true,
        pendingByWorktreeId: HashMap.empty(),
        targetByConversationId: HashMap.empty(),
      }),
    );

    const ensureOpen = Ref.get(state).pipe(
      Effect.filterOrFail(
        (current) => !current.closed,
        () => transferError("admission", new Error("Fork side-panel transfer runtime is closed")),
      ),
      Effect.asVoid,
    );

    const commit = (
      update: (current: TransferState<Snapshot>) => TransferState<Snapshot>,
    ): Effect.Effect<void, CodexForkSidePanelTransferError> =>
      Ref.modify(state, (current) => {
        if (current.closed) return [false, current] as const;
        return [true, update(current)] as const;
      }).pipe(
        Effect.filterOrFail(
          (committed) => committed,
          () => transferError("admission", new Error("Fork side-panel transfer runtime is closed")),
        ),
        Effect.asVoid,
      );

    const mapAdapterError =
      (operation: "capture" | "rebase" | "apply") =>
      <Value>(
        effect: Effect.Effect<Value, CodexForkSidePanelAdapterError>,
      ): Effect.Effect<Value, CodexForkSidePanelTransferError> =>
        effect.pipe(Effect.mapError((error) => transferError(operation, error.cause)));

    const stageDirect = (input: CodexForkSidePanelDirectStageInput) =>
      transitions.withPermits(1)(
        Effect.gen(function* () {
          yield* ensureOpen;
          const captured = yield* adapter
            .capture(input.sourceConversationId, input.sourceSceneContext)
            .pipe(mapAdapterError("capture"));
          const rebased = yield* adapter
            .rebase(captured, { targetConversationId: input.targetConversationId })
            .pipe(mapAdapterError("rebase"));
          yield* commit((current) => ({
            ...current,
            targetByConversationId: HashMap.set(
              current.targetByConversationId,
              input.targetConversationId,
              rebased,
            ),
          }));
        }),
      );

    const capturePending = (input: CodexForkSidePanelPendingCaptureInput) =>
      transitions.withPermits(1)(
        Effect.gen(function* () {
          yield* ensureOpen;
          const captured = yield* adapter
            .capture(input.sourceConversationId, input.sourceSceneContext)
            .pipe(mapAdapterError("capture"));
          yield* commit((current) => ({
            ...current,
            pendingByWorktreeId: HashMap.set(current.pendingByWorktreeId, input.pendingWorktreeId, {
              sourceWorkspaceRoot: input.sourceWorkspaceRoot,
              snapshot: captured,
            }),
          }));
        }),
      );

    const promotePending = (input: CodexForkSidePanelPendingPromotionInput) =>
      transitions.withPermits(1)(
        Effect.gen(function* () {
          yield* ensureOpen;
          const current = yield* Ref.get(state);
          const pending = Option.getOrUndefined(
            HashMap.get(current.pendingByWorktreeId, input.pendingWorktreeId),
          );
          if (!pending) return false;

          const rebased = yield* adapter
            .rebase(pending.snapshot, {
              targetConversationId: input.targetConversationId,
              sourceWorkspaceRoot: pending.sourceWorkspaceRoot,
              targetWorkspaceRoot: input.targetWorkspaceRoot,
            })
            .pipe(mapAdapterError("rebase"));
          yield* commit((latest) => ({
            ...latest,
            pendingByWorktreeId: HashMap.remove(
              latest.pendingByWorktreeId,
              input.pendingWorktreeId,
            ),
            targetByConversationId: HashMap.set(
              latest.targetByConversationId,
              input.targetConversationId,
              rebased,
            ),
          }));
          return true;
        }),
      );

    const discardPending = (pendingWorktreeId: string) =>
      transitions.withPermits(1)(
        ensureOpen.pipe(
          Effect.andThen(
            commit((current) => ({
              ...current,
              pendingByWorktreeId: HashMap.remove(current.pendingByWorktreeId, pendingWorktreeId),
            })),
          ),
        ),
      );

    const consumeTarget = (input: CodexForkSidePanelTargetConsumeInput) =>
      transitions.withPermits(1)(
        Effect.gen(function* () {
          yield* ensureOpen;
          if (input.routeKind !== "local-thread") {
            return yield* Effect.fail(
              transferError("admission", new Error("Expected local conversation route")),
            );
          }
          const current = yield* Ref.get(state);
          const snapshot = Option.getOrUndefined(
            HashMap.get(current.targetByConversationId, input.targetConversationId),
          );
          if (snapshot === undefined) return null;

          const applied = yield* adapter
            .apply(snapshot, {
              targetConversationId: input.targetConversationId,
              targetProjectSessionId: input.targetProjectSessionId,
              targetBrowserViewScopeId:
                input.targetBrowserViewScopeId ?? `headless:${input.targetProjectSessionId}`,
            })
            .pipe(mapAdapterError("apply"));
          yield* commit((latest) => ({
            ...latest,
            targetByConversationId: HashMap.remove(
              latest.targetByConversationId,
              input.targetConversationId,
            ),
          }));
          return applied ?? snapshot;
        }),
      );

    return {
      stageDirect,
      capturePending,
      promotePending,
      discardPending,
      consumeTarget,
      getPendingSnapshot: (pendingWorktreeId) =>
        Ref.get(state).pipe(
          Effect.map((current) =>
            Option.match(HashMap.get(current.pendingByWorktreeId, pendingWorktreeId), {
              onNone: () => null,
              onSome: (pending) => pending.snapshot,
            }),
          ),
        ),
      getTargetSnapshot: (targetConversationId) =>
        Ref.get(state).pipe(
          Effect.map((current) =>
            Option.getOrElse(
              HashMap.get(current.targetByConversationId, targetConversationId),
              () => null,
            ),
          ),
        ),
    } satisfies CodexForkSidePanelTransferRuntimeService<Snapshot>;
  });
