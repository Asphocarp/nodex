import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { describe, expect, test } from "vitest";
import {
  DATABASE_MUTATION_CONTRACT_VERSION,
} from "../../shared/database-kernel";
import {
  CreateInputSchema,
  EditDatabaseInputSchema,
  type BlockId,
  type EditDatabaseInput,
  type QueryDatabaseInput,
} from "../../shared/nodex-agent-tools";
import { readBlockStoreEpoch } from "../local-store/block-store-metadata";
import { closeDatabase, getDb, initializeDatabase } from "../local-store/database";
import { applyDatabaseMutation } from "../local-store/database-kernel";
import { createProject } from "../local-store/projects";
import { executeNodexAgentCreate, prepareNodexAgentCreate } from "./create-service";
import {
  executeNodexAgentDatabaseEdit,
  prepareNodexAgentDatabaseEdit,
} from "./database-edit-service";
import { readNodexAgentTool } from "./read-service";

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
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "nodex-agent-database-"));
  process.env.NODEX_DIR = directory;
  try {
    await initializeDatabase();
    const project = createProject({ name: "Agent Database edit project" });
    await run({ database: getDb(), projectId: project.id });
  } finally {
    closeDatabase();
    fs.rmSync(directory, { recursive: true, force: true });
    if (previousDir === undefined) delete process.env.NODEX_DIR;
    else process.env.NODEX_DIR = previousDir;
  }
}

function databaseContext(fixture: Fixture) {
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

function createDatabaseCard(fixture: Fixture, callId: string, title: string): BlockId {
  const { database, view } = databaseContext(fixture);
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
      destination: {
        kind: "database",
        databaseBlockId: database.databaseBlockId,
        view: {
          viewId: view.viewId,
          groupKey: "draft",
        },
      },
    }),
  });
  if (!prepared.ok || prepared.value.kind !== "prepared") {
    throw new Error("Card create was not prepared");
  }
  const result = executeNodexAgentCreate(fixture.database, prepared.value.command);
  if (!result.ok) throw new Error(result.error.message);
  return result.value.output.data.resource.blockId;
}

function queryPrimaryView(
  fixture: Fixture,
  prepareFor?: QueryDatabaseInput["prepareFor"],
) {
  const { view } = databaseContext(fixture);
  const result = readNodexAgentTool(fixture.database, {
    tool: "query_database",
    projectId: fixture.projectId,
    input: {
      source: { kind: "view", viewId: view.viewId },
      ...(prepareFor ? { prepareFor } : {}),
    },
  });
  if (!result.ok || result.tool !== "query_database") throw new Error("Query failed");
  return result.output.data;
}

function prepare(
  fixture: Fixture,
  callId: string,
  input: EditDatabaseInput,
) {
  return prepareNodexAgentDatabaseEdit(fixture.database, {
    threadId: "thread-database-edit",
    callId,
    projectId: fixture.projectId,
    input,
  });
}

