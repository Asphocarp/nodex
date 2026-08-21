import type { Range } from "@tiptap/core";
import type { Transaction } from "@tiptap/pm/state";

interface LinkEditEditorLike {
  transact: <T>(fn: (tr: Transaction) => T) => T;
}

export function applyNfmLinkEditAtRange(
  editor: LinkEditEditorLike,
  range: Range,
  url: string,
  text: string,
): Range {
  let nextRange = range;

  editor.transact((tr) => {
    const linkMarkType = tr.doc.type.schema.marks["link"];
    if (!linkMarkType) return;

    tr.insertText(text, range.from, range.to);
    tr.addMark(range.from, range.from + text.length, linkMarkType.create({ href: url }));
    nextRange = {
      from: range.from,
      to: range.from + text.length,
    };
  });

  return nextRange;
}
