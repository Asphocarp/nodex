import { describe, expect, test } from "vitest";
import * as Y from "yjs";
import {
  readPortableRichTextFromYText,
  replaceYTextWithPortableRichText,
} from "../../shared/block-documents/portable-rich-text";
import {
  applyRichTitleTextEdit,
  nextRichTitleCodePointIndex,
  previousRichTitleCodePointIndex,
  toggleRichTitleFormat,
  setRichTitleLink,
} from "./rich-title-ytext-editing";

describe("rich title Y.Text editing", () => {
  test("deletes complete Unicode code points and strips untyped atom input", () => {
    expect(previousRichTitleCodePointIndex("A😀B", 3)).toBe(1);
    expect(nextRichTitleCodePointIndex("A😀B", 1)).toBe(3);
    const document = new Y.Doc();
    const title = document.getText("title");
    title.insert(0, "Safe");
    applyRichTitleTextEdit({
      title,
      start: 4,
      end: 4,
      insertText: "\uFFFC text",
      origin: "test",
    });
    expect(title.toString()).toBe("Safe text");
    document.destroy();
  });

  test("inherits text styles, keeps linebreaks unformatted, and never formats atoms", () => {
    const document = new Y.Doc();
    const title = document.getText("title");
    replaceYTextWithPortableRichText(title, [
      { type: "text", text: "Bold", styles: { bold: true } },
      { type: "threadMention", uuid: "thread-1" },
    ]);
    applyRichTitleTextEdit({
      title,
      start: 4,
      end: 4,
      insertText: " more\nnext",
      origin: "test",
    });
    toggleRichTitleFormat({
      title,
      start: 0,
      end: title.length,
      attribute: "italic",
      origin: "test",
    });
    expect(readPortableRichTextFromYText(title)).toEqual([
      { type: "text", text: "Bold more", styles: { bold: true, italic: true } },
      { type: "linebreak" },
      { type: "text", text: "next", styles: { bold: true, italic: true } },
      { type: "threadMention", uuid: "thread-1" },
    ]);
    document.destroy();
  });

  test("applies and removes links only across title-safe text ranges", () => {
    const document = new Y.Doc();
    const title = document.getText("title");
    replaceYTextWithPortableRichText(title, [
      { type: "text", text: "Read", styles: {} },
      { type: "threadMention", uuid: "thread-1" },
    ]);
    expect(setRichTitleLink({
      title,
      start: 0,
      end: title.length,
      href: "https://nodex.local",
      origin: "test",
    })).toBe(true);
    expect(readPortableRichTextFromYText(title)).toEqual([
      { type: "link", text: "Read", href: "https://nodex.local", styles: {} },
      { type: "threadMention", uuid: "thread-1" },
    ]);
    expect(setRichTitleLink({
      title,
      start: 0,
      end: 4,
      href: null,
      origin: "test",
    })).toBe(true);
    expect(readPortableRichTextFromYText(title)[0]).toEqual({
      type: "text",
      text: "Read",
      styles: {},
    });
    document.destroy();
  });
});
