import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { describe, expect, test } from "vitest";
import { createUuidV7 } from "../../shared/uuid-v7";
import type { FrozenNodexAgentTurnAuthority } from "../../shared/nodex-agent-authority";
import {
  BlockIdSchema,
  CreatePagesV3InputSchema,
  type BlockId,
} from "../../shared/nodex-agent-tools";
import { readBlockStoreEpoch } from "../local-store/block-store-metadata";
import { closeDatabase, getDb, initializeDatabase } from "../local-store/database";
import { createPageLifecycleV2Fixture } from "../local-store/page-lifecycle-v2-test-fixture";
import { createProject } from "../local-store/projects";
import {
  executeNodexAgentCreatePages,
  prepareNodexAgentCreatePages,
} from "./create-service";
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
  const pageId = createUuidV7();
  createPageLifecycleV2Fixture(fixture.database, {
    operationId: createUuidV7(),
    projectId: fixture.projectId,
    storeEpoch: fixture.storeEpoch,
    actor: { kind: "test" },
    operation: {
      kind: "create_page",
      pageId,
      title: input.title,
      nfm: input.nfm,
      status: "draft",
    },
  });
  return BlockIdSchema.parse(pageId);
}

function fullAccessAuthority(fixture: Fixture): FrozenNodexAgentTurnAuthority {
  const coordinate = fixture.database.prepare(`
    SELECT library_id AS libraryId FROM projects WHERE id = ?
  `).get(fixture.projectId) as { readonly libraryId: string } | undefined;
  if (!coordinate) throw new Error("Project has no Library coordinate");
  return {
    threadId: "thread-create-full",
    turnId: "turn-create-full",
    rootThreadId: "thread-create-full",
    actorProjectId: fixture.projectId,
    libraryId: coordinate.libraryId,
    storeEpoch: fixture.storeEpoch,
    scope: "library",
    source: "builtin_full_access",
  };
}

