import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";

import { initialDataSourceId } from "../../shared/library";
import { createPage } from "./database-pages";
import { closeDatabase, getDb, initializeDatabase } from "./database";
import {
  authorizeNodexAgentResourceInDatabase,
  authorizeProjectResource,
  listProjectResourceGrants,
  putProjectResourceGrant,
  revokeProjectResourceGrant,
} from "./project-resource-grants";
import { requireBlockStoreEpoch } from "./block-store-metadata";
import { createProject, setProjectLifecycle } from "./projects";
import { readPageDetailInDatabase } from "./page-detail";
import { validateBackupStore } from "./backup-store-validation";
import { getDatabasePath } from "./config";

let tempDirectory = "";

beforeEach(async () => {
  closeDatabase();
  tempDirectory = fs.mkdtempSync(
    path.join(os.tmpdir(), "nodex-resource-grants-"),
  );
  process.env.NODEX_DIR = tempDirectory;
  await initializeDatabase();
});

afterEach(() => {
  closeDatabase();
  delete process.env.NODEX_DIR;
  fs.rmSync(tempDirectory, { recursive: true, force: true });
});

describe("Project resource grants", () => {
  test("overlays temporary same-Library access without persisting grants", async () => {
    const actor = createProject({ name: "Full access actor" });
    const foreign = createProject({ name: "Foreign content owner" });
    const page = await createPage(foreign.id, "draft", { title: "Foreign" });
    const database = getDb();
    const library = database.prepare(
      "SELECT library_id AS libraryId FROM projects WHERE id = ?",
    ).get(actor.id) as { readonly libraryId: string };
    const authority = {
      threadId: "thread-full",
      turnId: "turn-full",
      rootThreadId: "thread-full",
      actorProjectId: actor.id,
      libraryId: library.libraryId,
      storeEpoch: requireBlockStoreEpoch(database),
      scope: "library" as const,
      source: "builtin_full_access" as const,
    };

    expect(authorizeProjectResource({
      projectId: actor.id,
      resource: { kind: "page", pageId: page.id },
      action: "write",
    })).toMatchObject({ allowed: false, reason: "grant_missing" });
    expect(authorizeNodexAgentResourceInDatabase(database, {
      authority,
      resource: { kind: "page", pageId: page.id },
      action: "write",
    })).toMatchObject({
      allowed: true,
      source: "thread_full_access",
      effectiveAccess: "read_write",
      grantId: null,
    });
    expect(listProjectResourceGrants(actor.id)).toEqual([]);

    setProjectLifecycle(actor.id, { lifecycle: "archived" });
    expect(authorizeNodexAgentResourceInDatabase(database, {
      authority,
      resource: { kind: "page", pageId: page.id },
      action: "read",
    })).toMatchObject({ allowed: false, reason: "project_read_only" });
    expect(authorizeNodexAgentResourceInDatabase(database, {
      authority,
      resource: { kind: "page", pageId: page.id },
      action: "write",
    })).toMatchObject({ allowed: false, reason: "project_read_only" });
  });

  test("rejects stale Project-scope Turn authority before grant delegation", async () => {
    const actor = createProject({ name: "Stale Project authority" });
    const page = await createPage(actor.id, "draft", { title: "Owned" });
    const database = getDb();
    const coordinate = database.prepare(`
      SELECT library_id AS libraryId FROM projects WHERE id = ?
    `).get(actor.id) as { readonly libraryId: string };
    const authority = {
      threadId: "thread-project",
      turnId: "turn-project",
      rootThreadId: "thread-project",
      actorProjectId: actor.id,
      libraryId: coordinate.libraryId,
      storeEpoch: requireBlockStoreEpoch(database),
      scope: "project" as const,
      source: "project_turn" as const,
    };
    database.prepare(`
      UPDATE block_store_metadata SET store_epoch = 'restored-epoch' WHERE id = 1
    `).run();

    expect(authorizeNodexAgentResourceInDatabase(database, {
      authority,
      resource: { kind: "page", pageId: page.id },
      action: "read",
    })).toMatchObject({ allowed: false, reason: "authority_stale" });
  });

  test("rejects ownership cycles and fails closed on legacy corruption", async () => {
    const project = createProject({ name: "Hierarchy authority" });
    const parent = await createPage(project.id, "draft", { title: "Parent" });
    const child = await createPage(project.id, "draft", { title: "Child" });
    const database = getDb();
    const now = new Date().toISOString();
    const detachFromDataSource = database.prepare(`
      UPDATE data_source_page_memberships
      SET removed_at = ?, revision = revision + 1
      WHERE page_block_id = ? AND removed_at IS NULL
    `);
    const setParent = database.prepare(`
      UPDATE pages
      SET parent_kind = 'page', parent_id = ?,
        parent_revision = parent_revision + 1, updated_at = ?
      WHERE block_id = ?
    `);

    detachFromDataSource.run(now, child.id);
    setParent.run(parent.id, now, child.id);
    detachFromDataSource.run(now, parent.id);
    expect(() => setParent.run(child.id, now, parent.id)).toThrow(
      "Page parent hierarchy must be acyclic and rooted",
    );

    database.exec("DROP TRIGGER pages_validate_hierarchy_update");
    setParent.run(child.id, now, parent.id);

    expect(authorizeProjectResource({
      projectId: project.id,
      resource: { kind: "page", pageId: parent.id },
      action: "read",
    })).toMatchObject({
      allowed: false,
      reason: "resource_hierarchy_corrupt",
    });
    expect(readPageDetailInDatabase(database, project.id, parent.id)).toEqual({
      ok: false,
      error: {
        code: "page_detail_corrupt",
        message: `Page ${parent.id} has an invalid ownership hierarchy`,
        retryable: false,
      },
    });
    expect(() => validateBackupStore(getDatabasePath())).toThrow(
      /invalid ownership hierarchy/u,
    );
  });

  test("follows recursive ownership while reserving Database management", async () => {
    const executor = createProject({ name: "Executor" });
    const foreign = createProject({ name: "Foreign Library work" });
    const ownPage = await createPage(executor.id, "draft", {
      title: "Owned Page",
    });
    const grantedRoot = await createPage(foreign.id, "draft", {
      title: "Granted root",
    });
    const nestedPage = await createPage(foreign.id, "draft", {
      title: "Nested Page",
    });
    const siblingPage = await createPage(foreign.id, "draft", {
      title: "Sibling Page",
    });
    const database = getDb();
    const now = new Date().toISOString();

    database.transaction(() => {
      database.prepare(`
        UPDATE data_source_page_memberships
        SET removed_at = ?, revision = revision + 1
        WHERE page_block_id = ? AND removed_at IS NULL
      `).run(now, nestedPage.id);
      database.prepare(`
        UPDATE pages
        SET parent_kind = 'page', parent_id = ?,
          parent_revision = parent_revision + 1, updated_at = ?
        WHERE block_id = ?
      `).run(grantedRoot.id, now, nestedPage.id);
    })();

    expect(authorizeProjectResource({
      projectId: executor.id,
      resource: { kind: "page", pageId: ownPage.id },
      action: "write",
    })).toMatchObject({
      allowed: true,
      source: "implicit_database_binding",
      effectiveAccess: "read_write",
    });
    expect(authorizeProjectResource({
      projectId: executor.id,
      resource: { kind: "database", databaseId: executor.databaseId },
      action: "manage_schema",
    }).allowed).toBe(true);
    expect(authorizeProjectResource({
      projectId: executor.id,
      resource: { kind: "page", pageId: grantedRoot.id },
      action: "read",
    }).reason).toBe("grant_missing");

    const pageGrant = putProjectResourceGrant({
      projectId: executor.id,
      root: { kind: "page", pageId: grantedRoot.id },
      access: "read",
    });
    for (const pageId of [grantedRoot.id, nestedPage.id]) {
      expect(authorizeProjectResource({
        projectId: executor.id,
        resource: { kind: "page", pageId },
        action: "read",
      })).toMatchObject({
        allowed: true,
        source: "explicit_page_grant",
        grantId: pageGrant.id,
      });
    }
    expect(authorizeProjectResource({
      projectId: executor.id,
      resource: { kind: "page", pageId: siblingPage.id },
      action: "read",
    }).allowed).toBe(false);
    expect(authorizeProjectResource({
      projectId: executor.id,
      resource: {
        kind: "data_source",
        dataSourceId: initialDataSourceId(foreign.databaseId),
      },
      action: "read",
    }).allowed).toBe(false);
    expect(authorizeProjectResource({
      projectId: executor.id,
      resource: { kind: "page", pageId: nestedPage.id },
      action: "write",
    }).reason).toBe("grant_read_only");

    const updatedPageGrant = putProjectResourceGrant({
      projectId: executor.id,
      root: { kind: "page", pageId: grantedRoot.id },
      access: "read_write",
    });
    expect(updatedPageGrant.id).toBe(pageGrant.id);
    expect(updatedPageGrant.revision).toBe(pageGrant.revision + 1);
    expect(authorizeProjectResource({
      projectId: executor.id,
      resource: { kind: "page", pageId: nestedPage.id },
      action: "write",
    }).allowed).toBe(true);
    expect(authorizeProjectResource({
      projectId: executor.id,
      resource: { kind: "page", pageId: nestedPage.id },
      action: "move",
    }).allowed).toBe(true);

    const databaseGrant = putProjectResourceGrant({
      projectId: executor.id,
      root: { kind: "database", databaseId: foreign.databaseId },
      access: "read_write",
    });
    expect(authorizeProjectResource({
      projectId: executor.id,
      resource: { kind: "page", pageId: siblingPage.id },
      action: "write",
    })).toMatchObject({
      allowed: true,
      source: "explicit_database_grant",
      grantId: databaseGrant.id,
    });
    expect(authorizeProjectResource({
      projectId: executor.id,
      resource: {
        kind: "data_source",
        dataSourceId: initialDataSourceId(foreign.databaseId),
      },
      action: "manage_schema",
    }).reason).toBe("structural_capability_required");

    expect(revokeProjectResourceGrant({
      projectId: executor.id,
      grantId: databaseGrant.id,
    })?.lifecycle).toBe("revoked");
    expect(listProjectResourceGrants(executor.id)).toHaveLength(2);
    expect(authorizeProjectResource({
      projectId: executor.id,
      resource: { kind: "page", pageId: siblingPage.id },
      action: "read",
    }).allowed).toBe(false);
  });

  test("makes inactive and archived Projects read-only without deleting access", async () => {
    const project = createProject({ name: "Lifecycle authority" });
    const page = await createPage(project.id, "draft", { title: "Page" });

    setProjectLifecycle(project.id, { lifecycle: "inactive" });
    expect(authorizeProjectResource({
      projectId: project.id,
      resource: { kind: "page", pageId: page.id },
      action: "read",
    }).allowed).toBe(true);
    expect(authorizeProjectResource({
      projectId: project.id,
      resource: { kind: "page", pageId: page.id },
      action: "write",
    }).reason).toBe("project_read_only");

    setProjectLifecycle(project.id, { lifecycle: "archived" });
    expect(authorizeProjectResource({
      projectId: project.id,
      resource: { kind: "page", pageId: page.id },
      action: "read",
    })).toMatchObject({ allowed: true, projectLifecycle: "archived" });
    expect(authorizeProjectResource({
      projectId: project.id,
      resource: { kind: "page", pageId: page.id },
      action: "write",
    }).allowed).toBe(false);
  });
});