describe("Nodex Agent Database edit service", () => {
  sqliteTest("compare-and-sets a typed value and replays its durable receipt", async () => {
    await withFixture((fixture) => {
      const cardId = createDatabaseCard(fixture, "create-value", "Value Card");
      const query = queryPrimaryView(fixture);
      const status = query.database.properties.find((property) => property.name === "Status");
      if (!status) throw new Error("Status authority is unavailable");
      const guarded = queryPrimaryView(fixture, [{
        kind: "value.set",
        propertyIds: [status.propertyId],
      }]);
      const row = guarded.rows.find((candidate) => candidate.blockId === cardId);
      if (!status || !row) throw new Error("Status authority is unavailable");
      const observed = row.values[status.propertyId];
      if (!observed?.etag) throw new Error("Status value ETag is unavailable");
      const prepared = prepare(fixture, "set-status", EditDatabaseInputSchema.parse({
        databaseBlockId: query.database.databaseBlockId,
        edits: [{
          kind: "value.set",
          blockId: cardId,
          propertyId: status.propertyId,
          ifMatch: observed.etag,
          value: "in_progress",
        }],
        return: { etags: true },
      }));
      if (!prepared.ok || prepared.value.kind !== "prepared") {
        throw new Error(`Database edit was not prepared: ${JSON.stringify(prepared)}`);
      }
      const first = executeNodexAgentDatabaseEdit(
        fixture.database,
        prepared.value.command,
      );
      const replay = executeNodexAgentDatabaseEdit(
        fixture.database,
        prepared.value.command,
      );

      expect(first.ok ? first.value.output.data : null).toMatchObject({
        databaseBlockId: query.database.databaseBlockId,
        effects: { valuesSet: 1, setsChanged: 0, placementsChanged: 0 },
        etags: { values: [{ blockId: cardId, propertyId: status.propertyId }] },
      });
      expect(replay.ok ? replay.value.duplicate : null).toBe(true);
      const refreshed = queryPrimaryView(fixture);
      expect(refreshed.rows.find((candidate) => candidate.blockId === cardId)
        ?.values[status.propertyId]?.value).toBe("in_progress");

      const stale = prepare(fixture, "stale-status", EditDatabaseInputSchema.parse({
        databaseBlockId: query.database.databaseBlockId,
        edits: [{
          kind: "value.set",
          blockId: cardId,
          propertyId: status.propertyId,
          ifMatch: observed.etag,
          value: "done",
        }],
      }));
      expect(stale).toMatchObject({
        ok: false,
        error: { code: "conflict", recovery: "query_database_again" },
      });
    });
  });

  sqliteTest("updates grouped values and manual placement as one mutation", async () => {
    await withFixture((fixture) => {
      const first = createDatabaseCard(fixture, "create-first", "First");
      const second = createDatabaseCard(fixture, "create-second", "Second");
      const query = queryPrimaryView(fixture, [{ kind: "view.place" }]);
      const status = query.database.properties.find((property) => property.name === "Status");
      const firstRow = query.rows.find((row) => row.blockId === first);
      const secondRow = query.rows.find((row) => row.blockId === second);
      if (
        !query.view
        || !status
        || !firstRow?.placement?.etag
        || !secondRow?.placement?.etag
      ) {
        throw new Error("Grouped View authority is unavailable");
      }
      const prepared = prepare(fixture, "place-cards", EditDatabaseInputSchema.parse({
        databaseBlockId: query.database.databaseBlockId,
        edits: [{
          kind: "view.place",
          viewId: query.view.viewId,
          items: [
            { blockId: first, ifMatch: firstRow.placement.etag },
            { blockId: second, ifMatch: secondRow.placement.etag },
          ],
          groupKey: "in_progress",
          at: { kind: "end" },
        }],
        return: { etags: true },
      }));
      if (!prepared.ok || prepared.value.kind !== "prepared") {
        throw new Error(`Placement was not prepared: ${JSON.stringify(prepared)}`);
      }
      const result = executeNodexAgentDatabaseEdit(
        fixture.database,
        prepared.value.command,
      );

      expect(result.ok ? result.value.output.data : null).toMatchObject({
        effects: { valuesSet: 0, setsChanged: 0, placementsChanged: 2 },
        etags: { placements: expect.arrayContaining([
          expect.objectContaining({ blockId: first, viewId: query.view.viewId }),
          expect.objectContaining({ blockId: second, viewId: query.view.viewId }),
        ]) },
      });
      const refreshed = queryPrimaryView(fixture);
      for (const cardId of [first, second]) {
        const row = refreshed.rows.find((candidate) => candidate.blockId === cardId);
        expect(row?.placement?.groupKey).toBe("in_progress");
        expect(row?.values[status.propertyId]?.value).toBe("in_progress");
      }
    });
  });

  sqliteTest("applies revision-independent add/remove intent to a typed set", async () => {
    await withFixture((fixture) => {
      const cardId = createDatabaseCard(fixture, "create-tags", "Tagged");
      const before = queryPrimaryView(fixture);
      const tags = before.database.properties.find((property) => property.name === "Tags");
      if (!tags) throw new Error("Tags property is unavailable");
      const property = fixture.database.prepare(
        `
        SELECT key, name, schema_revision
        FROM database_properties
        WHERE id = ? AND database_block_id = ? AND project_id = ?
      `,
      ).get(
        tags.propertyId,
        before.database.databaseBlockId,
        fixture.projectId,
      ) as {
        readonly key: string;
        readonly name: string;
        readonly schema_revision: number;
      };
      const capability = fixture.database.prepare(
        "SELECT schema_revision FROM database_capabilities WHERE block_id = ?",
      ).get(before.database.databaseBlockId) as { readonly schema_revision: number };
      const storeEpoch = readBlockStoreEpoch(fixture.database);
      if (!storeEpoch) throw new Error("Fixture has no store epoch");
      const configured = applyDatabaseMutation(fixture.database, {
        version: DATABASE_MUTATION_CONTRACT_VERSION,
        operationId: "configure-tag-option",
        projectId: fixture.projectId,
        storeEpoch,
        actor: { kind: "test" },
        operations: [{
          kind: "put_property",
          databaseBlockId: before.database.databaseBlockId,
          propertyId: tags.propertyId,
          expectedDatabaseSchemaRevision: capability.schema_revision,
          expectedPropertyRevision: property.schema_revision,
          key: property.key,
          name: property.name,
          valueType: "multi_select",
          config: { options: [{ id: "agent", name: "Agent" }] },
        }],
      });
      if (!configured.ok) throw new Error(configured.error.message);
      const query = queryPrimaryView(fixture);
      const prepared = prepare(fixture, "add-tag", EditDatabaseInputSchema.parse({
        databaseBlockId: query.database.databaseBlockId,
        edits: [{
          kind: "value.add_remove",
          blockId: cardId,
          propertyId: tags.propertyId,
          add: ["agent"],
          remove: [],
        }],
      }));
      if (!prepared.ok || prepared.value.kind !== "prepared") {
        throw new Error(`Set intent was not prepared: ${JSON.stringify(prepared)}`);
      }
      const result = executeNodexAgentDatabaseEdit(
        fixture.database,
        prepared.value.command,
      );

      expect(result.ok ? result.value.output.data.effects : null).toEqual({
        valuesSet: 0,
        setsChanged: 1,
        placementsChanged: 0,
      });
      const refreshed = queryPrimaryView(fixture);
      expect(refreshed.rows.find((row) => row.blockId === cardId)
        ?.values[tags.propertyId]?.value).toEqual(["agent"]);
    });
  });
});
