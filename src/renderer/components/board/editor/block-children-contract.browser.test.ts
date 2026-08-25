import { BlockNoteEditor } from "@blocknote/core";
import type { PartialBlock } from "@blocknote/core";
import { afterEach, describe, expect, test } from "vite-plus/test";

import { nfmSchema } from "./nfm-schema";
import "../../../globals.css";

const mountedEditors: BlockNoteEditor<any, any, any>[] = [];

afterEach(() => {
  for (const editor of mountedEditors.splice(0)) editor._tiptapEditor.destroy();
  document.body.replaceChildren();
});

const mountEditor = (initialContent: PartialBlock<any, any, any>[]) => {
  const editor = BlockNoteEditor.create({ schema: nfmSchema, initialContent });
  const host = document.createElement("div");
  host.className = "nfm-editor";
  document.body.append(host);
  editor.mount(host);
  mountedEditors.push(editor);
  return { editor, host };
};

describe("Block children contract in Chromium", () => {
  test("prevents nesting beneath atomic Blocks and allows semantic containers", () => {
    const { editor } = mountEditor([
      { id: "atomic", type: "codeBlock", content: "const value = 1" },
      { id: "candidate", type: "paragraph", content: "Candidate" },
    ]);

    editor.setTextCursorPosition("candidate", "start");
    expect(editor.canNestBlock()).toBe(false);
    expect(editor.nestBlock()).toBeUndefined();
    expect(editor.getParentBlock("candidate")).toBeUndefined();

    editor.updateBlock("atomic", { type: "paragraph", content: "Container" });
    expect(editor.canNestBlock()).toBe(true);
    expect(editor.nestBlock()).toBeUndefined();
    expect(editor.getParentBlock("candidate")?.id).toBe("atomic");
  });

  test("normal headings are leaves while toggle headings accept children", () => {
    const { editor } = mountEditor([
      { id: "heading", type: "heading", props: { level: 2 }, content: "Heading" },
      { id: "candidate", type: "paragraph", content: "Candidate" },
    ]);

    editor.setTextCursorPosition("candidate", "start");
    expect(editor.canNestBlock()).toBe(false);
    editor.updateBlock("heading", { props: { isToggleable: true } });
    expect(editor.canNestBlock()).toBe(true);
  });

  test("guards low-level replacement and exposes live outer semantic attributes", () => {
    const { editor, host } = mountEditor([
      {
        id: "callout",
        type: "callout",
        content: "Callout",
        children: [{ id: "inside", type: "paragraph", content: "Inside" }],
      },
      {
        id: "quote",
        type: "quote",
        content: "Quote",
        children: [{ id: "quoted", type: "paragraph", content: "Quoted child" }],
      },
      { id: "atomic", type: "divider" },
    ]);

    const callout = host.querySelector<HTMLElement>('.bn-block[data-id="callout"]');
    const calloutChild = host.querySelector<HTMLElement>('.bn-block[data-id="inside"]');
    expect(callout?.dataset.contentType).toBe("callout");
    expect(callout?.dataset.childrenLayout).toBe("enclosed");
    expect(callout?.dataset.acceptsChildren).toBe("true");
    expect(callout?.contains(calloutChild ?? null)).toBe(true);
    expect(getComputedStyle(callout!).backgroundColor).not.toBe("rgba(0, 0, 0, 0)");

    const quote = host.querySelector<HTMLElement>('.bn-block[data-id="quote"]');
    const quotedChild = host.querySelector<HTMLElement>('.bn-block[data-id="quoted"]');
    expect(quote?.dataset.childrenLayout).toBe("enclosed");
    expect(quote?.contains(quotedChild ?? null)).toBe(true);
    expect(getComputedStyle(quote!).borderLeftWidth).toBe("2px");

    editor.replaceBlocks(
      ["atomic"],
      [
        {
          id: "atomic",
          type: "divider",
          children: [{ id: "forbidden", type: "paragraph", content: "Forbidden" }],
        },
      ],
    );
    expect(editor.getBlock("forbidden")).toBeUndefined();
    expect(editor.getBlock("atomic")?.children).toHaveLength(0);
  });
});
