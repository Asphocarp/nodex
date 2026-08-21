import { describe, expect, test } from "vitest";

import { createCoreProjectWorkspaceAdapter } from "./project-workspace-adapter";
import { mapCoreProjectWorkspaceEvent } from "./desktop-project-workspace-bridge";
import { FakeCoreClient } from "./testing/fake-core-client";
import { createCoreLocalCommitFixture } from "./testing/local-commit-fixture";

const project = (overrides: Record<string, unknown> = {}) => ({
  id: "project:one",
  library_id: "library:test",
  database_id: "database:one",
  lifecycle: "active" as const,
  binding_revision: 1,
  name: "One",
  description: "First Project",
  appearance: {
    color: "blue" as const,
    marker: { kind: "emoji" as const, emoji: "📘" },
  },
  sources: [{ root: "/workspace/one", order: 0 }],
  primary_workspace_root: "/workspace/one",
  pinned: false,
  pinned_order: null,
  created_at: "2026-07-19T15:00:00.000Z",
  updated_at: "2026-07-19T15:00:00.000Z",
  ...overrides,
});

const sessionSummary = (overrides: Record<string, unknown> = {}) => ({
  id: "session:one",
  project_id: "project:one",
  no_thread_fallback_title: "New thread",
  display_title: "Thread one",
  order: 0,
  pinned: false,
  pinned_order: null,
  archived: false,
  archived_at: null,
  unread: true,
  thread_id: "thread:one",
  created_at: "2026-07-19T15:00:00.000Z",
  updated_at: "2026-07-19T15:01:00.000Z",
  ...overrides,
});

const thread = {
  thread_id: "thread:one",
  project_id: "project:one",
  session_id: "session:one",
  forked_from_id: null,
  parent_thread_id: null,
  thread_name: "Thread one",
  thread_source: null,
  service_name: null,
  agent_nickname: null,
  agent_role: null,
  agent_path: null,
  thread_preview: "Preview",
  model_provider: "openai",
  execution_host_id: "local",
  cwd: "/workspace/one",
  managed_worktree_path: null,
  projectless_output_directory: null,
  projectless_workspace_browser_root: null,
  status: { status_type: "idle" as const, active_flags: [] },
  archived: false,
  pinned_order: null,
  has_unread_turn: true,
  dynamic_tool_catalogs: [],
  writable_roots: ["/workspace/one"],
  created_at: 1,
  updated_at: 2,
  recency_at: 2,
  linked_at: "2026-07-19T15:00:00.000Z",
};

