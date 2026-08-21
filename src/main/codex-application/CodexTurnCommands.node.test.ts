import type { TurnStartResponse } from "@nodex/codex-app-server-protocol/v2";
import { CodexAppServerRequestError } from "@nodex/effect-codex-app-server/errors";
import { assert, it } from "@effect/vitest";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Layer from "effect/Layer";
import * as Scope from "effect/Scope";
import { CodexGateway } from "../codex-runtime/CodexGateway";
import { codexRuntimeError } from "../codex-runtime/CodexRuntimeError";
import { CoreModules, type CoreModuleClients } from "../core-runtime/CoreModules";
import { ProjectRuntimeLifecycleRuntime } from "../host-runtime/ProjectRuntimeLifecycleRuntime";
import { CodexAutomationRunAcceptance } from "./CodexAutomationRunAcceptance";
import { CodexConversationMaterialization } from "./CodexConversationMaterialization";
import { CodexConversationProjection } from "./CodexConversationProjection";
import { CodexTurnAuthority } from "./CodexTurnAuthority";
import { make, type CodexTurnCommandsService } from "./CodexTurnCommands";
import { CodexTurnPreparation, type CodexTurnStartPlan } from "./CodexTurnPreparation";
import {
  ConversationRuntimeMap,
  live as conversationRuntimeMapLive,
} from "./ConversationRuntimeMap";

const response = (): TurnStartResponse =>
  ({
    turn: {
      id: "turn-accepted",
      status: "inProgress",
      items: [{ id: "item-user", type: "userMessage", content: [] }],
    },
  }) as unknown as TurnStartResponse;

const missingThread = () =>
  codexRuntimeError({
    operation: "gateway.request",
    reason: "request",
    retryable: false,
    hostId: "local",
    method: "turn/start",
    cause: new CodexAppServerRequestError({
      code: -32600,
      errorMessage: "thread not found: thread-a",
    }),
  });

const plan = (attempt: number): CodexTurnStartPlan =>
  ({
    threadId: "thread-a",
    projectId: null,
    request: { threadId: "thread-a", input: [] },
    canonicalParams: { clientUserMessageId: `client-${attempt}` },
    currentCollaborationModel: "gpt-test",
    settings: {},
    permissionContext: {},
    clientUserMessageId: `client-${attempt}`,
    rendererOwnsState: false,
    verifiedBuiltinFullAccess: false,
    promptText: "ship",
    startedAtMs: attempt,
  }) as unknown as CodexTurnStartPlan;

