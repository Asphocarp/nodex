import * as Context from "effect/Context";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as Ref from "effect/Ref";
import * as Scope from "effect/Scope";
import { assert, it } from "@effect/vitest";
import type { BootstrapRuntimeEvent } from "../bootstrap-events";
import {
  ElectronApp,
  type ElectronBeforeQuitDecision,
  type ElectronTerminationSignal,
} from "../platform/electron/ElectronApp";
import { program } from "./MainApp";
import { testLayer as configLayer } from "./MainConfig";
import { fromHooks, MainRuntimeError } from "./MainRuntimeLive";
import { MainShutdown, layer as shutdownLayer } from "./MainShutdown";

const fakeElectronLayer = (events: string[]) =>
  Layer.succeed(
    ElectronApp,
    ElectronApp.of({
      appPath: Effect.succeed("/tmp/nodex-test-app"),
      downloadsPath: Effect.succeed("/tmp/nodex-test-downloads"),
      isInApplicationsFolder: Effect.succeed(true),
      locale: Effect.succeed("en-US"),
      userDataPath: Effect.succeed("/tmp/nodex-test-user-data"),
      whenReady: Effect.sync(() => events.push("ready")),
      quit: Effect.sync(() => events.push("quit")),
      relaunch: Effect.sync(() => events.push("relaunch")),
      exit: (code) => Effect.sync(() => events.push(`exit:${code}`)),
      onActivate: () => Effect.void,
      onBeforeQuit: () => Effect.void,
      onOpenUrl: () => Effect.void,
      onSecondInstance: () => Effect.void,
      onTerminationSignal: () => Effect.void,
      onWindowAllClosed: () => Effect.void,
    }),
  );

it.effect("starts, replays bootstrap events, closes runtime, then quits", () =>
  Effect.gen(function* () {
    const events: string[] = [];
    const started = yield* Deferred.make<void>();
    const foundation = Layer.mergeAll(shutdownLayer, fakeElectronLayer(events), configLayer());
    const foundationScope = yield* Scope.make();
    const context = yield* Layer.buildWithScope(foundation, foundationScope);
    const shutdown = Context.get(context, MainShutdown);
    const initialEvents: readonly BootstrapRuntimeEvent[] = [
      { type: "open-url", url: "nodex://pages/one" },
      { type: "second-instance", argv: ["--new-window"] },
    ];
    const runtimeLayer = fromHooks({
      start: Effect.sync(() => events.push("start")).pipe(
        Effect.andThen(Deferred.succeed(started, undefined)),
        Effect.asVoid,
      ),
      handleBootstrapEvent: (event) =>
        Effect.sync(() => events.push(event.type === "open-url" ? `url:${event.url}` : "argv")),
      release: Effect.sync(() => events.push("release")),
    });

    const fiber = yield* program({
      initialEvents,
      runtimeLayer,
      runStartupGate: Effect.sync(() => {
        events.push("gate");
        return "continue" as const;
      }),
    }).pipe(Effect.provide(context), Effect.forkScoped);
    yield* Deferred.await(started);
    yield* shutdown.request({ _tag: "UserQuit" });
    yield* Fiber.join(fiber);

    assert.deepEqual(events, [
      "ready",
      "gate",
      "start",
      "url:nodex://pages/one",
      "argv",
      "release",
      "quit",
    ]);
    assert.isTrue(Exit.isSuccess(yield* shutdown.awaitRuntimeClosed));
    yield* Scope.close(foundationScope, Exit.void);
  }),
);

it.effect("rolls back an acquired runtime and publishes the startup failure exit", () =>
  Effect.gen(function* () {
    const events: string[] = [];
    const foundation = Layer.mergeAll(shutdownLayer, fakeElectronLayer(events), configLayer());
    const foundationScope = yield* Scope.make();
    const context = yield* Layer.buildWithScope(foundation, foundationScope);
    const shutdown = Context.get(context, MainShutdown);
    const runtimeError = new MainRuntimeError({
      operation: "startup",
      cause: new Error("failed startup"),
    });
    const runtimeLayer = fromHooks({
      start: Effect.fail(runtimeError),
      handleBootstrapEvent: () => Effect.void,
      release: Effect.sync(() => events.push("release")),
    });

    const result = yield* Effect.exit(
      program({
        initialEvents: [],
        runtimeLayer,
        runStartupGate: Effect.succeed("continue" as const),
      }).pipe(Effect.provide(context)),
    );
    assert.isTrue(Exit.isFailure(result));
    assert.deepEqual(events, ["ready", "release"]);
    assert.isTrue(Exit.isFailure(yield* shutdown.awaitRuntimeClosed));
    yield* Scope.close(foundationScope, Exit.void);
  }),
);

