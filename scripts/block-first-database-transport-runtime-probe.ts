import Database from "better-sqlite3";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Hono } from "hono";
import { CardMutationWriter } from "../src/main/card-mutation-writer";
import { registerDatabaseKernelHttpRoutes } from "../src/main/database-kernel-http";
import {
  DATABASE_MUTATION_IPC_CHANNEL,
  registerDatabaseKernelIpcHandlers,
} from "../src/main/database-kernel-ipc";
import { createCard } from "../src/main/local-store/cards";
import { getDatabasePath } from "../src/main/local-store/config";
import {
  closeDatabase,
  getDb,
  initializeDatabase,
} from "../src/main/local-store/database";
import { applyDatabaseMutation } from "../src/main/local-store/database-kernel";
import { createProject } from "../src/main/local-store/projects";
import type {
  DatabaseMutationOperation,
  DatabaseMutationRequest,
} from "../src/shared/database-kernel";
import type { BoardChangeEvent } from "../src/shared/ipc-api";

const invariant: (condition: unknown, message: string) => asserts condition = (
  condition,
  message,
) => {
  if (condition) return;
  throw new Error(message);
};

const request = (input: {
  readonly operationId: string;
  readonly projectId: string;
  readonly storeEpoch: string;
  readonly operations: readonly DatabaseMutationOperation[];
  readonly session?: string;
  readonly actor?: string;
}): DatabaseMutationRequest => ({
  version: 1,
  operationId: input.operationId,
  projectId: input.projectId,
  storeEpoch: input.storeEpoch,
  clientSessionId: input.session ?? "database-runtime-session",
  actor: { kind: input.actor ?? "runtime_probe" },
  operations: input.operations,
});

