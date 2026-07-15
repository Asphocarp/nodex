import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import * as Y from "yjs";
import { createUuidV7 } from "../../shared/card-id";
import { resetAssetPathCacheForTests } from "./assets";
import {
  applyBlockDocumentUpdate,
  loadPrimaryBlockDocument,
} from "./block-document-store";
import {
  applyBlockTransfer,
  prepareBlockTransfer,
} from "./block-transfers";
import { finalizeCardNfmIdentityProjection } from "./card-nfm-projection-finalization";
import { createCard } from "./cards";
import { closeDatabase, getDb, initializeDatabase } from "./database";

const tempDirectories: string[] = [];

const useTempStore = (): void => {
  closeDatabase();
  resetAssetPathCacheForTests();
  const directory = fs.mkdtempSync(
    path.join(os.tmpdir(), "nodex-card-nfm-projection-"),
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

describe("Card NFM identity projection finalization", () => {
  test("rematerializes old Card syntax at the same Yjs head and reaches a fixed point", async () => {
    useTempStore();
    await initializeDatabase();
    const database = getDb();
    const project = database.prepare("SELECT id FROM projects LIMIT 1").get() as {
      readonly id: string;
    };
    const storeEpoch = database.prepare(
      "SELECT store_epoch FROM block_store_metadata WHERE id = 1",
    ).pluck().get() as string;
    const host = await createCard(project.id, "draft", { title: "Host" });
    const nested = await createCard(project.id, "draft", { title: "Nested" });
    const mentioned = await createCard(project.id, "draft", { title: "Mentioned" });
    const hostDocumentId = database.prepare(
      "SELECT document_id FROM block_documents WHERE block_id = ?",
    ).pluck().get(host.id) as string;
    const nestedDatabaseId = database.prepare(
      "SELECT containing_database_id FROM blocks WHERE id = ?",
    ).pluck().get(nested.id) as string;

    const preparedTransfer = prepareBlockTransfer(database, {
      version: 1,
      operationId: "test:move-nested-card-into-host",
      projectId: project.id,
      storeEpoch,
      clientSessionId: "test:card-nfm-projection",
      actor: { kind: "test" },
      mode: "move",
      rootBlockIds: [nested.id],
      source: { kind: "database", databaseBlockId: nestedDatabaseId },
      target: { kind: "document", documentId: hostDocumentId },
    });
    expect(preparedTransfer.ok).toBe(true);
    if (!preparedTransfer.ok) return;
    expect(applyBlockTransfer(database, preparedTransfer.value.request).ok).toBe(
      true,
    );

    const loaded = loadPrimaryBlockDocument(database, hostDocumentId);
    const beforeReference = Y.encodeStateVector(loaded.document);
    const root = loaded.document.getXmlFragment("body").get(0);
    if (!(root instanceof Y.XmlElement)) throw new Error("Missing body root");
    const container = new Y.XmlElement("blockContainer");
    container.setAttribute("id", createUuidV7());
    const reference = new Y.XmlElement("cardRef");
    reference.setAttribute("targetBlockId", mentioned.id);
    container.insert(0, [reference]);
    root.insert(root.length, [container]);
    const update = Y.encodeStateAsUpdate(loaded.document, beforeReference);
    applyBlockDocumentUpdate(database, {
      documentId: hostDocumentId,
      storeEpoch: loaded.storeEpoch,
      generation: loaded.head.generation,
      updateId: "test:add-card-mention-for-projection",
      clientSessionId: "test:card-nfm-projection",
      baseHeadSeq: loaded.head.headSeq,
      touchedBlockIds: [],
      update,
    });
    loaded.document.destroy();

    const canonicalNfm = database.prepare(
      "SELECT nfm FROM document_materializations WHERE document_id = ?",
    ).pluck().get(hostDocumentId) as string;
    expect(canonicalNfm).toContain(`<card uuid="${nested.id}" />`);
    expect(canonicalNfm).toContain(
      `<mention-card url="nodex://cards/${mentioned.id}" />`,
    );
    const historicalNfm = canonicalNfm
      .replace(`<card uuid="${nested.id}" />`, "<card />")
      .replace(
        `<mention-card url="nodex://cards/${mentioned.id}" />`,
        `<card-ref target-block="${mentioned.id}" />`,
      );
    database.prepare(
      "UPDATE document_materializations SET nfm = ? WHERE document_id = ?",
    ).run(historicalNfm, hostDocumentId);
    database.prepare(
      "DELETE FROM card_read_model WHERE card_block_id = ?",
    ).run(host.id);

    const before = database.prepare(
      "SELECT generation, head_seq, state_vector, state_hash FROM documents WHERE id = ?",
    ).get(hostDocumentId);
    const updateCountBefore = database.prepare(
      "SELECT COUNT(*) FROM document_updates WHERE document_id = ?",
    ).pluck().get(hostDocumentId);

    expect(finalizeCardNfmIdentityProjection(database)).toMatchObject({
      rematerializedDocuments: 1,
    });
    expect(
      database.prepare(
        "SELECT nfm FROM document_materializations WHERE document_id = ?",
      ).pluck().get(hostDocumentId),
    ).toBe(canonicalNfm);
    expect(
      database.prepare(
        "SELECT generation, head_seq, state_vector, state_hash FROM documents WHERE id = ?",
      ).get(hostDocumentId),
    ).toEqual(before);
    expect(
      database.prepare(
        "SELECT COUNT(*) FROM document_updates WHERE document_id = ?",
      ).pluck().get(hostDocumentId),
    ).toBe(updateCountBefore);
    const refreshedCardRead = database.prepare(
      `
      SELECT read.description_preview, read.description_length,
             materialization.preview AS materialization_preview
      FROM card_read_model read
      JOIN document_materializations materialization
        ON materialization.document_id = read.document_id
      WHERE read.card_block_id = ?
    `,
    ).get(host.id) as {
      readonly description_preview: string;
      readonly description_length: number;
      readonly materialization_preview: string;
    };
    expect(refreshedCardRead.description_length).toBe(canonicalNfm.length);
    expect(refreshedCardRead.description_preview).toBe(
      refreshedCardRead.materialization_preview,
    );
    expect(finalizeCardNfmIdentityProjection(database)).toMatchObject({
      rematerializedDocuments: 0,
    });
  });
});
