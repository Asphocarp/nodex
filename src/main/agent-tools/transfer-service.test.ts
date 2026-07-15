import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { describe, expect, test } from "vitest";
import {
  CreateInputSchema,
  TransferBlocksInputSchema,
  type BlockId,
  type TransferBlocksInput,
} from "../../shared/nodex-agent-tools";
import { readBlockStoreEpoch } from "../local-store/block-store-metadata";
import { closeDatabase, getDb, initializeDatabase } from "../local-store/database";
import { createProject } from "../local-store/projects";
import { executeNodexAgentCreate, prepareNodexAgentCreate } from "./create-service";
import { readNodexAgentTool } from "./read-service";
import {
  executeNodexAgentTransfer,
  prepareNodexAgentTransfer,
} from "./transfer-service";

interface Fixture {
  readonly database: Database.Database;
  readonly projectId: string;
}

const supportsBetterSqlite = (() => {
  try {
    const database = new Database(":memory:");
    database.close();
    return true;
  } catch {
    return false;
  }
})();
const sqliteTest = supportsBetterSqlite ? test : test.skip;

async function withFixture(
  run: (fixture: Fixture) => void | Promise<void>,
): Promise<void> {
  closeDatabase();
  const previousDir = process.env.NODEX_DIR;
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "nodex-agent-transfer-"));
  process.env.NODEX_DIR = directory;
  try {
    await initializeDatabase();
    const project = createProject({ name: "Agent transfer project" });
    const database = getDb();
    if (!readBlockStoreEpoch(database)) throw new Error("Fixture has no store epoch");
    await run({ database, projectId: project.id });
  } finally {
    closeDatabase();
    fs.rmSync(directory, { recursive: true, force: true });
    if (previousDir === undefined) delete process.env.NODEX_DIR;
    else process.env.NODEX_DIR = previousDir;
  }
}

function createCard(
  fixture: Fixture,
  callId: string,
  title: string,
  destination: unknown = { kind: "space" },
): BlockId {
  const prepared = prepareNodexAgentCreate(fixture.database, {
    threadId: "thread-create",
    callId,
    projectId: fixture.projectId,
    input: CreateInputSchema.parse({
      resource: {
        kind: "card",
        title: { kind: "plain", text: title },
        body: { format: "nfm", content: `${title} body` },
      },
      destination,
    }),
  });
  if (!prepared.ok || prepared.value.kind !== "prepared") {
    throw new Error("Card create was not prepared");
  }
  const result = executeNodexAgentCreate(fixture.database, prepared.value.command);
  if (!result.ok) throw new Error(result.error.message);
  return result.value.output.data.resource.blockId;
}

function blockSnapshot(fixture: Fixture, blockId: BlockId) {
  const result = readNodexAgentTool(fixture.database, {
    tool: "get_block",
    projectId: fixture.projectId,
    input: { blockId },
  });
  if (!result.ok || result.tool !== "get_block") throw new Error("Block read failed");
  return result.output.data;
}

function transferInput(value: unknown): TransferBlocksInput {
  return TransferBlocksInputSchema.parse(value);
}

function prepare(
  fixture: Fixture,
  callId: string,
  input: TransferBlocksInput,
) {
  return prepareNodexAgentTransfer(fixture.database, {
    threadId: "thread-transfer",
    callId,
    projectId: fixture.projectId,
    input,
  });
}

function context(fixture: Fixture) {
  const result = readNodexAgentTool(fixture.database, {
    tool: "get_context",
    projectId: fixture.projectId,
    access: { read: "allowed", write: "consent_required", domains: [] },
    input: { include: { databases: true } },
  });
  if (!result.ok || result.tool !== "get_context") throw new Error("Context failed");
  const database = result.output.data.databases?.find((entry) => entry.isPrimary);
  const view = database?.views.find((entry) => entry.isPrimary);
  if (!database || !view) throw new Error("Primary Database is unavailable");
  return { database, view };
}

