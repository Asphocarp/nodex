import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import type { ScopedCallbackRuntime } from "../app/ScopedCallbackRuntime";
import {
  ComputerUseRuntimeCoordinator,
  type ComputerUseRuntimeResult,
} from "../codex/computer-use-runtime";
import type { ComputerUseRuntimeConfigInput } from "../codex/computer-use-runtime-config";
import type { BrowserRuntimeAvailability } from "../codex/browser-runtime-bundle";
import type { BrowserUsePeerAuthorizationMode } from "../../shared/browser-use-host-capability";

export class ComputerUseRuntimeError extends Schema.TaggedError<ComputerUseRuntimeError>()(
  "ComputerUseRuntimeError",
  { operation: Schema.String, cause: Schema.Defect() },
) {}

export class ComputerUseRuntime extends Context.Service<
  ComputerUseRuntime,
  {
    readonly current: () => ComputerUseRuntimeResult | null;
    readonly ensureReady: Effect.Effect<ComputerUseRuntimeResult, ComputerUseRuntimeError>;
  }
>()("nodex/main/host-runtime/ComputerUseRuntime") {}

interface ComputerUseRuntimeCoordinatorPort {
  readonly dispose: () => Promise<void>;
  readonly ensureReady: () => Promise<ComputerUseRuntimeResult>;
  readonly getResult: () => ComputerUseRuntimeResult | null;
}

const fromCoordinator = (
  coordinator: ComputerUseRuntimeCoordinatorPort,
): Layer.Layer<ComputerUseRuntime> =>
  Layer.effect(
    ComputerUseRuntime,
    Effect.gen(function* () {
      yield* Effect.addFinalizer(() =>
        Effect.tryPromise({
          try: () => coordinator.dispose(),
          catch: (cause) => new ComputerUseRuntimeError({ operation: "dispose", cause }),
        }).pipe(Effect.orDie),
      );
      return ComputerUseRuntime.of({
        current: () => coordinator.getResult(),
        ensureReady: Effect.tryPromise({
          try: () => coordinator.ensureReady(),
          catch: (cause) => new ComputerUseRuntimeError({ operation: "ensure-ready", cause }),
        }),
      });
    }),
  );

export interface ComputerUseRuntimeOptions {
  readonly browserRuntime: BrowserRuntimeAvailability;
  readonly peerAuthorizationMode: BrowserUsePeerAuthorizationMode;
  readonly runtimeConfig?: () => ComputerUseRuntimeConfigInput;
  readonly runtimeStateHome: string;
}

export const live = (options: ComputerUseRuntimeOptions): Layer.Layer<ComputerUseRuntime> =>
  fromCoordinator(new ComputerUseRuntimeCoordinator(options));

/** Temporary outer adapter for the legacy application class; the Effect Scope remains the owner. */
export interface ComputerUseRuntimePromiseAdapter {
  readonly current: () => ComputerUseRuntimeResult | null;
  readonly ensureReady: () => Promise<ComputerUseRuntimeResult>;
}

export const makeComputerUseRuntimePromiseAdapter = (
  runtime: ComputerUseRuntime["Service"],
  callbacks: ScopedCallbackRuntime["Service"],
): ComputerUseRuntimePromiseAdapter => ({
  current: runtime.current,
  ensureReady: () => callbacks.runPromise(runtime.ensureReady),
});

export const testLayer = fromCoordinator;
