import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { describe, expect, test } from "vitest";
import { createUuidV7 } from "../../shared/uuid-v7";
import { parsePageLifecycleMutationRequest } from "../../shared/page-lifecycle";
import {
  BlockIdSchema,
  CreatePagesV3InputSchema,
  type BlockId,
} from "../../shared/nodex-agent-tools";
import { applyPageLifecycleMutation } from "../local-store/page-lifecycle";
import { readBlockStoreEpoch } from "../local-store/block-store-metadata";
import { closeDatabase, getDb, initializeDatabase } from "../local-store/database";
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
  const result = applyPageLifecycleMutation(
    fixture.database,
    parsePageLifecycleMutationRequest({
      version: 1,
      operationId: createUuidV7(),
      projectId: fixture.projectId,
      storeEpoch: fixture.storeEpoch,
      actor: { kind: "test" },
      operation: {
        kind: "create_page",
        pageId: pageId,
        title: input.title,
        nfm: input.nfm,
        status: "draft",
      },
    }),
  );
  if (!result.ok) throw new Error(result.error.message);
  return BlockIdSchema.parse(pageId);
}

describe("Nodex Agent create service", () => {
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
