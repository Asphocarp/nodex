import * as Cause from "effect/Cause";
import * as Schema from "effect/Schema";
import type { MainShutdownReason } from "./MainShutdown";

export const MainApplicationPhase = Schema.Literals(["pre-ready", "startup", "runtime", "closing"]);

export type MainApplicationPhase = typeof MainApplicationPhase.Type;

/** The single typed failure crossing the Main application lifecycle boundary. */
export class MainApplicationError extends Schema.TaggedError<MainApplicationError>()(
  "MainApplicationError",
  {
    phase: MainApplicationPhase,
    operation: Schema.String,
    cause: Schema.Defect(),
  },
) {}

export interface CleanupFailure {
  readonly operation: string;
  readonly reason: string;
  readonly subsystem: string;
}

export interface CleanupReport {
  readonly failures: readonly CleanupFailure[];
}

export const emptyCleanupReport: CleanupReport = { failures: [] };

export type MainExit =
  | {
      readonly _tag: "Shutdown";
      readonly reason: MainShutdownReason;
      readonly cleanup: CleanupReport;
    }
  | {
      readonly _tag: "Failure";
      readonly phase: MainApplicationPhase;
      readonly cause: Cause.Cause<MainApplicationError>;
    };