describe("Nodex Agent create service", () => {
  sqliteTest("creates directly under a foreign Data Source compatibility owner", async () => {
    await withFixture((fixture) => {
      const owner = createProject({ name: "Foreign create owner" });
      const destination = fixture.database.prepare(`
        SELECT source.id AS dataSourceId, view.id AS viewId
        FROM data_sources source
        INNER JOIN database_containers container
          ON container.block_id = source.home_database_block_id
        INNER JOIN database_views view
          ON view.id = container.default_view_id
          AND view.data_source_id = source.id
          AND view.lifecycle = 'active'
        WHERE source.home_database_block_id = ? AND source.lifecycle = 'active'
        ORDER BY view.rank_key, view.id
        LIMIT 1
      `).get(owner.databaseId) as {
        readonly dataSourceId: string;
        readonly viewId: string;
      } | undefined;
      if (!destination) throw new Error("Foreign Data Source is unavailable");
      const authority = fullAccessAuthority(fixture);
      const prepared = prepareNodexAgentCreatePages(fixture.database, {
        threadId: authority.threadId,
        callId: "create-foreign-data-source",
        authority,
        projectId: fixture.projectId,
        input: CreatePagesV3InputSchema.parse({
          destination: {
            kind: "data_source",
            dataSourceId: destination.dataSourceId,
            view: { viewId: destination.viewId, groupKey: "draft" },
          },
          pages: [{ title: "Foreign owner Page", markdown: "Created directly" }],
        }),
      });
      if (!prepared.ok || prepared.value.kind !== "prepared") {
        throw new Error(`Foreign create was not prepared: ${JSON.stringify(prepared)}`);
      }
      expect(prepared.value.command.destination.contentProjectId).toBe(owner.id);
      const executed = executeNodexAgentCreatePages(
        fixture.database,
        prepared.value.command,
      );
      if (!executed.ok) throw new Error(executed.error.message);
      const pageId = executed.value.output.data.pages[0]?.pageId;
      expect(fixture.database.prepare(`
        SELECT project_id AS projectId, containing_database_id AS databaseId
        FROM blocks WHERE id = ?
      `).get(pageId)).toEqual({
        projectId: owner.id,
        databaseId: owner.databaseId,
      });
      expect(fixture.database.prepare(`
        SELECT COUNT(*) AS count FROM project_resource_grants
        WHERE project_id = ?
      `).get(fixture.projectId)).toEqual({ count: 0 });
    });
  });

  sqliteTest("creates and replays an ordered atomic Page batch with inline-Markdown titles", async () => {
    await withFixture((fixture) => {
      const batchInput = CreatePagesV3InputSchema.parse({
        destination: { kind: "library", at: { kind: "end" } },
        pages: [
          { title: "**First**", markdown: "First body\n\t- [ ] Nested" },
          { title: "[Second](https://example.com)", markdown: "Second body" },
        ],
        return: ["block_ids", "etags"],
      });
      const request = {
        threadId: "thread-v3",
        callId: "batch-space",
        projectId: fixture.projectId,
        input: batchInput,
      };
      const prepared = prepareNodexAgentCreatePages(fixture.database, request);
      if (!prepared.ok || prepared.value.kind !== "prepared") {
        throw new Error(`Page batch was not prepared: ${JSON.stringify(prepared)}`);
      }
      expect(prepared.value.previews.map((preview) => preview.title)).toEqual([
        "First",
        "Second",
      ]);
      const executed = executeNodexAgentCreatePages(
        fixture.database,
        prepared.value.command,
      );
      if (!executed.ok) throw new Error(executed.error.message);
      expect(executed.value.output.data).toMatchObject({
        created: 2,
        pages: [
          {
            pageId: prepared.value.command.pages[0]?.pageId,
            location: { kind: "library", libraryId: expect.any(String) },
            bodyBlocksCreated: 2,
            blockIds: [expect.any(String), expect.any(String)],
            etags: { title: expect.stringMatching(/^nxe1\./u) },
          },
          {
            pageId: prepared.value.command.pages[1]?.pageId,
            location: { kind: "library", libraryId: expect.any(String) },
            bodyBlocksCreated: 1,
          },
        ],
      });
      const replay = prepareNodexAgentCreatePages(fixture.database, request);
      expect(replay.ok && replay.value.kind === "completed"
        ? replay.value.output
        : null).toEqual(executed.value.output);
      const receipt = fixture.database.prepare(
        "SELECT tool FROM nodex_agent_call_receipts WHERE call_id = ?",
      ).get("batch-space") as { readonly tool: string };
      expect(receipt.tool).toBe("create_pages");
    });
  });

  sqliteTest("places a Page batch into one parent Page in input order", async () => {
    await withFixture((fixture) => {
      const hostId = createExistingCard(fixture, { title: "Host", nfm: "Before\nAfter" });
      const host = readNodexAgentV3Tool(fixture.database, {
        tool: "fetch",
        projectId: fixture.projectId,
        input: { id: hostId, format: "blocks" },
      });
      const body = host.ok && host.tool === "fetch"
        ? host.output.data.content
        : undefined;
      const firstBlockId = body?.format === "blocks" ? body.blocks[0]?.id : undefined;
      if (!firstBlockId) throw new Error("Host anchor is unavailable");
      const prepared = prepareNodexAgentCreatePages(fixture.database, {
        threadId: "thread-v3",
        callId: "batch-card",
        projectId: fixture.projectId,
        input: CreatePagesV3InputSchema.parse({
          destination: {
            kind: "page",
            pageId: hostId,
            at: { kind: "after", blockId: firstBlockId },
          },
          pages: [{ title: "Child A" }, { title: "Child B" }],
        }),
      });
      if (!prepared.ok || prepared.value.kind !== "prepared") {
        throw new Error(`Page batch was not prepared: ${JSON.stringify(prepared)}`);
      }
      expect(prepared.value.leaseDocuments).toHaveLength(1);
      const executed = executeNodexAgentCreatePages(
        fixture.database,
        prepared.value.command,
      );
      if (!executed.ok) throw new Error(executed.error.message);
      const hostDocumentId = prepared.value.leaseDocuments[0]?.documentId;
      const materialization = fixture.database.prepare(
        "SELECT nfm FROM document_materializations WHERE document_id = ?",
      ).get(hostDocumentId) as { readonly nfm: string };
      expect(materialization.nfm).toBe([
        "Before",
        `<page uuid="${prepared.value.command.pages[0]?.pageId}" />`,
        `<page uuid="${prepared.value.command.pages[1]?.pageId}" />`,
        "After",
      ].join("\n"));
      expect(executed.value.output.data.pages.map((page) => page.location)).toEqual([
        { kind: "page", pageId: hostId },
        { kind: "page", pageId: hostId },
      ]);
    });
  });

  sqliteTest("resolves a Data Source anchor that has no manual View position", async () => {
    await withFixture((fixture) => {
      const anchorId = createExistingCard(fixture, {
        title: "Unpositioned anchor",
        nfm: "Anchor body",
      });
      const destination = fixture.database.prepare(`
        SELECT view.id AS view_id, view.data_source_id
        FROM data_source_page_memberships membership
        INNER JOIN database_views view
          ON view.data_source_id = membership.data_source_id
          AND view.lifecycle = 'active'
        WHERE membership.page_block_id = ?
          AND membership.removed_at IS NULL
        ORDER BY view.rank_key, view.id
        LIMIT 1
      `).get(anchorId) as {
        readonly view_id: string;
        readonly data_source_id: string;
      };
      fixture.database.prepare(`
        DELETE FROM database_view_page_positions
        WHERE view_id = ? AND page_block_id = ?
      `).run(destination.view_id, anchorId);

      const prepared = prepareNodexAgentCreatePages(fixture.database, {
        threadId: "thread-v3",
        callId: "batch-unpositioned-anchor",
        projectId: fixture.projectId,
        input: CreatePagesV3InputSchema.parse({
          destination: {
            kind: "data_source",
            dataSourceId: destination.data_source_id,
            view: {
              viewId: destination.view_id,
              groupKey: "draft",
              at: { kind: "before", blockId: anchorId },
            },
          },
          pages: [{ title: "Before anchor" }],
        }),
      });

      if (!prepared.ok || prepared.value.kind !== "prepared") {
        throw new Error(`Page batch was not prepared: ${JSON.stringify(prepared)}`);
      }
      expect(prepared.value.command.destination).toMatchObject({
        kind: "database",
        view: { beforePageId: anchorId },
      });
    });
  });

  sqliteTest("rolls back every Page in a batch when a late aggregate seam fails", async () => {
    await withFixture((fixture) => {
      const prepared = prepareNodexAgentCreatePages(fixture.database, {
        threadId: "thread-v3",
        callId: "batch-rollback",
        projectId: fixture.projectId,
        input: CreatePagesV3InputSchema.parse({
          destination: { kind: "library" },
          pages: [
            { title: "Rollback A", markdown: "Body A" },
            { title: "Rollback B", markdown: "Body B" },
          ],
        }),
      });
      if (!prepared.ok || prepared.value.kind !== "prepared") {
        throw new Error("Page batch was not prepared");
      }
      const result = executeNodexAgentCreatePages(
        fixture.database,
        prepared.value.command,
        { faultInjector: (point) => {
          if (point === "before_receipt") throw new Error("injected late failure");
        } },
      );
      expect(result).toMatchObject({ ok: false, error: { code: "internal_error" } });
      for (const page of prepared.value.command.pages) {
        expect(fixture.database.prepare("SELECT 1 FROM blocks WHERE id = ?").get(page.pageId))
          .toBeUndefined();
      }
      expect(fixture.database.prepare(
        "SELECT status FROM nodex_agent_call_receipts WHERE mutation_id = ?",
      ).get(prepared.value.command.mutationId)).toEqual({ status: "prepared" });
    });
  });

});
