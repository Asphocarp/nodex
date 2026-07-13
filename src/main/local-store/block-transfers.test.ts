import { describe, expect, test } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import * as Y from "yjs";
import {
  createCardDocument,
  openCardDocument,
  planBlockToCardTransformation,
} from "../../shared/block-documents";
import type {
  DatabaseMutationRequest,
} from "../../shared/database-kernel";
import type {
  BlockTransferIntent,
  BlockTransferRequest,
} from "../../shared/block-transfer";
import { createUuidV7, isUuidV7 } from "../../shared/card-id";
import { initializeCardDocumentGenesis } from "./block-document-store";
import {
  applyBlockTransfer,
  prepareBlockTransfer,
  readCommittedBlockTransfer,
} from "./block-transfers";
import { applyDocumentOperationBatch } from "./block-document-operations";
import { closeDatabase, getDb, initializeDatabase } from "./database";
import { applyDatabaseMutation } from "./database-kernel";
import { createProject } from "./projects";

const seedCard = (
  database: ReturnType<typeof getDb>,
  input: {
    readonly projectId: string;
    readonly storeEpoch: string;
    readonly cardId: string;
    readonly title: string;
    readonly rankKey: string;
    readonly bodyType?: string;
  },
): string => {
  const now = new Date().toISOString();
  const documentId = `document:${input.cardId}`;
  database
    .prepare(
      `
      INSERT INTO blocks (
        id, project_id, type, lifecycle, location_kind,
        containing_document_id, containing_database_id,
        location_revision, metadata_revision, created_at, updated_at
      ) VALUES (?, ?, 'card', 'active', 'space', NULL, NULL, 1, 1, ?, ?)
    `,
    )
    .run(input.cardId, input.projectId, now, now);
  database
    .prepare(
      `INSERT INTO top_level_block_placements
       (block_id, project_id, rank_key, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?)`,
    )
    .run(input.cardId, input.projectId, input.rankKey, now, now);
  database
    .prepare(
      `
      INSERT INTO documents (
        id, project_id, generation, head_seq, schema_key, schema_version,
        state_vector, state_hash, readiness, authority, created_at, updated_at
      ) VALUES (?, ?, 1, 0, 'nodex.card', 2, X'', '',
                'pending_genesis', 'legacy_shadow', ?, ?)
    `,
    )
    .run(documentId, input.projectId, now, now);
  database
    .prepare(
      `INSERT INTO block_documents (block_id, document_id, project_id, created_at)
       VALUES (?, ?, ?, ?)`,
    )
    .run(input.cardId, documentId, input.projectId, now);
  database
    .prepare(
      `INSERT INTO blocks (
         id, project_id, type, lifecycle, location_kind,
         containing_document_id, containing_database_id,
         location_revision, metadata_revision, created_at, updated_at
       ) VALUES (?, ?, 'paragraph', 'active', 'document', ?, NULL, 1, 1, ?, ?)`,
    )
    .run(
      `paragraph:${input.cardId}`,
      input.projectId,
      documentId,
      now,
      now,
    );
  const genesis = createCardDocument({
    documentId,
    initialTitle: input.title,
  });
  const root = openCardDocument(genesis.document).body.get(0);
  if (!(root instanceof Y.XmlElement)) {
    throw new Error("Card genesis has no Block group");
  }
  const paragraph = new Y.XmlElement("blockContainer");
  paragraph.setAttribute("id", `paragraph:${input.cardId}`);
  const paragraphNode = new Y.XmlElement(input.bodyType ?? "paragraph");
  const text = new Y.XmlText();
  text.insert(0, `${input.title} body`);
  paragraphNode.insert(0, [text]);
  paragraph.insert(0, [paragraphNode]);
  root.insert(0, [paragraph]);
  initializeCardDocumentGenesis(database, {
    documentId,
    storeEpoch: input.storeEpoch,
    generation: 1,
    updateId: `genesis:${input.cardId}`,
    clientSessionId: "test:migration",
    update: Y.encodeStateAsUpdate(genesis.document),
    finalAuthority: "ydoc_primary",
  });
  genesis.document.destroy();
  const intrinsic = [
    ["agent.blocked", "boolean", false],
    ["agent.status", "string", null],
    ["run.target", "string", "localProject"],
    ["run.localPath", "string", null],
    ["run.baseBranch", "string", null],
    ["run.worktreePath", "string", null],
    ["run.environmentPath", "string", null],
    ["schedule.isAllDay", "boolean", false],
    ["schedule.timezone", "string", null],
    ["recurrence.config", "json", null],
    ["reminders.config", "json", []],
  ] as const;
  const insertIntrinsic = database.prepare(
    `INSERT INTO block_properties
     (block_id, project_id, property_key, value_type, value_json, revision, updated_at)
     VALUES (?, ?, ?, ?, ?, 1, ?)`,
  );
  for (const [key, valueType, value] of intrinsic) {
    insertIntrinsic.run(
      input.cardId,
      input.projectId,
      key,
      valueType,
      JSON.stringify(value),
      now,
    );
  }
  return documentId;
};

