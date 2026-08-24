import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Ref from "effect/Ref";

export interface CleanupFailure {
  readonly operation: string;
  readonly reason: string;
  readonly subsystem: string;
}

export interface CleanupReport {
  readonly failures: readonly CleanupFailure[];
}

export const emptyCleanupReport: CleanupReport = { failures: [] };

/** Process-scoped sink for failures discovered while application Layer finalizers run. */
export class MainCleanup extends Context.Service<
  MainCleanup,
  {
    readonly report: (failures: readonly CleanupFailure[]) => Effect.Effect<void>;
    readonly snapshot: Effect.Effect<CleanupReport>;
  }
>()("nodex/main/app/MainCleanup") {}

export const layer: Layer.Layer<MainCleanup> = Layer.effect(
  MainCleanup,
  Effect.gen(function* () {
    const failures = yield* Ref.make<readonly CleanupFailure[]>([]);
    return MainCleanup.of({
      report: (next) =>
        next.length === 0 ? Effect.void : Ref.update(failures, (current) => [...current, ...next]),
      snapshot: Ref.get(failures).pipe(Effect.map((current) => ({ failures: current }))),
    });
  }),
);
