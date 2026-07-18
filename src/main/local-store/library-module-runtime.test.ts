import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";

import { LIBRARY_MODULE_CONTRACT_VERSION } from "../../shared/library-module";
import { createUuidV7 } from "../../shared/uuid-v7";
import {
  parseDatabaseId,
  parseDatabaseViewId,
  parseDataSourceId,
} from "../../shared/database-identities";
import { closeDatabase, getDb, initializeDatabase } from "./database";
import { createPage } from "./database-pages";
import {
  applyLibraryModuleInDatabase,
  readLibraryModuleInDatabase,
} from "./library-module-runtime";
import { createProject, setProjectLifecycle } from "./projects";

let tempDirectory = "";

beforeEach(async () => {
  closeDatabase();
  tempDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "nodex-library-module-"));
  process.env.NODEX_DIR = tempDirectory;
  await initializeDatabase();
});

afterEach(() => {
  closeDatabase();
  delete process.env.NODEX_DIR;
  fs.rmSync(tempDirectory, { recursive: true, force: true });
});

const read = (
  request: Parameters<typeof readLibraryModuleInDatabase>[1]["read"],
) => readLibraryModuleInDatabase(getDb(), {
  version: LIBRARY_MODULE_CONTRACT_VERSION,
  read: request,
});

const metadata = () => {
  const result = read({ mode: "metadata" });
  if (!result.ok) throw new Error(result.error.message);
  return result.value;
};

const apply = (
  operation: Parameters<typeof applyLibraryModuleInDatabase>[1]["operation"],
  operationId = createUuidV7(),
) => applyLibraryModuleInDatabase(getDb(), {
  version: LIBRARY_MODULE_CONTRACT_VERSION,
  operationId,
  storeEpoch: metadata().storeEpoch,
  operation,
});

