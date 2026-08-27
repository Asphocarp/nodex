import { describe, expect, test } from "vite-plus/test";
import { parseNfm } from "../nfm/parser";
import {
  blockNoteInlineToPortableRichText,
  blockNoteToNfm,
  nfmToBlockNote,
  nfmToBlockNoteWithIds,
} from "./nfm-blocknote-adapter";

describe("NFM BlockNote genesis adapter", () => {
  test("round-trips block and inline equation source", () => {
    const source = parseNfm("Before $x^2$ after\n$$\n\\sum_i x_i\n$$");
    const blockNote = nfmToBlockNote(source);

    expect(blockNote).toMatchObject([
      {
        type: "paragraph",
        content: [
          { type: "text", text: "Before " },
          { type: "math", content: "x^2" },
          { type: "text", text: " after" },
        ],
      },
      {
        type: "mathBlock",
        content: [{ type: "text", text: "\\sum_i x_i" }],
        children: [],
      },
    ]);
    expect(blockNoteToNfm(blockNote)).toEqual(source);
  });

  test("normalizes imported code languages to the product catalog", () => {
    expect(
      nfmToBlockNote([
        { type: "codeBlock", language: "JS", code: "const ok = true", children: [] },
        { type: "codeBlock", language: "vue", code: "<template />", children: [] },
      ]),
    ).toMatchObject([
      { type: "codeBlock", props: { language: "javascript" } },
      { type: "codeBlock", props: { language: "text" } },
    ]);
  });

  test("exports only supported canonical code languages", () => {
    expect(
      blockNoteToNfm([
        {
          type: "codeBlock",
          props: { language: "tsx" },
          content: [{ type: "text", text: "const ok: boolean = true", styles: {} }],
          children: [],
        },
        {
          type: "codeBlock",
          props: { language: "svelte" },
          content: [{ type: "text", text: "<script />", styles: {} }],
          children: [],
        },
      ]),
    ).toMatchObject([
      { type: "codeBlock", language: "typescript" },
      { type: "codeBlock", language: "" },
    ]);
  });

  test("allocates one stable application identity for every nested Block", () => {
    let nextId = 0;
    const blocks = nfmToBlockNoteWithIds(
      parseNfm("Parent\n\t- Child\n\t\tGrandchild\nSibling"),
      () => `block-${++nextId}`,
    );

    expect(nextId).toBe(4);
    expect(blocks[0]?.id).toBe("block-1");
    expect(blocks[0]?.children?.[0]?.id).toBe("block-2");
    expect(blocks[0]?.children?.[0]?.children?.[0]?.id).toBe("block-3");
    expect(blocks[1]?.id).toBe("block-4");
  });

  test("fails genesis when the identity allocator repeats an ID", () => {
    let message = "";
    try {
      nfmToBlockNoteWithIds(parseNfm("First\nSecond"), () => "duplicate");
    } catch (error) {
      message = (error as Error).message;
    }

    expect(message).toBe("Block ID allocator returned an invalid or duplicate identity");
  });

  test("round-trips a Canvas owner as a childless identity shell", () => {
    const [block] = nfmToBlockNote(parseNfm('<canvas uuid="canvas-1" />'));

    expect(block).toEqual({
      id: "canvas-1",
      type: "canvas",
      props: {},
      children: [],
    });
    expect(blockNoteToNfm([block])).toEqual([
      {
        type: "canvas",
        uuid: "canvas-1",
        children: [],
      },
    ]);
  });

  test("converts a tracked BlockNote inline range into canonical portable rich text", () => {
    expect(
      blockNoteInlineToPortableRichText([
        { type: "text", text: "+", styles: { strike: true } },
        { type: "text", text: "plan", styles: { strike: true } },
        { type: "pageMention", props: { targetPageId: "page-1" } },
      ]),
    ).toEqual([
      { type: "text", text: "+plan", styles: { strikethrough: true } },
      { type: "pageMention", targetPageId: "page-1" },
    ]);
    expect(() =>
      blockNoteInlineToPortableRichText([
        { type: "attachment", props: { kind: "file", source: "a", name: "a" } },
      ]),
    ).toThrow("cannot participate in a Page mention mutation");
  });
});
