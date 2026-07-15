import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { describe, expect, test } from "vitest";
import { createUuidV7 } from "../../shared/card-id";
import { parseCardLifecycleMutationRequest } from "../../shared/card-lifecycle";
import {
  BlockIdSchema,
  CreateInputSchema,
  type BlockId,
  type CreateInput,
} from "../../shared/nodex-agent-tools";
import { applyCardLifecycleMutation } from "../local-store/card-block-lifecycle";
import { readBlockStoreEpoch } from "../local-store/block-store-metadata";
import { closeDatabase, getDb, initializeDatabase } from "../local-store/database";
import { createProject } from "../local-store/projects";
import { executeNodexAgentCreate, prepareNodexAgentCreate } from "./create-service";
import { readNodexAgentTool } from "./read-service";

interface Fixture {
  readonly database: Database.Database;
  readonly projectId: string;
  readonly storeEpoch: string;
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
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "nodex-agent-create-"));
  process.env.NODEX_DIR = directory;
  try {
    await initializeDatabase();
    const project = createProject({ name: "Agent create project" });
    const database = getDb();
    const storeEpoch = readBlockStoreEpoch(database);
    if (!storeEpoch) throw new Error("Fixture has no store epoch");
    await run({ database, projectId: project.id, storeEpoch });
  } finally {
    closeDatabase();
    fs.rmSync(directory, { recursive: true, force: true });
    if (previousDir === undefined) delete process.env.NODEX_DIR;
    else process.env.NODEX_DIR = previousDir;
  }
}

function createExistingCard(
  fixture: Fixture,
  input: { readonly title: string; readonly nfm: string },
): BlockId {
  const cardId = createUuidV7();
  const result = applyCardLifecycleMutation(
    fixture.database,
    parseCardLifecycleMutationRequest({
      version: 1,
      operationId: createUuidV7(),
      projectId: fixture.projectId,
      storeEpoch: fixture.storeEpoch,
      actor: { kind: "test" },
      operation: {
        kind: "create_card",
        cardId,
        title: input.title,
        nfm: input.nfm,
        status: "draft",
      },
    }),
  );
  if (!result.ok) throw new Error(result.error.message);
  return BlockIdSchema.parse(cardId);
}

function input(value: unknown): CreateInput {
  return CreateInputSchema.parse(value);
}

function prepare(fixture: Fixture, callId: string, value: CreateInput) {
  return prepareNodexAgentCreate(fixture.database, {
    threadId: "thread-1",
    callId,
    projectId: fixture.projectId,
    input: value,
  });
}

function readContext(fixture: Fixture) {
  const result = readNodexAgentTool(fixture.database, {
    tool: "get_context",
    projectId: fixture.projectId,
    access: { read: "allowed", write: "consent_required", domains: ["document"] },
    input: { include: { databases: true } },
  });
  if (!result.ok || result.tool !== "get_context") throw new Error("Context failed");
  const database = result.output.data.databases?.find((entry) => entry.isPrimary);
  const view = database?.views.find((entry) => entry.isPrimary);
  if (!database || !view) throw new Error("Primary Database fixture is unavailable");
  return { database, view };
}

