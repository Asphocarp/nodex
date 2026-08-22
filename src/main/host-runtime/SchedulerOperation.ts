import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

export class SchedulerOperationError extends Schema.TaggedError<SchedulerOperationError>()(
  "SchedulerOperationError",
  {
    operation: Schema.String,
    cause: Schema.Defect(),
  },
) {}

export const fromSchedulerPromise = <A>(
  operation: string,
  task: (signal: AbortSignal) => Promise<A>,
) =>
  Effect.tryPromise({
    try: task,
    catch: (cause) => new SchedulerOperationError({ operation, cause }),
  });
