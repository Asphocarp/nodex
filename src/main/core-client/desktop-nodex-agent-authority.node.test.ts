import { describe, expect, test } from "vitest";

import type { NodexAgentAuthorityPort } from "../nodex-agent-authority-port";
import type { RustDataAuthorityRuntime } from "./desktop-data-authority";
import { createDesktopNodexAgentAuthorityPort } from "./desktop-nodex-agent-authority";
import { FakeCoreClient } from "./testing/fake-core-client";

const unavailableTypeScriptPort = (): NodexAgentAuthorityPort => {
  const unavailable = async (): Promise<never> => {
    throw new Error("TypeScript Turn authority fallback must not run");
  };
  return {
    beginTurn: unavailable,
    bindTurn: unavailable,
    observeTurnStarted: unavailable,
    abortTurn: () => undefined,
    inheritTurn: unavailable,
    capturePersisted: unavailable,
    hasRecordedAuthority: unavailable,
    capture: unavailable,
  };
};

const project = {
  id: "project:one",
  library_id: "library:test",
  database_id: "database:one",
  lifecycle: "active" as const,
  binding_revision: 1,
  name: "One",
  description: "First Project",
  icon: "",
  sources: [{ root: "/workspace/one", order: 0 }],
  primary_workspace_root: "/workspace/one",
  pinned: false,
  pinned_order: null,
  created_at: "2026-07-20T00:00:00.000Z",
  updated_at: "2026-07-20T00:00:00.000Z",
};

const authority = {
  thread_id: "thread:one",
  turn_id: "turn:one",
  root_thread_id: "thread:one",
  actor_project_id: "project:one",
  library_id: "library:test",
  store_epoch: "epoch:test",
  scope: "project" as const,
  source: "project_turn" as const,
};

const runtimeFor = (
  client: FakeCoreClient,
): RustDataAuthorityRuntime => ({
  backend: "rust",
  rootClient: Object.assign(client, {
    handshake: {
      library_id: "library:test",
      profile_id: "profile:test",
      store_epoch: "epoch:test",
    },
  }),
  clientForProject: () => client,
  close: async () => undefined,
}) as unknown as RustDataAuthorityRuntime;

describe("Desktop Nodex Agent Turn authority", () => {
  test("freezes and rereads one exact Turn through Project Workspace Core", async () => {
    const client = new FakeCoreClient();
    client.enqueueWorkspaceRead({
      version: 1,
      event_head: 1,
      store_epoch: "epoch:test",
      value: { kind: "project", project },
    });
    client.enqueueWorkspaceApply({
      value: {
        affected_project_ids: ["project:one"],
        affected_session_ids: [],
        affected_thread_ids: ["thread:one"],
      },
      receipt: {
        operation_id: "turn-authority",
        duplicate: false,
        affected_project_ids: ["project:one"],
        affected_session_ids: [],
      },
      event_sequence: 2,
      store_epoch: "epoch:test",
    });
    client.enqueueWorkspaceRead({
      version: 1,
      event_head: 2,
      store_epoch: "epoch:test",
      value: {
        kind: "turn_authority",
        resolution: { persisted: true, authority },
      },
    });
    const port = createDesktopNodexAgentAuthorityPort({
      authority: Promise.resolve(runtimeFor(client)),
      typescript: unavailableTypeScriptPort(),
    });

    const launch = await port.beginTurn({
      threadId: "thread:one",
      rootThreadId: "thread:one",
      actorProjectId: "project:one",
      builtinFullAccess: false,
    });
    await expect(port.bindTurn(launch, "turn:one")).resolves.toEqual({
      threadId: "thread:one",
      turnId: "turn:one",
      rootThreadId: "thread:one",
      actorProjectId: "project:one",
      libraryId: "library:test",
      storeEpoch: "epoch:test",
      scope: "project",
      source: "project_turn",
    });
    expect(client.workspaceApplies).toEqual([
      expect.objectContaining({
        intent: {
          kind: "freeze_turn_authority",
          thread_id: "thread:one",
          turn_id: "turn:one",
          root_thread_id: "thread:one",
          actor_project_id: "project:one",
          source: "project_turn",
        },
      }),
    ]);
    expect(client.workspaceReads.at(-1)).toEqual({
      kind: "turn_authority",
      thread_id: "thread:one",
      turn_id: "turn:one",
      root_thread_id: "thread:one",
      actor_project_id: "project:one",
    });
  });

  test("returns Core's unpersisted Project fallback without freezing it", async () => {
    const client = new FakeCoreClient();
    client.enqueueWorkspaceRead({
      version: 1,
      event_head: 1,
      store_epoch: "epoch:test",
      value: {
        kind: "turn_authority",
        resolution: { persisted: false, authority },
      },
    });
    const port = createDesktopNodexAgentAuthorityPort({
      authority: Promise.resolve(runtimeFor(client)),
      typescript: unavailableTypeScriptPort(),
    });

    await expect(port.capture({
      threadId: "thread:one",
      turnId: "turn:one",
      rootThreadId: "thread:one",
      actorProjectId: "project:one",
    })).resolves.toMatchObject({
      scope: "project",
      source: "project_turn",
    });
    expect(client.workspaceApplies).toEqual([]);
  });

  test("carries exact parent Turn provenance for inherited Library authority", async () => {
    const client = new FakeCoreClient();
    client.enqueueWorkspaceRead({
      version: 1,
      event_head: 1,
      store_epoch: "epoch:test",
      value: { kind: "project", project },
    });
    client.enqueueWorkspaceApply({
      value: {
        affected_project_ids: ["project:one"],
        affected_session_ids: [],
        affected_thread_ids: ["thread:child"],
      },
      receipt: {
        operation_id: "turn-authority-inherited",
        duplicate: false,
        affected_project_ids: ["project:one"],
        affected_session_ids: [],
      },
      event_sequence: 2,
      store_epoch: "epoch:test",
    });
    client.enqueueWorkspaceRead({
      version: 1,
      event_head: 2,
      store_epoch: "epoch:test",
      value: {
        kind: "turn_authority",
        resolution: {
          persisted: true,
          authority: {
            ...authority,
            thread_id: "thread:child",
            turn_id: "turn:child",
            root_thread_id: "thread:root",
            scope: "library",
            source: "inherited_builtin_full_access",
          },
        },
      },
    });
    const port = createDesktopNodexAgentAuthorityPort({
      authority: Promise.resolve(runtimeFor(client)),
      typescript: unavailableTypeScriptPort(),
    });
    const launch = await port.beginTurn({
      threadId: "thread:child",
      rootThreadId: "thread:root",
      actorProjectId: "project:one",
      builtinFullAccess: false,
      inheritedAuthority: {
        threadId: "thread:parent",
        turnId: "turn:parent",
        rootThreadId: "thread:root",
        actorProjectId: "project:one",
        libraryId: "library:test",
        storeEpoch: "epoch:test",
        scope: "library",
        source: "builtin_full_access",
      },
    });

    await expect(port.bindTurn(launch, "turn:child")).resolves.toMatchObject({
      scope: "library",
      source: "inherited_builtin_full_access",
    });
    expect(client.workspaceApplies[0]?.intent).toMatchObject({
      kind: "freeze_turn_authority",
      source: "inherited_builtin_full_access",
      inherited_from: {
        thread_id: "thread:parent",
        turn_id: "turn:parent",
      },
    });
  });
});
