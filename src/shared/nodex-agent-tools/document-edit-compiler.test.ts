import { describe, expect, test } from "vite-plus/test";
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

function materialization(nfm: string, title = "Before"): PageDocumentMaterialization {
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
  test("promotes an empty Document seed for the first root insertion", () => {
    const current = materialization("");
    const seed = current.blockTree[0];
    if (!seed) throw new Error("Empty Document fixture has no editable seed");
    let allocations = 0;
    const compiled = compileAgentDocumentEdit({
      documentId: "document-1",
      current,
      edit: edit({
        documentId: "document-1",
        body: { kind: "nfm.insert", at: { kind: "end" }, content: "Hello" },
      }),
      allocateBlockId: () => `created-${++allocations}`,
    });

    expect(compiled.mutation).toEqual({
      kind: "operations",
      operations: [
        {
          kind: "update_block",
          blockId: seed.id,
          patch: expect.objectContaining({ content: expect.any(Array) }),
        },
      ],
    });
    expect(compiled.materialization.nfm).toBe("Hello");
    expect(compiled.materialization.blockTree[0]?.id).toBe(seed.id);
    expect(compiled.effects.createdBlockIds).toEqual([]);
    expect(compiled.effects.updatedBlockIds).toEqual([seed.id]);
    expect(compiled.destructive).toBe(false);
    expect(allocations).toBe(0);
  });

  test("preserves an explicit empty first Block while promoting its seed identity", () => {
    const current = materialization("");
    const seed = current.blockTree[0];
    if (!seed) throw new Error("Empty Document fixture has no editable seed");
    const compiled = compileAgentDocumentEdit({
      documentId: "document-1",
      current,
      edit: edit({
        documentId: "document-1",
        body: {
          kind: "nfm.insert",
          at: { kind: "start" },
          content: "<empty-block/>\nHello",
        },
      }),
      allocateBlockId: allocator("created"),
    });

    expect(compiled.materialization.nfm).toBe("<empty-block/>\nHello");
    expect(compiled.materialization.blockTree.map((block) => block.id)).toEqual([
      seed.id,
      "created-1",
    ]);
    expect(compiled.effects.createdBlockIds).toEqual(["created-1"]);
    expect(compiled.effects.deletedBlockIds).toEqual([]);
  });

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
    expect(compiled.materialization.nfm).toBe("Existing\n# Added\nParent\n\t- [ ] Nested task");
    expect(compiled.effects.createdBlockIds).toEqual(["created-1", "created-2", "created-3"]);
  });

  test("applies every exact NFM patch against one original string", () => {
    expect(
      applyExactNfmPatches("Alpha\nBeta", [
        { oldNfm: "Alpha", newNfm: "Beta" },
        { oldNfm: "Beta", newNfm: "Gamma" },
      ]),
    ).toBe("Beta\nGamma");

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
    expect(() => applyExactNfmPatches("One", [{ oldNfm: "Missing", newNfm: "Next" }])).toThrowError(
      expect.objectContaining<Partial<AgentDocumentEditCompilerError>>({
        code: "nfm_patch_mismatch",
      }),
    );
    expect(() =>
      applyExactNfmPatches("aaa", [{ oldNfm: "aa", newNfm: "b", expectedMatches: 2 }]),
    ).toThrowError(
      expect.objectContaining<Partial<AgentDocumentEditCompilerError>>({
        code: "nfm_patch_overlap",
      }),
    );
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

  test("requires a typed lifecycle operation to delete any owned resource shell", () => {
    for (const owner of [
      '<page uuid="nested-page" />',
      '<database uuid="nested-database" />',
      '<canvas uuid="nested-canvas" />',
    ]) {
      const current = materialization(`${owner}\nKeep`);
      const compile = () =>
        compileAgentDocumentEdit({
          documentId: "document-1",
          current,
          edit: edit({
            documentId: "document-1",
            body: { kind: "nfm.replace", content: "Keep", ifMatch: ETAG },
          }),
          allocateBlockId: allocator("replace"),
        });

      expect(compile).toThrowError(
        expect.objectContaining<Partial<AgentDocumentEditCompilerError>>({
          code: "protected_owner_deletion",
        }),
      );
    }
  });

  test("rejects stable inserts and moves beneath every editor-visible owner shell", () => {
    for (const owner of [
      '<page uuid="nested-page" />',
      '<database uuid="nested-database" />',
      '<canvas uuid="nested-canvas" />',
    ]) {
      const current = materialization(`${owner}\nKeep`);
      const [ownerBlock, ordinaryBlock] = current.blockTree;
      if (!ownerBlock || !ordinaryBlock) throw new Error("Owner fixture is incomplete");
      for (const stableEdit of [
        {
          kind: "insert" as const,
          at: { kind: "end" as const, parentBlockId: ownerBlock.id },
          block: { localId: "child", type: "paragraph", content: [] },
        },
        {
          kind: "move" as const,
          blockId: ordinaryBlock.id,
          at: { kind: "end" as const, parentBlockId: ownerBlock.id },
        },
      ]) {
        const compile = () =>
          compileAgentDocumentEdit({
            documentId: "document-1",
            current,
            edit: edit({
              documentId: "document-1",
              body: { kind: "blocks", edits: [stableEdit] },
            }),
            allocateBlockId: allocator("created"),
          });

        expect(compile).toThrowError(
          expect.objectContaining<Partial<AgentDocumentEditCompilerError>>({
            code: "invalid_arguments",
          }),
        );
      }
    }
  });

  test("rejects stable creation, editing, reclassification, and movement of owner shells", () => {
    const current = materialization('<page uuid="nested-page" />\nKeep');
    const [ownerBlock, ordinaryBlock] = current.blockTree;
    if (!ownerBlock || !ordinaryBlock) throw new Error("Owner fixture is incomplete");
    for (const stableEdit of [
      {
        kind: "insert" as const,
        at: { kind: "end" as const },
        block: { localId: "owner", type: "canvas" },
      },
      {
        kind: "update" as const,
        blockId: ownerBlock.id,
        ifMatch: ETAG,
        patch: { props: { illegal: true } },
      },
      {
        kind: "update" as const,
        blockId: ordinaryBlock.id,
        ifMatch: ETAG,
        patch: { type: "database" },
      },
      {
        kind: "move" as const,
        blockId: ownerBlock.id,
        at: { kind: "end" as const },
      },
    ]) {
      const compile = () =>
        compileAgentDocumentEdit({
          documentId: "document-1",
          current,
          edit: edit({
            documentId: "document-1",
            body: { kind: "blocks", edits: [stableEdit] },
          }),
          allocateBlockId: allocator("created"),
        });

      expect(compile).toThrowError(
        expect.objectContaining<Partial<AgentDocumentEditCompilerError>>({
          code: "invalid_arguments",
        }),
      );
    }
  });

  test("rejects whole-body owner reordering and moving an ancestor that carries an owner", () => {
    const current = materialization('Parent\n\t<page uuid="nested-page" />\nKeep');
    const [parent] = current.blockTree;
    if (!parent) throw new Error("Nested owner fixture is incomplete");

    expect(() =>
      compileAgentDocumentEdit({
        documentId: "document-1",
        current,
        edit: edit({
          documentId: "document-1",
          body: {
            kind: "blocks",
            edits: [{ kind: "move", blockId: parent.id, at: { kind: "end" } }],
          },
        }),
        allocateBlockId: allocator("move"),
      }),
    ).toThrowError(
      expect.objectContaining<Partial<AgentDocumentEditCompilerError>>({
        code: "invalid_arguments",
      }),
    );

    const rootOwners = materialization('<page uuid="nested-page" />\nKeep');
    const rootOwner = rootOwners.blockTree[0];
    if (!rootOwner) throw new Error("Root owner fixture is incomplete");
    expect(() =>
      compileAgentDocumentEdit({
        documentId: "document-1",
        current: rootOwners,
        edit: edit({
          documentId: "document-1",
          body: {
            kind: "nfm.replace",
            content: `Keep\n<page uuid="${rootOwner.id}" />`,
            ifMatch: ETAG,
          },
        }),
        allocateBlockId: allocator("replace"),
      }),
    ).toThrowError(
      expect.objectContaining<Partial<AgentDocumentEditCompilerError>>({
        code: "invalid_arguments",
      }),
    );
  });

  test("does not mistake insertion before an owner for owner movement", () => {
    const current = materialization('<page uuid="nested-page" />\nKeep');
    const owner = current.blockTree[0];
    if (!owner) throw new Error("Owner fixture is incomplete");
    const compiled = compileAgentDocumentEdit({
      documentId: "document-1",
      current,
      edit: edit({
        documentId: "document-1",
        body: {
          kind: "nfm.replace",
          content: `New\n<page uuid="${owner.id}" />\nKeep`,
          ifMatch: ETAG,
        },
      }),
      allocateBlockId: allocator("replace"),
    });

    expect(compiled.effects.movedBlockIds).toEqual([]);
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
          edits: [
            {
              kind: "move",
              blockId: second.id,
              at: { kind: "before", blockId: first.id },
            },
          ],
        },
      }),
      allocateBlockId: allocator("unused"),
    });

    expect(compiled.materialization.nfm).toBe("Second\nFirst");
    expect(compiled.effects.movedBlockIds).toContain(second.id);
    expect(compiled.effects.createdBlockIds).toEqual([]);
  });
});
