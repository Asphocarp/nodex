import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import * as Y from "yjs";
import {
  createDetachedCardDocumentFromBlockTree,
  type BlockTreeNode,
} from "../src/shared/block-documents/block-document-codec";
import { inspectOwnedBlockDocument } from "../src/shared/block-documents/document-schema-adapters";
import {
  SYNCED_BLOCK_DOCUMENT_SCHEMA_KEY,
  SYNCED_BLOCK_DOCUMENT_SCHEMA_VERSION,
  SYNCED_BLOCK_SOURCE_TYPE,
} from "../src/shared/block-documents/synced-block-document";
import { DOCUMENT_VERSION_CONTRACT_VERSION } from "../src/shared/block-documents/document-history";
import {
  applyBlockDocumentUpdate,
  initializeBlockDocumentGenesis,
  loadPrimaryBlockDocument,
} from "../src/main/local-store/block-document-store";
import { createDocumentVersionCheckpoint } from "../src/main/local-store/document-versions";
import { restoreDocumentVersion } from "../src/main/local-store/block-document-operations";
import {
  assertSyncedBlockSourceIsUnreferenced,
  copySyncedBlockSource,
  createSyncedBlockSource,
  demoteSyncedBlockSource,
  promoteBlockToSyncedSource,
  SyncedBlockGroupError,
} from "../src/main/local-store/synced-block-groups";
import {
  closeDatabase,
  getDb,
  initializeDatabase,
} from "../src/main/local-store/database";
import { createProject } from "../src/main/local-store/projects";
import { createUuidV7FromTimestamp } from "../src/shared/card-id";

const invariant: (condition: unknown, message: string) => asserts condition = (
  condition,
  message,
) => {
  if (condition) return;
  throw new Error(message);
};

const paragraph = (
  id: string,
  text: string,
  children: readonly BlockTreeNode[] = [],
): BlockTreeNode => ({
  id,
  type: "paragraph",
  props: {},
  content: [{ type: "text", text, styles: {} }],
  children,
});

const probeBlockId = (sequence: number): string =>
  createUuidV7FromTimestamp(1_784_000_000_000, sequence);

const blockIds = {
  probeSource: probeBlockId(1),
  probeParagraph: probeBlockId(2),
  moveRoot: probeBlockId(3),
  moveChild: probeBlockId(4),
  moveReference: probeBlockId(5),
  moveSource: probeBlockId(6),
  faultRoot: probeBlockId(7),
  faultReference: probeBlockId(8),
  faultSource: probeBlockId(9),
  staleSource: probeBlockId(10),
  missing: probeBlockId(11),
  copiedSource: probeBlockId(12),
} as const;

const writeFence = (
  leaseId: string,
  ...documents: readonly {
    readonly documentId: string;
    readonly generation: number;
    readonly headSeq: number;
  }[]
) => ({ leaseId, documents });

const seedHost = (
  projectId: string,
  cardId: string,
  documentId: string,
  blockTree: readonly BlockTreeNode[],
): void => {
  const database = getDb();
  const now = new Date().toISOString();
  database
    .prepare(
      `
    INSERT INTO blocks (
      id, project_id, type, lifecycle, location_kind,
      containing_document_id, location_revision, metadata_revision,
      created_at, updated_at
    ) VALUES (?, ?, 'card', 'active', 'space', NULL, 1, 1, ?, ?)
  `,
    )
    .run(cardId, projectId, now, now);
  database
    .prepare(
      `
    INSERT INTO top_level_block_placements (
      block_id, project_id, rank_key, created_at, updated_at
    ) VALUES (?, ?, '100000000000:host', ?, ?)
  `,
    )
    .run(cardId, projectId, now, now);
  database
    .prepare(
      `
    INSERT INTO documents (
      id, project_id, generation, head_seq, schema_key, schema_version,
      state_vector, state_hash, readiness, authority,
      genesis_source_revision, created_at, updated_at
    ) VALUES (?, ?, 1, 0, 'nodex.card', 2, X'', '',
      'pending_genesis', 'legacy_shadow', NULL, ?, ?)
  `,
    )
    .run(documentId, projectId, now, now);
  database
    .prepare(
      `
    INSERT INTO block_documents (block_id, document_id, project_id, created_at)
    VALUES (?, ?, ?, ?)
  `,
    )
    .run(cardId, documentId, projectId, now);
  const detached = createDetachedCardDocumentFromBlockTree({
    documentId,
    title: "Host",
    blockTree,
  });
  try {
    const epoch = database
      .prepare("SELECT store_epoch FROM block_store_metadata WHERE id = 1")
      .get() as { readonly store_epoch: string };
    initializeBlockDocumentGenesis(database, {
      documentId,
      storeEpoch: epoch.store_epoch,
      generation: 1,
      updateId: `genesis:${documentId}`,
      clientSessionId: "probe:genesis",
      update: Y.encodeStateAsUpdate(detached.document),
      finalAuthority: "ydoc_primary",
    });
  } finally {
    detached.document.destroy();
  }
};

