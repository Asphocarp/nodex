import { describe, expect, it } from "vitest";

import { resolveCodeIndentationTransform } from "./indentation.js";

describe("resolveCodeIndentationTransform", () => {
  it("indents the current line with a literal tab and maps the caret", () => {
    expect(
      resolveCodeIndentationTransform({
        text: "alpha\nbeta",
        selection: { anchor: 8, head: 8 },
        direction: "indent",
      }),
    ).toEqual({
      edits: [{ from: 6, to: 6, insert: "\t" }],
      selection: { anchor: 9, head: 9 },
    });
  });

  it("keeps the first empty line anchored at offset zero", () => {
    expect(
      resolveCodeIndentationTransform({
        text: "\nsecond",
        selection: { anchor: 0, head: 0 },
        direction: "indent",
      }),
    ).toEqual({
      edits: [{ from: 0, to: 0, insert: "\t" }],
      selection: { anchor: 1, head: 1 },
    });
  });

  it("indents every intersected line and preserves a forward selection", () => {
    expect(
      resolveCodeIndentationTransform({
        text: "one\ntwo\nthree",
        selection: { anchor: 5, head: 11 },
        direction: "indent",
      }),
    ).toEqual({
      edits: [
        { from: 4, to: 4, insert: "\t" },
        { from: 8, to: 8, insert: "\t" },
      ],
      selection: { anchor: 6, head: 13 },
    });
  });

  it("preserves backward selection direction", () => {
    expect(
      resolveCodeIndentationTransform({
        text: "one\ntwo\nthree",
        selection: { anchor: 11, head: 5 },
        direction: "indent",
      }).selection,
    ).toEqual({ anchor: 13, head: 6 });
  });

  it("includes the next line when the selection ends at its start", () => {
    expect(
      resolveCodeIndentationTransform({
        text: "one\ntwo",
        selection: { anchor: 1, head: 4 },
        direction: "indent",
      }).edits,
    ).toEqual([
      { from: 0, to: 0, insert: "\t" },
      { from: 4, to: 4, insert: "\t" },
    ]);
  });

  it("outdents tabs, two spaces, and one space one level per line", () => {
    expect(
      resolveCodeIndentationTransform({
        text: "\tone\n  two\n three\nfour",
        selection: { anchor: 0, head: 22 },
        direction: "outdent",
      }),
    ).toEqual({
      edits: [
        { from: 0, to: 1, insert: "" },
        { from: 5, to: 7, insert: "" },
        { from: 11, to: 12, insert: "" },
      ],
      selection: { anchor: 0, head: 18 },
    });
  });

  it("returns an unchanged consumed transform when no line can be outdented", () => {
    expect(
      resolveCodeIndentationTransform({
        text: "one\ntwo",
        selection: { anchor: 0, head: 7 },
        direction: "outdent",
      }),
    ).toEqual({ edits: [], selection: { anchor: 0, head: 7 } });
  });
});
