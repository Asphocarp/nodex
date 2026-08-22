import * as Effect from "effect/Effect";
import * as FiberMap from "effect/FiberMap";
import type * as Scope from "effect/Scope";

export interface BrowserEarlyPageRestoreLease {
  readonly isActive: () => boolean;
}

export interface BrowserEarlyPageRestoreResult<A> extends BrowserEarlyPageRestoreLease {
  readonly promise: Promise<A>;
}

export interface BrowserEarlyPageRestoreRuntime<A> {
  readonly release: (guestWebContentsId: number) => void;
  readonly result: (guestWebContentsId: number) => BrowserEarlyPageRestoreResult<A> | null;
  readonly start: (
    guestWebContentsId: number,
    operation: (lease: BrowserEarlyPageRestoreLease) => Promise<A>,
  ) => boolean;
}

interface RestoreEntry<A> {
  cancelResult: () => void;
  readonly generation: symbol;
  result: BrowserEarlyPageRestoreResult<A> | null;
}

interface RestoreExecution {
  readonly interrupt: (guestWebContentsId: number) => void;
  readonly run: <A>(guestWebContentsId: number, operation: () => Promise<A>) => Promise<A>;
}

function makeRuntimeState<A>(execution: RestoreExecution): {
  readonly close: () => void;
  readonly runtime: BrowserEarlyPageRestoreRuntime<A>;
} {
  let accepting = true;
  const entries = new Map<number, RestoreEntry<A>>();

  const release = (guestWebContentsId: number): void => {
    const entry = entries.get(guestWebContentsId);
    if (!entry) return;
    entries.delete(guestWebContentsId);
    entry.cancelResult();
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
        const entry: RestoreEntry<A> = {
          cancelResult: () => undefined,
          generation,
          result: null,
        };
        entries.set(guestWebContentsId, entry);
        const lease: BrowserEarlyPageRestoreLease = {
          isActive: () => accepting && entries.get(guestWebContentsId)?.generation === generation,
        };
        const physical = execution.run(guestWebContentsId, () => operation(lease));
        const promise = new Promise<A>((resolve, reject) => {
          let settled = false;
          entry.cancelResult = () => {
            if (settled) return;
            settled = true;
            reject(new Error("Browser early page restore was released"));
          };
          void physical.then(
            (value) => {
              if (settled) return;
              settled = true;
              resolve(value);
            },
            (error: unknown) => {
              if (settled) return;
              settled = true;
              reject(error);
            },
          );
        });
        entry.result = { isActive: lease.isActive, promise };
        void promise.catch(() => undefined);
        return true;
      },
    },
  };
}

/** Test-only adapter for BrowserSidebarService's synchronous fake WebContents. */
export const makeBrowserEarlyPageRestoreRuntimeUnsafe = <A>(): BrowserEarlyPageRestoreRuntime<A> =>
  makeRuntimeState<A>({
    interrupt: () => undefined,
    run: (_guestWebContentsId, operation) => operation(),
  }).runtime;

/** Owns every pre-navigation Browser history restore under the Sidebar Scope. */
export const makeBrowserEarlyPageRestoreRuntime = <A>(): Effect.Effect<
  BrowserEarlyPageRestoreRuntime<A>,
  never,
  Scope.Scope
> =>
  Effect.gen(function* () {
    const fibers = yield* FiberMap.make<number>();
    const runFiber = yield* FiberMap.runtime(fibers)();
    const runPromise = yield* FiberMap.runtimePromise(fibers)();
    const state = makeRuntimeState<A>({
      interrupt: (guestWebContentsId) => {
        runFiber(guestWebContentsId, Effect.void);
      },
      run: (guestWebContentsId, operation) =>
        runPromise(guestWebContentsId, Effect.promise(operation)),
    });
    yield* Effect.addFinalizer(() => Effect.sync(state.close));
    return state.runtime;
  });
