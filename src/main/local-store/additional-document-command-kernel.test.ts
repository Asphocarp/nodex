import { describe, expect, test } from "vitest";
import Database from "better-sqlite3";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import * as Y from "yjs";
import { ADDITIONAL_DOCUMENT_COMMAND_VERSION } from "../../shared/additional-document-commands";
import {
  createDetachedCardDocumentFromBlockTree,
  type BlockTreeNode,
} from "../../shared/block-documents/block-document-codec";
import { applyAdditionalDocumentCommand } from "./additional-document-command-kernel";
import { initializeBlockDocumentGenesis } from "./block-document-store";
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
        seedCardDocument(database, {
          projectId,
          cardId: "card:sync-host",
          documentId: "document:sync-host",
          blockTree: [
            paragraph("sync:root", "root", [paragraph("sync:child", "child")]),
          ],
        });
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
                headSeq: 1,
              },
              rootBlockId: "sync:root",
              referenceBlockId: "sync:reference",
              sourceBlockId: "sync:source",
              sourceDocumentId: "document:sync-source",
            },
            lease("lease:promote", [
              {
                documentId: "document:sync-host",
                generation: 1,
                headSeq: 1,
              },
            ]),
          ),
        );
        expect(promoted.ok).toBe(true);
        if (!promoted.ok) return;
        expect(promoted.value.effect.createdBlockIds.join(",")).toBe(
          "sync:reference,sync:source",
        );
        expect(promoted.value.effect.preservedBlockIds.join(",")).toBe(
          "sync:child,sync:root",
        );
        const host = promoted.value.effect.documentHeads.find(
          (head) => head.documentId === "document:sync-host",
        );
        const source = promoted.value.effect.documentHeads.find(
          (head) => head.documentId === "document:sync-source",
        );
        expect(host?.headSeq).toBe(2);
        expect(source?.headSeq).toBe(1);
        if (!host || !source) return;

        const demoted = applyAdditionalDocumentCommand(
          database,
          command(
            projectId,
            storeEpoch,
            "command:demote",
            {
              kind: "demote_synced_source",
              host,
              source,
              referenceBlockId: "sync:reference",
              sourceBlockId: "sync:source",
            },
            lease("lease:demote", [host, source]),
          ),
        );
        expect(demoted.ok).toBe(true);
        if (!demoted.ok) return;
        expect(demoted.value.effect.deletedBlockIds.join(",")).toBe(
          "sync:reference,sync:source",
        );
        expect(demoted.value.effect.preservedBlockIds.join(",")).toBe(
          "sync:child,sync:root",
        );

        const replay = applyAdditionalDocumentCommand(database, {
          ...command(
            projectId,
            storeEpoch,
            "command:demote",
            {
              kind: "demote_synced_source",
              host,
              source,
              referenceBlockId: "sync:reference",
              sourceBlockId: "sync:source",
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
              host,
              source,
              referenceBlockId: "sync:different-reference",
              sourceBlockId: "sync:source",
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
        seedCardDocument(database, {
          projectId,
          cardId: "card:target",
          documentId: "document:target",
          blockTree: [paragraph("target:anchor", "anchor")],
        });
        const createdTemplate = applyAdditionalDocumentCommand(
          database,
          command(projectId, storeEpoch, "command:template", {
            kind: "create_template",
            sourceBlockId: "template:source",
            documentId: "document:template",
            displayName: "Review",
            initialBlocks: [paragraph("template:root", "review")],
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
              sourceBlockId: "template:source",
              source: {
                documentId: "document:template",
                generation: 1,
                headSeq: 1,
              },
              target: {
                documentId: "document:target",
                generation: 1,
                headSeq: 1,
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
            "template:source",
          );
          expect(
            instantiated.value.effect.createdBlockIds.includes("template:root"),
          ).toBe(false);
          expect(
            instantiated.value.effect.createdBlockIds.includes("card:target"),
          ).toBe(false);
        }

        const large = applyAdditionalDocumentCommand(
          database,
          command(
            projectId,
            storeEpoch,
            "command:large",
            {
              kind: "create_large_document",
              blockId: "large:owner",
              documentId: "document:large",
              displayName: "Architecture",
              content: {
                kind: "large_document",
                initialBlocks: [paragraph("large:body", "body")],
              },
              location: {
                kind: "document",
                host: {
                  documentId: "document:target",
                  generation: 1,
                  headSeq: 2,
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
            "large:body,large:owner",
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
            sourceBlockId: "sync:stale",
            documentId: "document:sync-stale",
            initialBlocks: [paragraph("sync:stale:body", "stale")],
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
            .prepare("SELECT 1 FROM blocks WHERE id = 'sync:stale'")
            .get() === undefined,
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
                headSeq: 1,
              },
              target: {
                documentId: "document:missing-target",
                generation: 1,
                headSeq: 1,
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
    "rolls every nested domain write back when the adapter faults and refuses capability gaps",
    async () => {
      await withDatabase((database, projectId, storeEpoch) => {
        const request = command(projectId, storeEpoch, "command:fault", {
          kind: "create_template",
          sourceBlockId: "template:fault",
          documentId: "document:template-fault",
          displayName: "Fault",
          initialBlocks: [paragraph("template:fault:body", "rollback")],
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
          ["blocks", "template:fault"],
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

        const gap = applyAdditionalDocumentCommand(
          database,
          command(
            projectId,
            storeEpoch,
            "command:canvas-gap",
            {
              kind: "create_canvas_owner",
              scope: "non_primary",
              blockId: "canvas:secondary",
              documentId: "document:canvas-secondary",
              displayName: "Sketch",
              placement: { kind: "space" },
            },
          ),
        );
        expect(gap.ok).toBe(false);
        if (!gap.ok) expect(gap.error.code).toBe("capability_gap");
        expect(
          database
            .prepare("SELECT 1 FROM blocks WHERE id = 'canvas:secondary'")
            .get() === undefined,
        ).toBe(true);
      });
    },
  );
});
