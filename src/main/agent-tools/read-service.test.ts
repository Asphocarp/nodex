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
} from "../../shared/nodex-agent-tools";
import { applyCardLifecycleMutation } from "../local-store/card-block-lifecycle";
import { readBlockStoreEpoch } from "../local-store/block-store-metadata";
import { closeDatabase, getDb, initializeDatabase } from "../local-store/database";
import { createProject } from "../local-store/projects";
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

describe("Nodex Agent read service", () => {
  sqliteTest("returns Project context, compact NFM guidance, and opaque Database revisions", async () => {
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
      expect(result.output.data.databases?.[0]?.schemaRevision).toMatch(/^nxt1\./);
      expect(result.output.data.databases?.[0]?.views[0]?.revision).toMatch(/^nxt1\./);
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

  sqliteTest("reads complete NFM and paged stable Blocks with exact snapshot tokens", async () => {
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
      expect(nfmResult.output.data.document?.revision).toMatch(/^nxt1\./);
      expect(nfmResult.output.data.block.locationRevision).toMatch(/^nxt1\./);

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
      expect(cursor).toMatch(/^nxt1\./);

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

  sqliteTest("queries persisted Views with typed values and rejects stale search cursors", async () => {
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
          view: { viewId, revision: expect.stringMatching(/^nxt1\./) },
          rows: expect.arrayContaining([expect.objectContaining({
            blockId: firstCardId,
            locationRevision: expect.stringMatching(/^nxt1\./),
            values: expect.any(Object),
            documentSummary: expect.any(String),
          })]),
        });

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
