import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { describe, expect, test } from "vitest";
import { createUuidV7 } from "../../shared/uuid-v7";
import {
  BlockIdSchema,
  ViewIdSchema,
  type BlockId,
  type NodexAgentV3ReadRequest,
} from "../../shared/nodex-agent-tools";
import type { FrozenNodexAgentTurnAuthority } from "../../shared/nodex-agent-authority";
import { readBlockStoreEpoch } from "../local-store/block-store-metadata";
import { closeDatabase, getDb, initializeDatabase } from "../local-store/database";
import { createPageLifecycleV2Fixture } from "../local-store/page-lifecycle-v2-test-fixture";
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
  const previousDir = process.env.NODEX_HOME;
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "nodex-agent-reads-"));
  process.env.NODEX_HOME = directory;
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
    if (previousDir === undefined) delete process.env.NODEX_HOME;
    else process.env.NODEX_HOME = previousDir;
  }
}

function createCard(
  fixture: Fixture,
  input: { readonly title: string; readonly nfm: string },
  projectId = fixture.projectId,
): BlockId {
  const cardId = createUuidV7();
  createPageLifecycleV2Fixture(fixture.database, {
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
      status: "triage",
    },
  });
  return BlockIdSchema.parse(cardId);
}

const readDefaultDataSourceId = (
  database: Database.Database,
  databaseId: string,
): BlockId => {
  const row = database.prepare(`
    SELECT id FROM data_sources
    WHERE home_database_block_id = ? AND lifecycle = 'active'
    ORDER BY rank_key, id
    LIMIT 1
  `).get(databaseId) as { readonly id: string } | undefined;
  if (!row) throw new Error(`Database ${databaseId} has no active Data Source`);
  return BlockIdSchema.parse(row.id);
};

function readV3(fixture: Fixture, request: NodexAgentV3ReadRequest) {
  return readNodexAgentV3Tool(fixture.database, request);
}

function fullAccessAuthority(fixture: Fixture): FrozenNodexAgentTurnAuthority {
  const coordinate = fixture.database.prepare(`
    SELECT library_id AS libraryId FROM projects WHERE id = ?
  `).get(fixture.projectId) as { readonly libraryId: string } | undefined;
  if (!coordinate) throw new Error("Project has no Library coordinate");
  return {
    threadId: "thread-read-full",
    turnId: "turn-read-full",
    rootThreadId: "thread-read-full",
    actorProjectId: fixture.projectId,
    libraryId: coordinate.libraryId,
    storeEpoch: fixture.storeEpoch,
    scope: "library",
    source: "builtin_full_access",
  };
}

describe("Nodex Agent read service", () => {
  sqliteTest("keeps ordinary reads isolated while Full access spans the Library", async () => {
    await withFixture((fixture) => {
      const owner = createProject({ name: "Foreign Full access owner" });
      const pageId = createCard(fixture, {
        title: "Foreign Full access note",
        nfm: "Library-wide readable body",
      }, owner.id);
      const dataSourceId = readDefaultDataSourceId(
        fixture.database,
        owner.databaseId,
      );
      const view = fixture.database.prepare(`
        SELECT view.id AS viewId
        FROM database_containers container
        INNER JOIN database_views view ON view.id = container.default_view_id
        WHERE container.block_id = ? AND view.lifecycle = 'active'
      `).get(owner.databaseId) as { readonly viewId: string } | undefined;
      if (!view) throw new Error("Foreign Database has no View");

      const ordinarySearch = readV3(fixture, {
        tool: "search",
        projectId: fixture.projectId,
        input: { query: "Foreign Full access note" },
      });
      expect(ordinarySearch.ok && ordinarySearch.tool === "search"
        ? ordinarySearch.output.data.results
        : null).toEqual([]);
      const ordinaryFetch = readV3(fixture, {
        tool: "fetch",
        projectId: fixture.projectId,
        input: { id: pageId },
      });
      expect(ordinaryFetch).toMatchObject({
        ok: false,
        error: { code: "authorization_denied" },
      });

      const authority = fullAccessAuthority(fixture);
      const access = {
        read: "allowed" as const,
        write: "granted" as const,
        domains: [] as Array<"document" | "placement" | "database">,
      };
      const context = readV3(fixture, {
        tool: "get_context",
        authority,
        projectId: fixture.projectId,
        access,
        input: { include: { databases: true } },
      });
      expect(context.ok && context.tool === "get_context"
        ? context.output.data.databases?.map((entry) => entry.databaseId)
        : null).toEqual(expect.arrayContaining([owner.databaseId]));
      const searched = readV3(fixture, {
        tool: "search",
        authority,
        projectId: fixture.projectId,
        input: { query: "Foreign Full access note" },
      });
      expect(searched.ok && searched.tool === "search"
        ? searched.output.data.results
        : null).toEqual(expect.arrayContaining([
        expect.objectContaining({ kind: "page", id: pageId }),
      ]));
      const fetched = readV3(fixture, {
        tool: "fetch",
        authority,
        projectId: fixture.projectId,
        input: { id: pageId },
      });
      expect(fetched.ok && fetched.tool === "fetch" ? fetched.output.data : null)
        .toMatchObject({
          resource: { id: pageId },
          content: { markdown: "Library-wide readable body" },
        });
      const queriedView = readV3(fixture, {
        tool: "query_database_view",
        authority,
        projectId: fixture.projectId,
        input: { viewId: ViewIdSchema.parse(view.viewId) },
      });
      expect(queriedView.ok && queriedView.tool === "query_database_view"
        ? queriedView.output.data.rows
        : null).toEqual(expect.arrayContaining([expect.objectContaining({ pageId })]));
      const queriedSource = readV3(fixture, {
        tool: "query_data_source",
        authority,
        projectId: fixture.projectId,
        input: { dataSourceId },
      });
      expect(queriedSource.ok && queriedSource.tool === "query_data_source"
        ? queriedSource.output.data.rows
        : null).toEqual(expect.arrayContaining([expect.objectContaining({ pageId })]));
    });
  });

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
        input: {
          dataSourceId: readDefaultDataSourceId(
            fixture.database,
            owner.databaseId,
          ),
        },
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