describe("Core Project Workspace adapter", () => {
  test("maps Workspace events into authority-neutral invalidations", () => {
    const packet = createCoreLocalCommitFixture({
      commitSeq: 3,
      storeEpoch: "epoch:test",
      operationId: "operation:workspace",
      committedAt: "2026-07-19T15:02:00.000Z",
      payload: {
        module: "project_workspace",
        library_id: "library-1",
        event: {
          kind: "workspace_changed",
          project_catalog_change: "sources_updated",
          project_ids: ["project:one"],
          session_ids: ["session:one"],
          thread_ids: ["thread:one"],
          session_summary_scopes: [
            { kind: "project", project_id: "project:one" },
            { kind: "projectless" },
          ],
          session_detail_ids: ["session:one"],
        },
      },
      canonicalHash: "0".repeat(64),
    });
    expect(mapCoreProjectWorkspaceEvent(packet.atoms[0]!)).toEqual({
      projectCatalogChange: "sources_updated",
      projectIds: ["project:one"],
      sessionIds: ["session:one"],
      threadIds: ["thread:one"],
      sessionSummaryScopes: [
        { kind: "project", projectId: "project:one" },
        { kind: "projectless" },
      ],
      sessionDetailIds: ["session:one"],
    });
  });

  test("maps Project reads and preserves Date values at the IPC boundary", async () => {
    const client = new FakeCoreClient();
    client.enqueueWorkspaceRead({
      contract_version: 4,
      commit_head: 3,
      store_epoch: "epoch:test",
      value: {
        kind: "project_window",
        projects: {
          items: [project()],
          next_cursor: null,
          authority: { projection_revision: 3 },
        },
      },
    });
    const adapter = createCoreProjectWorkspaceAdapter(client);

    const projects = await adapter.listProjects();

    expect(projects).toEqual([
      expect.objectContaining({
        id: "project:one",
        databaseId: "database:one",
        appearance: {
          color: "blue",
          marker: { kind: "emoji", emoji: "📘" },
        },
        primaryWorkspaceRoot: "/workspace/one",
        created: new Date("2026-07-19T15:00:00.000Z"),
      }),
    ]);
    expect(client.workspaceReads).toEqual([
      {
        kind: "project_window",
        include_archived: false,
        window: { after: null, first: 200 },
      },
    ]);
  });

  test("maps the bootstrap projection and preserves stable initial-creation identities", async () => {
    const client = new FakeCoreClient();
    client.enqueueWorkspaceRead({
      contract_version: 8,
      commit_head: 0,
      store_epoch: "epoch:test",
      value: {
        kind: "project_bootstrap",
        bootstrap: {
          status: "empty",
        },
      },
    });
    client.enqueueWorkspaceApply({
      value: {
        affected_project_ids: ["project:initial"],
        affected_session_ids: ["session:starter"],
        affected_thread_ids: [],
      },
      receipt: {
        operation_id: "operation:initial",
        duplicate: false,
        affected_project_ids: ["project:initial"],
        affected_session_ids: ["session:starter"],
      },
      event_sequence: 1,
      store_epoch: "epoch:test",
    });
    client.enqueueWorkspaceRead({
      contract_version: 8,
      commit_head: 1,
      store_epoch: "epoch:test",
      value: {
        kind: "project",
        project: project({
          id: "project:initial",
          name: "My Project",
          sources: [{ root: "/workspace/default", order: 0 }],
          primary_workspace_root: "/workspace/default",
        }),
      },
    });
    const adapter = createCoreProjectWorkspaceAdapter(client);

    await expect(adapter.readProjectBootstrap()).resolves.toEqual({
      status: "empty",
    });
    await expect(
      adapter.createInitialProject({
        operationId: "operation:initial",
        projectId: "project:initial",
        name: "My Project",
        sources: ["/workspace/default"],
        starterPage: {
          pageId: "page:getting-started",
          documentId: "document:getting-started",
          titleMarkdown: "Welcome to Nodex",
          nfm: "Welcome to Nodex.",
        },
      }),
    ).resolves.toMatchObject({
      project: { id: "project:initial", name: "My Project" },
    });
    expect(client.workspaceReads).toEqual([
      { kind: "project_bootstrap" },
      { kind: "project", project_id: "project:initial" },
    ]);
    expect(client.workspaceApplies).toEqual([
      {
        operationId: "operation:initial",
        intent: {
          kind: "create_initial_project",
          project_id: "project:initial",
          name: "My Project",
          description: "",
          appearance: null,
          source_roots: ["/workspace/default"],
          starter_page: {
            page_id: "page:getting-started",
            document_id: "document:getting-started",
            title_markdown: "Welcome to Nodex",
            nfm: "Welcome to Nodex.",
          },
        },
      },
    ]);
  });

  test("maps one bounded Project activity summary batch", async () => {
    const client = new FakeCoreClient();
    client.enqueueWorkspaceRead({
      contract_version: 6,
      commit_head: 5,
      store_epoch: "epoch:test",
      value: {
        kind: "project_activity_summaries",
        summaries: [
          {
            project_id: "project:one",
            task_count: 72,
            waiting_count: 2,
            unread_count: 3,
            active_count: 4,
          },
        ],
        projection_revision: 11,
      },
    });
    const adapter = createCoreProjectWorkspaceAdapter(client);

    await expect(adapter.readProjectActivitySummaries(["project:one"])).resolves.toEqual({
      summaries: [
        {
          projectId: "project:one",
          taskCount: 72,
          waitingCount: 2,
          unreadCount: 3,
          activeCount: 4,
        },
      ],
      projectionRevision: 11,
    });
    expect(client.workspaceReads).toEqual([
      {
        kind: "project_activity_summaries",
        project_ids: ["project:one"],
      },
    ]);
  });

  test("requests archived Projects only when the caller opts into the collection", async () => {
    const client = new FakeCoreClient();
    client.enqueueWorkspaceRead({
      contract_version: 4,
      commit_head: 4,
      store_epoch: "epoch:test",
      value: {
        kind: "project_window",
        projects: {
          items: [project({ lifecycle: "archived", binding_revision: 4 })],
          next_cursor: null,
          authority: { projection_revision: 4 },
        },
      },
    });
    const adapter = createCoreProjectWorkspaceAdapter(client);

    await expect(
      adapter.listProjectWindow({
        includeArchived: true,
        first: 200,
      }),
    ).resolves.toMatchObject({
      items: [
        expect.objectContaining({
          id: "project:one",
          lifecycle: "archived",
          bindingRevision: 4,
        }),
      ],
      nextCursor: null,
    });
    expect(client.workspaceReads).toEqual([
      {
        kind: "project_window",
        include_archived: true,
        window: { after: null, first: 200 },
      },
    ]);
  });

  test("maps one bounded task window without per-Thread Core reads", async () => {
    const client = new FakeCoreClient();
    client.enqueueWorkspaceRead({
      contract_version: 5,
      commit_head: 17,
      store_epoch: "epoch:test",
      value: {
        kind: "task_window",
        tasks: {
          items: [
            {
              session: sessionSummary(),
              thread,
            },
          ],
          next_cursor: "nxc1.next.signature",
          authority: { projection_revision: 17 },
        },
      },
    });
    const adapter = createCoreProjectWorkspaceAdapter(client);

    await expect(
      adapter.listProjectSessionSummaryWindow("project:one", {
        first: 25,
      }),
    ).resolves.toEqual({
      items: [
        expect.objectContaining({
          id: "session:one",
          thread: expect.objectContaining({
            threadId: "thread:one",
            threadPreview: "Preview",
          }),
        }),
      ],
      nextCursor: "nxc1.next.signature",
      hasMore: true,
      projectionRevision: 17,
    });
    expect(client.workspaceReads).toEqual([
      {
        kind: "task_window",
        project_id: "project:one",
        include_archived: false,
        window: {
          after: null,
          first: 25,
        },
      },
    ]);
  });

  test("uses the current binding revision for one Project update aggregate", async () => {
    const client = new FakeCoreClient();
    client.enqueueWorkspaceRead({
      contract_version: 4,
      commit_head: 3,
      store_epoch: "epoch:test",
      value: { kind: "project", project: project() },
    });
    client.enqueueWorkspaceApply({
      value: {
        affected_project_ids: ["project:one"],
        affected_session_ids: [],
        affected_thread_ids: [],
      },
      receipt: {
        operation_id: "operation:update",
        duplicate: false,
        affected_project_ids: ["project:one"],
        affected_session_ids: [],
      },
      event_sequence: 4,
      store_epoch: "epoch:test",
    });
    client.enqueueWorkspaceRead({
      contract_version: 4,
      commit_head: 4,
      store_epoch: "epoch:test",
      value: {
        kind: "project",
        project: project({ binding_revision: 1, name: "Renamed" }),
      },
    });
    const adapter = createCoreProjectWorkspaceAdapter(client);

    await expect(adapter.updateProject("project:one", { name: "Renamed" })).resolves.toMatchObject({
      name: "Renamed",
    });
    expect(client.workspaceApplies).toEqual([
      {
        operationId: expect.any(String),
        intent: {
          kind: "update_project",
          project_id: "project:one",
          expected_binding_revision: 1,
          name: "Renamed",
        },
      },
    ]);
  });

  test("forwards one structured Project appearance atomically", async () => {
    const client = new FakeCoreClient();
    client.enqueueWorkspaceRead({
      contract_version: 6,
      commit_head: 3,
      store_epoch: "epoch:test",
      value: { kind: "project", project: project() },
    });
    client.enqueueWorkspaceApply({
      value: {
        affected_project_ids: ["project:one"],
        affected_session_ids: [],
        affected_thread_ids: [],
      },
      receipt: {
        operation_id: "operation:appearance",
        duplicate: false,
        affected_project_ids: ["project:one"],
        affected_session_ids: [],
      },
      event_sequence: 4,
      store_epoch: "epoch:test",
    });
    const appearance = {
      color: "red" as const,
      marker: { kind: "icon" as const, icon: "heart" as const },
    };
    client.enqueueWorkspaceRead({
      contract_version: 6,
      commit_head: 4,
      store_epoch: "epoch:test",
      value: {
        kind: "project",
        project: project({ binding_revision: 2, appearance, name: "Loved" }),
      },
    });
    const adapter = createCoreProjectWorkspaceAdapter(client);

    await expect(
      adapter.updateProject("project:one", {
        appearance,
        name: "Loved",
        sources: ["/workspace/loved"],
      }),
    ).resolves.toMatchObject({ appearance, name: "Loved" });
    expect(client.workspaceApplies).toEqual([
      {
        operationId: expect.any(String),
        intent: {
          kind: "update_project",
          project_id: "project:one",
          expected_binding_revision: 1,
          appearance,
          name: "Loved",
          source_roots: ["/workspace/loved"],
        },
      },
    ]);
  });

  test("sets Project lifecycle through the target-state Core intent", async () => {
    const client = new FakeCoreClient();
    client.enqueueWorkspaceRead({
      contract_version: 4,
      commit_head: 3,
      store_epoch: "epoch:test",
      value: { kind: "project", project: project() },
    });
    client.enqueueWorkspaceApply({
      value: {
        affected_project_ids: ["project:one"],
        affected_session_ids: [],
        affected_thread_ids: [],
      },
      receipt: {
        operation_id: "operation:lifecycle",
        duplicate: false,
        affected_project_ids: ["project:one"],
        affected_session_ids: [],
      },
      event_sequence: 4,
      store_epoch: "epoch:test",
    });
    client.enqueueWorkspaceRead({
      contract_version: 4,
      commit_head: 4,
      store_epoch: "epoch:test",
      value: {
        kind: "project",
        project: project({ lifecycle: "archived", binding_revision: 2 }),
      },
    });
    const adapter = createCoreProjectWorkspaceAdapter(client);

    await expect(adapter.setProjectLifecycle("project:one", "archived")).resolves.toMatchObject({
      lifecycle: "archived",
      bindingRevision: 2,
    });
    expect(client.workspaceApplies).toEqual([
      {
        operationId: expect.any(String),
        intent: {
          kind: "set_project_lifecycle",
          project_id: "project:one",
          lifecycle: "archived",
        },
      },
    ]);
  });

  test("returns an idempotent lifecycle result without another Core mutation", async () => {
    const client = new FakeCoreClient();
    client.enqueueWorkspaceRead({
      contract_version: 4,
      commit_head: 4,
      store_epoch: "epoch:test",
      value: {
        kind: "project",
        project: project({ lifecycle: "archived", binding_revision: 2 }),
      },
    });
    const adapter = createCoreProjectWorkspaceAdapter(client);

    await expect(adapter.setProjectLifecycle("project:one", "archived")).resolves.toMatchObject({
      lifecycle: "archived",
      bindingRevision: 2,
    });
    expect(client.workspaceApplies).toEqual([]);
  });

  test("reads and replaces one Thread dynamic-tool catalog through its execution context", async () => {
    const client = new FakeCoreClient();
    client.enqueueWorkspaceRead({
      contract_version: 4,
      commit_head: 10,
      store_epoch: "epoch:test",
      value: {
        kind: "execution_context",
        context: {
          thread: {
            ...thread,
            dynamic_tool_catalogs: [
              {
                namespace: "nodex_app",
                toolset_revision: 1,
              },
            ],
            writable_roots: ["/workspace/one", "/workspace/shared"],
          },
          project: project(),
          permission_mode: "auto",
        },
      },
    });
    client.enqueueWorkspaceApply({
      value: {
        affected_project_ids: [],
        affected_session_ids: [],
        affected_thread_ids: ["thread:one"],
      },
      receipt: {
        operation_id: "operation:replace-catalogs",
        duplicate: false,
        affected_project_ids: [],
        affected_session_ids: [],
      },
      event_sequence: 11,
      store_epoch: "epoch:test",
    });
    client.enqueueWorkspaceRead({
      contract_version: 4,
      commit_head: 11,
      store_epoch: "epoch:test",
      value: {
        kind: "execution_context",
        context: {
          thread: {
            ...thread,
            dynamic_tool_catalogs: [
              { namespace: "codex_app", toolset_revision: 2 },
              { namespace: "nodex_app", toolset_revision: 1 },
            ],
          },
          project: project(),
          permission_mode: "auto",
        },
      },
    });
    const adapter = createCoreProjectWorkspaceAdapter(client);

    await expect(adapter.readThreadExecutionContext("thread:one")).resolves.toEqual({
      threadId: "thread:one",
      projectId: "project:one",
      permissionMode: "auto",
      dynamicToolCatalogs: [
        {
          namespace: "nodex_app",
          toolsetRevision: 1,
        },
      ],
      writableRoots: ["/workspace/one", "/workspace/shared"],
    });
    await expect(
      adapter.replaceThreadDynamicToolCatalogs("thread:one", [
        { namespace: "codex_app", toolsetRevision: 2 },
        { namespace: "nodex_app", toolsetRevision: 1 },
      ]),
    ).resolves.toEqual([
      { namespace: "codex_app", toolsetRevision: 2 },
      { namespace: "nodex_app", toolsetRevision: 1 },
    ]);
    expect(client.workspaceApplies).toEqual([
      {
        operationId: expect.any(String),
        intent: {
          kind: "replace_thread_dynamic_tool_catalogs",
          thread_id: "thread:one",
          catalogs: [
            { namespace: "codex_app", toolset_revision: 2 },
            { namespace: "nodex_app", toolset_revision: 1 },
          ],
        },
      },
    ]);
  });

  test("reads and persists a Project permission mode without requiring a Thread", async () => {
    const client = new FakeCoreClient();
    client.enqueueWorkspaceRead({
      contract_version: 4,
      commit_head: 11,
      store_epoch: "epoch:test",
      value: { kind: "project_permission_mode", mode: null },
    });
    client.enqueueWorkspaceApply({
      value: {
        affected_project_ids: ["project:one"],
        affected_session_ids: [],
        affected_thread_ids: [],
      },
      receipt: {
        operation_id: "operation:permission-mode",
        duplicate: false,
        affected_project_ids: ["project:one"],
        affected_session_ids: [],
      },
      event_sequence: 12,
      store_epoch: "epoch:test",
    });
    client.enqueueWorkspaceRead({
      contract_version: 4,
      commit_head: 12,
      store_epoch: "epoch:test",
      value: { kind: "project_permission_mode", mode: "full-access" },
    });
    const adapter = createCoreProjectWorkspaceAdapter(client);

    await expect(adapter.readProjectPermissionMode("project:one")).resolves.toBeNull();
    await expect(adapter.setProjectPermissionMode("project:one", "full-access")).resolves.toBe(
      "full-access",
    );
    expect(client.workspaceReads).toEqual([
      { kind: "project_permission_mode", project_id: "project:one" },
      { kind: "project_permission_mode", project_id: "project:one" },
    ]);
    expect(client.workspaceApplies).toEqual([
      {
        operationId: expect.any(String),
        intent: {
          kind: "set_project_permission_mode",
          project_id: "project:one",
          mode: "full-access",
        },
      },
    ]);
  });

  test("reads and persists the projectless permission mode as a global scope", async () => {
    const client = new FakeCoreClient();
    client.enqueueWorkspaceRead({
      contract_version: 4,
      commit_head: 11,
      store_epoch: "epoch:test",
      value: { kind: "projectless_permission_mode", mode: null },
    });
    client.enqueueWorkspaceApply({
      value: {
        affected_project_ids: [],
        affected_session_ids: [],
        affected_thread_ids: [],
      },
      receipt: {
        operation_id: "operation:projectless-permission-mode",
        duplicate: false,
        affected_project_ids: [],
        affected_session_ids: [],
      },
      event_sequence: 12,
      store_epoch: "epoch:test",
    });
    client.enqueueWorkspaceRead({
      contract_version: 4,
      commit_head: 12,
      store_epoch: "epoch:test",
      value: { kind: "projectless_permission_mode", mode: "full-access" },
    });
    const adapter = createCoreProjectWorkspaceAdapter(client);

    await expect(adapter.readProjectlessPermissionMode()).resolves.toBeNull();
    await expect(adapter.setProjectlessPermissionMode("full-access")).resolves.toBe("full-access");
    expect(client.workspaceReads).toEqual([
      { kind: "projectless_permission_mode" },
      { kind: "projectless_permission_mode" },
    ]);
    expect(client.workspaceApplies).toEqual([
      {
        operationId: expect.any(String),
        intent: {
          kind: "set_projectless_permission_mode",
          mode: "full-access",
        },
      },
    ]);
  });

  test("maps presence-sensitive Thread materialization and existing-only metadata updates", async () => {
    const client = new FakeCoreClient();
    for (const [operationId, eventSequence, persisted] of [
      [
        "operation:upsert-thread",
        11,
        {
          ...thread,
          agent_nickname: "@Scout",
          agent_path: "agents/scout",
        },
      ],
      [
        "operation:update-thread",
        12,
        {
          ...thread,
          thread_name: "Updated Thread",
          status: { status_type: "active" as const, active_flags: [] },
        },
      ],
    ] as const) {
      client.enqueueWorkspaceApply({
        value: {
          affected_project_ids: ["project:one"],
          affected_session_ids: ["session:one"],
          affected_thread_ids: ["thread:one"],
        },
        receipt: {
          operation_id: operationId,
          duplicate: false,
          affected_project_ids: ["project:one"],
          affected_session_ids: ["session:one"],
        },
        event_sequence: eventSequence,
        store_epoch: "epoch:test",
      });
      client.enqueueWorkspaceRead({
        contract_version: 4,
        commit_head: eventSequence,
        store_epoch: "epoch:test",
        value: { kind: "thread", thread: persisted },
      });
    }
    const adapter = createCoreProjectWorkspaceAdapter(client);

    await expect(
      adapter.upsertThread("thread:one", {
        projectId: "project:one",
        agentNickname: "@Scout",
        agentPath: "agents/scout",
        managedWorktreePath: null,
      }),
    ).resolves.toMatchObject({
      agentNickname: "@Scout",
      agentPath: "agents/scout",
    });
    await expect(
      adapter.updateThread("thread:one", {
        threadName: "Updated Thread",
        status: { statusType: "active", activeFlags: [] },
      }),
    ).resolves.toMatchObject({
      threadName: "Updated Thread",
      statusType: "active",
    });
    expect(client.workspaceApplies).toEqual([
      {
        operationId: expect.any(String),
        intent: {
          kind: "upsert_thread",
          thread_id: "thread:one",
          patch: {
            project_id: "project:one",
            agent_nickname: "@Scout",
            agent_path: "agents/scout",
            managed_worktree_path: null,
          },
        },
      },
      {
        operationId: expect.any(String),
        intent: {
          kind: "update_thread",
          thread_id: "thread:one",
          patch: {
            thread_name: "Updated Thread",
            status: { status_type: "active", active_flags: [] },
          },
        },
      },
    ]);
  });

  test("moves a linked Thread aggregate through one native Workspace intent", async () => {
    const client = new FakeCoreClient();
    const movedThread = {
      ...thread,
      project_id: "project:two",
      cwd: "/workspace/two",
      managed_worktree_path: "/workspace/two/.worktrees/task",
      projectless_output_directory: null,
      projectless_workspace_browser_root: null,
    };
    client.enqueueWorkspaceApply({
      value: {
        affected_project_ids: ["project:one", "project:two"],
        affected_session_ids: ["session:one"],
        affected_thread_ids: ["thread:one"],
      },
      receipt: {
        operation_id: "operation:move-thread",
        duplicate: false,
        affected_project_ids: ["project:one", "project:two"],
        affected_session_ids: ["session:one"],
      },
      event_sequence: 13,
      store_epoch: "epoch:test",
    });
    client.enqueueWorkspaceRead({
      contract_version: 4,
      commit_head: 13,
      store_epoch: "epoch:test",
      value: { kind: "thread", thread: movedThread },
    });
    const adapter = createCoreProjectWorkspaceAdapter(client);

    await expect(
      adapter.moveThread({
        threadId: "thread:one",
        sourceProjectId: "project:one",
        targetProjectId: "project:two",
        afterThreadId: "thread:anchor",
        runtimeWorkspaceRoots: ["/workspace/two", "/workspace/one"],
        projectAccessGrant: {
          expectedTargetBindingRevision: 4,
          missingProjectSources: ["/workspace/one"],
        },
        metadata: {
          executionHostId: "ssh:build-box",
          cwd: "/workspace/two",
          managedWorktreePath: "/workspace/two/.worktrees/task",
          projectlessOutputDirectory: null,
          projectlessWorkspaceBrowserRoot: null,
        },
      }),
    ).resolves.toMatchObject({
      thread: {
        threadId: "thread:one",
        projectId: "project:two",
        cwd: "/workspace/two",
      },
      operationId: expect.any(String),
      projectionRevision: 13,
    });
    expect(client.workspaceApplies).toEqual([
      {
        operationId: expect.any(String),
        intent: {
          kind: "move_thread",
          thread_id: "thread:one",
          source: { kind: "project", project_id: "project:one" },
          target: { kind: "project", project_id: "project:two" },
          placement: { kind: "after", thread_id: "thread:anchor" },
          runtime_workspace_roots: ["/workspace/two", "/workspace/one"],
          project_access_grant: {
            expected_target_binding_revision: 4,
            missing_source_roots: ["/workspace/one"],
          },
          metadata: {
            execution_host_id: "ssh:build-box",
            cwd: "/workspace/two",
            managed_worktree_path: "/workspace/two/.worktrees/task",
            projectless_output_directory: null,
            projectless_workspace_browser_root: null,
          },
        },
      },
    ]);
  });

  test("rejects a Thread move anchored to the moving Thread before Core", async () => {
    const client = new FakeCoreClient();
    const adapter = createCoreProjectWorkspaceAdapter(client);

    await expect(
      adapter.moveThread({
        threadId: "thread:one",
        sourceProjectId: "project:one",
        targetProjectId: "project:one",
        beforeThreadId: "thread:one",
      }),
    ).rejects.toThrow("Thread placement anchor must reference another Thread");
    await expect(
      adapter.moveThread({
        threadId: "thread:one",
        sourceProjectId: "project:one",
        targetProjectId: "project:one",
        afterThreadId: "thread:one",
      }),
    ).rejects.toThrow("Thread placement anchor must reference another Thread");
    expect(client.workspaceApplies).toEqual([]);
  });

  test("commits an execution location atomically and maps the lifecycle snapshot", async () => {
    const client = new FakeCoreClient();
    client.enqueueWorkspaceApply({
      value: {
        affected_project_ids: ["project:one"],
        affected_session_ids: ["session:one"],
        affected_thread_ids: ["thread:one"],
      },
      receipt: {
        operation_id: "operation:set-location",
        duplicate: false,
        affected_project_ids: ["project:one"],
        affected_session_ids: ["session:one"],
      },
      event_sequence: 14,
      store_epoch: "epoch:test",
    });
    client.enqueueWorkspaceRead({
      contract_version: 11,
      commit_head: 14,
      store_epoch: "epoch:test",
      value: {
        kind: "thread",
        thread: {
          ...thread,
          execution_host_id: "ssh:build-box",
          cwd: "/worktrees/shared/nested",
          managed_worktree_path: "/worktrees/shared",
          writable_roots: ["/worktrees/shared", "/workspace/additional"],
        },
      },
    });
    client.enqueueWorkspaceRead({
      contract_version: 11,
      commit_head: 14,
      store_epoch: "epoch:test",
      value: {
        kind: "managed_worktree_lifecycle_snapshot",
        snapshot: {
          projection_revision: 14,
          consumers: [
            {
              thread_id: "thread:one",
              project_id: "project:one",
              session_id: "session:one",
              execution_host_id: "ssh:build-box",
              cwd: "/worktrees/shared/nested",
              managed_worktree_path: "/worktrees/shared",
              runtime_workspace_roots: ["/worktrees/shared", "/workspace/additional"],
              archived: false,
              pinned_order: 0,
              status: { status_type: "active", active_flags: [] },
              created_at: 1,
              updated_at: 2,
              linked_at: "2026-07-19T15:00:00.000Z",
            },
          ],
          projects: [
            {
              project_id: "project:one",
              lifecycle: "active",
              sources: [
                { root: "/workspace/one", order: 0 },
                { root: "/workspace/additional", order: 1 },
              ],
              primary_workspace_root: "/workspace/one",
            },
          ],
        },
      },
    });
    const adapter = createCoreProjectWorkspaceAdapter(client);

    await expect(
      adapter.setThreadExecutionLocation("thread:one", {
        executionHostId: "ssh:build-box",
        cwd: "/worktrees/shared/nested",
        managedWorktreePath: "/worktrees/shared",
        runtimeWorkspaceRoots: ["/worktrees/shared", "/workspace/additional"],
        projectlessOutputDirectory: null,
        projectlessWorkspaceBrowserRoot: null,
      }),
    ).resolves.toMatchObject({
      threadId: "thread:one",
      executionHostId: "ssh:build-box",
      cwd: "/worktrees/shared/nested",
      managedWorktreePath: "/worktrees/shared",
    });
    await expect(adapter.readManagedWorktreeLifecycleSnapshot()).resolves.toEqual({
      projectionRevision: 14,
      consumers: [
        {
          threadId: "thread:one",
          projectId: "project:one",
          sessionId: "session:one",
          executionHostId: "ssh:build-box",
          cwd: "/worktrees/shared/nested",
          managedWorktreePath: "/worktrees/shared",
          runtimeWorkspaceRoots: ["/worktrees/shared", "/workspace/additional"],
          archived: false,
          pinnedOrder: 0,
          statusType: "active",
          statusActiveFlags: [],
          createdAt: 1,
          updatedAt: 2,
          linkedAt: "2026-07-19T15:00:00.000Z",
        },
      ],
      projects: [
        {
          projectId: "project:one",
          lifecycle: "active",
          sourceRoots: ["/workspace/one", "/workspace/additional"],
          primaryWorkspaceRoot: "/workspace/one",
        },
      ],
    });
    expect(client.workspaceApplies).toEqual([
      {
        operationId: expect.any(String),
        intent: {
          kind: "set_thread_execution_location",
          thread_id: "thread:one",
          location: {
            execution_host_id: "ssh:build-box",
            cwd: "/worktrees/shared/nested",
            managed_worktree_path: "/worktrees/shared",
            runtime_workspace_roots: ["/worktrees/shared", "/workspace/additional"],
            projectless_output_directory: null,
            projectless_workspace_browser_root: null,
          },
        },
      },
    ]);
    expect(client.workspaceReads).toEqual([
      { kind: "thread", thread_id: "thread:one" },
      { kind: "managed_worktree_lifecycle_snapshot" },
    ]);
  });

  test("reads and commits Thread unread state through Workspace authority", async () => {
    const client = new FakeCoreClient();
    client.enqueueWorkspaceRead({
      contract_version: 4,
      commit_head: 12,
      store_epoch: "epoch:test",
      value: { kind: "thread", thread },
    });
    client.enqueueWorkspaceApply({
      value: {
        affected_project_ids: ["project:one"],
        affected_session_ids: ["session:one"],
        affected_thread_ids: ["thread:one"],
      },
      receipt: {
        operation_id: "operation:thread-unread",
        duplicate: false,
        affected_project_ids: ["project:one"],
        affected_session_ids: ["session:one"],
      },
      event_sequence: 13,
      store_epoch: "epoch:test",
    });
    client.enqueueWorkspaceRead({
      contract_version: 4,
      commit_head: 13,
      store_epoch: "epoch:test",
      value: {
        kind: "thread",
        thread: { ...thread, has_unread_turn: true },
      },
    });
    const adapter = createCoreProjectWorkspaceAdapter(client);

    await expect(adapter.getThread("thread:one")).resolves.toMatchObject({
      threadId: "thread:one",
      sessionId: "session:one",
      hasUnreadTurn: true,
    });
    await expect(adapter.setThreadUnread("thread:one", true)).resolves.toMatchObject({
      threadId: "thread:one",
      sessionId: "session:one",
      hasUnreadTurn: true,
    });
    expect(client.workspaceReads).toEqual([
      { kind: "thread", thread_id: "thread:one" },
      { kind: "thread", thread_id: "thread:one" },
    ]);
    expect(client.workspaceApplies).toEqual([
      {
        operationId: expect.any(String),
        intent: {
          kind: "set_thread_unread",
          thread_id: "thread:one",
          unread: true,
        },
      },
    ]);
  });

  test("merges and replaces Thread writable roots through Workspace intents", async () => {
    const client = new FakeCoreClient();
    for (const [operationId, eventSequence, roots] of [
      ["operation:merge-roots", 13, ["/workspace/one", "/workspace/shared"]],
      ["operation:replace-roots", 14, ["/workspace/final"]],
    ] as const) {
      client.enqueueWorkspaceApply({
        value: {
          affected_project_ids: ["project:one"],
          affected_session_ids: [],
          affected_thread_ids: ["thread:one"],
        },
        receipt: {
          operation_id: operationId,
          duplicate: false,
          affected_project_ids: ["project:one"],
          affected_session_ids: [],
        },
        event_sequence: eventSequence,
        store_epoch: "epoch:test",
      });
      client.enqueueWorkspaceRead({
        contract_version: 4,
        commit_head: eventSequence,
        store_epoch: "epoch:test",
        value: {
          kind: "execution_context",
          context: {
            thread: { ...thread, writable_roots: roots },
            project: project(),
            permission_mode: "auto",
          },
        },
      });
    }
    const adapter = createCoreProjectWorkspaceAdapter(client);

    await expect(
      adapter.mergeThreadWritableRoots("thread:one", ["/workspace/shared"]),
    ).resolves.toEqual(["/workspace/one", "/workspace/shared"]);
    await expect(
      adapter.replaceThreadWritableRoots("thread:one", ["/workspace/final"]),
    ).resolves.toEqual(["/workspace/final"]);
    expect(client.workspaceApplies).toEqual([
      {
        operationId: expect.any(String),
        intent: {
          kind: "merge_thread_writable_roots",
          thread_id: "thread:one",
          roots: ["/workspace/shared"],
        },
      },
      {
        operationId: expect.any(String),
        intent: {
          kind: "replace_thread_writable_roots",
          thread_id: "thread:one",
          roots: ["/workspace/final"],
        },
      },
    ]);
  });

  test("maps Thread archive and delete lifecycle intents with committed sidebars", async () => {
    const client = new FakeCoreClient();
    const enqueueApply = (operationId: string, eventSequence: number) => {
      client.enqueueWorkspaceApply({
        value: {
          affected_project_ids: ["project:one"],
          affected_session_ids: ["session:one"],
          affected_thread_ids: ["thread:one"],
        },
        receipt: {
          operation_id: operationId,
          duplicate: false,
          affected_project_ids: ["project:one"],
          affected_session_ids: ["session:one"],
        },
        event_sequence: eventSequence,
        store_epoch: "epoch:test",
      });
    };
    enqueueApply("operation:archive-thread", 15);
    client.enqueueWorkspaceRead({
      contract_version: 4,
      commit_head: 15,
      store_epoch: "epoch:test",
      value: { kind: "thread", thread: { ...thread, archived: true } },
    });
    enqueueApply("operation:delete-thread", 16);
    const adapter = createCoreProjectWorkspaceAdapter(client);

    await expect(adapter.setThreadArchived("thread:one", true)).resolves.toMatchObject({
      threads: [],
    });
    await expect(adapter.deleteThread("thread:one")).resolves.toMatchObject({
      deleted: true,
      sidebar: { threads: [] },
    });
    expect(client.workspaceReads).toEqual([{ kind: "thread", thread_id: "thread:one" }]);
    expect(client.workspaceApplies).toEqual([
      {
        operationId: expect.any(String),
        intent: {
          kind: "set_thread_archived",
          thread_id: "thread:one",
          archived: true,
        },
      },
      {
        operationId: expect.any(String),
        intent: { kind: "delete_thread", thread_id: "thread:one" },
      },
    ]);
  });

  test("maps and upserts background processes through the Workspace aggregate", async () => {
    const client = new FakeCoreClient();
    const process = {
      id: "thread:one:item:dev",
      thread_id: "thread:one",
      thread_title: "Thread one",
      item_id: "item:dev",
      turn_id: "turn:one",
      command: "pnpm dev",
      cwd: "/workspace/one",
      process_id: "process:one",
      os_pid: 4201,
      terminal_session_id: null,
      source: "app-server" as const,
      started_at_ms: 100,
      updated_at_ms: 200,
    };
    client.enqueueWorkspaceRead({
      contract_version: 4,
      commit_head: 14,
      store_epoch: "epoch:test",
      value: {
        kind: "background_process_window",
        processes: {
          items: [process],
          next_cursor: null,
          authority: { projection_revision: 14 },
        },
      },
    });
    client.enqueueWorkspaceApply({
      value: {
        affected_project_ids: ["project:one"],
        affected_session_ids: [],
        affected_thread_ids: ["thread:one"],
      },
      receipt: {
        operation_id: "operation:upsert-process",
        duplicate: false,
        affected_project_ids: ["project:one"],
        affected_session_ids: [],
      },
      event_sequence: 15,
      store_epoch: "epoch:test",
    });
    client.enqueueWorkspaceRead({
      contract_version: 4,
      commit_head: 15,
      store_epoch: "epoch:test",
      value: {
        kind: "background_process_window",
        processes: {
          items: [
            {
              ...process,
              command: "pnpm dev --host",
              process_id: null,
              os_pid: null,
              terminal_session_id: "terminal:one",
              source: "terminal-action",
              started_at_ms: 300,
              updated_at_ms: 400,
            },
          ],
          next_cursor: null,
          authority: { projection_revision: 15 },
        },
      },
    });
    const adapter = createCoreProjectWorkspaceAdapter(client);

    await expect(adapter.listBackgroundProcesses(" thread:one ")).resolves.toEqual([
      {
        id: "thread:one:item:dev",
        threadId: "thread:one",
        threadTitle: "Thread one",
        itemId: "item:dev",
        turnId: "turn:one",
        command: "pnpm dev",
        cwd: "/workspace/one",
        processId: "process:one",
        osPid: 4201,
        terminalSessionId: null,
        source: "app-server",
        startedAtMs: 100,
        updatedAtMs: 200,
      },
    ]);
    await expect(
      adapter.upsertBackgroundProcess(
        {
          id: "thread:one:item:dev",
          threadId: "thread:one",
          threadTitle: "Thread one",
          itemId: "item:dev",
          turnId: "turn:one",
          command: "pnpm dev --host",
          cwd: "/workspace/one",
          processId: null,
          osPid: null,
          terminalSessionId: "terminal:one",
          source: "terminal-action",
          startedAtMs: 300,
          updatedAtMs: 400,
        },
        { preserveStartedAt: false },
      ),
    ).resolves.toMatchObject({
      command: "pnpm dev --host",
      source: "terminal-action",
      startedAtMs: 300,
      terminalSessionId: "terminal:one",
    });
    expect(client.workspaceReads).toEqual([
      {
        kind: "background_process_window",
        thread_id: "thread:one",
        window: { after: null, first: 200 },
      },
      {
        kind: "background_process_window",
        thread_id: "thread:one",
        window: { after: null, first: 200 },
      },
    ]);
    expect(client.workspaceApplies).toEqual([
      {
        operationId: expect.any(String),
        intent: {
          kind: "upsert_background_process",
          process: {
            id: "thread:one:item:dev",
            thread_id: "thread:one",
            thread_title: "Thread one",
            item_id: "item:dev",
            turn_id: "turn:one",
            command: "pnpm dev --host",
            cwd: "/workspace/one",
            process_id: null,
            os_pid: null,
            terminal_session_id: "terminal:one",
            source: "terminal-action",
            started_at_ms: 300,
            updated_at_ms: 400,
          },
          preserve_started_at: false,
        },
      },
    ]);
  });

  test("returns local snapshots for pinned sidebar mutations", async () => {
    const client = new FakeCoreClient();
    const enqueueApply = (eventSequence: number, operationId: string) =>
      client.enqueueWorkspaceApply({
        value: {
          affected_project_ids: ["project:one"],
          affected_session_ids: [],
          affected_thread_ids: ["thread:one"],
        },
        receipt: {
          operation_id: operationId,
          duplicate: false,
          affected_project_ids: ["project:one"],
          affected_session_ids: [],
        },
        event_sequence: eventSequence,
        store_epoch: "epoch:test",
      });

    enqueueApply(24, "operation:pin-before");
    client.enqueueWorkspaceRead({
      contract_version: 5,
      commit_head: 24,
      store_epoch: "epoch:test",
      value: { kind: "thread", thread: { ...thread, pinned_order: 0 } },
    });
    enqueueApply(25, "operation:pin-at-end");
    client.enqueueWorkspaceRead({
      contract_version: 5,
      commit_head: 25,
      store_epoch: "epoch:test",
      value: { kind: "thread", thread: { ...thread, pinned_order: 0 } },
    });
    enqueueApply(26, "operation:unpin");
    client.enqueueWorkspaceRead({
      contract_version: 5,
      commit_head: 26,
      store_epoch: "epoch:test",
      value: { kind: "thread", thread: { ...thread, pinned_order: null } },
    });
    enqueueApply(27, "operation:reorder-pinned");
    const adapter = createCoreProjectWorkspaceAdapter(client);

    await expect(
      adapter.setThreadPinned("thread:one", true, "thread:anchor"),
    ).resolves.toMatchObject({
      threads: [
        expect.objectContaining({
          threadId: "thread:one",
          pinnedOrder: 0,
        }),
      ],
    });
    await expect(adapter.setThreadPinned("thread:one", true, null)).resolves.toMatchObject({
      threads: [
        expect.objectContaining({
          threadId: "thread:one",
          pinnedOrder: 0,
        }),
      ],
    });
    await expect(
      adapter.setThreadPinned("thread:one", false, "thread:ignored-anchor"),
    ).resolves.toMatchObject({
      threads: [
        expect.objectContaining({
          threadId: "thread:one",
          pinnedOrder: null,
        }),
      ],
    });
    await expect(adapter.reorderPinnedThreads(["thread:one"])).resolves.toMatchObject({
      threads: [],
    });
    expect(client.workspaceReads).toEqual([
      { kind: "thread", thread_id: "thread:one" },
      { kind: "thread", thread_id: "thread:one" },
      { kind: "thread", thread_id: "thread:one" },
    ]);
    expect(client.workspaceApplies).toEqual([
      {
        operationId: expect.any(String),
        intent: {
          kind: "set_thread_pinned",
          thread_id: "thread:one",
          pinned: true,
          placement: {
            kind: "before",
            thread_id: "thread:anchor",
          },
        },
      },
      {
        operationId: expect.any(String),
        intent: {
          kind: "set_thread_pinned",
          thread_id: "thread:one",
          pinned: true,
          placement: { kind: "end" },
        },
      },
      {
        operationId: expect.any(String),
        intent: {
          kind: "set_thread_pinned",
          thread_id: "thread:one",
          pinned: false,
        },
      },
      {
        operationId: expect.any(String),
        intent: {
          kind: "reorder_pinned_threads",
          thread_ids: ["thread:one"],
        },
      },
    ]);
  });

  test("hydrates one complete Session without leaking Core wire casing", async () => {
    const client = new FakeCoreClient();
    client.enqueueWorkspaceRead({
      contract_version: 4,
      commit_head: 5,
      store_epoch: "epoch:test",
      value: {
        kind: "session",
        session: sessionSummary(),
      },
    });
    client.enqueueWorkspaceRead({
      contract_version: 4,
      commit_head: 5,
      store_epoch: "epoch:test",
      value: { kind: "thread", thread },
    });
    const adapter = createCoreProjectWorkspaceAdapter(client);

    await expect(adapter.getProjectSession("session:one")).resolves.toEqual(
      expect.objectContaining({
        id: "session:one",
        displayTitle: "Thread one",
        thread: expect.objectContaining({
          threadId: "thread:one",
          statusType: "idle",
          cwd: "/workspace/one",
        }),
      }),
    );
    expect(client.workspaceReads).toEqual([
      { kind: "session", session_id: "session:one" },
      { kind: "thread", thread_id: "thread:one" },
    ]);
  });

  test("creates one Session through a retry-stable Workspace aggregate", async () => {
    const client = new FakeCoreClient();
    client.enqueueWorkspaceApply({
      value: {
        affected_project_ids: ["project:one"],
        affected_session_ids: ["session:created"],
        affected_thread_ids: [],
      },
      receipt: {
        operation_id: "operation:create-session",
        duplicate: false,
        affected_project_ids: ["project:one"],
        affected_session_ids: ["session:created"],
      },
      event_sequence: 6,
      store_epoch: "epoch:test",
    });
    client.enqueueWorkspaceRead({
      contract_version: 4,
      commit_head: 6,
      store_epoch: "epoch:test",
      value: {
        kind: "session",
        session: sessionSummary({
          id: "session:created",
          thread_id: null,
          display_title: "Created",
          no_thread_fallback_title: "Created",
        }),
      },
    });
    const adapter = createCoreProjectWorkspaceAdapter(client);

    const created = await adapter.createProjectSession({
      projectId: "project:one",
      noThreadFallbackTitle: "Created",
    });

    expect(created).toMatchObject({
      projectId: "project:one",
      noThreadFallbackTitle: "Created",
      thread: null,
    });
    expect(client.workspaceApplies).toEqual([
      {
        operationId: expect.any(String),
        intent: {
          kind: "create_session",
          session_id: expect.any(String),
          project_id: "project:one",
          title: "Created",
        },
      },
    ]);
  });

  test("returns the Core-selected default-draft winner by exact Session identity", async () => {
    const client = new FakeCoreClient();
    client.enqueueWorkspaceApply({
      value: {
        affected_project_ids: ["project:one"],
        affected_session_ids: ["session:default-winner"],
        affected_thread_ids: [],
      },
      receipt: {
        operation_id: "operation:ensure-default-draft",
        duplicate: false,
        affected_project_ids: ["project:one"],
        affected_session_ids: ["session:default-winner"],
      },
      event_sequence: 6,
      store_epoch: "epoch:test",
    });
    client.enqueueWorkspaceRead({
      contract_version: 15,
      commit_head: 6,
      store_epoch: "epoch:test",
      value: {
        kind: "session",
        session: sessionSummary({
          id: "session:default-winner",
          thread_id: null,
          display_title: "New chat",
          no_thread_fallback_title: "New chat",
        }),
      },
    });
    const adapter = createCoreProjectWorkspaceAdapter(client);

    await expect(adapter.ensureDefaultDraftProjectSession("project:one")).resolves.toMatchObject({
      id: "session:default-winner",
      projectId: "project:one",
      noThreadFallbackTitle: "New chat",
      thread: null,
    });
    expect(client.workspaceApplies).toEqual([
      {
        operationId: expect.any(String),
        intent: {
          kind: "ensure_default_draft_session",
          session_id: expect.any(String),
          project_id: "project:one",
          title: "New chat",
        },
      },
    ]);
    expect(client.workspaceReads).toEqual([
      {
        kind: "session",
        session_id: "session:default-winner",
      },
    ]);
  });

  test("updates fallback title in one Session aggregate", async () => {
    const client = new FakeCoreClient();
    const enqueueSession = (eventHead: number, overrides: Record<string, unknown> = {}) =>
      client.enqueueWorkspaceRead({
        contract_version: 4,
        commit_head: eventHead,
        store_epoch: "epoch:test",
        value: {
          kind: "session",
          session: sessionSummary({ thread_id: null, ...overrides }),
        },
      });
    enqueueSession(8);
    client.enqueueWorkspaceApply({
      value: {
        affected_project_ids: ["project:one"],
        affected_session_ids: ["session:one"],
        affected_thread_ids: [],
      },
      receipt: {
        operation_id: "operation:update-session",
        duplicate: false,
        affected_project_ids: ["project:one"],
        affected_session_ids: ["session:one"],
      },
      event_sequence: 9,
      store_epoch: "epoch:test",
    });
    enqueueSession(9, {
      no_thread_fallback_title: "Updated fallback",
      display_title: "Updated fallback",
    });
    const adapter = createCoreProjectWorkspaceAdapter(client);

    await expect(
      adapter.updateProjectSession("session:one", {
        noThreadFallbackTitle: "Updated fallback",
      }),
    ).resolves.toMatchObject({
      noThreadFallbackTitle: "Updated fallback",
    });
    expect(client.workspaceApplies).toEqual([
      {
        operationId: expect.any(String),
        intent: {
          kind: "mutate_session",
          session_id: "session:one",
          intent: {
            kind: "set_fallback_title",
            title: "Updated fallback",
          },
        },
      },
    ]);
  });

  test("upserts and attaches a Thread in one Session aggregate", async () => {
    const client = new FakeCoreClient();
    client.enqueueWorkspaceRead({
      contract_version: 4,
      commit_head: 9,
      store_epoch: "epoch:test",
      value: {
        kind: "session",
        session: sessionSummary({ thread_id: null }),
      },
    });
    client.enqueueWorkspaceRead({
      contract_version: 4,
      commit_head: 9,
      store_epoch: "epoch:test",
      value: { kind: "thread", thread },
    });
    client.enqueueWorkspaceApply({
      value: {
        affected_project_ids: ["project:one"],
        affected_session_ids: ["session:one"],
        affected_thread_ids: ["thread:one"],
      },
      receipt: {
        operation_id: "operation:attach-thread",
        duplicate: false,
        affected_project_ids: ["project:one"],
        affected_session_ids: ["session:one"],
      },
      event_sequence: 10,
      store_epoch: "epoch:test",
    });
    client.enqueueWorkspaceRead({
      contract_version: 4,
      commit_head: 10,
      store_epoch: "epoch:test",
      value: {
        kind: "session",
        session: sessionSummary(),
      },
    });
    client.enqueueWorkspaceRead({
      contract_version: 4,
      commit_head: 10,
      store_epoch: "epoch:test",
      value: {
        kind: "thread",
        thread: {
          ...thread,
          thread_name: "Attached",
          managed_worktree_path: null,
          status: { status_type: "active", active_flags: ["waitingOnApproval"] },
          updated_at: 12,
        },
      },
    });
    const adapter = createCoreProjectWorkspaceAdapter(client);

    await expect(
      adapter.upsertProjectSessionThreadLink({
        sessionId: "session:one",
        projectId: "project:one",
        threadId: "thread:one",
        forkedFromId: null,
        threadSource: "user",
        serviceName: "service:test",
        agentNickname: "Scout",
        agentRole: "researcher",
        agentPath: "agents/scout",
        threadName: "Attached",
        executionHostId: "local",
        runtimeWorkspaceRoots: ["/workspace/one", "/workspace/additional"],
        cwd: "/workspace/one",
        managedWorktreePath: null,
        statusType: "active",
        statusActiveFlags: ["waitingOnApproval"],
        updatedAt: 12,
      }),
    ).resolves.toMatchObject({
      sessionId: "session:one",
      threadId: "thread:one",
      threadName: "Attached",
      statusType: "active",
    });
    expect(client.workspaceApplies).toEqual([
      {
        operationId: expect.any(String),
        intent: {
          kind: "mutate_session",
          session_id: "session:one",
          intent: {
            kind: "link_thread",
            thread_id: "thread:one",
            expected_project_id: "project:one",
            thread_patch: {
              project_id: "project:one",
              forked_from_id: null,
              thread_source: "user",
              service_name: "service:test",
              agent_nickname: "Scout",
              agent_role: "researcher",
              agent_path: "agents/scout",
              thread_name: "Attached",
              thread_preview: "Preview",
              model_provider: "openai",
              status: {
                status_type: "active",
                active_flags: ["waitingOnApproval"],
              },
              archived: false,
              updated_at: 12,
            },
            execution_location: {
              execution_host_id: "local",
              cwd: "/workspace/one",
              managed_worktree_path: null,
              runtime_workspace_roots: ["/workspace/one", "/workspace/additional"],
              projectless_output_directory: null,
              projectless_workspace_browser_root: null,
            },
          },
        },
      },
    ]);
  });
});
