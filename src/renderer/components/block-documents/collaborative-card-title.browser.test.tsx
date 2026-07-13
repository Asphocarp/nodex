import { act, fireEvent, render } from "@testing-library/react";
import { describe, expect, test } from "vitest";
import { userEvent } from "vitest/browser";
import * as Y from "yjs";
import {
  readPortableRichTextFromYText,
  replaceYTextWithPortableRichText,
} from "../../../shared/block-documents/portable-rich-text";
import {
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
