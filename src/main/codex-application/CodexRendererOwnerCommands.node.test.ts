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
import { ConversationCommands } from "./ConversationCommands";
import { CodexConversationProjection } from "./CodexConversationProjection";
import { CodexForkSidePanelTransfer } from "./CodexForkSidePanelTransferRuntime";
import { CodexFreshThreadLaunchRuntime } from "./CodexFreshThreadLaunchRuntime";
import { CodexManualCompactionRuntime } from "./CodexManualCompactionRuntime";
import { CodexOwnerNotificationDrainRuntime } from "./CodexOwnerNotificationDrainRuntime";
import { CodexPendingWorktreeRuntime } from "./CodexPendingWorktreeRuntime";
import { CodexRendererConversationCoordinator } from "./CodexRendererConversationCoordinator";
import {
  CodexRendererConversationRegistry,
  makeCodexRendererConversationRegistryState,
} from "./CodexRendererConversationRegistry";
import { make } from "./CodexRendererOwnerCommands";
import { CodexThreadDirectory } from "./CodexThreadDirectory";
import { CodexThreadGoalRuntime } from "./CodexThreadGoalRuntime";
import { CodexThreadRollbackCommands } from "./CodexThreadRollbackCommands";
import { CodexThreadSettingsRuntime } from "./CodexThreadSettingsRuntime";
import { CodexThreadTitlePersistence } from "./CodexThreadTitlePersistence";
import { CodexTurnCommands } from "./CodexTurnCommands";
import { ConversationRuntimeMap } from "./ConversationRuntimeMap";

const threadId = "thread-owner-command";
const childThreadId = "thread-owner-command-fork";
const ownerClientId = "renderer-owner";

const canonical = (id: string): CodexCanonicalConversationState =>
  ({
    turns: [
      {
        protocol: { id: "turn-a", status: "completed" },
        items: [],
        sidecar: { params: undefined, hookRuns: [] },
      },
    ],
    protocol: { id },
  }) as unknown as CodexCanonicalConversationState;

