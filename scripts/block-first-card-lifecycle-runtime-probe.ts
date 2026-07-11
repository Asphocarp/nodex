import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  parseCardLifecycleMutationRequest,
  type CardLifecycleMutationRequest,
} from "../src/shared/card-lifecycle";
import { createUuidV7 } from "../src/shared/card-id";
import { readAuthoritativeCardById } from "../src/main/local-store/card-read-store";
import {
  applyCardLifecycleMutation,
  readCardLifecycleStoreEpoch,
  verifyCardDocumentContinuity,
  type CardLifecycleMutationFaultPoint,
} from "../src/main/local-store/card-block-lifecycle";
import {
  closeDatabase,
  getDb,
  initializeDatabase,
} from "../src/main/local-store/database";
import { rebuildCardReadModelProjection } from "../src/main/local-store/card-read-store";
import { createProject } from "../src/main/local-store/projects";
import { refreshScheduledCardIndexProjection } from "../src/main/local-store/scheduled-card-store";

const invariant: (condition: unknown, message: string) => asserts condition = (
  condition,
  message,
) => {
  if (condition) return;
  throw new Error(message);
};

interface Scope {
  readonly projectId: string;
  readonly storeEpoch: string;
}

const request = (
  scope: Scope,
  operationId: string,
  operation: Readonly<Record<string, unknown>>,
): CardLifecycleMutationRequest =>
  parseCardLifecycleMutationRequest({
    version: 1,
    operationId,
    projectId: scope.projectId,
    storeEpoch: scope.storeEpoch,
    clientSessionId: "card-lifecycle-runtime",
    actor: { kind: "runtime_probe" },
    operation,
  });

const createOperation = (
  cardId: string,
  title: string,
): Readonly<Record<string, unknown>> => ({
  kind: "create_card",
  cardId,
  title,
  nfm: "Durable body paragraph",
  status: "draft",
});

const commit = (
  scope: Scope,
  operationId: string,
  operation: Readonly<Record<string, unknown>>,
) => {
  const result = applyCardLifecycleMutation(
    getDb(),
    request(scope, operationId, operation),
  );
  invariant(result.ok, result.ok ? "unreachable" : result.error.message);
  return result.value;
};

const detachMembership = (scope: Scope, cardId: string): void => {
  const database = getDb();
  const now = "2026-07-11T12:00:00.000Z";
  database
    .transaction(() => {
      database
        .prepare(
          "DELETE FROM database_view_positions WHERE block_id = ? AND project_id = ?",
        )
        .run(cardId, scope.projectId);
      database
        .prepare(
          `
        UPDATE database_memberships
        SET removed_at = ?, revision = revision + 1
        WHERE card_block_id = ? AND project_id = ? AND removed_at IS NULL
      `,
        )
        .run(now, cardId, scope.projectId);
      database
        .prepare(
          `
        UPDATE blocks
        SET metadata_revision = metadata_revision + 1, updated_at = ?
        WHERE id = ? AND project_id = ?
      `,
        )
        .run(now, cardId, scope.projectId);
      refreshScheduledCardIndexProjection(
        database,
        scope.projectId,
        [cardId],
        now,
      );
      rebuildCardReadModelProjection(database, scope.projectId, [cardId]);
    })
    .immediate();
};

