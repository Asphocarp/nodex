import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import {
  materializeCardDocument,
  type BlockTreeNode,
} from "../../shared/block-documents/block-document-codec";
import { applyDocumentOperationBatch } from "./block-document-operations";
import {
  compactBlockDocument,
  loadPrimaryBlockDocument,
} from "./block-document-store";
import { applyCardLifecycleMutation } from "./card-block-lifecycle";
import { maintainBlockRetention } from "./block-retention-maintenance";
import { createCard } from "./cards";
import { closeDatabase, getDb, initializeDatabase } from "./database";
import {
  assertLegacyCardPromotionCutoverReady,
  finalizeLegacyCardPromotionCutover,
  LegacyCardPromotionCutoverError,
} from "./legacy-card-promotion-cutover";
import { createProject } from "./projects";

const tempDirectories: string[] = [];

const sha256 = (value: string): string =>
  createHash("sha256").update(value).digest("hex");

const insertMutation = (input: {
  readonly mutationId: string;
  readonly projectId: string;
  readonly storeEpoch: string;
  readonly mutationKind: string;
  readonly requestHash: string;
  readonly request: Readonly<Record<string, unknown>>;
  readonly result: Readonly<Record<string, unknown>>;
}): void => {
  const database = getDb();
  const recordedAt = new Date().toISOString();
  const change = database
    .prepare(
      `INSERT INTO change_log (
         project_id, store_epoch, kind, operation_id, payload_json, committed_at
       ) VALUES (?, ?, 'test_legacy_evidence', ?, '{}', ?)`,
    )
    .run(
      input.projectId,
      input.storeEpoch,
      input.mutationId,
      recordedAt,
    );
  database
    .prepare(
      `INSERT INTO block_mutations (
         mutation_id, project_id, store_epoch, mutation_kind,
         request_hash, request_json, outcome, result_json,
         change_log_seq, recorded_at
       ) VALUES (?, ?, ?, ?, ?, ?, 'committed', ?, ?, ?)`,
    )
    .run(
      input.mutationId,
      input.projectId,
      input.storeEpoch,
      input.mutationKind,
      input.requestHash,
      JSON.stringify(input.request),
      JSON.stringify(input.result),
      Number(change.lastInsertRowid),
      recordedAt,
    );
};

const flattenIds = (root: BlockTreeNode): readonly string[] => [
  root.id,
  ...root.children.flatMap(flattenIds),
];

const seedHistoricalPromotionEvidence = (input: {
  readonly projectId: string;
  readonly storeEpoch: string;
  readonly cardId: string;
  readonly root: BlockTreeNode;
  readonly suffix: string;
  readonly mode?: "move" | "copy";
  readonly sourceRootId?: string;
}): void => {
  const documentId = `document:${input.cardId}`;
  const mode = input.mode ?? "move";
  const sourceRootId = input.sourceRootId ?? input.cardId;
  const outerRequest = {
    operationId: `outer-transfer-${input.suffix}`,
    projectId: input.projectId,
    rootBlockIds: [sourceRootId],
    mode,
  };
  const outerRequestHash = sha256(JSON.stringify(outerRequest));
  const rootRequestHash = sha256(
    `${outerRequestHash}\0root\0${sourceRootId}`,
  );
  const role = mode === "move" ? "promotion-body" : "copy-promoted-body";
  const nestedMutationId = `block-transfer:${rootRequestHash}:${role}`;
  const nestedRequest = {
    version: 1,
    mutationId: nestedMutationId,
    projectId: input.projectId,
    storeEpoch: input.storeEpoch,
    documentId,
    generation: 1,
    expectedHeadSeq: 1,
    operations: [{ kind: "insert_block", block: input.root }],
  };
  const nestedRequestHash = sha256(JSON.stringify(nestedRequest));
  insertMutation({
    mutationId: nestedMutationId,
    projectId: input.projectId,
    storeEpoch: input.storeEpoch,
    mutationKind: "document_operation_batch",
    requestHash: nestedRequestHash,
    request: nestedRequest,
    result: {
      version: 1,
      mutationId: nestedMutationId,
      mutationKind: "document_operation_batch",
      projectId: input.projectId,
      storeEpoch: input.storeEpoch,
      documentId,
      generation: 1,
      baseHeadSeq: 1,
      headSeq: 2,
      createdBlockIds: flattenIds(input.root),
      touchedBlockIds: flattenIds(input.root),
    },
  });
  insertMutation({
    mutationId: `outer-transfer-${input.suffix}`,
    projectId: input.projectId,
    storeEpoch: input.storeEpoch,
    mutationKind: "block_transfer",
    requestHash: outerRequestHash,
    request: outerRequest,
    result: {
      version: 1,
      operationId: `outer-transfer-${input.suffix}`,
      projectId: input.projectId,
      storeEpoch: input.storeEpoch,
      mode,
      sourceRootBlockIds: [sourceRootId],
      resultRootBlockIds: [input.cardId],
      copiedBlockIds: mode === "copy"
        ? { [sourceRootId]: input.cardId }
        : {},
      finalLocations: {},
      documentCommits: [
        {
          documentId,
          generation: 1,
          baseHeadSeq: 1,
          headSeq: 2,
          updateId: `document-mutation:${nestedRequestHash}`,
        },
      ],
    },
  });
};

