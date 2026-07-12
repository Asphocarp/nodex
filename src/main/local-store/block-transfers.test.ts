import { describe, expect, test } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import * as Y from "yjs";
import {
  createCardDocument,
  openCardDocument,
} from "../../shared/block-documents";
import type {
  DatabaseMutationRequest,
} from "../../shared/database-kernel";
import type { BlockTransferRequest } from "../../shared/block-transfer";
import { initializeCardDocumentGenesis } from "./block-document-store";
import { applyBlockTransfer } from "./block-transfers";
import { applyAdditionalDocumentCommand } from "./additional-document-command-kernel";
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
      ) VALUES (?, ?, 1, 0, 'nodex.card', 1, X'', '',
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
      const createNestedLargeDocument = applyAdditionalDocumentCommand(
        database,
        {
          version: 1,
          operationId: "create-large-document-before-copy",
          projectId: project.id,
          storeEpoch: metadata.store_epoch,
          clientSessionId: "test-session",
          actor: { kind: "test" },
          coordination: {
            kind: "hub_lease",
            leaseId: "lease:create-large-document-before-copy",
            documents: [
              {
                documentId: sourceDocumentId,
                generation: 1,
                headSeq: 2,
              },
            ],
          },
          operation: {
            kind: "create_large_document",
            blockId: "large-document-copy-source",
            documentId: "document:large-document-copy-source",
            displayName: "Nested large document",
            content: {
              kind: "large_document",
              initialBlocks: [
                {
                  id: "large-document-body-source",
                  type: "paragraph",
                  props: {},
                  content: [
                    {
                      type: "text",
                      text: "Nested large body",
                      styles: {},
                    },
                  ],
                  children: [],
                },
              ],
            },
            location: {
              kind: "document",
              host: { documentId: sourceDocumentId, generation: 1 },
            },
          },
        },
      );
      expect(createNestedLargeDocument.ok).toBe(true);
      const insertExternalReference = applyDocumentOperationBatch(database, {
        version: 1,
        mutationId: "insert-reference-before-copy",
        projectId: project.id,
        storeEpoch: metadata.store_epoch,
        actor: { kind: "test" },
        documentId: sourceDocumentId,
        generation: 1,
        expectedHeadSeq: 3,
        operations: [
          {
            kind: "insert_block",
            block: {
              id: "external-reference-copy-source",
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
        expect(copiedCardId).toMatch(/^block:copy:/u);
        expect(copied.value.copiedBlockIds["card-source"]).toBe(copiedCardId);
        const copiedNestedCardId =
          copied.value.copiedBlockIds["card-nested-copy-source"];
        const copiedLargeDocumentId =
          copied.value.copiedBlockIds["large-document-copy-source"];
        const copiedReferenceId =
          copied.value.copiedBlockIds["external-reference-copy-source"];
        expect(copiedNestedCardId).toMatch(/^block:copy:/u);
        expect(copiedLargeDocumentId).toMatch(/^block:copy:/u);
        expect(copiedReferenceId).toMatch(/^block:copy:/u);
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
        const copiedLargeDocument = database
          .prepare(
            `SELECT ownership.document_id, owner.location_kind,
                    owner.containing_document_id,
                    materialization.nfm
             FROM block_documents ownership
             JOIN blocks owner ON owner.id = ownership.block_id
             JOIN document_materializations materialization
               ON materialization.document_id = ownership.document_id
             WHERE ownership.block_id = ?`,
          )
          .get(copiedLargeDocumentId) as {
          readonly document_id: string;
          readonly location_kind: string;
          readonly containing_document_id: string;
          readonly nfm: string;
        };
        expect(copiedLargeDocument.location_kind).toBe("document");
        expect(copiedLargeDocument.containing_document_id).toBe(
          `document:${copiedCardId}`,
        );
        expect(copiedLargeDocument.nfm).toContain("Nested large body");
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

      const promotionSourceHead = database
        .prepare("SELECT head_seq FROM documents WHERE id = ?")
        .get(secondHostDocumentId) as { readonly head_seq: number };
      const promoted = applyBlockTransfer(database, {
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
      });
      expect(promoted.ok).toBe(true);
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
                  materialization.nfm
           FROM block_documents ownership
           JOIN document_materializations materialization
             ON materialization.document_id = ownership.document_id
           WHERE ownership.block_id = ?`,
        )
        .get("paragraph:card-second-host") as {
        readonly document_id: string;
        readonly title: string;
        readonly nfm: string;
      };
      expect(promotedDocument.document_id).toBe(
        "document:paragraph:card-second-host",
      );
      expect(promotedDocument.title).toBe("Second host body");
      expect(promotedDocument.nfm).toContain("Second host body");
      expect(
        database
          .prepare(
            "SELECT 1 AS present FROM document_block_index WHERE document_id = ? AND block_id = ?",
          )
          .get(secondHostDocumentId, "paragraph:card-second-host"),
      ).toBeUndefined();

      const wrapperHostDocumentId = seedCard(database, {
        projectId: project.id,
        storeEpoch: metadata.store_epoch,
        cardId: "card-wrapper-host",
        title: "Wrapper host",
        rankKey: "a0000000000000000000000000000000",
        bodyType: "quote",
      });
      const wrapped = applyBlockTransfer(database, {
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
      expect(wrapped.ok).toBe(true);
      if (wrapped.ok) {
        const wrapperCardId = wrapped.value.resultRootBlockIds[0];
        expect(wrapperCardId).toMatch(/^card:transfer:/u);
        expect(wrapped.value.sourceRootBlockIds).toEqual([
          "paragraph:card-wrapper-host",
        ]);
        expect(
          wrapped.value.finalLocations["paragraph:card-wrapper-host"],
        ).toEqual({
          kind: "document",
          documentId: `document:${wrapperCardId}`,
        });
        expect(wrapped.value.finalLocations[wrapperCardId ?? ""]?.kind).toBe(
          "database",
        );
        expect(
          database
            .prepare(
              "SELECT block_type FROM document_block_index WHERE document_id = ? AND block_id = ?",
            )
            .get(
              `document:${wrapperCardId}`,
              "paragraph:card-wrapper-host",
            ),
        ).toEqual({ block_type: "quote" });
      }
    } finally {
      closeDatabase();
      fs.rmSync(directory, { recursive: true, force: true });
      if (previous === undefined) delete process.env.NODEX_DIR;
      else process.env.NODEX_DIR = previous;
    }
  });
});
