import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Stream from "effect/Stream";
import type {
  CodexCanonicalConversationState,
  CodexConversationSnapshot,
} from "../../shared/types";
import type { ProjectWorkspaceReadSnapshot } from "../core-client/types";
import { CodexGateway } from "../codex-runtime/CodexGateway";
import { CoreModules, type CoreModuleClients } from "../core-runtime/CoreModules";
import { CodexConversationProjection } from "./CodexConversationProjection";
import { make } from "./CodexConversationFork";
import { CodexForkSidePanelTransfer } from "./CodexForkSidePanelTransferRuntime";
import { CodexForkTitlePolicy } from "./CodexForkTitlePolicy";
import { CodexOwnerNotificationDrainRuntime } from "./CodexOwnerNotificationDrainRuntime";
import { CodexRendererConversationCoordinator } from "./CodexRendererConversationCoordinator";
import { CodexThreadCatalog } from "./CodexThreadCatalog";
import { CodexThreadDirectory } from "./CodexThreadDirectory";
import { CodexThreadTitlePersistence } from "./CodexThreadTitlePersistence";
import { ConversationRuntimeMap } from "./ConversationRuntimeMap";

const sourceThreadId = "thread-source";
const childThreadId = "thread-child";
const ownerClientId = "renderer-owner";

const canonical = (threadId: string): CodexCanonicalConversationState =>
  ({
    turns: [
      {
        protocol: { id: "turn-a", status: "completed" },
        items: [],
        sidecar: { params: undefined, hookRuns: [] },
      },
    ],
    protocol: { id: threadId },
  }) as unknown as CodexCanonicalConversationState;

const snapshot = (threadId: string): CodexConversationSnapshot =>
  ({
    threadId,
    threadName: "Source title",
    turns: [{ threadId, turnId: "turn-a", status: "completed", itemIds: [] }],
    turnPagination: {
      olderCursor: null,
      backwardsCursor: null,
      oldestLoadedTurnId: "turn-a",
      isLoadingOlder: false,
      hasLoadedOldest: true,
      loadedTurnCount: 1,
      itemsView: "full",
    },
  }) as unknown as CodexConversationSnapshot;

