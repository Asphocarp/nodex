import { describe, expect, test } from "vite-plus/test";

import { planBackspaceAcrossAtomicBlocks } from "./atomic-block-backspace";

interface TestBlock {
  readonly id: string;
  readonly type: string;
  readonly children: TestBlock[];
}

const block = (id: string, type = "paragraph"): TestBlock => ({ id, type, children: [] });

function editorFor(input: {
  readonly blocks: TestBlock[];
  readonly cursorIndex: number;
  readonly atStart?: boolean;
  readonly parent?: TestBlock;
}) {
  const current = input.blocks[input.cursorIndex]!;
  return {
    editor: {
      document: input.blocks,
      schema: {
        blockSchema: {
          paragraph: { content: "inline" },
          heading: { content: "inline" },
          page: { content: "none" },
          divider: { content: "none" },
          image: { content: "none" },
        },
      },
      prosemirrorView: {
        state: {
          selection: {
            empty: true,
            $from: { parentOffset: input.atStart === false ? 1 : 0 },
          },
        },
      },
      getTextCursorPosition: () => ({
        block: current,
        prevBlock: input.blocks[input.cursorIndex - 1],
      }),
      getParentBlock: () => input.parent,
    },
  };
}

describe("atomic Block Backspace", () => {
  test("plans a semantic merge across an owner, divider, and image run", () => {
    const input = editorFor({
      blocks: [
        block("before"),
        block("page", "page"),
        block("divider", "divider"),
        block("image", "image"),
        block("after"),
      ],
      cursorIndex: 4,
    });

    expect(planBackspaceAcrossAtomicBlocks(input.editor)).toEqual({
      kind: "merge",
      sourceBlockId: "after",
      targetBlockId: "before",
    });
  });

  test("claims the boundary when no earlier inline Block exists", () => {
    const input = editorFor({
      blocks: [block("page", "page"), block("after")],
      cursorIndex: 1,
    });

    expect(planBackspaceAcrossAtomicBlocks(input.editor)).toEqual({ kind: "protect_boundary" });
  });

  test("leaves ordinary merges and non-boundary Backspace to BlockNote", () => {
    const ordinary = editorFor({
      blocks: [block("before"), block("after")],
      cursorIndex: 1,
    });
    const middle = editorFor({
      blocks: [block("before"), block("page", "page"), block("after")],
      cursorIndex: 2,
      atStart: false,
    });

    expect(planBackspaceAcrossAtomicBlocks(ordinary.editor)).toBeNull();
    expect(planBackspaceAcrossAtomicBlocks(middle.editor)).toBeNull();
  });

  test.each(["heading", "bulletListItem", "toggleListItem", "quote", "callout", "codeBlock"])(
    "leaves %s to the editor's first Backspace normalization",
    (type) => {
      const input = editorFor({
        blocks: [block("before"), block("image", "image"), block("after", type)],
        cursorIndex: 2,
      });

      expect(planBackspaceAcrossAtomicBlocks(input.editor)).toBeNull();
    },
  );

  test("plans within the source Block's own sibling group", () => {
    const before = block("before");
    const image = block("image", "image");
    const after = block("after");
    const parent = { id: "parent", type: "paragraph", children: [before, image, after] };
    const input = editorFor({ blocks: [parent], cursorIndex: 0, parent });
    input.editor.getTextCursorPosition = () => ({ block: after, prevBlock: image });

    expect(planBackspaceAcrossAtomicBlocks(input.editor)).toEqual({
      kind: "merge",
      sourceBlockId: "after",
      targetBlockId: "before",
    });
  });
});
