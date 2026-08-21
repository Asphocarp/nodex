import * as Cause from "effect/Cause";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Logger from "effect/Logger";
import { randomUUID } from "node:crypto";
import { getLogger, shutdownBackendLogger, type BackendLogger } from "../logging/logger";
import { captureMainException, shutdownMainSentry } from "../observability/sentry-main";

export class MainObservability extends Context.Service<
  MainObservability,
  {
    readonly backend: BackendLogger;
    readonly captureDefect: (cause: unknown, operation: string) => Effect.Effect<void>;
    readonly runId: string;
  }
>()("nodex/main/app/MainObservability") {}

const toMessage = (message: unknown): string => {
  if (Array.isArray(message)) return message.map(String).join(" ");
  return String(message);
};

const backendEffectLogger = (backend: BackendLogger) =>
  Logger.make<unknown, void>((options) => {
    const fields = Cause.hasFails(options.cause)
      ? { causeKind: "failure" }
      : Cause.hasInterruptsOnly(options.cause)
        ? { causeKind: "interruption" }
        : {};
    const message = toMessage(options.message);
    const level = String(options.logLevel).toLowerCase();
    if (level.includes("trace")) return backend.trace(message, fields);
    if (level.includes("debug")) return backend.debug(message, fields);
    if (level.includes("warn")) return backend.warn(message, fields);
    if (level.includes("error") || level.includes("fatal")) return backend.error(message, fields);
    return backend.info(message, fields);
  });

export const layer: Layer.Layer<MainObservability> = Layer.unwrap(
  Effect.sync(() => {
    const runId = randomUUID();
    const backend = getLogger({ subsystem: "main-kernel", runId });
    const service = Layer.effect(
      MainObservability,
      Effect.gen(function* () {
        yield* Effect.addFinalizer(() =>
          Effect.tryPromise(() =>
            Promise.all([shutdownBackendLogger(), shutdownMainSentry()]),
          ).pipe(Effect.asVoid, Effect.orDie),
        );
        return MainObservability.of({
          backend,
          runId,
          captureDefect: Effect.fn("MainObservability.captureDefect")(
            (cause: unknown, operation: string) =>
              Effect.sync(() => {
                backend.error("Unexpected Main runtime defect", { cause, operation });
                captureMainException(cause, { tags: { operation, runtime: "main-kernel" } });
              }),
          ),
        });
      }),
    );
    return Layer.merge(service, Logger.layer([backendEffectLogger(backend)]));
  }),
);