describe("BlockTransfer store", () => {
  test("atomically moves one Card Database -> Document -> Database and restores dormant membership", async () => {
    closeDatabase();
    const previous = process.env.NODEX_DIR;
    const directory = fs.mkdtempSync(
      path.join(os.tmpdir(), "nodex-block-transfer-"),
    );
    process.env.NODEX_DIR = directory;
    try {
      await initializeDatabase();
      const project = createProject({ name: "Block transfer" });
      const database = getDb();
      const metadata = database
        .prepare("SELECT store_epoch FROM block_store_metadata WHERE id = 1")
        .get() as { readonly store_epoch: string };
      const sourceDocumentId = seedCard(database, {
        projectId: project.id,
        storeEpoch: metadata.store_epoch,
        cardId: "card-source",
        title: "Source",
        rankKey: "30000000000000000000000000000000",
      });
      const hostDocumentId = seedCard(database, {
        projectId: project.id,
        storeEpoch: metadata.store_epoch,
        cardId: "card-host",
        title: "Host",
        rankKey: "50000000000000000000000000000000",
      });

      const primary = database
        .prepare(
          `SELECT capability.block_id AS database_block_id,
                  view.id AS view_id
           FROM database_capabilities capability
           JOIN database_views view
             ON view.database_block_id = capability.block_id
            AND view.project_id = capability.project_id
            AND view.is_primary = 1
           WHERE capability.project_id = ? AND capability.is_primary = 1`,
        )
        .get(project.id) as {
        readonly database_block_id: string;
        readonly view_id: string;
      };
      const enterDatabase: DatabaseMutationRequest = {
        version: 1,
        operationId: "place-source-in-database",
        projectId: project.id,
        storeEpoch: metadata.store_epoch,
        actor: { kind: "test" },
        operations: [
          {
            kind: "transfer_membership",
            cardBlockId: "card-source",
            expectedMembership: null,
            target: {
              databaseBlockId: primary.database_block_id,
              membershipId: "membership-source-target",
              viewId: primary.view_id,
              groupKey: "backlog",
            },
          },
        ],
      };
      expect(applyDatabaseMutation(database, enterDatabase).ok).toBe(true);

      const toDocument: BlockTransferRequest = {
        version: 1,
        operationId: "transfer-source-to-host",
        projectId: project.id,
        storeEpoch: metadata.store_epoch,
        clientSessionId: "window-1",
        actor: { kind: "test" },
        mode: "move",
        rootBlockIds: ["card-source"],
        expectedLocationRevisions: { "card-source": 2 },
        source: {
          kind: "database",
          databaseBlockId: primary.database_block_id,
          memberships: {
            "card-source": {
              membershipId: "membership-source-target",
              revision: 1,
            },
          },
        },
        target: {
          kind: "document",
          documentId: hostDocumentId,
          generation: 1,
          expectedHeadSeq: 1,
        },
      };
      const toDocumentIntent: BlockTransferIntent = {
        version: 1,
        operationId: toDocument.operationId,
        projectId: project.id,
        storeEpoch: metadata.store_epoch,
        clientSessionId: "window-1",
        actor: { kind: "test" },
        mode: "move",
        rootBlockIds: ["card-source"],
        source: {
          kind: "database",
          databaseBlockId: primary.database_block_id,
        },
        target: { kind: "document", documentId: hostDocumentId },
      };
      const prepared = prepareBlockTransfer(database, toDocumentIntent);
      expect(prepared.ok).toBe(true);
      if (!prepared.ok) return;
      expect(prepared.value.request).toEqual(toDocument);
      expect(prepared.value.leaseDocuments).toEqual([
        { documentId: hostDocumentId, generation: 1, expectedHeadSeq: 1 },
      ]);
      for (const point of [
        "after_parent_transition",
        "after_target_document",
        "after_projections",
        "after_change_log",
        "after_ledger",
        "before_commit",
      ] as const) {
        const operationId = `fault-${point}`;
        expect(() =>
          applyBlockTransfer(
            database,
            { ...toDocument, operationId },
            {
              faultInjector: (current) => {
                if (current === point) throw new Error(`injected ${point}`);
              },
            },
          ),
        ).toThrow(`injected ${point}`);
        expect(
          database
            .prepare(
              "SELECT location_kind, location_revision FROM blocks WHERE id = ?",
            )
            .get("card-source"),
        ).toEqual({ location_kind: "database", location_revision: 2 });
        expect(
          database
            .prepare("SELECT head_seq FROM documents WHERE id = ?")
            .get(hostDocumentId),
        ).toEqual({ head_seq: 1 });
        expect(
          database
            .prepare("SELECT 1 AS present FROM block_mutations WHERE mutation_id = ?")
            .get(operationId),
        ).toBeUndefined();
      }
      expect(() =>
        applyBlockTransfer(database, toDocument, {
          faultInjector: (point) => {
            if (point === "after_commit") {
              throw new Error("injected response loss");
            }
          },
        }),
      ).toThrow("injected response loss");
      const committedAfterResponseLoss = readCommittedBlockTransfer(
        database,
        { ...toDocumentIntent, clientSessionId: "window-after-reconnect" },
      );
      expect(
        committedAfterResponseLoss.ok &&
          committedAfterResponseLoss.value?.duplicate,
      ).toBe(true);
      const movedIntoDocument = applyBlockTransfer(database, toDocument);
      expect(movedIntoDocument.ok).toBe(true);
      if (!movedIntoDocument.ok) return;
      expect(movedIntoDocument.value.duplicate).toBe(true);
      expect(movedIntoDocument.value.documentCommits).toHaveLength(1);
      expect(movedIntoDocument.value.finalLocations["card-source"]).toEqual({
        kind: "document",
        documentId: hostDocumentId,
      });
      expect(
        database
          .prepare(
            "SELECT block_type FROM document_block_index WHERE document_id = ? AND block_id = ?",
          )
          .get(hostDocumentId, "card-source"),
      ).toEqual({ block_type: "card" });
      expect(
        database
          .prepare(
            "SELECT removed_at, revision FROM database_memberships WHERE id = ?",
          )
          .get("membership-source-target"),
      ).toMatchObject({ revision: 2 });
      expect(
        database
          .prepare(
            "SELECT document_id FROM block_documents WHERE block_id = ?",
          )
          .get("card-source"),
      ).toEqual({ document_id: sourceDocumentId });

      const duplicate = applyBlockTransfer(database, {
        ...toDocument,
        clientSessionId: "window-after-reconnect",
      });
      expect(duplicate.ok && duplicate.value.duplicate).toBe(true);

      const hostHead = database
        .prepare("SELECT head_seq FROM documents WHERE id = ?")
        .get(hostDocumentId) as { readonly head_seq: number };
      const backToDatabase: BlockTransferRequest = {
        version: 1,
        operationId: "transfer-source-back-to-database",
        projectId: project.id,
        storeEpoch: metadata.store_epoch,
        clientSessionId: "window-1",
        actor: { kind: "test" },
        mode: "move",
        rootBlockIds: ["card-source"],
        expectedLocationRevisions: { "card-source": 3 },
        source: {
          kind: "document",
          documentId: hostDocumentId,
          generation: 1,
          expectedHeadSeq: hostHead.head_seq,
        },
        target: {
          kind: "database",
          databaseBlockId: primary.database_block_id,
          viewId: primary.view_id,
          groupKey: "backlog",
        },
      };
      expect(() =>
        applyBlockTransfer(database, backToDatabase, {
          faultInjector: (point) => {
            if (point === "after_source_document") {
              throw new Error("injected transfer fault");
            }
          },
        }),
      ).toThrow("injected transfer fault");
      expect(
        database
          .prepare("SELECT head_seq FROM documents WHERE id = ?")
          .get(hostDocumentId),
      ).toEqual(hostHead);
      expect(
        database
          .prepare(
            "SELECT block_type FROM document_block_index WHERE document_id = ? AND block_id = ?",
          )
          .get(hostDocumentId, "card-source"),
      ).toEqual({ block_type: "card" });

      const movedBack = applyBlockTransfer(database, backToDatabase);
      expect(movedBack.ok).toBe(true);
      expect(
        database
          .prepare(
            `SELECT id, revision, removed_at
             FROM database_memberships
             WHERE card_block_id = ? AND database_block_id = ?`,
          )
          .get("card-source", primary.database_block_id),
      ).toEqual({
        id: "membership-source-target",
        revision: 3,
        removed_at: null,
      });
      expect(
        database
          .prepare(
            "SELECT 1 AS present FROM document_block_index WHERE document_id = ? AND block_id = ?",
          )
          .get(hostDocumentId, "card-source"),
      ).toBeUndefined();
      expect(
        database
          .prepare(
            "SELECT lifecycle, location_kind, containing_database_id FROM blocks WHERE id = ?",
          )
          .get("card-source"),
      ).toEqual({
        lifecycle: "active",
        location_kind: "database",
        containing_database_id: primary.database_block_id,
      });

      const nestedSourceDocumentId = seedCard(database, {
        projectId: project.id,
        storeEpoch: metadata.store_epoch,
        cardId: "card-nested-copy-source",
        title: "Nested copy source",
        rankKey: "60000000000000000000000000000000",
      });
      const nestForCopy = applyBlockTransfer(database, {
        version: 1,
        operationId: "nest-card-before-copy",
        projectId: project.id,
        storeEpoch: metadata.store_epoch,
        actor: { kind: "test" },
        mode: "move",
        rootBlockIds: ["card-nested-copy-source"],
        expectedLocationRevisions: { "card-nested-copy-source": 1 },
        source: { kind: "space" },
        target: {
          kind: "document",
          documentId: sourceDocumentId,
          generation: 1,
          expectedHeadSeq: 1,
        },
      });
      expect(nestForCopy.ok).toBe(true);
      const externalReferenceCopySourceId = createUuidV7();
      const insertExternalReference = applyDocumentOperationBatch(database, {
        version: 1,
        mutationId: "insert-reference-before-copy",
        projectId: project.id,
        storeEpoch: metadata.store_epoch,
        actor: { kind: "test" },
        documentId: sourceDocumentId,
        generation: 1,
        expectedHeadSeq: 2,
        operations: [
          {
            kind: "insert_block",
            block: {
              id: externalReferenceCopySourceId,
              type: "cardRef",
              props: {
                targetBlockId: "card-host",
                displayHint: "Host",
              },
              children: [],
            },
          },
        ],
      });
      expect(insertExternalReference.ok).toBe(true);

      const copyTargetHead = database
        .prepare("SELECT head_seq FROM documents WHERE id = ?")
        .get(hostDocumentId) as { readonly head_seq: number };
      const copyRequest: BlockTransferRequest = {
        version: 1,
        operationId: "copy-source-card-into-host",
        projectId: project.id,
        storeEpoch: metadata.store_epoch,
        actor: { kind: "test" },
        mode: "copy",
        rootBlockIds: ["card-source"],
        expectedLocationRevisions: { "card-source": 4 },
        source: {
          kind: "database",
          databaseBlockId: primary.database_block_id,
          memberships: {
            "card-source": {
              membershipId: "membership-source-target",
              revision: 3,
            },
          },
        },
        target: {
          kind: "document",
          documentId: hostDocumentId,
          generation: 1,
          expectedHeadSeq: copyTargetHead.head_seq,
        },
      };
      const copyCountsBeforeFault = database
        .prepare(
          `SELECT (SELECT COUNT(*) FROM blocks) AS blocks,
                  (SELECT COUNT(*) FROM documents) AS documents,
                  (SELECT COUNT(*) FROM database_memberships) AS memberships`,
        )
        .get();
      expect(() =>
        applyBlockTransfer(
          database,
          { ...copyRequest, operationId: "copy-source-card-fault" },
          {
            faultInjector: (point) => {
              if (point === "after_ledger") {
                throw new Error("injected recursive copy fault");
              }
            },
          },
        ),
      ).toThrow("injected recursive copy fault");
      expect(
        database
          .prepare(
            `SELECT (SELECT COUNT(*) FROM blocks) AS blocks,
                    (SELECT COUNT(*) FROM documents) AS documents,
                    (SELECT COUNT(*) FROM database_memberships) AS memberships`,
          )
          .get(),
      ).toEqual(copyCountsBeforeFault);
      const copied = applyBlockTransfer(database, copyRequest);
      expect(copied.ok).toBe(true);
      if (copied.ok) {
        const copiedCardId = copied.value.resultRootBlockIds[0];
        expect(isUuidV7(copiedCardId)).toBe(true);
        expect(copied.value.copiedBlockIds["card-source"]).toBe(copiedCardId);
        const copiedNestedCardId =
          copied.value.copiedBlockIds["card-nested-copy-source"];
        const copiedReferenceId =
          copied.value.copiedBlockIds[externalReferenceCopySourceId];
        expect(isUuidV7(copiedNestedCardId ?? "")).toBe(true);
        expect(isUuidV7(copiedReferenceId ?? "")).toBe(true);
        expect(copied.value.finalLocations[copiedCardId ?? ""]).toEqual({
          kind: "document",
          documentId: hostDocumentId,
        });
        expect(
          database
            .prepare(
              "SELECT location_kind, location_revision FROM blocks WHERE id = ?",
            )
            .get("card-source"),
        ).toEqual({ location_kind: "database", location_revision: 4 });
        expect(
          database
            .prepare(
              "SELECT document_id FROM block_documents WHERE block_id = ?",
            )
            .get(copiedCardId),
        ).toEqual({ document_id: `document:${copiedCardId}` });
        const copiedNestedDocument = database
          .prepare(
            `SELECT ownership.document_id, owner.location_kind,
                    owner.containing_document_id
             FROM block_documents ownership
             JOIN blocks owner ON owner.id = ownership.block_id
             WHERE ownership.block_id = ?`,
          )
          .get(copiedNestedCardId) as {
          readonly document_id: string;
          readonly location_kind: string;
          readonly containing_document_id: string | null;
        };
        expect(copiedNestedDocument.location_kind).toBe("document");
        expect(copiedNestedDocument.containing_document_id).toBe(
          `document:${copiedCardId}`,
        );
        expect(copiedNestedDocument.document_id).not.toBe(
          nestedSourceDocumentId,
        );
        expect(
          database
            .prepare(
              "SELECT title FROM document_materializations WHERE document_id = ?",
            )
            .get(copiedNestedDocument.document_id),
        ).toEqual({ title: "Nested copy source" });
        const copiedRootMaterialization = database
          .prepare(
            "SELECT block_tree_json FROM document_materializations WHERE document_id = ?",
          )
          .get(`document:${copiedCardId}`) as {
          readonly block_tree_json: string;
        };
        const copiedRootTree = JSON.parse(
          copiedRootMaterialization.block_tree_json,
        ) as readonly {
          readonly id: string;
          readonly props: Readonly<Record<string, unknown>>;
        }[];
        expect(
          copiedRootTree.find((block) => block.id === copiedReferenceId)?.props
            .targetBlockId,
        ).toBe("card-host");
        expect(copied.value.copiedBlockIds["card-host"]).toBeUndefined();
      }
      const duplicateCopy = applyBlockTransfer(database, {
        ...copyRequest,
        clientSessionId: "copy-reconnected-window",
      });
      expect(duplicateCopy.ok && duplicateCopy.value.duplicate).toBe(true);
      if (copied.ok && duplicateCopy.ok) {
        expect(duplicateCopy.value.copiedBlockIds).toEqual(
          copied.value.copiedBlockIds,
        );
        const clonedIds = Object.values(copied.value.copiedBlockIds);
        const placeholders = clonedIds.map(() => "?").join(", ");
        const count = database
          .prepare(
            `SELECT COUNT(*) AS count FROM blocks WHERE id IN (${placeholders})`,
          )
          .get(...clonedIds) as { readonly count: number };
        expect(count.count).toBe(clonedIds.length);
      }
      const copiedWithinDatabase = applyBlockTransfer(database, {
        ...copyRequest,
        operationId: "copy-source-card-within-database",
        target: {
          kind: "database",
          databaseBlockId: primary.database_block_id,
          viewId: primary.view_id,
          groupKey: "done",
        },
      });
      expect(copiedWithinDatabase.ok).toBe(true);
      if (copiedWithinDatabase.ok) {
        const copiedCardId = copiedWithinDatabase.value.resultRootBlockIds[0];
        expect(
          database
            .prepare(
              `SELECT position.group_key
               FROM database_view_positions position
               WHERE position.view_id = ? AND position.block_id = ?`,
            )
            .get(primary.view_id, copiedCardId),
        ).toEqual({ group_key: "done" });
        expect(
          database
            .prepare(
              `SELECT value.value_json
               FROM database_memberships membership
               JOIN database_properties property
                 ON property.database_block_id = membership.database_block_id
                AND property.project_id = membership.project_id
                AND property.key = 'status'
               JOIN database_property_values value
                 ON value.membership_id = membership.id
                AND value.property_id = property.id
               WHERE membership.card_block_id = ?
                 AND membership.removed_at IS NULL`,
            )
            .get(copiedCardId),
        ).toEqual({ value_json: '"done"' });
      }

      const standaloneDocumentId = seedCard(database, {
        projectId: project.id,
        storeEpoch: metadata.store_epoch,
        cardId: "card-standalone",
        title: "Standalone",
        rankKey: "70000000000000000000000000000000",
      });
      const secondHostDocumentId = seedCard(database, {
        projectId: project.id,
        storeEpoch: metadata.store_epoch,
        cardId: "card-second-host",
        title: "Second host",
        rankKey: "90000000000000000000000000000000",
      });
      expect(standaloneDocumentId).toBe("document:card-standalone");
      const currentHostHead = database
        .prepare("SELECT head_seq FROM documents WHERE id = ?")
        .get(hostDocumentId) as { readonly head_seq: number };
      const spaceToDocument = applyBlockTransfer(database, {
        version: 1,
        operationId: "transfer-space-to-document",
        projectId: project.id,
        storeEpoch: metadata.store_epoch,
        actor: { kind: "test" },
        mode: "move",
        rootBlockIds: ["card-standalone"],
        expectedLocationRevisions: { "card-standalone": 1 },
        source: { kind: "space" },
        target: {
          kind: "document",
          documentId: hostDocumentId,
          generation: 1,
          expectedHeadSeq: currentHostHead.head_seq,
        },
      });
      expect(spaceToDocument.ok).toBe(true);
      expect(
        database
          .prepare(
            "SELECT 1 AS present FROM top_level_block_placements WHERE block_id = ?",
          )
          .get("card-standalone"),
      ).toBeUndefined();

      const afterSpaceInsertHead = database
        .prepare("SELECT head_seq FROM documents WHERE id = ?")
        .get(hostDocumentId) as { readonly head_seq: number };
      const documentToDocument = applyBlockTransfer(database, {
        version: 1,
        operationId: "transfer-document-to-document",
        projectId: project.id,
        storeEpoch: metadata.store_epoch,
        actor: { kind: "test" },
        mode: "move",
        rootBlockIds: ["card-standalone"],
        expectedLocationRevisions: { "card-standalone": 2 },
        source: {
          kind: "document",
          documentId: hostDocumentId,
          generation: 1,
          expectedHeadSeq: afterSpaceInsertHead.head_seq,
        },
        target: {
          kind: "document",
          documentId: secondHostDocumentId,
          generation: 1,
          expectedHeadSeq: 1,
        },
      });
      expect(documentToDocument.ok).toBe(true);
      if (documentToDocument.ok) {
        expect(documentToDocument.value.documentCommits).toHaveLength(2);
        expect(
          documentToDocument.value.finalLocations["card-standalone"],
        ).toEqual({
          kind: "document",
          documentId: secondHostDocumentId,
        });
      }

      const secondHostHead = database
        .prepare("SELECT head_seq FROM documents WHERE id = ?")
        .get(secondHostDocumentId) as { readonly head_seq: number };
      const documentToSpace = applyBlockTransfer(database, {
        version: 1,
        operationId: "transfer-document-to-space",
        projectId: project.id,
        storeEpoch: metadata.store_epoch,
        actor: { kind: "test" },
        mode: "move",
        rootBlockIds: ["card-standalone"],
        expectedLocationRevisions: { "card-standalone": 3 },
        source: {
          kind: "document",
          documentId: secondHostDocumentId,
          generation: 1,
          expectedHeadSeq: secondHostHead.head_seq,
        },
        target: { kind: "space", beforeBlockId: "card-second-host" },
      });
      expect(documentToSpace.ok).toBe(true);
      if (documentToSpace.ok) {
        expect(documentToSpace.value.finalLocations["card-standalone"]?.kind).toBe(
          "space",
        );
        expect(
          documentToSpace.value.finalLocationRevisions["card-standalone"],
        ).toBe(4);
      }
      expect(
        database
          .prepare(
            "SELECT lifecycle, location_kind FROM blocks WHERE id = ?",
          )
          .get("card-standalone"),
      ).toEqual({ lifecycle: "active", location_kind: "space" });

      const prePromotionHead = database
        .prepare("SELECT head_seq FROM documents WHERE id = ?")
        .get(secondHostDocumentId) as { readonly head_seq: number };
      const promotedChildId = createUuidV7();
      const prepareRichPromotion = applyDocumentOperationBatch(
        database,
        {
          version: 1,
          mutationId: "prepare-rich-nested-promotion",
          projectId: project.id,
          storeEpoch: metadata.store_epoch,
          clientSessionId: "test:promotion-author",
          actor: { kind: "test" },
          documentId: secondHostDocumentId,
          generation: 1,
          expectedHeadSeq: prePromotionHead.head_seq,
          operations: [
            {
              kind: "update_block",
              blockId: "paragraph:card-second-host",
              patch: {
                content: [
                  {
                    type: "text",
                    text: "Second host ",
                    styles: { bold: true },
                  },
                  {
                    type: "link",
                    href: "https://nodex.local/promotion",
                    content: [
                      { type: "text", text: "body", styles: {} },
                    ],
                  },
                ],
              },
            },
            {
              kind: "insert_block",
              parentBlockId: "paragraph:card-second-host",
              block: {
                id: promotedChildId,
                type: "paragraph",
                props: {
                  backgroundColor: "default",
                  textColor: "default",
                  textAlignment: "left",
                },
                content: [
                  {
                    type: "text",
                    text: "Promoted child body",
                    styles: {},
                  },
                ],
                children: [],
              },
            },
          ],
        },
        {
          writeFence: {
            leaseId: "lease:prepare-rich-nested-promotion",
            documentId: secondHostDocumentId,
            generation: 1,
            headSeq: prePromotionHead.head_seq,
          },
        },
      );
      expect(prepareRichPromotion.ok).toBe(true);
      if (!prepareRichPromotion.ok) return;
      const promotionSourceHead = {
        head_seq: prepareRichPromotion.value.headSeq,
      };
      const promotionSourceTree = JSON.parse(
        database
          .prepare(
            "SELECT block_tree_json FROM document_materializations WHERE document_id = ?",
          )
          .pluck()
          .get(secondHostDocumentId) as string,
      ) as readonly Parameters<typeof planBlockToCardTransformation>[0]["root"][];
      const promotionSourceRoot = promotionSourceTree[0];
      if (!promotionSourceRoot) throw new Error("Promotion source root is missing");
      const promotionProbe = planBlockToCardTransformation({
          root: promotionSourceRoot,
          resultRootId: promotionSourceRoot.id,
          wrapperCardId: "unused-wrapper",
          allocateEmptyBodyBlockId: createUuidV7,
        });
      if (promotionProbe.kind !== "promote") {
        throw new Error(JSON.stringify(promotionProbe));
      }
      for (const point of [
        "after_source_document",
        "after_card_owner_staged",
        "after_card_children_reparented",
        "after_card_genesis",
        "after_parent_transition",
      ] as const) {
        expect(() =>
          applyBlockTransfer(
            database,
            {
              version: 1,
              operationId: `promote-paragraph-fault-${point}`,
              projectId: project.id,
              storeEpoch: metadata.store_epoch,
              actor: { kind: "test" },
              mode: "move",
              rootBlockIds: ["paragraph:card-second-host"],
              expectedLocationRevisions: {
                "paragraph:card-second-host": 1,
              },
              source: {
                kind: "document",
                documentId: secondHostDocumentId,
                generation: 1,
                expectedHeadSeq: promotionSourceHead.head_seq,
              },
              target: {
                kind: "database",
                databaseBlockId: primary.database_block_id,
                viewId: primary.view_id,
                groupKey: "backlog",
              },
            },
            {
              faultInjector: (candidate) => {
                if (candidate === point) throw new Error(`injected ${point}`);
              },
            },
          ),
        ).toThrow(`injected ${point}`);
        expect(
          database
            .prepare(
              `SELECT type, location_kind, containing_document_id
               FROM blocks WHERE id = ?`,
            )
            .get("paragraph:card-second-host"),
        ).toEqual({
          type: "paragraph",
          location_kind: "document",
          containing_document_id: secondHostDocumentId,
        });
        expect(
          database
            .prepare("SELECT head_seq FROM documents WHERE id = ?")
            .get(secondHostDocumentId),
        ).toEqual(promotionSourceHead);
        expect(
          database
            .prepare("SELECT 1 AS present FROM block_documents WHERE block_id = ?")
            .get("paragraph:card-second-host"),
        ).toBeUndefined();
      }
      const promotionRequest: BlockTransferRequest = {
        version: 1,
        operationId: "promote-paragraph-to-card",
        projectId: project.id,
        storeEpoch: metadata.store_epoch,
        actor: { kind: "test" },
        mode: "move",
        rootBlockIds: ["paragraph:card-second-host"],
        expectedLocationRevisions: { "paragraph:card-second-host": 1 },
        source: {
          kind: "document",
          documentId: secondHostDocumentId,
          generation: 1,
          expectedHeadSeq: promotionSourceHead.head_seq,
        },
        target: {
          kind: "database",
          databaseBlockId: primary.database_block_id,
          viewId: primary.view_id,
          groupKey: "backlog",
        },
      };
      const promoted = applyBlockTransfer(database, promotionRequest);
      expect(promoted.ok, JSON.stringify(promoted)).toBe(true);
      if (promoted.ok) {
        expect(promoted.value.transformationEvidence).toEqual([
          {
            sourceBlockId: "paragraph:card-second-host",
            resultCardId: "paragraph:card-second-host",
            kind: "promote",
            sourceBlockType: "paragraph",
            semanticTitleHash: expect.stringMatching(/^[a-f0-9]{64}$/),
            consumedPropertyKeys: [
              "backgroundColor",
              "textAlignment",
              "textColor",
            ],
            bodyRootBlockIds: [promotedChildId],
            sourceToResultBlockIds: {
              "paragraph:card-second-host": "paragraph:card-second-host",
              [promotedChildId]: promotedChildId,
            },
          },
        ]);
      }
      expect(
        database
          .prepare(
            `SELECT type, lifecycle, location_kind, containing_database_id
             FROM blocks WHERE id = ?`,
          )
          .get("paragraph:card-second-host"),
      ).toEqual({
        type: "card",
        lifecycle: "active",
        location_kind: "database",
        containing_database_id: primary.database_block_id,
      });
      const promotedDocument = database
        .prepare(
          `SELECT ownership.document_id, materialization.title,
                  materialization.title_rich_json, materialization.nfm
           FROM block_documents ownership
           JOIN document_materializations materialization
             ON materialization.document_id = ownership.document_id
           WHERE ownership.block_id = ?`,
        )
        .get("paragraph:card-second-host") as {
        readonly document_id: string;
        readonly title: string;
        readonly title_rich_json: string;
        readonly nfm: string;
      };
      expect(promotedDocument.document_id).toBe(
        "document:paragraph:card-second-host",
      );
      expect(promotedDocument.title).toBe("Second host body");
      expect(JSON.parse(promotedDocument.title_rich_json)).toEqual([
        {
          type: "text",
          text: "Second host ",
          styles: { bold: true },
        },
        {
          type: "link",
          text: "body",
          href: "https://nodex.local/promotion",
          styles: {},
        },
      ]);
      expect(promotedDocument.nfm).toBe("Promoted child body");
      expect(
        database
          .prepare(
            "SELECT block_id, block_type, text FROM document_block_index WHERE document_id = ?",
          )
          .all(promotedDocument.document_id),
      ).toEqual([
        {
          block_id: promotedChildId,
          block_type: "paragraph",
          text: "Promoted child body",
        },
      ]);
      expect(
        database
          .prepare(
            "SELECT 1 AS present FROM document_block_index WHERE document_id = ? AND block_id = ?",
          )
          .get(secondHostDocumentId, "paragraph:card-second-host"),
      ).toBeUndefined();
      const repeatedPromotion = applyBlockTransfer(database, promotionRequest);
      expect(repeatedPromotion.ok).toBe(true);
      if (promoted.ok && repeatedPromotion.ok) {
        expect(repeatedPromotion.value.duplicate).toBe(true);
        expect(repeatedPromotion.value.transformationEvidence).toEqual(
          promoted.value.transformationEvidence,
        );
      }

      const wrapperHostDocumentId = seedCard(database, {
        projectId: project.id,
        storeEpoch: metadata.store_epoch,
        cardId: "card-wrapper-host",
        title: "Wrapper host",
        rankKey: "a0000000000000000000000000000000",
        bodyType: "quote",
      });
      const promotedQuote = applyBlockTransfer(database, {
        version: 1,
        operationId: "wrap-quote-in-card",
        projectId: project.id,
        storeEpoch: metadata.store_epoch,
        actor: { kind: "test" },
        mode: "move",
        rootBlockIds: ["paragraph:card-wrapper-host"],
        expectedLocationRevisions: { "paragraph:card-wrapper-host": 1 },
        source: {
          kind: "document",
          documentId: wrapperHostDocumentId,
          generation: 1,
          expectedHeadSeq: 1,
        },
        target: {
          kind: "database",
          databaseBlockId: primary.database_block_id,
          viewId: primary.view_id,
          groupKey: "backlog",
        },
      });
      expect(promotedQuote.ok).toBe(true);
      if (promotedQuote.ok) {
        const promotedCardId = promotedQuote.value.resultRootBlockIds[0];
        expect(promotedCardId).toBe("paragraph:card-wrapper-host");
        expect(promotedQuote.value.sourceRootBlockIds).toEqual([
          "paragraph:card-wrapper-host",
        ]);
        expect(
          promotedQuote.value.finalLocations["paragraph:card-wrapper-host"],
        ).toEqual({
          kind: "database",
          databaseBlockId: primary.database_block_id,
        });
        expect(
          database
            .prepare(
              "SELECT title, nfm FROM document_materializations WHERE document_id = ?",
            )
            .get(`document:${promotedCardId}`),
        ).toEqual({ title: "Wrapper host body", nfm: "" });
      }

      const checklistHostDocumentId = seedCard(database, {
        projectId: project.id,
        storeEpoch: metadata.store_epoch,
        cardId: "card-checklist-wrapper-host",
        title: "Checklist wrapper",
        rankKey: "a1000000000000000000000000000000",
        bodyType: "checkListItem",
      });
      const checklistTransferRequest: BlockTransferRequest = {
        version: 1,
        operationId: "wrap-checklist-in-card",
        projectId: project.id,
        storeEpoch: metadata.store_epoch,
        actor: { kind: "test" },
        mode: "move",
        rootBlockIds: ["paragraph:card-checklist-wrapper-host"],
        expectedLocationRevisions: {
          "paragraph:card-checklist-wrapper-host": 1,
        },
        source: {
          kind: "document",
          documentId: checklistHostDocumentId,
          generation: 1,
          expectedHeadSeq: 1,
        },
        target: {
          kind: "database",
          databaseBlockId: primary.database_block_id,
          viewId: primary.view_id,
          groupKey: "backlog",
        },
      };
      const checklistCountsBeforeFault = database
        .prepare(
          `SELECT (SELECT COUNT(*) FROM blocks) AS blocks,
                  (SELECT COUNT(*) FROM documents) AS documents,
                  (SELECT COUNT(*) FROM block_documents) AS ownerships`,
        )
        .get();
      expect(() =>
        applyBlockTransfer(
          database,
          {
            ...checklistTransferRequest,
            operationId: "wrap-checklist-body-fault",
          },
          {
            faultInjector: (point) => {
              if (point === "after_card_body") {
                throw new Error("injected after_card_body");
              }
            },
          },
        ),
      ).toThrow("injected after_card_body");
      expect(
        database
          .prepare(
            `SELECT (SELECT COUNT(*) FROM blocks) AS blocks,
                    (SELECT COUNT(*) FROM documents) AS documents,
                    (SELECT COUNT(*) FROM block_documents) AS ownerships`,
          )
          .get(),
      ).toEqual(checklistCountsBeforeFault);
      const wrappedChecklist = applyBlockTransfer(
        database,
        checklistTransferRequest,
      );
      expect(wrappedChecklist.ok).toBe(true);
      if (wrappedChecklist.ok) {
        const wrapperCardId = wrappedChecklist.value.resultRootBlockIds[0];
        expect(isUuidV7(wrapperCardId)).toBe(true);
        expect(wrappedChecklist.value.transformationEvidence).toEqual([
          {
            sourceBlockId: "paragraph:card-checklist-wrapper-host",
            resultCardId: wrapperCardId,
            kind: "wrap",
            sourceBlockType: "checkListItem",
            semanticTitleHash: expect.stringMatching(/^[a-f0-9]{64}$/),
            consumedPropertyKeys: [],
            wrapperReason: "type_requires_wrapper",
            bodyRootBlockIds: ["paragraph:card-checklist-wrapper-host"],
            sourceToResultBlockIds: {
              "paragraph:card-checklist-wrapper-host":
                "paragraph:card-checklist-wrapper-host",
            },
          },
        ]);
        expect(
          database
            .prepare(
              "SELECT block_type, text FROM document_block_index WHERE document_id = ?",
            )
            .get(`document:${wrapperCardId}`),
        ).toEqual({
          block_type: "checkListItem",
          text: "Checklist wrapper body",
        });
        expect(
          database
            .prepare(
              "SELECT title FROM document_materializations WHERE document_id = ?",
            )
            .get(`document:${wrapperCardId}`),
        ).toEqual({ title: "Checklist wrapper body" });
      }

      const copyBlockHostDocumentId = seedCard(database, {
        projectId: project.id,
        storeEpoch: metadata.store_epoch,
        cardId: "card-copy-block-host",
        title: "Copy Block host",
        rankKey: "b0000000000000000000000000000000",
      });
      const copyChildSourceId = createUuidV7();
      const prepareCopyPromotion = applyDocumentOperationBatch(
        database,
        {
          version: 1,
          mutationId: "prepare-rich-nested-copy-promotion",
          projectId: project.id,
          storeEpoch: metadata.store_epoch,
          actor: { kind: "test" },
          documentId: copyBlockHostDocumentId,
          generation: 1,
          expectedHeadSeq: 1,
          operations: [
            {
              kind: "update_block",
              blockId: "paragraph:card-copy-block-host",
              patch: {
                content: [
                  {
                    type: "text",
                    text: "Copy Block host body",
                    styles: { italic: true },
                  },
                ],
              },
            },
            {
              kind: "insert_block",
              parentBlockId: "paragraph:card-copy-block-host",
              block: {
                id: copyChildSourceId,
                type: "paragraph",
                props: {
                  backgroundColor: "default",
                  textColor: "default",
                  textAlignment: "left",
                },
                content: [
                  { type: "text", text: "Copied child", styles: {} },
                ],
                children: [],
              },
            },
          ],
        },
        {
          writeFence: {
            leaseId: "lease:prepare-rich-nested-copy-promotion",
            documentId: copyBlockHostDocumentId,
            generation: 1,
            headSeq: 1,
          },
        },
      );
      expect(prepareCopyPromotion.ok).toBe(true);
      if (!prepareCopyPromotion.ok) return;
      const copiedBlockToDatabase = applyBlockTransfer(database, {
        version: 1,
        operationId: "copy-paragraph-to-database",
        projectId: project.id,
        storeEpoch: metadata.store_epoch,
        actor: { kind: "test" },
        mode: "copy",
        rootBlockIds: ["paragraph:card-copy-block-host"],
        expectedLocationRevisions: {
          "paragraph:card-copy-block-host": 1,
        },
        source: {
          kind: "document",
          documentId: copyBlockHostDocumentId,
          generation: 1,
          expectedHeadSeq: prepareCopyPromotion.value.headSeq,
        },
        target: {
          kind: "database",
          databaseBlockId: primary.database_block_id,
          viewId: primary.view_id,
          groupKey: "backlog",
        },
      });
      expect(copiedBlockToDatabase.ok).toBe(true);
      if (copiedBlockToDatabase.ok) {
        const wrapperCardId = copiedBlockToDatabase.value.resultRootBlockIds[0];
        const copiedParagraphId =
          copiedBlockToDatabase.value.copiedBlockIds[
            "paragraph:card-copy-block-host"
          ];
        const copiedChildId =
          copiedBlockToDatabase.value.copiedBlockIds[copyChildSourceId];
        expect(isUuidV7(wrapperCardId)).toBe(true);
        expect(copiedParagraphId).toBe(wrapperCardId);
        expect(isUuidV7(copiedChildId)).toBe(true);
        expect(copiedBlockToDatabase.value.transformationEvidence).toEqual([
          {
            sourceBlockId: "paragraph:card-copy-block-host",
            resultCardId: wrapperCardId,
            kind: "promote",
            sourceBlockType: "paragraph",
            semanticTitleHash: expect.stringMatching(/^[a-f0-9]{64}$/),
            consumedPropertyKeys: [
              "backgroundColor",
              "textAlignment",
              "textColor",
            ],
            bodyRootBlockIds: [copiedChildId],
            sourceToResultBlockIds: {
              "paragraph:card-copy-block-host": wrapperCardId,
              [copyChildSourceId]: copiedChildId,
            },
          },
        ]);
        expect(
          database
            .prepare(
              "SELECT block_type FROM document_block_index WHERE document_id = ? AND block_id = ?",
            )
            .get(
              copyBlockHostDocumentId,
              "paragraph:card-copy-block-host",
            ),
        ).toEqual({ block_type: "paragraph" });
        expect(
          database
            .prepare(
              "SELECT location_kind, containing_database_id FROM blocks WHERE id = ?",
            )
            .get(wrapperCardId),
        ).toEqual({
          location_kind: "database",
          containing_database_id: primary.database_block_id,
        });
        const copiedBody = database
          .prepare(
            "SELECT block_id, text FROM document_block_index WHERE document_id = ?",
          )
          .get(`document:${wrapperCardId}`) as {
          readonly block_id: string;
          readonly text: string;
        };
        expect(copiedBody.block_id).toBe(copiedChildId);
        expect(copiedBody.text).toBe("Copied child");
        expect(
          database
            .prepare(
              "SELECT title, title_rich_json FROM document_materializations WHERE document_id = ?",
            )
            .get(`document:${wrapperCardId}`),
        ).toEqual({
          title: "Copy Block host body",
          title_rich_json: JSON.stringify([
            {
              type: "text",
              text: "Copy Block host body",
              styles: { italic: true },
            },
          ]),
        });
      }

      const copyQuoteHostDocumentId = seedCard(database, {
        projectId: project.id,
        storeEpoch: metadata.store_epoch,
        cardId: "card-copy-quote-host",
        title: "Copy quote host",
        rankKey: "b1000000000000000000000000000000",
        bodyType: "quote",
      });
      const copiedQuoteToDatabase = applyBlockTransfer(database, {
        version: 1,
        operationId: "copy-quote-to-database",
        projectId: project.id,
        storeEpoch: metadata.store_epoch,
        actor: { kind: "test" },
        mode: "copy",
        rootBlockIds: ["paragraph:card-copy-quote-host"],
        expectedLocationRevisions: {
          "paragraph:card-copy-quote-host": 1,
        },
        source: {
          kind: "document",
          documentId: copyQuoteHostDocumentId,
          generation: 1,
          expectedHeadSeq: 1,
        },
        target: {
          kind: "database",
          databaseBlockId: primary.database_block_id,
          viewId: primary.view_id,
          groupKey: "backlog",
        },
      });
      expect(copiedQuoteToDatabase.ok).toBe(true);
      if (copiedQuoteToDatabase.ok) {
        const wrapperCardId = copiedQuoteToDatabase.value.resultRootBlockIds[0];
        const copiedQuoteId =
          copiedQuoteToDatabase.value.copiedBlockIds[
            "paragraph:card-copy-quote-host"
          ];
        expect(isUuidV7(wrapperCardId)).toBe(true);
        expect(copiedQuoteId).toBe(wrapperCardId);
        expect(
          database
            .prepare(
              "SELECT title, nfm FROM document_materializations WHERE document_id = ?",
            )
            .get(`document:${wrapperCardId}`),
        ).toEqual({ title: "Copy quote host body", nfm: "" });
      }

      const spaceCopySourceDocumentId = seedCard(database, {
        projectId: project.id,
        storeEpoch: metadata.store_epoch,
        cardId: "card-space-copy-source",
        title: "Space copy source",
        rankKey: "c0000000000000000000000000000000",
      });
      const currentCopyHostHead = database
        .prepare("SELECT head_seq FROM documents WHERE id = ?")
        .get(copyBlockHostDocumentId) as { readonly head_seq: number };
      const copiedSpaceCard = applyBlockTransfer(database, {
        version: 1,
        operationId: "copy-space-card-to-document",
        projectId: project.id,
        storeEpoch: metadata.store_epoch,
        actor: { kind: "test" },
        mode: "copy",
        rootBlockIds: ["card-space-copy-source"],
        expectedLocationRevisions: { "card-space-copy-source": 1 },
        source: { kind: "space" },
        target: {
          kind: "document",
          documentId: copyBlockHostDocumentId,
          generation: 1,
          expectedHeadSeq: currentCopyHostHead.head_seq,
        },
      });
      expect(copiedSpaceCard.ok).toBe(true);
      if (copiedSpaceCard.ok) {
        const clonedCardId = copiedSpaceCard.value.resultRootBlockIds[0];
        expect(
          copiedSpaceCard.value.copiedBlockIds["card-space-copy-source"],
        ).toBe(clonedCardId);
        expect(copiedSpaceCard.value.finalLocations[clonedCardId ?? ""]).toEqual(
          {
            kind: "document",
            documentId: copyBlockHostDocumentId,
          },
        );
        expect(
          database
            .prepare(
              "SELECT location_kind FROM blocks WHERE id = ?",
            )
            .get("card-space-copy-source"),
        ).toEqual({ location_kind: "space" });
        expect(
          database
            .prepare(
              "SELECT title FROM document_materializations WHERE document_id = ?",
            )
            .get(`document:${clonedCardId}`),
        ).toEqual({ title: "Space copy source" });
        expect(`document:${clonedCardId}`).not.toBe(spaceCopySourceDocumentId);
      }

      const ordinaryCopySourceDocumentId = seedCard(database, {
        projectId: project.id,
        storeEpoch: metadata.store_epoch,
        cardId: "card-ordinary-copy-source",
        title: "Ordinary copy source",
        rankKey: "d0000000000000000000000000000000",
      });
      const ordinaryCopyTargetDocumentId = seedCard(database, {
        projectId: project.id,
        storeEpoch: metadata.store_epoch,
        cardId: "card-ordinary-copy-target",
        title: "Ordinary copy target",
        rankKey: "e0000000000000000000000000000000",
      });
      const copiedOrdinaryBlock = applyBlockTransfer(database, {
        version: 1,
        operationId: "copy-ordinary-block-document-to-document",
        projectId: project.id,
        storeEpoch: metadata.store_epoch,
        actor: { kind: "test" },
        mode: "copy",
        rootBlockIds: ["paragraph:card-ordinary-copy-source"],
        expectedLocationRevisions: {
          "paragraph:card-ordinary-copy-source": 1,
        },
        source: {
          kind: "document",
          documentId: ordinaryCopySourceDocumentId,
          generation: 1,
          expectedHeadSeq: 1,
        },
        target: {
          kind: "document",
          documentId: ordinaryCopyTargetDocumentId,
          generation: 1,
          expectedHeadSeq: 1,
        },
      });
      expect(copiedOrdinaryBlock.ok).toBe(true);
      if (copiedOrdinaryBlock.ok) {
        const copiedId =
          copiedOrdinaryBlock.value.copiedBlockIds[
            "paragraph:card-ordinary-copy-source"
          ];
        expect(isUuidV7(copiedId)).toBe(true);
        expect(
          database
            .prepare(
              "SELECT text FROM document_block_index WHERE document_id = ? AND block_id = ?",
            )
            .get(ordinaryCopyTargetDocumentId, copiedId),
        ).toEqual({ text: "Ordinary copy source body" });
        expect(
          database
            .prepare(
              "SELECT text FROM document_block_index WHERE document_id = ? AND block_id = ?",
            )
            .get(
              ordinaryCopySourceDocumentId,
              "paragraph:card-ordinary-copy-source",
            ),
        ).toEqual({ text: "Ordinary copy source body" });
      }

      const multiOrdinaryDocumentId = seedCard(database, {
        projectId: project.id,
        storeEpoch: metadata.store_epoch,
        cardId: "card-multi-ordinary-source",
        title: "Multi ordinary source",
        rankKey: "e1000000000000000000000000000000",
      });
      const secondOrdinaryRootId = createUuidV7();
      const addSecondOrdinaryRoot = applyDocumentOperationBatch(database, {
        version: 1,
        mutationId: "add-second-ordinary-copy-root",
        projectId: project.id,
        storeEpoch: metadata.store_epoch,
        actor: { kind: "test" },
        documentId: multiOrdinaryDocumentId,
        generation: 1,
        expectedHeadSeq: 1,
        operations: [
          {
            kind: "insert_block",
            block: {
              id: secondOrdinaryRootId,
              type: "paragraph",
              props: {},
              content: [
                {
                  type: "text",
                  text: "Second ordinary root",
                  styles: {},
                },
              ],
              children: [],
            },
          },
        ],
      });
      expect(addSecondOrdinaryRoot.ok).toBe(true);
      const copiedOrdinaryForest = applyBlockTransfer(database, {
        version: 1,
        operationId: "copy-ordinary-forest-to-database",
        projectId: project.id,
        storeEpoch: metadata.store_epoch,
        actor: { kind: "test" },
        mode: "copy",
        rootBlockIds: [
          "paragraph:card-multi-ordinary-source",
          secondOrdinaryRootId,
        ],
        expectedLocationRevisions: {
          "paragraph:card-multi-ordinary-source": 1,
          [secondOrdinaryRootId]: 1,
        },
        source: {
          kind: "document",
          documentId: multiOrdinaryDocumentId,
          generation: 1,
          expectedHeadSeq: 2,
        },
        target: {
          kind: "database",
          databaseBlockId: primary.database_block_id,
          viewId: primary.view_id,
          groupKey: "backlog",
        },
      });
      expect(copiedOrdinaryForest.ok).toBe(true);
      if (copiedOrdinaryForest.ok) {
        expect(copiedOrdinaryForest.value.resultRootBlockIds).toHaveLength(2);
        expect(new Set(copiedOrdinaryForest.value.resultRootBlockIds).size).toBe(
          2,
        );
        expect(copiedOrdinaryForest.value.resultRootBlockIds).toEqual([
          copiedOrdinaryForest.value.copiedBlockIds[
            "paragraph:card-multi-ordinary-source"
          ],
          copiedOrdinaryForest.value.copiedBlockIds[
            secondOrdinaryRootId
          ],
        ]);
        for (const copiedCardId of copiedOrdinaryForest.value.resultRootBlockIds) {
          expect(
            database
              .prepare(
                "SELECT type, location_kind FROM blocks WHERE id = ?",
              )
              .get(copiedCardId),
          ).toEqual({ type: "card", location_kind: "database" });
        }
      }

      const spacePromotionDocumentId = seedCard(database, {
        projectId: project.id,
        storeEpoch: metadata.store_epoch,
        cardId: "card-space-promotion-source",
        title: "Space promotion source",
        rankKey: "f0000000000000000000000000000000",
      });
      const promotedToSpace = applyBlockTransfer(database, {
        version: 1,
        operationId: "promote-paragraph-to-space-card",
        projectId: project.id,
        storeEpoch: metadata.store_epoch,
        actor: { kind: "test" },
        mode: "move",
        rootBlockIds: ["paragraph:card-space-promotion-source"],
        expectedLocationRevisions: {
          "paragraph:card-space-promotion-source": 1,
        },
        source: {
          kind: "document",
          documentId: spacePromotionDocumentId,
          generation: 1,
          expectedHeadSeq: 1,
        },
        target: { kind: "space" },
      });
      expect(promotedToSpace.ok).toBe(true);
      expect(
        database
          .prepare(
            `SELECT type, location_kind FROM blocks WHERE id = ?`,
          )
          .get("paragraph:card-space-promotion-source"),
      ).toEqual({ type: "card", location_kind: "space" });
      expect(
        database
          .prepare(
            "SELECT document_id FROM block_documents WHERE block_id = ?",
          )
          .get("paragraph:card-space-promotion-source"),
      ).toEqual({
        document_id: "document:paragraph:card-space-promotion-source",
      });

      seedCard(database, {
        projectId: project.id,
        storeEpoch: metadata.store_epoch,
        cardId: "card-multi-copy-a",
        title: "Multi copy A",
        rankKey: "f1000000000000000000000000000000",
      });
      seedCard(database, {
        projectId: project.id,
        storeEpoch: metadata.store_epoch,
        cardId: "card-multi-copy-b",
        title: "Multi copy B",
        rankKey: "f2000000000000000000000000000000",
      });
      const multiCopyTargetHead = database
        .prepare("SELECT head_seq FROM documents WHERE id = ?")
        .get(ordinaryCopyTargetDocumentId) as { readonly head_seq: number };
      const copiedCardForest = applyBlockTransfer(database, {
        version: 1,
        operationId: "copy-card-forest-to-document",
        projectId: project.id,
        storeEpoch: metadata.store_epoch,
        actor: { kind: "test" },
        mode: "copy",
        rootBlockIds: ["card-multi-copy-a", "card-multi-copy-b"],
        expectedLocationRevisions: {
          "card-multi-copy-a": 1,
          "card-multi-copy-b": 1,
        },
        source: { kind: "space" },
        target: {
          kind: "document",
          documentId: ordinaryCopyTargetDocumentId,
          generation: 1,
          expectedHeadSeq: multiCopyTargetHead.head_seq,
        },
      });
      expect(copiedCardForest.ok).toBe(true);
      if (copiedCardForest.ok) {
        expect(copiedCardForest.value.resultRootBlockIds).toHaveLength(2);
        for (const copiedCardId of copiedCardForest.value.resultRootBlockIds) {
          expect(
            database
              .prepare(
                "SELECT block_type FROM document_block_index WHERE document_id = ? AND block_id = ?",
              )
              .get(ordinaryCopyTargetDocumentId, copiedCardId),
          ).toEqual({ block_type: "card" });
        }
      }

      const mixedSourceDocumentId = seedCard(database, {
        projectId: project.id,
        storeEpoch: metadata.store_epoch,
        cardId: "card-mixed-source",
        title: "Mixed source",
        rankKey: "f3000000000000000000000000000000",
      });
      seedCard(database, {
        projectId: project.id,
        storeEpoch: metadata.store_epoch,
        cardId: "card-mixed-nested",
        title: "Mixed nested Card",
        rankKey: "f4000000000000000000000000000000",
      });
      const nestedForMixedSelection = applyBlockTransfer(database, {
        version: 1,
        operationId: "nest-card-for-mixed-selection",
        projectId: project.id,
        storeEpoch: metadata.store_epoch,
        actor: { kind: "test" },
        mode: "move",
        rootBlockIds: ["card-mixed-nested"],
        expectedLocationRevisions: { "card-mixed-nested": 1 },
        source: { kind: "space" },
        target: {
          kind: "document",
          documentId: mixedSourceDocumentId,
          generation: 1,
          expectedHeadSeq: 1,
        },
      });
      expect(nestedForMixedSelection.ok).toBe(true);
      const mixedTargetDocumentId = seedCard(database, {
        projectId: project.id,
        storeEpoch: metadata.store_epoch,
        cardId: "card-mixed-target",
        title: "Mixed target",
        rankKey: "f5000000000000000000000000000000",
      });
      const copiedMixedSelection = applyBlockTransfer(database, {
        version: 1,
        operationId: "copy-mixed-selection-to-document",
        projectId: project.id,
        storeEpoch: metadata.store_epoch,
        actor: { kind: "test" },
        mode: "copy",
        rootBlockIds: [
          "paragraph:card-mixed-source",
          "card-mixed-nested",
        ],
        expectedLocationRevisions: {
          "paragraph:card-mixed-source": 1,
          "card-mixed-nested": 2,
        },
        source: {
          kind: "document",
          documentId: mixedSourceDocumentId,
          generation: 1,
          expectedHeadSeq: 2,
        },
        target: {
          kind: "document",
          documentId: mixedTargetDocumentId,
          generation: 1,
          expectedHeadSeq: 1,
        },
      });
      expect(copiedMixedSelection.ok).toBe(true);
      if (copiedMixedSelection.ok) {
        expect(copiedMixedSelection.value.resultRootBlockIds).toEqual([
          copiedMixedSelection.value.copiedBlockIds[
            "paragraph:card-mixed-source"
          ],
          copiedMixedSelection.value.copiedBlockIds["card-mixed-nested"],
        ]);
        expect(
          database
            .prepare(
              "SELECT block_type FROM document_block_index WHERE document_id = ? AND block_id = ?",
            )
            .get(
              mixedTargetDocumentId,
              copiedMixedSelection.value.resultRootBlockIds[0],
            ),
        ).toEqual({ block_type: "paragraph" });
        expect(
          database
            .prepare(
              "SELECT block_type FROM document_block_index WHERE document_id = ? AND block_id = ?",
            )
            .get(
              mixedTargetDocumentId,
              copiedMixedSelection.value.resultRootBlockIds[1],
            ),
        ).toEqual({ block_type: "card" });
      }
      const movedMixedSelection = applyBlockTransfer(database, {
        version: 1,
        operationId: "move-mixed-selection-to-database",
        projectId: project.id,
        storeEpoch: metadata.store_epoch,
        actor: { kind: "test" },
        mode: "move",
        rootBlockIds: [
          "paragraph:card-mixed-source",
          "card-mixed-nested",
        ],
        expectedLocationRevisions: {
          "paragraph:card-mixed-source": 1,
          "card-mixed-nested": 2,
        },
        source: {
          kind: "document",
          documentId: mixedSourceDocumentId,
          generation: 1,
          expectedHeadSeq: 2,
        },
        target: {
          kind: "database",
          databaseBlockId: primary.database_block_id,
          viewId: primary.view_id,
          groupKey: "backlog",
        },
      });
      expect(movedMixedSelection.ok).toBe(true);
      if (movedMixedSelection.ok) {
        expect(movedMixedSelection.value.resultRootBlockIds).toEqual([
          "paragraph:card-mixed-source",
          "card-mixed-nested",
        ]);
        for (const cardId of movedMixedSelection.value.resultRootBlockIds) {
          expect(
            database
              .prepare(
                "SELECT type, location_kind FROM blocks WHERE id = ?",
              )
              .get(cardId),
          ).toEqual({ type: "card", location_kind: "database" });
        }
      }
    } finally {
      closeDatabase();
      fs.rmSync(directory, { recursive: true, force: true });
      if (previous === undefined) delete process.env.NODEX_DIR;
      else process.env.NODEX_DIR = previous;
    }
  });
});
