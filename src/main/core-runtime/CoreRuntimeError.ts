import * as Schema from "effect/Schema";
import {
  CoreEventCompatibilityError,
  CoreHttpError,
  isDefinitiveCoreGenerationLoss,
} from "../core-client/uds-http";

export const CoreRuntimeFailureReason = Schema.Literals([
  "launch",
  "health",
  "transport-loss",
  "stream-ended",
  "delivery",
  "resync",
  "authority-drift",
  "protocol",
  "closed",
  "operation",
]);

export type CoreRuntimeFailureReason = typeof CoreRuntimeFailureReason.Type;

/** A safe policy error. The exact cause stays in the Cause tree, never in the message. */
export class CoreRuntimeError extends Schema.TaggedError<CoreRuntimeError>()("CoreRuntimeError", {
  message: Schema.String,
  operation: Schema.String,
  reason: CoreRuntimeFailureReason,
  retryable: Schema.Boolean,
  generation: Schema.optionalKey(Schema.String),
  cause: Schema.optionalKey(Schema.Defect()),
}) {}

export const coreRuntimeError = (input: {
  readonly operation: string;
  readonly reason: CoreRuntimeFailureReason;
  readonly retryable: boolean;
  readonly generation?: string;
  readonly cause?: unknown;
}): CoreRuntimeError =>
  new CoreRuntimeError({
    message: `Native Core ${input.operation} failed`,
    operation: input.operation,
    reason: input.reason,
    retryable: input.retryable,
    ...(input.generation === undefined ? {} : { generation: input.generation }),
    ...(input.cause === undefined ? {} : { cause: input.cause }),
  });

export const isRecoverableCoreTransportFailure = (cause: unknown): boolean =>
  isDefinitiveCoreGenerationLoss(cause) || (cause instanceof CoreHttpError && cause.status === 503);

export const classifyCoreOperationFailure = (
  operation: string,
  cause: unknown,
  generation?: string,
): CoreRuntimeError => {
  if (Schema.is(CoreRuntimeError)(cause)) return cause;
  if (cause instanceof CoreEventCompatibilityError) {
    return coreRuntimeError({ operation, reason: "protocol", retryable: false, generation, cause });
  }
  if (isRecoverableCoreTransportFailure(cause)) {
    return coreRuntimeError({
      operation,
      reason: "transport-loss",
      retryable: true,
      generation,
      cause,
    });
  }
  return coreRuntimeError({ operation, reason: "operation", retryable: false, generation, cause });
};
