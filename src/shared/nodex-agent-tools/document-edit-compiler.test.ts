import { describe, expect, test } from "vitest";
import {
  createPageDocumentGenesis,
  type PageDocumentMaterialization,
} from "../block-documents/block-document-codec";
import {
  AgentDocumentEditCompilerError,
  applyExactNfmPatches,
  compileAgentDocumentEdit,
} from "./document-edit-compiler";
import { EditDocumentInputSchema } from "./write-schemas";

const ETAG = `nxe1.${"a".repeat(43)}`;

function materialization(
  nfm: string,
  title = "Before",
): PageDocumentMaterialization {
  let nextId = 0;
  const genesis = createPageDocumentGenesis({
    documentId: "document-1",
    title,
    nfm,
    allocateBlockId: () => `existing-${++nextId}`,
  });
  try {
    return genesis.materialization;
  } finally {
    genesis.document.destroy();
  }
}

function edit(value: unknown) {
  return EditDocumentInputSchema.parse(value);
}

function allocator(prefix: string): () => string {
  let nextId = 0;
  return () => `${prefix}-${++nextId}`;
}

describe("Nodex Agent Document edit compiler", () => {
  test("inserts a nested multi-Block NFM fragment at one structural anchor", () => {
    const compiled = compileAgentDocumentEdit({
      documentId: "document-1",
      current: materialization("Existing"),
      edit: edit({
        documentId: "document-1",
        body: {
          kind: "nfm.insert",
          at: { kind: "end" },
          content: "# Added\nParent\n\t- [ ] Nested task",
        },
      }),
      allocateBlockId: allocator("created"),
    });

    expect(compiled.mutation).toMatchObject({
      kind: "operations",
      operations: [
        expect.objectContaining({
          kind: "insert_block",
          block: expect.objectContaining({ id: "created-1", type: "heading" }),
        }),
        expect.objectContaining({
          kind: "insert_block",
          block: expect.objectContaining({
            id: "created-2",
            children: [expect.objectContaining({ id: "created-3", type: "checkListItem" })],
          }),
        }),
      ],
    });
    expect(compiled.materialization.nfm).toBe(
      "Existing\n# Added\nParent\n\t- [ ] Nested task",
    );
    expect(compiled.effects.createdBlockIds).toEqual([
      "created-1",
      "created-2",
      "created-3",
    ]);
  });

  test("applies every exact NFM patch against one original string", () => {
    expect(applyExactNfmPatches("Alpha\nBeta", [
      { oldNfm: "Alpha", newNfm: "Beta" },
      { oldNfm: "Beta", newNfm: "Gamma" },
    ])).toBe("Beta\nGamma");

    const compiled = compileAgentDocumentEdit({
      documentId: "document-1",
      current: materialization("Alpha\nBeta"),
      edit: edit({
        documentId: "document-1",
        body: {
          kind: "nfm.patch",
          patches: [
            { oldNfm: "Alpha", newNfm: "Beta" },
            { oldNfm: "Beta", newNfm: "Gamma" },
          ],
        },
      }),
      allocateBlockId: allocator("patch"),
    });
    expect(compiled.materialization.nfm).toBe("Beta\nGamma");
    expect(compiled.mutation).toMatchObject({ kind: "replace_nfm", nfm: "Beta\nGamma" });
  });

  test("rejects match-count mismatches and overlapping source spans", () => {
    expect(() => applyExactNfmPatches("One", [
      { oldNfm: "Missing", newNfm: "Next" },
    ])).toThrowError(expect.objectContaining<Partial<AgentDocumentEditCompilerError>>({
      code: "nfm_patch_mismatch",
    }));
    expect(() => applyExactNfmPatches("aaa", [
      { oldNfm: "aa", newNfm: "b", expectedMatches: 2 },
    ])).toThrowError(expect.objectContaining<Partial<AgentDocumentEditCompilerError>>({
      code: "nfm_patch_overlap",
    }));
  });

  test("preflights an atomic rich-title plus whole-NFM replacement", () => {
    const compiled = compileAgentDocumentEdit({
      documentId: "document-1",
      current: materialization("Old body"),
      edit: edit({
        documentId: "document-1",
        title: {
          value: {
            kind: "rich",
            richText: [{ type: "text", text: "New title", styles: { bold: true } }],
          },
          ifMatch: ETAG,
        },
        body: { kind: "nfm.replace", content: "# New body", ifMatch: ETAG },
      }),
      allocateBlockId: allocator("replace"),
    });

    expect(compiled.materialization.title).toBe("New title");
    expect(compiled.materialization.nfm).toBe("# New body");
    expect(compiled.effects.titleChanged).toBe(true);
    expect(compiled.mutation).toMatchObject({
      kind: "replace_nfm",
      richTitle: [{ type: "text", text: "New title", styles: { bold: true } }],
    });
  });

  test("requires explicit safety intent before deleting an owned Card shell", () => {
    const current = materialization('<page uuid="nested-card" />\nKeep');
    const compile = (allowDeletingOwnedBlocks: boolean | undefined) =>
      compileAgentDocumentEdit({
        documentId: "document-1",
        current,
        edit: edit({
          documentId: "document-1",
          body: { kind: "nfm.replace", content: "Keep", ifMatch: ETAG },
          ...(allowDeletingOwnedBlocks === undefined ? {} : {
            safety: { allowDeletingOwnedBlocks },
          }),
        }),
        allocateBlockId: allocator("replace"),
      });

    expect(() => compile(undefined)).toThrowError(
      expect.objectContaining<Partial<AgentDocumentEditCompilerError>>({
        code: "protected_owner_deletion",
      }),
    );
    expect(compile(true).effects.deletedOwnerBlockIds).toEqual(["existing-1"]);
  });

  test("moves a stable Block without changing its identity", () => {
    const current = materialization("First\nSecond");
    const [first, second] = current.blockTree;
    if (!first || !second) throw new Error("Fixture did not create two Blocks");
    const compiled = compileAgentDocumentEdit({
      documentId: "document-1",
      current,
      edit: edit({
        documentId: "document-1",
        body: {
          kind: "blocks",
          edits: [{
            kind: "move",
            blockId: second.id,
            at: { kind: "before", blockId: first.id },
          }],
        },
      }),
      allocateBlockId: allocator("unused"),
    });

    expect(compiled.materialization.nfm).toBe("Second\nFirst");
    expect(compiled.effects.movedBlockIds).toContain(second.id);
    expect(compiled.effects.createdBlockIds).toEqual([]);
  });
});
