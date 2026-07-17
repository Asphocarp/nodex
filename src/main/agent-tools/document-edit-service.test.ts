import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { describe, expect, test } from "vitest";
import { createUuidV7 } from "../../shared/uuid-v7";
import type { DocumentMutationRequest } from "../../shared/block-documents";
import type { FrozenNodexAgentTurnAuthority } from "../../shared/nodex-agent-authority";
import {
  BlockIdSchema,
  AdvancedUpdatePageV3InputSchema,
  EditDocumentInputSchema,
  UpdatePageV3InputSchema,
  type BlockId,
  type EditDocumentInput,
} from "../../shared/nodex-agent-tools";
import {
  applyDocumentOperationBatch,
  replaceDocumentFromNfm,
} from "../local-store/block-document-operations";
import { readBlockStoreEpoch } from "../local-store/block-store-metadata";
import { closeDatabase, getDb, initializeDatabase } from "../local-store/database";
import { createPageLifecycleV2Fixture } from "../local-store/page-lifecycle-v2-test-fixture";
import { createProject, setProjectLifecycle } from "../local-store/projects";
import {
  assertNodexAgentResourceAuthorizationInDatabase,
  putProjectResourceGrantInDatabase,
} from "../local-store/project-resource-grants";
import {
  completeNodexAgentDocumentEdit,
  prepareNodexAgentDocumentEdit,
} from "./document-edit-service";
import {
  completeNodexAgentPageUpdate,
  prepareNodexAgentPageUpdate,
} from "./page-update-v3";
import { readNodexAgentV3Tool } from "./read-v3";

interface Fixture {
  readonly database: Database.Database;
  readonly projectId: string;
  readonly storeEpoch: string;
}

interface DocumentSnapshot {
  readonly documentId: string;
  readonly nfm: string;
  readonly titleEtag: string;
  readonly bodyEtag: string;
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
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "nodex-agent-edit-"));
  process.env.NODEX_DIR = directory;
  try {
    await initializeDatabase();
    const project = createProject({ name: "Agent edit project" });
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
  createPageLifecycleV2Fixture(fixture.database, {
    operationId: createUuidV7(),
    projectId,
    storeEpoch: fixture.storeEpoch,
    clientSessionId: "agent-edit-test",
    actor: { kind: "test" },
    operation: {
      kind: "create_page",
      pageId: cardId,
      title: input.title,
      nfm: input.nfm,
      status: "draft",
    },
  });
  return BlockIdSchema.parse(cardId);
}

function readDocument(fixture: Fixture, pageId: BlockId): DocumentSnapshot {
  const result = readNodexAgentV3Tool(fixture.database, {
    tool: "fetch",
    projectId: fixture.projectId,
    input: {
      id: pageId,
      prepareFor: [{ kind: "title" }, { kind: "body" }],
    },
  });
  if (!result.ok || result.tool !== "fetch") {
    throw new Error("Could not read fixture Page");
  }
  const content = result.output.data.content;
  if (!content || content.format !== "markdown") {
    throw new Error("Fixture Page has no Markdown content");
  }
  const titleEtag = result.output.data.resource.title?.etag;
  const bodyEtag = content.etag;
  if (!titleEtag || !bodyEtag) throw new Error("Fixture write ETags are unavailable");
  const ownership = fixture.database.prepare(
    "SELECT document_id FROM block_documents WHERE block_id = ?",
  ).get(pageId) as { readonly document_id: string } | undefined;
  if (!ownership) throw new Error("Fixture Page has no owned Document");
  return {
    documentId: ownership.document_id,
    nfm: content.markdown,
    titleEtag,
    bodyEtag,
  };
}

function applyMutation(fixture: Fixture, mutation: DocumentMutationRequest) {
  const initial = "operations" in mutation
    ? applyDocumentOperationBatch(fixture.database, mutation)
    : "nfm" in mutation
      ? replaceDocumentFromNfm(fixture.database, mutation)
      : (() => {
        throw new Error("Unexpected history restore mutation");
      })();
  if (initial.ok || initial.error.code !== "write_fence_required") return initial;
  const options = {
    writeFence: {
      leaseId: `test-lease:${mutation.mutationId}`,
      documentId: mutation.documentId,
      generation: mutation.generation,
      headSeq: mutation.expectedHeadSeq,
    },
  };
  return "operations" in mutation
    ? applyDocumentOperationBatch(fixture.database, mutation, options)
    : "nfm" in mutation
      ? replaceDocumentFromNfm(fixture.database, mutation, options)
      : initial;
}

