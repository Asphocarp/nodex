import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import * as FiberSet from "effect/FiberSet";
import * as HashMap from "effect/HashMap";
import * as Option from "effect/Option";
import * as Ref from "effect/Ref";
import type * as Scope from "effect/Scope";
import type {
  AgentImportApplyInput,
  AgentImportProgress,
  AgentImportResult,
  AgentImportScan,
  AgentImportSourceKind,
} from "../../shared/agent-import";
import type { PendingImportScan } from "../codex/agent-import-operations";

export class AgentImportOperationsError extends Data.TaggedError("AgentImportOperationsError")<{
  readonly operation: "apply" | "id" | "scan";
  readonly cause: unknown;
}> {}

export interface AgentImportOperationsAdapter {
  readonly scan: (
    sourceKind: AgentImportSourceKind,
    selectedSourceHome: string | undefined,
    now: number,
  ) => Effect.Effect<PendingImportScan, AgentImportOperationsError>;
  readonly apply: (
    input: AgentImportApplyInput,
    scan: PendingImportScan,
    importId: string,
    startedAt: number,
    emitProgress: (progress: AgentImportProgress) => void,
  ) => Effect.Effect<AgentImportResult, AgentImportOperationsError>;
  readonly makeImportId: Effect.Effect<string, AgentImportOperationsError>;
}

export class AgentImportRuntimeError extends Data.TaggedError("AgentImportRuntimeError")<{
  readonly reason: "apply-failed" | "closed" | "concurrent-import" | "expired-scan" | "scan-failed";
  readonly cause: unknown;
}> {}

interface AgentImportState {
  readonly applying: boolean;
  readonly closed: boolean;
  readonly scans: HashMap.HashMap<string, PendingImportScan>;
}

export class AgentImportRuntime extends Context.Service<
  AgentImportRuntime,
  {
    readonly scan: (
      sourceKind: AgentImportSourceKind,
      selectedSourceHome?: string,
    ) => Effect.Effect<AgentImportScan, AgentImportRuntimeError>;
    readonly apply: (
      input: AgentImportApplyInput,
    ) => Effect.Effect<AgentImportResult, AgentImportRuntimeError>;
    readonly snapshot: Effect.Effect<{
      readonly applying: boolean;
      readonly closed: boolean;
      readonly scanIds: readonly string[];
    }>;
  }
>()("nodex/main/codex-application/AgentImportRuntime") {}

type ApplyAdmission =
  | { readonly _tag: "admitted"; readonly scan: PendingImportScan }
  | { readonly _tag: "closed" }
  | { readonly _tag: "concurrent-import" }
  | { readonly _tag: "expired-scan" };

const pruneExpired = (state: AgentImportState, now: number): AgentImportState => ({
  ...state,
  scans: HashMap.filter(state.scans, (pending) => pending.scan.expiresAt > now),
});

const runtimeError = (
  reason: AgentImportRuntimeError["reason"],
  cause: unknown,
): AgentImportRuntimeError => new AgentImportRuntimeError({ reason, cause });

export const make = (
  operations: AgentImportOperationsAdapter,
  emitProgress: (progress: AgentImportProgress) => Effect.Effect<void>,
): Effect.Effect<AgentImportRuntime["Service"], never, Scope.Scope> =>
  Effect.gen(function* () {
    const state = yield* Ref.make<AgentImportState>({
      applying: false,
      closed: false,
      scans: HashMap.empty(),
    });
    yield* Effect.addFinalizer(() =>
      Ref.set(state, {
        applying: false,
        closed: true,
        scans: HashMap.empty(),
      }),
    );
    const progressFibers = yield* FiberSet.make();
    const runProgress = yield* FiberSet.runtime(progressFibers)();
    const reportProgress = (progress: AgentImportProgress): void => {
      runProgress(emitProgress(progress));
    };

    const scan = (sourceKind: AgentImportSourceKind, selectedSourceHome?: string) =>
      Effect.gen(function* () {
        const startedAt = yield* Clock.currentTimeMillis;
        const prepared = yield* operations
          .scan(sourceKind, selectedSourceHome, startedAt)
          .pipe(Effect.mapError((error) => runtimeError("scan-failed", error.cause)));
        const committed = yield* Ref.modify(state, (current) => {
          if (current.closed) return [false, current] as const;
          const currentScans = pruneExpired(current, startedAt).scans;
          return [
            true,
            {
              ...current,
              scans: HashMap.set(currentScans, prepared.scan.scanId, prepared),
            },
          ] as const;
        });
        if (!committed) {
          return yield* Effect.fail(
            runtimeError("closed", new Error("Agent import runtime is closed")),
          );
        }
        return prepared.scan;
      });

    const releaseApplyAdmission = Ref.update(state, (current) =>
      current.closed ? current : { ...current, applying: false },
    );

    const apply = (input: AgentImportApplyInput) =>
      Effect.gen(function* () {
        const startedAt = yield* Clock.currentTimeMillis;
        const admission = yield* Ref.modify(
          state,
          (current): readonly [ApplyAdmission, AgentImportState] => {
            if (current.closed) return [{ _tag: "closed" }, current];
            const currentState = pruneExpired(current, startedAt);
            if (currentState.applying) return [{ _tag: "concurrent-import" }, currentState];
            const pending = Option.getOrUndefined(HashMap.get(currentState.scans, input.scanId));
            if (!pending) return [{ _tag: "expired-scan" }, currentState];
            return [
              { _tag: "admitted", scan: pending },
              { ...currentState, applying: true },
            ];
          },
        );
        if (admission._tag === "closed") {
          return yield* Effect.fail(
            runtimeError("closed", new Error("Agent import runtime is closed")),
          );
        }
        if (admission._tag === "concurrent-import") {
          return yield* Effect.fail(
            runtimeError("concurrent-import", new Error("Another agent import is already running")),
          );
        }
        if (admission._tag === "expired-scan") {
          return yield* Effect.fail(
            runtimeError(
              "expired-scan",
              new Error("This import preview expired. Scan the source again."),
            ),
          );
        }

        return yield* Effect.gen(function* () {
          const importId = yield* operations.makeImportId.pipe(
            Effect.mapError((error) => runtimeError("apply-failed", error.cause)),
          );
          const result = yield* operations
            .apply(input, admission.scan, importId, startedAt, reportProgress)
            .pipe(Effect.mapError((error) => runtimeError("apply-failed", error.cause)));
          const completedAt = yield* Clock.currentTimeMillis;
          const committed = yield* Ref.modify(state, (current) => {
            if (current.closed) return [false, current] as const;
            return [
              true,
              {
                ...current,
                scans: HashMap.remove(current.scans, input.scanId),
              },
            ] as const;
          });
          if (!committed) {
            return yield* Effect.fail(
              runtimeError("closed", new Error("Agent import runtime is closed")),
            );
          }
          return { ...result, completedAt };
        }).pipe(Effect.ensuring(releaseApplyAdmission));
      });

    return AgentImportRuntime.of({
      scan,
      apply,
      snapshot: Ref.get(state).pipe(
        Effect.map((current) => ({
          applying: current.applying,
          closed: current.closed,
          scanIds: [...HashMap.keys(current.scans)].sort(),
        })),
      ),
    });
  });
