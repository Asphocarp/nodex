import * as Context from "effect/Context";
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import * as HashMap from "effect/HashMap";
import * as Option from "effect/Option";
import * as Ref from "effect/Ref";
import type * as Scope from "effect/Scope";
import * as Semaphore from "effect/Semaphore";
import { BrowserApplication } from "../browser-application/BrowserApplication";
import { ProjectWorkspace } from "../project-application/ProjectWorkspace";
import type {
  CodexForkBrowserSidePanelSnapshot,
  CodexForkBrowserSceneContext,
} from "../../shared/codex-fork-browser-transfer";
import { CodexClientThreadIdentity } from "./CodexClientThreadIdentity";

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

export class CodexForkSidePanelTransferError extends Data.TaggedError(
  "CodexForkSidePanelTransferError",
)<{
  readonly operation: "capture" | "rebase" | "apply" | "admission";
  readonly cause: unknown;
}> {}

interface PendingForkSidePanelSnapshot {
  readonly sourceWorkspaceRoot: string;
  readonly snapshot: CodexForkBrowserSidePanelSnapshot;
}

interface TransferState {
  readonly closed: boolean;
  readonly pendingByWorktreeId: HashMap.HashMap<string, PendingForkSidePanelSnapshot>;
  readonly targetByConversationId: HashMap.HashMap<string, CodexForkBrowserSidePanelSnapshot>;
}

export interface CodexForkSidePanelTransferRuntimeService {
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
  ) => Effect.Effect<CodexForkBrowserSidePanelSnapshot | null, CodexForkSidePanelTransferError>;
  readonly getPendingSnapshot: (
    pendingWorktreeId: string,
  ) => Effect.Effect<CodexForkBrowserSidePanelSnapshot | null>;
  readonly getTargetSnapshot: (
    targetConversationId: string,
  ) => Effect.Effect<CodexForkBrowserSidePanelSnapshot | null>;
}

/** Canonical application capability for staging browser state across a direct Thread fork. */
export class CodexForkSidePanelTransfer extends Context.Service<
  CodexForkSidePanelTransfer,
  CodexForkSidePanelTransferRuntimeService
>()("nodex/main/codex-application/CodexForkSidePanelTransfer") {}

const emptyState = (): TransferState => ({
  closed: false,
  pendingByWorktreeId: HashMap.empty(),
  targetByConversationId: HashMap.empty(),
});

const transferError = (operation: CodexForkSidePanelTransferError["operation"], cause: unknown) =>
  new CodexForkSidePanelTransferError({ operation, cause });

export const make: Effect.Effect<
  CodexForkSidePanelTransferRuntimeService,
  never,
  Scope.Scope | BrowserApplication | CodexClientThreadIdentity | ProjectWorkspace
> = Effect.gen(function* () {
  const browser = yield* BrowserApplication;
  const identities = yield* CodexClientThreadIdentity;
  const workspace = yield* ProjectWorkspace;
  const state = yield* Ref.make(emptyState());
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
    update: (current: TransferState) => TransferState,
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

  const mapCapabilityError =
    (operation: "capture" | "rebase" | "apply") =>
    <Value, Error>(
      effect: Effect.Effect<Value, Error>,
    ): Effect.Effect<Value, CodexForkSidePanelTransferError> =>
      effect.pipe(Effect.mapError((cause) => transferError(operation, cause)));

  const capture = (
    sourceConversationId: string,
    sourceSceneContext?: CodexForkBrowserSceneContext,
  ) =>
    identities.resolveBrowserConversationId(sourceConversationId).pipe(
      Effect.flatMap((browserConversationId) =>
        browser.forkTransfer.capture(browserConversationId, sourceSceneContext),
      ),
      mapCapabilityError("capture"),
    );

  const rebase = (snapshot: CodexForkBrowserSidePanelSnapshot, targetConversationId: string) =>
    identities.resolveBrowserConversationId(targetConversationId).pipe(
      Effect.flatMap((browserConversationId) =>
        browser.forkTransfer.rebase(snapshot, browserConversationId),
      ),
      mapCapabilityError("rebase"),
    );

  const stageDirect = (input: CodexForkSidePanelDirectStageInput) =>
    transitions.withPermits(1)(
      Effect.gen(function* () {
        yield* ensureOpen;
        const captured = yield* capture(input.sourceConversationId, input.sourceSceneContext);
        const rebased = yield* rebase(captured, input.targetConversationId);
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
        const captured = yield* capture(input.sourceConversationId, input.sourceSceneContext);
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

        const rebased = yield* rebase(pending.snapshot, input.targetConversationId);
        yield* commit((latest) => ({
          ...latest,
          pendingByWorktreeId: HashMap.remove(latest.pendingByWorktreeId, input.pendingWorktreeId),
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

        const targetBrowserConversationId = yield* identities
          .resolveBrowserConversationId(input.targetConversationId)
          .pipe(mapCapabilityError("apply"));
        const targetProjectSession = yield* workspace
          .getProjectSession(input.targetProjectSessionId)
          .pipe(mapCapabilityError("apply"));
        if (!targetProjectSession) {
          return yield* Effect.fail(
            transferError("apply", new Error("Target project session was not found")),
          );
        }
        const applied = yield* browser.forkTransfer
          .apply(snapshot, {
            targetBrowserConversationId,
            targetBrowserViewScopeId:
              input.targetBrowserViewScopeId ?? `headless:${input.targetProjectSessionId}`,
            targetProjectSession,
          })
          .pipe(mapCapabilityError("apply"));
        yield* commit((latest) => ({
          ...latest,
          targetByConversationId: HashMap.remove(
            latest.targetByConversationId,
            input.targetConversationId,
          ),
        }));
        return applied;
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
  } satisfies CodexForkSidePanelTransferRuntimeService;
});
