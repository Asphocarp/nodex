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
  EditDocumentInputSchema,
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
import { readNodexAgentTool } from "./read-service";

interface Fixture {
  readonly database: Database.Database;
  readonly projectId: string;
  readonly storeEpoch: string;
}

interface DocumentSnapshot {
  readonly documentId: string;
  readonly revision: string;
  readonly nfm: string;
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
    input: { blockId: cardId },
  });
  if (!result.ok || result.tool !== "get_block") {
    throw new Error("Could not read fixture Card");
  }
  const document = result.output.data.document;
  if (!document || document.body.format !== "nfm") {
    throw new Error("Fixture Card has no NFM Document");
  }
  return {
    documentId: document.documentId,
    revision: document.revision,
    nfm: document.body.content,
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
    threadId: "thread-1",
    callId,
    projectId: fixture.projectId,
    input,
  });
}

describe("Nodex Agent Document edit service", () => {
  sqliteTest("appends a nested multi-Block NFM fragment in one committed call", async () => {
    await withFixture((fixture) => {
      const cardId = createCard(fixture, { title: "Before", nfm: "Existing" });
      const before = readDocument(fixture, cardId);
      const prepared = prepare(fixture, "append", edit({
        documentId: before.documentId,
        ifRevision: before.revision,
        body: {
          kind: "nfm.insert",
          at: { kind: "end" },
          content: "# Added\nParent\n\t- [ ] Nested task",
        },
      }));
      expect(prepared.ok).toBe(true);
      if (!prepared.ok || prepared.value.kind !== "prepared") return;

      const committed = applyMutation(fixture, prepared.value.mutation);
      expect(committed.ok).toBe(true);
      if (!committed.ok) return;
      const completed = completeNodexAgentDocumentEdit(fixture.database, {
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
        effects: { createdBlockIds: expect.arrayContaining([expect.any(String)]) },
        receipt: { duplicate: false },
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
        ifRevision: before.revision,
        title: {
          kind: "rich",
          richText: [{ type: "text", text: "After", styles: { bold: true } }],
        },
        body: { kind: "nfm.replace", content: "# New body" },
      }));
      if (!prepared.ok || prepared.value.kind !== "prepared") {
        throw new Error("Edit was not prepared");
      }
      const committed = applyMutation(fixture, prepared.value.mutation);
      if (!committed.ok) throw new Error(committed.error.message);
      const completed = completeNodexAgentDocumentEdit(fixture.database, {
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
        ifRevision: before.revision,
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
            localBlockIds: { "new-paragraph": expect.any(String) },
            createdBlockIds: [expect.any(String)],
          },
          body: { format: "nfm", content: "One\nTwo" },
          receipt: { duplicate: true },
        });
      const replayed = prepare(fixture, "lost-response", input);
      expect(replayed.ok && replayed.value.kind === "completed"
        ? replayed.value.output.data
        : null).toMatchObject({
          body: { contentOmitted: true },
          receipt: { duplicate: true },
        });
      expect(readDocument(fixture, cardId).nfm).toBe("One\nTwo");
      const writes = fixture.database.prepare(
        "SELECT COUNT(*) AS count FROM block_mutations WHERE mutation_id = ?",
      ).get(first.value.mutation.mutationId) as { readonly count: number };
      expect(writes.count).toBe(1);
    });
  });

  sqliteTest("rejects stale revisions and reused call identities with changed semantics", async () => {
    await withFixture((fixture) => {
      const cardId = createCard(fixture, { title: "Conflict", nfm: "Alpha" });
      const before = readDocument(fixture, cardId);
      const firstInput = edit({
        documentId: before.documentId,
        ifRevision: before.revision,
        body: { kind: "nfm.patch", patches: [{ oldNfm: "Alpha", newNfm: "Beta" }] },
      });
      const prepared = prepare(fixture, "same-call", firstInput);
      if (!prepared.ok || prepared.value.kind !== "prepared") {
        throw new Error("Edit was not prepared");
      }

      const changedSemantics = prepare(fixture, "same-call", edit({
        ...firstInput,
        body: { kind: "nfm.patch", patches: [{ oldNfm: "Alpha", newNfm: "Gamma" }] },
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
