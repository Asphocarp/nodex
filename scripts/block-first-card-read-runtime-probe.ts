import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import * as Y from "yjs";
import { openCardDocument } from "../src/shared/block-documents";
import {
  applyBlockDocumentUpdate,
  loadPrimaryBlockDocument,
} from "../src/main/local-store/block-document-store";
import {
  cutoverCardDocumentToPrimary,
  getOwnedBlockDocumentDescriptor,
} from "../src/main/local-store/block-document-cutover";
import {
  CardReadStoreError,
  rebuildCardReadModelProjection,
} from "../src/main/local-store/card-read-store";
import {
  createCard,
  getBoard,
  getBoardSummary,
  getCard,
  getCardsDetails,
  readCardDocumentBoardProjection,
  readCardSummariesByIds,
  readCardSummaryById,
  readColumn,
  searchCards,
} from "../src/main/local-store/cards";
import {
  closeDatabase,
  getDb,
  initializeDatabase,
} from "../src/main/local-store/database";
import { runLegacyCardShadowProcessorProbe } from "../src/main/local-store/legacy-card-shadow-processor";
import { createProject } from "../src/main/local-store/projects";

const assert: (condition: unknown, message: string) => asserts condition = (
  condition,
  message,
) => {
  if (condition) return;
  throw new Error(message);
};

const findFirstXmlText = (
  root: Y.XmlFragment | Y.XmlElement,
): Y.XmlText | null => {
  for (const child of root.toArray()) {
    if (child instanceof Y.XmlText) return child;
    if (!(child instanceof Y.XmlElement)) continue;
    const nested = findFirstXmlText(child);
    if (nested) return nested;
  }
  return null;
};

const updateDatabaseValue = (
  cardId: string,
  key: string,
  value: unknown,
): void => {
  getDb()
    .prepare(
      `
    UPDATE database_property_values
    SET value_json = ?, revision = revision + 1,
        updated_at = '2026-07-11T00:00:00.000Z'
    WHERE membership_id = 'membership:' || ?
      AND property_id = database_block_id || ':property:' || ?
  `,
    )
    .run(JSON.stringify(value), cardId, key);
};

const updateIntrinsicValue = (
  cardId: string,
  key: string,
  value: unknown,
): void => {
  getDb()
    .prepare(
      `
    UPDATE block_properties
    SET value_json = ?, revision = revision + 1,
        updated_at = '2026-07-11T00:00:00.000Z'
    WHERE block_id = ? AND property_key = ?
  `,
    )
    .run(JSON.stringify(value), cardId, key);
};

const editPrimaryDocument = (
  documentId: string,
  title: string,
  body: string,
): void => {
  const database = getDb();
  const loaded = loadPrimaryBlockDocument(database, documentId);
  try {
    const stateVector = Y.encodeStateVector(loaded.document);
    const envelope = openCardDocument(loaded.document);
    const bodyText = findFirstXmlText(envelope.body);
    assert(bodyText, "Expected genesis body text");
    loaded.document.transact(() => {
      envelope.title.delete(0, envelope.title.length);
      envelope.title.insert(0, title);
      bodyText.delete(0, bodyText.length);
      bodyText.insert(0, body);
    }, "card-read-runtime-probe");
    applyBlockDocumentUpdate(database, {
      documentId,
      storeEpoch: loaded.storeEpoch,
      generation: loaded.head.generation,
      updateId: "card-read-runtime:update",
      clientSessionId: "card-read-runtime:window",
      baseHeadSeq: loaded.head.headSeq,
      touchedBlockIds: [],
      update: Y.encodeStateAsUpdate(loaded.document, stateVector),
    });
  } finally {
    loaded.document.destroy();
  }
};

const expectFreshCard = (
  card: Awaited<ReturnType<typeof getCard>>,
  source: string,
): void => {
  assert(card, `${source} did not return the Card`);
  assert(card.title === "Primary title", `${source} used stale title`);
  assert(card.description === "Primary body", `${source} used stale body`);
  assert(card.priority === "p0-critical", `${source} used stale priority`);
  assert(
    card.tags.join(",") === "relational,fresh",
    `${source} used stale tags`,
  );
  assert(
    card.agentStatus === "relational-agent",
    `${source} used stale intrinsic metadata`,
  );
};

const expectFreshSummary = (
  summary: ReturnType<typeof readCardSummaryById>,
  source: string,
): void => {
  assert(summary, `${source} did not return the Card summary`);
  assert(summary.title === "Primary title", `${source} used stale title`);
  assert(
    summary.descriptionPreview === "Primary body",
    `${source} used stale preview`,
  );
  assert(summary.priority === "p0-critical", `${source} used stale priority`);
  assert(
    summary.tags.join(",") === "relational,fresh",
    `${source} used stale tags`,
  );
  assert(
    summary.agentStatus === "relational-agent",
    `${source} used stale intrinsic metadata`,
  );
};

