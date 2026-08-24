import { assert, it } from "@effect/vitest";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import type { Thread, Turn } from "@nodex/codex-app-server-protocol/v2";
import { createCodexCanonicalHydratedConversationState } from "../../shared/codex-conversation-state/codex-conversation-state";
import type { CodexConversationSnapshot } from "../../shared/types";
import { CodexGateway } from "../codex-runtime/CodexGateway";
import { makeConversationEntityStateRegistry } from "./internal/ConversationEntityState";
import { make } from "./CodexConversationHistoryRuntime";
import {
  CodexRendererConversationRegistry,
  makeCodexRendererConversationRegistryState,
} from "./CodexRendererConversationRegistry";
import { ConversationEntityMap } from "./internal/ConversationEntityMap";

const historyTurn = (id: string): Turn => ({
  id,
  items: [],
  itemsView: "full",
  status: "completed",
  error: null,
  startedAt: null,
  completedAt: null,
  durationMs: null,
});

const historyThread = (turns: Turn[]): Thread => ({
  id: "thread-history",
  extra: null,
  sessionId: "session-history",
  forkedFromId: null,
  parentThreadId: null,
  preview: "",
  ephemeral: false,
  section: null,
  sectionEnteredAt: null,
  historyMode: "paginated",
  modelProvider: "openai",
  createdAt: 1,
  updatedAt: 1,
  recencyAt: 1,
  status: { type: "idle" },
  path: null,
  cwd: "/workspace",
  cliVersion: "test",
  source: "appServer",
  canAcceptDirectInput: true,
  threadSource: null,
  agentNickname: null,
  agentRole: null,
  gitInfo: null,
  name: null,
  turns,
});

it.effect("shares one page load and prepends it onto the latest canonical revision", () =>
  Effect.gen(function* () {
    const currentTurn = historyTurn("turn-current");
    const olderTurn = historyTurn("turn-older");
    const liveTurn = historyTurn("turn-live");
    const hydration: Parameters<typeof createCodexCanonicalHydratedConversationState>[1] = {
      model: "gpt-test",
      reasoningEffort: "high",
      cwd: "/workspace",
      approvalPolicy: "on-request",
      approvalsReviewer: "user",
      sandboxPolicy: { type: "readOnly", networkAccess: false },
      activePermissionProfile: null,
      runtimeWorkspaceRoots: ["/workspace"],
    };
    const canonical = createCodexCanonicalHydratedConversationState(
      historyThread([currentTurn]),
      hydration,
    );
    const aggregates = makeConversationEntityStateRegistry();
    const aggregate = aggregates.acquire("thread-history");
    aggregate.acceptCanonicalState(canonical);
    const pagination = {
      olderCursor: "cursor-older",
      backwardsCursor: null,
      oldestLoadedTurnId: "turn-current",
      isLoadingOlder: false,
      hasLoadedOldest: false,
      loadedTurnCount: 1,
      itemsView: "full" as const,
    };
    aggregate.installSnapshot({
      threadId: "thread-history",
      canonicalState: canonical,
      turns: [
        {
          threadId: "thread-history",
          turnId: "turn-current",
          status: "completed",
          itemIds: [],
          items: [],
        },
      ],
      turnPagination: pagination,
      queuedFollowUps: [],
    } as unknown as CodexConversationSnapshot);
    aggregate.initializeHistory(pagination, 1);
    const conversations = ConversationEntityMap.of({
      entity: aggregates.acquire,
      current: aggregates.current,
    } as unknown as ConversationEntityMap["Service"]);
    const started = yield* Deferred.make<void>();
    const release = yield* Deferred.make<void>();
    let requests = 0;
    const gateway = CodexGateway.of({
      requestForThread: () => {
        requests += 1;
        return Deferred.succeed(started, undefined).pipe(
          Effect.andThen(Deferred.await(release)),
          Effect.as({ data: [olderTurn], nextCursor: null, backwardsCursor: null }),
        );
      },
      requestRawOnHost: () => Effect.die("unused"),
    } as unknown as CodexGateway["Service"]);
    const runtime = yield* make.pipe(
      Effect.provideService(CodexGateway, gateway),
      Effect.provideService(ConversationEntityMap, conversations),
      Effect.provideService(
        CodexRendererConversationRegistry,
        makeCodexRendererConversationRegistryState(),
      ),
    );

    const first = yield* Effect.forkChild(runtime.loadPage("thread-history"));
    yield* Deferred.await(started);
    const second = yield* Effect.forkChild(runtime.loadPage("thread-history"));
    yield* Effect.yieldNow;
    assert.strictEqual(requests, 1);
    aggregate.acceptCanonicalState(
      createCodexCanonicalHydratedConversationState(
        historyThread([currentTurn, liveTurn]),
        hydration,
      ),
    );
    yield* Deferred.succeed(release, undefined);
    const snapshots = yield* Effect.all([Fiber.join(first), Fiber.join(second)]);

    for (const snapshot of snapshots) {
      assert.deepEqual(
        snapshot?.turns.map((turn) => turn.turnId),
        ["turn-older", "turn-current", "turn-live"],
      );
      assert.isTrue(snapshot?.turnPagination?.hasLoadedOldest);
    }
    assert.strictEqual(aggregate.readCanonicalState()?.turns[0]?.protocol.id, "turn-older");
    assert.strictEqual(aggregate.readCanonicalState()?.turns.at(-1)?.protocol.id, "turn-live");
  }),
);
