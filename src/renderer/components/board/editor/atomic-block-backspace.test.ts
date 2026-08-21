import { describe, expect, test, vi } from "vite-plus/test";

import { handleBackspaceAcrossAtomicBlocks } from "./atomic-block-backspace";

const block = (id: string, type = "paragraph") => ({ id, type, children: [] });

function editorFor(input: {
  readonly blocks: ReturnType<typeof block>[];
  readonly cursorIndex: number;
  readonly atStart?: boolean;
}) {
  const setTextCursorPosition = vi.fn();
  const focus = vi.fn();
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
      getParentBlock: () => undefined,
      setTextCursorPosition,
      focus,
    },
    setTextCursorPosition,
    focus,
  };
}

describe("atomic Block Backspace", () => {
  test("crosses a run of owner, divider, and image Blocks without deleting them", () => {
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

    expect(handleBackspaceAcrossAtomicBlocks(input.editor)).toBe(true);
    expect(input.setTextCursorPosition).toHaveBeenCalledWith("before", "end");
    expect(input.focus).toHaveBeenCalledOnce();
    expect(input.editor.document.map((item) => item.id)).toEqual([
      "before",
      "page",
      "divider",
      "image",
      "after",
    ]);
  });

  test("claims the boundary when no earlier inline Block exists", () => {
    const input = editorFor({
      blocks: [block("page", "page"), block("after")],
      cursorIndex: 1,
    });

    expect(handleBackspaceAcrossAtomicBlocks(input.editor)).toBe(true);
    expect(input.setTextCursorPosition).not.toHaveBeenCalled();
    expect(input.focus).not.toHaveBeenCalled();
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

    expect(handleBackspaceAcrossAtomicBlocks(ordinary.editor)).toBe(false);
    expect(handleBackspaceAcrossAtomicBlocks(middle.editor)).toBe(false);
  });
});