describe("Nodex Agent transfer service", () => {
  sqliteTest("reorders a Space Card with the general transfer intent", async () => {
    await withFixture((fixture) => {
      const first = createCard(fixture, "create-first", "First");
      const second = createCard(fixture, "create-second", "Second");
      const firstSnapshot = blockSnapshot(fixture, first);
      const prepared = prepare(fixture, "space-reorder", transferInput({
        mode: "move",
        items: [{ blockId: first, ifLocationRevision: firstSnapshot.block.locationRevision }],
        destination: { kind: "space", at: { kind: "end" } },
      }));
      if (!prepared.ok || prepared.value.kind !== "prepared") {
        throw new Error(`Transfer was not prepared: ${JSON.stringify(prepared)}`);
      }
      const executed = executeNodexAgentTransfer(fixture.database, prepared.value.command);

      expect(executed.ok ? executed.value.output.data.results : null).toMatchObject([{
        sourceBlockId: first,
        resultBlockId: first,
        location: { kind: "space" },
        transformation: "preserved",
      }]);
      const order = fixture.database.prepare(
        "SELECT block_id FROM top_level_block_placements ORDER BY rank_key, block_id",
      ).all() as readonly { readonly block_id: string }[];
      expect(order.slice(-2).map((row) => row.block_id)).toEqual([second, first]);
    });
  });

  sqliteTest("moves a Space Card into an exact target Document", async () => {
    await withFixture((fixture) => {
      const host = createCard(fixture, "create-host", "Host");
      const nested = createCard(fixture, "create-nested", "Nested");
      const hostSnapshot = blockSnapshot(fixture, host);
      const nestedSnapshot = blockSnapshot(fixture, nested);
      if (!hostSnapshot.document) throw new Error("Host Document unavailable");
      const prepared = prepare(fixture, "document-move", transferInput({
        mode: "move",
        items: [{ blockId: nested, ifLocationRevision: nestedSnapshot.block.locationRevision }],
        destination: {
          kind: "document",
          documentId: hostSnapshot.document.documentId,
          ifRevision: hostSnapshot.document.revision,
          at: { kind: "end" },
        },
      }));
      if (!prepared.ok || prepared.value.kind !== "prepared") {
        throw new Error("Transfer was not prepared");
      }
      expect(prepared.value.leaseDocuments).toEqual([expect.objectContaining({
        documentId: hostSnapshot.document.documentId,
      })]);
      const executed = executeNodexAgentTransfer(fixture.database, prepared.value.command);

      expect(executed.ok ? executed.value.output.data.results[0] : null).toMatchObject({
        sourceBlockId: nested,
        resultBlockId: nested,
        location: { kind: "document", documentId: hostSnapshot.document.documentId },
      });
    });
  });

  sqliteTest("copies a Database Card and applies destination values atomically", async () => {
    await withFixture((fixture) => {
      const { database, view } = context(fixture);
      const source = createCard(fixture, "create-db-source", "Source", {
        kind: "database",
        databaseBlockId: database.databaseBlockId,
        ifSchemaRevision: database.schemaRevision,
        view: { viewId: view.viewId, ifRevision: view.revision, groupKey: "draft" },
      });
      const sourceSnapshot = blockSnapshot(fixture, source);
      const query = readNodexAgentTool(fixture.database, {
        tool: "query_database",
        projectId: fixture.projectId,
        input: { source: { kind: "view", viewId: view.viewId } },
      });
      if (!query.ok || query.tool !== "query_database") throw new Error("Query failed");
      const status = query.output.data.database.properties.find(
        (property) => property.name === "Status",
      );
      if (!status) throw new Error("Status property unavailable");
      const prepared = prepare(fixture, "database-copy", transferInput({
        mode: "copy",
        items: [{ blockId: source, ifLocationRevision: sourceSnapshot.block.locationRevision }],
        destination: {
          kind: "database",
          databaseBlockId: database.databaseBlockId,
          ifSchemaRevision: database.schemaRevision,
          values: [{ propertyId: status.propertyId, value: "in_progress" }],
          view: {
            viewId: view.viewId,
            ifRevision: view.revision,
            groupKey: "in_progress",
          },
        },
      }));
      if (!prepared.ok || prepared.value.kind !== "prepared") {
        throw new Error(`Transfer was not prepared: ${JSON.stringify(prepared)}`);
      }
      const executed = executeNodexAgentTransfer(fixture.database, prepared.value.command);
      if (!executed.ok) throw new Error(executed.error.message);
      const output = executed.value.output.data;
      const copied = output.results[0]?.resultBlockId;
      expect(copied).not.toBe(source);
      expect(output.copiedBlockIds[source]).toBe(copied);
      const value = fixture.database.prepare(
        `
        SELECT property_value.value_json
        FROM database_memberships membership
        INNER JOIN database_property_values property_value
          ON property_value.membership_id = membership.id
        WHERE membership.card_block_id = ? AND property_value.property_id = ?
          AND membership.removed_at IS NULL
      `,
      ).get(copied, status.propertyId);
      expect(value).toEqual({ value_json: '"in_progress"' });
    });
  });

  sqliteTest("copies a Database Card that intentionally has no View placement", async () => {
    await withFixture((fixture) => {
      const { database } = context(fixture);
      const source = createCard(fixture, "create-unplaced", "Unplaced", {
        kind: "database",
        databaseBlockId: database.databaseBlockId,
        ifSchemaRevision: database.schemaRevision,
      });
      const sourceSnapshot = blockSnapshot(fixture, source);
      const position = fixture.database.prepare(
        "SELECT view_id FROM database_view_positions WHERE block_id = ?",
      ).get(source);
      expect(position).toBeUndefined();
      const prepared = prepare(fixture, "copy-unplaced", transferInput({
        mode: "copy",
        items: [{ blockId: source, ifLocationRevision: sourceSnapshot.block.locationRevision }],
        destination: { kind: "space" },
      }));
      if (!prepared.ok || prepared.value.kind !== "prepared") {
        throw new Error(`Transfer was not prepared: ${JSON.stringify(prepared)}`);
      }
      const executed = executeNodexAgentTransfer(fixture.database, prepared.value.command);

      expect(executed.ok ? executed.value.output.data.results[0] : null)
        .toMatchObject({
          sourceBlockId: source,
          location: { kind: "space" },
          transformation: "preserved",
        });
    });
  });

  sqliteTest("rejects roots from mixed source containers before mutation", async () => {
    await withFixture((fixture) => {
      const space = createCard(fixture, "create-space", "Space");
      const { database, view } = context(fixture);
      const databaseCard = createCard(fixture, "create-database", "Database", {
        kind: "database",
        databaseBlockId: database.databaseBlockId,
        ifSchemaRevision: database.schemaRevision,
        view: { viewId: view.viewId, ifRevision: view.revision, groupKey: "draft" },
      });
      const spaceSnapshot = blockSnapshot(fixture, space);
      const databaseSnapshot = blockSnapshot(fixture, databaseCard);
      const result = prepare(fixture, "mixed", transferInput({
        mode: "move",
        items: [
          { blockId: space, ifLocationRevision: spaceSnapshot.block.locationRevision },
          {
            blockId: databaseCard,
            ifLocationRevision: databaseSnapshot.block.locationRevision,
          },
        ],
        destination: { kind: "space" },
      }));

      expect(result).toMatchObject({
        ok: false,
        error: { code: "mixed_transfer_sources" },
      });
    });
  });
});
