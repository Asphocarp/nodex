import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { describe, expect, test } from "vitest";
import {
  CreateInputSchema,
  DuplicateCardV3InputSchema,
  MoveCardsV3InputSchema,
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
  executeNodexAgentDuplicateCard,
  executeNodexAgentMoveCards,
  executeNodexAgentTransfer,
  prepareNodexAgentDuplicateCard,
  prepareNodexAgentMoveCards,
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

function requireCardDocumentIdForTest(fixture: Fixture, cardId: BlockId): string {
  const row = fixture.database.prepare(
    "SELECT document_id FROM block_documents WHERE block_id = ?",
  ).get(cardId) as { readonly document_id: string } | undefined;
  if (row) return row.document_id;
  throw new Error(`Card ${cardId} has no owned Document`);
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
  sqliteTest("duplicates one complete Card with a Card-first result and exact replay", async () => {
    await withFixture((fixture) => {
      const parent = createCard(fixture, "duplicate-parent", "Parent");
      const source = createCard(fixture, "duplicate-source", "Source");
      const request = {
        threadId: "thread-v3",
        callId: "duplicate-card",
        projectId: fixture.projectId,
        input: DuplicateCardV3InputSchema.parse({
          cardId: source,
          destination: { kind: "card", cardId: parent },
          return: ["block_map", "etags"],
        }),
      };
      const prepared = prepareNodexAgentDuplicateCard(fixture.database, request);
      if (!prepared.ok || prepared.value.kind !== "prepared") {
        throw new Error(`Duplicate was not prepared: ${JSON.stringify(prepared)}`);
      }
      expect(prepared.value.authorization.roots).toEqual({
        [source]: { type: "card", transformation: "preserved" },
      });
      const executed = executeNodexAgentDuplicateCard(
        fixture.database,
        prepared.value.command,
      );
      if (!executed.ok) throw new Error(executed.error.message);
      expect(executed.value.output.data).toMatchObject({
        sourceCardId: source,
        cardId: expect.any(String),
        location: { kind: "card", cardId: parent },
        bodyBlocksCreated: 1,
        blockMap: expect.objectContaining({ [source]: expect.any(String) }),
        etags: {
          title: expect.stringMatching(/^nxe1\./u),
          body: expect.stringMatching(/^nxe1\./u),
        },
      });
      const copiedCardId = executed.value.output.data.cardId;
      expect(copiedCardId).not.toBe(source);
      const copied = fixture.database.prepare(
        `
        SELECT materialization.title, materialization.nfm
        FROM block_documents ownership
        INNER JOIN document_materializations materialization
          ON materialization.document_id = ownership.document_id
        WHERE ownership.block_id = ?
      `).get(copiedCardId);
      expect(copied).toEqual({ title: "Source", nfm: "Source body" });
      const replay = prepareNodexAgentDuplicateCard(fixture.database, request);
      expect(replay.ok && replay.value.kind === "completed"
        ? replay.value.output
        : null).toEqual(executed.value.output);
      const receipt = fixture.database.prepare(
        "SELECT tool FROM nodex_agent_call_receipts WHERE call_id = ?",
      ).get("duplicate-card") as { readonly tool: string };
      expect(receipt.tool).toBe("duplicate_card");
    });
  });

  sqliteTest("moves mixed-source Cards into one Card atomically in input order", async () => {
    await withFixture((fixture) => {
      const parent = createCard(fixture, "move-parent", "Parent");
      const spaceCard = createCard(fixture, "move-space", "From Space");
      const { database, view } = context(fixture);
      const databaseCard = createCard(fixture, "move-database", "From Database", {
        kind: "database",
        databaseBlockId: database.databaseBlockId,
        view: { viewId: view.viewId, groupKey: "draft" },
      });
      const request = {
        threadId: "thread-v3",
        callId: "move-mixed-cards",
        projectId: fixture.projectId,
        input: MoveCardsV3InputSchema.parse({
          cardIds: [databaseCard, spaceCard],
          destination: { kind: "card", cardId: parent },
        }),
      };
      const prepared = prepareNodexAgentMoveCards(fixture.database, request);
      if (!prepared.ok || prepared.value.kind !== "prepared") {
        throw new Error(`Move was not prepared: ${JSON.stringify(prepared)}`);
      }
      expect(prepared.value.authorization.roots).toEqual({
        [databaseCard]: { type: "card", transformation: "preserved" },
        [spaceCard]: { type: "card", transformation: "preserved" },
      });
      expect(prepared.value.command.leaseDocuments).toEqual([
        expect.objectContaining({
          documentId: requireCardDocumentIdForTest(fixture, parent),
        }),
      ]);

      const executed = executeNodexAgentMoveCards(
        fixture.database,
        prepared.value.command,
      );
      if (!executed.ok) throw new Error(executed.error.message);
      expect(executed.value.output.data).toEqual({
        cards: [
          { cardId: databaseCard, location: { kind: "card", cardId: parent } },
          { cardId: spaceCard, location: { kind: "card", cardId: parent } },
        ],
        moved: 2,
      });
      const nestedOrder = fixture.database.prepare(
        `
        SELECT block_id
        FROM document_block_index
        WHERE document_id = ? AND block_id IN (?, ?)
        ORDER BY ordinal, block_id
      `).all(
        requireCardDocumentIdForTest(fixture, parent),
        databaseCard,
        spaceCard,
      ) as readonly { readonly block_id: string }[];
      expect(nestedOrder.map((row) => row.block_id)).toEqual([databaseCard, spaceCard]);

      const replay = prepareNodexAgentMoveCards(fixture.database, request);
      expect(replay.ok && replay.value.kind === "completed"
        ? replay.value.output
        : null).toEqual(executed.value.output);
      const receipt = fixture.database.prepare(
        "SELECT tool FROM nodex_agent_call_receipts WHERE call_id = ?",
      ).get("move-mixed-cards") as { readonly tool: string };
      expect(receipt.tool).toBe("move_cards");
    });
  });

  sqliteTest("rolls back every Card when a later move loses freshness", async () => {
    await withFixture((fixture) => {
      const parent = createCard(fixture, "rollback-parent", "Parent");
      const first = createCard(fixture, "rollback-first", "First");
      const second = createCard(fixture, "rollback-second", "Second");
      const prepared = prepareNodexAgentMoveCards(fixture.database, {
        threadId: "thread-v3",
        callId: "move-rollback",
        projectId: fixture.projectId,
        input: MoveCardsV3InputSchema.parse({
          cardIds: [first, second],
          destination: { kind: "card", cardId: parent },
        }),
      });
      if (!prepared.ok || prepared.value.kind !== "prepared") {
        throw new Error(`Move was not prepared: ${JSON.stringify(prepared)}`);
      }
      const secondStep = prepared.value.command.transfers[1];
      if (!secondStep) throw new Error("Second move step is unavailable");
      const staleCommand = {
        ...prepared.value.command,
        transfers: [
          prepared.value.command.transfers[0],
          {
            ...secondStep,
            transfer: {
              ...secondStep.transfer,
              expectedLocationRevisions: {
                [second]: (secondStep.transfer.expectedLocationRevisions[second] ?? 0) + 1,
              },
            },
          },
        ],
      };

      const executed = executeNodexAgentMoveCards(fixture.database, staleCommand);
      expect(executed).toMatchObject({
        ok: false,
        error: { code: "conflict" },
      });
      expect(blockSnapshot(fixture, first).block.location).toEqual({ kind: "space" });
      expect(blockSnapshot(fixture, second).block.location).toEqual({ kind: "space" });
      const nested = fixture.database.prepare(
        "SELECT block_id FROM document_block_index WHERE block_id IN (?, ?)",
      ).all(first, second);
      expect(nested).toEqual([]);
    });
  });

  sqliteTest("repositions same-Database Cards without exposing property edits", async () => {
    await withFixture((fixture) => {
      const { database, view } = context(fixture);
      const first = createCard(fixture, "same-db-first", "First", {
        kind: "database",
        databaseBlockId: database.databaseBlockId,
        view: { viewId: view.viewId, groupKey: "draft" },
      });
      const second = createCard(fixture, "same-db-second", "Second", {
        kind: "database",
        databaseBlockId: database.databaseBlockId,
        view: { viewId: view.viewId, groupKey: "draft" },
      });
      const input = MoveCardsV3InputSchema.parse({
        cardIds: [second, first],
        destination: {
          kind: "database",
          databaseBlockId: database.databaseBlockId,
          view: { viewId: view.viewId, groupKey: "in_progress" },
        },
      });
      const prepared = prepareNodexAgentMoveCards(fixture.database, {
        threadId: "thread-v3",
        callId: "same-db-placement",
        projectId: fixture.projectId,
        input,
      });
      if (!prepared.ok || prepared.value.kind !== "prepared") {
        throw new Error(`Move was not prepared: ${JSON.stringify(prepared)}`);
      }
      expect(prepared.value.command.transfers).toEqual([]);
      const executed = executeNodexAgentMoveCards(
        fixture.database,
        prepared.value.command,
      );
      if (!executed.ok) throw new Error(executed.error.message);
      const positions = fixture.database.prepare(
        `
        SELECT block_id, group_key
        FROM database_view_positions
        WHERE view_id = ? AND block_id IN (?, ?)
        ORDER BY rank_key, block_id
      `).all(view.viewId, first, second) as readonly {
        readonly block_id: string;
        readonly group_key: string | null;
      }[];
      expect(positions).toEqual([
        { block_id: second, group_key: "in_progress" },
        { block_id: first, group_key: "in_progress" },
      ]);

      const rejected = prepareNodexAgentMoveCards(fixture.database, {
        threadId: "thread-v3",
        callId: "same-db-values",
        projectId: fixture.projectId,
        input: MoveCardsV3InputSchema.parse({
          cardIds: [first],
          destination: {
            kind: "database",
            databaseBlockId: database.databaseBlockId,
            values: [{ propertyId: "not-an-edit-endpoint", value: "Done" }],
            view: { viewId: view.viewId, groupKey: "in_progress" },
          },
        }),
      });
      expect(rejected).toMatchObject({
        ok: false,
        error: { code: "invalid_arguments" },
      });
    });
  });

  sqliteTest("reorders a Space Card with the general transfer intent", async () => {
    await withFixture((fixture) => {
      const first = createCard(fixture, "create-first", "First");
      const second = createCard(fixture, "create-second", "Second");
      const firstSnapshot = blockSnapshot(fixture, first);
      const prepared = prepare(fixture, "space-reorder", transferInput({
        mode: "move",
        blockIds: [first],
        from: firstSnapshot.block.location,
        destination: { kind: "space", at: { kind: "end" } },
      }));
      if (!prepared.ok || prepared.value.kind !== "prepared") {
        throw new Error(`Transfer was not prepared: ${JSON.stringify(prepared)}`);
      }
      expect(prepared.value.authorization).toEqual({
        roots: {
          [first]: { type: "card", transformation: "preserved" },
        },
        documentIds: [],
      });
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

  sqliteTest("preflights a Document Block promotion as authorization evidence", async () => {
    await withFixture((fixture) => {
      const host = createCard(fixture, "create-promotion-host", "Promotable");
      const hostSnapshot = blockSnapshot(fixture, host);
      if (!hostSnapshot.document) throw new Error("Host Document unavailable");
      const structural = readNodexAgentTool(fixture.database, {
        tool: "get_block",
        projectId: fixture.projectId,
        input: {
          blockId: host,
          include: { document: { format: "blocks" } },
        },
      });
      if (!structural.ok || structural.tool !== "get_block") {
        throw new Error("Structural Document read failed");
      }
      const body = structural.output.data.document?.body;
      if (!body || body.format !== "blocks" || !body.blocks[0]) {
        throw new Error("Promotable body Block unavailable");
      }
      const rootBlockId = body.blocks[0].blockId;
      const prepared = prepare(fixture, "document-promotion", transferInput({
        mode: "move",
        blockIds: [rootBlockId],
        from: {
          kind: "document",
          documentId: hostSnapshot.document.documentId,
        },
        destination: { kind: "space" },
      }));
      if (!prepared.ok || prepared.value.kind !== "prepared") {
        throw new Error(`Promotion was not prepared: ${JSON.stringify(prepared)}`);
      }

      expect(prepared.value.authorization).toEqual({
        roots: {
          [rootBlockId]: { type: "paragraph", transformation: "promote" },
        },
        documentIds: [hostSnapshot.document.documentId],
      });
      const executed = executeNodexAgentTransfer(fixture.database, prepared.value.command);
      expect(executed.ok ? executed.value.output.data.results[0] : null).toMatchObject({
        sourceBlockId: rootBlockId,
        resultBlockId: rootBlockId,
        location: { kind: "space" },
        transformation: "promoted",
      });
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
        blockIds: [nested],
        from: nestedSnapshot.block.location,
        destination: {
          kind: "document",
          documentId: hostSnapshot.document.documentId,
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
        view: { viewId: view.viewId, groupKey: "draft" },
      });
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
        blockIds: [source],
        destination: {
          kind: "database",
          databaseBlockId: database.databaseBlockId,
          values: [{ propertyId: status.propertyId, value: "in_progress" }],
          view: {
            viewId: view.viewId,
            groupKey: "in_progress",
          },
        },
        return: { blockMap: true },
      }));
      if (!prepared.ok || prepared.value.kind !== "prepared") {
        throw new Error(`Transfer was not prepared: ${JSON.stringify(prepared)}`);
      }
      const executed = executeNodexAgentTransfer(fixture.database, prepared.value.command);
      if (!executed.ok) throw new Error(executed.error.message);
      const output = executed.value.output.data;
      const copied = output.results[0]?.resultBlockId;
      expect(copied).not.toBe(source);
      expect(output.copiedBlockIds?.[source]).toBe(copied);
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
      });
      const position = fixture.database.prepare(
        "SELECT view_id FROM database_view_positions WHERE block_id = ?",
      ).get(source);
      expect(position).toBeUndefined();
      const prepared = prepare(fixture, "copy-unplaced", transferInput({
        mode: "copy",
        blockIds: [source],
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
        view: { viewId: view.viewId, groupKey: "draft" },
      });
      const result = prepare(fixture, "mixed", transferInput({
        mode: "move",
        blockIds: [space, databaseCard],
        from: { kind: "space" },
        destination: { kind: "space" },
      }));

      expect(result).toMatchObject({
        ok: false,
        error: { code: "mixed_transfer_sources" },
      });
    });
  });
});
