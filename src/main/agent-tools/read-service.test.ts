import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { describe, expect, test } from "vitest";
import { createUuidV7 } from "../../shared/card-id";
import { parseCardLifecycleMutationRequest } from "../../shared/card-lifecycle";
import {
  BlockIdSchema,
  type BlockId,
  type NodexAgentReadRequest,
  type NodexAgentV3ReadRequest,
} from "../../shared/nodex-agent-tools";
import { applyCardLifecycleMutation } from "../local-store/card-block-lifecycle";
import { readBlockStoreEpoch } from "../local-store/block-store-metadata";
import { closeDatabase, getDb, initializeDatabase } from "../local-store/database";
import { createProject } from "../local-store/projects";
import { readNodexAgentTool } from "./read-service";
import { readNodexAgentV3Tool } from "./read-v3";

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

async function withFixture(run: (fixture: Fixture) => void | Promise<void>): Promise<void> {
  closeDatabase();
  const previousDir = process.env.NODEX_DIR;
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "nodex-agent-reads-"));
  process.env.NODEX_DIR = directory;
  try {
    await initializeDatabase();
    const project = createProject({ name: "Agent read project" });
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

function createCard(
  fixture: Fixture,
  input: { readonly title: string; readonly nfm: string },
): BlockId {
  const cardId = createUuidV7();
  const request = parseCardLifecycleMutationRequest({
    version: 1,
    operationId: createUuidV7(),
    projectId: fixture.projectId,
    storeEpoch: fixture.storeEpoch,
    clientSessionId: "agent-read-test",
    actor: { kind: "test" },
    operation: {
      kind: "create_card",
      cardId,
      title: input.title,
      nfm: input.nfm,
      status: "draft",
    },
  });
  const result = applyCardLifecycleMutation(fixture.database, request);
  if (!result.ok) throw new Error(result.error.message);
  return BlockIdSchema.parse(cardId);
}

function read(fixture: Fixture, request: NodexAgentReadRequest) {
  return readNodexAgentTool(fixture.database, request);
}

function readV3(fixture: Fixture, request: NodexAgentV3ReadRequest) {
  return readNodexAgentV3Tool(fixture.database, request);
}

describe("Nodex Agent read service", () => {
  sqliteTest("adapts v3 context, search, fetch, and split queries in one snapshot", async () => {
    await withFixture((fixture) => {
      const cardId = createCard(fixture, {
        title: "Dynamic **literal** title",
        nfm: "# Atomic append\nDurable receipt",
      });
      const access = {
        read: "allowed" as const,
        write: "consent_required" as const,
        domains: ["document", "placement", "database"] as Array<
          "document" | "placement" | "database"
        >,
      };
      const context = readV3(fixture, {
        tool: "get_context",
        projectId: fixture.projectId,
        access,
        input: { include: { databases: true, markdownGuide: true } },
      });
      expect(context.ok && context.tool === "get_context"
        ? context.output.data.markdownGuide
        : null).toMatchObject({ format: "markdown" });
      const viewId = context.ok && context.tool === "get_context"
        ? context.output.data.databases?.[0]?.views[0]?.viewId
        : undefined;
      if (!viewId) throw new Error("Fixture has no primary View");

      const found = readV3(fixture, {
        tool: "search",
        projectId: fixture.projectId,
        input: { query: "dynamc atomic" },
      });
      expect(found.ok && found.tool === "search" ? found.output.data.results : null)
        .toMatchObject([expect.objectContaining({ kind: "card", id: cardId })]);

      const fetched = readV3(fixture, {
        tool: "fetch",
        projectId: fixture.projectId,
        input: {
          id: cardId,
          prepareFor: [{ kind: "title" }, { kind: "body" }],
        },
      });
      expect(fetched.ok && fetched.tool === "fetch" ? fetched.output.data : null)
        .toMatchObject({
          resource: {
            id: cardId,
            title: {
              markdown: "Dynamic \\*\\*literal\\*\\* title",
              etag: expect.stringMatching(/^nxe1\.[A-Za-z0-9_-]{43}$/u),
            },
          },
          content: {
            format: "markdown",
            markdown: "# Atomic append\nDurable receipt",
            etag: expect.stringMatching(/^nxe1\.[A-Za-z0-9_-]{43}$/u),
          },
        });
      expect(JSON.stringify(fetched)).not.toMatch(/NFM|nfm/u);

      const savedView = readV3(fixture, {
        tool: "query_database_view",
        projectId: fixture.projectId,
        input: { viewId, select: { documentSummary: true } },
      });
      expect(savedView.ok && savedView.tool === "query_database_view"
        ? savedView.output.data.rows
        : null).toEqual(expect.arrayContaining([
        expect.objectContaining({ cardId, documentSummary: expect.any(String) }),
      ]));
      expect(JSON.stringify(savedView)).not.toContain("etag");

      const databaseBlockId = savedView.ok && savedView.tool === "query_database_view"
        ? savedView.output.data.database.databaseBlockId
        : undefined;
      if (!databaseBlockId) throw new Error("Fixture has no Database");
      const advanced = readV3(fixture, {
        tool: "advanced_query_database",
        projectId: fixture.projectId,
        input: { databaseBlockId },
      });
      expect(advanced.ok && advanced.tool === "advanced_query_database"
        ? advanced.output.data.rows
        : null).toEqual(expect.arrayContaining([expect.objectContaining({ cardId })]));
    });
  });

  sqliteTest("returns data-first Project context without storage validators", async () => {
    await withFixture((fixture) => {
      const result = read(fixture, {
        tool: "get_context",
        projectId: fixture.projectId,
        access: {
          read: "allowed",
          write: "consent_required",
          domains: ["document", "placement", "database"],
        },
        input: { include: { databases: true, nfmGuide: true } },
      });

      expect(result.ok).toBe(true);
      if (!result.ok || result.tool !== "get_context") return;
      expect(result.output.data.project).toMatchObject({
        projectId: fixture.projectId,
        name: "Agent read project",
      });
      expect(JSON.stringify(result.output)).not.toContain("Revision");
      expect(JSON.stringify(result.output)).not.toContain("etag");
      expect(result.output.data.nfmGuide?.instructions).toContain("many Blocks atomically");

      const projectless = read(fixture, {
        tool: "get_context",
        projectId: null,
        access: { read: "unavailable", write: "unavailable", domains: [] },
        input: { include: { nfmGuide: true } },
      });
      expect(projectless.ok && projectless.tool === "get_context"
        ? projectless.output.data.project
        : "unexpected").toBeNull();
    });
  });

  sqliteTest("reads validator-free NFM and prepares only requested semantic units", async () => {
    await withFixture((fixture) => {
      const cardId = createCard(fixture, {
        title: "Dynamic protocol",
        nfm: "# First heading\nParagraph one\n- [ ] Ship it",
      });
      const nfmResult = read(fixture, {
        tool: "get_block",
        projectId: fixture.projectId,
        input: { blockId: cardId },
      });
      expect(nfmResult.ok).toBe(true);
      if (!nfmResult.ok || nfmResult.tool !== "get_block") return;
      expect(nfmResult.output.data.document?.body).toMatchObject({
        format: "nfm",
        content: "# First heading\nParagraph one\n- [ ] Ship it",
      });
      expect(JSON.stringify(nfmResult.output)).not.toContain("etag");
      expect(JSON.stringify(nfmResult.output)).not.toContain("Revision");

      const preparedNfm = read(fixture, {
        tool: "get_block",
        projectId: fixture.projectId,
        input: {
          blockId: cardId,
          prepareFor: [{ kind: "title.set" }, { kind: "document.replace" }],
        },
      });
      expect(preparedNfm.ok && preparedNfm.tool === "get_block"
        ? preparedNfm.output.data.block.title?.etag
        : null).toMatch(/^nxe1\.[A-Za-z0-9_-]{43}$/);
      expect(preparedNfm.ok && preparedNfm.tool === "get_block"
        && preparedNfm.output.data.document?.body.format === "nfm"
        ? preparedNfm.output.data.document.body.etag
        : null).toMatch(/^nxe1\.[A-Za-z0-9_-]{43}$/);

      const firstPage = read(fixture, {
        tool: "get_block",
        projectId: fixture.projectId,
        input: {
          blockId: cardId,
          include: { document: { format: "blocks" } },
          page: { limit: 1 },
        },
      });
      expect(firstPage.ok).toBe(true);
      if (!firstPage.ok || firstPage.tool !== "get_block") return;
      expect(firstPage.output.data.document?.body).toMatchObject({
        format: "blocks",
        blocks: [expect.objectContaining({ type: "heading", depth: 0 })],
      });
      const cursor = firstPage.output.page?.nextCursor;
      expect(cursor).toMatch(/^nxc1\./);
      const firstBlock = firstPage.output.data.document?.body.format === "blocks"
        ? firstPage.output.data.document.body.blocks[0]
        : undefined;
      if (!firstBlock) throw new Error("Fixture returned no stable Block");

      const preparedBlock = read(fixture, {
        tool: "get_block",
        projectId: fixture.projectId,
        input: {
          blockId: cardId,
          include: { document: { format: "blocks" } },
          prepareFor: [{ kind: "block.update", blockIds: [firstBlock.blockId] }],
        },
      });
      expect(preparedBlock.ok && preparedBlock.tool === "get_block"
        && preparedBlock.output.data.document?.body.format === "blocks"
        ? preparedBlock.output.data.document.body.blocks[0]?.etag
        : null).toMatch(/^nxe1\.[A-Za-z0-9_-]{43}$/);

      const secondPage = read(fixture, {
        tool: "get_block",
        projectId: fixture.projectId,
        input: {
          blockId: cardId,
          include: { document: { format: "blocks" } },
          page: { limit: 1, cursor },
        },
      });
      expect(secondPage.ok && secondPage.tool === "get_block"
        ? secondPage.output.data.document?.body
        : null).toMatchObject({
        format: "blocks",
        blocks: [expect.objectContaining({ type: "paragraph" })],
      });
    });
  });

  sqliteTest("fuses typo-tolerant metadata with exact body evidence and exposes exact Block discovery", async () => {
    await withFixture((fixture) => {
      const cardId = createCard(fixture, {
        title: "Dynamic tool protocol",
        nfm: "# Atomic append\nDurable receipt",
      });
      const cards = read(fixture, {
        tool: "search",
        projectId: fixture.projectId,
        input: { query: "dynamc atomic" },
      });
      expect(cards.ok).toBe(true);
      if (!cards.ok || cards.tool !== "search") return;
      expect(cards.output.data).toMatchObject({
        target: "cards",
        results: [{
          kind: "card",
          blockId: cardId,
          matches: expect.arrayContaining([
            expect.objectContaining({ source: "title", quality: "fuzzy" }),
            expect.objectContaining({ source: "body", blockType: "heading" }),
          ]),
        }],
      });
      expect(JSON.stringify(cards.output)).not.toContain("score");
      expect(JSON.stringify(cards.output)).not.toContain("Revision");

      const propertyMatch = read(fixture, {
        tool: "search",
        projectId: fixture.projectId,
        input: { query: "drafx" },
      });
      expect(propertyMatch.ok && propertyMatch.tool === "search"
        ? propertyMatch.output.data
        : null).toMatchObject({
        target: "cards",
        results: [expect.objectContaining({
          blockId: cardId,
          matches: [expect.objectContaining({ source: "property", quality: "fuzzy" })],
        })],
      });

      const bodyTypo = read(fixture, {
        tool: "search",
        projectId: fixture.projectId,
        input: { query: "atomc" },
      });
      expect(bodyTypo.ok && bodyTypo.tool === "search"
        ? bodyTypo.output.data.results
        : null).toEqual([]);

      const blocks = read(fixture, {
        tool: "search",
        projectId: fixture.projectId,
        input: { query: "atomic app", target: "blocks" },
      });
      expect(blocks.ok && blocks.tool === "search" ? blocks.output.data : null)
        .toMatchObject({
          target: "blocks",
          results: [expect.objectContaining({
            ownerBlockId: cardId,
            blockType: "heading",
            source: "body",
            quality: "prefix",
          })],
        });
    });
  });

  sqliteTest("queries persisted Views with on-demand cell and placement guards", async () => {
    await withFixture((fixture) => {
      const firstCardId = createCard(fixture, {
        title: "Searchable first",
        nfm: "First",
      });
      createCard(fixture, { title: "Searchable second", nfm: "Second" });
      const context = read(fixture, {
        tool: "get_context",
        projectId: fixture.projectId,
        access: {
          read: "allowed",
          write: "consent_required",
          domains: ["document", "placement", "database"],
        },
        input: { include: { databases: true } },
      });
      if (!context.ok || context.tool !== "get_context") throw new Error("Context failed");
      const viewId = context.output.data.databases?.[0]?.views[0]?.viewId;
      if (!viewId) throw new Error("Fixture has no primary View");

      const query = read(fixture, {
        tool: "query_database",
        projectId: fixture.projectId,
        input: {
          source: { kind: "view", viewId },
          select: { documentSummary: true },
        },
      });
      expect(query.ok && query.tool === "query_database" ? query.output.data : null)
        .toMatchObject({
          view: { viewId },
          rows: expect.arrayContaining([expect.objectContaining({
            blockId: firstCardId,
            values: expect.any(Object),
            documentSummary: expect.any(String),
          })]),
        });
      if (!query.ok || query.tool !== "query_database") throw new Error("Query failed");
      expect(JSON.stringify(query.output)).not.toContain("etag");
      expect(JSON.stringify(query.output)).not.toContain("Revision");
      expect(Buffer.byteLength(JSON.stringify(query.output), "utf8")).toBeLessThan(5_000);

      const selectedPropertyId = query.output.data.database.properties[0]?.propertyId;
      if (!selectedPropertyId) throw new Error("Fixture has no Database property");
      const preparedQuery = read(fixture, {
        tool: "query_database",
        projectId: fixture.projectId,
        input: {
          source: { kind: "view", viewId },
          select: { propertyIds: [selectedPropertyId] },
          prepareFor: [
            { kind: "value.set", propertyIds: [selectedPropertyId] },
            { kind: "view.place" },
          ],
        },
      });
      expect(preparedQuery.ok).toBe(true);
      if (!preparedQuery.ok || preparedQuery.tool !== "query_database") return;
      for (const row of preparedQuery.output.data.rows) {
        expect(Object.keys(row.values)).toEqual([selectedPropertyId]);
        expect(row.values[selectedPropertyId]?.etag).toMatch(/^nxe1\.[A-Za-z0-9_-]{43}$/);
        expect(row.placement?.etag).toMatch(/^nxe1\.[A-Za-z0-9_-]{43}$/);
      }

      const firstPage = read(fixture, {
        tool: "search",
        projectId: fixture.projectId,
        input: { query: "searchable", page: { limit: 1 } },
      });
      if (!firstPage.ok || firstPage.tool !== "search") throw new Error("Search failed");
      const cursor = firstPage.output.page?.nextCursor;
      if (!cursor) throw new Error("Fixture search did not paginate");
      createCard(fixture, { title: "Searchable third", nfm: "Third" });

      const stale = read(fixture, {
        tool: "search",
        projectId: fixture.projectId,
        input: { query: "searchable", page: { limit: 1, cursor } },
      });
      expect(stale).toMatchObject({
        ok: false,
        error: { code: "cursor_stale", recovery: "restart_search" },
      });
    });
  });
});
