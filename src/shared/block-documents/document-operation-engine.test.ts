import { describe, expect, test } from "bun:test";
import * as Y from "yjs";
import {
  createCardDocumentGenesis,
  materializeCardDocument,
  type BlockTreeNode,
} from "./block-document-codec";
import {
  DocumentOperationEngineError,
  prepareDocumentOperationUpdate,
} from "./document-operation-engine";
import { replaceCardDocumentBodyFromNfm } from "./legacy-nfm-shadow-translator";

const createGenesis = (
  documentId: string,
  title: string,
  nfm: string,
  ids: readonly string[],
) => {
  let index = 0;
  return createCardDocumentGenesis({
    documentId,
    title,
    nfm,
    allocateBlockId: () => {
      const id = ids[index];
      index += 1;
      if (id) return id;
      throw new Error(`Missing test Block ID at ${index}`);
    },
  });
};

const encodedState = (document: Y.Doc): string =>
  Buffer.from(Y.encodeStateAsUpdate(document)).toString("base64");

const captureEngineError = (operation: () => unknown): string => {
  try {
    operation();
    return "";
  } catch (error) {
    return error instanceof DocumentOperationEngineError ? error.code : "other";
  }
};

describe("Document operation engine", () => {
  test("applies one stable-ID batch on a detached clone and emits one replayable update", () => {
    const source = createGenesis(
      "operation-source",
      "Before",
      "Alpha\nBeta\nGamma",
      ["alpha", "beta", "gamma"],
    );
    const inserted = createGenesis(
      "operation-insert-template",
      "",
      "Inserted\n\tChild",
      ["inserted", "inserted-child"],
    );
    const updated = createGenesis(
      "operation-update-template",
      "",
      "Alpha updated",
      ["updated-template"],
    );
    const sourceBefore = encodedState(source.document);
    const insertedRoot = inserted.materialization.blockTree[0] as BlockTreeNode;
    const updatedRoot = updated.materialization.blockTree[0] as BlockTreeNode;

    const prepared = prepareDocumentOperationUpdate({
      document: source.document,
      operations: [
        { kind: "set_title", title: "After" },
        {
          kind: "insert_block",
          block: insertedRoot,
          beforeBlockId: "beta",
        },
        {
          kind: "update_block",
          blockId: "alpha",
          patch: {
            type: updatedRoot.type,
            props: updatedRoot.props,
            ...(updatedRoot.content === undefined
              ? {}
              : { content: updatedRoot.content }),
          },
        },
        { kind: "move_block", blockId: "gamma", parentBlockId: "alpha" },
        { kind: "delete_block", blockId: "beta" },
      ],
    });

    expect(encodedState(source.document)).toBe(sourceBefore);
    expect(prepared.update.byteLength > 0).toBeTrue();
    expect(prepared.materialization.title).toBe("After");
    expect(prepared.materialization.nfm).toBe(
      "Alpha updated\n\tGamma\nInserted\n\tChild",
    );
    expect(prepared.writeFenceBlockIds.join(",")).toBe("alpha,beta,gamma");
    expect(prepared.titleWriteFenceRequired).toBeTrue();
    expect(
      prepared.materialization.blockTree
        .flatMap((block) => [
          block.id,
          ...block.children.map((child) => child.id),
        ])
        .join(","),
    ).toBe("alpha,gamma,inserted,inserted-child");

    const replica = new Y.Doc({ guid: source.document.guid });
    Y.applyUpdate(replica, source.update);
    Y.applyUpdate(replica, prepared.update);
    expect(materializeCardDocument(replica).nfm).toBe(
      prepared.materialization.nfm,
    );
    const afterFirstApply = encodedState(replica);
    Y.applyUpdate(replica, prepared.update);
    expect(encodedState(replica)).toBe(afterFirstApply);

    replica.destroy();
    source.document.destroy();
    inserted.document.destroy();
    updated.document.destroy();
  });

  test("retains a title fence when a batch rewrites back to its original value", () => {
    const source = createGenesis(
      "operation-net-zero-title",
      "Original",
      "Body",
      ["body"],
    );
    const inserted = createGenesis(
      "operation-net-zero-insert",
      "",
      "Inserted",
      ["inserted"],
    );
    try {
      const prepared = prepareDocumentOperationUpdate({
        document: source.document,
        operations: [
          { kind: "set_title", title: "Transient" },
          { kind: "set_title", title: "Original" },
          {
            kind: "insert_block",
            block: inserted.materialization.blockTree[0] as BlockTreeNode,
          },
        ],
      });
      expect(prepared.materialization.title).toBe("Original");
      expect(prepared.titleWriteFenceRequired).toBeTrue();
      expect(prepared.writeFenceBlockIds.length).toBe(0);
    } finally {
      source.document.destroy();
      inserted.document.destroy();
    }
  });

  test("marks every descendant whose Yjs structs are invalidated by a move", () => {
    const source = createGenesis(
      "operation-fence-descendants",
      "Fence",
      "Parent\n\tChild\nSibling",
      ["parent", "child", "sibling"],
    );
    const prepared = prepareDocumentOperationUpdate({
      document: source.document,
      operations: [{ kind: "move_block", blockId: "parent" }],
    });
    expect(prepared.writeFenceBlockIds.join(",")).toBe("child,parent");
    source.document.destroy();
  });

  test("rejects duplicate IDs, ancestor cycles, and missing anchors without mutating the source", () => {
    const source = createGenesis(
      "operation-failures",
      "Guarded",
      "Parent\n\tChild\nSibling",
      ["parent", "child", "sibling"],
    );
    const duplicate = createGenesis(
      "operation-duplicate-template",
      "",
      "Duplicate",
      ["sibling"],
    );
    const before = encodedState(source.document);

    expect(
      captureEngineError(() =>
        prepareDocumentOperationUpdate({
          document: source.document,
          operations: [
            {
              kind: "insert_block",
              block: duplicate.materialization.blockTree[0] as BlockTreeNode,
            },
          ],
        }),
      ),
    ).toBe("duplicate_block_id");
    expect(
      captureEngineError(() =>
        prepareDocumentOperationUpdate({
          document: source.document,
          operations: [
            { kind: "move_block", blockId: "parent", parentBlockId: "child" },
          ],
        }),
      ),
    ).toBe("ancestor_cycle");
    expect(
      captureEngineError(() =>
        prepareDocumentOperationUpdate({
          document: source.document,
          operations: [
            {
              kind: "move_block",
              blockId: "sibling",
              beforeBlockId: "missing",
            },
          ],
        }),
      ),
    ).toBe("invalid_anchor");
    expect(encodedState(source.document)).toBe(before);

    duplicate.document.destroy();
    source.document.destroy();
  });

  test("rejects a fully normalized no-op instead of manufacturing Yjs structs", () => {
    const source = createGenesis("operation-noop", "Same title", "Same body", [
      "same",
    ]);
    expect(
      captureEngineError(() =>
        prepareDocumentOperationUpdate({
          document: source.document,
          operations: [
            { kind: "set_title", title: "Same title" },
            {
              kind: "update_block",
              blockId: "same",
              patch: {
                props: source.materialization.blockTree[0]?.props ?? {},
              },
            },
            { kind: "move_block", blockId: "same" },
          ],
        }),
      ),
    ).toBe("no_change");
    const insertTemplate = createGenesis(
      "operation-noop-insert",
      "",
      "Transient",
      ["transient"],
    );
    expect(
      captureEngineError(() =>
        prepareDocumentOperationUpdate({
          document: source.document,
          operations: [
            {
              kind: "insert_block",
              block: insertTemplate.materialization
                .blockTree[0] as BlockTreeNode,
            },
            { kind: "delete_block", blockId: "transient" },
          ],
        }),
      ),
    ).toBe("no_change");
    insertTemplate.document.destroy();
    source.document.destroy();
  });

  test("rejects Block props that the canonical codec would silently discard", () => {
    const source = createGenesis(
      "operation-invalid-props",
      "Schema",
      "Existing",
      ["existing"],
    );
    expect(
      captureEngineError(() =>
        prepareDocumentOperationUpdate({
          document: source.document,
          operations: [
            {
              kind: "insert_block",
              block: {
                id: "invalid-props",
                type: "paragraph",
                props: { unsupportedProp: "must-not-disappear" },
                content: [],
                children: [],
              },
            },
          ],
        }),
      ),
    ).toBe("invalid_block");
    source.document.destroy();
  });

  test("NFM replacement preserves title structs and resolves repeated-content identity deterministically", () => {
    const source = createGenesis(
      "operation-nfm-replace",
      "Preserved title",
      "Same\nSame\nTail",
      ["same-1", "same-2", "tail"],
    );
    let firstAllocation = 0;
    const first = replaceCardDocumentBodyFromNfm({
      document: source.document,
      nfm: "Same revised\nSame\nTail",
      allocateBlockId: () => `fresh-${++firstAllocation}`,
    });
    let secondAllocation = 0;
    const second = replaceCardDocumentBodyFromNfm({
      document: source.document,
      nfm: "Same revised\nSame\nTail",
      allocateBlockId: () => `fresh-${++secondAllocation}`,
    });
    expect(
      first.materialization.blockTree.map((block) => block.id).join(","),
    ).toBe(second.materialization.blockTree.map((block) => block.id).join(","));
    expect(
      first.materialization.blockTree.map((block) => block.id).join(","),
    ).toBe("fresh-1,fresh-2,tail");
    expect(first.materialization.title).toBe("Preserved title");

    const replica = new Y.Doc({ guid: source.document.guid });
    Y.applyUpdate(replica, source.update);
    let titleEvents = 0;
    replica.getText("title").observe(() => {
      titleEvents += 1;
    });
    Y.applyUpdate(replica, first.update);
    expect(titleEvents).toBe(0);
    expect(materializeCardDocument(replica).title).toBe("Preserved title");

    replica.destroy();
    source.document.destroy();
  });

  test("NFM identity matching uses parent context and never zips ambiguous global duplicates", () => {
    const source = createGenesis(
      "operation-nfm-parent-context",
      "Context",
      "Parent A\n\tSame\nParent B\n\tSame",
      ["parent-a", "child-a", "parent-b", "child-b"],
    );
    let nextId = 0;
    const replacement = replaceCardDocumentBodyFromNfm({
      document: source.document,
      nfm: "Parent A\n\tSame revised\nParent B\n\tSame",
      allocateBlockId: () => `context-new-${++nextId}`,
    });
    const [parentA, parentB] = replacement.materialization.blockTree;
    expect(parentA?.id).toBe("parent-a");
    expect(parentA?.children[0]?.id).toBe("child-a");
    expect(parentB?.id).toBe("parent-b");
    expect(parentB?.children[0]?.id).toBe("child-b");
    expect(nextId).toBe(0);

    source.document.destroy();
  });

  test("NFM identity matching allocates fresh IDs when same-type replacement has no confident anchor", () => {
    const source = createGenesis(
      "operation-nfm-all-replaced",
      "Replace",
      "Alpha\nBeta",
      ["alpha-old", "beta-old"],
    );
    let nextId = 0;
    const replacement = replaceCardDocumentBodyFromNfm({
      document: source.document,
      nfm: "Completely different one\nCompletely different two",
      allocateBlockId: () => `replacement-${++nextId}`,
    });
    expect(
      replacement.materialization.blockTree.map((block) => block.id).join(","),
    ).toBe("replacement-1,replacement-2");
    expect(nextId).toBe(2);
    source.document.destroy();
  });

  test("NFM ambiguous identity behavior does not change across the old DP threshold", () => {
    const sourceCount = 317;
    const source = createGenesis(
      "operation-nfm-threshold",
      "Threshold",
      Array.from({ length: sourceCount }, () => "Same").join("\n"),
      Array.from(
        { length: sourceCount },
        (_, index) => `threshold-old-${index}`,
      ),
    );
    let allocationCount = 0;
    const replacement = replaceCardDocumentBodyFromNfm({
      document: source.document,
      nfm: Array.from({ length: sourceCount - 1 }, () => "Same").join("\n"),
      allocateBlockId: () => `threshold-new-${++allocationCount}`,
    });
    expect(allocationCount).toBe(sourceCount - 1);
    expect(
      replacement.materialization.blockTree.some((block) =>
        block.id.startsWith("threshold-old-"),
      ),
    ).toBeFalse();
    source.document.destroy();
  });
});
