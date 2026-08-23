import * as Schema from "effect/Schema";

export class SchedulerOperationError extends Schema.TaggedError<SchedulerOperationError>()(
  "SchedulerOperationError",
  {
    operation: Schema.String,
    cause: Schema.Defect(),
  },
) {}
