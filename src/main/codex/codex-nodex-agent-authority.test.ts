import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";

import { closeDatabase, getDb, initializeDatabase } from "../local-store/database";
import { createProject } from "../local-store/projects";
import {
  canAutoApproveNodexAgentWrite,
  CodexNodexAgentAuthorityRegistry,
  resolveNodexAgentWriteAccess,
} from "./codex-nodex-agent-authority";

let tempDirectory = "";

beforeEach(async () => {
  closeDatabase();
  tempDirectory = fs.mkdtempSync(
    path.join(os.tmpdir(), "nodex-turn-authority-"),
  );
  process.env.NODEX_DIR = tempDirectory;
  await initializeDatabase();
});

afterEach(() => {
  closeDatabase();
  delete process.env.NODEX_DIR;
  fs.rmSync(tempDirectory, { recursive: true, force: true });
});

describe("CodexNodexAgentAuthorityRegistry", () => {
  test("projects write access from frozen scope, task grants, and presentation availability", () => {
    expect(resolveNodexAgentWriteAccess({
      authorityScope: "project",
      hasActorProject: true,
      hasBroker: true,
      hasTaskGrant: false,
      hasPresentationTarget: true,
    })).toBe("consent_required");
    expect(resolveNodexAgentWriteAccess({
      authorityScope: "project",
      hasActorProject: true,
      hasBroker: true,
      hasTaskGrant: true,
      hasPresentationTarget: false,
    })).toBe("granted");
    expect(resolveNodexAgentWriteAccess({
      authorityScope: "project",
      hasActorProject: true,
      hasBroker: true,
      hasTaskGrant: false,
      hasPresentationTarget: false,
    })).toBe("unavailable");
    expect(resolveNodexAgentWriteAccess({
      authorityScope: "library",
      hasActorProject: true,
      hasBroker: false,
      hasTaskGrant: false,
      hasPresentationTarget: false,
    })).toBe("granted");
  });

  test("binds only the built-in Full access preset to Library scope", () => {
    const project = createProject({ name: "Turn authority" });
    const registry = new CodexNodexAgentAuthorityRegistry();
    const projectLaunch = registry.beginTurn({
      threadId: "thread-project",
      rootThreadId: "thread-project",
      actorProjectId: project.id,
      builtinFullAccess: false,
    });
    const libraryLaunch = registry.beginTurn({
      threadId: "thread-library",
      rootThreadId: "thread-library",
      actorProjectId: project.id,
      builtinFullAccess: true,
    });

    expect(registry.bindTurn(projectLaunch, "turn-project")).toMatchObject({
      scope: "project",
      source: "project_turn",
    });
    expect(registry.bindTurn(libraryLaunch, "turn-library")).toMatchObject({
      scope: "library",
      source: "builtin_full_access",
    });
    expect(getDb().prepare(`
      SELECT permission_profile_id AS permissionProfileId
      FROM nodex_agent_turn_authorities
      WHERE thread_id = 'thread-library' AND turn_id = 'turn-library'
    `).get()).toEqual({ permissionProfileId: ":danger-full-access" });
  });

  test("accepts notification-first binding and response confirmation idempotently", () => {
    const project = createProject({ name: "Notification race" });
    const registry = new CodexNodexAgentAuthorityRegistry();
    const launch = registry.beginTurn({
      threadId: "thread-race",
      rootThreadId: "thread-race",
      actorProjectId: project.id,
      builtinFullAccess: true,
    });

    expect(registry.observeTurnStarted("thread-race", "turn-race")).toMatchObject({
      scope: "library",
    });
    expect(registry.bindTurn(launch, "turn-race")).toMatchObject({
      turnId: "turn-race",
      scope: "library",
    });
    expect(() => registry.bindTurn(launch, "turn-other")).toThrow(
      /already bound to Turn turn-race/u,
    );
  });

  test("uses a Project fallback only when exact historical provenance is absent", () => {
    const project = createProject({ name: "Fallback authority" });
    const registry = new CodexNodexAgentAuthorityRegistry();

    expect(registry.capture({
      threadId: "thread-old",
      turnId: "turn-old",
      rootThreadId: "thread-old",
      actorProjectId: project.id,
    })).toMatchObject({
      scope: "project",
      source: "project_turn",
    });

    const launch = registry.beginTurn({
      threadId: "thread-stale",
      rootThreadId: "thread-stale",
      actorProjectId: project.id,
      builtinFullAccess: true,
    });
    registry.bindTurn(launch, "turn-stale");
    getDb().prepare(`
      UPDATE block_store_metadata SET store_epoch = 'restored-store'
      WHERE id = 1
    `).run();
    expect(registry.capture({
      threadId: "thread-stale",
      turnId: "turn-stale",
      rootThreadId: "thread-stale",
      actorProjectId: project.id,
    })).toBeNull();
  });

  test("inherits one background child Turn without affecting its next Turn", () => {
    const project = createProject({ name: "Inherited authority" });
    const registry = new CodexNodexAgentAuthorityRegistry();
    const parentLaunch = registry.beginTurn({
      threadId: "thread-parent",
      rootThreadId: "thread-parent",
      actorProjectId: project.id,
      builtinFullAccess: true,
    });
    const parentAuthority = registry.bindTurn(parentLaunch, "turn-parent");
    if (!parentAuthority) throw new Error("Parent authority was not bound");

    const childAuthority = registry.inheritTurn({
      threadId: "thread-child",
      turnId: "turn-child-initial",
      rootThreadId: "thread-parent",
      actorProjectId: project.id,
    }, parentAuthority);
    expect(childAuthority).toMatchObject({
      scope: "library",
      source: "inherited_builtin_full_access",
    });
    expect(canAutoApproveNodexAgentWrite(childAuthority, childAuthority)).toBe(true);

    const childFollowUp = registry.beginTurn({
      threadId: "thread-child",
      rootThreadId: "thread-parent",
      actorProjectId: project.id,
      builtinFullAccess: false,
    });
    const projectAuthority = registry.bindTurn(childFollowUp, "turn-child-next");
    expect(projectAuthority).toMatchObject({
      scope: "project",
      source: "project_turn",
    });
    expect(canAutoApproveNodexAgentWrite(projectAuthority, projectAuthority)).toBe(false);
    expect(canAutoApproveNodexAgentWrite(childAuthority, projectAuthority)).toBe(false);
  });

  test("keeps published Turn authority rows immutable", () => {
    const project = createProject({ name: "Immutable authority" });
    const registry = new CodexNodexAgentAuthorityRegistry();
    const launch = registry.beginTurn({
      threadId: "thread-immutable",
      rootThreadId: "thread-immutable",
      actorProjectId: project.id,
      builtinFullAccess: true,
    });
    registry.bindTurn(launch, "turn-immutable");

    expect(() => getDb().prepare(`
      UPDATE nodex_agent_turn_authorities SET scope = 'project'
      WHERE thread_id = 'thread-immutable' AND turn_id = 'turn-immutable'
    `).run()).toThrow("Nodex Agent Turn authorities are immutable");
    expect(() => getDb().prepare(`
      DELETE FROM nodex_agent_turn_authorities
      WHERE thread_id = 'thread-immutable' AND turn_id = 'turn-immutable'
    `).run()).toThrow("Nodex Agent Turn authorities are immutable");
  });
});
