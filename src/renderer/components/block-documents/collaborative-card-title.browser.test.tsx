import { act, fireEvent, render } from "@testing-library/react";
import { describe, expect, test } from "vitest";
import { userEvent } from "vitest/browser";
import * as Y from "yjs";
import {
  readPortableRichTextFromYText,
  replaceYTextWithPortableRichText,
} from "../../../shared/block-documents/portable-rich-text";
import {
  isRichTitleDomSelectionAtVerticalBoundary,
  readRichTitleDomSelection,
  restoreRichTitleDomSelection,
} from "@/lib/rich-title-editor-dom";
import { CollaborativeCardTitle } from "./collaborative-card-title";

const createTitle = (value: string) => {
  const document = new Y.Doc({ guid: "browser-rich-title" });
  const title = document.getText("title");
  title.insert(0, value);
  return { document, title };
};

describe("CollaborativeCardTitle in Chromium", () => {
  test("detects the first and last rendered title lines rather than logical offsets", async () => {
    const { document, title } = createTitle(
      "alpha beta gamma delta epsilon zeta eta theta iota kappa lambda",
    );
    const view = render(
      <div style={{ width: 120 }}>
        <CollaborativeCardTitle title={title} />
      </div>,
    );
    const editor = view.getByRole("textbox", { name: "Card title" }) as HTMLDivElement;
    const caretTopByIndex: number[] = [];

    await act(async () => {
      editor.focus();
      for (let index = 0; index <= title.length; index += 1) {
        restoreRichTitleDomSelection(editor, index, index);
        const selection = editor.ownerDocument.getSelection();
        const rect = selection?.rangeCount ? selection.getRangeAt(0).getBoundingClientRect() : null;
        caretTopByIndex.push(rect?.top ?? 0);
      }
    });

    const lastLineTop = Math.max(...caretTopByIndex);
    const lastLineIndex = caretTopByIndex.findIndex((top) => top === lastLineTop);
    expect(new Set(caretTopByIndex).size).toBeGreaterThan(1);
    expect(lastLineIndex).toBeGreaterThan(0);
    expect(lastLineIndex).toBeLessThan(title.length);

    restoreRichTitleDomSelection(editor, lastLineIndex, lastLineIndex);
    expect(isRichTitleDomSelectionAtVerticalBoundary(editor, "down")).toBe(true);
    expect(isRichTitleDomSelectionAtVerticalBoundary(editor, "up")).toBe(false);

    restoreRichTitleDomSelection(editor, 0, 0);
    expect(isRichTitleDomSelectionAtVerticalBoundary(editor, "up")).toBe(true);
    document.destroy();
  });

  test("keeps the caret after sequential local text input", async () => {
    const existing = createTitle("123");
    const existingView = render(
      <CollaborativeCardTitle title={existing.title} aria-label="Existing title" />,
    );
    const existingEditor = existingView.getByRole("textbox", {
      name: "Existing title",
    }) as HTMLDivElement;

    await act(async () => {
      existingEditor.focus();
      restoreRichTitleDomSelection(existingEditor, 3, 3);
      await userEvent.keyboard("4");
    });

    expect(existing.title.toString()).toBe("1234");
    expect(readRichTitleDomSelection(existingEditor)).toMatchObject({
      anchor: 4,
      focus: 4,
    });

    const empty = createTitle("");
    const emptyView = render(
      <CollaborativeCardTitle title={empty.title} aria-label="Empty title" />,
    );
    const emptyEditor = emptyView.getByRole("textbox", {
      name: "Empty title",
    }) as HTMLDivElement;

    await act(async () => {
      emptyEditor.focus();
      restoreRichTitleDomSelection(emptyEditor, 0, 0);
      await userEvent.keyboard("abcdefg");
    });

    expect(empty.title.toString()).toBe("abcdefg");
    expect(readRichTitleDomSelection(emptyEditor)).toMatchObject({
      anchor: 7,
      focus: 7,
    });
    existing.document.destroy();
    empty.document.destroy();
  });

  test("reconciles a non-cancelable browser DOM draft in draft coordinates", async () => {
    const { document, title } = createTitle("123");
    const view = render(<CollaborativeCardTitle title={title} />);
    const editor = view.getByRole("textbox", {
      name: "Card title",
    }) as HTMLDivElement;
    const segment = editor.querySelector<HTMLElement>(
      "[data-rich-title-kind='text']",
    );
    const textNode = segment?.firstChild;
    if (!segment || !(textNode instanceof Text)) {
      throw new TypeError("Expected a rendered rich-title text segment");
    }

    await act(async () => {
      editor.focus();
      restoreRichTitleDomSelection(editor, 3, 3);
      editor.dispatchEvent(new InputEvent("beforeinput", {
        bubbles: true,
        cancelable: false,
        data: "4",
        inputType: "insertReplacementText",
      }));
      textNode.insertData(3, "4");
      editor.ownerDocument.getSelection()?.setBaseAndExtent(
        textNode,
        4,
        textNode,
        4,
      );
      editor.dispatchEvent(new InputEvent("input", {
        bubbles: true,
        data: "4",
        inputType: "insertReplacementText",
      }));
      await Promise.resolve();
    });

    expect(title.toString()).toBe("1234");
    expect(readRichTitleDomSelection(editor)).toMatchObject({
      anchor: 4,
      focus: 4,
    });
    document.destroy();
  });

  test("restores a native selection through a remote Y.Text insertion", async () => {
    const { document, title } = createTitle("Hello Chromium");
    const view = render(<CollaborativeCardTitle title={title} />);
    const editor = view.getByRole("textbox", { name: "Card title" }) as HTMLDivElement;

    await act(async () => {
      editor.focus();
      restoreRichTitleDomSelection(editor, 6, 14);
      document.transact(() => title.insert(0, "Remote "), "browser-remote");
      await Promise.resolve();
    });

    expect(editor.textContent).toBe("Remote Hello Chromium");
    expect(readRichTitleDomSelection(editor)).toMatchObject({
      start: 13,
      end: 21,
    });
    document.destroy();
  });

  test("applies native keyboard formatting and deletes an atomic mention as one unit", async () => {
    const { document, title } = createTitle("");
    replaceYTextWithPortableRichText(title, [
      { type: "text", text: "Bold", styles: {} },
      { type: "threadMention", uuid: "thread-browser" },
    ]);
    const view = render(<CollaborativeCardTitle title={title} />);
    const editor = view.getByRole("textbox", { name: "Card title" }) as HTMLDivElement;

    await act(async () => {
      editor.focus();
      restoreRichTitleDomSelection(editor, 0, 4);
      fireEvent.keyDown(editor, { key: "b", metaKey: true });
      await Promise.resolve();
    });
    expect(readPortableRichTextFromYText(title)[0]).toMatchObject({
      type: "text",
      text: "Bold",
      styles: { bold: true },
    });

    await act(async () => {
      restoreRichTitleDomSelection(editor, 5, 5);
      await userEvent.keyboard("{Backspace}");
      await Promise.resolve();
    });
    expect(title.toString()).toBe("Bold");
    document.destroy();
  });

  test("rebases a browser composition draft over a concurrent remote edit", async () => {
    const { document, title } = createTitle("local title");
    const view = render(<CollaborativeCardTitle title={title} />);
    const editor = view.getByRole("textbox", { name: "Card title" }) as HTMLDivElement;

    await act(async () => {
      editor.focus();
      fireEvent.compositionStart(editor);
      editor.textContent = "local composed title";
      editor.dispatchEvent(new InputEvent("input", {
        bubbles: true,
        inputType: "insertCompositionText",
        data: "composed ",
        isComposing: true,
      }));
      document.transact(() => title.insert(0, "remote "), "browser-remote");
      fireEvent.compositionEnd(editor);
      await Promise.resolve();
    });

    expect(title.toString()).toBe("remote local composed title");
    expect(editor.textContent).toBe("remote local composed title");
    document.destroy();
  });
});
