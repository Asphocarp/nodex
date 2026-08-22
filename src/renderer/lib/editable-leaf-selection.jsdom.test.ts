import { describe, expect, test } from "vite-plus/test";
import { selectEditableLeafContent, selectionCoversEditableLeaf } from "./editable-leaf-selection";

const createFixture = (): HTMLDivElement => {
  const root = document.createElement("div");
  root.innerHTML = "<span>Hello </span><strong>world</strong>";
  document.body.append(root);
  return root;
};

describe("editable leaf selection", () => {
  test("selects the complete leaf from a partial text selection", () => {
    const root = createFixture();
    const text = root.querySelector("span")?.firstChild;
    if (!(text instanceof Text)) throw new TypeError("Missing text fixture");
    document.getSelection()?.setBaseAndExtent(text, 2, text, 4);

    expect(selectEditableLeafContent(root)).toBe(true);
    expect(selectionCoversEditableLeaf(root)).toBe(true);
    expect(document.getSelection()?.toString()).toBe("Hello world");
    root.remove();
  });

  test("yields when the leaf is already fully selected", () => {
    const root = createFixture();
    const firstText = root.querySelector("span")?.firstChild;
    const lastText = root.querySelector("strong")?.firstChild;
    if (!(firstText instanceof Text) || !(lastText instanceof Text)) {
      throw new TypeError("Missing text fixture");
    }
    document.getSelection()?.setBaseAndExtent(firstText, 0, lastText, lastText.length);

    expect(selectionCoversEditableLeaf(root)).toBe(true);
    expect(selectEditableLeafContent(root)).toBe(false);
    root.remove();
  });

  test("recognizes a parent-editor selection that contains the leaf", () => {
    const host = document.createElement("div");
    const before = document.createTextNode("before");
    const root = createFixture();
    const after = document.createTextNode("after");
    host.append(before, root, after);
    document.body.append(host);
    document.getSelection()?.setBaseAndExtent(before, 0, after, after.length);

    expect(selectionCoversEditableLeaf(root)).toBe(true);
    expect(selectEditableLeafContent(root)).toBe(false);
    host.remove();
  });
});
