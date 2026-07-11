import type Database from "better-sqlite3";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type {
  DatabaseMutationCommandResult,
  DatabaseMutationRequest,
} from "../src/shared/database-kernel";
import { compileDatabaseCardDragMany } from "../src/shared/database-card-drag-many";
import { commitDatabaseCardDragMany } from "../src/shared/database-card-drag-many-runtime";
import { createCard } from "../src/main/local-store/cards";
import {
  closeDatabase,
  getDb,
  initializeDatabase,
} from "../src/main/local-store/database";
import {
  applyDatabaseMutation,
  queryDatabaseViewSnapshot,
  readPrimaryDatabaseDescriptorSnapshot,
  type DatabaseMutationFaultPoint,
} from "../src/main/local-store/database-kernel";
import { createProject } from "../src/main/local-store/projects";

const invariant = (condition: boolean, message: string): void => {
  if (condition) return;
  throw new Error(message);
};

const readCompositeSnapshot = (
  database: Database.Database,
  projectId: string,
) => {
  const descriptor = readPrimaryDatabaseDescriptorSnapshot(database, projectId);
  invariant(
    descriptor.ok && descriptor.value.value !== null,
    "Primary Database descriptor unavailable",
  );
  if (!descriptor.ok || !descriptor.value.value) {
    throw new Error("Primary Database descriptor unavailable");
  }
  const view = descriptor.value.value.views.find(
    (candidate) => candidate.lifecycle === "active" && candidate.isPrimary,
  );
  invariant(view !== undefined, "Primary View unavailable");
  if (!view) throw new Error("Primary View unavailable");
  const query = queryDatabaseViewSnapshot(database, projectId, view.id);
  invariant(
    query.ok && query.value.value !== null,
    "Primary View query unavailable",
  );
  if (!query.ok || !query.value.value) {
    throw new Error("Primary View query unavailable");
  }
  invariant(
    descriptor.value.changeLogSeq === query.value.changeLogSeq,
    "Composite Database snapshot crossed a change cursor",
  );
  return { descriptor: descriptor.value, query: query.value };
};

const authorityDigest = (
  database: Database.Database,
  projectId: string,
): string => {
  const values = database
    .prepare(
      `
      SELECT membership.card_block_id, property.key, value.value_json, value.revision
      FROM database_property_values value
      INNER JOIN database_memberships membership ON membership.id = value.membership_id
      INNER JOIN database_properties property ON property.id = value.property_id
      WHERE membership.project_id = ? AND property.key IN ('status', 'priority')
      ORDER BY membership.card_block_id, property.key
    `,
    )
    .all(projectId);
  const positions = database
    .prepare(
      `
      SELECT view_id, block_id, group_key, rank_key, revision
      FROM database_view_positions
      WHERE project_id = ?
      ORDER BY view_id, group_key, rank_key, block_id
    `,
    )
    .all(projectId);
  const change = database
    .prepare(
      "SELECT COALESCE(MAX(seq), 0) AS seq FROM change_log WHERE project_id = ?",
    )
    .get(projectId);
  return JSON.stringify({ values, positions, change });
};

const compileRequest = (input: {
  readonly database: Database.Database;
  readonly projectId: string;
  readonly operationId: string;
  readonly cardIds: readonly string[];
  readonly fromStatus: "in_progress" | "done";
  readonly toStatus: "in_progress" | "done";
  readonly priority: "p1-high" | "p2-medium";
  readonly newOrder: number;
}): DatabaseMutationRequest => {
  const snapshot = readCompositeSnapshot(input.database, input.projectId);
  const compiled = compileDatabaseCardDragMany({
    move: {
      cardIds: [...input.cardIds],
      fromStatus: input.fromStatus,
      toStatus: input.toStatus,
      newOrder: input.newOrder,
      fieldPatch: { priority: input.priority },
    },
    snapshot,
  });
  return {
    version: 1,
    operationId: input.operationId,
    projectId: input.projectId,
    storeEpoch: snapshot.descriptor.storeEpoch,
    clientSessionId: "bulk-runtime-probe",
    actor: { kind: "bulk_runtime_probe" },
    operations: compiled.operations,
  };
};