const materialize = (documentId: string) => {
  const loaded = loadPrimaryBlockDocument(getDb(), documentId);
  try {
    return inspectOwnedBlockDocument(loaded.document, {
      ownerType: loaded.ownerType,
      schemaKey: loaded.head.schemaKey,
      schemaVersion: loaded.head.schemaVersion,
    }).materialization;
  } finally {
    loaded.document.destroy();
  }
};

const materializePersistedSyncedSource = (documentId: string) => {
  const database = getDb();
  const head = database
    .prepare(
      `
      SELECT generation, head_seq
      FROM documents
      WHERE id = ?
    `,
    )
    .get(documentId) as {
    readonly generation: number;
    readonly head_seq: number;
  };
  const snapshot = database
    .prepare(
      `
      SELECT snapshot_seq, snapshot_update
      FROM document_snapshots
      WHERE document_id = ? AND generation = ?
      ORDER BY snapshot_seq DESC
      LIMIT 1
    `,
    )
    .get(documentId, head.generation) as
    | { readonly snapshot_seq: number; readonly snapshot_update: Uint8Array }
    | undefined;
  const document = new Y.Doc({ guid: documentId });
  try {
    if (snapshot) Y.applyUpdate(document, snapshot.snapshot_update);
    const tail = database
      .prepare(
        `
        SELECT seq, update_blob
        FROM document_updates
        WHERE document_id = ? AND generation = ? AND seq > ?
        ORDER BY seq
      `,
      )
      .all(
        documentId,
        head.generation,
        snapshot?.snapshot_seq ?? 0,
      ) as readonly {
      readonly seq: number;
      readonly update_blob: Uint8Array;
    }[];
    for (const update of tail) Y.applyUpdate(document, update.update_blob);
    invariant(
      (tail.at(-1)?.seq ?? snapshot?.snapshot_seq ?? 0) === head.head_seq,
      `persisted Synced Block update tail does not reach head ${head.head_seq}`,
    );
    return {
      headSeq: head.head_seq,
      materialization: inspectOwnedBlockDocument(document, {
        ownerType: SYNCED_BLOCK_SOURCE_TYPE,
        schemaKey: SYNCED_BLOCK_DOCUMENT_SCHEMA_KEY,
        schemaVersion: SYNCED_BLOCK_DOCUMENT_SCHEMA_VERSION,
      }).materialization,
    };
  } finally {
    document.destroy();
  }
};

const findText = (document: Y.Doc): Y.XmlText => {
  for (const node of document
    .getXmlFragment("body")
    .createTreeWalker(() => true)) {
    if (node instanceof Y.XmlText) return node;
  }
  throw new Error("Expected text");
};