const main = async (): Promise<void> => {
  const tempDir = fs.mkdtempSync(
    path.join(os.tmpdir(), "nodex-card-read-runtime-"),
  );
  process.env.NODEX_DIR = tempDir;

  try {
    await initializeDatabase();
    const project = createProject({ name: "Card read runtime probe" });
    const created = await createCard(project.id, "in_progress", {
      title: "Legacy title",
      description: "Legacy body",
      priority: "p1-high",
      tags: ["legacy"],
      agentStatus: "legacy-agent",
    });
    const database = getDb();
    const shadow = runLegacyCardShadowProcessorProbe(database);
    assert(shadow.allCurrentCardsReady, "Legacy shadow did not become ready");
    const descriptor = getOwnedBlockDocumentDescriptor(
      database,
      project.id,
      created.id,
    );

    database
      .prepare(
        `
    UPDATE document_materializations
    SET title = 'Non-authoritative shadow title'
    WHERE document_id = ?
  `,
      )
      .run(descriptor.documentId);
    assert(
      (await getCard(project.id, created.id))?.title === "Legacy title",
      "legacy_shadow Card did not explicitly use the compatibility row",
    );
    database
      .prepare(
        `
    UPDATE document_materializations SET title = 'Legacy title' WHERE document_id = ?
  `,
      )
      .run(descriptor.documentId);

    cutoverCardDocumentToPrimary(database, {
      projectId: project.id,
      ownerBlockId: created.id,
      expectedGeneration: descriptor.generation,
      expectedHeadSeq: descriptor.headSeq,
    });
    editPrimaryDocument(descriptor.documentId, "Primary title", "Primary body");
    updateDatabaseValue(created.id, "priority", "p0-critical");
    updateDatabaseValue(created.id, "tags", ["relational", "fresh"]);
    updateIntrinsicValue(created.id, "agent.status", "relational-agent");
    database
      .prepare(
        `
    UPDATE blocks
    SET metadata_revision = metadata_revision + 1,
        updated_at = '2026-07-11T00:00:00.000Z'
    WHERE id = ?
  `,
      )
      .run(created.id);

    const legacy = database
      .prepare(
        `
    SELECT title, description, priority, tags, agent_status FROM cards WHERE id = ?
  `,
      )
      .get(created.id) as {
      title: string;
      description: string;
      priority: string | null;
      tags: string;
      agent_status: string | null;
    };
    assert(
      legacy.title === "Legacy title",
      "Probe accidentally rewrote legacy title",
    );
    assert(
      legacy.description === "Legacy body",
      "Probe accidentally rewrote legacy body",
    );
    assert(
      legacy.priority === "p1-high",
      "Probe accidentally rewrote legacy priority",
    );
    assert(
      legacy.tags === '["legacy"]',
      "Probe accidentally rewrote legacy tags",
    );
    assert(
      legacy.agent_status === "legacy-agent",
      "Probe accidentally rewrote legacy agent status",
    );

    const staleSearch = await searchCards({
      projectIds: [project.id],
      query: "Legacy body",
    });
    const currentSearch = await searchCards({
      projectIds: [project.id],
      query: "Primary body",
    });
    assert(
      staleSearch.length === 0,
      "Card search returned stale legacy content",
    );
    assert(
      currentSearch.length === 1 && currentSearch[0]?.cardId === created.id,
      "Card search did not return current Document content",
    );

    expectFreshCard(await getCard(project.id, created.id), "getCard");
    expectFreshCard(
      (await getCardsDetails(project.id, { cardIds: [created.id] }))[0] ?? null,
      "getCardsDetails",
    );
    expectFreshCard(
      (await readColumn(project.id, "in_progress")).cards[0] ?? null,
      "readColumn",
    );
    const boardCard =
      (await getBoard(project.id)).columns
        .flatMap((column) => column.cards)
        .find((card) => card.id === created.id) ?? null;
    expectFreshCard(boardCard, "getBoard");
    expectFreshSummary(
      readCardSummaryById(created.id, database),
      "readCardSummaryById",
    );
    expectFreshSummary(
      readCardSummariesByIds([created.id], database)[0] ?? null,
      "readCardSummariesByIds",
    );
    const boardSummaryCard = (await getBoardSummary(project.id)).columns
      .flatMap((column) => column.cards)
      .find((card) => card.id === created.id);
    expectFreshSummary(boardSummaryCard ?? null, "getBoardSummary");
    expectFreshSummary(
      readCardDocumentBoardProjection(database, descriptor.documentId)
        ?.summary ?? null,
      "readCardDocumentBoardProjection",
    );

    database.transaction(() => {
      rebuildCardReadModelProjection(database, project.id, [created.id]);
      rebuildCardReadModelProjection(database, project.id, [created.id]);
    })();
    const projected = database
      .prepare(
        `
    SELECT title, description_preview, database_values_json,
           intrinsic_properties_json, document_projected_seq
    FROM card_read_model WHERE card_block_id = ?
  `,
      )
      .get(created.id) as {
      title: string;
      description_preview: string;
      database_values_json: string;
      intrinsic_properties_json: string;
      document_projected_seq: number;
    };
    assert(
      projected.title === "Primary title",
      "Card projection has stale title",
    );
    assert(
      projected.description_preview === "Primary body",
      "Card projection has stale preview",
    );
    assert(
      JSON.parse(projected.database_values_json).priority === "p0-critical",
      "Card projection has stale Database metadata",
    );
    assert(
      JSON.parse(projected.intrinsic_properties_json)["agent.status"] ===
        "relational-agent",
      "Card projection has stale intrinsic metadata",
    );

    database
      .prepare(`UPDATE documents SET head_seq = head_seq + 1 WHERE id = ?`)
      .run(descriptor.documentId);
    let staleCode: string | null = null;
    try {
      await getCard(project.id, created.id);
    } catch (error) {
      staleCode =
        error instanceof CardReadStoreError ? error.code : "unexpected";
    }
    assert(
      staleCode === "card_materialization_stale",
      "Primary stale materialization did not fail closed",
    );
    let staleSummaryCode: string | null = null;
    try {
      readCardSummaryById(created.id, database);
    } catch (error) {
      staleSummaryCode =
        error instanceof CardReadStoreError ? error.code : "unexpected";
    }
    assert(
      staleSummaryCode === "card_materialization_stale",
      "Primary stale summary did not fail closed",
    );
    database
      .prepare(
        `
    UPDATE document_materializations
    SET projected_seq = projected_seq + 1
    WHERE document_id = ?
  `,
      )
      .run(descriptor.documentId);
    expectFreshCard(
      await getCard(project.id, created.id),
      "freshness recovery",
    );

    closeDatabase();
    await initializeDatabase();
    expectFreshCard(await getCard(project.id, created.id), "restart");
    expectFreshSummary(readCardSummaryById(created.id), "summary restart");

    const restartedDatabase = getDb();
    restartedDatabase
      .prepare(
        `
    UPDATE database_memberships
    SET removed_at = '2026-07-11T00:01:00.000Z'
    WHERE card_block_id = ? AND removed_at IS NULL
  `,
      )
      .run(created.id);
    restartedDatabase.transaction(() => {
      rebuildCardReadModelProjection(restartedDatabase, project.id, [
        created.id,
      ]);
    })();
    const standaloneProjection = restartedDatabase
      .prepare(
        `
    SELECT membership_id, database_block_id, view_id, database_values_json
    FROM card_read_model WHERE card_block_id = ?
  `,
      )
      .get(created.id) as {
      membership_id: string | null;
      database_block_id: string | null;
      view_id: string | null;
      database_values_json: string;
    };
    assert(
      standaloneProjection.membership_id === null,
      "Standalone projection retained membership",
    );
    assert(
      standaloneProjection.database_block_id === null,
      "Standalone projection retained Database",
    );
    assert(
      standaloneProjection.view_id === null,
      "Standalone projection retained View",
    );
    assert(
      standaloneProjection.database_values_json === "{}",
      "Standalone projection invented Database values",
    );
    const boardAfterRemoval = await getBoard(project.id);
    assert(
      boardAfterRemoval.columns.every((column) =>
        column.cards.every((card) => card.id !== created.id),
      ),
      "Standalone Card remained in the Board",
    );
    let standaloneCode: string | null = null;
    try {
      await getCard(project.id, created.id);
    } catch (error) {
      standaloneCode =
        error instanceof CardReadStoreError ? error.code : "unexpected";
    }
    assert(
      standaloneCode === "card_database_membership_missing",
      "Standalone compatibility read invented status/order",
    );

    process.stdout.write(
      `${JSON.stringify({
        authority: {
          legacyBridgeExplicit: true,
          primaryContentFromMaterialization: true,
          metadataFromRelations: true,
        },
        reads: {
          getCard: true,
          getCardsDetails: true,
          readColumn: true,
          getBoard: true,
          getBoardSummary: true,
          summaryById: true,
          summaryByDocument: true,
          searchCards: true,
          restart: true,
        },
        projection: {
          writerOwnedRebuild: true,
          idempotent: true,
          standaloneSupported: true,
        },
        freshness: {
          stalePrimaryRejected: true,
          noLegacyFallback: true,
        },
      })}\n`,
    );
  } finally {
    closeDatabase();
    fs.rmSync(tempDir, { recursive: true, force: true });
    delete process.env.NODEX_DIR;
  }
};

void main().catch((error: unknown) => {
  process.stderr.write(
    `${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`,
  );
  process.exitCode = 1;
});
