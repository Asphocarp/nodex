import { assert, it } from "@effect/vitest";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Fiber from "effect/Fiber";
import * as Scope from "effect/Scope";
import { CodexAppServerNoResponse } from "@nodex/effect-codex-app-server/protocol";
import type { CodexApprovalRequest } from "../../shared/types";
import {
  createCodexCanonicalConversationState,
  type CodexCanonicalConversationState,
  type CodexCanonicalTurnParams,
} from "../../shared/codex-conversation-state/codex-conversation-state";
import { reduceCodexConversationServerRequest } from "../../shared/codex-conversation-state/codex-server-request-lifecycle";
import {
  AGENT_ACTIVITY_V2_CORPUS_TURN_ID,
  buildAgentActivityV2CorpusThread,
} from "../../shared/codex-conversation-state/test-fixtures/agent-activity-v2-corpus-provenance";
import { agentActivityV2CommandApprovalRequest } from "../../shared/codex-conversation-state/test-fixtures/agent-activity-v2-request-family-corpus";
import { make as makeInbox } from "./CodexPendingServerRequestRuntime";
import {
  CodexServerRequestResponseProjectionError,
  make as makeResponses,
} from "./CodexServerRequestResponses";

interface Completion {
  readonly occurrenceToken: number;
  readonly response: unknown;
  readonly threadId: string;
}

const turnParams = (threadId: string): CodexCanonicalTurnParams => ({
  threadId,
  input: [],
  approvalPolicy: "on-request",
  approvalsReviewer: "user",
  sandboxPolicy: {
    type: "workspaceWrite",
    writableRoots: [],
    networkAccess: false,
    excludeTmpdirEnvVar: false,
    excludeSlashTmp: false,
  },
  model: "fixture-model",
  cwd: "/workspace/project",
  attachments: [],
  effort: "high",
  summary: "none",
  personality: null,
  outputSchema: null,
  collaborationMode: null,
});

const canonicalApproval = (threadId: string, requestId: string) => {
  const thread = {
    ...buildAgentActivityV2CorpusThread([]),
    id: threadId,
    turns: buildAgentActivityV2CorpusThread([]).turns.map((turn) => ({
      ...turn,
      id: AGENT_ACTIVITY_V2_CORPUS_TURN_ID,
    })),
  };
  const initial = createCodexCanonicalConversationState(thread, {
    turnParamsById: { [AGENT_ACTIVITY_V2_CORPUS_TURN_ID]: turnParams(threadId) },
  });
  const request = {
    ...agentActivityV2CommandApprovalRequest,
    id: requestId,
    params: {
      ...agentActivityV2CommandApprovalRequest.params,
      threadId,
      turnId: AGENT_ACTIVITY_V2_CORPUS_TURN_ID,
    },
  };
  return {
    request,
    state: reduceCodexConversationServerRequest(initial, request, { now: () => 1 }).state,
  };
};

const approvalView = (threadId: string, requestId: string): CodexApprovalRequest => ({
  type: "approval",
  requestId,
  kind: "command",
  projectId: "project-1",
  threadId,
  turnId: AGENT_ACTIVITY_V2_CORPUS_TURN_ID,
  itemId: `item-${requestId}`,
  createdAt: 1,
});

const makeHarness = (
  scope: Scope.Scope,
  follower: boolean,
  respondFollowerApproval: Effect.Effect<void, CodexServerRequestResponseProjectionError>,
) =>
  Effect.gen(function* () {
    const completions: Completion[] = [];
    const inbox = yield* makeInbox({
      respond: (threadId, _requestId, occurrenceToken, response) =>
        Effect.sync(() => {
          completions.push({ threadId, occurrenceToken, response });
          return true;
        }),
      reject: () => Effect.succeed(true),
    }).pipe(Effect.provideService(Scope.Scope, scope));
    const states = new Map<string, CodexCanonicalConversationState>();
    const emitted: unknown[] = [];
    const completedPlans: Array<{ readonly threadId: string; readonly turnId: string }> = [];
    const responses = yield* makeResponses({
      inbox,
      projection: {
        completePlanImplementation: (input) => completedPlans.push(input),
        read: (threadId) => {
          const state = states.get(threadId);
          return state
            ? {
                canonicalState: state,
                rawState: {
                  threadId,
                  turns: [],
                  requests: state.requests,
                  hasUnreadTurn: state.sidecar.hasUnreadTurn,
                },
                streamRole: follower ? "follower" : "owner",
              }
            : null;
        },
        resolveThreadId: (requestId) =>
          [...states].find(([, state]) =>
            state.requests.some((request) => request.id === requestId),
          )?.[0] ?? null,
        applyCanonical: ({ threadId, lifecycle }) => states.set(threadId, lifecycle.state),
        applyRaw: () => undefined,
        clearApprovalAttachment: () => undefined,
        removeUserInputProjection: () => undefined,
        hasRendererOwner: () => false,
        broadcast: () => undefined,
        emitResolved: (event) => emitted.push(event),
        observeUserInputResponse: () => Effect.void,
        respondFollowerApproval: () => respondFollowerApproval,
      },
    }).pipe(Effect.provideService(Scope.Scope, scope));
    return { completedPlans, completions, emitted, inbox, responses, states };
  });