const main = async (): Promise<void> => {
  const directory = fs.mkdtempSync(
    path.join(os.tmpdir(), "nodex-synced-probe-"),
  );
  process.env.NODEX_DIR = directory;
  try {
    await initializeDatabase();
    const project = createProject({ name: "Synced Block probe" });
    const storeEpoch = (
      getDb()
        .prepare("SELECT store_epoch FROM block_store_metadata WHERE id = 1")
        .get() as { readonly store_epoch: string }
    ).store_epoch;
    const created = createSyncedBlockSource(getDb(), {
      operationId: "probe:create",
      projectId: project.id,
      storeEpoch,
      sourceBlockId: blockIds.probeSource,
      documentId: "document:probe-source",
      clientSessionId: "probe:create",
      actor: { surface: "probe", attempt: 1 },
      blockTree: [paragraph(blockIds.probeParagraph, "base")],
    });
    invariant(!created.duplicate, "create was duplicate");
    const retry = createSyncedBlockSource(getDb(), {
      operationId: "probe:create",
      projectId: project.id,
      storeEpoch,
      sourceBlockId: blockIds.probeSource,
      documentId: "document:probe-source",
      clientSessionId: "probe:retry",
      actor: { surface: "lost-response-retry", attempt: 2 },
      blockTree: [paragraph(blockIds.probeParagraph, "base")],
    });
    invariant(retry.duplicate, "lost-response retry was not durable");

    const loaded = loadPrimaryBlockDocument(getDb(), created.documentId);
    const encoded = Y.encodeStateAsUpdate(loaded.document);
    loaded.document.destroy();
    const left = new Y.Doc({ guid: created.documentId });
    const right = new Y.Doc({ guid: created.documentId });
    Y.applyUpdate(left, encoded);
    Y.applyUpdate(right, encoded);
    invariant(
      JSON.stringify([...left.share.keys()].sort()) === '["body"]',
      "synced source invented a title root",
    );
    const leftVector = Y.encodeStateVector(left);
    const rightVector = Y.encodeStateVector(right);
    findText(left).insert(0, "L");
    findText(right).insert(findText(right).length, "R");
    applyBlockDocumentUpdate(getDb(), {
      documentId: created.documentId,
      storeEpoch: created.storeEpoch,
      generation: 1,
      updateId: "probe:left",
      clientSessionId: "probe:left",
      baseHeadSeq: 1,
      touchedBlockIds: [blockIds.probeParagraph],
      update: Y.encodeStateAsUpdate(left, leftVector),
    });
    applyBlockDocumentUpdate(getDb(), {
      documentId: created.documentId,
      storeEpoch: created.storeEpoch,
      generation: 1,
      updateId: "probe:right",
      clientSessionId: "probe:right",
      baseHeadSeq: 1,
      touchedBlockIds: [blockIds.probeParagraph],
      update: Y.encodeStateAsUpdate(right, rightVector),
    });
    left.destroy();
    right.destroy();
    invariant(
      materialize(created.documentId).plainText === "LbaseR",
      "clients did not converge",
    );
    const checkpoint = createDocumentVersionCheckpoint(getDb(), {
      version: DOCUMENT_VERSION_CONTRACT_VERSION,
      projectId: project.id,
      storeEpoch: created.storeEpoch,
      documentId: created.documentId,
      expectedGeneration: 1,
      expectedHeadSeq: 3,
      cause: "manual",
      actor: {},
    }).checkpoint;
    invariant(
      checkpoint.materializationKind === "synced_block" &&
        checkpoint.title === null,
      "history leaked a Card title",
    );
    const later = loadPrimaryBlockDocument(getDb(), created.documentId);
    const laterVector = Y.encodeStateVector(later.document);
    findText(later.document).insert(0, "later-");
    applyBlockDocumentUpdate(getDb(), {
      documentId: created.documentId,
      storeEpoch: created.storeEpoch,
      generation: 1,
      updateId: "probe:later",
      clientSessionId: "probe:later",
      baseHeadSeq: 3,
      touchedBlockIds: [blockIds.probeParagraph],
      update: Y.encodeStateAsUpdate(later.document, laterVector),
    });
    later.document.destroy();
    const restored = restoreDocumentVersion(
      getDb(),
      {
        version: DOCUMENT_VERSION_CONTRACT_VERSION,
        mutationId: "probe:restore",
        projectId: project.id,
        storeEpoch: created.storeEpoch,
        documentId: created.documentId,
        versionId: checkpoint.versionId,
        generation: 1,
        expectedHeadSeq: 4,
        clientSessionId: "probe:restore",
        actor: {},
      },
      {
        writeFence: {
          leaseId: "probe:restore",
          documentId: created.documentId,
          generation: 1,
          headSeq: 4,
        },
      },
    );
    invariant(restored.ok, "forward history restore failed");

    seedHost(project.id, "probe-host", "document:probe-host", [
      paragraph(blockIds.moveRoot, "root", [
        paragraph(blockIds.moveChild, "child"),
      ]),
    ]);
    const promoted = promoteBlockToSyncedSource(getDb(), {
      operationId: "probe:promote",
      projectId: project.id,
      storeEpoch,
      hostDocumentId: "document:probe-host",
      expectedGeneration: 1,
      expectedHeadSeq: 1,
      rootBlockId: blockIds.moveRoot,
      referenceBlockId: blockIds.moveReference,
      sourceBlockId: blockIds.moveSource,
      sourceDocumentId: "document:move-source",
      clientSessionId: "probe:promote",
      actor: { surface: "probe", attempt: 1 },
      writeFence: writeFence("lease:promote", {
        documentId: "document:probe-host",
        generation: 1,
        headSeq: 1,
      }),
    });
    const promotedBody = materialize("document:move-source");
    invariant(
      promotedBody.blockTree[0]?.id === blockIds.moveRoot &&
        promotedBody.blockTree[0]?.children[0]?.id === blockIds.moveChild,
      "promotion did not preserve application IDs",
    );
    const libraryPlacement = getDb()
      .prepare(
        `
        SELECT source.location_kind,
          EXISTS (
            SELECT 1 FROM top_level_block_placements placement
            WHERE placement.block_id = source.id
          ) AS has_placement,
          EXISTS (
            SELECT 1 FROM database_memberships membership
            WHERE membership.card_block_id = source.id
              AND membership.removed_at IS NULL
          ) AS has_membership
        FROM blocks source
        WHERE source.id = ? AND source.type = 'synced_block_source'
      `,
      )
      .get(blockIds.moveSource) as {
      readonly location_kind: string;
      readonly has_placement: number;
      readonly has_membership: number;
    };
    invariant(
      libraryPlacement.location_kind === "space" &&
        libraryPlacement.has_placement === 1 &&
        libraryPlacement.has_membership === 0,
      "Synced Block library source escaped its hidden non-Card placement contract",
    );
    let referencedDeleteRejected = false;
    try {
      assertSyncedBlockSourceIsUnreferenced(getDb(), {
        projectId: project.id,
        sourceBlockId: blockIds.moveSource,
        sourceDocumentId: "document:move-source",
      });
    } catch (error) {
      referencedDeleteRejected =
        error instanceof SyncedBlockGroupError &&
        error.code === "source_shared";
    }
    invariant(
      referencedDeleteRejected,
      "Synced Block deletion/GC guard accepted a referenced source",
    );
    const promotionRetry = promoteBlockToSyncedSource(getDb(), {
      operationId: "probe:promote",
      projectId: project.id,
      storeEpoch,
      hostDocumentId: "document:probe-host",
      expectedGeneration: 1,
      expectedHeadSeq: 1,
      rootBlockId: blockIds.moveRoot,
      referenceBlockId: blockIds.moveReference,
      sourceBlockId: blockIds.moveSource,
      sourceDocumentId: "document:move-source",
      clientSessionId: "probe:retry",
      actor: { surface: "lost-response-retry", attempt: 2 },
      writeFence: writeFence("lease:promote-retry", {
        documentId: "document:probe-host",
        generation: 1,
        headSeq: 1,
      }),
    });
    invariant(promotionRetry.duplicate, "promotion retry was not durable");
    const copied = copySyncedBlockSource(getDb(), {
      operationId: "probe:copy",
      projectId: project.id,
      storeEpoch,
      sourceBlockId: blockIds.moveSource,
      sourceDocumentId: "document:move-source",
      expectedSourceGeneration: 1,
      expectedSourceHeadSeq: 1,
      newSourceBlockId: blockIds.copiedSource,
      newDocumentId: "document:move-source-copy",
      clientSessionId: "probe:copy",
      actor: { surface: "probe" },
    });
    const copiedBody = materialize(copied.documentId).blockTree[0];
    invariant(
      copiedBody?.id !== blockIds.moveRoot &&
        copiedBody?.children[0]?.id !== blockIds.moveChild &&
        copiedBody?.id !== copiedBody?.children[0]?.id,
      "copy reused source identity",
    );
    let incompleteFenceRejected = false;
    try {
      demoteSyncedBlockSource(getDb(), {
        operationId: "probe:demote:bad-fence",
        projectId: project.id,
        storeEpoch,
        hostDocumentId: "document:probe-host",
        expectedGeneration: 1,
        expectedHeadSeq: promoted.hostMutation.headSeq,
        expectedSourceGeneration: 1,
        expectedSourceHeadSeq: 1,
        referenceBlockId: blockIds.moveReference,
        sourceBlockId: blockIds.moveSource,
        sourceDocumentId: "document:move-source",
        clientSessionId: "probe:demote:bad-fence",
        actor: { surface: "probe" },
        writeFence: writeFence("lease:incomplete", {
          documentId: "document:probe-host",
          generation: 1,
          headSeq: promoted.hostMutation.headSeq,
        }),
      });
    } catch (error) {
      incompleteFenceRejected =
        error instanceof SyncedBlockGroupError &&
        error.code === "invalid_request";
    }
    invariant(
      incompleteFenceRejected &&
        materialize("document:probe-host").blockTree[0]?.id ===
          blockIds.moveReference,
      "demotion accepted an incomplete dual-Document write fence",
    );
    const demoted = demoteSyncedBlockSource(getDb(), {
      operationId: "probe:demote",
      projectId: project.id,
      storeEpoch,
      hostDocumentId: "document:probe-host",
      expectedGeneration: 1,
      expectedHeadSeq: promoted.hostMutation.headSeq,
      expectedSourceGeneration: 1,
      expectedSourceHeadSeq: 1,
      referenceBlockId: blockIds.moveReference,
      sourceBlockId: blockIds.moveSource,
      sourceDocumentId: "document:move-source",
      clientSessionId: "probe:demote",
      actor: { surface: "probe" },
      writeFence: writeFence(
        "lease:demote",
        {
          documentId: "document:probe-host",
          generation: 1,
          headSeq: promoted.hostMutation.headSeq,
        },
        {
          documentId: "document:move-source",
          generation: 1,
          headSeq: 1,
        },
      ),
    });
    invariant(!demoted.duplicate, "first demotion was duplicate");
    invariant(
      materialize("document:probe-host").blockTree[0]?.id === blockIds.moveRoot,
      "demotion did not move original IDs back",
    );
    const clearedSource = materializePersistedSyncedSource(
      "document:move-source",
    );
    invariant(
      clearedSource.headSeq === 2 &&
        clearedSource.materialization.blockTree.length === 0,
      "demotion left ghost content in the source Y.Doc head",
    );
    const clearedProjection = getDb()
      .prepare(
        `
        SELECT projected_seq, block_tree_json
        FROM document_materializations
        WHERE document_id = ?
      `,
      )
      .get("document:move-source") as {
      readonly projected_seq: number;
      readonly block_tree_json: string;
    };
    invariant(
      clearedProjection.projected_seq === clearedSource.headSeq &&
        clearedProjection.block_tree_json === "[]",
      "demotion left a stale source projection",
    );
    const movedRegistry = getDb()
      .prepare(
        `
        SELECT id, lifecycle, containing_document_id
        FROM blocks
        WHERE id IN (?, ?)
        ORDER BY id
      `,
      )
      .all(blockIds.moveRoot, blockIds.moveChild) as readonly {
      readonly id: string;
      readonly lifecycle: string;
      readonly containing_document_id: string | null;
    }[];
    invariant(
      movedRegistry.length === 2 &&
        movedRegistry.every(
          (row) =>
            row.lifecycle === "active" &&
            row.containing_document_id === "document:probe-host",
        ),
      "demotion did not atomically move the Block registry",
    );
    closeDatabase();
    await initializeDatabase();
    const restartedSource = materializePersistedSyncedSource(
      "document:move-source",
    );
    invariant(
      materialize("document:probe-host").blockTree[0]?.id === blockIds.moveRoot &&
        restartedSource.headSeq === 2 &&
        restartedSource.materialization.blockTree.length === 0,
      "promotion/demotion state did not survive a SQLite restart",
    );

    seedHost(project.id, "fault-host", "document:fault-host", [
      paragraph(blockIds.faultRoot, "fault"),
    ]);
    let faultRolledBack = false;
    try {
      promoteBlockToSyncedSource(getDb(), {
        operationId: "probe:fault",
        projectId: project.id,
        storeEpoch,
        hostDocumentId: "document:fault-host",
        expectedGeneration: 1,
        expectedHeadSeq: 1,
        rootBlockId: blockIds.faultRoot,
        referenceBlockId: blockIds.faultReference,
        sourceBlockId: blockIds.faultSource,
        sourceDocumentId: "document:fault-source",
        clientSessionId: "probe:fault",
        actor: { surface: "probe" },
        writeFence: writeFence("lease:fault", {
          documentId: "document:fault-host",
          generation: 1,
          headSeq: 1,
        }),
        faultInjector: (point) => {
          if (point === "before_commit") throw new Error("fault");
        },
      });
    } catch (error) {
      faultRolledBack = error instanceof Error && error.message === "fault";
    }
    const residue = getDb()
      .prepare("SELECT COUNT(*) AS count FROM blocks WHERE id IN (?, ?)")
      .get(blockIds.faultSource, blockIds.faultReference) as {
      readonly count: number;
    };
    invariant(
      faultRolledBack && residue.count === 0,
      "promotion fault left residue",
    );

    const stale = createSyncedBlockSource(getDb(), {
      operationId: "probe:stale",
      projectId: project.id,
      storeEpoch,
      sourceBlockId: blockIds.staleSource,
      documentId: "document:stale-source",
      clientSessionId: "probe:stale",
      actor: { surface: "probe" },
      blockTree: [],
    });
    getDb()
      .prepare(
        "UPDATE document_materializations SET projected_seq = projected_seq - 1 WHERE document_id = ?",
      )
      .run(stale.documentId);
    let staleFailedClosed = false;
    try {
      demoteSyncedBlockSource(getDb(), {
        operationId: "probe:stale-demote",
        projectId: project.id,
        storeEpoch,
        hostDocumentId: "document:fault-host",
        expectedGeneration: 1,
        expectedHeadSeq: 1,
        expectedSourceGeneration: 1,
        expectedSourceHeadSeq: 1,
        referenceBlockId: blockIds.missing,
        sourceBlockId: blockIds.staleSource,
        sourceDocumentId: "document:stale-source",
        clientSessionId: "probe:stale",
        actor: { surface: "probe", attempt: 1 },
        writeFence: writeFence(
          "lease:stale",
          {
            documentId: "document:fault-host",
            generation: 1,
            headSeq: 1,
          },
          {
            documentId: "document:stale-source",
            generation: 1,
            headSeq: 1,
          },
        ),
      });
    } catch (error) {
      staleFailedClosed =
        error instanceof SyncedBlockGroupError &&
        error.code === "document_state_corrupt";
    }
    invariant(
      staleFailedClosed,
      "stale reference projection did not fail closed",
    );
    let staleRetryFailedClosed = false;
    try {
      demoteSyncedBlockSource(getDb(), {
        operationId: "probe:stale-demote",
        projectId: project.id,
        storeEpoch,
        hostDocumentId: "document:fault-host",
        expectedGeneration: 1,
        expectedHeadSeq: 1,
        expectedSourceGeneration: 1,
        expectedSourceHeadSeq: 1,
        referenceBlockId: blockIds.missing,
        sourceBlockId: blockIds.staleSource,
        sourceDocumentId: "document:stale-source",
        clientSessionId: "probe:stale-retry",
        actor: { surface: "lost-response-retry", attempt: 2 },
        writeFence: writeFence(
          "lease:stale-retry",
          {
            documentId: "document:fault-host",
            generation: 1,
            headSeq: 1,
          },
          {
            documentId: "document:stale-source",
            generation: 1,
            headSeq: 1,
          },
        ),
      });
    } catch (error) {
      staleRetryFailedClosed =
        error instanceof SyncedBlockGroupError &&
        error.code === "document_state_corrupt";
    }
    invariant(
      staleRetryFailedClosed,
      "durable rejection retry changed the operation outcome",
    );

    const counts = getDb()
      .prepare(
        `
      SELECT
        (SELECT COUNT(*) FROM block_mutations
          WHERE mutation_kind IN (
            'create_synced_block_source', 'copy_synced_block_source',
            'promote_synced_block_source', 'demote_synced_block_source'
          )) AS receipts,
        (SELECT COUNT(*) FROM block_mutations
          WHERE mutation_kind IN (
            'create_synced_block_source', 'copy_synced_block_source',
            'promote_synced_block_source', 'demote_synced_block_source'
          ) AND outcome = 'committed') AS committed,
        (SELECT COUNT(*) FROM block_mutations
          WHERE mutation_kind IN (
            'create_synced_block_source', 'copy_synced_block_source',
            'promote_synced_block_source', 'demote_synced_block_source'
          ) AND outcome = 'rejected') AS rejected,
        (SELECT COUNT(*) FROM change_log WHERE kind = 'block_mutation'
          AND operation_id LIKE 'probe:%') AS changes,
        (SELECT COUNT(*)
          FROM block_mutations mutation
          INNER JOIN change_log change ON change.operation_id = mutation.mutation_id
          WHERE mutation.outcome = 'rejected'
            AND mutation.mutation_id LIKE 'probe:%') AS rejected_changes
    `,
      )
      .get() as {
      readonly receipts: number;
      readonly committed: number;
      readonly rejected: number;
      readonly changes: number;
      readonly rejected_changes: number;
    };
    invariant(
      counts.receipts >= 6 &&
        counts.rejected >= 1 &&
        counts.changes >= counts.committed &&
        counts.rejected_changes === 0,
      `receipts missing: ${JSON.stringify(counts)}`,
    );
    const firstAttemptAudits = getDb()
      .prepare(
        `
        SELECT mutation_id, actor_json, client_session_id
        FROM block_mutations
        WHERE mutation_id IN ('probe:create', 'probe:promote', 'probe:stale-demote')
        ORDER BY mutation_id
      `,
      )
      .all() as readonly {
      readonly mutation_id: string;
      readonly actor_json: string;
      readonly client_session_id: string | null;
    }[];
    invariant(
      firstAttemptAudits.length === 3 &&
        firstAttemptAudits.every(
          (row) =>
            row.actor_json === '{"attempt":1,"surface":"probe"}' &&
            row.client_session_id !== null &&
            row.client_session_id !== "probe:retry" &&
            row.client_session_id !== "probe:stale-retry",
        ),
      "lost-response retry overwrote first-attempt actor/session audit",
    );

    console.log(
      JSON.stringify({
        bodyOnly: true,
        converged: true,
        historyForwardRestore: true,
        promotionIdentity: true,
        librarySourcePlacement: true,
        referencedSourceGcGuard: true,
        copyIdentity: true,
        demotionIdentity: true,
        restartPersistence: true,
        durableRetry: true,
        faultRollback: true,
        staleReferenceGate: true,
        durableRejection: true,
        dualDocumentFence: true,
        firstAttemptAudit: true,
        receipts: counts.receipts,
      }),
    );
  } finally {
    closeDatabase();
    fs.rmSync(directory, { recursive: true, force: true });
  }
};

void main();
