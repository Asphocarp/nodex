import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Stream from "effect/Stream";
import { AutomationApplication } from "../automation-application/AutomationApplication";
import { CodexGateway } from "../codex-runtime/CodexGateway";
import { AutomationRoutingIndex } from "../core-runtime/AutomationRoutingIndex";
import {
  ProjectWorkspace,
  type DesktopProjectWorkspaceThread,
} from "../project-application/ProjectWorkspace";
import { CodexApplicationEventHub } from "./CodexApplicationEventHub";
import { make } from "./CodexConversationArchive";
import { ConversationEntityMap } from "./internal/ConversationEntityMap";
import {
  ManagedWorktreeRuntime,
  ManagedWorktreeRuntimeError,
  type ManagedWorktreeSetOwnerInput,
} from "./ManagedWorktreeRuntime";
import { NodexAgentAuthorizationRuntime } from "./NodexAgentAuthorizationRuntime";

const thread = (overrides: Partial<DesktopProjectWorkspaceThread> = {}) =>
  ({
    threadId: "thread-a",
    projectId: "project-a",
    sessionId: "session-a",
    forkedFromId: null,
    parentThreadId: null,
    threadSource: "user",
    serviceName: null,
    agentNickname: null,
    agentRole: null,
    agentPath: null,
    threadName: "Thread A",
    threadPreview: "",
    modelProvider: "openai",
    executionHostId: "local",
    cwd: "/worktrees/a/packages/app",
    managedWorktreePath: "/worktrees/a",
    projectlessOutputDirectory: null,
    projectlessWorkspaceBrowserRoot: null,
    statusType: "notLoaded",
    statusActiveFlags: [],
    archived: false,
    pinnedOrder: null,
    hasUnreadTurn: false,
    createdAt: 1,
    updatedAt: 1,
    recencyAt: 1,
    linkedAt: "2026-08-24T00:00:00.000Z",
    ...overrides,
  }) satisfies DesktopProjectWorkspaceThread;

const makeArchive = (input: {
  readonly events: string[];
  readonly lifecycleConsumers: readonly ReturnType<typeof thread>[];
  readonly remove?: ManagedWorktreeRuntime["Service"]["remove"];
}) => {
  const unsupported = () => Effect.die(new Error("unused"));
  const gateway = CodexGateway.of({
    localHostId: "local",
    events: Stream.empty,
    requestForThread: (_threadId: string, method: string) =>
      Effect.sync(() => {
        input.events.push(`gateway:${method}`);
        return {};
      }) as never,
    requestRawOnHost: unsupported,
    requestRawForThread: unsupported,
    requestLocal: unsupported,
    requestOnHost: unsupported,
    notifyLocal: unsupported,
    connection: unsupported,
    connectionChanges: () => Stream.empty,
    awaitReady: () => Effect.void,
    reconcileHost: unsupported,
    removeHost: unsupported,
    restartHost: unsupported,
  });
  const current = thread();
  return make.pipe(
    Effect.provideService(
      AutomationApplication,
      AutomationApplication.of({ runs: { get: () => Effect.succeed(null) } } as never),
    ),
    Effect.provideService(
      AutomationRoutingIndex,
      AutomationRoutingIndex.of({ activeHeartbeatAutomationId: () => null } as never),
    ),
    Effect.provideService(
      CodexApplicationEventHub,
      CodexApplicationEventHub.of({ events: Stream.empty, publish: () => undefined }),
    ),
    Effect.provideService(CodexGateway, gateway),
    Effect.provideService(
      ConversationEntityMap,
      ConversationEntityMap.of({ current: () => null } as never),
    ),
    Effect.provideService(
      ManagedWorktreeRuntime,
      ManagedWorktreeRuntime.of({
        setOwner: ({ ownerThreadId }: ManagedWorktreeSetOwnerInput) =>
          Effect.sync(() => input.events.push(`owner:${ownerThreadId}`)),
        remove:
          input.remove ??
          (() =>
            Effect.sync(() => {
              input.events.push("remove");
              return { removed: true, alreadyMissing: false, snapshot: null, warnings: [] };
            })),
        isNewborn: () => Effect.succeed(false),
      } as never),
    ),
    Effect.provideService(
      NodexAgentAuthorizationRuntime,
      NodexAgentAuthorizationRuntime.of({
        revokeRoot: () => Effect.sync(() => input.events.push("revoke")),
      } as never),
    ),
    Effect.provideService(
      ProjectWorkspace,
      ProjectWorkspace.of({
        getThread: () => Effect.succeed(current),
        readManagedWorktreeLifecycleSnapshot: Effect.succeed({
          projectionRevision: 1,
          consumers: input.lifecycleConsumers,
          projects: [],
        }),
        setThreadArchived: () =>
          Effect.sync(() => {
            input.events.push("core:archive");
            return { threads: [] };
          }),
      } as never),
    ),
  );
};

it.effect("writes a shared worktree replacement owner before archiving the Thread", () =>
  Effect.gen(function* () {
    const events: string[] = [];
    const archive = yield* makeArchive({
      events,
      lifecycleConsumers: [
        thread(),
        thread({
          threadId: "thread-b",
          cwd: "/worktrees/a/packages/other",
          statusType: "active",
          updatedAt: 2,
        }),
      ],
    });
    assert.isTrue(yield* archive.archive("thread-a"));
    assert.deepEqual(events, [
      "owner:thread-b",
      "gateway:thread/archive",
      "revoke",
      "core:archive",
    ]);
  }),
);

it.effect("does not archive when required-snapshot removal fails", () =>
  Effect.gen(function* () {
    const events: string[] = [];
    const archive = yield* makeArchive({
      events,
      lifecycleConsumers: [thread()],
      remove: () =>
        Effect.fail(
          new ManagedWorktreeRuntimeError({
            operation: "remove",
            hostId: "local",
            worktreeGitRoot: "/worktrees/a",
            cause: new Error("snapshot failed"),
          }),
        ),
    });
    const exit = yield* Effect.exit(archive.archive("thread-a"));
    assert.isTrue(exit._tag === "Failure");
    assert.deepEqual(events, []);
  }),
);