const makeHarness = (input: {
  readonly request: (
    attempt: number,
  ) => Effect.Effect<TurnStartResponse, ReturnType<typeof missingThread>>;
  readonly failAcceptedProjection?: boolean;
}) =>
  Effect.gen(function* () {
    const scope = yield* Scope.make();
    const events: string[] = [];
    let requests = 0;
    let preparations = 0;
    const gateway = CodexGateway.of({
      localHostId: "local",
      requestRawOnHost: () => Effect.die("unused"),
      requestForThread: ((_threadId: string, method: string) => {
        if (method !== "turn/start") return Effect.die(`unexpected method: ${method}`);
        requests += 1;
        events.push(`request:${requests}`);
        return input.request(requests);
      }) as CodexGateway["Service"]["requestForThread"],
    } as unknown as CodexGateway["Service"]);
    const materialization = CodexConversationMaterialization.of({
      ensure: () => Effect.sync(() => events.push("ensure")),
      reload: () => Effect.sync(() => events.push("reload")),
    });
    const preparation = CodexTurnPreparation.of({
      start: () =>
        Effect.sync(() => {
          preparations += 1;
          events.push(`prepare:${preparations}`);
          return plan(preparations);
        }),
      steer: () => Effect.die("unused"),
    });
    const projection = CodexConversationProjection.of({
      configureTurn: () => Effect.sync(() => events.push("configure")),
      admitTurn: () => Effect.sync(() => events.push("admit")),
      markThreadActive: () => Effect.sync(() => events.push("active")),
      acceptTurn: () =>
        input.failAcceptedProjection
          ? Effect.fail({ _tag: "projection-failed" } as never)
          : Effect.sync(() => events.push("accept")),
      rejectTurn: () => Effect.sync(() => events.push("reject")),
      reconcileThreadStatus: () => Effect.sync(() => events.push("idle")),
    } as unknown as CodexConversationProjection["Service"]);
    const authority = CodexTurnAuthority.of({
      begin: () => Effect.sync(() => (events.push("authority:begin"), null)),
      bind: () => Effect.sync(() => events.push("authority:bind")),
      observeStarted: () => Effect.die("unused"),
      capture: () => Effect.die("unused"),
      inherit: () => Effect.die("unused"),
      abort: () => events.push("authority:abort"),
    });
    const automation = CodexAutomationRunAcceptance.of({
      accept: () => Effect.sync(() => (events.push("automation:accept"), true)),
    });
    const conversationsContext = yield* Layer.buildWithScope(conversationRuntimeMapLive, scope);
    const conversations = Context.get(conversationsContext, ConversationRuntimeMap);
    const aggregate = conversations.conversation("thread-a");
    aggregate.appendQueuedFollowUp(
      {
        followUpId: "follow-up:paused",
        threadId: "thread-a",
        prompt: "later",
        createdAt: 1,
        collaborationMode: null,
        serviceTier: null,
        pausedReason: "wait",
      },
      true,
    );
    const projectLifecycle = ProjectRuntimeLifecycleRuntime.of({
      runExclusive: (_projectId, operation) => operation,
    });
    const core = CoreModules.of({
      workspace: {
        read: () => Effect.die("unused"),
        apply: () => Effect.die("unused"),
      },
    } as unknown as CoreModuleClients);
    const commands: CodexTurnCommandsService = yield* make.pipe(
      Effect.provideService(CodexAutomationRunAcceptance, automation),
      Effect.provideService(CodexConversationMaterialization, materialization),
      Effect.provideService(CodexConversationProjection, projection),
      Effect.provideService(CodexGateway, gateway),
      Effect.provideService(CodexTurnAuthority, authority),
      Effect.provideService(CodexTurnPreparation, preparation),
      Effect.provideService(ConversationRuntimeMap, conversations),
      Effect.provideService(CoreModules, core),
      Effect.provideService(ProjectRuntimeLifecycleRuntime, projectLifecycle),
      Effect.provideService(Scope.Scope, scope),
    );
    return { aggregate, commands, events, requests: () => requests, scope };
  });

it.effect("rematerializes once after thread-not-found and retries a fresh transaction", () =>
  Effect.gen(function* () {
    const harness = yield* makeHarness({
      request: (attempt) =>
        attempt === 1 ? Effect.fail(missingThread()) : Effect.succeed(response()),
    });

    const result = yield* harness.commands.start("thread-a", "ship");

    assert.strictEqual(result?.turnId, "turn-accepted");
    assert.strictEqual(harness.requests(), 2);
    assert.deepEqual(harness.events, [
      "ensure",
      "prepare:1",
      "configure",
      "authority:begin",
      "admit",
      "active",
      "request:1",
      "authority:abort",
      "reject",
      "idle",
      "reload",
      "prepare:2",
      "configure",
      "authority:begin",
      "admit",
      "active",
      "request:2",
      "authority:bind",
      "accept",
      "automation:accept",
      "active",
    ]);
    assert.isNull(harness.aggregate.listQueuedFollowUps()[0]?.pausedReason ?? null);
    yield* Scope.close(harness.scope, Exit.void);
  }),
);

it.effect("returns the accepted protocol outcome when a secondary projection fails", () =>
  Effect.gen(function* () {
    const harness = yield* makeHarness({
      request: () => Effect.succeed(response()),
      failAcceptedProjection: true,
    });

    const result = yield* harness.commands.start("thread-a", "ship");

    assert.deepEqual(result, {
      threadId: "thread-a",
      turnId: "turn-accepted",
      status: "inProgress",
      itemIds: ["item-user"],
    });
    assert.isTrue(harness.events.includes("automation:accept"));
    assert.isFalse(harness.events.includes("reject"));
    yield* Scope.close(harness.scope, Exit.void);
  }),
);

it.effect("starts a system Automation turn without accepting its inbox run", () =>
  Effect.gen(function* () {
    const harness = yield* makeHarness({
      request: () => Effect.succeed(response()),
    });

    const result = yield* harness.commands.startAutomation("thread-a", "ship");

    assert.strictEqual(result?.turnId, "turn-accepted");
    assert.isFalse(harness.events.includes("automation:accept"));
    assert.isTrue(harness.events.includes("accept"));
    yield* Scope.close(harness.scope, Exit.void);
  }),
);
