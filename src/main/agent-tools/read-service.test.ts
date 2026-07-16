import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { describe, expect, test } from "vitest";
import { createUuidV7 } from "../../shared/uuid-v7";
import { initialDataSourceId } from "../../shared/library";
import { parsePageLifecycleMutationRequest } from "../../shared/page-lifecycle";
import {
  BlockIdSchema,
  type BlockId,
  type NodexAgentV3ReadRequest,
} from "../../shared/nodex-agent-tools";
import { applyPageLifecycleMutation } from "../local-store/page-lifecycle";
import { readBlockStoreEpoch } from "../local-store/block-store-metadata";
import { closeDatabase, getDb, initializeDatabase } from "../local-store/database";
import { createProject } from "../local-store/projects";
import { putProjectResourceGrantInDatabase } from "../local-store/project-resource-grants";
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
  projectId = fixture.projectId,
): BlockId {
  const cardId = createUuidV7();
  const request = parsePageLifecycleMutationRequest({
    version: 1,
    operationId: createUuidV7(),
    projectId,
    storeEpoch: fixture.storeEpoch,
    clientSessionId: "agent-read-test",
    actor: { kind: "test" },
    operation: {
      kind: "create_page",
      pageId: cardId,
      title: input.title,
      nfm: input.nfm,
      status: "draft",
    },
  });
  const result = applyPageLifecycleMutation(fixture.database, request);
  if (!result.ok) throw new Error(result.error.message);
  return BlockIdSchema.parse(cardId);
}

function readV3(fixture: Fixture, request: NodexAgentV3ReadRequest) {
  return readNodexAgentV3Tool(fixture.database, request);
}

describe("Nodex Agent read service", () => {
  sqliteTest("reads, searches, and queries granted Library resources across Projects", async () => {
    await withFixture((fixture) => {
      const owner = createProject({ name: "Library resource owner" });
      const pageId = createCard(fixture, {
        title: "Shared architecture note",
        nfm: "Cross Project body",
      }, owner.id);
      putProjectResourceGrantInDatabase(fixture.database, {
        projectId: fixture.projectId,
        root: { kind: "page", pageId },
        access: "read",
      });

      const fetched = readV3(fixture, {
        tool: "fetch",
        projectId: fixture.projectId,
        input: { id: pageId },
      });
      expect(fetched.ok && fetched.tool === "fetch" ? fetched.output.data : null)
        .toMatchObject({
          resource: { id: pageId },
          content: { format: "markdown", markdown: "Cross Project body" },
        });

      const searched = readV3(fixture, {
        tool: "search",
        projectId: fixture.projectId,
        input: { query: "Shared architecture" },
      });
      expect(searched.ok && searched.tool === "search"
        ? searched.output.data.results
        : null).toEqual(expect.arrayContaining([
        expect.objectContaining({ kind: "page", id: pageId }),
      ]));

      putProjectResourceGrantInDatabase(fixture.database, {
        projectId: fixture.projectId,
        root: { kind: "database", databaseId: owner.databaseId },
        access: "read",
      });
      const queried = readV3(fixture, {
        tool: "query_data_source",
        projectId: fixture.projectId,
        input: { dataSourceId: BlockIdSchema.parse(initialDataSourceId(owner.databaseId)) },
      });
      expect(queried.ok && queried.tool === "query_data_source"
        ? queried.output.data.rows
        : null).toEqual(expect.arrayContaining([
        expect.objectContaining({ pageId }),
      ]));
    });
  });

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
        .toMatchObject([expect.objectContaining({ kind: "page", id: cardId })]);

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
        expect.objectContaining({ pageId: cardId, documentSummary: expect.any(String) }),
      ]));
      expect(JSON.stringify(savedView)).not.toContain("etag");

      const dataSourceId = savedView.ok && savedView.tool === "query_database_view"
        ? savedView.output.data.dataSource.dataSourceId
        : undefined;
      if (!dataSourceId) throw new Error("Fixture has no Data Source");
      const advanced = readV3(fixture, {
        tool: "query_data_source",
        projectId: fixture.projectId,
        input: { dataSourceId },
      });
      expect(advanced.ok && advanced.tool === "query_data_source"
        ? advanced.output.data.rows
        : null).toEqual(expect.arrayContaining([expect.objectContaining({ pageId: cardId })]));
    });
  });

});
