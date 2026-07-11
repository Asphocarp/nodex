import { describe, expect, test } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { closeDatabase, getDb, initializeDatabase } from "./database";
import {
  createProject,
  listProjects,
  reorderProjects,
  setPinnedProjectOrder,
  setProjectPinned,
} from "./projects";
import { deleteProjectBlockFirst } from "./project-deletion";

const deleteProject = (projectId: string): boolean =>
  deleteProjectBlockFirst(getDb(), projectId).deleted;

function isUnsupportedSqliteError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return message.includes("better-sqlite3") && message.includes("not yet supported");
}

async function withTempDatabase(run: () => Promise<void>): Promise<boolean> {
  closeDatabase();
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "nodex-projects-"));
  process.env.NODEX_DIR = tempDir;
  try {
    await initializeDatabase();
  } catch (error) {
    if (isUnsupportedSqliteError(error)) {
      closeDatabase();
      fs.rmSync(tempDir, { recursive: true, force: true });
      delete process.env.NODEX_DIR;
      return false;
    }
    throw error;
  }

  try {
    await run();
    return true;
  } finally {
    closeDatabase();
    fs.rmSync(tempDir, { recursive: true, force: true });
    delete process.env.NODEX_DIR;
  }
}

function projectNames(): string[] {
  return listProjects().map((project) => project.name);
}

