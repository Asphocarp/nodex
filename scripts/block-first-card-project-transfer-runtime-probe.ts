import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { ADDITIONAL_DOCUMENT_BEARING_OPERATION_VERSION } from "../src/shared/block-documents";
import { parseCardLifecycleMutationRequest } from "../src/shared/card-lifecycle";
import { createUuidV7 } from "../src/shared/card-id";
import { createExplicitDocumentBearingBlock } from "../src/main/local-store/additional-document-bearing-blocks";
import { applyCardLifecycleMutation } from "../src/main/local-store/card-block-lifecycle";
import {
  applyCardProjectTransfer,
  compileCardProjectTransferRequest,
  type CardProjectTransferFaultPoint,
} from "../src/main/local-store/card-project-transfer";
import {
  closeDatabase,
  getDb,
  initializeDatabase,
} from "../src/main/local-store/database";
import { createProject } from "../src/main/local-store/projects";

const invariant: (
  condition: unknown,
  message: string,
) => asserts condition = (condition, message) => {
  if (condition) return;
  throw new Error(message);
};

const main = async (): Promise<void> => {
  const previous = process.env.NODEX_DIR;
  const directory = fs.mkdtempSync(
    path.join(os.tmpdir(), "nodex-card-project-transfer-probe-"),
  );
  process.env.NODEX_DIR = directory;
  try {
    await initializeDatabase();
    const source = createProject({ name: "Transfer probe source" });
    const target = createProject({ name: "Transfer probe target" });
    let database = getDb();
    const storeEpoch = (
      database
        .prepare("SELECT store_epoch FROM block_store_metadata WHERE id = 1")
        .get() as { readonly store_epoch: string }
    ).store_epoch;
    const targetDatabaseBlockId = (
      database
        .prepare(
          `SELECT block_id FROM database_capabilities
           WHERE project_id = ? AND is_primary = 1`,
        )
        .get(target.id) as { readonly block_id: string }
    ).block_id;
    const targetViewId = (
      database
        .prepare(
          `SELECT id FROM database_views
           WHERE project_id = ? AND database_block_id = ?
             AND is_primary = 1 AND lifecycle = 'active'`,
        )
        .get(target.id, targetDatabaseBlockId) as { readonly id: string }
    ).id;
    const cardId = createUuidV7();
    const largeShellBlockId = createUuidV7();
    const largeParagraphBlockId = createUuidV7();
    const created = applyCardLifecycleMutation(
      database,
      parseCardLifecycleMutationRequest({
        version: 1,
        operationId: "probe:create-card",
        projectId: source.id,
        storeEpoch,
        clientSessionId: "transfer-probe",
        actor: { kind: "probe" },
        operation: {
          kind: "create_card",
          cardId,
          title: "Stable identity",
          nfm: "Root body",
          status: "draft",
        },
      }),
    );
    invariant(created.ok, "Could not create the source authority Card");
    const rootDocumentId = created.value.documentId ?? `document:${cardId}`;
    createExplicitDocumentBearingBlock(database, {
      version: ADDITIONAL_DOCUMENT_BEARING_OPERATION_VERSION,
      kind: "create_explicit_document_bearing_block",
      operationId: "probe:create-large-document",
      projectId: source.id,
      storeEpoch,
      clientSessionId: "transfer-probe",
      actor: { kind: "probe" },
      blockKind: "large_document",
      blockId: largeShellBlockId,
      documentId: "document:probe-large-shell",
      displayName: "Nested owner",
      blockTree: [
        {
          id: largeParagraphBlockId,
          type: "paragraph",
          props: {},
          content: [
            { type: "text", text: "Nested independent body", styles: {} },
          ],
          children: [],
        },
      ],
      location: {
        kind: "document",
        hostDocumentId: rootDocumentId,
        expectedHostGeneration: 1,
        expectedHostHeadSeq: created.value.documentHeadSeq ?? 1,
      },
    });
    const request = compileCardProjectTransferRequest(database, {
      operationId: "probe:transfer",
      sourceProjectId: source.id,
      targetProjectId: target.id,
      cardId,
      targetDatabaseBlockId,
      targetViewId,
      targetStatus: "in_review",
      clientSessionId: "transfer-probe",
      actor: { kind: "probe" },
    });
    invariant(request.expectedDocuments.length === 2, "Closure missed owned Document");
    const updateEvidence = JSON.stringify(
      database
        .prepare(
          `SELECT document_id, generation, seq, update_hash
           FROM document_updates
           WHERE document_id IN (?, ?)
           ORDER BY document_id, generation, seq`,
        )
        .all(rootDocumentId, "document:probe-large-shell"),
    );

    const rollbackPoints: readonly CardProjectTransferFaultPoint[] = [
      "after_source_memberships",
      "after_project_coordinates",
      "after_target_memberships",
      "after_projections",
      "after_change_log",
      "after_ledger",
      "before_commit",
    ];
    for (const point of rollbackPoints) {
      let failed = false;
      try {
        applyCardProjectTransfer(database, request, {
          faultInjector(candidate) {
            if (candidate === point) throw new Error(`probe:${point}`);
          },
        });
      } catch {
        failed = true;
      }
      invariant(failed, `Fault point did not abort: ${point}`);
      const coordinate = database
        .prepare("SELECT project_id FROM blocks WHERE id = ?")
        .get(cardId) as { readonly project_id: string };
      invariant(
        coordinate.project_id === source.id,
        `Fault point published a partial transfer: ${point}`,
      );
    }

    let responseLost = false;
    try {
      applyCardProjectTransfer(database, request, {
        faultInjector(point) {
          if (point === "after_commit") throw new Error("probe:lost-response");
        },
      });
    } catch {
      responseLost = true;
    }
    invariant(responseLost, "Post-commit response loss was not injected");
    closeDatabase();
    await initializeDatabase();
    database = getDb();
    const retry = applyCardProjectTransfer(database, {
      ...request,
      clientSessionId: "transfer-probe-restart",
      actor: { kind: "probe-restart" },
    });
    invariant(retry.ok && retry.value.duplicate, "Restart retry did not replay receipt");
    invariant(
      request.expectedBlocks.every((block) => {
        const row = database
          .prepare("SELECT project_id FROM blocks WHERE id = ?")
          .get(block.blockId) as { readonly project_id: string } | undefined;
        return row?.project_id === target.id;
      }),
      "Transferred Block closure is incomplete",
    );
    invariant(
      JSON.stringify(
        database
          .prepare(
            `SELECT document_id, generation, seq, update_hash
             FROM document_updates
             WHERE document_id IN (?, ?)
             ORDER BY document_id, generation, seq`,
          )
          .all(rootDocumentId, "document:probe-large-shell"),
      ) === updateEvidence,
      "Project transfer rewrote Y.Doc updates or internal identities",
    );
    invariant(
      (database.pragma("foreign_key_check") as readonly unknown[]).length === 0,
      "Project transfer left foreign-key violations",
    );
    process.stdout.write(
      `${JSON.stringify({
        operationId: request.operationId,
        movedBlocks: retry.value.movedBlockIds.length,
        movedDocuments: retry.value.movedDocumentIds.length,
        sourceMemberships: retry.value.sourceMembershipIds.length,
        duplicateAfterRestart: retry.value.duplicate,
        changeLogSeq: retry.value.changeLogSeq,
        rollbackPoints: rollbackPoints.length,
        ydocUpdatesPreserved: true,
      })}\n`,
    );
  } finally {
    closeDatabase();
    fs.rmSync(directory, { recursive: true, force: true });
    if (previous === undefined) delete process.env.NODEX_DIR;
    else process.env.NODEX_DIR = previous;
  }
};

void main();