it.effect("relaunches only after an authority-drift shutdown has released the runtime", () =>
  Effect.gen(function* () {
    const events: string[] = [];
    const started = yield* Deferred.make<void>();
    const foundation = Layer.mergeAll(shutdownLayer, fakeElectronLayer(events), configLayer());
    const foundationScope = yield* Scope.make();
    const context = yield* Layer.buildWithScope(foundation, foundationScope);
    const shutdown = Context.get(context, MainShutdown);
    const runtimeLayer = fromHooks({
      start: Deferred.succeed(started, undefined).pipe(Effect.asVoid),
      handleBootstrapEvent: () => Effect.void,
      release: Effect.sync(() => events.push("release")),
    });
    const fiber = yield* program({
      initialEvents: [],
      runtimeLayer,
      runStartupGate: Effect.succeed("continue" as const),
    }).pipe(Effect.provide(context), Effect.forkScoped);
    yield* Deferred.await(started);
    yield* shutdown.request({ _tag: "AuthorityDriftRelaunch" });
    yield* Fiber.join(fiber);
    assert.deepEqual(events, ["ready", "release", "relaunch", "quit"]);
    yield* Scope.close(foundationScope, Exit.void);
  }),
);

it.effect("routes Electron activation through the scoped Main runtime", () =>
  Effect.gen(function* () {
    const events: string[] = [];
    const started = yield* Deferred.make<void>();
    const activate = yield* Ref.make<Effect.Effect<void> | null>(null);
    const electron = Layer.succeed(
      ElectronApp,
      ElectronApp.of({
        appPath: Effect.succeed("/tmp/nodex-test-app"),
        downloadsPath: Effect.succeed("/tmp/nodex-test-downloads"),
        isInApplicationsFolder: Effect.succeed(true),
        locale: Effect.succeed("en-US"),
        userDataPath: Effect.succeed("/tmp/nodex-test-user-data"),
        whenReady: Effect.void,
        quit: Effect.sync(() => events.push("quit")),
        relaunch: Effect.void,
        exit: () => Effect.void,
        onActivate: (handler) => Ref.set(activate, handler),
        onBeforeQuit: () => Effect.void,
        onOpenUrl: () => Effect.void,
        onSecondInstance: () => Effect.void,
        onTerminationSignal: () => Effect.void,
        onWindowAllClosed: () => Effect.void,
      }),
    );
    const foundation = Layer.mergeAll(shutdownLayer, electron, configLayer());
    const foundationScope = yield* Scope.make();
    const context = yield* Layer.buildWithScope(foundation, foundationScope);
    const shutdown = Context.get(context, MainShutdown);
    const runtimeLayer = fromHooks({
      activate: Effect.sync(() => events.push("activate")),
      start: Deferred.succeed(started, undefined).pipe(Effect.asVoid),
      handleBootstrapEvent: () => Effect.void,
      release: Effect.sync(() => events.push("release")),
    });
    const fiber = yield* program({
      initialEvents: [],
      runtimeLayer,
      runStartupGate: Effect.succeed("continue" as const),
    }).pipe(Effect.provide(context), Effect.forkScoped);
    yield* Deferred.await(started);

    const handler = yield* Ref.get(activate);
    if (handler) yield* handler;
    assert.deepEqual(events, ["activate"]);

    yield* shutdown.request({ _tag: "UserQuit" });
    yield* Fiber.join(fiber);
    assert.deepEqual(events, ["activate", "release", "quit"]);
    yield* Scope.close(foundationScope, Exit.void);
  }),
);

