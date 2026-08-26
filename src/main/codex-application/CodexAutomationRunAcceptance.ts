import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { CoreModules } from "../core-runtime/CoreModules";
import { createOperationId } from "../core-runtime/operation-identity";
import { CodexApplicationEventHub } from "./CodexApplicationEventHub";

export class CodexAutomationRunAcceptanceError extends Schema.TaggedError<CodexAutomationRunAcceptanceError>()(
  "CodexAutomationRunAcceptanceError",
  {
    threadId: Schema.String,
    cause: Schema.Defect(),
  },
) {}

export class CodexAutomationRunAcceptance extends Context.Service<
  CodexAutomationRunAcceptance,
  {
    readonly accept: (
      threadId: string,
    ) => Effect.Effect<boolean, CodexAutomationRunAcceptanceError>;
  }
>()("nodex/main/codex-application/CodexAutomationRunAcceptance") {}

/** Accepts an automation run exactly when a user continuation becomes a protocol fact. */
export const make: Effect.Effect<
  CodexAutomationRunAcceptance["Service"],
  never,
  CodexApplicationEventHub | CoreModules
> = Effect.gen(function* () {
  const core = yield* CoreModules;
  const events = yield* CodexApplicationEventHub;
  return CodexAutomationRunAcceptance.of({
    accept: (threadId) =>
      Effect.gen(function* () {
        const snapshot = yield* core.automation.read({ kind: "run", thread_id: threadId });
        if (snapshot.value.kind !== "run") {
          return yield* new CodexAutomationRunAcceptanceError({
            threadId,
            cause: new Error("Core returned the wrong Automation run read variant"),
          });
        }
        const run = snapshot.value.item;
        if (!run) return false;
        yield* core.automation.apply({
          operationId: createOperationId("automation-run.accept"),
          intent: {
            kind: "accept_run",
            thread_id: threadId,
            expected_revision: run.run_revision,
          },
        });
        events.publish({
          kind: "codex",
          value: {
            type: "automationRunsUpdated",
            event: {
              automationId: run.automation_id,
              threadId,
              reason: "accepted",
            },
          },
        });
        return true;
      }).pipe(
        Effect.mapError((cause) =>
          cause instanceof CodexAutomationRunAcceptanceError
            ? cause
            : new CodexAutomationRunAcceptanceError({ threadId, cause }),
        ),
      ),
  });
});