const run = async (): Promise<void> => {
  closeDatabase();
  const directory = fs.mkdtempSync(
    path.join(os.tmpdir(), "nodex-database-bulk-runtime-"),
  );
  const previousDirectory = process.env.NODEX_DIR;
  process.env.NODEX_DIR = directory;
  try {
    await initializeDatabase();
    const project = createProject({ name: "Bulk Database runtime" });
    let database = getDb();
    const selected: string[] = [];
    for (let index = 0; index < 40; index += 1) {
      const card = await createCard(project.id, "in_progress", {
        title: `Selected ${index}`,
        priority: "p1-high",
      });
      selected.push(card.id);
    }
    const sourceAnchor = await createCard(project.id, "in_progress", {
      title: "Source anchor",
      priority: "p1-high",
    });
    const targetBefore = await createCard(project.id, "done", {
      title: "Target before",
      priority: "p3-low",
    });
    const targetAfter = await createCard(project.id, "done", {
      title: "Target after",
      priority: "p3-low",
    });
    const initialSnapshot = readCompositeSnapshot(database, project.id);
    const primaryViewId = initialSnapshot.query.value?.view.id;
    invariant(primaryViewId !== undefined, "Primary View ID unavailable");
    if (!primaryViewId) throw new Error("Primary View ID unavailable");

    // Force an exhausted gap so the authority, not the client, must rebalance.
    database
      .prepare(
        `
        UPDATE database_view_positions
        SET rank_key = CASE block_id
          WHEN ? THEN '00000000000000000000000000000001'
          WHEN ? THEN '00000000000000000000000000000002'
          ELSE rank_key
        END
        WHERE view_id = ? AND block_id IN (?, ?)
      `,
      )
      .run(
        targetBefore.id,
        targetAfter.id,
        primaryViewId,
        targetBefore.id,
        targetAfter.id,
      );

    const inputOrder = [...selected].reverse();
    const beforeSnapshot = readCompositeSnapshot(database, project.id);
    const beforeRows = new Map(
      beforeSnapshot.query.value?.rows.map((row) => [row.card.blockId, row]) ??
        [],
    );
    let snapshotReads = 0;
    let mutationCalls = 0;
    const requests: DatabaseMutationRequest[] = [];
    const recoveredReceipts: DatabaseMutationCommandResult[] = [];
    const committed = await commitDatabaseCardDragMany({
      projectId: project.id,
      operationId: "bulk-runtime-commit",
      move: {
        cardIds: inputOrder,
        fromStatus: "in_progress",
        toStatus: "done",
        newOrder: 1,
        fieldPatch: { priority: "p2-medium" },
      },
      dependencies: {
        readSnapshot: async () => {
          snapshotReads += 1;
          return readCompositeSnapshot(database, project.id);
        },
        mutate: async (_projectId, request) => {
          mutationCalls += 1;
          requests.push(request);
          if (mutationCalls === 1) {
            try {
              applyDatabaseMutation(database, request, {
                faultInjector: (point) => {
                  if (point === "after_commit") {
                    throw new Error("lost response after durable commit");
                  }
                },
              });
            } catch (error) {
              closeDatabase();
              await initializeDatabase();
              database = getDb();
              throw error;
            }
            throw new Error("Lost-response fault did not fire");
          }
          const receipt = applyDatabaseMutation(database, request);
          recoveredReceipts.push(receipt);
          return receipt;
        },
      },
    });
    invariant(committed, "Bulk runtime did not report success");
    invariant(snapshotReads === 1, "Bulk runtime read more than one snapshot");
    invariant(mutationCalls === 2, "Lost response did not retry exactly once");
    invariant(
      requests[0] === requests[1],
      "Lost-response retry did not reuse the exact compiled request",
    );
    invariant(
      requests[0]?.operations.length === 2 &&
        requests[0].operations[0]?.kind === "set_values" &&
        requests[0].operations[1]?.kind === "position_cards",
      "More than sixty-four logical writes were not compressed to two operations",
    );
    const recovered = recoveredReceipts.at(-1);
    invariant(
      recovered !== undefined && recovered.ok && recovered.value.duplicate,
      "Restarted writer did not replay the one durable receipt",
    );
    if (recovered === undefined || !recovered.ok) {
      throw new Error("Recovered receipt unavailable");
    }
    const operationResults = recovered.value.payload.operationResults as
      | readonly {
          readonly kind?: string;
          readonly payload?: { readonly rebalancedPositions?: number };
        }[]
      | undefined;
    invariant(
      (operationResults?.find((entry) => entry.kind === "position_cards")
        ?.payload?.rebalancedPositions ?? 0) > 0,
      "Exhausted target gap did not trigger a server-owned rebalance",
    );

    const afterSnapshot = readCompositeSnapshot(database, project.id);
    const afterRows = afterSnapshot.query.value?.rows ?? [];
    const doneOrder = afterRows
      .filter((row) => row.effectiveGroupKey === "done")
      .map((row) => row.card.blockId);
    invariant(
      doneOrder.join(",") ===
        [targetBefore.id, ...inputOrder, targetAfter.id].join(","),
      "Bulk planner did not preserve input order at the post-removal anchor",
    );
    const statusProperty = afterSnapshot.descriptor.value?.properties.find(
      (property) => property.key === "status",
    );
    const priorityProperty = afterSnapshot.descriptor.value?.properties.find(
      (property) => property.key === "priority",
    );
    invariant(
      statusProperty !== undefined && priorityProperty !== undefined,
      "Seeded Database properties unavailable",
    );
    if (!statusProperty || !priorityProperty) {
      throw new Error("Seeded Database properties unavailable");
    }
    for (const cardBlockId of inputOrder) {
      const before = beforeRows.get(cardBlockId);
      const after = afterRows.find(
        (row) => row.card.blockId === cardBlockId,
      );
      invariant(before !== undefined && after !== undefined, "Card row missing");
      if (!before || !after) throw new Error("Card row missing");
      invariant(
        after.values[statusProperty.id]?.value === "done" &&
          after.values[statusProperty.id]?.revision ===
            (before.values[statusProperty.id]?.revision ?? 0) + 1,
        `Status revision was not exact for ${cardBlockId}`,
      );
      invariant(
        after.values[priorityProperty.id]?.value === "p2-medium" &&
          after.values[priorityProperty.id]?.revision ===
            (before.values[priorityProperty.id]?.revision ?? 0) + 1,
        `Priority revision was not exact for ${cardBlockId}`,
      );
      invariant(
        after.position?.revision === (before.position?.revision ?? 0) + 1,
        `Position revision was not exact for ${cardBlockId}`,
      );
    }
    const committedRows = database
      .prepare(
        `
        SELECT COUNT(*) AS count
        FROM block_mutations
        WHERE mutation_id = 'bulk-runtime-commit' AND outcome = 'committed'
      `,
      )
      .get() as { readonly count: number };
    const committedChanges = database
      .prepare(
        `
        SELECT COUNT(*) AS count
        FROM change_log
        WHERE operation_id = 'bulk-runtime-commit'
      `,
      )
      .get() as { readonly count: number };
    invariant(
      committedRows.count === 1 && committedChanges.count === 1,
      "Bulk drag produced more than one ledger row or change receipt",
    );

    const rollbackRequest = compileRequest({
      database,
      projectId: project.id,
      operationId: "bulk-runtime-rollback-base",
      cardIds: inputOrder,
      fromStatus: "done",
      toStatus: "in_progress",
      priority: "p1-high",
      newOrder: 0,
    });
    const rollbackBaseline = authorityDigest(database, project.id);
    const faultPoints: readonly DatabaseMutationFaultPoint[] = [
      "bulk_after_validation",
      "bulk_after_values",
      "bulk_after_rank_plan",
      "bulk_after_positions",
    ];
    for (const point of faultPoints) {
      let threw = false;
      const request: DatabaseMutationRequest = {
        ...rollbackRequest,
        operationId: `bulk-runtime-${point}`,
      };
      try {
        applyDatabaseMutation(database, request, {
          faultInjector: (candidate) => {
            if (candidate === point) throw new Error(point);
          },
        });
      } catch {
        threw = true;
      }
      invariant(threw, `Fault ${point} did not fire`);
      invariant(
        authorityDigest(database, project.id) === rollbackBaseline,
        `Fault ${point} leaked partial authority`,
      );
      const ledger = database
        .prepare(
          "SELECT COUNT(*) AS count FROM block_mutations WHERE mutation_id = ?",
        )
        .get(request.operationId) as { readonly count: number };
      invariant(ledger.count === 0, `Fault ${point} leaked a ledger row`);
    }

    const values = rollbackRequest.operations[0];
    invariant(values?.kind === "set_values", "Rollback values unavailable");
    if (values?.kind !== "set_values") {
      throw new Error("Rollback values unavailable");
    }
    const staleRequest: DatabaseMutationRequest = {
      ...rollbackRequest,
      operationId: "bulk-runtime-stale-card",
      operations: [
        {
          ...values,
          entries: values.entries.map((entry, index) =>
            index === values.entries.length - 1
              ? {
                  ...entry,
                  expectedValueRevision: entry.expectedValueRevision + 1,
                }
              : entry,
          ),
        },
        ...rollbackRequest.operations.slice(1),
      ],
    };
    const stale = applyDatabaseMutation(database, staleRequest);
    invariant(
      !stale.ok && stale.error.code === "property_value_conflict",
      "One stale Card did not reject the whole bulk intent",
    );
    invariant(
      authorityDigest(database, project.id) === rollbackBaseline,
      "Stale bulk intent leaked partial authority",
    );
    invariant(
      database.pragma("quick_check", { simple: true }) === "ok",
      "SQLite quick_check failed",
    );
    invariant(
      (database.pragma("foreign_key_check") as unknown[]).length === 0,
      "SQLite foreign_key_check failed",
    );

    process.stdout.write(
      `${JSON.stringify({
        logicalWrites: 120,
        boundedOperations: 2,
        oneCompositeSnapshot: true,
        exactRetryAcrossRestart: true,
        oneReceipt: true,
        inputOrderPreserved: true,
        serverOwnedRebalance: true,
        exactRevisions: true,
        typedConflict: true,
        faultRollback: true,
      })}\n`,
    );
    invariant(sourceAnchor.id.length > 0, "Source anchor was not created");
  } finally {
    closeDatabase();
    fs.rmSync(directory, { recursive: true, force: true });
    if (previousDirectory === undefined) {
      delete process.env.NODEX_DIR;
    } else {
      process.env.NODEX_DIR = previousDirectory;
    }
  }
};

void run();