const makeHarness = (responseTurnId = "turn-a") => {
  const order: string[] = [];
  const requests: Array<{
    readonly hostId: string;
    readonly method: string;
    readonly params: unknown;
  }> = [];
  const sourceCanonical = canonical(sourceThreadId);
  const childCanonical = canonical(childThreadId);
  const sourceSnapshot = snapshot(sourceThreadId);
  const childSnapshot = snapshot(childThreadId);
  let projectedChild = childCanonical;

  const core = CoreModules.of({
    workspace: {
      read: (input: Parameters<CoreModuleClients["workspace"]["read"]>[0]) => {
        if (input.kind === "task_window") {
          return Effect.succeed({
            value: {
              kind: "task_window",
              tasks: {
                items: [
                  {
                    session: {},
                    thread: {
                      thread_id: sourceThreadId,
                      forked_from_id: null,
                      thread_name: "Source title",
                    },
                  },
                ],
                next_cursor: null,
                authority: { projection_revision: 1 },
              },
            },
          } as unknown as ProjectWorkspaceReadSnapshot);
        }
        if (input.kind === "execution_context") {
          return Effect.succeed({
            value: {
              kind: "execution_context",
              context: { thread: { writable_roots: ["/workspace", "/shared"] } },
            },
          } as unknown as ProjectWorkspaceReadSnapshot);
        }
        return Effect.die("unexpected Core read");
      },
    },
  } as unknown as CoreModuleClients);
  const gateway = CodexGateway.of({
    localHostId: "host-a",
    events: Stream.empty,
    requestOnHost: ((hostId: string, method: string, params: unknown) =>
      Effect.sync(() => {
        order.push("gateway:fork");
        requests.push({ hostId, method, params });
        return {
          thread: {
            id: childThreadId,
            forkedFromId: sourceThreadId,
            turns: [{ id: responseTurnId, status: "completed" }],
          },
          model: "gpt-test",
          modelProvider: "openai",
          serviceTier: null,
          cwd: "/workspace",
          runtimeWorkspaceRoots: ["/workspace", "/shared"],
          instructionSources: [],
          approvalPolicy: "never",
          approvalsReviewer: "user",
          sandbox: { type: "workspaceWrite", writableRoots: ["/workspace", "/shared"] },
          activePermissionProfile: null,
          reasoningEffort: "high",
          multiAgentMode: "explicitRequestOnly",
        } as never;
      })) as CodexGateway["Service"]["requestOnHost"],
  } as unknown as CodexGateway["Service"]);
  const directory = CodexThreadDirectory.of({
    resolve: () =>
      Effect.succeed({
        fidelity: "durable",
        durable: {
          threadId: sourceThreadId,
          projectId: "project-a",
          executionHostId: "host-a",
          cwd: "/workspace",
          executionProfile: {
            providerId: "openai",
            modelId: "gpt-test",
            harnessId: null,
            reasoningEffort: "high",
            serviceTier: null,
          },
        },
        summary: { ...sourceSnapshot, forkedFromId: null },
        canonical: sourceCanonical,
        snapshot: sourceSnapshot,
      } as never),
    descendants: () => Effect.die("unused"),
    acceptRollbackResult: () => Effect.die("unused"),
    acceptForkResult: ({ sourceThreadId: acceptedSource, response }) =>
      Effect.sync(() => {
        order.push("directory:accept");
        assert.strictEqual(acceptedSource, sourceThreadId);
        assert.strictEqual(response.thread.id, childThreadId);
        return {
          fidelity: "live",
          durable: { threadId: childThreadId },
          summary: { ...childSnapshot, threadId: childThreadId },
          canonical: childCanonical,
          snapshot: childSnapshot,
        } as never;
      }),
    acceptSessionStart: () => Effect.die("unused"),
  });
  const projection = CodexConversationProjection.of({
    read: (threadId: string) =>
      Effect.succeed(
        threadId === sourceThreadId
          ? { canonical: sourceCanonical, snapshot: sourceSnapshot }
          : { canonical: projectedChild, snapshot: childSnapshot },
      ),
    hydrate: (input: Parameters<CodexConversationProjection["Service"]["hydrate"]>[0]) =>
      Effect.sync(() => {
        order.push("projection:hydrate");
        projectedChild = input.canonical;
        return childSnapshot;
      }),
  } as never);
  const capability = make.pipe(
    Effect.provideService(CoreModules, core),
    Effect.provideService(CodexGateway, gateway),
    Effect.provideService(CodexConversationProjection, projection),
    Effect.provideService(
      CodexForkTitlePolicy,
      CodexForkTitlePolicy.of({
        derive: () =>
          Effect.succeed({ sourceTitle: "Source title", childTitle: "Source title (3)" }),
      }),
    ),
    Effect.provideService(
      CodexOwnerNotificationDrainRuntime,
      CodexOwnerNotificationDrainRuntime.of({
        awaitCurrent: () => Effect.sync(() => order.push("owner:drain")).pipe(Effect.asVoid),
      } as never),
    ),
    Effect.provideService(
      CodexRendererConversationCoordinator,
      CodexRendererConversationCoordinator.of({
        adoptRendererOwner: (
          input: Parameters<
            CodexRendererConversationCoordinator["Service"]["adoptRendererOwner"]
          >[0],
        ) =>
          Effect.sync(() => {
            order.push("owner:adopt");
            return { checkpoint: null, ownerClientId: input.ownerClientId, revision: 1 };
          }),
      } as never),
    ),
    Effect.provideService(
      CodexForkSidePanelTransfer,
      CodexForkSidePanelTransfer.of({
        stageDirect: () => Effect.sync(() => order.push("side-panel:stage")).pipe(Effect.asVoid),
      } as never),
    ),
    Effect.provideService(
      CodexThreadCatalog,
      CodexThreadCatalog.of({
        ensureSession: () =>
          Effect.sync(() => {
            order.push("session:ensure");
            return {
              id: "session-child",
              thread: { threadId: childThreadId },
            } as never;
          }),
      } as never),
    ),
    Effect.provideService(CodexThreadDirectory, directory),
    Effect.provideService(
      CodexThreadTitlePersistence,
      CodexThreadTitlePersistence.of({
        set: (input) =>
          Effect.sync(() => {
            order.push(`title:set:${input.name}`);
            return true;
          }),
        setRequired: () => Effect.die("unused"),
      }),
    ),
    Effect.provideService(
      ConversationRuntimeMap,
      ConversationRuntimeMap.of({
        runExclusive: <A, E, R>(_threadId: string, operation: Effect.Effect<A, E, R>) =>
          Effect.sync(() => order.push("lane:open")).pipe(Effect.andThen(operation)),
      } as never),
    ),
  );
  return { capability, order, projectedChild: () => projectedChild, requests };
};

it.effect("commits an exact persistent fork through canonical Session ownership", () =>
  Effect.gen(function* () {
    const { capability, order, projectedChild, requests } = makeHarness();
    const forks = yield* capability;
    const result = yield* forks.fork({
      sourceThreadId,
      lastTurnId: "turn-a",
      threadSource: "user",
      ownerClientId,
    });

    assert.strictEqual(result.threadId, childThreadId);
    assert.strictEqual(result.session.id, "session-child");
    assert.strictEqual(result.composerIntent.prompt, "");
    assert.deepEqual(requests, [
      {
        hostId: "host-a",
        method: "thread/fork",
        params: {
          threadId: sourceThreadId,
          lastTurnId: "turn-a",
          path: null,
          model: "gpt-test",
          modelProvider: "openai",
          serviceTier: null,
          cwd: "/workspace",
          runtimeWorkspaceRoots: ["/workspace", "/shared"],
          threadSource: "user",
          config: {
            model_reasoning_effort: "high",
            "features.apply_patch_streaming_events": true,
            "features.concurrent_reasoning_summaries": true,
            "features.thread_tools": true,
          },
        },
      },
    ]);
    assert.strictEqual(projectedChild().turns.at(-1)?.items.at(-1)?.type, "forkedFromConversation");
    assert.deepEqual(order, [
      "lane:open",
      "owner:drain",
      "gateway:fork",
      "directory:accept",
      "projection:hydrate",
      "title:set:Source title (3)",
      "session:ensure",
      "owner:adopt",
      "side-panel:stage",
    ]);
  }),
);

it.effect("rejects a protocol response that does not honor the requested fork cut", () =>
  Effect.gen(function* () {
    const { capability, order } = makeHarness("turn-other");
    const forks = yield* capability;
    const exit = yield* Effect.exit(
      forks.fork({
        sourceThreadId,
        lastTurnId: "turn-a",
        threadSource: "user",
      }),
    );

    assert.strictEqual(exit._tag, "Failure");
    assert.deepEqual(order, ["lane:open", "owner:drain", "gateway:fork"]);
  }),
);
