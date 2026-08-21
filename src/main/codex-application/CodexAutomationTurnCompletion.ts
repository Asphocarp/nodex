import type { Turn } from "@nodex/codex-app-server-protocol/v2";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { parseCodexAutomationInboxItemDirective } from "../codex-scheduled-automation-runtime";
import { AutomationRoutingIndex } from "../core-runtime/AutomationRoutingIndex";
import { CoreModules } from "../core-runtime/CoreModules";
import { CodexApplicationEventHub } from "./CodexApplicationEventHub";

const BACKGROUND_CORE_REQUEST = { class: "background" } as const;

export class CodexAutomationTurnCompletion extends Context.Service<
  CodexAutomationTurnCompletion,
  {
    readonly complete: (threadId: string, turn: Turn) => Effect.Effect<boolean>;
  }
>()("nodex/main/codex-application/CodexAutomationTurnCompletion") {}

const directive = (turn: Turn) => {
  const markdown = [...turn.items]
    .reverse()
    .find((item) => item.type === "agentMessage")
    ?.text.trim();
  return markdown ? parseCodexAutomationInboxItemDirective(markdown) : null;
};

/** Commits the terminal Turn consequence into the canonical Automation Run. */
export const live: Layer.Layer<
  CodexAutomationTurnCompletion,
  never,
  AutomationRoutingIndex | CodexApplicationEventHub | CoreModules
> = Layer.effect(
  CodexAutomationTurnCompletion,
  Effect.gen(function* () {
    const routing = yield* AutomationRoutingIndex;
    const events = yield* CodexApplicationEventHub;
    const core = yield* CoreModules;
    return CodexAutomationTurnCompletion.of({
      complete: (threadId, turn) =>
        Effect.gen(function* () {
          const snapshot = yield* core.automation.read(
            { kind: "run", thread_id: threadId },
            BACKGROUND_CORE_REQUEST,
          );
          if (snapshot.value.kind !== "run") {
            return yield* Effect.die(
              new Error("Core returned the wrong Automation Run read variant"),
            );
          }
          const current = snapshot.value.item;
          if (!current) return false;
          const inbox = directive(turn);
          const committed = yield* core.automation.apply(
            {
              operationId: `codex:automation-turn-completed:${threadId}:${turn.id}`,
              intent: {
                kind: "complete_run_for_review",
                thread_id: threadId,
                expected_revision: current.run_revision,
                inbox_title: inbox?.title ?? null,
                inbox_summary: inbox?.summary ?? null,
              },
            },
            BACKGROUND_CORE_REQUEST,
          );
          const run = committed.outcome.runs.find((candidate) => candidate.thread_id === threadId);
          if (!run) {
            return yield* Effect.die(
              new Error("Core Automation completion omitted its updated Run"),
            );
          }
          routing.commit({ runs: { upsert: [run] } });
          events.publish({
            kind: "codex",
            value: {
              type: "automationRunsUpdated",
              event: {
                automationId: run.automation_id,
                threadId,
                reason: "turn-completed",
              },
            },
          });
          return true;
        }).pipe(
          Effect.catchCause((cause) =>
            Effect.logWarning("Could not complete Codex Automation Run").pipe(
              Effect.annotateLogs({ cause, threadId, turnId: turn.id }),
              Effect.as(false),
            ),
          ),
        ),
    });
  }),
);