const run = async (): Promise<void> => {
  const previousNodexDir = process.env.NODEX_DIR;
  const directory = fs.mkdtempSync(
    path.join(os.tmpdir(), "nodex-database-transport-runtime-"),
  );
  process.env.NODEX_DIR = directory;
  let writer: CardMutationWriter | undefined;
  try {
    await initializeDatabase();
    const project = createProject({ name: "Database transport runtime" });
    const first = await createCard(project.id, "draft", { title: "First" });
    const second = await createCard(project.id, "draft", { title: "Second" });
    const standalone = await createCard(project.id, "draft", {
      title: "Standalone",
    });
    const database = getDb();
    const storeEpoch = (
      database
        .prepare("SELECT store_epoch FROM block_store_metadata WHERE id = 1")
        .get() as { readonly store_epoch: string }
    ).store_epoch;
    const primary = database
      .prepare(
        `
        SELECT capability.block_id AS database_block_id, view.id AS view_id,
               property.id AS status_property_id
        FROM database_capabilities capability
        INNER JOIN database_views view
          ON view.database_block_id = capability.block_id
         AND view.project_id = capability.project_id
         AND view.is_primary = 1
         AND view.lifecycle = 'active'
        INNER JOIN database_properties property
          ON property.database_block_id = capability.block_id
         AND property.project_id = capability.project_id
         AND property.key = 'status'
         AND property.lifecycle = 'active'
        WHERE capability.project_id = ? AND capability.is_primary = 1
      `,
      )
      .get(project.id) as {
      readonly database_block_id: string;
      readonly view_id: string;
      readonly status_property_id: string;
    };
    const coordinate = (cardBlockId: string) =>
      database
        .prepare(
          `
          SELECT value.revision AS value_revision,
                 position.revision AS position_revision
          FROM database_memberships membership
          INNER JOIN database_property_values value
            ON value.membership_id = membership.id
           AND value.property_id = ?
          INNER JOIN database_view_positions position
            ON position.view_id = ?
           AND position.block_id = membership.card_block_id
          WHERE membership.card_block_id = ?
            AND membership.project_id = ?
            AND membership.removed_at IS NULL
        `,
        )
        .get(
          primary.status_property_id,
          primary.view_id,
          cardBlockId,
          project.id,
        ) as {
        readonly value_revision: number;
        readonly position_revision: number;
      };
    const secondCoordinate = coordinate(second.id);
    const seedAnchor = applyDatabaseMutation(
      database,
      request({
        operationId: "database-runtime-seed-anchor",
        projectId: project.id,
        storeEpoch,
        operations: [
          {
            kind: "set_value",
            cardBlockId: second.id,
            databaseBlockId: primary.database_block_id,
            propertyId: primary.status_property_id,
            expectedValueRevision: secondCoordinate.value_revision,
            value: "done",
          },
        ],
      }),
    );
    invariant(seedAnchor.ok, "Could not seed the Board drag anchor");
    const standaloneMembership = database
      .prepare(
        `
        SELECT id, revision FROM database_memberships
        WHERE card_block_id = ? AND project_id = ? AND removed_at IS NULL
      `,
      )
      .get(standalone.id, project.id) as {
      readonly id: string;
      readonly revision: number;
    };
    const removeStandaloneMembership = applyDatabaseMutation(
      database,
      request({
        operationId: "database-runtime-zero-membership",
        projectId: project.id,
        storeEpoch,
        operations: [
          {
            kind: "transfer_membership",
            cardBlockId: standalone.id,
            expectedMembership: {
              membershipId: standaloneMembership.id,
              revision: standaloneMembership.revision,
            },
            target: null,
          },
        ],
      }),
    );
    invariant(
      removeStandaloneMembership.ok,
      "Could not create a zero-membership Card",
    );
    const firstCoordinate = coordinate(first.id);
    closeDatabase();

    const events: BoardChangeEvent[] = [];
    writer = new CardMutationWriter({
      publishBoardEvent: (event) => events.push(event),
    });
    const ipcHandlers = new Map<
      string,
      (event: unknown, projectId: string, value: unknown) => Promise<unknown>
    >();
    registerDatabaseKernelIpcHandlers({
      registerHandle: (channel, listener) => ipcHandlers.set(channel, listener),
      resolveTrustedIdentity: (event) =>
        event === "trusted-window"
          ? {
              clientSessionId: "trusted-electron-window",
              actor: {
                kind: "electron_renderer",
                clientId: "runtime-window-1",
              },
            }
          : null,
      applyMutation: async (input) =>
        (await writer!.applyDatabaseMutation(input)).result,
      readDescriptor: async (projectId, databaseBlockId) =>
        (await writer!.readDatabaseDescriptor(projectId, databaseBlockId))
          .result,
      queryView: async (projectId, viewId) =>
        (await writer!.queryDatabaseView(projectId, viewId)).result,
    });
    const http = new Hono();
    registerDatabaseKernelHttpRoutes(http, {
      applyMutation: async (input) =>
        (await writer!.applyDatabaseMutation(input)).result,
      readDescriptor: async (projectId, databaseBlockId) =>
        (await writer!.readDatabaseDescriptor(projectId, databaseBlockId))
          .result,
      queryView: async (projectId, viewId) =>
        (await writer!.queryDatabaseView(projectId, viewId)).result,
    });
    const boardDrag = request({
      operationId: "database-runtime-board-drag",
      projectId: project.id,
      storeEpoch,
      operations: [
        {
          kind: "set_value",
          cardBlockId: first.id,
          databaseBlockId: primary.database_block_id,
          propertyId: primary.status_property_id,
          expectedValueRevision: firstCoordinate.value_revision,
          value: "done",
        },
        {
          kind: "position_card",
          viewId: primary.view_id,
          cardBlockId: first.id,
          expectedPositionRevision: firstCoordinate.position_revision,
          groupKey: "done",
          beforeCardBlockId: second.id,
        },
      ],
    });
    const committed = (await ipcHandlers.get(DATABASE_MUTATION_IPC_CHANNEL)?.(
      "trusted-window",
      project.id,
      boardDrag,
    )) as Awaited<
      ReturnType<CardMutationWriter["applyDatabaseMutation"]>
    >["result"];
    invariant(
      committed.ok &&
        !committed.value.duplicate &&
        committed.value.operationKinds.join(",") === "set_value,position_card",
      "Writer did not commit the atomic Board drag",
    );
    invariant(
      events.length === 1 && events[0]?.summary?.status === "done",
      "First Board drag did not publish exactly one authoritative summary",
    );

    const retryRequest = {
      ...boardDrag,
      clientSessionId: "database-runtime-session-after-reconnect",
      actor: { kind: "nodex_cli_after_reconnect" },
    };
    const retryResponse = await http.request(
      `/api/projects/${encodeURIComponent(project.id)}/database-mutations`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(retryRequest),
      },
    );
    const duplicate = (await retryResponse.json()) as Awaited<
      ReturnType<CardMutationWriter["applyDatabaseMutation"]>
    >["result"];
    invariant(
      retryResponse.status === 200 &&
        duplicate.ok &&
        duplicate.value.duplicate &&
        events.length === 1,
      "Exact retry across a session switch duplicated the Board event",
    );

    const queried = await writer.queryDatabaseView(project.id, primary.view_id);
    invariant(
      queried.result.ok &&
        queried.result.value.value?.rows
          .filter((row) => row.effectiveGroupKey === "done")
          .map((row) => row.card.blockId)
          .join(",") === `${first.id},${second.id}`,
      "Writer View query did not observe the selected logical anchor",
    );
    invariant(
      queried.result.ok &&
        !queried.result.value.value?.rows.some(
          (row) => row.card.blockId === standalone.id,
        ),
      "A zero-membership Card leaked into the Database View query",
    );
    const described = await writer.readDatabaseDescriptor(
      project.id,
      primary.database_block_id,
    );
    invariant(
      described.result.ok &&
        described.result.value.storeEpoch === storeEpoch &&
        described.result.value.value?.database.blockId ===
          primary.database_block_id,
      "Writer descriptor read did not preserve the exact store head",
    );

    const stale = await writer.applyDatabaseMutation(
      request({
        operationId: "database-runtime-stale",
        projectId: project.id,
        storeEpoch,
        operations: boardDrag.operations,
      }),
    );
    invariant(
      !stale.result.ok &&
        stale.result.error.code === "property_value_conflict" &&
        events.length === 1,
      "Stale Board drag did not return a typed conflict",
    );

    const current = queried.result.ok
      ? queried.result.value.value?.rows.find(
          (row) => row.card.blockId === first.id,
        )
      : undefined;
    invariant(current?.position, "Committed position is missing");
    const rollback = await writer.applyDatabaseMutation(
      request({
        operationId: "database-runtime-rollback",
        projectId: project.id,
        storeEpoch,
        operations: [
          {
            kind: "set_value",
            cardBlockId: first.id,
            databaseBlockId: primary.database_block_id,
            propertyId: primary.status_property_id,
            expectedValueRevision: 2,
            value: "backlog",
          },
          {
            kind: "position_card",
            viewId: primary.view_id,
            cardBlockId: first.id,
            expectedPositionRevision: 0,
            groupKey: "backlog",
          },
        ],
      }),
    );
    invariant(
      !rollback.result.ok && rollback.result.error.code === "position_conflict",
      "Second-operation failure escaped its typed rollback boundary",
    );
    const afterRollback = await writer.queryDatabaseView(
      project.id,
      primary.view_id,
    );
    invariant(
      afterRollback.result.ok &&
        afterRollback.result.value.value?.rows.find(
          (row) => row.card.blockId === first.id,
        )?.effectiveGroupKey === "done" &&
        events.length === 1,
      "Failed batch leaked its first property write or emitted a Board event",
    );

    const wrongEpoch = await writer.applyDatabaseMutation({
      ...boardDrag,
      operationId: "database-runtime-wrong-epoch",
      storeEpoch: "restored-away-epoch",
    });
    invariant(
      !wrongEpoch.result.ok &&
        wrongEpoch.result.error.code === "store_epoch_mismatch",
      "Writer accepted an operation from another store epoch",
    );

    await writer.shutdown();
    writer = undefined;
    const persisted = new Database(getDatabasePath());
    try {
      const ledger = persisted
        .prepare(
          `
          SELECT COUNT(*) AS count, MAX(change_log_seq) AS change_log_seq,
                 MAX(actor_json) AS actor_json,
                 MAX(client_session_id) AS client_session_id,
                 (SELECT COUNT(*) FROM change_log
                  WHERE operation_id = 'database-runtime-board-drag') AS change_count
          FROM block_mutations
          WHERE mutation_id = 'database-runtime-board-drag'
            AND mutation_kind = 'database_operation'
            AND outcome = 'committed'
        `,
        )
        .get() as {
        readonly count: number;
        readonly change_log_seq: number;
        readonly actor_json: string;
        readonly client_session_id: string;
        readonly change_count: number;
      };
      invariant(
        ledger.count === 1 &&
          Number.isSafeInteger(ledger.change_log_seq) &&
          ledger.change_count === 1 &&
          ledger.client_session_id === "trusted-electron-window" &&
          (JSON.parse(ledger.actor_json) as { readonly kind?: string }).kind ===
            "electron_renderer",
        "Exact retry did not retain one canonical cursor and first trusted attribution",
      );
    } finally {
      persisted.close();
    }

    process.stdout.write(
      `${JSON.stringify({
        atomicBoardDrag: true,
        exactRetryAcrossSession: true,
        trustedAuditBinding: true,
        oneBoardNotification: true,
        typedConflict: true,
        rollback: true,
        descriptorAndQuery: true,
        zeroMembership: true,
        epochFence: true,
      })}\n`,
    );
  } finally {
    if (writer) await writer.shutdown().catch(() => undefined);
    closeDatabase();
    fs.rmSync(directory, { recursive: true, force: true });
    if (previousNodexDir === undefined) {
      delete process.env.NODEX_DIR;
    } else {
      process.env.NODEX_DIR = previousNodexDir;
    }
  }
};

void run().catch((error: unknown) => {
  process.stderr.write(
    `${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`,
  );
  process.exitCode = 1;
});
