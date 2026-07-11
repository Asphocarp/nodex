import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import * as Y from "yjs";
import { isUuidV7 } from "../src/shared/card-id";
import { MAX_CARD_TITLE_LENGTH } from "../src/shared/card-limits";
import {
  createCardDocumentGenesis,
  materializeCardDocument,
} from "../src/shared/block-documents/block-document-codec";
import { isLegacyForeignBodyReference } from "../src/shared/block-documents/derived-records";
import { cloneXmlSubtree } from "../src/shared/block-documents/xml-subtree-codec";
import { createCard, deleteCard } from "../src/main/local-store/cards";
import {
  closeDatabase,
  getDb,
  initializeDatabase,
} from "../src/main/local-store/database";
import {
  applyLegacyShadowDocumentUpdate,
  loadLegacyShadowBlockDocumentForMigration,
} from "../src/main/local-store/block-document-store";
import { migrateLegacyForeignReferences } from "../src/main/local-store/foreign-reference-migration";
import { drainLegacyCardShadowJobs } from "../src/main/local-store/legacy-card-shadow-processor";
import { createProject } from "../src/main/local-store/projects";
import { upsertLegacyInlineDatabaseView } from "../src/main/local-store/database-views";

function invariant(condition: unknown, message: string): asserts condition {
  if (condition) return;
  throw new Error(message);
}

const drainShadows = (): void => {
  for (let round = 0; round < 100; round += 1) {
    const result = drainLegacyCardShadowJobs(getDb(), { maxJobs: 1_000 });
    invariant(
      result.results.every((entry) => entry.outcome !== "failed"),
      `Shadow drain failed: ${JSON.stringify(result.results)}`,
    );
    if (result.exhausted) return;
    invariant(result.results.length > 0, "Shadow drain made no progress");
  }
  throw new Error("Shadow drain did not reach a fixed point");
};

const encodeSnapshot = (value: unknown): string =>
  Buffer.from(JSON.stringify(value), "utf8").toString("base64");

const readActualLegacyReferenceDocuments = (): string[] => {
  const rows = getDb()
    .prepare(
      `
    SELECT document.id
    FROM documents document
    INNER JOIN block_documents ownership ON ownership.document_id = document.id
    INNER JOIN blocks owner ON owner.id = ownership.block_id
    WHERE document.authority = 'legacy_shadow'
      AND document.readiness = 'ready'
      AND owner.type = 'card'
    ORDER BY document.id
  `,
    )
    .all() as Array<{ readonly id: string }>;
  const legacy: string[] = [];
  for (const row of rows) {
    const loaded = loadLegacyShadowBlockDocumentForMigration(getDb(), row.id);
    try {
      const materialization = materializeCardDocument(loaded.document);
      if (materialization.references.some(isLegacyForeignBodyReference)) {
        legacy.push(row.id);
      }
    } finally {
      loaded.document.destroy();
    }
  }
  return legacy;
};

const readReferenceProjection = (
  cardId: string,
): Array<Record<string, unknown>> => {
  const row = getDb()
    .prepare(
      `
    SELECT materialization.references_json
    FROM block_documents ownership
    INNER JOIN documents document ON document.id = ownership.document_id
    INNER JOIN document_materializations materialization
      ON materialization.document_id = document.id
      AND materialization.generation = document.generation
      AND materialization.projected_seq = document.head_seq
    WHERE ownership.block_id = ?
  `,
    )
    .get(cardId) as { readonly references_json: string } | undefined;
  invariant(row, `Missing reference projection for ${cardId}`);
  return JSON.parse(row.references_json) as Array<Record<string, unknown>>;
};

const findBlockContainer = (
  parent: Y.XmlFragment | Y.XmlElement,
  blockId: string,
): Y.XmlElement | null => {
  for (const child of parent.toArray()) {
    if (!(child instanceof Y.XmlElement)) continue;
    if (
      child.nodeName === "blockContainer" &&
      child.getAttribute("id") === blockId
    )
      return child;
    const nested = findBlockContainer(child, blockId);
    if (nested) return nested;
  }
  return null;
};

