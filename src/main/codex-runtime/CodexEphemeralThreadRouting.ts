import * as Context from "effect/Context";
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Ref from "effect/Ref";

export class CodexEphemeralThreadRoutingError extends Data.TaggedError(
  "CodexEphemeralThreadRoutingError",
)<{
  readonly threadId: string;
  readonly hostId: string;
}> {}

export class CodexEphemeralThreadRouting extends Context.Service<
  CodexEphemeralThreadRouting,
  {
    readonly resolve: (threadId: string) => Effect.Effect<string | null>;
    readonly register: (
      threadId: string,
      hostId: string,
    ) => Effect.Effect<void, CodexEphemeralThreadRoutingError>;
    readonly remove: (threadId: string) => Effect.Effect<void>;
  }
>()("nodex/main/codex-runtime/CodexEphemeralThreadRouting") {}

export const live: Layer.Layer<CodexEphemeralThreadRouting> = Layer.effect(
  CodexEphemeralThreadRouting,
  Effect.gen(function* () {
    const routes = yield* Ref.make<ReadonlyMap<string, string>>(new Map());
    yield* Effect.addFinalizer(() => Ref.set(routes, new Map()));

    return CodexEphemeralThreadRouting.of({
      resolve: (threadId) =>
        Ref.get(routes).pipe(Effect.map((current) => current.get(threadId.trim()) ?? null)),
      register: (threadId, hostId) => {
        const normalizedThreadId = threadId.trim();
        const normalizedHostId = hostId.trim();
        if (!normalizedThreadId || !normalizedHostId) {
          return Effect.fail(new CodexEphemeralThreadRoutingError({ threadId, hostId }));
        }
        return Ref.update(routes, (current) => {
          const next = new Map(current);
          next.set(normalizedThreadId, normalizedHostId);
          return next;
        });
      },
      remove: (threadId) =>
        Ref.update(routes, (current) => {
          const normalizedThreadId = threadId.trim();
          if (!current.has(normalizedThreadId)) return current;
          const next = new Map(current);
          next.delete(normalizedThreadId);
          return next;
        }),
    });
  }),
);
