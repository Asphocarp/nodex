import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { describe, expect, test } from "vitest";
import { createUuidV7 } from "../../shared/card-id";
import { parseCardLifecycleMutationRequest } from "../../shared/card-lifecycle";
import type { DocumentMutationRequest } from "../../shared/block-documents";
import {
  BlockIdSchema,
  AdvancedUpdateCardV3InputSchema,
  EditDocumentInputSchema,
  UpdateCardV3InputSchema,
  type BlockId,
  type EditDocumentInput,
} from "../../shared/nodex-agent-tools";
import { applyCardLifecycleMutation } from "../local-store/card-block-lifecycle";
import {
  applyDocumentOperationBatch,
  replaceDocumentFromNfm,
} from "../local-store/block-document-operations";
import { readBlockStoreEpoch } from "../local-store/block-store-metadata";
import { closeDatabase, getDb, initializeDatabase } from "../local-store/database";
import { createProject } from "../local-store/projects";
import {
  completeNodexAgentDocumentEdit,
  prepareNodexAgentDocumentEdit,
} from "./document-edit-service";
import {
  completeNodexAgentCardUpdate,
  prepareNodexAgentCardUpdate,
} from "./card-update-v3";
import { readNodexAgentTool } from "./read-service";

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
): BlockId {
  const cardId = createUuidV7();
  const request = parseCardLifecycleMutationRequest({
    version: 1,
    operationId: createUuidV7(),
    projectId: fixture.projectId,
    storeEpoch: fixture.storeEpoch,
    clientSessionId: "agent-edit-test",
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

function readDocument(fixture: Fixture, cardId: BlockId): DocumentSnapshot {
  const result = readNodexAgentTool(fixture.database, {
    tool: "get_block",
    projectId: fixture.projectId,
    input: {
      blockId: cardId,
      prepareFor: [{ kind: "title.set" }, { kind: "document.replace" }],
    },
  });
  if (!result.ok || result.tool !== "get_block") {
    throw new Error("Could not read fixture Card");
  }
  const document = result.output.data.document;
  if (!document || document.body.format !== "nfm") {
    throw new Error("Fixture Card has no NFM Document");
  }
  const titleEtag = result.output.data.block.title?.etag;
  const bodyEtag = document.body.etag;
  if (!titleEtag || !bodyEtag) throw new Error("Fixture write ETags are unavailable");
  return {
    documentId: document.documentId,
    nfm: document.body.content,
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
  sqliteTest("adapts Card-first Nested Markdown updates and replays before stale guards", async () => {
    await withFixture((fixture) => {
      const cardId = createCard(fixture, { title: "Before", nfm: "Alpha\nKeep" });
      const before = readDocument(fixture, cardId);
      const input = UpdateCardV3InputSchema.parse({
        cardId,
        title: { markdown: "**After**", ifMatch: before.titleEtag },
        body: {
          kind: "patch",
          patches: [{ oldMarkdown: "Alpha", newMarkdown: "Beta" }],
        },
        return: ["markdown", "etags"],
      });
      const prepared = prepareNodexAgentCardUpdate(fixture.database, {
        tool: "update_card",
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
      const completed = completeNodexAgentCardUpdate(fixture.database, {
        tool: "update_card",
        threadId: "thread-v3",
        callId: "update-card",
        projectId: fixture.projectId,
        cardId,
        result: committed.value,
      });
      expect(completed.ok ? completed.output.data : null).toMatchObject({
        cardId,
        body: { format: "markdown", markdown: "Beta\nKeep" },
        etags: {
          title: expect.stringMatching(/^nxe1\./u),
          body: expect.stringMatching(/^nxe1\./u),
        },
      });
      const receipt = fixture.database.prepare(
        "SELECT tool FROM nodex_agent_call_receipts WHERE call_id = ?",
      ).get("update-card") as { readonly tool: string };
      expect(receipt.tool).toBe("update_card");

      const mismatch = prepareNodexAgentCardUpdate(fixture.database, {
        tool: "update_card",
        threadId: "thread-v3",
        callId: "patch-mismatch",
        projectId: fixture.projectId,
        input: UpdateCardV3InputSchema.parse({
          cardId,
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

      const replayed = prepareNodexAgentCardUpdate(fixture.database, {
        tool: "update_card",
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
      const fetched = readNodexAgentTool(fixture.database, {
        tool: "get_block",
        projectId: fixture.projectId,
        input: {
          blockId: cardId,
          include: { document: { format: "blocks" } },
          prepareFor: [{ kind: "block.update", blockIds: [] }],
        },
      });
      if (!fetched.ok || fetched.tool !== "get_block") throw new Error("Fetch failed");
      const block = fetched.output.data.document?.body.format === "blocks"
        ? fetched.output.data.document.body.blocks[0]
        : undefined;
      if (!block) throw new Error("Fixture body Block is unavailable");
      const preparedFetch = readNodexAgentTool(fixture.database, {
        tool: "get_block",
        projectId: fixture.projectId,
        input: {
          blockId: cardId,
          include: { document: { format: "blocks" } },
          prepareFor: [{ kind: "block.update", blockIds: [block.blockId] }],
        },
      });
      if (!preparedFetch.ok || preparedFetch.tool !== "get_block") {
        throw new Error("Prepared fetch failed");
      }
      const preparedBlock = preparedFetch.output.data.document?.body.format === "blocks"
        ? preparedFetch.output.data.document.body.blocks[0]
        : undefined;
      if (!preparedBlock?.etag) throw new Error("Block update ETag is unavailable");
      const input = AdvancedUpdateCardV3InputSchema.parse({
        cardId,
        edits: [{
          kind: "update",
          blockId: preparedBlock.blockId,
          ifMatch: preparedBlock.etag,
          patch: { props: { textAlignment: "center" } },
        }],
      });
      const prepared = prepareNodexAgentCardUpdate(fixture.database, {
        tool: "advanced_update_card",
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
      const completed = completeNodexAgentCardUpdate(fixture.database, {
        tool: "advanced_update_card",
        threadId: "thread-v3",
        callId: "advanced-update",
        projectId: fixture.projectId,
        cardId,
        result: committed.value,
      });
      expect(completed.ok ? completed.output.data : null).toMatchObject({
        cardId,
        effects: { updated: 1 },
      });
      const receipt = fixture.database.prepare(
        "SELECT tool FROM nodex_agent_call_receipts WHERE call_id = ?",
      ).get("advanced-update") as { readonly tool: string };
      expect(receipt.tool).toBe("advanced_update_card");
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