it.effect("settles a synthetic plan implementation request in the Thread response lane", () =>
  Effect.gen(function* () {
    const scope = yield* Scope.make();
    const harness = yield* makeHarness(scope, false, Effect.void);

    assert.isTrue(yield* harness.responses.planImplementation("thread-plan", "turn-plan"));
    assert.deepEqual(harness.completedPlans, [{ threadId: "thread-plan", turnId: "turn-plan" }]);
    yield* Scope.close(scope, Exit.void);
  }),
);

it.effect("commits one owner response and explicitly releases duplicate physical occurrences", () =>
  Effect.gen(function* () {
    const scope = yield* Scope.make();
    const harness = yield* makeHarness(scope, false, Effect.void);
    const threadId = "thread-owner";
    const requestId = "approval-shared";
    const canonical = canonicalApproval(threadId, requestId);
    harness.states.set(threadId, canonical.state);
    harness.inbox.register({
      kind: "approval",
      occurrenceToken: 1,
      request: approvalView(threadId, requestId),
    });
    harness.inbox.register({
      kind: "approval",
      occurrenceToken: 2,
      request: approvalView(threadId, requestId),
    });

    assert.isTrue(
      yield* harness.responses.approval({
        threadId,
        requestId,
        response: { kind: "command", decision: "decline" },
      }),
    );
    yield* Effect.yieldNow;

    assert.deepEqual(
      harness.completions.map(({ occurrenceToken, response }) => ({ occurrenceToken, response })),
      [
        { occurrenceToken: 1, response: { decision: "decline" } },
        { occurrenceToken: 2, response: CodexAppServerNoResponse },
      ],
    );
    assert.strictEqual(harness.states.get(threadId)?.requests.length, 0);
    assert.deepEqual(harness.emitted, [{ type: "approval", requestId, decision: "decline" }]);
    yield* Scope.close(scope, Exit.void);
  }),
);

it.effect("keeps a follower occurrence retryable when the host decision fails", () =>
  Effect.gen(function* () {
    const scope = yield* Scope.make();
    const failure = new CodexServerRequestResponseProjectionError({
      operation: "respond-follower-approval",
      cause: new Error("host unavailable"),
    });
    const harness = yield* makeHarness(scope, true, Effect.fail(failure));
    const threadId = "thread-follower";
    const requestId = "approval-follower";
    harness.states.set(threadId, canonicalApproval(threadId, requestId).state);
    harness.inbox.register({
      kind: "approval",
      occurrenceToken: 1,
      request: approvalView(threadId, requestId),
    });

    const exit = yield* Effect.exit(
      harness.responses.approval({
        threadId,
        requestId,
        response: { kind: "command", decision: "decline" },
      }),
    );

    assert.isTrue(Exit.isFailure(exit));
    assert.isDefined(harness.inbox.find("approval", requestId));
    assert.strictEqual(harness.states.get(threadId)?.requests.length, 1);
    assert.deepEqual(harness.completions, []);
    yield* Scope.close(scope, Exit.void);
  }),
);

it.effect("interrupts an admitted follower response when its owning Scope closes", () =>
  Effect.gen(function* () {
    const scope = yield* Scope.make();
    const started = yield* Deferred.make<void>();
    const interrupted = yield* Deferred.make<void>();
    const follower = Deferred.succeed(started, undefined).pipe(
      Effect.andThen(Effect.never),
      Effect.onInterrupt(() => Deferred.succeed(interrupted, undefined)),
    );
    const harness = yield* makeHarness(scope, true, follower);
    const threadId = "thread-closing";
    const requestId = "approval-closing";
    harness.states.set(threadId, canonicalApproval(threadId, requestId).state);
    harness.inbox.register({
      kind: "approval",
      occurrenceToken: 1,
      request: approvalView(threadId, requestId),
    });
    const command = yield* harness.responses
      .approval({
        threadId,
        requestId,
        response: { kind: "command", decision: "decline" },
      })
      .pipe(Effect.forkChild);
    yield* Deferred.await(started);

    yield* Scope.close(scope, Exit.void);
    yield* Deferred.await(interrupted);
    const exit = yield* Fiber.await(command);

    assert.isTrue(Exit.isFailure(exit));
    assert.deepEqual(harness.completions, []);
  }),
);
