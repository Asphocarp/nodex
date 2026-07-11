import Database from "better-sqlite3";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { BlockMutationWriter } from "../src/main/block-mutation-writer";
import { createCard } from "../src/main/local-store/cards";
import { getDatabasePath } from "../src/main/local-store/config";
import {
  closeDatabase,
  getDb,
  initializeDatabase,
} from "../src/main/local-store/database";
import { createProject } from "../src/main/local-store/projects";
import type { BlockPropertyMutationRequest } from "../src/shared/block-property-mutations";
import type { BoardChangeEvent } from "../src/shared/ipc-api";

const invariant: (condition: unknown, message: string) => asserts condition = (
  condition,
  message,
) => {
  if (condition) return;
  throw new Error(message);
};

interface PropertyCoordinate {
  readonly id: string;
  readonly revision: number;
}

const run = async (): Promise<void> => {
  const previousNodexDir = process.env.NODEX_DIR;
  const tempDir = fs.mkdtempSync(
    path.join(os.tmpdir(), "nodex-property-worker-runtime-"),
  );
  process.env.NODEX_DIR = tempDir;
  let writer: BlockMutationWriter | undefined;
  try {
    await initializeDatabase();
    const project = createProject({ name: "Property worker" });
    const card = await createCard(project.id, "draft", {
      title: "Property worker Card",
    });
    const database = getDb();
    const storeEpoch = (
      database
        .prepare("SELECT store_epoch FROM block_store_metadata WHERE id = 1")
        .get() as { readonly store_epoch: string }
    ).store_epoch;
    const membership = database
      .prepare(
        `
        SELECT id, database_block_id
        FROM database_memberships
        WHERE card_block_id = ? AND project_id = ? AND removed_at IS NULL
      `,
      )
      .get(card.id, project.id) as {
      readonly id: string;
      readonly database_block_id: string;
    };
    const propertyCoordinates = Object.fromEntries(
      (
        database
          .prepare(
            `
            SELECT property.key, property.id, value.revision
            FROM database_properties property
            INNER JOIN database_property_values value
              ON value.membership_id = ?
              AND value.property_id = property.id
            WHERE property.database_block_id = ?
              AND property.project_id = ?
              AND property.lifecycle = 'active'
          `,
          )
          .all(membership.id, membership.database_block_id, project.id) as {
          readonly key: string;
          readonly id: string;
          readonly revision: number;
        }[]
      ).map((row) => [row.key, { id: row.id, revision: row.revision }]),
    ) as Readonly<Record<string, PropertyCoordinate>>;
    const agentStatusRevision = (
      database
        .prepare(
          `
          SELECT revision
          FROM block_properties
          WHERE block_id = ? AND project_id = ? AND property_key = 'agent.status'
        `,
        )
        .get(card.id, project.id) as { readonly revision: number }
    ).revision;
    closeDatabase();

    const events: BoardChangeEvent[] = [];
    const eventCount = (): number => events.length;
    writer = new BlockMutationWriter({
      publishBoardEvent: (event) => events.push(event),
    });
    const prepared = await writer.prepareOwnedBlockDocument(
      project.id,
      card.id,
    );
    invariant(
      prepared.ok && prepared.value.authority === "ydoc_primary",
      "Worker did not expose Card Document authority",
    );

    const priority = propertyCoordinates.priority;
    const status = propertyCoordinates.status;
    invariant(priority && status, "Primary Database properties are missing");
    const firstRequest: BlockPropertyMutationRequest = {
      version: 1,
      mutationId: "property-worker-first",
      projectId: project.id,
      storeEpoch,
      clientSessionId: "property-worker-session",
      actor: { kind: "runtime_probe" },
      fields: [
        {
          scope: "database",
          cardBlockId: card.id,
          databaseBlockId: membership.database_block_id,
          propertyId: priority.id,
          operation: "set",
          expectedRevision: priority.revision,
          value: "p0-critical",
        },
        {
          scope: "intrinsic",
          blockId: card.id,
          propertyKey: "agent.status",
          operation: "set",
          expectedRevision: agentStatusRevision,
          value: "running",
        },
      ],
    };
    const first = await writer.applyBlockPropertyMutation(firstRequest);
    invariant(
      first.result.ok && !first.result.value.duplicate,
      "Worker did not commit the first property batch",
    );
    invariant(
      eventCount() === 1 &&
        events[0]?.summary?.priority === "p0-critical" &&
        events[0]?.summary?.agentStatus === "running",
      "New property commit did not publish its authoritative Card summary",
    );

    const duplicate = await writer.applyBlockPropertyMutation(firstRequest);
    invariant(
      duplicate.result.ok &&
        duplicate.result.value.duplicate &&
        eventCount() === 1,
      "Exact property retry emitted a second semantic event",
    );

    const statusRequest: BlockPropertyMutationRequest = {
      version: 1,
      mutationId: "property-worker-status",
      projectId: project.id,
      storeEpoch,
      clientSessionId: "property-worker-session",
      actor: { kind: "runtime_probe" },
      fields: [
        {
          scope: "database",
          cardBlockId: card.id,
          databaseBlockId: membership.database_block_id,
          propertyId: status.id,
          operation: "set",
          expectedRevision: status.revision,
          value: "done",
        },
      ],
    };
    const moved = await writer.applyBlockPropertyMutation(statusRequest);
    invariant(
      moved.result.ok &&
        !moved.result.value.duplicate &&
        eventCount() === 2 &&
        events[1]?.summary?.status === "done",
      "Status property commit did not publish the new primary View group",
    );

    const stale = await writer.applyBlockPropertyMutation({
      ...firstRequest,
      mutationId: "property-worker-stale",
      fields: [
        {
          scope: "intrinsic",
          blockId: card.id,
          propertyKey: "agent.status",
          operation: "set",
          expectedRevision: agentStatusRevision,
          value: "blocked",
        },
      ],
    });
    invariant(
      !stale.result.ok &&
        stale.result.error.code === "property_conflict" &&
        eventCount() === 2,
      "Rejected property conflict escaped its typed envelope or emitted an event",
    );

    await writer.shutdown();
    writer = undefined;

    const persisted = new Database(getDatabasePath());
    persisted.pragma("foreign_keys = ON");
    try {
      const projection = persisted
        .prepare(
          `
          SELECT
            card.metadata_revision,
            schedule.source_metadata_revision,
            read_model.metadata_revision AS read_model_metadata_revision,
            read_model.database_values_json,
            read_model.intrinsic_properties_json,
            position.group_key
          FROM blocks card
          INNER JOIN scheduled_card_index schedule
            ON schedule.card_block_id = card.id
            AND schedule.project_id = card.project_id
          INNER JOIN card_read_model read_model
            ON read_model.card_block_id = card.id
            AND read_model.project_id = card.project_id
          INNER JOIN database_view_positions position
            ON position.block_id = card.id
            AND position.project_id = card.project_id
          INNER JOIN database_views view
            ON view.id = position.view_id
            AND view.project_id = position.project_id
            AND view.kind = 'kanban'
            AND view.is_primary = 1
          WHERE card.id = ? AND card.project_id = ?
        `,
        )
        .get(card.id, project.id) as {
        readonly metadata_revision: number;
        readonly source_metadata_revision: number;
        readonly read_model_metadata_revision: number;
        readonly database_values_json: string;
        readonly intrinsic_properties_json: string;
        readonly group_key: string;
      };
      const databaseValues = JSON.parse(
        projection.database_values_json,
      ) as Readonly<Record<string, unknown>>;
      const intrinsicValues = JSON.parse(
        projection.intrinsic_properties_json,
      ) as Readonly<Record<string, unknown>>;
      invariant(
        projection.metadata_revision === projection.source_metadata_revision &&
          projection.metadata_revision ===
            projection.read_model_metadata_revision &&
          projection.group_key === "done" &&
          databaseValues.priority === "p0-critical" &&
          databaseValues.status === "done" &&
          intrinsicValues["agent.status"] === "running",
        "Worker ACK preceded scheduler/read-model/View projection freshness",
      );
      const ledgerCount = (
        persisted
          .prepare(
            `
            SELECT COUNT(*) AS count
            FROM block_mutations
            WHERE mutation_id IN (
              'property-worker-first', 'property-worker-status',
              'property-worker-stale'
            )
          `,
          )
          .get() as { readonly count: number }
      ).count;
      invariant(
        ledgerCount === 3,
        "Worker did not preserve one immutable receipt per logical mutation",
      );
    } finally {
      persisted.close();
    }

    process.stdout.write(
      `${JSON.stringify({
        fifo: true,
        typedReceipt: true,
        authoritativeProjectionFence: true,
        boardFanoutOnce: true,
        statusViewFanout: true,
        rejectedNoFanout: true,
        restartInspection: true,
      })}\n`,
    );
  } finally {
    if (writer) await writer.shutdown().catch(() => undefined);
    closeDatabase();
    fs.rmSync(tempDir, { recursive: true, force: true });
    if (previousNodexDir === undefined) delete process.env.NODEX_DIR;
    else process.env.NODEX_DIR = previousNodexDir;
  }
};

void run().catch((error: unknown) => {
  process.stderr.write(
    `${error instanceof Error ? error.stack : String(error)}\n`,
  );
  process.exitCode = 1;
});
