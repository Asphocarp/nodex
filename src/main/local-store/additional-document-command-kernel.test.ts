import { describe, expect, test } from "vitest";
import Database from "better-sqlite3";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import * as Y from "yjs";
import { createUuidV7 } from "../../shared/card-id";
import { ADDITIONAL_DOCUMENT_COMMAND_VERSION } from "../../shared/additional-document-commands";
import {
  createDetachedCardDocumentFromBlockTree,
  type BlockTreeNode,
} from "../../shared/block-documents/block-document-codec";
import { applyAdditionalDocumentCommand } from "./additional-document-command-kernel";
import { getDocumentBearingBlockSummary } from "./additional-document-bearing-blocks";
import {
  applyBlockDocumentUpdate,
  initializeBlockDocumentGenesis,
  loadPrimaryBlockDocument,
} from "./block-document-store";
import { getDatabasePath } from "./config";
import { closeDatabase, initializeDatabase } from "./database";

const supportsBetterSqlite = (() => {
  try {
    const database = new Database(":memory:");
    database.close();
    return true;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (
      message.includes("better-sqlite3") &&
      message.includes("not yet supported")
    ) {
      return false;
    }
    throw error;
  }
})();
const skipTest = (test as typeof test & { skip: typeof test }).skip;
const sqliteTest = supportsBetterSqlite ? test : skipTest;

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

const seedCardDocument = (
  database: Database.Database,
  input: {
    readonly projectId: string;
    readonly cardId: string;
    readonly documentId: string;
    readonly blockTree: readonly BlockTreeNode[];
  },
): { readonly storeEpoch: string; readonly headSeq: number } => {
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
    .run(input.cardId, input.projectId, now, now);
  database
    .prepare(
      `
      INSERT INTO top_level_block_placements (
        block_id, project_id, rank_key, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?)
    `,
    )
    .run(input.cardId, input.projectId, `100000000000:${input.cardId}`, now, now);
  database
    .prepare(
      `
      INSERT INTO documents (
        id, project_id, generation, head_seq, schema_key, schema_version,
        state_vector, state_hash, readiness, authority,
        genesis_source_revision, created_at, updated_at
      ) VALUES (?, ?, 1, 0, 'nodex.card', 1, X'', '',
        'pending_genesis', 'legacy_shadow', NULL, ?, ?)
    `,
    )
    .run(input.documentId, input.projectId, now, now);
  database
    .prepare(
      `
      INSERT INTO block_documents (block_id, document_id, project_id, created_at)
      VALUES (?, ?, ?, ?)
    `,
    )
    .run(input.cardId, input.documentId, input.projectId, now);
  const detached = createDetachedCardDocumentFromBlockTree({
    documentId: input.documentId,
    title: input.cardId,
    blockTree: input.blockTree,
  });
  try {
    const storeEpoch = (
      database
        .prepare("SELECT store_epoch FROM block_store_metadata WHERE id = 1")
        .get() as { readonly store_epoch: string }
    ).store_epoch;
    const ack = initializeBlockDocumentGenesis(database, {
      documentId: input.documentId,
      storeEpoch,
      generation: 1,
      updateId: `genesis:${input.documentId}`,
      clientSessionId: "test:genesis",
      update: Y.encodeStateAsUpdate(detached.document),
      finalAuthority: "ydoc_primary",
    });
    return { storeEpoch, headSeq: ack.headSeq };
  } finally {
    detached.document.destroy();
  }
};