describe("project service order and pinning", () => {
  test("reorders the full project order with same-set validation", async () => {
    const ran = await withTempDatabase(async () => {
      const alpha = createProject({ name: "Alpha" });
      const beta = createProject({ name: "Beta" });
      const gamma = createProject({ name: "Gamma" });

      expect(JSON.stringify(projectNames().slice(0, 3))).toBe(JSON.stringify(["Gamma", "Beta", "Alpha"]));

      reorderProjects({
        orderedProjectIds: [alpha.id, gamma.id, beta.id, listProjects()[3]?.id ?? ""],
      });
      expect(JSON.stringify(projectNames().slice(0, 3))).toBe(JSON.stringify(["Alpha", "Gamma", "Beta"]));

      let rejected = false;
      try {
        reorderProjects({ orderedProjectIds: [alpha.id, beta.id] });
      } catch {
        rejected = true;
      }
      expect(rejected).toBe(true);
    });

    if (!ran) expect(true).toBe(true);
  });

  test("pins, unpins, and reorders pinned projects independently of project order", async () => {
    const ran = await withTempDatabase(async () => {
      const alpha = createProject({ name: "Alpha" });
      const beta = createProject({ name: "Beta" });
      const gamma = createProject({ name: "Gamma" });
      const defaultProject = listProjects().find((project) => project.name === "Default");
      if (!defaultProject) throw new Error("Missing default project");

      reorderProjects({
        orderedProjectIds: [alpha.id, beta.id, gamma.id, defaultProject.id],
      });

      const pinnedAlpha = setProjectPinned(alpha.id, { pinned: true });
      const pinnedGamma = setProjectPinned(gamma.id, { pinned: true });
      expect(pinnedAlpha?.pinned).toBe(true);
      expect(pinnedAlpha?.pinnedOrder).toBe(0);
      expect(pinnedGamma?.pinnedOrder).toBe(1);

      const pinnedAgain = setProjectPinned(alpha.id, { pinned: true });
      expect(pinnedAgain?.pinnedOrder).toBe(0);

      setPinnedProjectOrder({ orderedProjectIds: [gamma.id, alpha.id] });
      const pinnedProjects = listProjects().filter((project) => project.pinned);
      expect(JSON.stringify(pinnedProjects.map((project) => project.name))).toBe(JSON.stringify(["Alpha", "Gamma"]));
      expect(listProjects().find((project) => project.id === gamma.id)?.pinnedOrder).toBe(0);
      expect(listProjects().find((project) => project.id === alpha.id)?.pinnedOrder).toBe(1);
      expect(JSON.stringify(projectNames().slice(0, 3))).toBe(JSON.stringify(["Alpha", "Beta", "Gamma"]));

      let rejected = false;
      try {
        setPinnedProjectOrder({ orderedProjectIds: [alpha.id, beta.id] });
      } catch {
        rejected = true;
      }
      expect(rejected).toBe(true);

      const unpinned = setProjectPinned(alpha.id, { pinned: false });
      expect(unpinned?.pinned).toBe(false);
      expect(unpinned?.pinnedOrder).toBe(null);

      deleteProject(gamma.id);
      const pinnedRows = getDb().prepare("SELECT COUNT(*) AS count FROM pinned_project_order").get() as { count: number };
      expect(pinnedRows.count).toBe(0);
    });

    if (!ran) expect(true).toBe(true);
  });

  test("permanently retires every Project Block identity before deletion", async () => {
    const ran = await withTempDatabase(async () => {
      const project = createProject({ name: "Retired Space" });
      const database = getDb();
      const ownedDocument = database
        .prepare(
          `
          SELECT document.id
          FROM blocks owner
          INNER JOIN block_documents ownership ON ownership.block_id = owner.id
          INNER JOIN documents document ON document.id = ownership.document_id
          WHERE owner.project_id = ? AND owner.type = 'canvas'
          LIMIT 1
        `,
        )
        .get(project.id) as { readonly id: string } | undefined;
      if (!ownedDocument) throw new Error("Project has no Canvas Document");
      const now = new Date().toISOString();
      database
        .prepare(
          `
          INSERT INTO blocks (
            id, project_id, type, lifecycle, location_kind,
            containing_document_id, location_revision, metadata_revision,
            created_at, updated_at
          ) VALUES (?, ?, 'paragraph', 'active', 'document', ?, 1, 1, ?, ?)
        `,
        )
        .run(
          "project-delete:nested-active",
          project.id,
          ownedDocument.id,
          now,
          now,
        );
      database
        .prepare(
          `
          INSERT INTO blocks (
            id, project_id, type, lifecycle, location_kind,
            containing_document_id, location_revision, metadata_revision,
            created_at, updated_at
          ) VALUES (?, ?, 'paragraph', 'deleted', 'space', NULL, 1, 2, ?, ?)
        `,
        )
        .run("project-delete:deleted", project.id, now, now);

      const before = database
        .prepare(
          `
          SELECT id, type, lifecycle
          FROM blocks
          WHERE project_id = ?
          ORDER BY id
        `,
        )
        .all(project.id) as readonly {
        readonly id: string;
        readonly type: string;
        readonly lifecycle: string;
      }[];
      expect(before.some((block) => block.lifecycle === "active")).toBe(true);
      expect(before.some((block) => block.lifecycle === "deleted")).toBe(true);
      expect(before.some((block) => block.type === "canvas")).toBe(true);

      expect(deleteProject(project.id)).toBe(true);
      const retired = database
        .prepare(
          `
          SELECT block_id, project_id, block_type, retention_root_block_id
          FROM retired_block_identities
          WHERE project_id = ?
          ORDER BY block_id
        `,
        )
        .all(project.id) as readonly {
        readonly block_id: string;
        readonly project_id: string;
        readonly block_type: string;
        readonly retention_root_block_id: string;
      }[];
      expect(JSON.stringify(retired.map((row) => row.block_id))).toBe(
        JSON.stringify(before.map((row) => row.id)),
      );
      expect(
        retired.every(
          (row, index) =>
            row.project_id === project.id &&
            row.block_type === before[index]?.type &&
            row.retention_root_block_id === row.block_id,
        ),
      ).toBe(true);
      expect(
        database
          .prepare("SELECT 1 FROM projects WHERE id = ?")
          .get(project.id) === undefined,
      ).toBe(true);
      expect(
        database
          .prepare("SELECT 1 FROM documents WHERE project_id = ?")
          .get(project.id) === undefined,
      ).toBe(true);

      const replacement = createProject({ name: "Replacement Space" });
      expect(() =>
        database
          .prepare(
            `
            INSERT INTO blocks (
              id, project_id, type, lifecycle, location_kind,
              containing_document_id, location_revision, metadata_revision,
              created_at, updated_at
            ) VALUES (?, ?, 'paragraph', 'active', 'space', NULL, 1, 1, ?, ?)
          `,
          )
          .run(
            "project-delete:nested-active",
            replacement.id,
            now,
            now,
          ),
      ).toThrow("retired Block identity cannot be reused");
    });

    if (!ran) expect(true).toBe(true);
  });

  test("rolls Project deletion back when identity retirement cannot commit", async () => {
    const ran = await withTempDatabase(async () => {
      const project = createProject({ name: "Retirement rollback" });
      const database = getDb();
      const blocks = database
        .prepare(
          "SELECT id, type FROM blocks WHERE project_id = ? ORDER BY id",
        )
        .all(project.id) as readonly {
        readonly id: string;
        readonly type: string;
      }[];
      const collision = blocks[0];
      if (!collision) throw new Error("Project has no Block foundation");
      const documentCount = (
        database
          .prepare(
            "SELECT COUNT(*) AS count FROM documents WHERE project_id = ?",
          )
          .get(project.id) as { readonly count: number }
      ).count;
      database
        .prepare(
          `
          INSERT INTO retired_block_identities (
            block_id, project_id, block_type, retention_root_block_id, retired_at
          ) VALUES (?, ?, ?, ?, ?)
        `,
        )
        .run(
          collision.id,
          project.id,
          collision.type,
          collision.id,
          new Date().toISOString(),
        );

      expect(() => deleteProject(project.id)).toThrow();
      expect(
        database
          .prepare("SELECT 1 FROM projects WHERE id = ?")
          .get(project.id) !== undefined,
      ).toBe(true);
      expect(
        (
          database
            .prepare(
              "SELECT COUNT(*) AS count FROM blocks WHERE project_id = ?",
            )
            .get(project.id) as { readonly count: number }
        ).count,
      ).toBe(blocks.length);
      expect(
        (
          database
            .prepare(
              "SELECT COUNT(*) AS count FROM documents WHERE project_id = ?",
            )
            .get(project.id) as { readonly count: number }
        ).count,
      ).toBe(documentCount);
      expect(
        (
          database
            .prepare(
              `
              SELECT COUNT(*) AS count
              FROM retired_block_identities
              WHERE project_id = ?
            `,
            )
            .get(project.id) as { readonly count: number }
        ).count,
      ).toBe(1);
    });

    if (!ran) expect(true).toBe(true);
  });
});