const readCardDocument = (cardId: string): {
  readonly documentId: string;
  readonly generation: number;
  readonly headSeq: number;
  readonly root: BlockTreeNode;
  readonly roots: readonly BlockTreeNode[];
} => {
  const database = getDb();
  const row = database
    .prepare(
      `SELECT ownership.document_id, document.generation, document.head_seq
       FROM block_documents ownership
       JOIN documents document ON document.id = ownership.document_id
       WHERE ownership.block_id = ?`,
    )
    .get(cardId) as {
    readonly document_id: string;
    readonly generation: number;
    readonly head_seq: number;
  };
  const loaded = loadPrimaryBlockDocument(database, row.document_id);
  try {
    const roots = materializeCardDocument(loaded.document).blockTree;
    const root = roots[0];
    if (!root) throw new Error(`Card ${cardId} has no body root`);
    return {
      documentId: row.document_id,
      generation: row.generation,
      headSeq: row.head_seq,
      root,
      roots,
    };
  } finally {
    loaded.document.destroy();
  }
};

afterEach(() => {
  closeDatabase();
  tempDirectories.splice(0).forEach((directory) =>
    fs.rmSync(directory, { recursive: true, force: true }),
  );
  delete process.env.NODEX_DIR;
});

describe("legacy Card promotion cutover", () => {
  test("repairs exact unchanged roots and fails closed on a divergent title", async () => {
    const directory = fs.mkdtempSync(
      path.join(os.tmpdir(), "nodex-legacy-promotion-cutover-"),
    );
    tempDirectories.push(directory);
    process.env.NODEX_DIR = directory;
    await initializeDatabase();
    const project = createProject({ name: "Cutover" });
    const safe = await createCard(project.id, "backlog", {
      title: "Safe promoted root",
      description: "Safe promoted root\n\tSafe child",
    });
    const divergent = await createCard(project.id, "backlog", {
      title: "Original promoted root",
      description: "Original promoted root",
    });
    const editedRoot = await createCard(project.id, "backlog", {
      title: "Edited promoted root",
      description: "Edited promoted root",
    });
    const database = getDb();
    const storeEpoch = (
      database
        .prepare("SELECT store_epoch FROM block_store_metadata WHERE id = 1")
        .get() as { readonly store_epoch: string }
    ).store_epoch;
    const safeDocument = readCardDocument(safe.id);
    const divergentDocument = readCardDocument(divergent.id);
    const editedRootDocument = readCardDocument(editedRoot.id);
    seedHistoricalPromotionEvidence({
      projectId: project.id,
      storeEpoch,
      cardId: safe.id,
      root: safeDocument.root,
      suffix: "safe",
    });
    seedHistoricalPromotionEvidence({
      projectId: project.id,
      storeEpoch,
      cardId: divergent.id,
      root: divergentDocument.root,
      suffix: "divergent",
    });
    seedHistoricalPromotionEvidence({
      projectId: project.id,
      storeEpoch,
      cardId: editedRoot.id,
      root: editedRootDocument.root,
      suffix: "edited-root",
    });
    const titleChange = applyDocumentOperationBatch(
      database,
      {
        version: 1,
        mutationId: "diverge-legacy-promotion-title",
        projectId: project.id,
        storeEpoch,
        actor: { kind: "test" },
        documentId: divergentDocument.documentId,
        generation: divergentDocument.generation,
        expectedHeadSeq: divergentDocument.headSeq,
        operations: [{ kind: "set_title", title: "Independently changed" }],
      },
      {
        writeFence: {
          leaseId: "diverge-legacy-promotion-title:lease",
          documentId: divergentDocument.documentId,
          generation: divergentDocument.generation,
          headSeq: divergentDocument.headSeq,
        },
      },
    );
    expect(titleChange.ok).toBe(true);
    const rootChange = applyDocumentOperationBatch(
      database,
      {
        version: 1,
        mutationId: "diverge-legacy-promotion-root",
        projectId: project.id,
        storeEpoch,
        actor: { kind: "test" },
        documentId: editedRootDocument.documentId,
        generation: editedRootDocument.generation,
        expectedHeadSeq: editedRootDocument.headSeq,
        operations: [{
          kind: "update_block",
          blockId: editedRootDocument.root.id,
          patch: {
            content: [{
              type: "text",
              text: "Independently edited promoted root",
              styles: {},
            }],
          },
        }],
      },
      {
        writeFence: {
          leaseId: "diverge-legacy-promotion-root:lease",
          documentId: editedRootDocument.documentId,
          generation: editedRootDocument.generation,
          headSeq: editedRootDocument.headSeq,
        },
      },
    );
    expect(rootChange.ok).toBe(true);

    const result = finalizeLegacyCardPromotionCutover(database);
    expect(result.repairedCardIds).toEqual([safe.id]);
    expect(result.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({
        cardId: divergent.id,
        duplicatedRootId: divergentDocument.root.id,
        reason: "title_diverged",
      }),
      expect.objectContaining({
        cardId: editedRoot.id,
        duplicatedRootId: editedRootDocument.root.id,
        reason: "root_changed",
      }),
    ]));
    expect(result.issues).toHaveLength(2);

    const repaired = readCardDocument(safe.id);
    const expectedChildId = safeDocument.root.children[0]?.id;
    expect(repaired.root.id).toBe(expectedChildId);
    expect(
      database
        .prepare(
          `SELECT lifecycle FROM blocks WHERE id = ? AND project_id = ?`,
        )
        .get(safeDocument.root.id, project.id),
    ).toEqual({ lifecycle: "deleted" });
    expect(
      database
        .prepare(
          `SELECT cause FROM document_versions
           WHERE document_id = ? ORDER BY created_at DESC LIMIT 1`,
        )
        .get(safeDocument.documentId),
    ).toEqual({ cause: "before_legacy_card_promotion_cutover" });
    const retry = finalizeLegacyCardPromotionCutover(database);
    expect(retry.repairedCardIds).toEqual([]);
    expect(retry.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ reason: "title_diverged" }),
      expect.objectContaining({ reason: "root_changed" }),
    ]));
    expect(retry.issues).toHaveLength(2);
    expect(() => assertLegacyCardPromotionCutoverReady(database)).toThrow(
      LegacyCardPromotionCutoverError,
    );
    expect(() => assertLegacyCardPromotionCutoverReady(database)).toThrow(
      /Independently changed.*will not guess/u,
    );
  });

  test("repairs historical Copy evidence, lifts children beside existing siblings, and gives a leaf one empty body root", async () => {
    const directory = fs.mkdtempSync(
      path.join(os.tmpdir(), "nodex-legacy-promotion-copy-cutover-"),
    );
    tempDirectories.push(directory);
    process.env.NODEX_DIR = directory;
    await initializeDatabase();
    const project = createProject({ name: "Copy cutover" });
    const copied = await createCard(project.id, "backlog", {
      title: "Copied root",
      description: "Copied root\n\tLifted child\nFollowing sibling",
    });
    const leaf = await createCard(project.id, "backlog", {
      title: "Copied leaf",
      description: "Copied leaf",
    });
    const database = getDb();
    const storeEpoch = (
      database
        .prepare("SELECT store_epoch FROM block_store_metadata WHERE id = 1")
        .get() as { readonly store_epoch: string }
    ).store_epoch;
    const copiedBefore = readCardDocument(copied.id);
    const leafBefore = readCardDocument(leaf.id);
    const followingSiblingId = copiedBefore.roots[1]?.id;
    const liftedChildId = copiedBefore.root.children[0]?.id;
    seedHistoricalPromotionEvidence({
      projectId: project.id,
      storeEpoch,
      cardId: copied.id,
      root: copiedBefore.root,
      suffix: "copy-with-sibling",
      mode: "copy",
      sourceRootId: "historical-copy-source",
    });
    seedHistoricalPromotionEvidence({
      projectId: project.id,
      storeEpoch,
      cardId: leaf.id,
      root: leafBefore.root,
      suffix: "copy-leaf",
      mode: "copy",
      sourceRootId: "historical-copy-leaf-source",
    });
    expect(compactBlockDocument(database, {
      documentId: copiedBefore.documentId,
      expectedGeneration: copiedBefore.generation,
      expectedHeadSeq: copiedBefore.headSeq,
    }).snapshotSeq).toBe(copiedBefore.headSeq);

    const result = finalizeLegacyCardPromotionCutover(database);
    expect(new Set(result.repairedCardIds)).toEqual(
      new Set([copied.id, leaf.id]),
    );
    expect(result.issues).toEqual([]);
    const copiedAfter = readCardDocument(copied.id);
    expect(copiedAfter.roots.map(({ id }) => id)).toEqual([
      liftedChildId,
      followingSiblingId,
    ]);
    expect(copiedAfter.root.content).toEqual(
      copiedBefore.root.children[0]?.content,
    );
    const leafAfter = readCardDocument(leaf.id);
    expect(leafAfter.roots).toHaveLength(1);
    expect(leafAfter.root.type).toBe("paragraph");
    expect(leafAfter.root.content).toEqual([]);
    expect(leafAfter.root.id).not.toBe(leafBefore.root.id);
    expect(finalizeLegacyCardPromotionCutover(database)).toEqual({
      repairedCardIds: [],
      issues: [],
    });
  });

  test("ignores immutable promotion evidence after the Card is permanently retired", async () => {
    const directory = fs.mkdtempSync(
      path.join(os.tmpdir(), "nodex-retired-promotion-cutover-"),
    );
    tempDirectories.push(directory);
    process.env.NODEX_DIR = directory;
    await initializeDatabase();
    const project = createProject({ name: "Retired cutover" });
    const card = await createCard(project.id, "backlog", {
      title: "Historical title",
      description: "Historical title",
    });
    const database = getDb();
    const storeEpoch = (
      database
        .prepare("SELECT store_epoch FROM block_store_metadata WHERE id = 1")
        .get() as { readonly store_epoch: string }
    ).store_epoch;
    const before = readCardDocument(card.id);
    seedHistoricalPromotionEvidence({
      projectId: project.id,
      storeEpoch,
      cardId: card.id,
      root: before.root,
      suffix: "retired",
    });
    const titleChange = applyDocumentOperationBatch(
      database,
      {
        version: 1,
        mutationId: "diverge-retired-promotion-title",
        projectId: project.id,
        storeEpoch,
        actor: { kind: "test" },
        documentId: before.documentId,
        generation: before.generation,
        expectedHeadSeq: before.headSeq,
        operations: [{ kind: "set_title", title: "Disposable title" }],
      },
      {
        writeFence: {
          leaseId: "diverge-retired-promotion-title:lease",
          documentId: before.documentId,
          generation: before.generation,
          headSeq: before.headSeq,
        },
      },
    );
    expect(titleChange.ok).toBe(true);
    expect(finalizeLegacyCardPromotionCutover(database).issues).toEqual([
      expect.objectContaining({ cardId: card.id, reason: "title_diverged" }),
    ]);

    const coordinate = database
      .prepare(
        `SELECT metadata_revision, location_revision
         FROM blocks WHERE id = ? AND project_id = ?`,
      )
      .get(card.id, project.id) as {
      readonly metadata_revision: number;
      readonly location_revision: number;
    };
    const deleted = applyCardLifecycleMutation(database, {
      version: 1,
      operationId: "delete-retired-promotion-card",
      projectId: project.id,
      storeEpoch,
      actor: { kind: "test" },
      operation: {
        kind: "delete_card",
        cardId: card.id,
        expectedMetadataRevision: coordinate.metadata_revision,
        expectedLocationRevision: coordinate.location_revision,
      },
    });
    expect(deleted.ok).toBe(true);

    const retention = maintainBlockRetention(database, {
      projectId: project.id,
      rootBlockIds: [card.id],
      policy: { retainNewestDeletedBlocks: 0 },
    });
    expect(retention.candidates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          rootBlockId: card.id,
          status: "collected",
        }),
      ]),
    );
    expect(
      database.prepare("SELECT 1 FROM blocks WHERE id = ?").get(card.id),
    ).toBeUndefined();
    expect(
      database
        .prepare(
          `SELECT block_type FROM retired_block_identities
           WHERE block_id = ? AND project_id = ?`,
        )
        .get(card.id, project.id),
    ).toEqual({ block_type: "card" });
    expect(assertLegacyCardPromotionCutoverReady(database)).toEqual({
      repairedCardIds: [],
      issues: [],
    });
  });
});
