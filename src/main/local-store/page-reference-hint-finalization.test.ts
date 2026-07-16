import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import * as Y from "yjs";
import { createUuidV7 } from "../../shared/uuid-v7";
import { applyBlockDocumentUpdate, loadPrimaryBlockDocument } from "./block-document-store";
import { finalizePageReferenceIdentityStorage } from "./page-reference-hint-finalization";
import { closeDatabase, getDb, initializeDatabase } from "./database";
import { resetAssetPathCacheForTests } from "./assets";
import { createPage } from "./database-pages";

const tempDirectories: string[] = [];

const useTempStore = (): void => {
  closeDatabase();
  resetAssetPathCacheForTests();
  const directory = fs.mkdtempSync(
    path.join(os.tmpdir(), "nodex-card-reference-finalization-"),
  );
  tempDirectories.push(directory);
  process.env.NODEX_DIR = directory;
};

afterEach(() => {
  closeDatabase();
  resetAssetPathCacheForTests();
  delete process.env.NODEX_DIR;
  for (const directory of tempDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

describe("Page reference identity finalization", () => {
  test("commits node normalization through the Document writer and is idempotent", async () => {
    useTempStore();
    await initializeDatabase();
    const database = getDb();
    const project = database.prepare("SELECT id FROM projects LIMIT 1").get() as {
      readonly id: string;
    };
    const host = await createPage(project.id, "draft", { title: "Host" });
    const target = await createPage(project.id, "draft", { title: "Target" });
    const documentId = database.prepare(
      "SELECT document_id FROM block_documents WHERE block_id = ?",
    ).pluck().get(host.id) as string;

    const loaded = loadPrimaryBlockDocument(database, documentId);
    const before = Y.encodeStateVector(loaded.document);
    const root = loaded.document.getXmlFragment("body").get(0);
    if (!(root instanceof Y.XmlElement)) throw new Error("Missing root group");
    const container = new Y.XmlElement("blockContainer");
    container.setAttribute("id", createUuidV7());
    const reference = new Y.XmlElement("pageRef");
    reference.setAttribute("targetBlockId", target.id);
    reference.setAttribute("displayHint", "Old target title");
    container.insert(0, [reference]);
    root.insert(root.length, [container]);
    const update = Y.encodeStateAsUpdate(loaded.document, before);
    applyBlockDocumentUpdate(database, {
      documentId,
      storeEpoch: loaded.storeEpoch,
      generation: loaded.head.generation,
      updateId: "test:seed-historical-card-reference-hint",
      clientSessionId: "test:card-reference-finalization",
      baseHeadSeq: loaded.head.headSeq,
      touchedBlockIds: [],
      update,
    });
    loaded.document.destroy();

    const seeded = loadPrimaryBlockDocument(database, documentId);
    const seededHeadSeq = seeded.head.headSeq;
    expect(seeded.document.getXmlFragment("body").toString()).toContain(
      'displayHint="Old target title"',
    );
    seeded.document.destroy();

    expect(finalizePageReferenceIdentityStorage(database)).toMatchObject({
      updatedDocuments: 1,
      removedHints: 1,
      renamedNodes: 0,
    });
    const finalized = loadPrimaryBlockDocument(database, documentId);
    expect(finalized.head.generation).toBe(1);
    expect(finalized.head.headSeq).toBe(seededHeadSeq + 1);
    expect(finalized.document.getXmlFragment("body").toString()).not.toContain(
      "displayHint",
    );
    expect(finalized.document.getXmlFragment("body").toString()).toContain(
      `<pageref targetBlockId="${target.id}"></pageref>`,
    );
    finalized.document.destroy();
    expect(finalizePageReferenceIdentityStorage(database)).toMatchObject({
      updatedDocuments: 0,
      removedHints: 0,
      renamedNodes: 0,
    });
  });
});
