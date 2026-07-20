import { describe, expect, test } from "vitest";

import { createCoreProjectWorkspaceAdapter } from "./project-workspace-adapter";
import { mapCoreProjectWorkspaceEvent } from "./desktop-project-workspace-bridge";
import { FakeCoreClient } from "./testing/fake-core-client";

const project = (overrides: Record<string, unknown> = {}) => ({
  id: "project:one",
  library_id: "library:test",
  database_id: "database:one",
  lifecycle: "active" as const,
  binding_revision: 1,
  name: "One",
  description: "First Project",
  icon: "📘",
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
  left_pane_collapsed: false,
  thread_id: "thread:one",
  created_at: "2026-07-19T15:00:00.000Z",
  updated_at: "2026-07-19T15:01:00.000Z",
  ...overrides,
});

const emptyPanel = (id: string) => ({
  collapsed: true,
  layout: {
    version: 2 as const,
    root: {
      type: "leaf" as const,
      id,
      tabIds: [],
      activeTabId: null,
      mruTabIds: [],
    },
    activeLeafId: id,
    mruLeafIds: [id],
    maximizedLeafId: null,
  },
  size: {},
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
  thread_preview: "Preview",
  model_provider: "openai",
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
  linked_at: "2026-07-19T15:00:00.000Z",
};

describe("Core Project Workspace adapter", () => {
  test("maps Workspace events into authority-neutral invalidations", () => {
    expect(mapCoreProjectWorkspaceEvent({
      protocol_version: 1,
      event: {
        version: 1,
        sequence: 3,
        store_epoch: "epoch:test",
        operation_id: "operation:workspace",
        committed_at: "2026-07-19T15:02:00.000Z",
        payload: {
          module: "project_workspace",
          event: {
            kind: "workspace_changed",
            project_ids: ["project:one"],
            session_ids: ["session:one"],
            thread_ids: ["thread:one"],
          },
        },
      },
    })).toEqual({
      projectIds: ["project:one"],
      sessionIds: ["session:one"],
      threadIds: ["thread:one"],
    });
  });

  test("maps Project reads and preserves Date values at the IPC boundary", async () => {
    const client = new FakeCoreClient();
    client.enqueueWorkspaceRead({
      version: 1,
      event_head: 3,
      store_epoch: "epoch:test",
      value: {
        kind: "startup",
        projects: [project()],
        sessions: [],
      },
    });
    const adapter = createCoreProjectWorkspaceAdapter(client);

    const projects = await adapter.listProjects();

    expect(projects).toEqual([
      expect.objectContaining({
        id: "project:one",
        databaseId: "database:one",
        primaryWorkspaceRoot: "/workspace/one",
        created: new Date("2026-07-19T15:00:00.000Z"),
      }),
    ]);
    expect(client.workspaceReads).toEqual([{ kind: "startup" }]);
  });

  test("uses the current binding revision for one Project update aggregate", async () => {
    const client = new FakeCoreClient();
    client.enqueueWorkspaceRead({
      version: 1,
      event_head: 3,
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
      version: 1,
      event_head: 4,
      store_epoch: "epoch:test",
      value: {
        kind: "project",
        project: project({ binding_revision: 1, name: "Renamed" }),
      },
    });
    const adapter = createCoreProjectWorkspaceAdapter(client);

    await expect(
      adapter.updateProject("project:one", { name: "Renamed" }),
    ).resolves.toMatchObject({ name: "Renamed" });
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

  test("reads and replaces one Thread dynamic-tool catalog through its execution context", async () => {
    const client = new FakeCoreClient();
    client.enqueueWorkspaceRead({
      version: 1,
      event_head: 10,
      store_epoch: "epoch:test",
      value: {
        kind: "execution_context",
        context: {
          thread: {
            ...thread,
            dynamic_tool_catalogs: [{
              namespace: "nodex_app",
              toolset_revision: 1,
            }],
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
      version: 1,
      event_head: 11,
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

    await expect(
      adapter.readThreadExecutionContext("thread:one"),
    ).resolves.toEqual({
      threadId: "thread:one",
      projectId: "project:one",
      permissionMode: "auto",
      dynamicToolCatalogs: [{
        namespace: "nodex_app",
        toolsetRevision: 1,
      }],
      writableRoots: ["/workspace/one", "/workspace/shared"],
    });
    await expect(adapter.replaceThreadDynamicToolCatalogs("thread:one", [
      { namespace: "codex_app", toolsetRevision: 2 },
      { namespace: "nodex_app", toolsetRevision: 1 },
    ])).resolves.toEqual([
      { namespace: "codex_app", toolsetRevision: 2 },
      { namespace: "nodex_app", toolsetRevision: 1 },
    ]);
    expect(client.workspaceApplies).toEqual([{
      operationId: expect.any(String),
      intent: {
        kind: "replace_thread_dynamic_tool_catalogs",
        thread_id: "thread:one",
        catalogs: [
          { namespace: "codex_app", toolset_revision: 2 },
          { namespace: "nodex_app", toolset_revision: 1 },
        ],
      },
    }]);
  });

  test("hydrates one complete Session without leaking Core wire casing", async () => {
    const client = new FakeCoreClient();
    client.enqueueWorkspaceRead({
      version: 1,
      event_head: 5,
      store_epoch: "epoch:test",
      value: {
        kind: "session",
        session: sessionSummary(),
        panels: {
          right: emptyPanel("right:root"),
          bottom: emptyPanel("bottom:root"),
        },
        tabs: [],
      },
    });
    client.enqueueWorkspaceRead({
      version: 1,
      event_head: 5,
      store_epoch: "epoch:test",
      value: { kind: "thread", thread },
    });
    const adapter = createCoreProjectWorkspaceAdapter(client);

    await expect(adapter.getProjectSession("session:one")).resolves.toEqual(
      expect.objectContaining({
        id: "session:one",
        displayTitle: "Thread one",
        leftPaneCollapsed: false,
        thread: expect.objectContaining({
          threadId: "thread:one",
          statusType: "idle",
          cwd: "/workspace/one",
        }),
        tabs: [],
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
      version: 1,
      event_head: 6,
      store_epoch: "epoch:test",
      value: {
        kind: "session",
        session: sessionSummary({
          id: "session:created",
          thread_id: null,
          display_title: "Created",
          no_thread_fallback_title: "Created",
        }),
        panels: {
          right: emptyPanel("right:root"),
          bottom: emptyPanel("bottom:root"),
        },
        tabs: [],
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

  test("creates a browser tab through one Session aggregate", async () => {
    const client = new FakeCoreClient();
    client.enqueueWorkspaceApply({
      value: {
        affected_project_ids: ["project:one"],
        affected_session_ids: ["session:one"],
        affected_thread_ids: [],
      },
      receipt: {
        operation_id: "operation:create-tab",
        duplicate: false,
        affected_project_ids: ["project:one"],
        affected_session_ids: ["session:one"],
      },
      event_sequence: 7,
      store_epoch: "epoch:test",
    });
    client.enqueueWorkspaceRead({
      version: 1,
      event_head: 7,
      store_epoch: "epoch:test",
      value: {
        kind: "session",
        session: sessionSummary({ thread_id: null }),
        panels: {
          right: emptyPanel("right:root"),
          bottom: emptyPanel("bottom:root"),
        },
        tabs: [{
          id: "tab:browser",
          session_id: "session:one",
          project_id: "project:one",
          browser_tab_id: "browser:one",
          panel_id: "right",
          kind: "browser",
          title: "Browser",
          order: 0,
          config: { projectId: "project:one", url: "https://example.test" },
          state_key: 0,
          state: {},
          created_at: "2026-07-19T15:02:00.000Z",
          updated_at: "2026-07-19T15:02:00.000Z",
        }],
      },
    });
    const adapter = createCoreProjectWorkspaceAdapter(client);

    await expect(adapter.createProjectSessionTab({
      sessionId: "session:one",
      projectId: "project:one",
      panelId: "right",
      clientTabId: "tab:browser",
      browserTabId: "browser:one",
      kind: "browser",
      title: "Browser",
      config: { projectId: "project:one", url: "https://example.test" },
    })).resolves.toMatchObject({
      id: "tab:browser",
      browserTabId: "browser:one",
      config: { projectId: "project:one" },
    });
    expect(client.workspaceApplies).toEqual([{
      operationId: expect.any(String),
      intent: {
        kind: "mutate_session",
        session_id: "session:one",
        intent: {
          kind: "create_tab",
          tab_id: "tab:browser",
          panel_id: "right",
          target_leaf_id: null,
          browser_tab_id: "browser:one",
          tab_kind: "browser",
          title: "Browser",
          config: { projectId: "project:one", url: "https://example.test" },
        },
      },
    }]);
  });

  test("updates tab metadata and state in one native aggregate", async () => {
    const client = new FakeCoreClient();
    const coreTab = (overrides: Record<string, unknown> = {}) => ({
      id: "tab:browser",
      session_id: "session:one",
      project_id: "project:one",
      browser_tab_id: "browser:one",
      panel_id: "right" as const,
      kind: "browser" as const,
      title: "Browser",
      order: 0,
      config: { projectId: "project:one" },
      state_key: 0,
      state: {},
      created_at: "2026-07-19T15:02:00.000Z",
      updated_at: "2026-07-19T15:02:00.000Z",
      ...overrides,
    });
    client.enqueueWorkspaceRead({
      version: 1,
      event_head: 7,
      store_epoch: "epoch:test",
      value: { kind: "session_tab", tab: coreTab() },
    });
    client.enqueueWorkspaceApply({
      value: {
        affected_project_ids: ["project:one"],
        affected_session_ids: ["session:one"],
        affected_thread_ids: [],
      },
      receipt: {
        operation_id: "operation:update-tab",
        duplicate: false,
        affected_project_ids: ["project:one"],
        affected_session_ids: ["session:one"],
      },
      event_sequence: 8,
      store_epoch: "epoch:test",
    });
    client.enqueueWorkspaceRead({
      version: 1,
      event_head: 8,
      store_epoch: "epoch:test",
      value: {
        kind: "session_tab",
        tab: coreTab({ title: "Updated", state_key: 2, state: { scrollY: 4 } }),
      },
    });
    const adapter = createCoreProjectWorkspaceAdapter(client);

    await expect(adapter.updateProjectSessionTab("tab:browser", {
      title: "Updated",
      stateKey: 2,
      state: { scrollY: 4 },
    })).resolves.toMatchObject({
      title: "Updated",
      stateKey: 2,
      state: { scrollY: 4 },
    });
    expect(client.workspaceApplies).toEqual([{
      operationId: expect.any(String),
      intent: {
        kind: "mutate_session",
        session_id: "session:one",
        intent: {
          kind: "update_tab",
          tab_id: "tab:browser",
          title: "Updated",
          state_key: 2,
          state: { scrollY: 4 },
        },
      },
    }]);
  });

  test("updates fallback title and view state in one Session aggregate", async () => {
    const client = new FakeCoreClient();
    const enqueueSession = (
      eventHead: number,
      overrides: Record<string, unknown> = {},
      bottomOverrides: Record<string, unknown> = {},
    ) => client.enqueueWorkspaceRead({
      version: 1,
      event_head: eventHead,
      store_epoch: "epoch:test",
      value: {
        kind: "session",
        session: sessionSummary({ thread_id: null, ...overrides }),
        panels: {
          right: emptyPanel("right:root"),
          bottom: { ...emptyPanel("bottom:root"), ...bottomOverrides },
        },
        tabs: [],
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
    enqueueSession(
      9,
      {
        no_thread_fallback_title: "Updated fallback",
        display_title: "Updated fallback",
        left_pane_collapsed: true,
      },
      { collapsed: false, size: { heightPx: 360 } },
    );
    const adapter = createCoreProjectWorkspaceAdapter(client);

    await expect(adapter.updateProjectSession("session:one", {
      noThreadFallbackTitle: "Updated fallback",
      leftPaneCollapsed: true,
      panels: { bottom: { collapsed: false, size: { heightPx: 360 } } },
    })).resolves.toMatchObject({
      noThreadFallbackTitle: "Updated fallback",
      leftPaneCollapsed: true,
      panels: { bottom: { collapsed: false, size: { heightPx: 360 } } },
    });
    expect(client.workspaceApplies).toEqual([{
      operationId: expect.any(String),
      intent: {
        kind: "mutate_session",
        session_id: "session:one",
        intent: {
          kind: "patch_view_state",
          fallback_title: "Updated fallback",
          left_pane_collapsed: true,
          bottom_panel: {
            collapsed: false,
            size: { height_px: 360 },
          },
        },
      },
    }]);
  });

  test("upserts and attaches a Thread in one Session aggregate", async () => {
    const client = new FakeCoreClient();
    client.enqueueWorkspaceRead({
      version: 1,
      event_head: 9,
      store_epoch: "epoch:test",
      value: {
        kind: "session",
        session: sessionSummary({ thread_id: null }),
        panels: {
          right: emptyPanel("right:root"),
          bottom: emptyPanel("bottom:root"),
        },
        tabs: [],
      },
    });
    client.enqueueWorkspaceRead({
      version: 1,
      event_head: 9,
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
      version: 1,
      event_head: 10,
      store_epoch: "epoch:test",
      value: {
        kind: "session",
        session: sessionSummary(),
        panels: {
          right: emptyPanel("right:root"),
          bottom: emptyPanel("bottom:root"),
        },
        tabs: [],
      },
    });
    client.enqueueWorkspaceRead({
      version: 1,
      event_head: 10,
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

    await expect(adapter.upsertProjectSessionThreadLink({
      sessionId: "session:one",
      projectId: "project:one",
      threadId: "thread:one",
      forkedFromId: null,
      threadName: "Attached",
      managedWorktreePath: null,
      statusType: "active",
      statusActiveFlags: ["waitingOnApproval"],
      updatedAt: 12,
    })).resolves.toMatchObject({
      sessionId: "session:one",
      threadId: "thread:one",
      threadName: "Attached",
      statusType: "active",
    });
    expect(client.workspaceApplies).toEqual([{
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
            thread_name: "Attached",
            thread_preview: "Preview",
            model_provider: "openai",
            managed_worktree_path: null,
            status: {
              status_type: "active",
              active_flags: ["waitingOnApproval"],
            },
            archived: false,
            updated_at: 12,
          },
        },
      },
    }]);
  });
});