it.effect("routes process termination signals through Main shutdown before quitting Electron", () =>
  Effect.gen(function* () {
    const events: string[] = [];
    const started = yield* Deferred.make<void>();
    const termination = yield* Ref.make<
      ((signal: ElectronTerminationSignal) => Effect.Effect<void>) | null
    >(null);
    const electron = Layer.succeed(
      ElectronApp,
      ElectronApp.of({
        appPath: Effect.succeed("/tmp/nodex-test-app"),
        downloadsPath: Effect.succeed("/tmp/nodex-test-downloads"),
        isInApplicationsFolder: Effect.succeed(true),
        locale: Effect.succeed("en-US"),
        userDataPath: Effect.succeed("/tmp/nodex-test-user-data"),
        whenReady: Effect.void,
        quit: Effect.sync(() => events.push("quit")),
        relaunch: Effect.void,
        exit: () => Effect.void,
        onActivate: () => Effect.void,
        onBeforeQuit: () => Effect.void,
        onOpenUrl: () => Effect.void,
        onSecondInstance: () => Effect.void,
        onTerminationSignal: (handler) => Ref.set(termination, handler),
        onWindowAllClosed: () => Effect.void,
      }),
    );
    const foundation = Layer.mergeAll(shutdownLayer, electron, configLayer());
    const foundationScope = yield* Scope.make();
    const context = yield* Layer.buildWithScope(foundation, foundationScope);
    const shutdown = Context.get(context, MainShutdown);
    const runtimeLayer = fromHooks({
      start: Deferred.succeed(started, undefined).pipe(Effect.asVoid),
      handleBootstrapEvent: () => Effect.void,
      release: Effect.sync(() => events.push("release")),
    });
    const fiber = yield* program({
      initialEvents: [],
      runtimeLayer,
      runStartupGate: Effect.succeed("continue" as const),
    }).pipe(Effect.provide(context), Effect.forkScoped);
    yield* Deferred.await(started);

    const handler = yield* Ref.get(termination);
    if (handler) yield* handler("SIGINT");
    yield* Fiber.join(fiber);

    assert.deepEqual(yield* shutdown.awaitRequest, { _tag: "Signal", signal: "SIGINT" });
    assert.deepEqual(events, ["release", "quit"]);
    yield* Scope.close(foundationScope, Exit.void);
  }),
);

it.effect("defers a system-owned quit without closing the Main runtime", () =>
  Effect.gen(function* () {
    const events: string[] = [];
    const started = yield* Deferred.make<void>();
    const beforeQuit = yield* Ref.make<(() => ElectronBeforeQuitDecision) | null>(null);
    const electron = Layer.succeed(
      ElectronApp,
      ElectronApp.of({
        appPath: Effect.succeed("/tmp/nodex-test-app"),
        downloadsPath: Effect.succeed("/tmp/nodex-test-downloads"),
        isInApplicationsFolder: Effect.succeed(true),
        locale: Effect.succeed("en-US"),
        userDataPath: Effect.succeed("/tmp/nodex-test-user-data"),
        whenReady: Effect.void,
        quit: Effect.sync(() => events.push("quit")),
        relaunch: Effect.void,
        exit: () => Effect.void,
        onActivate: () => Effect.void,
        onBeforeQuit: (handler) => Ref.set(beforeQuit, handler),
        onOpenUrl: () => Effect.void,
        onSecondInstance: () => Effect.void,
        onTerminationSignal: () => Effect.void,
        onWindowAllClosed: () => Effect.void,
      }),
    );
    const foundation = Layer.mergeAll(shutdownLayer, electron, configLayer());
    const foundationScope = yield* Scope.make();
    const context = yield* Layer.buildWithScope(foundation, foundationScope);
    const shutdown = Context.get(context, MainShutdown);
    const runtimeLayer = fromHooks({
      start: Deferred.succeed(started, undefined).pipe(Effect.asVoid),
      prepareQuit: Effect.sync(() => {
        events.push("defer");
        return "defer" as const;
      }),
      handleBootstrapEvent: () => Effect.void,
      release: Effect.sync(() => events.push("release")),
    });
    const fiber = yield* program({
      initialEvents: [],
      runtimeLayer,
      runStartupGate: Effect.succeed("continue" as const),
    }).pipe(Effect.provide(context), Effect.forkScoped);
    yield* Deferred.await(started);

    const handler = yield* Ref.get(beforeQuit);
    const decision = handler?.();
    assert.isTrue(decision?.preventDefault);
    if (decision) yield* decision.task;
    assert.deepEqual(events, ["defer"]);

    yield* shutdown.request({ _tag: "UserQuit" });
    yield* Fiber.join(fiber);
    assert.deepEqual(events, ["defer", "release", "quit"]);
    yield* Scope.close(foundationScope, Exit.void);
  }),
);
