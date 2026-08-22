import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Layer from "effect/Layer";
import * as Scope from "effect/Scope";
import { assert, it } from "@effect/vitest";
import {
  ScopedCallbackRuntime,
  layer as scopedCallbackRuntimeLive,
} from "../app/ScopedCallbackRuntime";
import {
  makeCodexThreadHandoffRuntimePromiseAdapter,
  type CodexThreadHandoffPromiseEffects,
} from "./CodexThreadHandoffRuntimePromiseAdapter";
import {
  CodexThreadHandoffRuntime,
  type CodexThreadHandoffEffects,
} from "./CodexThreadHandoffRuntime";

const makePromiseLatch = (): { readonly promise: Promise<void>; readonly resolve: () => void } => {
  let resolve = (): void => undefined;
  const promise = new Promise<void>((resume) => {
    resolve = resume;
  });
  return { promise, resolve };
};

it.effect("aborts an admitted Promise effect when the callback Scope closes", () =>
  Effect.gen(function* () {
    const scope = yield* Scope.make();
    const callbackContext = yield* Layer.buildWithScope(scopedCallbackRuntimeLive, scope);
    const started = makePromiseLatch();
    const aborted = makePromiseLatch();
    const runtime = CodexThreadHandoffRuntime.of({
      start: (_input, effects: CodexThreadHandoffEffects) =>
        effects.resolveSource("thread-1").pipe(Effect.andThen(Effect.never)) as never,
      recover: () => Effect.die(new Error("Unexpected recover")),
      launch: () => Effect.die(new Error("Unexpected launch")),
      get: () => Effect.die(new Error("Unexpected get")),
      waitForRevision: () => Effect.die(new Error("Unexpected waitForRevision")),
    });
    const adapter = makeCodexThreadHandoffRuntimePromiseAdapter(
      runtime,
      Context.get(callbackContext, ScopedCallbackRuntime),
    );
    const unexpected = (): never => {
      throw new Error("Unexpected handoff effect");
    };
    const effects: CodexThreadHandoffPromiseEffects = {
      resolveSource: (_threadId, signal) => {
        started.resolve();
        return new Promise((_resolve, reject) => {
          signal.addEventListener(
            "abort",
            () => {
              aborted.resolve();
              reject(signal.reason);
            },
            { once: true },
          );
        });
      },
      readCanonicalLocation: unexpected,
      stopActiveTurn: unexpected,
      prepareDestination: unexpected,
      switchRuntime: unexpected,
      commitLocation: unexpected,
      projectLocation: unexpected,
      transferOwner: unexpected,
      cleanup: unexpected,
      rollbackPreparation: unexpected,
      sendFollowUp: unexpected,
    };

    const operation = adapter.start(
      {
        operationId: "operation-1",
        threadId: "thread-1",
        destinationHostId: null,
        followUpPrompt: null,
      },
      effects,
    );
    yield* Effect.promise(() => started.promise);
    yield* Scope.close(scope, Exit.void);
    yield* Effect.promise(() => aborted.promise);
    const rejected = yield* Effect.promise(() =>
      operation.then(
        () => false,
        () => true,
      ),
    );

    assert.isTrue(rejected);
  }),
);
