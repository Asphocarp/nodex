import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";

import { initialDataSourceId } from "../../shared/library";
import { createPage } from "./database-pages";
import { closeDatabase, getDb, initializeDatabase } from "./database";
import {
  authorizeProjectResource,
  listProjectResourceGrants,
  putProjectResourceGrant,
  revokeProjectResourceGrant,
} from "./project-resource-grants";
import { createProject, setProjectLifecycle } from "./projects";

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