describe("Nodex Agent create service", () => {
  sqliteTest("creates a complete rich-title Card with nested NFM directly in Space", async () => {
    await withFixture((fixture) => {
      const prepared = prepare(fixture, "space-create", input({
        resource: {
          kind: "card",
          title: {
            kind: "rich",
            richText: [{ type: "text", text: "Launch plan", styles: { bold: true } }],
          },
          body: {
            format: "nfm",
            content: "## Goal\nShip safely\n- [ ] Verify\n\t- Keep rollback",
          },
        },
        destination: { kind: "space", at: { kind: "end" } },
      }));
      expect(prepared.ok).toBe(true);
      if (!prepared.ok || prepared.value.kind !== "prepared") return;
      const executed = executeNodexAgentCreate(fixture.database, prepared.value.command);

      expect(executed.ok ? executed.value.output.data : null).toMatchObject({
        resource: {
          kind: "card",
          blockId: prepared.value.command.cardId,
          documentId: `document:${prepared.value.command.cardId}`,
          createdBodyBlockIds: prepared.value.createdBodyBlockIds,
        },
        receipt: { duplicate: false },
      });
      const row = fixture.database.prepare(
        `
        SELECT block.location_kind, materialization.title,
          materialization.title_rich_json, materialization.nfm
        FROM blocks block
        INNER JOIN block_documents ownership ON ownership.block_id = block.id
        INNER JOIN document_materializations materialization
          ON materialization.document_id = ownership.document_id
        WHERE block.id = ?
      `,
      ).get(prepared.value.command.cardId) as {
        readonly location_kind: string;
        readonly title: string;
        readonly title_rich_json: string;
        readonly nfm: string;
      };
      expect(row).toMatchObject({
        location_kind: "space",
        title: "Launch plan",
        nfm: "## Goal\nShip safely\n- [ ] Verify\n\t- Keep rollback",
      });
      expect(JSON.parse(row.title_rich_json)).toEqual([
        { type: "text", text: "Launch plan", styles: { bold: true } },
      ]);
    });
  });

  sqliteTest("creates a Card shell at an exact target Document anchor", async () => {
    await withFixture((fixture) => {
      const hostId = createExistingCard(fixture, { title: "Host", nfm: "Before\nAfter" });
      const host = readNodexAgentTool(fixture.database, {
        tool: "get_block",
        projectId: fixture.projectId,
        input: { blockId: hostId, include: { document: { format: "blocks" } } },
      });
      if (!host.ok || host.tool !== "get_block" || !host.output.data.document) {
        throw new Error("Host read failed");
      }
      const body = host.output.data.document.body;
      if (body.format !== "blocks") throw new Error("Host Blocks unavailable");
      const afterId = body.blocks[1]?.blockId;
      if (!afterId) throw new Error("Host anchor unavailable");
      const prepared = prepare(fixture, "document-create", input({
        resource: {
          kind: "card",
          title: { kind: "plain", text: "Nested Card" },
          body: { format: "nfm", content: "Nested body" },
        },
        destination: {
          kind: "document",
          documentId: host.output.data.document.documentId,
          ifRevision: host.output.data.document.revision,
          at: { kind: "before", blockId: afterId },
        },
      }));
      if (!prepared.ok || prepared.value.kind !== "prepared") {
        throw new Error("Create was not prepared");
      }
      const executed = executeNodexAgentCreate(fixture.database, prepared.value.command);
      expect(executed.ok).toBe(true);
      const location = fixture.database.prepare(
        "SELECT location_kind, containing_document_id FROM blocks WHERE id = ?",
      ).get(prepared.value.command.cardId);
      expect(location).toEqual({
        location_kind: "document",
        containing_document_id: host.output.data.document.documentId,
      });
      const target = fixture.database.prepare(
        "SELECT nfm FROM document_materializations WHERE document_id = ?",
      ).get(host.output.data.document.documentId) as { readonly nfm: string };
      expect(target.nfm).toBe(
        `Before\n<card uuid="${prepared.value.command.cardId}" />\nAfter`,
      );
    });
  });

  sqliteTest("creates Database values and grouped View placement in the same aggregate", async () => {
    await withFixture((fixture) => {
      const { database, view } = readContext(fixture);
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
      const prepared = prepare(fixture, "database-create", input({
        resource: {
          kind: "card",
          title: { kind: "plain", text: "Database Card" },
          body: { format: "nfm", content: "Full body" },
        },
        destination: {
          kind: "database",
          databaseBlockId: database.databaseBlockId,
          ifSchemaRevision: database.schemaRevision,
          values: [{ propertyId: status.propertyId, value: "in_progress" }],
          view: {
            viewId: view.viewId,
            ifRevision: view.revision,
            groupKey: "in_progress",
            at: { kind: "end" },
          },
        },
      }));
      if (!prepared.ok || prepared.value.kind !== "prepared") {
        throw new Error(`Create was not prepared: ${JSON.stringify(prepared)}`);
      }
      const executed = executeNodexAgentCreate(fixture.database, prepared.value.command);

      expect(executed.ok ? executed.value.output.data : null).toMatchObject({
        database: {
          databaseBlockId: database.databaseBlockId,
          valueRevisions: { [status.propertyId]: expect.stringMatching(/^nxt1\./) },
          placementRevision: expect.stringMatching(/^nxt1\./),
        },
      });
      const row = fixture.database.prepare(
        `
        SELECT value.value_json, position.group_key
        FROM database_memberships membership
        INNER JOIN database_property_values value
          ON value.membership_id = membership.id AND value.property_id = ?
        INNER JOIN database_view_positions position
          ON position.block_id = membership.card_block_id AND position.view_id = ?
        WHERE membership.card_block_id = ? AND membership.removed_at IS NULL
      `,
      ).get(status.propertyId, view.viewId, prepared.value.command.cardId);
      expect(row).toEqual({ value_json: '"in_progress"', group_key: "in_progress" });
    });
  });

  sqliteTest("supports membership without a manual View position and exact replay", async () => {
    await withFixture((fixture) => {
      const { database } = readContext(fixture);
      const createInput = input({
        resource: { kind: "card", title: { kind: "plain", text: "No position" } },
        destination: {
          kind: "database",
          databaseBlockId: database.databaseBlockId,
          ifSchemaRevision: database.schemaRevision,
        },
      });
      const prepared = prepare(fixture, "membership-only", createInput);
      if (!prepared.ok || prepared.value.kind !== "prepared") {
        throw new Error("Create was not prepared");
      }
      const first = executeNodexAgentCreate(fixture.database, prepared.value.command);
      const replay = prepare(fixture, "membership-only", createInput);

      expect(first.ok ? first.value.output.data.database : null).toEqual({
        databaseBlockId: database.databaseBlockId,
        valueRevisions: {},
      });
      expect(replay.ok && replay.value.kind === "completed"
        ? replay.value.output.data.receipt
        : null).toEqual({ duplicate: true });
      const positionCount = fixture.database.prepare(
        "SELECT COUNT(*) AS count FROM database_view_positions WHERE block_id = ?",
      ).get(prepared.value.command.cardId) as { readonly count: number };
      expect(positionCount.count).toBe(0);
    });
  });

  sqliteTest("rolls back every authority table when a late aggregate seam fails", async () => {
    await withFixture((fixture) => {
      const prepared = prepare(fixture, "rollback", input({
        resource: {
          kind: "card",
          title: { kind: "plain", text: "Rollback" },
          body: { format: "nfm", content: "Never durable" },
        },
        destination: { kind: "space" },
      }));
      if (!prepared.ok || prepared.value.kind !== "prepared") {
        throw new Error("Create was not prepared");
      }
      const result = executeNodexAgentCreate(
        fixture.database,
        prepared.value.command,
        { faultInjector: (point) => {
          if (point === "before_receipt") throw new Error("injected late failure");
        } },
      );

      expect(result).toMatchObject({ ok: false, error: { code: "internal_error" } });
      expect(fixture.database.prepare(
        "SELECT 1 FROM blocks WHERE id = ?",
      ).get(prepared.value.command.cardId)).toBeUndefined();
      expect(fixture.database.prepare(
        "SELECT COUNT(*) AS count FROM block_mutations WHERE mutation_id LIKE ?",
      ).get(`${prepared.value.command.mutationId}:%`)).toEqual({ count: 0 });
      expect(fixture.database.prepare(
        "SELECT status FROM nodex_agent_call_receipts WHERE mutation_id = ?",
      ).get(prepared.value.command.mutationId)).toEqual({ status: "prepared" });
    });
  });
});
