import { describe, expect, test } from "vitest";
import Database from "better-sqlite3";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { parseCardLifecycleMutationRequest } from "../../shared/card-lifecycle";
import { createUuidV7 } from "../../shared/card-id";
import { applyCardLifecycleMutation } from "./card-block-lifecycle";
import {
  applyCardProjectTransfer,
  CardProjectTransferCompilationError,
  compileCardProjectTransferRequest,
} from "./card-project-transfer";
import { closeDatabase, getDb, initializeDatabase } from "./database";
import { createProject } from "./projects";

interface Fixture {
  readonly database: Database.Database;
  readonly sourceProjectId: string;
  readonly targetProjectId: string;
  readonly storeEpoch: string;
  readonly targetDatabaseBlockId: string;
  readonly targetViewId: string;
}

const supportsBetterSqlite = (() => {
  try {
    const database = new Database(":memory:");
    database.close();
    return true;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes("better-sqlite3") && message.includes("not yet supported")) {
      return false;
    }
    throw error;
  }
})();

const skipTest = (test as typeof test & { skip: typeof test }).skip;
const sqliteTest = supportsBetterSqlite ? test : skipTest;

const withFixture = async (
  run: (fixture: Fixture) => Promise<void> | void,
): Promise<void> => {
  closeDatabase();
  const previous = process.env.NODEX_DIR;
  const directory = fs.mkdtempSync(
    path.join(os.tmpdir(), "nodex-card-project-transfer-"),
  );
  process.env.NODEX_DIR = directory;
  try {
    await initializeDatabase();
    const source = createProject({ name: "Transfer source" });
    const target = createProject({ name: "Transfer target" });
    const database = getDb();
    const metadata = database
      .prepare("SELECT store_epoch FROM block_store_metadata WHERE id = 1")
      .get() as { readonly store_epoch: string };
    const targetDatabase = database
      .prepare(
        `SELECT block_id
         FROM database_capabilities
         WHERE project_id = ? AND is_primary = 1`,
      )
      .get(target.id) as { readonly block_id: string };
    const targetView = database
      .prepare(
        `SELECT id
         FROM database_views
         WHERE project_id = ? AND database_block_id = ?
           AND is_primary = 1 AND lifecycle = 'active'`,
      )
      .get(target.id, targetDatabase.block_id) as { readonly id: string };
    await run({
      database,
      sourceProjectId: source.id,
      targetProjectId: target.id,
      storeEpoch: metadata.store_epoch,
      targetDatabaseBlockId: targetDatabase.block_id,
      targetViewId: targetView.id,
    });
  } finally {
    closeDatabase();
    fs.rmSync(directory, { recursive: true, force: true });
    if (previous === undefined) delete process.env.NODEX_DIR;
    else process.env.NODEX_DIR = previous;
  }
};

const createAuthorityCard = (
  fixture: Fixture,
  cardId: string,
  operationId: string,
): { readonly documentId: string; readonly headSeq: number } => {
  const result = applyCardLifecycleMutation(
    fixture.database,
    parseCardLifecycleMutationRequest({
      version: 1,
      operationId,
      projectId: fixture.sourceProjectId,
      storeEpoch: fixture.storeEpoch,
      clientSessionId: "transfer-test",
      actor: { kind: "test" },
      operation: {
        kind: "create_card",
        cardId,
        title: "Transfer root",
        nfm: "Root body",
        status: "draft",
      },
    }),
  );
  if (!result.ok) throw new Error(result.error.message);
  return {
    documentId: result.value.documentId ?? `document:${cardId}`,
    headSeq: result.value.documentHeadSeq ?? 1,
  };
};

const compile = (
  fixture: Fixture,
  cardId: string,
  operationId: string,
) =>
  compileCardProjectTransferRequest(fixture.database, {
    operationId,
    sourceProjectId: fixture.sourceProjectId,
    targetProjectId: fixture.targetProjectId,
    cardId,
    targetDatabaseBlockId: fixture.targetDatabaseBlockId,
    targetViewId: fixture.targetViewId,
    targetStatus: "in_progress",
    clientSessionId: "transfer-test",
    actor: { kind: "test" },
  });

const readBlockProject = (fixture: Fixture, blockId: string): string =>
  (
    fixture.database
      .prepare("SELECT project_id FROM blocks WHERE id = ?")
      .get(blockId) as { readonly project_id: string }
  ).project_id;

describe("Card Project transfer authority kernel", () => {
  sqliteTest(
    "fails compilation when the target property schema cannot represent source values",
    async () => {
      await withFixture((fixture) => {
        const cardId = createUuidV7();
        createAuthorityCard(fixture, cardId, "create-incompatible-root");
        fixture.database
          .prepare(
            `UPDATE database_properties
             SET config_json = '{"options":[{"id":"draft","name":"Draft"}]}'
             WHERE database_block_id = ? AND project_id = ? AND key = 'status'`,
          )
          .run(fixture.targetDatabaseBlockId, fixture.targetProjectId);
        let error: unknown;
        try {
          compile(fixture, cardId, "transfer-incompatible");
        } catch (caught) {
          error = caught;
        }
        expect(error instanceof CardProjectTransferCompilationError).toBe(true);
        expect((error as CardProjectTransferCompilationError).code).toBe(
          "target_property_value_invalid",
        );
        expect(readBlockProject(fixture, cardId)).toBe(
          fixture.sourceProjectId,
        );
      });
    },
  );

  sqliteTest(
    "records a stale authority rejection once and replays it across audit sessions",
    async () => {
      await withFixture((fixture) => {
        const cardId = createUuidV7();
        createAuthorityCard(fixture, cardId, "create-stale-root");
        const request = compile(fixture, cardId, "transfer-stale");
        fixture.database
          .prepare(
            `UPDATE blocks
             SET metadata_revision = metadata_revision + 1
             WHERE id = ? AND project_id = ?`,
          )
          .run(cardId, fixture.sourceProjectId);
        const first = applyCardProjectTransfer(fixture.database, request);
        expect(first.ok).toBe(false);
        if (first.ok) throw new Error("Expected stale rejection");
        expect(first.error.code).toBe("block_authority_conflict");
        const retry = applyCardProjectTransfer(fixture.database, {
          ...request,
          clientSessionId: "another-session",
          actor: { kind: "another-transport" },
        });
        expect(retry.ok).toBe(false);
        if (retry.ok) throw new Error("Expected replayed stale rejection");
        expect(retry.error.code).toBe("block_authority_conflict");
        expect(
          (
            fixture.database
              .prepare(
                "SELECT COUNT(*) AS count FROM block_mutations WHERE mutation_id = ?",
              )
              .get(request.operationId) as { readonly count: number }
          ).count,
        ).toBe(1);
      });
    },
  );
});