const tempDir = fs.mkdtempSync(
  path.join(os.tmpdir(), "nodex-foreign-reference-runtime-"),
);
process.env.NODEX_DIR = tempDir;

const run = async (): Promise<void> => {
  try {
    await initializeDatabase();
    const hostProject = createProject({ name: "Foreign reference host" });
    const sourceProject = createProject({ name: "Foreign reference source" });
    const longTitle = "T".repeat(2_000);
    const target = await createCard(sourceProject.id, "draft", {
      title: longTitle,
      description: "Target authority body",
    });
    const missingLegacyTarget = "legacy-target-that-is-not-a-uuid";
    const snapshot = encodeSnapshot({
      card: {
        title: "Stale snapshot title",
        description: "STALE SNAPSHOT BODY",
        priority: "p4-later",
        estimate: "xl",
        tags: ["snapshot-tag"],
        dueDate: "2026-08-01T00:00:00.000Z",
        scheduledStart: "2026-08-02T01:00:00.000Z",
        scheduledEnd: "2026-08-02T02:00:00.000Z",
        isAllDay: true,
        assignee: "snapshot-owner",
        agentBlocked: true,
      },
      projectId: sourceProject.id,
      status: "backlog",
    });
    const host = await createCard(hostProject.id, "draft", {
      title: "Mixed legacy host",
      description: [
        `<card-ref project="${sourceProject.id}" card="${target.id}" />`,
        `<card-toggle card="${missingLegacyTarget}" meta="[P1] [M] [In Review] [live-tag]" snapshot="${snapshot}" project="${sourceProject.id}" status="backlog">`,
        "Current live title",
        "  Current live body",
        `  <card-ref project="${sourceProject.id}" card="${target.id}" />`,
        "</card-toggle>",
        '<toggle-list-inline-view project="missing-source-project" rules-v2="eyJtb2RlIjoiYWxsIn0" property-order="priority,estimate,status,tags" show-empty-estimate="false" show-empty-priority="false" />',
      ].join("\n"),
    });
    drainShadows();

    const first = await migrateLegacyForeignReferences(getDb(), { limit: 50 });
    invariant(first.failedDocuments === 0, JSON.stringify(first.errors));
    invariant(
      first.migratedReferences === 3,
      "Root references were not migrated once",
    );
    invariant(
      first.recoveredCards === 1,
      "Orphan Card was not recovered exactly once",
    );
    invariant(
      first.databaseViewsCreated === 1,
      "Legacy inline query did not create one View",
    );

    const hostReferences = readReferenceProjection(host.id);
    invariant(
      hostReferences.map((entry) => entry.kind).join(",") ===
        "block,block,database_view",
      "Host projection did not become reference-only",
    );
    invariant(
      hostReferences.every(
        (entry) =>
          typeof entry.displayHint !== "string" ||
          entry.displayHint.length <= 512,
      ),
      "A canonical display hint exceeded its bounded projection contract",
    );

    const toggleLedger = getDb()
      .prepare(
        `
    SELECT target_block_id, recovered_card_id, legacy_target_block_id, status
    FROM foreign_reference_migrations
    WHERE host_document_id = ? AND legacy_kind = 'card_toggle'
  `,
      )
      .get(`document:${host.id}`) as {
      readonly target_block_id: string;
      readonly recovered_card_id: string;
      readonly legacy_target_block_id: string;
      readonly status: string;
    };
    invariant(
      toggleLedger.status === "applied",
      "Recovery ledger did not commit",
    );
    invariant(
      isUuidV7(toggleLedger.target_block_id),
      "Recovery did not reserve UUID-v7",
    );
    invariant(
      toggleLedger.target_block_id !== toggleLedger.legacy_target_block_id,
      "Recovery reused the missing legacy identity",
    );
    invariant(
      toggleLedger.recovered_card_id === toggleLedger.target_block_id,
      "Recovery outcome is not durable in the ledger",
    );
    const recovered = getDb()
      .prepare(
        `
    SELECT
      title, description, priority, estimate, tags, status,
      due_date, scheduled_start, scheduled_end, is_all_day,
      assignee, agent_blocked
    FROM cards
    WHERE id = ?
  `,
      )
      .get(toggleLedger.recovered_card_id) as Record<string, unknown>;
    invariant(
      recovered.title === "Current live title",
      "Stale snapshot title won recovery",
    );
    invariant(
      typeof recovered.description === "string" &&
        recovered.description.includes("Current live body") &&
        !recovered.description.includes("STALE SNAPSHOT BODY"),
      "Stale snapshot body overwrote the current host subtree",
    );
    invariant(
      recovered.priority === "p1-high",
      "Live priority metadata was lost",
    );
    invariant(recovered.estimate === "m", "Live estimate metadata was lost");
    invariant(
      recovered.status === "in_review",
      "Live status metadata was lost",
    );
    invariant(
      typeof recovered.tags === "string" &&
        recovered.tags.includes("snapshot-tag") &&
        recovered.tags.includes("live-tag"),
      "Snapshot/live tag metadata was not preserved",
    );
    invariant(
      recovered.is_all_day === 1,
      "Valid all-day schedule metadata was lost",
    );
    invariant(
      recovered.assignee === "snapshot-owner",
      "Assignee metadata was lost",
    );
    invariant(recovered.agent_blocked === 1, "Agent blocked metadata was lost");

    const view = getDb()
      .prepare(
        `
    SELECT project_id, config_json
    FROM database_views
    WHERE id = (
      SELECT database_view_id
      FROM foreign_reference_migrations
      WHERE host_document_id = ? AND legacy_kind = 'database_query'
    )
  `,
      )
      .get(`document:${host.id}`) as {
      readonly project_id: string;
      readonly config_json: string;
    };
    invariant(
      view.project_id === hostProject.id,
      "Missing source Project did not fall back to the host Database",
    );
    invariant(
      view.config_json.includes("missing-source-project"),
      "Fallback View discarded the original source diagnostic",
    );
    const hostProjection = getDb()
      .prepare(
        `
    SELECT card.description, materialization.nfm
    FROM cards card
    INNER JOIN block_documents ownership ON ownership.block_id = card.id
    INNER JOIN document_materializations materialization
      ON materialization.document_id = ownership.document_id
    WHERE card.id = ?
  `,
      )
      .get(host.id) as {
      readonly description: string;
      readonly nfm: string;
    };
    invariant(
      hostProjection.description === hostProjection.nfm,
      "Legacy Card projection diverged from the migrated Document",
    );

    // The recovered body contains one nested legacy reference. Its new Card
    // must be initialized, then migrated independently to reach a fixed point.
    drainShadows();
    const nested = await migrateLegacyForeignReferences(getDb(), { limit: 50 });
    invariant(nested.failedDocuments === 0, JSON.stringify(nested.errors));
    invariant(
      nested.migratedReferences === 1,
      "Nested recovery did not reach fixed point",
    );
    drainShadows();

    const secondTarget = await createCard(sourceProject.id, "draft", {
      title: "Retargeted Card",
    });
    const retargetHost = await createCard(hostProject.id, "draft", {
      title: "Retarget host",
      description: `<card-ref project="${sourceProject.id}" card="${target.id}" />`,
    });
    drainShadows();
    const initialRetarget = await migrateLegacyForeignReferences(getDb(), {
      limit: 50,
    });
    invariant(
      initialRetarget.failedDocuments === 0,
      JSON.stringify(initialRetarget.errors),
    );
    const retargetSource = getDb()
      .prepare(
        `
    SELECT source_block_id
    FROM foreign_reference_migrations
    WHERE host_document_id = ? AND legacy_kind = 'card_ref'
  `,
      )
      .get(`document:${retargetHost.id}`) as {
      readonly source_block_id: string;
    };
    getDb()
      .prepare(
        `
    UPDATE cards
    SET description = ?, revision = revision + 1
    WHERE id = ?
  `,
      )
      .run(
        `<card-ref project="${sourceProject.id}" card="${secondTarget.id}" />`,
        retargetHost.id,
      );
    drainShadows();
    const retargeted = await migrateLegacyForeignReferences(getDb(), {
      limit: 50,
    });
    invariant(
      retargeted.failedDocuments === 0,
      JSON.stringify(retargeted.errors),
    );
    const retargetLedger = getDb()
      .prepare(
        `
    SELECT occurrence, legacy_target_block_id, target_block_id, status
    FROM foreign_reference_migrations
    WHERE source_block_id = ?
  `,
      )
      .get(retargetSource.source_block_id) as {
      readonly occurrence: number;
      readonly legacy_target_block_id: string;
      readonly target_block_id: string;
      readonly status: string;
    };
    invariant(
      retargetLedger.occurrence === 2,
      "Stable reference ID did not advance occurrence",
    );
    invariant(
      retargetLedger.legacy_target_block_id === secondTarget.id &&
        retargetLedger.target_block_id === secondTarget.id &&
        retargetLedger.status === "applied",
      "A legacy reference could not be deterministically retargeted",
    );

    const repeatedTarget = "same-missing-toggle-target";
    const repeatedHost = await createCard(hostProject.id, "draft", {
      title: "Repeated orphan host",
      description: [
        `<card-toggle card="${repeatedTarget}" meta="">`,
        "First recovered title",
        "  First recovered body",
        "</card-toggle>",
      ].join("\n"),
    });
    drainShadows();
    const firstRepeated = await migrateLegacyForeignReferences(getDb(), {
      limit: 50,
    });
    invariant(
      firstRepeated.failedDocuments === 0,
      JSON.stringify(firstRepeated.errors),
    );
    const firstRepeatedLedger = getDb()
      .prepare(
        `
    SELECT source_block_id, recovered_card_id
    FROM foreign_reference_migrations
    WHERE host_document_id = ? AND legacy_kind = 'card_toggle'
  `,
      )
      .get(`document:${repeatedHost.id}`) as {
      readonly source_block_id: string;
      readonly recovered_card_id: string;
    };
    const oversizedTitle = "N".repeat(MAX_CARD_TITLE_LENGTH + 37);
    const replacementNfm = [
      `<card-toggle card="${repeatedTarget}" meta="">`,
      oversizedTitle,
      "  Newer recovered body",
      "</card-toggle>",
    ].join("\n");
    const replacement = createCardDocumentGenesis({
      documentId: "same-target-replacement-template",
      title: "",
      nfm: replacementNfm,
      allocateBlockId: (() => {
        let next = 0;
        return () => `same-target-replacement-${++next}`;
      })(),
    });
    const replacementRoot = replacement.document.getXmlFragment("body").get(0);
    invariant(
      replacementRoot instanceof Y.XmlElement,
      "Replacement root is missing",
    );
    const replacementContainer = replacementRoot.get(0);
    invariant(
      replacementContainer instanceof Y.XmlElement,
      "Replacement Card toggle container is missing",
    );
    const loadedRepeated = loadLegacyShadowBlockDocumentForMigration(
      getDb(),
      `document:${repeatedHost.id}`,
    );
    try {
      const sourceContainer = findBlockContainer(
        loadedRepeated.document.getXmlFragment("body"),
        firstRepeatedLedger.source_block_id,
      );
      invariant(
        sourceContainer,
        "Stable source Block was not found for replay",
      );
      const before = Y.encodeStateVector(loadedRepeated.document);
      loadedRepeated.document.transact(() => {
        sourceContainer.delete(0, sourceContainer.length);
        sourceContainer.insert(
          0,
          replacementContainer.toArray().map((child) => cloneXmlSubtree(child)),
        );
      }, "same-target-replay");
      const update = Y.encodeStateAsUpdate(loadedRepeated.document, before);
      applyLegacyShadowDocumentUpdate(getDb(), {
        documentId: loadedRepeated.head.documentId,
        storeEpoch: loadedRepeated.storeEpoch,
        generation: loadedRepeated.head.generation,
        updateId: "probe:same-target-changed-content",
        clientSessionId: "foreign-reference-runtime-probe",
        baseHeadSeq: loadedRepeated.head.headSeq,
        touchedBlockIds: [
          firstRepeatedLedger.source_block_id,
          "same-target-replacement-2",
        ],
        update,
      });
    } finally {
      loadedRepeated.document.destroy();
      replacement.document.destroy();
    }
    const secondRepeated = await migrateLegacyForeignReferences(getDb(), {
      limit: 50,
    });
    invariant(
      secondRepeated.failedDocuments === 0,
      JSON.stringify(secondRepeated.errors),
    );
    const secondRepeatedLedger = getDb()
      .prepare(
        `
    SELECT occurrence, recovered_card_id
    FROM foreign_reference_migrations
    WHERE source_block_id = ?
  `,
      )
      .get(firstRepeatedLedger.source_block_id) as {
      readonly occurrence: number;
      readonly recovered_card_id: string;
    };
    const repeatedLedgers = getDb()
      .prepare(
        `
    SELECT source_block_id, occurrence, recovered_card_id, source_fingerprint, status
    FROM foreign_reference_migrations
    WHERE host_document_id = ?
    ORDER BY source_block_id
  `,
      )
      .all(`document:${repeatedHost.id}`) as Array<Record<string, unknown>>;
    const secondRecovered = getDb()
      .prepare(
        `
    SELECT title, description
    FROM cards
    WHERE id = ?
  `,
      )
      .get(secondRepeatedLedger.recovered_card_id) as {
      readonly title: string;
      readonly description: string;
    };
    const retainedPriorRecovery = getDb()
      .prepare("SELECT COUNT(*) AS count FROM cards WHERE id = ?")
      .get(firstRepeatedLedger.recovered_card_id) as { readonly count: number };
    invariant(
      secondRepeatedLedger.occurrence === 2 &&
        secondRepeatedLedger.recovered_card_id !==
          firstRepeatedLedger.recovered_card_id,
      `Same-target live reference content reused a stale recovered occurrence: ${JSON.stringify({ firstRepeatedLedger, secondRepeatedLedger, repeatedLedgers })}`,
    );
    invariant(
      secondRecovered.title.length === MAX_CARD_TITLE_LENGTH &&
        secondRecovered.description.includes("Newer recovered body") &&
        retainedPriorRecovery.count === 1,
      "Newer same-target recovery content was lost or exceeded Card limits",
    );

    const invalidLegacyTarget = "x".repeat(600);
    const unresolvedHost = await createCard(hostProject.id, "draft", {
      title: "Unresolved host",
      description: `<card-ref project="${sourceProject.id}" card="${invalidLegacyTarget}" />`,
    });
    drainShadows();
    const unresolvedMigration = await migrateLegacyForeignReferences(getDb(), {
      limit: 50,
    });
    invariant(
      unresolvedMigration.failedDocuments === 0,
      JSON.stringify(unresolvedMigration.errors),
    );
    const unresolved = getDb()
      .prepare(
        `
    SELECT migration.target_block_id, block.type, block.lifecycle
    FROM foreign_reference_migrations migration
    INNER JOIN blocks block ON block.id = migration.target_block_id
    WHERE migration.host_document_id = ? AND migration.legacy_kind = 'card_ref'
  `,
      )
      .get(`document:${unresolvedHost.id}`) as {
      readonly target_block_id: string;
      readonly type: string;
      readonly lifecycle: string;
    };
    invariant(
      unresolved.target_block_id.length <= 512 &&
        unresolved.type === "unresolved_card_reference" &&
        unresolved.lifecycle === "deleted",
      "Unresolved Card reference did not reserve an explicit tombstone identity",
    );

    const archivedHost = await createCard(hostProject.id, "draft", {
      title: "Archived host",
      description: `<card-ref project="${sourceProject.id}" card="${target.id}" />`,
    });
    const deletedHost = await createCard(hostProject.id, "draft", {
      title: "Deleted host",
      description: `<card-ref project="${sourceProject.id}" card="${target.id}" />`,
    });
    drainShadows();
    getDb()
      .prepare("UPDATE cards SET archived = 1 WHERE id = ?")
      .run(archivedHost.id);
    invariant(
      await deleteCard(hostProject.id, "draft", deletedHost.id),
      "Deleted host fixture was not removed",
    );
    drainShadows();
    getDb()
      .prepare(
        `
    UPDATE document_materializations
    SET references_json = '[]'
    WHERE document_id = ?
  `,
      )
      .run(`document:${deletedHost.id}`);
    const lifecycles = await migrateLegacyForeignReferences(getDb(), {
      limit: 50,
    });
    invariant(
      lifecycles.failedDocuments === 0,
      JSON.stringify(lifecycles.errors),
    );
    invariant(
      lifecycles.migratedReferences === 2,
      "Archived/deleted hosts were skipped",
    );

    const crashHost = await createCard(hostProject.id, "draft", {
      title: "Crash recovery host",
      description: [
        '<card-toggle card="another-missing-target" meta="">',
        "Crash-safe recovery",
        "  Durable recovery body",
        "</card-toggle>",
      ].join("\n"),
    });
    drainShadows();
    const interrupted = await migrateLegacyForeignReferences(getDb(), {
      limit: 50,
      dependencies: {
        createRecoveredCard: async (input) => {
          await createCard(input.projectId, input.status, input.card);
          throw new Error("injected crash after recovered Card commit");
        },
      },
    });
    invariant(
      interrupted.failedDocuments === 1,
      "Injected recovery interruption was hidden",
    );
    const interruptedLedger = getDb()
      .prepare(
        `
    SELECT target_block_id, recovered_card_id, status, attempt_count
    FROM foreign_reference_migrations
    WHERE host_document_id = ? AND legacy_kind = 'card_toggle'
  `,
      )
      .get(`document:${crashHost.id}`) as {
      readonly target_block_id: string;
      readonly recovered_card_id: string | null;
      readonly status: string;
      readonly attempt_count: number;
    };
    invariant(
      interruptedLedger.status === "failed",
      "Interrupted ledger stayed applying",
    );
    invariant(
      interruptedLedger.recovered_card_id === null,
      "Crash fixture committed too far",
    );
    const resumed = await migrateLegacyForeignReferences(getDb(), {
      limit: 50,
    });
    invariant(resumed.failedDocuments === 0, JSON.stringify(resumed.errors));
    const resumedLedger = getDb()
      .prepare(
        `
    SELECT recovered_card_id, status, attempt_count
    FROM foreign_reference_migrations
    WHERE host_document_id = ? AND legacy_kind = 'card_toggle'
  `,
      )
      .get(`document:${crashHost.id}`) as {
      readonly recovered_card_id: string;
      readonly status: string;
      readonly attempt_count: number;
    };
    invariant(
      resumedLedger.status === "applied",
      "Interrupted migration did not resume",
    );
    invariant(
      resumedLedger.attempt_count === 2,
      "Interrupted migration allocated a new occurrence",
    );
    invariant(
      resumedLedger.recovered_card_id === interruptedLedger.target_block_id,
      "Interrupted migration created a second recovered identity",
    );
    const recoveredCount = getDb()
      .prepare(
        `
    SELECT COUNT(*) AS count FROM cards WHERE id = ?
  `,
      )
      .get(resumedLedger.recovered_card_id) as { readonly count: number };
    invariant(
      recoveredCount.count === 1,
      "Interrupted migration duplicated its recovered Card",
    );
    drainShadows();

    const viewCrashHost = await createCard(hostProject.id, "draft", {
      title: "View crash host",
      description: `<toggle-list-inline-view project="${sourceProject.id}" property-order="priority,estimate,status,tags" show-empty-estimate="false" show-empty-priority="false" />`,
    });
    drainShadows();
    const interruptedView = await migrateLegacyForeignReferences(getDb(), {
      limit: 50,
      dependencies: {
        upsertInlineDatabaseView: (input, database) => {
          upsertLegacyInlineDatabaseView(input, database);
          throw new Error("injected crash after Database View commit");
        },
      },
    });
    invariant(
      interruptedView.failedDocuments === 1,
      "Injected View interruption was hidden",
    );
    const persistedViewCount = getDb()
      .prepare(
        `
    SELECT COUNT(*) AS count
    FROM database_views
    WHERE id LIKE 'database-view:inline:%'
  `,
      )
      .get() as { readonly count: number };
    const resumedView = await migrateLegacyForeignReferences(getDb(), {
      limit: 50,
    });
    invariant(
      resumedView.failedDocuments === 0,
      JSON.stringify(resumedView.errors),
    );
    const resumedViewCount = getDb()
      .prepare(
        `
    SELECT COUNT(*) AS count
    FROM database_views
    WHERE id LIKE 'database-view:inline:%'
  `,
      )
      .get() as { readonly count: number };
    invariant(
      resumedViewCount.count === persistedViewCount.count,
      "Interrupted migration duplicated its durable Database View",
    );
    const viewCrashLedger = getDb()
      .prepare(
        `
    SELECT status, attempt_count, database_view_id
    FROM foreign_reference_migrations
    WHERE host_document_id = ? AND legacy_kind = 'database_query'
  `,
      )
      .get(`document:${viewCrashHost.id}`) as {
      readonly status: string;
      readonly attempt_count: number;
      readonly database_view_id: string;
    };
    invariant(
      viewCrashLedger.status === "applied" &&
        viewCrashLedger.attempt_count === 2 &&
        viewCrashLedger.database_view_id.length > 0,
      "Interrupted View migration did not resume through one durable ledger",
    );

    for (let index = 0; index < 51; index += 1) {
      await createCard(hostProject.id, "draft", {
        title: `Batch host ${index}`,
        description: `<card-ref project="${sourceProject.id}" card="${target.id}" />`,
      });
    }
    drainShadows();
    const boundedBatch = await migrateLegacyForeignReferences(getDb(), {
      limit: 50,
    });
    invariant(
      boundedBatch.processedDocuments === 50 && !boundedBatch.exhausted,
      "A bounded migration batch reported an incorrect intermediate exhaustion state",
    );
    const finalBatch = await migrateLegacyForeignReferences(getDb(), {
      limit: 50,
    });
    invariant(
      finalBatch.processedDocuments === 1 && finalBatch.exhausted,
      "Sequential migration batches did not derive exhaustion from the final read",
    );

    const finalMigration = await migrateLegacyForeignReferences(getDb(), {
      limit: 50,
    });
    invariant(
      finalMigration.failedDocuments === 0,
      JSON.stringify(finalMigration.errors),
    );
    invariant(
      finalMigration.exhausted,
      "Foreign reference migration did not exhaust",
    );
    invariant(
      readActualLegacyReferenceDocuments().length === 0,
      "A ready legacy Y.Doc still owns a foreign body after migration",
    );

    process.stdout.write(
      `${JSON.stringify({
        existingAndLongTitleReferenceMigrated: true,
        staleSnapshotCouldNotOverwriteLiveBody: true,
        recoveryMetadataPreserved: true,
        missingSourceProjectFellBackDurably: true,
        nestedRecoveryReachedFixedPoint: true,
        stableReferenceRetargetAdvancedLedgerOccurrence: true,
        sameTargetContentAdvancedRecoveryOccurrence: true,
        unresolvedReferenceReservedTombstoneIdentity: true,
        archivedAndDeletedHostsMigratedFromActualYDoc: true,
        sideEffectCrashResumedExactlyOnce: true,
        databaseViewSideEffectCrashResumedExactlyOnce: true,
        sequentialBatchesReportedFinalExhaustion: true,
        compatibilityProjectionStayedConsistent: true,
        everyReadyLegacyYDocIsReferenceOnly: true,
      })}\n`,
    );
  } finally {
    closeDatabase();
    fs.rmSync(tempDir, { recursive: true, force: true });
    delete process.env.NODEX_DIR;
  }
};

void run().catch((error: unknown) => {
  process.stderr.write(
    `${error instanceof Error ? error.stack : String(error)}\n`,
  );
  process.exitCode = 1;
});
