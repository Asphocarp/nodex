import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as SubscriptionRef from "effect/SubscriptionRef";
import type { CodexPersonality } from "../../shared/types";
import { parseCodexPersonality } from "./CodexPersonality";

export class CodexPreferencesError extends Schema.TaggedError<CodexPreferencesError>()(
  "CodexPreferencesError",
  { operation: Schema.String, cause: Schema.Defect() },
) {}

export class CodexPreferences extends Context.Service<
  CodexPreferences,
  {
    readonly snapshot: SubscriptionRef.SubscriptionRef<CodexPersonality>;
    readonly current: () => CodexPersonality;
    readonly setPersonality: (
      personality: CodexPersonality,
    ) => Effect.Effect<void, CodexPreferencesError>;
  }
>()("nodex/main/codex-application/CodexPreferences") {}

export const live: Layer.Layer<CodexPreferences> = Layer.effect(
  CodexPreferences,
  Effect.gen(function* () {
    let current: CodexPersonality = "friendly";
    const snapshot = yield* SubscriptionRef.make<CodexPersonality>(current);
    return CodexPreferences.of({
      snapshot,
      current: () => current,
      setPersonality: (personality) => {
        const parsed = parseCodexPersonality(personality);
        if (parsed === null) {
          return Effect.fail(
            new CodexPreferencesError({
              operation: "set-personality",
              cause: new Error(`Unsupported Codex personality: ${String(personality)}`),
            }),
          );
        }
        return Effect.sync(() => {
          current = parsed;
        }).pipe(Effect.andThen(SubscriptionRef.set(snapshot, parsed)));
      },
    });
  }),
);
