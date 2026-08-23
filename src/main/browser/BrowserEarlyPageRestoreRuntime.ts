import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as FiberMap from "effect/FiberMap";
import type * as Scope from "effect/Scope";

export interface BrowserEarlyPageRestoreLease {
  readonly isActive: () => boolean;
}

export interface BrowserEarlyPageRestoreResult<A, E> extends BrowserEarlyPageRestoreLease {
  readonly await: Effect.Effect<A, E>;
}

export interface BrowserEarlyPageRestoreRuntime<A, E = never> {
  readonly release: (guestWebContentsId: number) => void;
  readonly result: (guestWebContentsId: number) => BrowserEarlyPageRestoreResult<A, E> | null;
  readonly start: (
    guestWebContentsId: number,
    operation: (lease: BrowserEarlyPageRestoreLease) => Effect.Effect<A, E>,
  ) => boolean;
}

interface RestoreEntry<A, E> {
  readonly generation: symbol;
  result: BrowserEarlyPageRestoreResult<A, E> | null;
}

interface RestoreExecution<E> {
  readonly interrupt: (guestWebContentsId: number) => void;
  readonly run: <A, E2 extends E>(
    guestWebContentsId: number,
    operation: Effect.Effect<A, E2>,
  ) => Fiber.Fiber<A, E2>;
}

function makeRuntimeState<A, E>(
  execution: RestoreExecution<E>,
): {
  readonly close: () => void;
  readonly runtime: BrowserEarlyPageRestoreRuntime<A, E>;
} {
  let accepting = true;
  const entries = new Map<number, RestoreEntry<A, E>>();

  const release = (guestWebContentsId: number): void => {
    const entry = entries.get(guestWebContentsId);
    if (!entry) return;
    entries.delete(guestWebContentsId);
    execution.interrupt(guestWebContentsId);
  };

  return {
    close: () => {
      accepting = false;
      for (const guestWebContentsId of [...entries.keys()]) {
        release(guestWebContentsId);
      }
    },
    runtime: {
      release,
      result: (guestWebContentsId) => entries.get(guestWebContentsId)?.result ?? null,
      start: (guestWebContentsId, operation) => {
        if (!accepting || entries.has(guestWebContentsId)) return false;
        const generation = Symbol("browser-early-page-restore");
        const entry: RestoreEntry<A, E> = {
          generation,
          result: null,
        };
        entries.set(guestWebContentsId, entry);
        const lease: BrowserEarlyPageRestoreLease = {
          isActive: () => accepting && entries.get(guestWebContentsId)?.generation === generation,
        };
        const fiber = execution.run(guestWebContentsId, operation(lease));
        entry.result = { isActive: lease.isActive, await: Fiber.join(fiber) };
        return true;
      },
    },
  };
}

/** Owns every pre-navigation Browser history restore under the Sidebar Scope. */
export const makeBrowserEarlyPageRestoreRuntime = <A, E = never>(): Effect.Effect<
  BrowserEarlyPageRestoreRuntime<A, E>,
  never,
  Scope.Scope
> =>
  Effect.gen(function* () {
    const fibers = yield* FiberMap.make<number>();
    const runFiber = yield* FiberMap.runtime(fibers)();
    const state = makeRuntimeState<A, E>({
      interrupt: (guestWebContentsId) => {
        runFiber(guestWebContentsId, Effect.void);
      },
      run: (guestWebContentsId, operation) => runFiber(guestWebContentsId, operation),
    });
    yield* Effect.addFinalizer(() => Effect.sync(state.close));
    return state.runtime;
  });
