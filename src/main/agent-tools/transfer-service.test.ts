import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { describe, expect, test } from "vitest";
import {
  CreatePagesV3InputSchema,
  DuplicatePageV3InputSchema,
  MovePagesV3InputSchema,
  type BlockId,
} from "../../shared/nodex-agent-tools";
import type { FrozenNodexAgentTurnAuthority } from "../../shared/nodex-agent-authority";
import type {
  NodexAgentResourceAccessOverlay,
  NodexAgentResourceGrantSpec,
} from "../../shared/nodex-agent-resource-access";
import { readBlockStoreEpoch } from "../local-store/block-store-metadata";
import { closeDatabase, getDb, initializeDatabase } from "../local-store/database";
import { createProject } from "../local-store/projects";
import {
  executeNodexAgentCreatePages,
  prepareNodexAgentCreatePages,
} from "./create-service";
import { readNodexAgentV3Tool } from "./read-v3";
import {
  executeNodexAgentDuplicatePage,
  executeNodexAgentMovePages,
  prepareNodexAgentDuplicatePage,
  prepareNodexAgentMovePages,
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
  const previousDir = process.env.NODEX_HOME;
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "nodex-agent-transfer-"));
  process.env.NODEX_HOME = directory;
  try {
    await initializeDatabase();
    const project = createProject({ name: "Agent transfer project" });
    const database = getDb();
    if (!readBlockStoreEpoch(database)) throw new Error("Fixture has no store epoch");
    await run({ database, projectId: project.id });
  } finally {
    closeDatabase();
    fs.rmSync(directory, { recursive: true, force: true });
    if (previousDir === undefined) delete process.env.NODEX_HOME;
    else process.env.NODEX_HOME = previousDir;
  }
}

function createPage(
  fixture: Fixture,
  callId: string,
  title: string,
  destination: unknown = { kind: "library" },
): BlockId {
  const prepared = prepareNodexAgentCreatePages(fixture.database, {
    threadId: "thread-create",
    callId,
    projectId: fixture.projectId,
    input: CreatePagesV3InputSchema.parse({
      destination,
      pages: [{ title, markdown: `${title} body` }],
    }),
  });
  if (!prepared.ok || prepared.value.kind !== "prepared") {
    throw new Error("Page create was not prepared");
  }
  const result = executeNodexAgentCreatePages(
    fixture.database,
    prepared.value.command,
  );
  if (!result.ok) throw new Error(result.error.message);
  const pageId = result.value.output.data.pages[0]?.pageId;
  if (pageId) return pageId;
  throw new Error("Page create returned no Page identity");
}

function requirePageDocumentIdForTest(fixture: Fixture, pageId: BlockId): string {
  const row = fixture.database.prepare(
    "SELECT document_id FROM block_documents WHERE block_id = ?",
  ).get(pageId) as { readonly document_id: string } | undefined;
  if (row) return row.document_id;
  throw new Error(`Page ${pageId} has no owned Document`);
}

function pageSnapshot(fixture: Fixture, pageId: BlockId) {
  const result = readNodexAgentV3Tool(fixture.database, {
    tool: "fetch",
    projectId: fixture.projectId,
    input: { id: pageId },
  });
  if (!result.ok || result.tool !== "fetch") throw new Error("Page read failed");
  return result.output.data;
}

function context(fixture: Fixture) {
  const result = readNodexAgentV3Tool(fixture.database, {
    tool: "get_context",
    projectId: fixture.projectId,
    access: { read: "allowed", write: "consent_required", domains: [] },
    input: { include: { databases: true } },
  });
  if (!result.ok || result.tool !== "get_context") throw new Error("Context failed");
  const database = result.output.data.databases?.find((entry) => entry.isBound);
  const view = database?.views.find((entry) => entry.isDefault);
  if (!database || !view) throw new Error("Primary Database is unavailable");
  return { database, view };
}

function defaultDataSourceId(fixture: Fixture, databaseId: string): string {
  const source = fixture.database.prepare(`
    SELECT id FROM data_sources
    WHERE home_database_block_id = ? AND lifecycle = 'active'
    ORDER BY rank_key, id LIMIT 1
  `).get(databaseId) as { readonly id: string } | undefined;
  if (source) return source.id;
  throw new Error("Initial Data Source is unavailable");
}