const withDatabase = async (
  operation: (
    database: Database.Database,
    projectId: string,
    storeEpoch: string,
  ) => void,
): Promise<void> => {
  closeDatabase();
  const previous = process.env.NODEX_DIR;
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "nodex-doc-command-"));
  process.env.NODEX_DIR = directory;
  try {
    await initializeDatabase();
    closeDatabase();
    const database = new Database(getDatabasePath(), { readonly: false });
    database.pragma("foreign_keys = ON");
    try {
      const project = database
        .prepare("SELECT id FROM projects ORDER BY created LIMIT 1")
        .get() as { readonly id: string };
      const storeEpoch = (
        database
          .prepare("SELECT store_epoch FROM block_store_metadata WHERE id = 1")
          .get() as { readonly store_epoch: string }
      ).store_epoch;
      operation(database, project.id, storeEpoch);
    } finally {
      database.close();
    }
  } finally {
    closeDatabase();
    if (previous === undefined) delete process.env.NODEX_DIR;
    else process.env.NODEX_DIR = previous;
    fs.rmSync(directory, { recursive: true, force: true });
  }
};

const command = (
  projectId: string,
  storeEpoch: string,
  operationId: string,
  operation: unknown,
  coordination: unknown = { kind: "fifo_only" },
) => ({
  version: ADDITIONAL_DOCUMENT_COMMAND_VERSION,
  operationId,
  projectId,
  storeEpoch,
  clientSessionId: "test:additional-document",
  actor: { kind: "test" },
  coordination,
  operation,
});

const lease = (
  leaseId: string,
  documents: readonly {
    readonly documentId: string;
    readonly generation: number;
    readonly headSeq: number;
  }[],
) => ({ kind: "hub_lease", leaseId, documents });

