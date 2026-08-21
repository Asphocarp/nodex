import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Stream from "effect/Stream";
import type { ProjectWorkspaceReadSnapshot } from "../core-client/types";
import { CoreModules, type CoreModuleClients } from "../core-runtime/CoreModules";
import { CodexApplicationEventHub } from "./CodexApplicationEventHub";
import { CodexConversationProjection } from "./CodexConversationProjection";
import {
  CodexSidebarSyncRuntime,
  type CodexSidebarSyncNotification,
} from "./CodexSidebarSyncRuntime";
import { make } from "./CodexThreadDurableProjection";
import { ConversationRuntimeMap } from "./ConversationRuntimeMap";

type CoreThread = Extract<
  ProjectWorkspaceReadSnapshot["value"],
  { readonly kind: "thread" }
>["thread"];

const coreThread = (overrides: Partial<CoreThread> = {}): CoreThread =>
  ({
    thread_id: "thread-a",
    project_id: "project-a",
    session_id: null,
    forked_from_id: null,
    parent_thread_id: null,
    thread_source: null,
    service_name: null,
    agent_nickname: null,
    agent_role: null,
    agent_path: null,
    thread_name: "Thread A",
    thread_preview: "",
    model_provider: "openai",
    model_id: "gpt-test",
    harness_id: null,
    reasoning_effort: "high",
    service_tier: null,
    execution_host_id: "local",
    cwd: "/repo",
    writable_roots: ["/repo"],
    managed_worktree_path: null,
    projectless_output_directory: null,
    projectless_workspace_browser_root: null,
    status: { status_type: "idle", active_flags: [] },
    archived: false,
    pinned_order: null,
    has_unread_turn: false,
    created_at: 1,
    updated_at: 1,
    recency_at: 1,
    linked_at: "2026-08-24T00:00:00.000Z",
    ...overrides,
  }) as CoreThread;

it.effect("serially commits archive and delete observations before scheduling sidebar repair", () =>
  Effect.gen(function* () {
    let stored: CoreThread | null = coreThread();
    const operations: string[] = [];
    const sidebar: string[] = [];
    const events: unknown[] = [];
    const workspace: CoreModuleClients["workspace"] = {
      read: () =>
        Effect.sync(() => {
          if (!stored) return { value: { kind: "thread", thread: coreThread() } } as never;
          return { value: { kind: "thread", thread: stored } } as never;
        }),
      apply: (input) =>
        Effect.sync(() => {
          operations.push(input.operationId);
          if (input.intent.kind === "set_thread_archived" && stored) {
            stored = { ...stored, archived: input.intent.archived };
          }
          if (input.intent.kind === "delete_thread") stored = null;
          return {} as never;
        }),
    };
    const service = yield* make.pipe(
      Effect.provideService(
        CodexApplicationEventHub,
        CodexApplicationEventHub.of({
          events: Stream.empty,
          publish: (event) => events.push(event),
        }),
      ),
      Effect.provideService(
        CodexConversationProjection,
        CodexConversationProjection.of({} as CodexConversationProjection["Service"]),
      ),
      Effect.provideService(
        CodexSidebarSyncRuntime,
        CodexSidebarSyncRuntime.of({
          scheduleNotification: ({ notificationMethod }: CodexSidebarSyncNotification) => {
            sidebar.push(notificationMethod);
          },
        } as unknown as CodexSidebarSyncRuntime["Service"]),
      ),
      Effect.provideService(
        ConversationRuntimeMap,
        ConversationRuntimeMap.of({
          currentConversation: () => null,
        } as unknown as ConversationRuntimeMap["Service"]),
      ),
      Effect.provideService(
        CoreModules,
        CoreModules.of({ workspace } as unknown as CoreModuleClients),
      ),
    );

    yield* service.observe({
      hostId: "local",
      generation: 1,
      occurrenceId: "local:1:inbox-a:41",
      occurrenceToken: 41,
      notification: { method: "thread/archived", params: { threadId: "thread-a" } },
    });
    yield* service.observe({
      hostId: "local",
      generation: 1,
      occurrenceId: "local:1:inbox-a:42",
      occurrenceToken: 42,
      notification: { method: "thread/deleted", params: { threadId: "thread-a" } },
    });

    assert.deepEqual(operations, [
      "codex:notification:local:1:inbox-a:41:thread/archived:thread-a",
      "codex:notification:local:1:inbox-a:42:thread/deleted:thread-a",
    ]);
    assert.deepEqual(sidebar, ["thread/archived", "thread/deleted"]);
    assert.isNull(stored);
    assert.deepEqual(events.slice(-2), [
      {
        kind: "codex",
        value: { type: "threadArchivedState", threadId: "thread-a", archived: true },
      },
      { kind: "codex", value: { type: "threadDeleted", threadId: "thread-a" } },
    ]);
  }),
);