function fullAccessAuthority(
  fixture: Fixture,
  turnId = "turn-full-access",
): FrozenNodexAgentTurnAuthority {
  const coordinate = fixture.database.prepare(`
    SELECT project.library_id AS libraryId
    FROM projects project
    WHERE project.id = ?
  `).get(fixture.projectId) as { readonly libraryId: string } | undefined;
  const storeEpoch = readBlockStoreEpoch(fixture.database);
  if (!coordinate || !storeEpoch) throw new Error("Full-access fixture is incomplete");
  return {
    threadId: "thread-full-access",
    turnId,
    rootThreadId: "thread-full-access",
    actorProjectId: fixture.projectId,
    libraryId: coordinate.libraryId,
    storeEpoch,
    scope: "library",
    source: "builtin_full_access",
  };
}

function projectAuthority(fixture: Fixture): FrozenNodexAgentTurnAuthority {
  return {
    ...fullAccessAuthority(fixture, "turn-project-access"),
    scope: "project",
    source: "project_turn",
  };
}

function callAccess(
  authority: FrozenNodexAgentTurnAuthority,
  callId: string,
  grants: readonly NodexAgentResourceGrantSpec[],
): NodexAgentResourceAccessOverlay {
  return {
    kind: "consent",
    scope: "call",
    threadId: authority.threadId,
    turnId: authority.turnId,
    callId,
    rootThreadId: authority.rootThreadId,
    actorProjectId: authority.actorProjectId,
    libraryId: authority.libraryId,
    storeEpoch: authority.storeEpoch,
    grants,
  };
}