const snapshot = (id: string): CodexConversationSnapshot =>
  ({
    threadId: id,
    threadName: "Source title",
    turns: [{ turnId: "turn-a", status: "completed", itemIds: [], threadId: id }],
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

const makeHarness = () => {
  const order: string[] = [];
  const gatewayRequests: Array<{ readonly method: string; readonly params: unknown }> = [];
  const titles: string[] = [];
  let forkCanonical: CodexCanonicalConversationState | null = null;
  const rendererConversations = makeCodexRendererConversationRegistryState();
  rendererConversations.setOwner(threadId, ownerClientId);
  const sourceSnapshot = snapshot(threadId);
  const childSnapshot = snapshot(childThreadId);
  const sourceCanonical = canonical(threadId);
  const childCanonical = canonical(childThreadId);

  const directory = CodexThreadDirectory.of({
    resolve: () =>
      Effect.succeed({
        fidelity: "full",
        durable: {
          threadId,
          projectId: "project-a",
          forkedFromId: null,
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
    acceptForkResult: ({ sourceThreadId, response }) =>
      Effect.sync(() => {
        order.push("directory:accept");
        assert.strictEqual(sourceThreadId, threadId);
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
    read: (readThreadId: string) =>
      Effect.succeed(
        readThreadId === threadId
          ? { canonical: sourceCanonical, snapshot: sourceSnapshot }
          : { canonical: forkCanonical ?? childCanonical, snapshot: childSnapshot },
      ),
    hydrate: (input: Parameters<CodexConversationProjection["Service"]["hydrate"]>[0]) =>
      Effect.sync(() => {
        order.push("projection:hydrate");
        forkCanonical = input.canonical;
        return childSnapshot;
      }),
  } as never);
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
                      thread_id: threadId,
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
        assert.strictEqual(hostId, "host-a");
        gatewayRequests.push({ method, params });
        return {
          thread: {
            id: childThreadId,
            forkedFromId: threadId,
            turns: [{ id: "turn-a", status: "completed" }],
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
  const coordinator = CodexRendererConversationCoordinator.of({
    adoptRendererOwner: (input) =>
      Effect.sync(() => {
        order.push("owner:adopt");
        rendererConversations.setOwner(input.conversationId, input.ownerClientId);
        return { checkpoint: null, ownerClientId: input.ownerClientId, revision: 1 };
      }),
  } as CodexRendererConversationCoordinator["Service"]);

  const commands = make.pipe(
    Effect.provideService(CoreModules, core),
    Effect.provideService(CodexGateway, gateway),
    Effect.provideService(CodexConversationProjection, projection),
    Effect.provideService(
      CodexOwnerNotificationDrainRuntime,
      CodexOwnerNotificationDrainRuntime.of({
        awaitCurrent: () => Effect.sync(() => order.push("owner:drain")).pipe(Effect.asVoid),
      } as unknown as CodexOwnerNotificationDrainRuntime["Service"]),
    ),
    Effect.provideService(CodexRendererConversationRegistry, rendererConversations),
    Effect.provideService(
      CodexPendingWorktreeRuntime,
      CodexPendingWorktreeRuntime.of({
        list: () => [
          {
            id: "pending-fork",
            launchMode: "fork-conversation",
            sourceConversationId: threadId,
            initialThreadTitle: "Source title (2)",
            label: "pending",
          } as never,
        ],
      } as never),
    ),
    Effect.provideService(CodexRendererConversationCoordinator, coordinator),
    Effect.provideService(
      CodexForkSidePanelTransfer,
      CodexForkSidePanelTransfer.of({
        stageDirect: () => Effect.sync(() => order.push("side-panel:stage")).pipe(Effect.asVoid),
      } as unknown as CodexForkSidePanelTransfer["Service"]),
    ),
    Effect.provideService(CodexThreadDirectory, directory),
    Effect.provideService(
      CodexThreadTitlePersistence,
      CodexThreadTitlePersistence.of({
        set: (input) =>
          Effect.sync(() => {
            order.push("title:set");
            titles.push(input.name);
            return true;
          }),
        setRequired: () => Effect.die("unused"),
      }),
    ),
    Effect.provideService(
      ConversationRuntimeMap,
      ConversationRuntimeMap.of({
        runExclusive: (_laneThreadId, operation) =>
          Effect.sync(() => order.push("lane:open")).pipe(Effect.andThen(operation)),
      } as ConversationRuntimeMap["Service"]),
    ),
    Effect.provideService(
      CodexFreshThreadLaunchRuntime,
      CodexFreshThreadLaunchRuntime.of({ start: () => Effect.die("unused") } as never),
    ),
    Effect.provideService(
      CodexManualCompactionRuntime,
      CodexManualCompactionRuntime.of({ start: () => Effect.die("unused") } as never),
    ),
    Effect.provideService(
      CodexThreadGoalRuntime,
      CodexThreadGoalRuntime.of({ set: () => Effect.die("unused") } as never),
    ),
    Effect.provideService(
      CodexThreadSettingsRuntime,
      CodexThreadSettingsRuntime.of({ update: () => Effect.die("unused") } as never),
    ),
    Effect.provideService(
      CodexThreadRollbackCommands,
      CodexThreadRollbackCommands.of({ rollbackLatestForEdit: () => Effect.die("unused") }),
    ),
    Effect.provideService(
      CodexTurnCommands,
      CodexTurnCommands.of({ startRendererOwned: () => Effect.die("unused") } as never),
    ),
    Effect.provideService(
      ConversationCommands,
      ConversationCommands.of({ setMemoryMode: () => Effect.die("unused") } as never),
    ),
  );
  return { commands, forkCanonical: () => forkCanonical, gatewayRequests, order, titles };
};

it.effect("rejects a non-owner before entering the application command lane", () =>
  Effect.gen(function* () {
    const { commands, gatewayRequests, order } = makeHarness();
    const service = yield* commands;
    const exit = yield* Effect.exit(
      service.execute("renderer-follower", {
        conversationId: threadId,
        request: {
          method: "thread/fork",
          params: { threadId, turnId: "turn-a", message: "edit" },
        },
      }),
    );

    assert.strictEqual(exit._tag, "Failure");
    assert.deepEqual(gatewayRequests, []);
    assert.deepEqual(order, []);
  }),
);

it.effect("owns the exact fork cut, canonical projection, and renderer adoption transaction", () =>
  Effect.gen(function* () {
    const { commands, forkCanonical, gatewayRequests, order, titles } = makeHarness();
    const service = yield* commands;
    const result = (yield* service.execute(ownerClientId, {
      conversationId: threadId,
      request: {
        method: "thread/fork",
        params: { threadId, turnId: "turn-a", message: "must not prefill" },
      },
    })) as { readonly threadId: string; readonly composerIntent?: { readonly prompt: string } };

    assert.strictEqual(result.threadId, childThreadId);
    assert.strictEqual(result.composerIntent?.prompt, "");
    assert.strictEqual(gatewayRequests.length, 1);
    assert.strictEqual(gatewayRequests[0]?.method, "thread/fork");
    assert.deepEqual(gatewayRequests[0]?.params, {
      threadId,
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
    });
    assert.deepEqual(titles, ["Source title (3)"]);
    assert.strictEqual(forkCanonical()?.turns.at(-1)?.items.at(-1)?.type, "forkedFromConversation");
    assert.deepEqual(order, [
      "lane:open",
      "owner:drain",
      "gateway:fork",
      "directory:accept",
      "projection:hydrate",
      "title:set",
      "owner:adopt",
      "side-panel:stage",
    ]);
  }),
);
