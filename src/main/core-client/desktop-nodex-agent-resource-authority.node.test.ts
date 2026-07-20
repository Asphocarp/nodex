import { describe, expect, test } from "vitest";

import type { NodexAgentResourceAuthorityPort } from "../nodex-agent-resource-authority-port";
import type { RustDataAuthorityRuntime } from "./desktop-data-authority";
import { createDesktopNodexAgentResourceAuthorityPort } from "./desktop-nodex-agent-resource-authority";
import { FakeCoreClient } from "./testing/fake-core-client";

const authority = {
  threadId: "thread:one",
  turnId: "turn:one",
  rootThreadId: "thread:root",
  actorProjectId: "project:one",
  libraryId: "library:test",
  storeEpoch: "epoch:test",
  scope: "project" as const,
  source: "project_turn" as const,
};

const runtimeFor = (client: FakeCoreClient): RustDataAuthorityRuntime => ({
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

const unavailableTypeScript = (): NodexAgentResourceAuthorityPort => ({
  plan: async () => {
    throw new Error("TypeScript Agent resource planner must not run");
  },
  persistProjectGrants: async () => {
    throw new Error("TypeScript Agent grant writer must not run");
  },
});

describe("Desktop Nodex Agent resource authority", () => {
  test("maps exact-Turn planning and Core's resolved Page consent", async () => {
    const client = new FakeCoreClient();
    client.enqueueRead({
      version: 1,
      event_head: 8,
      store_epoch: "epoch:test",
      value: {
        kind: "agent_resource_access_plan",
        value: {
          kind: "consent_required",
          requirements: [{
            intent: {
              target: { kind: "page", page_id: "page:owner" },
              action: "write",
            },
            grant: {
              root: { kind: "page", page_id: "page:owner" },
              access: "read_write",
            },
            reason: "grant_missing",
            persistable: true,
          }],
          inspection_access: {
            kind: "inspection",
            scope: "call",
            thread_id: "thread:one",
            turn_id: "turn:one",
            call_id: "call:one",
            root_thread_id: "thread:root",
            actor_project_id: "project:one",
            library_id: "library:test",
            store_epoch: "epoch:test",
            grants: [{
              root: { kind: "page", page_id: "page:owner" },
              access: "read_write",
            }],
          },
        },
      },
    });
    const port = createDesktopNodexAgentResourceAuthorityPort({
      authority: Promise.resolve(runtimeFor(client)),
      typescript: unavailableTypeScript(),
    });

    await expect(port.plan({
      authority,
      callId: "call:one",
      intents: [{
        target: { kind: "page_or_block", id: "block:nested" },
        action: "write",
      }],
    })).resolves.toEqual({
      kind: "consent_required",
      requirements: [{
        intent: {
          target: { kind: "page", pageId: "page:owner" },
          action: "write",
        },
        grant: {
          root: { kind: "page", pageId: "page:owner" },
          access: "read_write",
        },
        reason: "grant_missing",
        persistable: true,
      }],
      inspectionAccess: {
        kind: "inspection",
        scope: "call",
        threadId: "thread:one",
        turnId: "turn:one",
        callId: "call:one",
        rootThreadId: "thread:root",
        actorProjectId: "project:one",
        libraryId: "library:test",
        storeEpoch: "epoch:test",
        grants: [{
          root: { kind: "page", pageId: "page:owner" },
          access: "read_write",
        }],
      },
    });
    expect(client.reads).toEqual([{
      kind: "plan_agent_resource_access",
      provenance: {
        profile_id: "profile:test",
        authority: {
          thread_id: "thread:one",
          turn_id: "turn:one",
          root_thread_id: "thread:root",
          actor_project_id: "project:one",
          library_id: "library:test",
          store_epoch: "epoch:test",
          scope: "project",
          source: "project_turn",
        },
      },
      call_id: "call:one",
      intents: [{
        target: { kind: "page_or_block", id: "block:nested" },
        action: "write",
      }],
      task_access: null,
    }]);
  });

  test("persists a canonical Project grant batch through one native receipt", async () => {
    const client = new FakeCoreClient();
    client.enqueueApply({
      value: {
        affected_resource_ids: ["page:one"],
        page_copy: null,
        block_transfer: null,
        page_lifecycle: null,
        block_property_mutation: null,
      },
      receipt: {
        operation_id: "agent-grants:one",
        duplicate: false,
        operation_kind: "persist_agent_project_resource_grants",
        did_mutate: true,
        created_target: null,
        affected_parent_keys: [],
        affected_page_ids: ["page:one"],
        affected_database_ids: [],
        affected_view_ids: [],
        committed_revisions: {
          "projectGrant:project:one:page:page:one": 1,
        },
        change_log_seq: 9,
        committed_at: "2026-07-20T09:20:00.000Z",
      },
      event_sequence: 9,
      store_epoch: "epoch:test",
    });
    const port = createDesktopNodexAgentResourceAuthorityPort({
      authority: Promise.resolve(runtimeFor(client)),
      typescript: unavailableTypeScript(),
    });

    await expect(port.persistProjectGrants({
      operationId: "agent-grants:one",
      authority,
      grants: [
        { root: { kind: "page", pageId: "page:one" }, access: "read" },
        { root: { kind: "page", pageId: "page:one" }, access: "read_write" },
      ],
    })).resolves.toBeUndefined();
    expect(client.applies).toEqual([{
      operationId: "agent-grants:one",
      intent: {
        kind: "persist_agent_project_resource_grants",
        provenance: {
          profile_id: "profile:test",
          authority: {
            thread_id: "thread:one",
            turn_id: "turn:one",
            root_thread_id: "thread:root",
            actor_project_id: "project:one",
            library_id: "library:test",
            store_epoch: "epoch:test",
            scope: "project",
            source: "project_turn",
          },
        },
        grants: [{
          root: { kind: "page", page_id: "page:one" },
          access: "read_write",
        }],
      },
    }]);
  });

  test("rejects a Core task overlay outside the frozen Turn boundary", async () => {
    const client = new FakeCoreClient();
    client.enqueueRead({
      version: 1,
      event_head: 8,
      store_epoch: "epoch:test",
      value: {
        kind: "agent_resource_access_plan",
        value: {
          kind: "authorized",
          resource_access: {
            kind: "consent",
            scope: "task",
            root_thread_id: "thread:other",
            actor_project_id: "project:one",
            library_id: "library:test",
            store_epoch: "epoch:test",
            grants: [{
              root: { kind: "page", page_id: "page:one" },
              access: "read_write",
            }],
          },
        },
      },
    });
    const port = createDesktopNodexAgentResourceAuthorityPort({
      authority: Promise.resolve(runtimeFor(client)),
      typescript: unavailableTypeScript(),
    });

    await expect(port.plan({
      authority,
      callId: "call:one",
      intents: [{
        target: { kind: "page", pageId: "page:one" },
        action: "write",
      }],
    })).rejects.toThrow("escaped its Turn authority");
  });
});
