import * as Context from "effect/Context";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as Ref from "effect/Ref";
import * as Result from "effect/Result";
import { assert, it } from "@effect/vitest";
import { CoreModules, type CoreModuleClients } from "../core-runtime/CoreModules";
import { TerminalProjectAdmission, live } from "./TerminalProjectAdmission";

const coreLayer = (input?: { readonly lifecycle?: "active" | "archived" | "removed" }) =>
  Layer.succeed(
    CoreModules,
    CoreModules.of({
      workspace: {
        read: (read: { readonly kind: string }) => {
          if (read.kind === "session") {
            return Effect.succeed({
              value: { kind: "session", session: { project_id: "project-a" } },
            });
          }
          if (read.kind === "thread") {
            return Effect.succeed({
              value: { kind: "thread", thread: { project_id: "project-a" } },
            });
          }
          return Effect.succeed({
            value: {
              kind: "project",
              project: { lifecycle: input?.lifecycle ?? "active" },
            },
          });
        },
      },
    } as unknown as CoreModuleClients),
  );

const request = {
  sessionId: "terminal-a",
  conversationId: "thread-a",
  projectSessionId: "session-a",
  size: { cols: 80, rows: 24 },
} as const;

it.effect("serializes terminal admission with project lifecycle transitions", () =>
  Effect.gen(function* () {
    const context = yield* Layer.build(live.pipe(Layer.provide(coreLayer())));
    const admission = Context.get(context, TerminalProjectAdmission);
    const active = yield* Ref.make(0);
    const maximum = yield* Ref.make(0);
    const firstEntered = yield* Deferred.make<void>();
    const releaseFirst = yield* Deferred.make<void>();
    const operation = (wait: boolean) =>
      Ref.updateAndGet(active, (value) => value + 1).pipe(
        Effect.tap((value) => Ref.update(maximum, (current) => Math.max(current, value))),
        Effect.tap(() => Deferred.succeed(firstEntered, undefined)),
        Effect.andThen(wait ? Deferred.await(releaseFirst) : Effect.void),
        Effect.ensuring(Ref.update(active, (value) => value - 1)),
      );
    const first = yield* admission.run(request, operation(true)).pipe(Effect.forkChild);
    yield* Deferred.await(firstEntered);
    const second = yield* admission.run(request, operation(false)).pipe(Effect.forkChild);
    yield* Effect.yieldNow;
    assert.strictEqual(yield* Ref.get(active), 1);
    yield* Deferred.succeed(releaseFirst, undefined);
    yield* Fiber.join(first);
    yield* Fiber.join(second);
    assert.strictEqual(yield* Ref.get(maximum), 1);
  }),
);

it.effect("rejects terminal creation for a non-active project", () =>
  Effect.gen(function* () {
    const context = yield* Layer.build(
      live.pipe(Layer.provide(coreLayer({ lifecycle: "archived" }))),
    );
    const result = yield* Context.get(context, TerminalProjectAdmission)
      .run(request, Effect.void)
      .pipe(Effect.result);
    assert.isTrue(Result.isFailure(result));
    if (Result.isFailure(result)) assert.strictEqual(result.failure.operation, "inactive-project");
  }),
);
