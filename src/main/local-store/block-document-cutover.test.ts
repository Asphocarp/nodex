import { describe, expect, test } from "vitest";
import Database from "better-sqlite3";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import * as Y from "yjs";
import { createCard } from "./cards";
import {
  BlockDocumentCutoverError,
  cutoverCardDocumentToPrimary,
  cutoverEligibleCardDocumentsToPrimary,
  getOwnedBlockDocumentDescriptor,
} from "./block-document-cutover";
import { syncBlockDocument } from "./block-document-store";
import { getDatabasePath } from "./config";
import { closeDatabase, initializeDatabase } from "./database";
import { runLegacyCardShadowProcessorProbe } from "./legacy-card-shadow-processor";
import { createProject } from "./projects";

const supportsBetterSqlite3 = (): boolean => {
  try {
    const database = new Database(":memory:");
    database.close();
    return true;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes("better-sqlite3") && message.includes("not yet supported")) {
      return false;
    }
    throw error;
  }
};

const skipTest = (test as typeof test & { skip: typeof test }).skip;
const sqliteTest = supportsBetterSqlite3() ? test : skipTest;

const withDatabase = async (
  name: string,
  run: (database: Database.Database) => void | Promise<void>,
): Promise<void> => {
  closeDatabase();
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), `nodex-${name}-`));
  process.env.NODEX_DIR = tempDir;
  try {
    await initializeDatabase();
    closeDatabase();
    const database = new Database(getDatabasePath());
    database.pragma("foreign_keys = ON");
    try {
      await run(database);
    } finally {
      database.close();
    }
  } finally {
    closeDatabase();
    fs.rmSync(tempDir, { recursive: true, force: true });
    delete process.env.NODEX_DIR;
  }
};

const expectCutoverCode = (
  operation: () => unknown,
  code: BlockDocumentCutoverError["code"],
): void => {
  let error: unknown;
  try {
    operation();
  } catch (caught) {
    error = caught;
  }
  expect(error instanceof BlockDocumentCutoverError).toBe(true);
  expect((error as BlockDocumentCutoverError).code).toBe(code);
};

