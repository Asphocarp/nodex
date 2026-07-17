import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";

import { CreatePagesV3InputSchema } from "../../shared/nodex-agent-tools";
import {
  executeNodexAgentCreatePages,
  prepareNodexAgentCreatePages,
} from "../agent-tools/create-service";
import { requireBlockStoreEpoch } from "./block-store-metadata";
import { closeDatabase, getDb, initializeDatabase } from "./database";
import {
  applyLibraryContentRehomeInTransaction,
  prepareLibraryContentRehome,
  type LibraryContentRehomeFaultPoint,
} from "./library-content-rehome";
import { createProject } from "./projects";

let tempDirectory = "";

beforeEach(async () => {
  closeDatabase();
  tempDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "nodex-rehome-"));
  process.env.NODEX_DIR = tempDirectory;
  await initializeDatabase();
});

afterEach(() => {
  closeDatabase();
  delete process.env.NODEX_DIR;
  fs.rmSync(tempDirectory, { recursive: true, force: true });
});

describe("Library content rehome", () => {
  test("atomically moves a complete top-level Page ownership closure", () => {
    const source = createProject({ name: "Source owner" });
    const target = createProject({ name: "Target owner" });
    const database = getDb();
    const preparedCreate = prepareNodexAgentCreatePages(database, {
      threadId: "thread-create",
      callId: "call-create",
      projectId: source.id,
      input: CreatePagesV3InputSchema.parse({
        destination: { kind: "library" },
        pages: [{ title: "Rehome me", markdown: "Body\n\t- [ ] Nested" }],
      }),
    });
    if (!preparedCreate.ok || preparedCreate.value.kind !== "prepared") {
      throw new Error(JSON.stringify(preparedCreate));
    }
    const created = executeNodexAgentCreatePages(
      database,
      preparedCreate.value.command,
    );
    if (!created.ok) throw new Error(created.error.message);
    const pageId = preparedCreate.value.command.pages[0]?.pageId;
    if (!pageId) throw new Error("Created Page has no identity");

    const plan = prepareLibraryContentRehome(database, {
      operationId: "rehome:test:complete",
      callIdentity: "a".repeat(64),
      actorProjectId: target.id,
      sourceProjectId: source.id,
      targetProjectId: target.id,
      rootPageIds: [pageId],
      storeEpoch: requireBlockStoreEpoch(database),
    });
    expect(plan.blockIds).toEqual(expect.arrayContaining([
      pageId,
      ...preparedCreate.value.command.pages[0]!.bodyBlockIds,
    ]));

    database.transaction(() => {
      applyLibraryContentRehomeInTransaction(database, plan);
    }).immediate();

    const blockOwners = database.prepare(`
      SELECT DISTINCT project_id AS projectId FROM blocks
      WHERE id IN (${plan.blockIds.map(() => "?").join(", ")})
    `).all(...plan.blockIds) as readonly { readonly projectId: string }[];
    const documentOwners = database.prepare(`
      SELECT DISTINCT project_id AS projectId FROM documents
      WHERE id IN (${plan.documentIds.map(() => "?").join(", ")})
    `).all(...plan.documentIds) as readonly { readonly projectId: string }[];
    expect(blockOwners).toEqual([{ projectId: target.id }]);
    expect(documentOwners).toEqual([{ projectId: target.id }]);
    expect(database.prepare(`
      SELECT project_id AS projectId FROM top_level_block_placements
      WHERE block_id = ?
    `).get(pageId)).toEqual({ projectId: target.id });
    expect(database.prepare(`
      SELECT actor_project_id AS actorProjectId,
        source_project_id AS sourceProjectId,
        target_project_id AS targetProjectId
      FROM library_content_relocations WHERE operation_id = ?
    `).get(plan.operationId)).toEqual({
      actorProjectId: target.id,
      sourceProjectId: source.id,
      targetProjectId: target.id,
    });
    expect(database.prepare(`
      SELECT COUNT(*) AS count FROM library_content_relocation_members
      WHERE operation_id = ?
    `).get(plan.operationId)).toEqual({
      count: plan.blockIds.length + plan.documentIds.length,
    });
    expect(() => database.prepare(`
      UPDATE library_content_relocations SET status = status
      WHERE operation_id = ?
    `).run(plan.operationId)).toThrow("Library content relocations are immutable");
    expect(() => database.prepare(`
      INSERT INTO library_content_relocation_members (
        operation_id, resource_kind, resource_id,
        source_project_id, final_project_id
      ) VALUES (?, 'block', ?, ?, ?)
    `).run(
      plan.operationId,
      "missing-block",
      source.id,
      target.id,
    )).toThrow("Library content relocation member is invalid");
    expect(database.pragma("foreign_key_check")).toEqual([]);
    expect(database.pragma("integrity_check")).toEqual([{ integrity_check: "ok" }]);
  });

  test("rolls back every typed rehome fault boundary", () => {
    const source = createProject({ name: "Rollback source" });
    const target = createProject({ name: "Rollback target" });
    const database = getDb();
    const preparedCreate = prepareNodexAgentCreatePages(database, {
      threadId: "thread-rollback-create",
      callId: "call-rollback-create",
      projectId: source.id,
      input: CreatePagesV3InputSchema.parse({
        destination: { kind: "library" },
        pages: [{ title: "Rollback closure", markdown: "Body" }],
      }),
    });
    if (!preparedCreate.ok || preparedCreate.value.kind !== "prepared") {
      throw new Error(JSON.stringify(preparedCreate));
    }
    const created = executeNodexAgentCreatePages(
      database,
      preparedCreate.value.command,
    );
    if (!created.ok) throw new Error(created.error.message);
    const pageId = preparedCreate.value.command.pages[0]?.pageId;
    if (!pageId) throw new Error("Rollback Page has no identity");
    const plan = prepareLibraryContentRehome(database, {
      operationId: "rehome:test:rollback",
      callIdentity: "c".repeat(64),
      actorProjectId: source.id,
      sourceProjectId: source.id,
      targetProjectId: target.id,
      rootPageIds: [pageId],
      storeEpoch: requireBlockStoreEpoch(database),
    });
    const faultPoints: readonly LibraryContentRehomeFaultPoint[] = [
      "after_derived_projection_delete",
      "after_core_owner_update",
      "after_projection_rebuild",
      "after_ledger_record",
    ];
    for (const faultPoint of faultPoints) {
      expect(() => database.transaction(() => {
        applyLibraryContentRehomeInTransaction(database, plan, {
          faultInjector: (point) => {
            if (point === faultPoint) throw new Error(`injected:${point}`);
          },
        });
      }).immediate()).toThrow(`injected:${faultPoint}`);
      expect(database.prepare(`
        SELECT project_id AS projectId FROM blocks WHERE id = ?
      `).get(pageId)).toEqual({ projectId: source.id });
      expect(database.prepare(`
        SELECT COUNT(*) AS count FROM library_content_relocations
        WHERE operation_id = ?
      `).get(plan.operationId)).toEqual({ count: 0 });
      expect(database.pragma("foreign_key_check")).toEqual([]);
    }
  });

  test("rehomes nested Page ownership closures and their Documents", () => {
    const source = createProject({ name: "Nested Page source" });
    const target = createProject({ name: "Nested Page target" });
    const database = getDb();
    const storeEpoch = requireBlockStoreEpoch(database);
    const createdParent = prepareNodexAgentCreatePages(database, {
      threadId: "thread-nested-parent",
      callId: "call-nested-parent",
      projectId: source.id,
      input: CreatePagesV3InputSchema.parse({
        destination: { kind: "library" },
        pages: [{ title: "Nested owner", markdown: "Container" }],
      }),
    });
    if (!createdParent.ok || createdParent.value.kind !== "prepared") {
      throw new Error(JSON.stringify(createdParent));
    }
    const parentResult = executeNodexAgentCreatePages(
      database,
      createdParent.value.command,
    );
    if (!parentResult.ok) throw new Error(parentResult.error.message);
    const parentPageId = createdParent.value.command.pages[0]?.pageId;
    if (!parentPageId) throw new Error("Nested owner Page was not allocated");

    const createdChild = prepareNodexAgentCreatePages(database, {
      threadId: "thread-nested-child",
      callId: "call-nested-child",
      projectId: source.id,
      input: CreatePagesV3InputSchema.parse({
        destination: { kind: "page", pageId: parentPageId },
        pages: [{ title: "Nested child", markdown: "Child body" }],
      }),
    });
    if (!createdChild.ok || createdChild.value.kind !== "prepared") {
      throw new Error(JSON.stringify(createdChild));
    }
    const childResult = executeNodexAgentCreatePages(
      database,
      createdChild.value.command,
    );
    if (!childResult.ok) throw new Error(childResult.error.message);
    const childPageId = createdChild.value.command.pages[0]?.pageId;
    if (!childPageId) throw new Error("Nested child Page was not allocated");
    const childDocumentId = database.prepare(`
      SELECT document_id AS documentId FROM block_documents WHERE block_id = ?
    `).get(childPageId) as { readonly documentId: string };

    const plan = prepareLibraryContentRehome(database, {
      operationId: "rehome:test:nested-page",
      callIdentity: "d".repeat(64),
      actorProjectId: source.id,
      sourceProjectId: source.id,
      targetProjectId: target.id,
      rootPageIds: [parentPageId],
      storeEpoch,
    });
    expect(plan.blockIds).toContain(childPageId);
    expect(plan.documentIds).toContain(childDocumentId.documentId);

    database.transaction(() => {
      applyLibraryContentRehomeInTransaction(database, plan);
    }).immediate();

    expect(database.prepare(`
      SELECT project_id AS projectId FROM blocks WHERE id = ?
    `).get(childPageId)).toEqual({ projectId: target.id });
    expect(database.prepare(`
      SELECT project_id AS projectId FROM documents WHERE id = ?
    `).get(childDocumentId.documentId)).toEqual({ projectId: target.id });
    expect(database.pragma("foreign_key_check")).toEqual([]);
  });

  test("rejects stale or cross-Library coordinates without changing owners", () => {
    const source = createProject({ name: "Rejected source" });
    const target = createProject({ name: "Rejected target" });
    const database = getDb();
    const sourcePage = database.prepare(`
      SELECT block_id AS pageId FROM pages
      WHERE parent_kind = 'data_source'
        AND block_id IN (SELECT id FROM blocks WHERE project_id = ? AND type = 'page')
      LIMIT 1
    `).get(source.id) as { readonly pageId: string } | undefined;
    expect(sourcePage).toBeUndefined();
    expect(() => prepareLibraryContentRehome(database, {
      operationId: "rehome:test:rejected",
      callIdentity: "b".repeat(64),
      actorProjectId: target.id,
      sourceProjectId: source.id,
      targetProjectId: target.id,
      rootPageIds: ["missing-page"],
      storeEpoch: "stale-epoch",
    })).toThrow("stale store epoch");
    expect(database.pragma("foreign_key_check")).toEqual([]);
  });
});
