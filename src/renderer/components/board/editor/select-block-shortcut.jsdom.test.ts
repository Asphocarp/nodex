import { describe, expect, test } from "vite-plus/test";
import { selectCurrentBlockContent } from "./select-block-shortcut";

describe("select block shortcut DOM behavior", () => {
  test("selects the current inline block from its DOM leaf", () => {
    const root = document.createElement("div");
    root.innerHTML =
      '<div class="bn-block" data-id="paragraph-1"><div class="bn-inline-content">Alpha</div></div>';
    document.body.append(root);
    const inlineContent = root.querySelector<HTMLElement>(".bn-inline-content");
    const text = inlineContent?.firstChild;
    if (!inlineContent || !(text instanceof Text)) throw new TypeError("Missing block fixture");
    const selection = document.getSelection();
    selection?.setBaseAndExtent(text, 2, text, 2);
    const editor = {
      domElement: root,
      schema: { blockSchema: { paragraph: { content: "inline" } } },
      getTextCursorPosition: () => ({
        block: { id: "paragraph-1", type: "paragraph" },
      }),
    };

    expect(selectCurrentBlockContent(editor, selection)).toBe(true);
    expect(selection?.toString()).toBe("Alpha");
    root.remove();
  });

  test("treats a nested editable title as the current leaf of a non-inline block", () => {
    const root = document.createElement("div");
    root.innerHTML = [
      '<div class="bn-block" data-id="page-1">',
      '<div data-editor-select-all-scope="leaf"><span>Nested Page</span></div>',
      "</div>",
    ].join("");
    document.body.append(root);
    const title = root.querySelector<HTMLElement>("[data-editor-select-all-scope='leaf']");
    const text = title?.querySelector("span")?.firstChild;
    if (!title || !(text instanceof Text)) throw new TypeError("Missing title fixture");
    const selection = document.getSelection();
    selection?.setBaseAndExtent(text, 3, text, 3);
    const editor = {
      domElement: root,
      schema: { blockSchema: { page: { content: "none" } } },
      getTextCursorPosition: () => ({ block: { id: "page-1", type: "page" } }),
    };

    expect(selectCurrentBlockContent(editor, selection)).toBe(true);
    expect(selection?.toString()).toBe("Nested Page");
    root.remove();
  });
});