describe("Nodex Agent transfer service", () => {
  sqliteTest("keeps call-scoped top-level create and duplicate non-persistent", async () => {
    await withFixture((fixture) => {
      const source = createPage(fixture, "top-level-source", "Top-level Source");
      const authority = projectAuthority(fixture);
      const libraryGrant = [{
        root: { kind: "library" as const, libraryId: authority.libraryId },
        access: "read_write" as const,
        libraryActions: ["create_child" as const],
      }];
      const grantCountBefore = fixture.database.prepare(`
        SELECT COUNT(*) AS count FROM project_resource_grants
        WHERE project_id = ?
      `).get(fixture.projectId) as { readonly count: number };

      const createCallId = "top-level-consent-create";
      const preparedCreate = prepareNodexAgentCreatePages(fixture.database, {
        threadId: authority.threadId,
        callId: createCallId,
        projectId: fixture.projectId,
        authority,
        resourceAccess: callAccess(authority, createCallId, libraryGrant),
        input: CreatePagesV3InputSchema.parse({
          destination: { kind: "library" },
          pages: [{ title: "Temporary top-level Page", markdown: "Body" }],
        }),
      });
      if (!preparedCreate.ok || preparedCreate.value.kind !== "prepared") {
        throw new Error(`Create was not prepared: ${JSON.stringify(preparedCreate)}`);
      }
      const created = executeNodexAgentCreatePages(
        fixture.database,
        preparedCreate.value.command,
      );
      if (!created.ok) throw new Error(created.error.message);

      const duplicateCallId = "top-level-consent-duplicate";
      const preparedDuplicate = prepareNodexAgentDuplicatePage(fixture.database, {
        threadId: authority.threadId,
        callId: duplicateCallId,
        projectId: fixture.projectId,
        authority,
        resourceAccess: callAccess(authority, duplicateCallId, libraryGrant),
        input: DuplicatePageV3InputSchema.parse({
          pageId: source,
          destination: { kind: "library" },
        }),
      });
      if (!preparedDuplicate.ok || preparedDuplicate.value.kind !== "prepared") {
        throw new Error(`Duplicate was not prepared: ${JSON.stringify(preparedDuplicate)}`);
      }
      const duplicated = executeNodexAgentDuplicatePage(
        fixture.database,
        preparedDuplicate.value.command,
      );
      if (!duplicated.ok) throw new Error(duplicated.error.message);
      expect(duplicated.value.output.data.location).toEqual({
        kind: "library",
        libraryId: authority.libraryId,
      });

      const grantCountAfter = fixture.database.prepare(`
        SELECT COUNT(*) AS count FROM project_resource_grants
        WHERE project_id = ?
      `).get(fixture.projectId) as { readonly count: number };
      expect(grantCountAfter).toEqual(grantCountBefore);
    });
  });

  sqliteTest("uses call-scoped consent for cross-owner create, move, and duplicate without persisting grants", async () => {
    await withFixture((fixture) => {
      const target = createProject({ name: "Consent target owner" });
      const targetParent = createPage(
        { ...fixture, projectId: target.id },
        "consent-target-parent",
        "Consent Parent",
      );
      const moveSource = createPage(fixture, "consent-move-source", "Move Source");
      const duplicateSource = createPage(
        fixture,
        "consent-duplicate-source",
        "Duplicate Source",
      );
      const authority = projectAuthority(fixture);
      const destinationGrant = [{
        root: { kind: "page" as const, pageId: targetParent },
        access: "read_write" as const,
      }];
      const grantCountBefore = fixture.database.prepare(`
        SELECT COUNT(*) AS count FROM project_resource_grants
        WHERE project_id = ?
      `).get(fixture.projectId) as { readonly count: number };

      const createCallId = "project-consent-create";
      const preparedCreate = prepareNodexAgentCreatePages(fixture.database, {
        threadId: authority.threadId,
        callId: createCallId,
        projectId: fixture.projectId,
        authority,
        resourceAccess: callAccess(authority, createCallId, destinationGrant),
        input: CreatePagesV3InputSchema.parse({
          destination: { kind: "page", pageId: targetParent },
          pages: [{ title: "Created with consent", markdown: "Body" }],
        }),
      });
      if (!preparedCreate.ok || preparedCreate.value.kind !== "prepared") {
        throw new Error(`Create was not prepared: ${JSON.stringify(preparedCreate)}`);
      }
      const created = executeNodexAgentCreatePages(
        fixture.database,
        preparedCreate.value.command,
      );
      if (!created.ok) throw new Error(created.error.message);
      const createdPageId = created.value.output.data.pages[0]?.pageId;
      if (!createdPageId) throw new Error("Create returned no Page");

      const moveCallId = "project-consent-move";
      const preparedMove = prepareNodexAgentMovePages(fixture.database, {
        threadId: authority.threadId,
        callId: moveCallId,
        projectId: fixture.projectId,
        authority,
        resourceAccess: callAccess(authority, moveCallId, destinationGrant),
        input: MovePagesV3InputSchema.parse({
          pageIds: [moveSource],
          destination: { kind: "page", pageId: targetParent },
        }),
      });
      if (!preparedMove.ok || preparedMove.value.kind !== "prepared") {
        throw new Error(`Move was not prepared: ${JSON.stringify(preparedMove)}`);
      }
      const moved = executeNodexAgentMovePages(
        fixture.database,
        preparedMove.value.command,
      );
      if (!moved.ok) throw new Error(moved.error.message);

      const duplicateCallId = "project-consent-duplicate";
      const preparedDuplicate = prepareNodexAgentDuplicatePage(fixture.database, {
        threadId: authority.threadId,
        callId: duplicateCallId,
        projectId: fixture.projectId,
        authority,
        resourceAccess: callAccess(authority, duplicateCallId, destinationGrant),
        input: DuplicatePageV3InputSchema.parse({
          pageId: duplicateSource,
          destination: { kind: "page", pageId: targetParent },
        }),
      });
      if (!preparedDuplicate.ok || preparedDuplicate.value.kind !== "prepared") {
        throw new Error(`Duplicate was not prepared: ${JSON.stringify(preparedDuplicate)}`);
      }
      const duplicated = executeNodexAgentDuplicatePage(
        fixture.database,
        preparedDuplicate.value.command,
      );
      if (!duplicated.ok) throw new Error(duplicated.error.message);

      const resultIds = [
        createdPageId,
        moveSource,
        duplicated.value.output.data.pageId,
      ];
      const owners = fixture.database.prepare(`
        SELECT id, project_id AS projectId FROM blocks
        WHERE id IN (?, ?, ?)
      `).all(...resultIds) as readonly {
        readonly id: string;
        readonly projectId: string;
      }[];
      expect(new Set(owners.map((owner) => owner.projectId))).toEqual(
        new Set([target.id]),
      );
      const grantCountAfter = fixture.database.prepare(`
        SELECT COUNT(*) AS count FROM project_resource_grants
        WHERE project_id = ?
      `).get(fixture.projectId) as { readonly count: number };
      expect(grantCountAfter).toEqual(grantCountBefore);
      expect(fixture.database.pragma("foreign_key_check")).toEqual([]);
    });
  });

  sqliteTest("moves and duplicates Pages across compatibility owners without persisting grants", async () => {
    await withFixture((fixture) => {
      const target = createProject({ name: "Foreign target owner" });
      const targetFixture = { ...fixture, projectId: target.id };
      const targetParent = createPage(targetFixture, "foreign-target-parent", "Foreign Parent");
      const movedPage = createPage(fixture, "foreign-move-source", "Move Source");
      const copiedPage = createPage(fixture, "foreign-copy-source", "Copy Source");
      const authority = fullAccessAuthority(fixture);
      const grantCountBefore = fixture.database.prepare(
        "SELECT COUNT(*) AS count FROM project_resource_grants",
      ).get() as { readonly count: number };

      const preparedMove = prepareNodexAgentMovePages(fixture.database, {
        threadId: authority.threadId,
        callId: "foreign-owner-move",
        authority,
        projectId: fixture.projectId,
        input: MovePagesV3InputSchema.parse({
          pageIds: [movedPage],
          destination: { kind: "page", pageId: targetParent },
        }),
      });
      if (!preparedMove.ok || preparedMove.value.kind !== "prepared") {
        throw new Error(`Foreign move was not prepared: ${JSON.stringify(preparedMove)}`);
      }
      expect(preparedMove.value.command.transfers[0]).toMatchObject({
        sourceProjectId: fixture.projectId,
        targetProjectId: target.id,
        rehome: {
          actorProjectId: fixture.projectId,
          sourceProjectId: fixture.projectId,
          targetProjectId: target.id,
        },
      });
      const moved = executeNodexAgentMovePages(
        fixture.database,
        preparedMove.value.command,
      );
      if (!moved.ok) throw new Error(moved.error.message);
      expect(moved.value.output.data.pages).toEqual([{
        pageId: movedPage,
        location: { kind: "page", pageId: targetParent },
      }]);

      const preparedCopy = prepareNodexAgentDuplicatePage(fixture.database, {
        threadId: authority.threadId,
        callId: "foreign-owner-copy",
        authority,
        projectId: fixture.projectId,
        input: DuplicatePageV3InputSchema.parse({
          pageId: copiedPage,
          destination: { kind: "page", pageId: targetParent },
        }),
      });
      if (!preparedCopy.ok || preparedCopy.value.kind !== "prepared") {
        throw new Error(`Foreign duplicate was not prepared: ${JSON.stringify(preparedCopy)}`);
      }
      const copied = executeNodexAgentDuplicatePage(
        fixture.database,
        preparedCopy.value.command,
      );
      if (!copied.ok) throw new Error(copied.error.message);
      const resultPageId = copied.value.output.data.pageId;
      const owners = fixture.database.prepare(`
        SELECT id, project_id AS projectId FROM blocks WHERE id IN (?, ?, ?)
        ORDER BY id
      `).all(movedPage, copiedPage, resultPageId) as readonly {
        readonly id: string;
        readonly projectId: string;
      }[];
      expect(Object.fromEntries(owners.map((owner) => [owner.id, owner.projectId]))).toEqual({
        [movedPage]: target.id,
        [copiedPage]: fixture.projectId,
        [resultPageId]: target.id,
      });
      const grantCountAfter = fixture.database.prepare(
        "SELECT COUNT(*) AS count FROM project_resource_grants",
      ).get() as { readonly count: number };
      expect(grantCountAfter).toEqual(grantCountBefore);
      expect(fixture.database.pragma("foreign_key_check")).toEqual([]);
      expect(fixture.database.pragma("integrity_check")).toEqual([{ integrity_check: "ok" }]);
    });
  });

  sqliteTest("duplicates one complete Page with a Page-native result and exact replay", async () => {
    await withFixture((fixture) => {
      const parent = createPage(fixture, "duplicate-parent", "Parent");
      const source = createPage(fixture, "duplicate-source", "Source");
      const parentDocumentId = requirePageDocumentIdForTest(fixture, parent);
      const parentHeadBefore = fixture.database.prepare(
        "SELECT head_seq FROM documents WHERE id = ?",
      ).get(parentDocumentId) as { readonly head_seq: number };
      const request = {
        threadId: "thread-v3",
        callId: "duplicate-card",
        projectId: fixture.projectId,
        input: DuplicatePageV3InputSchema.parse({
          pageId: source,
          destination: { kind: "page", pageId: parent },
          return: ["block_map", "etags"],
        }),
      };
      const prepared = prepareNodexAgentDuplicatePage(fixture.database, request);
      if (!prepared.ok || prepared.value.kind !== "prepared") {
        throw new Error(`Duplicate was not prepared: ${JSON.stringify(prepared)}`);
      }
      expect(prepared.value.authorization.roots).toEqual({
        [source]: { type: "page", transformation: "preserved" },
      });
      const executed = executeNodexAgentDuplicatePage(
        fixture.database,
        prepared.value.command,
      );
      if (!executed.ok) throw new Error(executed.error.message);
      expect(executed.value.output.data).toMatchObject({
        sourcePageId: source,
        pageId: expect.any(String),
        location: { kind: "page", pageId: parent },
        bodyBlocksCreated: 1,
        blockMap: expect.objectContaining({ [source]: expect.any(String) }),
        etags: {
          title: expect.stringMatching(/^nxe1\./u),
          body: expect.stringMatching(/^nxe1\./u),
        },
      });
      const copiedPageId = executed.value.output.data.pageId;
      expect(copiedPageId).not.toBe(source);
      const copied = fixture.database.prepare(
        `
        SELECT materialization.title, materialization.nfm
        FROM block_documents ownership
        INNER JOIN document_materializations materialization
          ON materialization.document_id = ownership.document_id
        WHERE ownership.block_id = ?
      `).get(copiedPageId);
      expect(copied).toEqual({ title: "Source", nfm: "Source body" });
      const parentDocument = fixture.database.prepare(
        `
        SELECT document.head_seq, materialization.block_tree_json
        FROM documents document
        INNER JOIN document_materializations materialization
          ON materialization.document_id = document.id
        WHERE document.id = ?
      `).get(parentDocumentId) as {
        readonly head_seq: number;
        readonly block_tree_json: string;
      };
      expect(parentDocument.head_seq).toBe(parentHeadBefore.head_seq + 1);
      const parentTree = JSON.parse(parentDocument.block_tree_json) as readonly {
        readonly id: string;
      }[];
      expect(parentTree.some((block) => block.id === copiedPageId)).toBe(true);
      expect(fixture.database.prepare(
        `
        SELECT block_type
        FROM document_block_index
        WHERE document_id = ? AND block_id = ?
      `).get(parentDocumentId, copiedPageId)).toEqual({ block_type: "page" });
      const replay = prepareNodexAgentDuplicatePage(fixture.database, request);
      expect(replay.ok && replay.value.kind === "completed"
        ? replay.value.output
        : null).toEqual(executed.value.output);
      const receipt = fixture.database.prepare(
        "SELECT tool FROM nodex_agent_call_receipts WHERE call_id = ?",
      ).get("duplicate-card") as { readonly tool: string };
      expect(receipt.tool).toBe("duplicate_page");
    });
  });

  sqliteTest("moves mixed-source Pages into one Page atomically in input order", async () => {
    await withFixture((fixture) => {
      const parent = createPage(fixture, "move-parent", "Parent");
      const parentDocumentId = requirePageDocumentIdForTest(fixture, parent);
      const parentHeadBefore = fixture.database.prepare(
        "SELECT head_seq FROM documents WHERE id = ?",
      ).get(parentDocumentId) as { readonly head_seq: number };
      const libraryPage = createPage(fixture, "move-library", "From Library");
      const { database, view } = context(fixture);
      const dataSourceId = defaultDataSourceId(fixture, database.databaseId);
      const dataSourcePage = createPage(fixture, "move-data-source", "From Data Source", {
        kind: "data_source",
        dataSourceId,
        view: { viewId: view.viewId, groupKey: "triage" },
      });
      const request = {
        threadId: "thread-v3",
        callId: "move-mixed-cards",
        projectId: fixture.projectId,
        input: MovePagesV3InputSchema.parse({
          pageIds: [dataSourcePage, libraryPage],
          destination: { kind: "page", pageId: parent },
        }),
      };
      const prepared = prepareNodexAgentMovePages(fixture.database, request);
      if (!prepared.ok || prepared.value.kind !== "prepared") {
        throw new Error(`Move was not prepared: ${JSON.stringify(prepared)}`);
      }
      expect(prepared.value.authorization.roots).toEqual({
        [dataSourcePage]: { type: "page", transformation: "preserved" },
        [libraryPage]: { type: "page", transformation: "preserved" },
      });
      expect(prepared.value.command.leaseDocuments).toEqual([
        expect.objectContaining({
          documentId: requirePageDocumentIdForTest(fixture, parent),
        }),
      ]);

      const executed = executeNodexAgentMovePages(
        fixture.database,
        prepared.value.command,
      );
      if (!executed.ok) throw new Error(executed.error.message);
      expect(executed.value.output.data).toEqual({
        pages: [
          { pageId: dataSourcePage, location: { kind: "page", pageId: parent } },
          { pageId: libraryPage, location: { kind: "page", pageId: parent } },
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
        parentDocumentId,
        dataSourcePage,
        libraryPage,
      ) as readonly { readonly block_id: string }[];
      expect(nestedOrder.map((row) => row.block_id)).toEqual([dataSourcePage, libraryPage]);
      const parentDocument = fixture.database.prepare(
        `
        SELECT document.head_seq, materialization.block_tree_json
        FROM documents document
        INNER JOIN document_materializations materialization
          ON materialization.document_id = document.id
        WHERE document.id = ?
      `).get(parentDocumentId) as {
        readonly head_seq: number;
        readonly block_tree_json: string;
      };
      expect(parentDocument.head_seq).toBe(parentHeadBefore.head_seq + 2);
      const parentTree = JSON.parse(parentDocument.block_tree_json) as readonly {
        readonly id: string;
      }[];
      expect(parentTree
        .map((block) => block.id)
        .filter((id) => id === dataSourcePage || id === libraryPage))
        .toEqual([dataSourcePage, libraryPage]);

      const replay = prepareNodexAgentMovePages(fixture.database, request);
      expect(replay.ok && replay.value.kind === "completed"
        ? replay.value.output
        : null).toEqual(executed.value.output);
      const receipt = fixture.database.prepare(
        "SELECT tool FROM nodex_agent_call_receipts WHERE call_id = ?",
      ).get("move-mixed-cards") as { readonly tool: string };
      expect(receipt.tool).toBe("move_pages");
    });
  });

  sqliteTest("rejects overlapping cross-owner ownership closures during prepare", async () => {
    await withFixture((fixture) => {
      const target = createProject({ name: "Overlap target owner" });
      const targetParent = createPage(
        { ...fixture, projectId: target.id },
        "overlap-target-parent",
        "Target Parent",
      );
      const ancestor = createPage(fixture, "overlap-ancestor", "Ancestor");
      const descendant = createPage(
        fixture,
        "overlap-descendant",
        "Descendant",
        { kind: "page", pageId: ancestor },
      );
      const authority = fullAccessAuthority(fixture, "turn-overlap");

      expect(prepareNodexAgentMovePages(fixture.database, {
        threadId: authority.threadId,
        callId: "overlapping-cross-owner-move",
        authority,
        projectId: fixture.projectId,
        input: MovePagesV3InputSchema.parse({
          pageIds: [ancestor, descendant],
          destination: { kind: "page", pageId: targetParent },
        }),
      })).toMatchObject({
        ok: false,
        error: {
          code: "invalid_arguments",
          message: "Cross-owner Page moves cannot select both an ownership ancestor and its descendant",
        },
      });
    });
  });

  sqliteTest("rolls back every Page when a later move loses freshness", async () => {
    await withFixture((fixture) => {
      const parent = createPage(fixture, "rollback-parent", "Parent");
      const first = createPage(fixture, "rollback-first", "First");
      const second = createPage(fixture, "rollback-second", "Second");
      const prepared = prepareNodexAgentMovePages(fixture.database, {
        threadId: "thread-v3",
        callId: "move-rollback",
        projectId: fixture.projectId,
        input: MovePagesV3InputSchema.parse({
          pageIds: [first, second],
          destination: { kind: "page", pageId: parent },
        }),
      });
      if (!prepared.ok || prepared.value.kind !== "prepared") {
        throw new Error(`Move was not prepared: ${JSON.stringify(prepared)}`);
      }
      const secondStep = prepared.value.command.transfers[1];
      if (!secondStep) throw new Error("Second move step is unavailable");
      if (!secondStep.transfer) throw new Error("Second move transfer is unavailable");
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

      const executed = executeNodexAgentMovePages(fixture.database, staleCommand);
      expect(executed).toMatchObject({
        ok: false,
        error: { code: "conflict" },
      });
      expect(pageSnapshot(fixture, first).resource.location).toMatchObject({ kind: "library" });
      expect(pageSnapshot(fixture, second).resource.location).toMatchObject({ kind: "library" });
      const nested = fixture.database.prepare(
        "SELECT block_id FROM document_block_index WHERE block_id IN (?, ?)",
      ).all(first, second);
      expect(nested).toEqual([]);
    });
  });

  sqliteTest("repositions Pages in one Data Source without exposing property edits", async () => {
    await withFixture((fixture) => {
      const { database, view } = context(fixture);
      const dataSourceId = defaultDataSourceId(fixture, database.databaseId);
      const first = createPage(fixture, "same-db-first", "First", {
        kind: "data_source",
        dataSourceId,
        view: { viewId: view.viewId, groupKey: "triage" },
      });
      const second = createPage(fixture, "same-db-second", "Second", {
        kind: "data_source",
        dataSourceId,
        view: { viewId: view.viewId, groupKey: "triage" },
      });
      const input = MovePagesV3InputSchema.parse({
        pageIds: [second, first],
        destination: {
          kind: "data_source",
          dataSourceId,
          view: { viewId: view.viewId, groupKey: "build" },
        },
      });
      const prepared = prepareNodexAgentMovePages(fixture.database, {
        threadId: "thread-v3",
        callId: "same-db-placement",
        projectId: fixture.projectId,
        input,
      });
      if (!prepared.ok || prepared.value.kind !== "prepared") {
        throw new Error(`Move was not prepared: ${JSON.stringify(prepared)}`);
      }
      expect(prepared.value.command.transfers).toEqual([]);
      const executed = executeNodexAgentMovePages(
        fixture.database,
        prepared.value.command,
      );
      if (!executed.ok) throw new Error(executed.error.message);
      const positions = fixture.database.prepare(
        `
        SELECT page_block_id AS block_id, group_key
        FROM database_view_page_positions
        WHERE view_id = ? AND block_id IN (?, ?)
        ORDER BY rank_key, block_id
      `).all(view.viewId, first, second) as readonly {
        readonly block_id: string;
        readonly group_key: string | null;
      }[];
      expect(positions).toEqual([
        { block_id: second, group_key: "build" },
        { block_id: first, group_key: "build" },
      ]);

      const rejected = prepareNodexAgentMovePages(fixture.database, {
        threadId: "thread-v3",
        callId: "same-db-values",
        projectId: fixture.projectId,
        input: MovePagesV3InputSchema.parse({
          pageIds: [first],
          destination: {
            kind: "data_source",
            dataSourceId,
            values: [{ propertyId: "not-an-edit-endpoint", value: "Ship" }],
            view: { viewId: view.viewId, groupKey: "build" },
          },
        }),
      });
      expect(rejected).toMatchObject({
        ok: false,
        error: { code: "not_found" },
      });
    });
  });

});
