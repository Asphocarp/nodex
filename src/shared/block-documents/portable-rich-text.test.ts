import { describe, expect, test } from "vitest";
import * as Y from "yjs";
import {
  MAX_PORTABLE_RICH_TEXT_SEGMENTS,
  canonicalizePortableRichText,
  plainTextToPortableRichText,
  portableRichTextFromYTextDelta,
  portableRichTextPlainText,
  portableRichTextSemanticSource,
  readPortableRichTextFromYText,
  replaceYTextWithPortableRichText,
  type PortableRichText,
} from "./portable-rich-text";

const richTitle: PortableRichText = [
  { type: "text", text: "Build ", styles: { bold: true } },
  {
    type: "link",
    text: "Nodex",
    href: "https://nodex.local/spec",
    styles: { italic: true, color: "blue" },
  },
  { type: "linebreak" },
  { type: "threadMention", uuid: "thread-123" },
  { type: "text", text: " by ", styles: {} },
  { type: "dateMention", start: "2026-07-14", format: "ll" },
];

describe("PortableRichText", () => {
  test("round-trips canonical rich title through Y.Text Delta", () => {
    const document = new Y.Doc();
    const title = document.getText("title");

    replaceYTextWithPortableRichText(title, richTitle, "test");

    expect(readPortableRichTextFromYText(title)).toEqual(richTitle);
    expect(portableRichTextPlainText(richTitle)).toBe(
      "Build Nodex\n@thread:thread-123 by @date:2026-07-14",
    );
  });

  test("normalizes newlines and adjacent equivalent spans", () => {
    expect(
      canonicalizePortableRichText([
        { type: "text", text: "Alpha", styles: { bold: true } },
        { type: "text", text: "\nBeta", styles: { bold: true } },
        { type: "text", text: " gamma", styles: { bold: true } },
      ]),
    ).toEqual([
      { type: "text", text: "Alpha", styles: { bold: true } },
      { type: "linebreak" },
      { type: "text", text: "Beta gamma", styles: { bold: true } },
    ]);
  });

  test("formatting-only changes have distinct semantic sources", () => {
    const plain = plainTextToPortableRichText("Same");
    const bold = canonicalizePortableRichText([
      { type: "text", text: "Same", styles: { bold: true } },
    ]);

    expect(portableRichTextPlainText(plain)).toBe(portableRichTextPlainText(bold));
    expect(portableRichTextSemanticSource(plain)).not.toBe(
      portableRichTextSemanticSource(bold),
    );
  });

  test("converges after concurrent rich edits and duplicate update exchange", () => {
    const origin = new Y.Doc();
    replaceYTextWithPortableRichText(origin.getText("title"), richTitle);
    const base = Y.encodeStateAsUpdate(origin);
    const first = new Y.Doc();
    const second = new Y.Doc();
    Y.applyUpdate(first, base);
    Y.applyUpdate(second, base);

    first.getText("title").insert(0, "A ", { underline: true });
    second.getText("title").format(0, 5, { code: true });
    const firstUpdate = Y.encodeStateAsUpdate(first, Y.encodeStateVector(origin));
    const secondUpdate = Y.encodeStateAsUpdate(second, Y.encodeStateVector(origin));
    Y.applyUpdate(first, secondUpdate);
    Y.applyUpdate(first, secondUpdate);
    Y.applyUpdate(second, firstUpdate);

    expect(readPortableRichTextFromYText(first.getText("title"))).toEqual(
      readPortableRichTextFromYText(second.getText("title")),
    );
  });

  test("rejects unknown attributes, untyped atoms, and unsupported inline objects", () => {
    expect(() =>
      portableRichTextFromYTextDelta([
        { insert: "unsafe", attributes: { mystery: true } },
      ]),
    ).toThrow(/mystery/);
    expect(() => portableRichTextFromYTextDelta([{ insert: "\uFFFC" }])).toThrow(
      /untyped atom/,
    );
    expect(() =>
      canonicalizePortableRichText([
        {
          type: "attachment",
          kind: "file",
          mode: "materialized",
          source: "nodex://assets/demo.txt",
          name: "demo.txt",
        },
      ]),
    ).toThrow(/not title-safe/);
  });

  test("enforces title length, segment, style, and date boundaries", () => {
    expect(plainTextToPortableRichText("x".repeat(2_000))).toHaveLength(1);
    expect(() => plainTextToPortableRichText("x".repeat(2_001))).toThrow(
      /exceeds 2000/,
    );
    expect(() =>
      canonicalizePortableRichText(
        Array.from({ length: MAX_PORTABLE_RICH_TEXT_SEGMENTS + 1 }, () => ({
          type: "linebreak",
        })),
      ),
    ).toThrow(/too many segments/);
    expect(() =>
      canonicalizePortableRichText([
        { type: "text", text: "bad", styles: { blinking: true } },
      ]),
    ).toThrow(/blinking/);
    expect(() =>
      canonicalizePortableRichText([
        { type: "dateMention", start: "not-a-date" },
      ]),
    ).toThrow(/valid date mention/);
  });
});
