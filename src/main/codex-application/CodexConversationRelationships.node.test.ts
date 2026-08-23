import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";
import type { CodexConversationSnapshot } from "../../shared/types";
import type { ProjectWorkspaceReadSnapshot } from "../core-client/types";
import { CoreModules, type CoreModuleClients } from "../core-runtime/CoreModules";
import { CodexApplicationEventHub, type CodexApplicationEvent } from "./CodexApplicationEventHub";
import { make } from "./CodexConversationRelationships";
import { CodexThreadDirectory } from "./CodexThreadDirectory";
import { ConversationRuntimeMap } from "./ConversationRuntimeMap";

type CoreThread = Extract<
  ProjectWorkspaceReadSnapshot["value"],
  { readonly kind: "thread" }
>["thread"];

const conversation = {
  threadId: "parent",
  projectId: "project-1",
  source: null,
  threadName: "Parent",
  threadPreview: "",
  modelProvider: "openai",
  cwd: "/repo",
  statusType: "idle",
  statusActiveFlags: [],
  archived: false,
  createdAt: 1,
  updatedAt: 2,
  linkedAt: "2026-08-24T00:00:00.000Z",
  resumeState: "resumed",
  turns: [],
  requests: [],
  queuedFollowUps: [],
  pendingSteers: [],
  backgroundTerminalRows: [],
  capabilityFlags: {
    canEditLastUserTurn: true,
    canForkFromTurn: true,
    canSearch: true,
    canCollapseTurns: true,
  },
} satisfies CodexConversationSnapshot;

const coreThread = (threadId: string, parentThreadId: string | null): CoreThread =>
  ({
    thread_id: threadId,
    project_id: "project-1",
    session_id: null,
    forked_from_id: null,
    parent_thread_id: parentThreadId,
    thread_source: parentThreadId ? "subagent" : null,
    service_name: null,
    agent_nickname: null,
    agent_role: null,
    agent_path: null,
    thread_name: null,
    thread_preview: "",
    model_provider: "openai",
    model_id: null,
    harness_id: null,
    reasoning_effort: null,
    service_tier: null,
    execution_host_id: "local",
    cwd: "/repo",
    writable_roots: ["/repo"],
    managed_worktree_path: null,
    projectless_output_directory: null,
    projectless_workspace_browser_root: null,
    status: { status_type: "notLoaded", active_flags: [] },
    archived: false,
    pinned_order: null,
    has_unread_turn: false,
    created_at: 1,
    updated_at: 2,
    recency_at: 2,
    linked_at: "2026-08-24T00:00:00.000Z",
  }) as unknown as CoreThread;

const buildRelationships = Effect.fn("CodexConversationRelationshipsTest.build")(function* (input: {
  readonly scope: Scope.Scope;
  readonly published: CodexApplicationEvent[];
  readonly children: (parentThreadId: string) => readonly CoreThread[];
  readonly directory: CodexThreadDirectory["Service"];
}) {
  const workspace: CoreModuleClients["workspace"] = {
    read: (read) => {
      if (read.kind === "thread") {
        return Effect.succeed({
          value: { kind: "thread", thread: coreThread(read.thread_id, null) },
        } as never);
      }
      if (read.kind === "child_thread_window") {
        return Effect.succeed({
          value: {
            kind: "child_thread_window",
            threads: { items: input.children(read.parent_thread_id), next_cursor: null },
          },
        } as never);
      }
      return Effect.die(`Unexpected Core read '${read.kind}'`);
    },
    apply: () => Effect.die("unused"),
  };
  const runExclusive: ConversationRuntimeMap["Service"]["runExclusive"] = (_threadId, operation) =>
    operation;
  return yield* make.pipe(
    Effect.provideService(
      CodexApplicationEventHub,
      CodexApplicationEventHub.of({
        events: Stream.empty,
        publish: (event) => input.published.push(event),
      }),
    ),
    Effect.provideService(CodexThreadDirectory, input.directory),
    Effect.provideService(
      ConversationRuntimeMap,
      ConversationRuntimeMap.of({
        currentConversation: (threadId: string) => ({
          readSnapshot: () => ({ ...conversation, threadId }),
          readCanonicalState: () => null,
        }),
        runExclusive,
      } as unknown as ConversationRuntimeMap["Service"]),
    ),
    Effect.provideService(
      CoreModules,
      CoreModules.of({ workspace } as unknown as CoreModuleClients),
    ),
    Effect.provideService(Scope.Scope, input.scope),
  );
});

it.effect("shares one metadata repair per child and interrupts it with the owner Scope", () =>
  Effect.gen(function* () {
    const ownerScope = yield* Scope.make();
    const published: CodexApplicationEvent[] = [];
    let repairStarts = 0;
    let repairInterrupts = 0;
    const child = coreThread("child", "parent");
    const directory = CodexThreadDirectory.of({
      resolve: () =>
        Effect.sync(() => {
          repairStarts += 1;
        }).pipe(
          Effect.andThen(Effect.never),
          Effect.onInterrupt(() => Effect.sync(() => (repairInterrupts += 1))),
        ),
    } as unknown as CodexThreadDirectory["Service"]);
    const relationships = yield* buildRelationships({
      scope: ownerScope,
      published,
      children: (parentThreadId) => (parentThreadId === "parent" ? [child] : []),
      directory,
    });

    yield* relationships.refresh("parent");
    yield* relationships.refresh("parent");
    yield* Effect.yieldNow;

    assert.strictEqual(repairStarts, 1);
    assert.strictEqual(
      published.filter(
        (event) =>
          event.kind === "hostMessage" &&
          event.value.type === "sharedObjectUpdated" &&
          event.value.object.objectType === "conversationChildMemberships",
      ).length,
      2,
    );

    yield* Scope.close(ownerScope, Exit.void);
    assert.strictEqual(repairInterrupts, 1);
  }),
);

it.effect("hands metadata repair to the child's current parent generation", () =>
  Effect.gen(function* () {
    const ownerScope = yield* Scope.make();
    let repairStarts = 0;
    let repairInterrupts = 0;
    const directory = CodexThreadDirectory.of({
      resolve: () =>
        Effect.sync(() => {
          repairStarts += 1;
          return repairStarts;
        }).pipe(
          Effect.flatMap((attempt) =>
            attempt === 1
              ? Effect.succeed({
                  durable: {
                    threadId: "child",
                    parentThreadId: "new-parent",
                    threadName: null,
                    threadPreview: "",
                    modelProvider: "openai",
                    agentNickname: null,
                    agentRole: null,
                    agentPath: null,
                    statusType: "notLoaded",
                    archived: false,
                    createdAt: 1,
                    updatedAt: 2,
                  },
                } as never)
              : Effect.never,
          ),
          Effect.onInterrupt(() => Effect.sync(() => (repairInterrupts += 1))),
        ),
    } as unknown as CodexThreadDirectory["Service"]);
    const relationships = yield* buildRelationships({
      scope: ownerScope,
      published: [],
      children: (parentThreadId) => [coreThread("child", parentThreadId)],
      directory,
    });

    yield* relationships.refresh("old-parent");
    yield* Effect.yieldNow;
    yield* Effect.yieldNow;

    assert.strictEqual(repairStarts, 2);
    yield* Scope.close(ownerScope, Exit.void);
    assert.strictEqual(repairInterrupts, 1);
  }),
);