function edit(value: unknown): EditDocumentInput {
  return EditDocumentInputSchema.parse(value);
}

function fullAccessAuthority(fixture: Fixture): FrozenNodexAgentTurnAuthority {
  const coordinate = fixture.database.prepare(`
    SELECT library_id AS libraryId FROM projects WHERE id = ?
  `).get(fixture.projectId) as { readonly libraryId: string } | undefined;
  if (!coordinate) throw new Error("Project has no Library coordinate");
  return {
    threadId: "thread-edit-full",
    turnId: "turn-edit-full",
    rootThreadId: "thread-edit-full",
    actorProjectId: fixture.projectId,
    libraryId: coordinate.libraryId,
    storeEpoch: fixture.storeEpoch,
    scope: "library",
    source: "builtin_full_access",
  };
}

function prepare(
  fixture: Fixture,
  callId: string,
  input: EditDocumentInput,
) {
  return prepareNodexAgentDocumentEdit(fixture.database, {
    tool: "edit_document",
    threadId: "thread-1",
    callId,
    projectId: fixture.projectId,
    input,
  });
}

describe("Nodex Agent Document edit service", () => {
  sqliteTest("updates a foreign Page with ephemeral Full access and no grant", async () => {
    await withFixture((fixture) => {
      const owner = createProject({ name: "Full access Page owner" });
      const pageId = createCard(fixture, {
        title: "Foreign editable Page",
        nfm: "Original",
      }, owner.id);
      const authority = fullAccessAuthority(fixture);
      const prepared = prepareNodexAgentPageUpdate(fixture.database, {
        tool: "update_page",
        threadId: authority.threadId,
        callId: "update-full-access-page",
        authority,
        projectId: fixture.projectId,
        input: UpdatePageV3InputSchema.parse({
          pageId,
          body: {
            kind: "insert",
            at: { kind: "end" },
            markdown: "Full access edit",
          },
          return: ["markdown"],
        }),
      });
      if (!prepared.ok || prepared.value.kind !== "prepared") {
        throw new Error(`Full access update was not prepared: ${JSON.stringify(prepared)}`);
      }
      expect(prepared.value.mutation.projectId).toBe(owner.id);
      const committed = applyMutation(fixture, prepared.value.mutation);
      if (!committed.ok) throw new Error(committed.error.message);
      const completed = completeNodexAgentPageUpdate(fixture.database, {
        tool: "update_page",
        threadId: authority.threadId,
        callId: "update-full-access-page",
        authority,
        projectId: fixture.projectId,
        pageId,
        result: committed.value,
      });
      expect(completed.ok ? completed.output.data.body?.markdown : null)
        .toBe("Original\nFull access edit");
      expect(fixture.database.prepare(`
        SELECT COUNT(*) AS count FROM project_resource_grants
        WHERE project_id = ?
      `).get(fixture.projectId)).toEqual({ count: 0 });
    });
  });

  sqliteTest("revalidates frozen authority inside the Document mutation transaction", async () => {
    await withFixture((fixture) => {
      const owner = createProject({ name: "Execution-time Page owner" });
      const pageId = createCard(fixture, {
        title: "Execution-time guarded Page",
        nfm: "Original",
      }, owner.id);
      const authority = fullAccessAuthority(fixture);
      const prepared = prepareNodexAgentPageUpdate(fixture.database, {
        tool: "update_page",
        threadId: authority.threadId,
        callId: "execution-time-authority",
        authority,
        projectId: fixture.projectId,
        input: UpdatePageV3InputSchema.parse({
          pageId,
          body: {
            kind: "insert",
            at: { kind: "end" },
            markdown: "Must not commit",
          },
        }),
      });
      if (!prepared.ok || prepared.value.kind !== "prepared") {
        throw new Error(`Execution-time update was not prepared: ${JSON.stringify(prepared)}`);
      }
      const mutation = prepared.value.mutation;
      if (!("operations" in mutation)) {
        throw new Error("Execution-time update did not compile to block operations");
      }
      const before = fixture.database.prepare(`
        SELECT document.head_seq AS headSeq, materialization.nfm
        FROM documents document
        INNER JOIN document_materializations materialization
          ON materialization.document_id = document.id
        WHERE document.id = ?
      `).get(mutation.documentId);
      setProjectLifecycle(fixture.projectId, { lifecycle: "archived" });

      expect(() => applyDocumentOperationBatch(fixture.database, mutation, {
        writeFence: {
          leaseId: `test-lease:${mutation.mutationId}`,
          documentId: mutation.documentId,
          generation: mutation.generation,
          headSeq: mutation.expectedHeadSeq,
        },
        beforeMutationApply: () => {
          assertNodexAgentResourceAuthorizationInDatabase(fixture.database, {
            authority,
            resource: { kind: "page", pageId },
            action: "write",
          });
        },
      })).toThrow("project_read_only");
      expect(fixture.database.prepare(`
        SELECT document.head_seq AS headSeq, materialization.nfm
        FROM documents document
        INNER JOIN document_materializations materialization
          ON materialization.document_id = document.id
        WHERE document.id = ?
      `).get(mutation.documentId)).toEqual(before);
      expect(fixture.database.prepare(`
        SELECT status FROM nodex_agent_call_receipts WHERE call_id = ?
      `).get("execution-time-authority")).toEqual({ status: "prepared" });
    });
  });

  sqliteTest("updates a foreign Page through a recursive read-write grant", async () => {
    await withFixture((fixture) => {
      const owner = createProject({ name: "Granted Page owner" });
      const pageId = createCard(fixture, { title: "Shared Page", nfm: "Original" }, owner.id);
      putProjectResourceGrantInDatabase(fixture.database, {
        projectId: fixture.projectId,
        root: { kind: "page", pageId },
        access: "read_write",
      });
      const prepared = prepareNodexAgentPageUpdate(fixture.database, {
        tool: "update_page",
        threadId: "thread-granted",
        callId: "update-granted-page",
        projectId: fixture.projectId,
        input: UpdatePageV3InputSchema.parse({
          pageId,
          body: {
            kind: "insert",
            at: { kind: "end" },
            markdown: "Granted edit",
          },
          return: ["markdown"],
        }),
      });
      if (!prepared.ok || prepared.value.kind !== "prepared") {
        throw new Error(`Granted Page update was not prepared: ${JSON.stringify(prepared)}`);
      }
      expect(prepared.value.mutation.projectId).toBe(owner.id);
      const committed = applyMutation(fixture, prepared.value.mutation);
      if (!committed.ok) throw new Error(committed.error.message);
      const completed = completeNodexAgentPageUpdate(fixture.database, {
        tool: "update_page",
        threadId: "thread-granted",
        callId: "update-granted-page",
        projectId: fixture.projectId,
        pageId,
        result: committed.value,
      });
      expect(completed.ok ? completed.output.data.body?.markdown : null)
        .toBe("Original\nGranted edit");

      putProjectResourceGrantInDatabase(fixture.database, {
        projectId: fixture.projectId,
        root: { kind: "page", pageId },
        access: "read",
      });
      expect(prepareNodexAgentPageUpdate(fixture.database, {
        tool: "update_page",
        threadId: "thread-granted",
        callId: "update-read-only-page",
        projectId: fixture.projectId,
        input: UpdatePageV3InputSchema.parse({
          pageId,
          body: { kind: "insert", at: { kind: "end" }, markdown: "Denied" },
        }),
      })).toMatchObject({
        ok: false,
        error: { code: "authorization_denied" },
      });
    });
  });

  sqliteTest("adapts Card-first Nested Markdown updates and replays before stale guards", async () => {
    await withFixture((fixture) => {
      const cardId = createCard(fixture, { title: "Before", nfm: "Alpha\nKeep" });
      const before = readDocument(fixture, cardId);
      const input = UpdatePageV3InputSchema.parse({
        pageId: cardId,
        title: { markdown: "**After**", ifMatch: before.titleEtag },
        body: {
          kind: "patch",
          patches: [{ oldMarkdown: "Alpha", newMarkdown: "Beta" }],
        },
        return: ["markdown", "etags"],
      });
      const prepared = prepareNodexAgentPageUpdate(fixture.database, {
        tool: "update_page",
        threadId: "thread-v3",
        callId: "update-card",
        projectId: fixture.projectId,
        input,
      });
      if (!prepared.ok || prepared.value.kind !== "prepared") {
        throw new Error(`Card update was not prepared: ${JSON.stringify(prepared)}`);
      }
      expect(prepared.value.targetMarkdown).toBe("Beta\nKeep");
      const committed = applyMutation(fixture, prepared.value.mutation);
      if (!committed.ok) throw new Error(committed.error.message);
      const completed = completeNodexAgentPageUpdate(fixture.database, {
        tool: "update_page",
        threadId: "thread-v3",
        callId: "update-card",
        projectId: fixture.projectId,
        pageId: cardId,
        result: committed.value,
      });
      expect(completed.ok ? completed.output.data : null).toMatchObject({
        pageId: cardId,
        body: { format: "markdown", markdown: "Beta\nKeep" },
        etags: {
          title: expect.stringMatching(/^nxe1\./u),
          body: expect.stringMatching(/^nxe1\./u),
        },
      });
      const receipt = fixture.database.prepare(
        "SELECT tool FROM nodex_agent_call_receipts WHERE call_id = ?",
      ).get("update-card") as { readonly tool: string };
      expect(receipt.tool).toBe("update_page");

      const mismatch = prepareNodexAgentPageUpdate(fixture.database, {
        tool: "update_page",
        threadId: "thread-v3",
        callId: "patch-mismatch",
        projectId: fixture.projectId,
        input: UpdatePageV3InputSchema.parse({
          pageId: cardId,
          body: {
            kind: "patch",
            patches: [{ oldMarkdown: "Missing", newMarkdown: "Replacement" }],
          },
        }),
      });
      expect(mismatch).toMatchObject({
        ok: false,
        error: { code: "conflict", recovery: "fetch_again" },
      });
      expect(JSON.stringify(mismatch)).not.toMatch(/nfm/iu);

      const current = readDocument(fixture, cardId);
      const concurrent = prepare(fixture, "concurrent", edit({
        documentId: current.documentId,
        body: {
          kind: "nfm.replace",
          ifMatch: current.bodyEtag,
          content: "Concurrent",
        },
      }));
      if (!concurrent.ok || concurrent.value.kind !== "prepared") {
        throw new Error("Concurrent update was not prepared");
      }
      const concurrentCommit = applyMutation(fixture, concurrent.value.mutation);
      if (!concurrentCommit.ok) throw new Error(concurrentCommit.error.message);

      const replayed = prepareNodexAgentPageUpdate(fixture.database, {
        tool: "update_page",
        threadId: "thread-v3",
        callId: "update-card",
        projectId: fixture.projectId,
        input,
      });
      expect(replayed.ok && replayed.value.kind === "completed"
        ? replayed.value.output.data.body
        : null).toMatchObject({ markdown: "Beta\nKeep" });
      expect(readDocument(fixture, cardId).nfm).toBe("Concurrent");
    });
  });

  sqliteTest("routes advanced stable-Block updates through the same receipt kernel", async () => {
    await withFixture((fixture) => {
      const cardId = createCard(fixture, { title: "Advanced", nfm: "Paragraph" });
      const fetched = readNodexAgentV3Tool(fixture.database, {
        tool: "fetch",
        projectId: fixture.projectId,
        input: {
          id: cardId,
          format: "blocks",
        },
      });
      if (!fetched.ok || fetched.tool !== "fetch") throw new Error("Fetch failed");
      const block = fetched.output.data.content?.format === "blocks"
        ? fetched.output.data.content.blocks[0]
        : undefined;
      if (!block) throw new Error("Fixture body Block is unavailable");
      const preparedFetch = readNodexAgentV3Tool(fixture.database, {
        tool: "fetch",
        projectId: fixture.projectId,
        input: {
          id: cardId,
          format: "blocks",
          prepareFor: [{ kind: "block_update", blockIds: [block.id] }],
        },
      });
      if (!preparedFetch.ok || preparedFetch.tool !== "fetch") {
        throw new Error("Prepared fetch failed");
      }
      const preparedBlock = preparedFetch.output.data.content?.format === "blocks"
        ? preparedFetch.output.data.content.blocks[0]
        : undefined;
      if (!preparedBlock?.etag) throw new Error("Block update ETag is unavailable");
      const input = AdvancedUpdatePageV3InputSchema.parse({
        pageId: cardId,
        edits: [{
          kind: "update",
          blockId: preparedBlock.id,
          ifMatch: preparedBlock.etag,
          patch: { props: { textAlignment: "center" } },
        }],
      });
      const prepared = prepareNodexAgentPageUpdate(fixture.database, {
        tool: "advanced_update_page",
        threadId: "thread-v3",
        callId: "advanced-update",
        projectId: fixture.projectId,
        input,
      });
      if (!prepared.ok || prepared.value.kind !== "prepared") {
        throw new Error(`Advanced update was not prepared: ${JSON.stringify(prepared)}`);
      }
      const committed = applyMutation(fixture, prepared.value.mutation);
      if (!committed.ok) throw new Error(committed.error.message);
      const completed = completeNodexAgentPageUpdate(fixture.database, {
        tool: "advanced_update_page",
        threadId: "thread-v3",
        callId: "advanced-update",
        projectId: fixture.projectId,
        pageId: cardId,
        result: committed.value,
      });
      expect(completed.ok ? completed.output.data : null).toMatchObject({
        pageId: cardId,
        effects: { updated: 1 },
      });
      const receipt = fixture.database.prepare(
        "SELECT tool FROM nodex_agent_call_receipts WHERE call_id = ?",
      ).get("advanced-update") as { readonly tool: string };
      expect(receipt.tool).toBe("advanced_update_page");
    });
  });

  sqliteTest("appends a nested multi-Block NFM fragment in one committed call", async () => {
    await withFixture((fixture) => {
      const cardId = createCard(fixture, { title: "Before", nfm: "Existing" });
      const before = readDocument(fixture, cardId);
      const prepared = prepare(fixture, "append", edit({
        documentId: before.documentId,
        body: {
          kind: "nfm.insert",
          at: { kind: "end" },
          content: "# Added\nParent\n\t- [ ] Nested task",
        },
        return: { nfm: true, blockIds: true },
      }));
      expect(prepared.ok).toBe(true);
      if (!prepared.ok || prepared.value.kind !== "prepared") return;

      const committed = applyMutation(fixture, prepared.value.mutation);
      expect(committed.ok).toBe(true);
      if (!committed.ok) return;
      const completed = completeNodexAgentDocumentEdit(fixture.database, {
        tool: "edit_document",
        threadId: "thread-1",
        callId: "append",
        projectId: fixture.projectId,
        result: committed.value,
      });

      expect(completed.ok ? completed.output.data : null).toMatchObject({
        documentId: before.documentId,
        body: {
          format: "nfm",
          content: "Existing\n# Added\nParent\n\t- [ ] Nested task",
        },
        effects: {
          created: expect.any(Number),
          blockIds: { created: expect.arrayContaining([expect.any(String)]) },
        },
      });
      expect(readDocument(fixture, cardId).nfm).toBe(
        "Existing\n# Added\nParent\n\t- [ ] Nested task",
      );
    });
  });

  sqliteTest("commits rich title and whole NFM replacement atomically", async () => {
    await withFixture((fixture) => {
      const cardId = createCard(fixture, { title: "Before", nfm: "Old body" });
      const before = readDocument(fixture, cardId);
      const prepared = prepare(fixture, "replace", edit({
        documentId: before.documentId,
        title: {
          value: {
            kind: "rich",
            richText: [{ type: "text", text: "After", styles: { bold: true } }],
          },
          ifMatch: before.titleEtag,
        },
        body: { kind: "nfm.replace", ifMatch: before.bodyEtag, content: "# New body" },
        return: { nfm: true },
      }));
      if (!prepared.ok || prepared.value.kind !== "prepared") {
        throw new Error("Edit was not prepared");
      }
      const committed = applyMutation(fixture, prepared.value.mutation);
      if (!committed.ok) throw new Error(committed.error.message);
      const completed = completeNodexAgentDocumentEdit(fixture.database, {
        tool: "edit_document",
        threadId: "thread-1",
        callId: "replace",
        projectId: fixture.projectId,
        result: committed.value,
      });

      expect(completed.ok ? completed.output.data.body : null).toMatchObject({
        format: "nfm",
        content: "# New body",
      });
      const row = fixture.database.prepare(
        "SELECT title, nfm FROM document_materializations WHERE document_id = ?",
      ).get(before.documentId) as { readonly title: string; readonly nfm: string };
      expect(row).toEqual({ title: "After", nfm: "# New body" });
    });
  });

  sqliteTest("recovers a committed mutation after response loss without writing twice", async () => {
    await withFixture((fixture) => {
      const cardId = createCard(fixture, { title: "Retry", nfm: "One" });
      const before = readDocument(fixture, cardId);
      const input = edit({
        documentId: before.documentId,
        body: {
          kind: "blocks",
          edits: [{
            kind: "insert",
            at: { kind: "end" },
            block: {
              localId: "new-paragraph",
              type: "paragraph",
              content: [{ type: "text", text: "Two", styles: {} }],
            },
          }],
        },
        return: { nfm: true, blockIds: true },
      });
      const first = prepare(fixture, "lost-response", input);
      if (!first.ok || first.value.kind !== "prepared") {
        throw new Error(`Edit was not prepared: ${JSON.stringify(first)}`);
      }
      const second = prepare(fixture, "lost-response", input);
      if (!second.ok || second.value.kind !== "prepared") {
        throw new Error("Edit was not prepared twice");
      }
      expect(second.value.mutation).toEqual(first.value.mutation);

      const committed = applyMutation(fixture, first.value.mutation);
      if (!committed.ok) throw new Error(committed.error.message);
      const recovered = prepare(fixture, "lost-response", input);

      expect(recovered.ok && recovered.value.kind === "completed"
        ? recovered.value.output.data
        : null).toMatchObject({
          effects: {
            created: 1,
            blockIds: {
              local: { "new-paragraph": expect.any(String) },
              created: [expect.any(String)],
            },
          },
          body: { format: "nfm", content: "One\nTwo" },
        });
      const replayed = prepare(fixture, "lost-response", input);
      expect(replayed.ok && replayed.value.kind === "completed"
        ? replayed.value.output.data
        : null).toMatchObject({
          body: { format: "nfm", content: "One\nTwo" },
        });
      expect(readDocument(fixture, cardId).nfm).toBe("One\nTwo");
      const writes = fixture.database.prepare(
        "SELECT COUNT(*) AS count FROM block_mutations WHERE mutation_id = ?",
      ).get(first.value.mutation.mutationId) as { readonly count: number };
      expect(writes.count).toBe(1);
    });
  });

  sqliteTest("rejects stale ETags and reused call identities with changed semantics", async () => {
    await withFixture((fixture) => {
      const cardId = createCard(fixture, { title: "Conflict", nfm: "Alpha" });
      const before = readDocument(fixture, cardId);
      const firstInput = edit({
        documentId: before.documentId,
        body: { kind: "nfm.replace", ifMatch: before.bodyEtag, content: "Beta" },
      });
      const prepared = prepare(fixture, "same-call", firstInput);
      if (!prepared.ok || prepared.value.kind !== "prepared") {
        throw new Error("Edit was not prepared");
      }

      const changedSemantics = prepare(fixture, "same-call", edit({
        ...firstInput,
        body: { kind: "nfm.replace", ifMatch: before.bodyEtag, content: "Gamma" },
      }));
      expect(changedSemantics).toMatchObject({
        ok: false,
        error: { code: "idempotency_collision" },
      });

      const other = applyMutation(fixture, {
        ...prepared.value.mutation,
        mutationId: createUuidV7(),
      });
      if (!other.ok) throw new Error(other.error.message);
      const stale = prepare(fixture, "stale-call", firstInput);
      expect(stale).toMatchObject({
        ok: false,
        error: { code: "conflict", recovery: "get_block_again" },
      });
    });
  });
});