describe("Card Document cutover", () => {
  sqliteTest("cuts eligible Cards monotonically and defers foreign-body hosts", async () => {
    await withDatabase("document-cutover-batch", async (database) => {
      const project = createProject({ name: "Batch cutover" });
      const simple = await createCard(project.id, "draft", {
        title: "Simple",
        description: "Ready body",
      });
      const target = await createCard(project.id, "draft", { title: "Target" });
      const host = await createCard(project.id, "draft", {
        title: "Legacy host",
        description: `<card-ref project="${project.id}" card="${target.id}" />`,
      });
      const archivedTarget = await createCard(project.id, "draft", {
        title: "Archived host target",
      });
      const archivedHost = await createCard(project.id, "draft", {
        title: "Archived projection host",
        description: `<card-ref project="${project.id}" card="${archivedTarget.id}" />`,
      });
      runLegacyCardShadowProcessorProbe(database);
      database.prepare(`
        UPDATE cards
        SET archived = 1, revision = revision + 1
        WHERE id = ?
      `).run(archivedHost.id);

      const first = cutoverEligibleCardDocumentsToPrimary(database);
      expect(first.cutoverDocumentIds.includes(`document:${simple.id}`)).toBe(true);
      expect(first.cutoverDocumentIds.includes(`document:${target.id}`)).toBe(false);
      expect(
        first.cutoverDocumentIds.includes(`document:${archivedTarget.id}`),
      ).toBe(false);
      expect(first.deferredForeignReferences).toBe(3);
      expect(
        getOwnedBlockDocumentDescriptor(database, project.id, host.id).authority,
      ).toBe("legacy_shadow");
      expect(
        getOwnedBlockDocumentDescriptor(database, project.id, target.id).authority,
      ).toBe("legacy_shadow");
      expect(
        getOwnedBlockDocumentDescriptor(database, project.id, archivedHost.id).ownerLifecycle,
      ).toBe("archived");
      expect(
        getOwnedBlockDocumentDescriptor(database, project.id, archivedTarget.id).authority,
      ).toBe("legacy_shadow");

      const retry = cutoverEligibleCardDocumentsToPrimary(database);
      expect(retry.cutoverDocumentIds.length).toBe(0);
      expect(retry.alreadyPrimary).toBe(1);
      expect(retry.deferredForeignReferences).toBe(3);
    });
  });

  sqliteTest("keeps every possible legacy inline-query row on snapshot authority", async () => {
    await withDatabase("document-cutover-query-participants", async (database) => {
      const hostProject = createProject({ name: "Query host" });
      const sourceProject = createProject({ name: "Query rows" });
      const host = await createCard(hostProject.id, "draft", {
        title: "Inline query host",
        description: `<toggle-list-inline-view project="${sourceProject.id}" rules-v2="eyJtb2RlIjoiYWxsIn0" property-order="priority,estimate,status,tags" show-empty-estimate="false" show-empty-priority="false" />`,
      });
      const firstRow = await createCard(sourceProject.id, "draft", {
        title: "Current row",
      });
      const futureRuleMatch = await createCard(sourceProject.id, "done", {
        title: "Possible row after rules change",
      });
      runLegacyCardShadowProcessorProbe(database);

      const result = cutoverEligibleCardDocumentsToPrimary(database);
      expect(result.cutoverDocumentIds.includes(`document:${host.id}`)).toBe(false);
      expect(result.cutoverDocumentIds.includes(`document:${firstRow.id}`)).toBe(false);
      expect(
        result.cutoverDocumentIds.includes(`document:${futureRuleMatch.id}`),
      ).toBe(false);
      expect(
        getOwnedBlockDocumentDescriptor(database, sourceProject.id, firstRow.id).authority,
      ).toBe("legacy_shadow");
      const possibleRowDescriptor = getOwnedBlockDocumentDescriptor(
        database,
        sourceProject.id,
        futureRuleMatch.id,
      );
      expectCutoverCode(
        () => cutoverCardDocumentToPrimary(database, {
          projectId: sourceProject.id,
          ownerBlockId: futureRuleMatch.id,
          expectedGeneration: possibleRowDescriptor.generation,
          expectedHeadSeq: possibleRowDescriptor.headSeq,
        }),
        "foreign_body_reference",
      );
    });
  });

  sqliteTest("atomically flips a drained parity-checked Card and is idempotent", async () => {
    await withDatabase("document-cutover", async (database) => {
      const project = createProject({ name: "Cutover" });
      const card = await createCard(project.id, "draft", {
        title: "Collaborative Card",
        description: "First\nSecond",
      });
      const probe = runLegacyCardShadowProcessorProbe(database);
      expect(probe.allCurrentCardsReady).toBe(true);
      expect(probe.allCurrentCardContentInParity).toBe(true);

      const shadow = getOwnedBlockDocumentDescriptor(
        database,
        project.id,
        card.id,
      );
      expect(shadow.authority).toBe("legacy_shadow");
      expect(shadow.readiness).toBe("ready");
      const primary = cutoverCardDocumentToPrimary(database, {
        projectId: project.id,
        ownerBlockId: card.id,
        expectedGeneration: shadow.generation,
        expectedHeadSeq: shadow.headSeq,
      });
      expect(primary.authority).toBe("ydoc_primary");
      expect(primary.documentId).toBe(shadow.documentId);
      expect(primary.stateVector.byteLength > 0).toBe(true);

      const retry = cutoverCardDocumentToPrimary(database, {
        projectId: project.id,
        ownerBlockId: card.id,
        expectedGeneration: primary.generation,
        expectedHeadSeq: 0,
      });
      expect(retry.authority).toBe("ydoc_primary");
      const client = new Y.Doc({ guid: primary.documentId });
      const synced = syncBlockDocument(database, {
        documentId: primary.documentId,
        clientSessionId: "cutover-window",
        stateVector: Y.encodeStateVector(client),
      });
      Y.applyUpdate(client, synced.update);
      expect(client.getText("title").toString()).toBe("Collaborative Card");
      client.destroy();
    });
  });

  sqliteTest("fails closed for pending ledger, stale projection, and foreign references", async () => {
    await withDatabase("document-cutover-gates", async (database) => {
      const project = createProject({ name: "Cutover gates" });
      const pending = await createCard(project.id, "draft", {
        title: "Pending",
      });
      const pendingDescriptor = getOwnedBlockDocumentDescriptor(
        database,
        project.id,
        pending.id,
      );
      expectCutoverCode(
        () => cutoverCardDocumentToPrimary(database, {
          projectId: project.id,
          ownerBlockId: pending.id,
          expectedGeneration: pendingDescriptor.generation,
          expectedHeadSeq: pendingDescriptor.headSeq,
        }),
        "document_not_ready",
      );

      runLegacyCardShadowProcessorProbe(database);
      const ready = getOwnedBlockDocumentDescriptor(
        database,
        project.id,
        pending.id,
      );
      database.prepare(`
        UPDATE document_materializations SET projected_seq = projected_seq - 1
        WHERE document_id = ?
      `).run(ready.documentId);
      expectCutoverCode(
        () => cutoverCardDocumentToPrimary(database, {
          projectId: project.id,
          ownerBlockId: pending.id,
          expectedGeneration: ready.generation,
          expectedHeadSeq: ready.headSeq,
        }),
        "projection_parity_failed",
      );

      const target = await createCard(project.id, "draft", { title: "Target" });
      const referencing = await createCard(project.id, "draft", {
        title: "Reference host",
        description: `<card-ref project="${project.id}" card="${target.id}" />`,
      });
      const parity = runLegacyCardShadowProcessorProbe(database);
      expect(parity.allCurrentCardsReady).toBe(true);
      const referenceDescriptor = getOwnedBlockDocumentDescriptor(
        database,
        project.id,
        referencing.id,
      );
      expectCutoverCode(
        () => cutoverCardDocumentToPrimary(database, {
          projectId: project.id,
          ownerBlockId: referencing.id,
          expectedGeneration: referenceDescriptor.generation,
          expectedHeadSeq: referenceDescriptor.headSeq,
        }),
        "foreign_body_reference",
      );
    });
  });
});
