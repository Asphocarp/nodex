import { describe, expect, test } from "vitest";
import {
  readRichTitleDomDraft,
  readRichTitleDomDraftSelection,
  readRichTitleDomSelection,
  restoreRichTitleDomSelection,
  richTitleDomPointToIndex,
  richTitleIndexToDomPoint,
} from "./rich-title-editor-dom";

const createFixture = (): HTMLDivElement => {
  const root = document.createElement("div");
  root.contentEditable = "true";
  root.innerHTML = [
    '<span data-rich-title-segment data-rich-title-kind="text" data-rich-title-start="0" data-rich-title-length="5">Hello</span>',
    '<span data-rich-title-segment data-rich-title-kind="atom" data-rich-title-start="5" data-rich-title-length="1" contenteditable="false">@thread</span>',
    '<br data-rich-title-segment data-rich-title-kind="linebreak" data-rich-title-start="6" data-rich-title-length="1">',
    '<span data-rich-title-segment data-rich-title-kind="text" data-rich-title-start="7" data-rich-title-length="5">world</span>',
  ].join("");
  document.body.append(root);
  return root;
};

describe("rich title editor DOM coordinates", () => {
  test("maps text, atom, linebreak, and root boundaries to Y.Text indexes", () => {
    const root = createFixture();
    const firstText = root.children[0]?.firstChild;
    if (!firstText) throw new TypeError("Missing title text fixture");
    expect(richTitleDomPointToIndex(root, firstText, 3)).toBe(3);
    expect(richTitleDomPointToIndex(root, root, 1)).toBe(5);
    expect(richTitleDomPointToIndex(root, root, 2)).toBe(6);
    expect(richTitleDomPointToIndex(root, root, 3)).toBe(7);
    expect(richTitleIndexToDomPoint(root, 12).offset).toBe(5);
    root.remove();
  });

  test("round-trips forward and backward selections around atomic content", () => {
    const root = createFixture();
    restoreRichTitleDomSelection(root, 9, 5);
    expect(readRichTitleDomSelection(root)).toEqual({
      anchor: 9,
      focus: 5,
      start: 5,
      end: 9,
      direction: "backward",
    });
    root.remove();
  });

  test("reads an IME draft without leaking visible atom labels", () => {
    const root = createFixture();
    expect(readRichTitleDomDraft(root)).toBe("Hello\uFFFC\nworld");
    root.remove();
  });

  test("maps a browser-mutated draft without stale segment lengths", () => {
    const root = createFixture();
    const firstText = root.children[0]?.firstChild;
    const lastText = root.children[3]?.firstChild;
    if (!(firstText instanceof Text) || !(lastText instanceof Text)) {
      throw new TypeError("Missing title text fixture");
    }
    firstText.insertData(5, "!");
    root.ownerDocument.getSelection()?.setBaseAndExtent(
      lastText,
      3,
      lastText,
      3,
    );

    expect(readRichTitleDomDraftSelection(root)).toMatchObject({
      anchor: 11,
      focus: 11,
    });
    expect(readRichTitleDomSelection(root)).toMatchObject({
      anchor: 10,
      focus: 10,
    });
    root.remove();
  });
});