const main = async (): Promise<void> => {
  const directory = fs.mkdtempSync(
    path.join(os.tmpdir(), "nodex-card-lifecycle-runtime-"),
  );
  process.env.NODEX_DIR = directory;
  try {
    await initializeDatabase();
    const project = createProject({ name: "Card lifecycle runtime" });
    const storeEpoch = readCardLifecycleStoreEpoch(getDb());
    invariant(storeEpoch, "Store epoch is missing");
    const scope: Scope = { projectId: project.id, storeEpoch };

    const cardId = createUuidV7();
    const anchorId = createUuidV7();
    const created = commit(
      scope,
      "runtime:create-card",
      createOperation(cardId, "Block authority"),
    );
    commit(scope, "runtime:create-anchor", createOperation(anchorId, "Anchor"));
    invariant(
      getDb().prepare("SELECT 1 FROM cards WHERE id = ?").get(cardId) ===
        undefined,
      "Authoritative create wrote a compatibility cards row",
    );
    const card = readAuthoritativeCardById(getDb(), project.id, cardId);
    invariant(
      card?.title === "Block authority" &&
        card.description === "Durable body paragraph",
      "Card read model did not assemble from Block/Document authority",
    );
    const projections = getDb()
      .prepare(
        `
        SELECT
          (SELECT COUNT(*) FROM card_read_model WHERE card_block_id = ?) AS read_model,
          (SELECT COUNT(*) FROM scheduled_card_index
            WHERE card_block_id = ? AND source_metadata_revision = 1
              AND lifecycle = 'active') AS schedule,
          (SELECT COUNT(*) FROM block_search_units
            WHERE owner_block_id = ? AND projected_seq = 1) AS search_units
      `,
      )
      .get(cardId, cardId, cardId) as {
      readonly read_model: number;
      readonly schedule: number;
      readonly search_units: number;
    };
    invariant(
      projections.read_model === 1 &&
        projections.schedule === 1 &&
        projections.search_units > 0,
      "Create did not atomically publish read/schedule/search projections",
    );

    closeDatabase();
    await initializeDatabase();
    const createRetry = applyCardLifecycleMutation(
      getDb(),
      request(
        scope,
        "runtime:create-card",
        createOperation(cardId, "Block authority"),
      ),
    );
    invariant(
      createRetry.ok && createRetry.value.duplicate,
      "Committed create did not replay after restart",
    );

    const moved = commit(scope, "runtime:move-card", {
      kind: "move_card_in_space",
      cardId,
      expectedLocationRevision: 1,
      beforeBlockId: anchorId,
    });
    const archived = commit(scope, "runtime:archive-card", {
      kind: "archive_card",
      cardId,
      expectedMetadataRevision: 1,
    });
    const deleted = commit(scope, "runtime:delete-card", {
      kind: "delete_card",
      cardId,
      expectedMetadataRevision: archived.metadataRevision,
      expectedLocationRevision: moved.locationRevision,
    });
    invariant(
      getDb()
        .prepare("SELECT 1 FROM top_level_block_placements WHERE block_id = ?")
        .get(cardId) === undefined,
      "Deleted Card retained a top-level placement",
    );

    const injectedRequest = request(scope, "runtime:restore-injected", {
      kind: "restore_card",
      cardId,
      deleteOperationId: "runtime:delete-card",
      expectedMetadataRevision: deleted.metadataRevision,
      expectedLocationRevision: deleted.locationRevision,
      membership: {
        membershipId: "membership:unrelated-history",
        databaseBlockId: deleted.databaseBlockId,
        viewId: deleted.viewId,
        status: "draft",
      },
    });
    const injected = applyCardLifecycleMutation(getDb(), injectedRequest);
    invariant(
      !injected.ok && injected.error.code === "delete_evidence_invalid",
      "Restore accepted membership not bound by delete evidence",
    );
    closeDatabase();
    await initializeDatabase();
    const injectedRetry = applyCardLifecycleMutation(getDb(), injectedRequest);
    invariant(
      !injectedRetry.ok &&
        injectedRetry.error.code === "delete_evidence_invalid",
      "Rejected restore did not replay after restart",
    );

    const continuityBefore = verifyCardDocumentContinuity(
      getDb(),
      project.id,
      cardId,
    );
    const restored = commit(scope, "runtime:restore-card", {
      kind: "restore_card",
      cardId,
      deleteOperationId: "runtime:delete-card",
      expectedMetadataRevision: deleted.metadataRevision,
      expectedLocationRevision: deleted.locationRevision,
      membership: {
        membershipId: deleted.membershipId,
        databaseBlockId: deleted.databaseBlockId,
        viewId: deleted.viewId,
        status: "draft",
      },
    });
    const continuityAfter = verifyCardDocumentContinuity(
      getDb(),
      project.id,
      cardId,
    );
    invariant(
      restored.lifecycle === "archived" &&
        continuityAfter?.documentId === created.documentId &&
        continuityAfter.headSeq === created.documentHeadSeq &&
        continuityAfter.title === continuityBefore?.title,
      "Restore did not preserve the delete-time lifecycle and owned Document",
    );

    const standaloneId = createUuidV7();
    const standalone = commit(
      scope,
      "runtime:create-standalone",
      createOperation(standaloneId, "Standalone"),
    );
    detachMembership(scope, standaloneId);
    const standaloneState = getDb()
      .prepare(
        `
        SELECT metadata_revision, location_revision
        FROM blocks WHERE id = ?
      `,
      )
      .get(standaloneId) as {
      readonly metadata_revision: number;
      readonly location_revision: number;
    };
    const standaloneDeleted = commit(scope, "runtime:delete-standalone", {
      kind: "delete_card",
      cardId: standaloneId,
      expectedMetadataRevision: standaloneState.metadata_revision,
      expectedLocationRevision: standaloneState.location_revision,
    });
    const standaloneRestored = commit(scope, "runtime:restore-standalone", {
      kind: "restore_card",
      cardId: standaloneId,
      deleteOperationId: "runtime:delete-standalone",
      expectedMetadataRevision: standaloneDeleted.metadataRevision,
      expectedLocationRevision: standaloneDeleted.locationRevision,
      membership: null,
    });
    invariant(
      standaloneRestored.membershipId === null &&
        standaloneRestored.documentId === standalone.documentId,
      "Standalone Card restore manufactured membership or Document identity",
    );

    const invalidOptionId = createUuidV7();
    getDb()
      .prepare(
        `
        UPDATE database_properties
        SET config_json = '{"options":[]}'
        WHERE project_id = ? AND key = 'priority' AND lifecycle = 'active'
      `,
      )
      .run(project.id);
    const invalidOption = applyCardLifecycleMutation(
      getDb(),
      request(scope, "runtime:create-invalid-option", {
        ...createOperation(invalidOptionId, "Invalid option"),
        priority: "p1-high",
      }),
    );
    invariant(
      !invalidOption.ok &&
        invalidOption.error.code === "database_property_value_invalid" &&
        getDb()
          .prepare("SELECT 1 FROM blocks WHERE id = ?")
          .get(invalidOptionId) === undefined,
      "Create bypassed current Database property options",
    );

    const faultPoints: readonly CardLifecycleMutationFaultPoint[] = [
      "after_identity",
      "after_document_genesis",
      "after_properties",
      "after_authority",
      "after_projections",
      "after_change_log",
      "after_ledger",
      "before_commit",
    ];
    // Priority now has no options. Empty/default priority remains valid.
    for (const [index, faultPoint] of faultPoints.entries()) {
      const faultCardId = createUuidV7();
      let failed = false;
      try {
        applyCardLifecycleMutation(
          getDb(),
          request(
            scope,
            `runtime:create-fault-${index}`,
            createOperation(faultCardId, `Fault ${index}`),
          ),
          {
            faultInjector: (point) => {
              if (point === faultPoint) throw new Error(`fault:${point}`);
            },
          },
        );
      } catch {
        failed = true;
      }
      invariant(
        failed &&
          getDb()
            .prepare("SELECT 1 FROM blocks WHERE id = ?")
            .get(faultCardId) === undefined &&
          getDb()
            .prepare("SELECT 1 FROM block_mutations WHERE mutation_id = ?")
            .get(`runtime:create-fault-${index}`) === undefined,
        `Pre-commit fault ${faultPoint} was not all-old`,
      );
    }

    const lostResponseCardId = createUuidV7();
    let lostResponse = false;
    try {
      applyCardLifecycleMutation(
        getDb(),
        request(
          scope,
          "runtime:create-lost-response",
          createOperation(lostResponseCardId, "Lost response"),
        ),
        {
          faultInjector: (point) => {
            if (point === "after_commit") throw new Error("lost response");
          },
        },
      );
    } catch {
      lostResponse = true;
    }
    closeDatabase();
    await initializeDatabase();
    const lostResponseRetry = applyCardLifecycleMutation(
      getDb(),
      request(
        scope,
        "runtime:create-lost-response",
        createOperation(lostResponseCardId, "Lost response"),
      ),
    );
    invariant(
      lostResponse && lostResponseRetry.ok && lostResponseRetry.value.duplicate,
      "Lost post-commit create did not replay after restart",
    );

    const epochMismatch = applyCardLifecycleMutation(
      getDb(),
      parseCardLifecycleMutationRequest({
        ...request(
          scope,
          "runtime:old-epoch",
          createOperation(createUuidV7(), "Old epoch"),
        ),
        storeEpoch: "restored-store-epoch",
      }),
    );
    invariant(
      !epochMismatch.ok && epochMismatch.error.code === "store_epoch_mismatch",
      "Old store epoch did not fail closed",
    );

    const quickCheck = getDb().pragma("quick_check", { simple: true });
    const foreignKeys = getDb().pragma("foreign_key_check") as unknown[];
    invariant(
      quickCheck === "ok" && foreignKeys.length === 0,
      "Lifecycle probe left SQLite integrity failures",
    );
    process.stdout.write(
      `${JSON.stringify({
        noCardsRow: true,
        exactRestartRetry: true,
        lifecycleContinuity: true,
        standalone: true,
        deleteEvidence: true,
        optionValidation: true,
        faultRollback: true,
        lostResponse: true,
        epochFence: true,
        integrity: true,
      })}\n`,
    );
  } finally {
    closeDatabase();
    fs.rmSync(directory, { recursive: true, force: true });
    delete process.env.NODEX_DIR;
  }
};

void main();