describe("Library Module runtime", () => {
  test("separates Library navigation roots from Database row Pages", async () => {
    const project = createProject({ name: "Library project" });
    const rowPage = await createPage(project.id, "triage", { title: "Say hi" });

    const roots = read({ mode: "children", parent: { kind: "library" } });
    expect(roots).toMatchObject({
      ok: true,
      value: { value: { kind: "children", total: 2 } },
    });
    if (!roots.ok || roots.value.value.kind !== "children") {
      throw new Error("expected Library children");
    }
    expect(roots.value.value.items).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: "database",
        databaseId: project.databaseId,
        defaultViewId: expect.any(String),
        hasMultipleViews: false,
      }),
    ]));
    expect(roots.value.value.items).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: "page", pageId: rowPage.id }),
    ]));

    const catalog = read({ mode: "catalog", query: "say hi" });
    expect(catalog).toMatchObject({
      ok: true,
      value: {
        value: {
          kind: "catalog",
          items: [{
            target: { kind: "page", pageId: rowPage.id },
            locationLabel: "Cards",
          }],
        },
      },
    });

    const path = read({
      mode: "path",
      target: { kind: "page", pageId: rowPage.id },
    });
    expect(path).toMatchObject({
      ok: true,
      value: {
        value: {
          kind: "path",
          nodes: [{ kind: "database", databaseId: project.databaseId }],
        },
      },
    });
  });

  test("keeps Library content readable after its Project is archived", async () => {
    const project = createProject({ name: "Archived workflow" });
    const page = await createPage(project.id, "triage", { title: "Durable Page" });
    setProjectLifecycle(project.id, { lifecycle: "archived" });

    expect(read({ mode: "catalog", query: "durable" })).toMatchObject({
      ok: true,
      value: {
        value: {
          kind: "catalog",
          items: [{ target: { kind: "page", pageId: page.id } }],
        },
      },
    });
  });

  test("signs bounded cursors and rejects them after Library content changes", async () => {
    const first = createProject({ name: "First" });
    createProject({ name: "Second" });
    const initial = read({
      mode: "children",
      parent: { kind: "library" },
      limit: 1,
    });
    if (!initial.ok || initial.value.value.kind !== "children") {
      throw new Error("expected paged Library children");
    }
    expect(initial.value.value.hasMore).toBe(true);
    expect(initial.value.value.nextCursor).toEqual(expect.any(String));

    await createPage(first.id, "triage", { title: "Changed" });
    expect(read({
      mode: "children",
      parent: { kind: "library" },
      cursor: initial.value.value.nextCursor ?? undefined,
      limit: 1,
    })).toMatchObject({ ok: false, error: { code: "stale_cursor" } });
  });

  test("creates and edits Library-owned structure after every Project is archived", () => {
    const project = createProject({ name: "Compatibility owner" });
    setProjectLifecycle(project.id, { lifecycle: "archived" });
    const pageId = createUuidV7();
    const documentId = createUuidV7();
    const createdPage = apply({
      kind: "create_page",
      pageId,
      documentId,
      title: "Library notes",
      parent: { kind: "library" },
    });
    if (!createdPage.ok) throw new Error(createdPage.error.message);
    expect(createdPage).toMatchObject({
      ok: true,
      value: {
        duplicate: false,
        createdTarget: { kind: "page", pageId },
        affectedParentKeys: ["library"],
      },
    });

    const path = read({ mode: "path", target: { kind: "page", pageId } });
    if (!path.ok || path.value.value.kind !== "path") {
      throw new Error(path.ok ? "expected created Page path" : path.error.message);
    }
    const pageNode = path.value.value.nodes.at(-1);
    if (!pageNode || pageNode.kind !== "page") throw new Error("expected Page node");

    const databaseId = parseDatabaseId(createUuidV7());
    const dataSourceId = parseDataSourceId(createUuidV7());
    const viewId = parseDatabaseViewId(createUuidV7());
    const createdDatabase = apply({
      kind: "create_database",
      databaseId,
      dataSourceId,
      viewId,
      name: "Research",
      parent: {
        kind: "page",
        pageId,
        expectedDocumentGeneration: pageNode.documentGeneration,
        expectedDocumentHeadSeq: pageNode.documentHeadSeq,
      },
    });
    if (!createdDatabase.ok) throw new Error(createdDatabase.error.message);
    expect(createdDatabase).toMatchObject({
      ok: true,
      value: {
        createdTarget: { kind: "database", databaseId },
        affectedParentKeys: [`page:${pageId}`],
      },
    });
    expect(read({
      mode: "children",
      parent: { kind: "page", pageId },
    })).toMatchObject({
      ok: true,
      value: {
        value: {
          items: [{ kind: "database", databaseId, defaultViewId: viewId }],
        },
      },
    });
  });

  test("replays exact structural operations and rejects divergent identity reuse", () => {
    createProject({ name: "Receipt owner" });
    const operationId = createUuidV7();
    const pageId = createUuidV7();
    const request = {
      kind: "create_page" as const,
      pageId,
      documentId: createUuidV7(),
      title: "Idempotent",
      parent: { kind: "library" as const },
    };
    const first = apply(request, operationId);
    if (!first.ok) throw new Error(first.error.message);
    const replay = apply(request, operationId);
    expect(first).toMatchObject({ ok: true, value: { duplicate: false } });
    expect(replay).toMatchObject({
      ok: true,
      value: { duplicate: true, changeLogSeq: first.ok ? first.value.changeLogSeq : -1 },
    });
    expect(apply({ ...request, title: "Divergent" }, operationId)).toMatchObject({
      ok: false,
      error: { code: "identity_conflict" },
    });
  });

  test("moves ownership, archives/restores resources, and keeps Project binding stable", () => {
    const project = createProject({ name: "Workflow" });
    const bindingBefore = getDb().prepare(`
      SELECT database_block_id AS databaseId FROM project_database_bindings
      WHERE project_id = ?
    `).get(project.id) as { readonly databaseId: string };
    const pageId = createUuidV7();
    const created = apply({
      kind: "create_page",
      pageId,
      documentId: createUuidV7(),
      title: "Move me",
      parent: { kind: "library" },
    });
    if (!created.ok) throw new Error(created.error.message);
    const documentBefore = getDb().prepare(`
      SELECT document_id AS documentId FROM pages WHERE block_id = ?
    `).get(pageId) as { readonly documentId: string };
    const pagePath = read({ mode: "path", target: { kind: "page", pageId } });
    if (!pagePath.ok || pagePath.value.value.kind !== "path") {
      throw new Error(pagePath.ok ? "missing Page" : pagePath.error.message);
    }
    const pageNode = pagePath.value.value.nodes.at(-1);
    if (!pageNode || pageNode.kind !== "page") throw new Error("missing Page node");

    const hostId = createUuidV7();
    expect(apply({
      kind: "create_page",
      pageId: hostId,
      documentId: createUuidV7(),
      title: "Host",
      parent: { kind: "library" },
    }).ok).toBe(true);
    const hostPath = read({ mode: "path", target: { kind: "page", pageId: hostId } });
    if (!hostPath.ok || hostPath.value.value.kind !== "path") throw new Error("missing host");
    const hostNode = hostPath.value.value.nodes.at(-1);
    if (!hostNode || hostNode.kind !== "page") throw new Error("missing host node");
    expect(apply({
      kind: "move_block",
      target: {
        kind: "page",
        pageId,
        expectedLocationRevision: pageNode.parentRevision,
      },
      parent: {
        kind: "page",
        pageId: hostId,
        expectedDocumentGeneration: hostNode.documentGeneration,
        expectedDocumentHeadSeq: hostNode.documentHeadSeq,
      },
    })).toMatchObject({ ok: true, value: { affectedParentKeys: ["library", `page:${hostId}`] } });
    expect(getDb().prepare(`
      SELECT document_id AS documentId FROM pages WHERE block_id = ?
    `).get(pageId)).toEqual(documentBefore);
    const nestedPath = read({ mode: "path", target: { kind: "page", pageId } });
    expect(nestedPath).toMatchObject({
      ok: true,
      value: { value: { nodes: [{ pageId: hostId }, { pageId }] } },
    });

    const nestedNode = nestedPath.ok && nestedPath.value.value.kind === "path"
      ? nestedPath.value.value.nodes.at(-1)
      : null;
    if (!nestedNode || nestedNode.kind !== "page") throw new Error("missing nested Page");
    expect(apply({
      kind: "archive_resource",
      target: {
        kind: "page",
        pageId,
        expectedMetadataRevision: nestedNode.metadataRevision,
      },
    })).toMatchObject({ ok: true, value: { operationKind: "archive_resource" } });
    const archived = read({ mode: "catalog", lifecycle: "archived", query: "move me" });
    if (!archived.ok || archived.value.value.kind !== "catalog") throw new Error("missing archive");
    const archivedEntry = archived.value.value.items[0];
    expect(archivedEntry?.target).toEqual({ kind: "page", pageId });
    expect(apply({
      kind: "restore_resource",
      target: {
        kind: "page",
        pageId,
        expectedMetadataRevision: archivedEntry?.metadataRevision ?? -1,
      },
    })).toMatchObject({ ok: true, value: { operationKind: "restore_resource" } });

    expect(getDb().prepare(`
      SELECT database_block_id AS databaseId FROM project_database_bindings
      WHERE project_id = ?
    `).get(project.id)).toEqual(bindingBefore);
    expect(apply({
      kind: "archive_resource",
      target: {
        kind: "database",
        databaseId: parseDatabaseId(project.databaseId),
        expectedMetadataRevision: 1,
      },
    })).toMatchObject({ ok: false, error: { code: "primary_database_bound" } });
  });

  test("grants recursive access without moving or rebinding Library content", () => {
    const owner = createProject({ name: "Owner" });
    const consumer = createProject({ name: "Consumer" });
    const bindingBefore = consumer.databaseId;
    const result = apply({
      kind: "grant_project_access",
      projectId: consumer.id,
      target: {
        kind: "database",
        databaseId: parseDatabaseId(owner.databaseId),
      },
      access: "read_write",
    });
    expect(result).toMatchObject({ ok: true, value: { didMutate: true } });
    expect(getDb().prepare(`
      SELECT access, recursive FROM project_resource_grants
      WHERE project_id = ? AND root_kind = 'database' AND root_id = ?
    `).get(consumer.id, owner.databaseId)).toEqual({
      access: "read_write",
      recursive: 1,
    });
    expect(getDb().prepare(`
      SELECT database_block_id AS databaseId FROM project_database_bindings
      WHERE project_id = ?
    `).get(consumer.id)).toEqual({ databaseId: bindingBefore });
    expect(apply({
      kind: "grant_project_access",
      projectId: consumer.id,
      target: {
        kind: "database",
        databaseId: parseDatabaseId(owner.databaseId),
      },
      access: "read",
    })).toMatchObject({ ok: true, value: { didMutate: false } });
  });
});