describe("additional Document authoritative command kernel", () => {
  sqliteTest(
    "promotes and demotes a Synced source with stable content identities and exact receipts",
    async () => {
      await withDatabase((database, projectId, storeEpoch) => {
        const hostCardId = createUuidV7();
        const rootBlockId = createUuidV7();
        const childBlockId = createUuidV7();
        const referenceBlockId = createUuidV7();
        const sourceBlockId = createUuidV7();
        seedCardDocument(database, {
          projectId,
          cardId: hostCardId,
          documentId: "document:sync-host",
          blockTree: [
            paragraph(rootBlockId, "root", [paragraph(childBlockId, "child")]),
          ],
        });
        const flushed = loadPrimaryBlockDocument(
          database,
          "document:sync-host",
        );
        const vector = Y.encodeStateVector(flushed.document);
        const text = [...flushed.document.getXmlFragment("body").createTreeWalker(
          (node) => node instanceof Y.XmlText,
        )][0] as Y.XmlText | undefined;
        if (!text) throw new Error("Expected host text before promotion");
        text.insert(text.length, " after lease flush");
        const flushAck = applyBlockDocumentUpdate(database, {
          documentId: "document:sync-host",
          storeEpoch,
          generation: 1,
          updateId: "command:promote:flush",
          clientSessionId: "test:mounted-surface",
          baseHeadSeq: 1,
          touchedBlockIds: [rootBlockId],
          update: Y.encodeStateAsUpdate(flushed.document, vector),
        });
        flushed.document.destroy();
        expect(flushAck.headSeq).toBe(2);
        const promoted = applyAdditionalDocumentCommand(
          database,
          command(
            projectId,
            storeEpoch,
            "command:promote",
            {
              kind: "promote_synced_source",
              host: {
                documentId: "document:sync-host",
                generation: 1,
              },
              rootBlockId,
              referenceBlockId,
              sourceBlockId,
              sourceDocumentId: "document:sync-source",
            },
            lease("lease:promote", [
              {
                documentId: "document:sync-host",
                generation: 1,
                headSeq: flushAck.headSeq,
              },
            ]),
          ),
        );
        expect(promoted.ok).toBe(true);
        if (!promoted.ok) return;
        expect(promoted.value.effect.createdBlockIds.join(",")).toBe(
          [referenceBlockId, sourceBlockId].sort().join(","),
        );
        expect(promoted.value.effect.preservedBlockIds.join(",")).toBe(
          [childBlockId, rootBlockId].sort().join(","),
        );
        const host = promoted.value.effect.documentHeads.find(
          (head) => head.documentId === "document:sync-host",
        );
        const source = promoted.value.effect.documentHeads.find(
          (head) => head.documentId === "document:sync-source",
        );
        expect(host?.headSeq).toBe(3);
        expect(source?.headSeq).toBe(1);
        if (!host || !source) return;
        const promotedSource = loadPrimaryBlockDocument(
          database,
          "document:sync-source",
        );
        try {
          const promotedText = [
            ...promotedSource.document.getXmlFragment("body").createTreeWalker(
              (node) => node instanceof Y.XmlText,
            ),
          ][0] as Y.XmlText | undefined;
          expect(promotedText?.toString()).toBe(
            "root after lease flush",
          );
        } finally {
          promotedSource.document.destroy();
        }

        const demoted = applyAdditionalDocumentCommand(
          database,
          command(
            projectId,
            storeEpoch,
            "command:demote",
            {
              kind: "demote_synced_source",
              host: {
                documentId: host.documentId,
                generation: host.generation,
              },
              source: {
                documentId: source.documentId,
                generation: source.generation,
              },
              referenceBlockId,
              sourceBlockId,
            },
            lease("lease:demote", [host, source]),
          ),
        );
        expect(demoted.ok).toBe(true);
        if (!demoted.ok) return;
        expect(demoted.value.effect.deletedBlockIds.join(",")).toBe(
          [referenceBlockId, sourceBlockId].sort().join(","),
        );
        expect(demoted.value.effect.preservedBlockIds.join(",")).toBe(
          [childBlockId, rootBlockId].sort().join(","),
        );

        const replay = applyAdditionalDocumentCommand(database, {
          ...command(
            projectId,
            storeEpoch,
            "command:demote",
            {
              kind: "demote_synced_source",
              host: {
                documentId: host.documentId,
                generation: host.generation,
              },
              source: {
                documentId: source.documentId,
                generation: source.generation,
              },
              referenceBlockId,
              sourceBlockId,
            },
            { kind: "receipt_replay" },
          ),
          clientSessionId: "test:lost-response",
          actor: { retry: true },
        });
        expect(replay.ok).toBe(true);
        if (replay.ok) {
          expect(replay.value.duplicate).toBe(true);
          expect(replay.value.semanticHash).toBe(demoted.value.semanticHash);
          expect(replay.value.changeLogSeq).toBe(demoted.value.changeLogSeq);
        }

        const collision = applyAdditionalDocumentCommand(database, {
          ...command(
            projectId,
            storeEpoch,
            "command:demote",
            {
              kind: "demote_synced_source",
              host: {
                documentId: host.documentId,
                generation: host.generation,
              },
              source: {
                documentId: source.documentId,
                generation: source.generation,
              },
              referenceBlockId: createUuidV7(),
              sourceBlockId,
            },
            { kind: "receipt_replay" },
          ),
          actor: { retry: "different logical content" },
        });
        expect(collision.ok).toBe(false);
        if (!collision.ok) {
          expect(collision.error.code).toBe("operation_id_collision");
        }
      });
    },
  );

  sqliteTest(
    "creates Template instances and Large Document owners through one receipt contract",
    async () => {
      await withDatabase((database, projectId, storeEpoch) => {
        const targetCardId = createUuidV7();
        const targetAnchorId = createUuidV7();
        const templateSourceId = createUuidV7();
        const templateRootId = createUuidV7();
        const largeOwnerId = createUuidV7();
        const largeBodyId = createUuidV7();
        seedCardDocument(database, {
          projectId,
          cardId: targetCardId,
          documentId: "document:target",
          blockTree: [paragraph(targetAnchorId, "anchor")],
        });
        const createdTemplate = applyAdditionalDocumentCommand(
          database,
          command(projectId, storeEpoch, "command:template", {
            kind: "create_template",
            sourceBlockId: templateSourceId,
            documentId: "document:template",
            displayName: "Review",
            initialBlocks: [paragraph(templateRootId, "review")],
            placement: { kind: "space" },
          }),
        );
        expect(createdTemplate.ok).toBe(true);

        const instantiated = applyAdditionalDocumentCommand(
          database,
          command(
            projectId,
            storeEpoch,
            "command:instantiate",
            {
              kind: "instantiate_template",
              sourceBlockId: templateSourceId,
              source: {
                documentId: "document:template",
                generation: 1,
              },
              target: {
                documentId: "document:target",
                generation: 1,
              },
            },
            lease("lease:instantiate", [
              {
                documentId: "document:template",
                generation: 1,
                headSeq: 1,
              },
              {
                documentId: "document:target",
                generation: 1,
                headSeq: 1,
              },
            ]),
          ),
        );
        expect(instantiated.ok).toBe(true);
        if (instantiated.ok) {
          expect(instantiated.value.effect.preservedBlockIds[0]).toBe(
            templateSourceId,
          );
          expect(
            instantiated.value.effect.createdBlockIds.includes(templateRootId),
          ).toBe(false);
          expect(
            instantiated.value.effect.createdBlockIds.includes(targetCardId),
          ).toBe(false);

          const freshHeadReplay = applyAdditionalDocumentCommand(
            database,
            command(
              projectId,
              storeEpoch,
              "command:instantiate",
              {
                kind: "instantiate_template",
                  sourceBlockId: templateSourceId,
                source: {
                  documentId: "document:template",
                  generation: 1,
                },
                target: {
                  documentId: "document:target",
                  generation: 1,
                },
              },
              lease("lease:instantiate-retry", [
                {
                  documentId: "document:template",
                  generation: 1,
                  headSeq: 1,
                },
                {
                  documentId: "document:target",
                  generation: 1,
                  headSeq: 2,
                },
              ]),
            ),
          );
          expect(freshHeadReplay.ok).toBe(true);
          if (freshHeadReplay.ok) {
            expect(freshHeadReplay.value.duplicate).toBe(true);
            expect(freshHeadReplay.value.semanticHash).toBe(
              instantiated.value.semanticHash,
            );
          }

          const anchorCollision = applyAdditionalDocumentCommand(
            database,
            command(
              projectId,
              storeEpoch,
              "command:instantiate",
              {
                kind: "instantiate_template",
                  sourceBlockId: templateSourceId,
                source: {
                  documentId: "document:template",
                  generation: 1,
                },
                target: {
                  documentId: "document:target",
                  generation: 1,
                },
                beforeBlockId: targetAnchorId,
              },
              lease("lease:instantiate-anchor-collision", [
                {
                  documentId: "document:template",
                  generation: 1,
                  headSeq: 1,
                },
                {
                  documentId: "document:target",
                  generation: 1,
                  headSeq: 2,
                },
              ]),
            ),
          );
          expect(anchorCollision.ok).toBe(false);
          if (!anchorCollision.ok) {
            expect(anchorCollision.error.code).toBe("operation_id_collision");
          }
        }

        const large = applyAdditionalDocumentCommand(
          database,
          command(
            projectId,
            storeEpoch,
            "command:large",
            {
              kind: "create_large_document",
              blockId: largeOwnerId,
              documentId: "document:large",
              displayName: "Architecture",
              content: {
                kind: "large_document",
                initialBlocks: [paragraph(largeBodyId, "body")],
              },
              location: {
                kind: "document",
                host: {
                  documentId: "document:target",
                  generation: 1,
                },
              },
            },
            lease("lease:large", [
              {
                documentId: "document:target",
                generation: 1,
                headSeq: 2,
              },
            ]),
          ),
        );
        expect(large.ok).toBe(true);
        if (large.ok) {
          expect(large.value.effect.createdBlockIds.join(",")).toBe(
            [largeBodyId, largeOwnerId].sort().join(","),
          );
          expect(large.value.effect.documentHeads.length).toBe(2);
        }
      });
    },
  );

  sqliteTest(
    "durably rejects stale space anchors and never executes a missing receipt replay",
    async () => {
      await withDatabase((database, projectId, storeEpoch) => {
        const staleSourceId = createUuidV7();
        const staleBodyId = createUuidV7();
        const anchor = database
          .prepare(
            `
            SELECT block.id, block.location_revision
            FROM blocks block
            INNER JOIN top_level_block_placements placement
              ON placement.block_id = block.id
            WHERE block.project_id = ? AND block.lifecycle <> 'deleted'
            ORDER BY placement.rank_key, block.id
            LIMIT 1
          `,
          )
          .get(projectId) as {
          readonly id: string;
          readonly location_revision: number;
        };
        const stale = applyAdditionalDocumentCommand(
          database,
          command(projectId, storeEpoch, "command:stale-anchor", {
            kind: "create_synced_source",
            sourceBlockId: staleSourceId,
            documentId: "document:sync-stale",
            initialBlocks: [paragraph(staleBodyId, "stale")],
            placement: {
              kind: "space",
              before: {
                blockId: anchor.id,
                expectedLocationRevision: anchor.location_revision + 1,
              },
            },
          }),
        );
        expect(stale.ok).toBe(false);
        if (!stale.ok) expect(stale.error.code).toBe("block_revision_conflict");
        const rejection = database
          .prepare(
            "SELECT outcome FROM block_mutations WHERE mutation_id = 'command:stale-anchor'",
          )
          .get() as { readonly outcome: string };
        expect(rejection.outcome).toBe("rejected");
        expect(
          database
            .prepare("SELECT 1 FROM blocks WHERE id = ?")
            .get(staleSourceId) === undefined,
        ).toBe(true);

        const missingReplay = applyAdditionalDocumentCommand(
          database,
          command(
            projectId,
            storeEpoch,
            "command:missing-replay",
            {
              kind: "instantiate_template",
              sourceBlockId: "template:missing",
              source: {
                documentId: "document:missing-source",
                generation: 1,
              },
              target: {
                documentId: "document:missing-target",
                generation: 1,
              },
            },
            { kind: "receipt_replay" },
          ),
        );
        expect(missingReplay.ok).toBe(false);
        if (!missingReplay.ok) {
          expect(missingReplay.error.code).toBe("coordination_failed");
        }
        expect(
          database
            .prepare(
              "SELECT 1 FROM block_mutations WHERE mutation_id = 'command:missing-replay'",
            )
            .get() === undefined,
        ).toBe(true);
      });
    },
  );

  sqliteTest(
    "fails closed when another exact-head Document references an owned source",
    async () => {
      await withDatabase((database, projectId, storeEpoch) => {
        const referencedOwnerId = createUuidV7();
        const referencedBodyId = createUuidV7();
        const referenceHostCardId = createUuidV7();
        const referenceBlockId = createUuidV7();
        const created = applyAdditionalDocumentCommand(
          database,
          command(projectId, storeEpoch, "command:referenced-large", {
            kind: "create_large_document",
            blockId: referencedOwnerId,
            documentId: "document:large-referenced",
            displayName: "Referenced",
            content: {
              kind: "large_document",
              initialBlocks: [paragraph(referencedBodyId, "body")],
            },
            location: { kind: "space" },
          }),
        );
        if (!created.ok) throw new Error(created.error.message);
        seedCardDocument(database, {
          projectId,
          cardId: referenceHostCardId,
          documentId: "document:reference-host",
          blockTree: [
            {
              id: referenceBlockId,
              type: "cardRef",
              props: {
                targetBlockId: referencedOwnerId,
                displayHint: "Referenced",
              },
              children: [],
            },
          ],
        });
        const owner = database
          .prepare(
            `SELECT metadata_revision, location_revision FROM blocks WHERE id = ?`,
          )
          .get(referencedOwnerId) as {
          readonly metadata_revision: number;
          readonly location_revision: number;
        };
        const head = created.value.effect.documentHeads[0];
        if (!head) throw new Error("Referenced source returned no Document head");
        const rejected = applyAdditionalDocumentCommand(
          database,
          command(
            projectId,
            storeEpoch,
            "command:referenced-large-delete",
            {
              kind: "delete_owned_source",
              ownerKind: "large_document",
              owner: {
                ownerBlockId: referencedOwnerId,
                documentId: head.documentId,
                generation: head.generation,
                metadataRevision: owner.metadata_revision,
                locationRevision: owner.location_revision,
              },
              referencePolicy: "require_unreferenced",
            },
            lease("lease:referenced-large-delete", [head]),
          ),
        );
        expect(rejected.ok).toBe(false);
        if (!rejected.ok) expect(rejected.error.code).toBe("source_referenced");
        expect(
          (
            database
              .prepare("SELECT lifecycle FROM blocks WHERE id = ?")
              .get(referencedOwnerId) as { readonly lifecycle: string }
          ).lifecycle,
        ).toBe("active");
      });
    },
  );

  sqliteTest(
    "rolls nested writes back and atomically creates then tombstones a non-primary Canvas",
    async () => {
      await withDatabase((database, projectId, storeEpoch) => {
        const faultSourceId = createUuidV7();
        const faultBodyId = createUuidV7();
        const canvasBlockId = createUuidV7();
        const largeSourceId = createUuidV7();
        const largeRootId = createUuidV7();
        const largeChildId = createUuidV7();
        const request = command(projectId, storeEpoch, "command:fault", {
          kind: "create_template",
          sourceBlockId: faultSourceId,
          documentId: "document:template-fault",
          displayName: "Fault",
          initialBlocks: [paragraph(faultBodyId, "rollback")],
          placement: { kind: "space" },
        });
        const failed = applyAdditionalDocumentCommand(database, request, {
          faultInjector: () => {
            throw new Error("fault after nested kernel");
          },
        });
        expect(failed.ok).toBe(false);
        if (!failed.ok) expect(failed.error.code).toBe("unknown");
        for (const [table, identity] of [
          ["blocks", faultSourceId],
          ["documents", "document:template-fault"],
          ["block_mutations", "command:fault"],
        ] as const) {
          const column = table === "block_mutations" ? "mutation_id" : "id";
          expect(
            database
              .prepare(`SELECT 1 FROM ${table} WHERE ${column} = ?`)
              .get(identity) === undefined,
          ).toBe(true);
        }
        expect(applyAdditionalDocumentCommand(database, request).ok).toBe(true);

        const createdCanvas = applyAdditionalDocumentCommand(
          database,
          command(
            projectId,
            storeEpoch,
            "command:canvas-gap",
            {
              kind: "create_canvas_owner",
              scope: "non_primary",
              blockId: canvasBlockId,
              documentId: "document:canvas-secondary",
              displayName: "Sketch",
              placement: { kind: "space" },
            },
          ),
        );
        if (!createdCanvas.ok) throw new Error(createdCanvas.error.message);
        expect(createdCanvas.ok).toBe(true);
        expect(createdCanvas.value.effect.createdBlockIds.join(",")).toBe(
          canvasBlockId,
        );
        const owner = database
          .prepare(
            `SELECT metadata_revision, location_revision FROM blocks WHERE id = ?`,
          )
          .get(canvasBlockId) as {
          readonly metadata_revision: number;
          readonly location_revision: number;
        };
        expect(
          getDocumentBearingBlockSummary(
            database,
            projectId,
            canvasBlockId,
          ).ownerType,
        ).toBe("canvas");
        const canvasHead = createdCanvas.value.effect.documentHeads[0];
        if (!canvasHead) throw new Error("Canvas command returned no Document head");
        const deletedCanvas = applyAdditionalDocumentCommand(
          database,
          command(
            projectId,
            storeEpoch,
            "command:canvas-delete",
            {
              kind: "delete_canvas_owner",
              scope: "non_primary",
              owner: {
                ownerBlockId: canvasBlockId,
                documentId: canvasHead.documentId,
                generation: canvasHead.generation,
                metadataRevision: owner.metadata_revision,
                locationRevision: owner.location_revision,
              },
              referencePolicy: "require_unreferenced",
            },
            lease("lease:canvas-delete", [canvasHead]),
          ),
        );
        expect(deletedCanvas.ok).toBe(true);
        if (!deletedCanvas.ok) throw new Error(deletedCanvas.error.message);
        expect(deletedCanvas.value.effect.deletedBlockIds.join(",")).toBe(
          canvasBlockId,
        );
        expect(
          (
            database
              .prepare("SELECT lifecycle FROM blocks WHERE id = ?")
              .get(canvasBlockId) as { readonly lifecycle: string }
          ).lifecycle,
        ).toBe("deleted");
        expect(
          database
            .prepare("SELECT 1 FROM documents WHERE id = 'document:canvas-secondary'")
            .get() !== undefined,
        ).toBe(true);
        const retry = applyAdditionalDocumentCommand(
          database,
          command(
            projectId,
            storeEpoch,
            "command:canvas-delete",
            {
              kind: "delete_canvas_owner",
              scope: "non_primary",
              owner: {
                ownerBlockId: canvasBlockId,
                documentId: canvasHead.documentId,
                generation: canvasHead.generation,
                metadataRevision: owner.metadata_revision,
                locationRevision: owner.location_revision,
              },
              referencePolicy: "require_unreferenced",
            },
            { kind: "receipt_replay" },
          ),
        );
        expect(retry.ok).toBe(true);
        if (retry.ok) expect(retry.value.duplicate).toBe(true);

        const largeSource = applyAdditionalDocumentCommand(
          database,
          command(projectId, storeEpoch, "command:large-source", {
            kind: "create_large_document",
            blockId: largeSourceId,
            documentId: "document:large-deletable",
            displayName: "Temporary source",
            content: {
              kind: "large_document",
              initialBlocks: [
                paragraph(largeRootId, "root", [
                  paragraph(largeChildId, "child"),
                ]),
              ],
            },
            location: { kind: "space" },
          }),
        );
        if (!largeSource.ok) throw new Error(largeSource.error.message);
        const largeOwner = database
          .prepare(
            `SELECT metadata_revision, location_revision FROM blocks WHERE id = ?`,
          )
          .get(largeSourceId) as {
          readonly metadata_revision: number;
          readonly location_revision: number;
        };
        const largeHead = largeSource.value.effect.documentHeads[0];
        if (!largeHead) throw new Error("Large source returned no Document head");
        const deletedLarge = applyAdditionalDocumentCommand(
          database,
          command(
            projectId,
            storeEpoch,
            "command:large-source-delete",
            {
              kind: "delete_owned_source",
              ownerKind: "large_document",
              owner: {
                ownerBlockId: largeSourceId,
                documentId: largeHead.documentId,
                generation: largeHead.generation,
                metadataRevision: largeOwner.metadata_revision,
                locationRevision: largeOwner.location_revision,
              },
              referencePolicy: "require_unreferenced",
            },
            lease("lease:large-source-delete", [largeHead]),
          ),
        );
        if (!deletedLarge.ok) throw new Error(deletedLarge.error.message);
        expect(deletedLarge.value.effect.deletedBlockIds.join(",")).toBe(
          [largeSourceId, largeRootId, largeChildId].sort().join(","),
        );
        expect(
          (
            database
              .prepare(
                `SELECT COUNT(*) AS count FROM blocks
                 WHERE id IN (?, ?, ?)
                   AND lifecycle = 'deleted'`,
              )
              .get(largeSourceId, largeRootId, largeChildId) as { readonly count: number }
          ).count,
        ).toBe(3);
      });
    },
  );
});
