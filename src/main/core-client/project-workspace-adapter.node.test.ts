import { describe, expect, test } from "vitest";

import { createCoreProjectWorkspaceAdapter } from "./project-workspace-adapter";
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
  test("maps Project reads and preserves Date values at the IPC boundary", async () => {
    const client = new FakeCoreClient();
    client.enqueueWorkspaceRead({
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

  test("hydrates one complete Session without leaking Core wire casing", async () => {
    const client = new FakeCoreClient();
    client.enqueueWorkspaceRead({
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
});
