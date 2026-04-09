import { describe, expect, test } from "bun:test";
import type { NfmBlock } from "./types";
import { serializeClipboardText } from "./clipboard-text-serializer";
import { parseNfm } from "./parser";
import { serializeNfm } from "./serializer";

describe("NFM code fences", () => {
  test("serializeNfm uses a longer fence when code contains triple backticks", () => {
    const blocks = [
      {
        type: "codeBlock",
        language: "ts",
        code: "const a = 1;\n```\nconst b = 2;",
        children: [],
      },
    ] satisfies NfmBlock[];

    const serialized = serializeNfm(blocks);
    expect(serialized).toBe("````ts\nconst a = 1;\n```\nconst b = 2;\n````");

    const reparsed = parseNfm(serialized);
    expect(reparsed.length).toBe(1);
    expect(reparsed[0]?.type).toBe("codeBlock");
    if (reparsed[0]?.type !== "codeBlock") return;

    expect(reparsed[0].language).toBe("ts");
    expect(reparsed[0].code).toBe("const a = 1;\n```\nconst b = 2;");
    expect(reparsed[0].children.length).toBe(0);
  });

  test("parseNfm accepts tilde fences and ignores shorter interior runs", () => {
    const input = "~~~~js\nconst a = 1;\n~~~\nconst b = 2;\n~~~~";

    const parsed = parseNfm(input);

    expect(parsed.length).toBe(1);
    expect(parsed[0]?.type).toBe("codeBlock");
    if (parsed[0]?.type !== "codeBlock") return;

    expect(parsed[0].language).toBe("js");
    expect(parsed[0].code).toBe("const a = 1;\n~~~\nconst b = 2;");
  });

  test("parseNfm accepts a longer closing fence than the opener", () => {
    const input = "````\nvalue\n`````";

    const parsed = parseNfm(input);

    expect(parsed.length).toBe(1);
    expect(parsed[0]?.type).toBe("codeBlock");
    if (parsed[0]?.type !== "codeBlock") return;

    expect(parsed[0].language).toBe("");
    expect(parsed[0].code).toBe("value");
  });

  test("attachments round-trip inline while legacy resource tags fall back to plain text", () => {
    const attachmentNfm = 'before <attachment kind="file" mode="link" source="/tmp/report.txt" name="report.txt" /> after';
    const attachmentBlocks = parseNfm(attachmentNfm);

    expect(attachmentBlocks[0]?.type).toBe("paragraph");
    expect(serializeNfm(attachmentBlocks)).toBe(attachmentNfm);
    expect(serializeClipboardText(attachmentBlocks)).toBe("before [Attachment: report.txt] after");

    const legacyBlocks = parseNfm('<resource kind="file" mode="link" source="/tmp/report.txt" name="report.txt" />');
    expect(legacyBlocks[0]?.type).toBe("paragraph");
    expect(serializeNfm(legacyBlocks)).toBe('\\<resource kind="file" mode="link" source="/tmp/report.txt" name="report.txt" /\\>');
  });

  test("ordered list markers round-trip exactly and plain-text copy preserves numbering", () => {
    const input = "1. first\n2. second\n3. third";
    const blocks = parseNfm(input);

    expect(blocks.length).toBe(3);
    expect(blocks[0]?.type).toBe("numberedListItem");
    expect(blocks[1]?.type).toBe("numberedListItem");
    expect(blocks[2]?.type).toBe("numberedListItem");

    if (blocks[0]?.type !== "numberedListItem") return;
    if (blocks[1]?.type !== "numberedListItem") return;
    if (blocks[2]?.type !== "numberedListItem") return;

    expect(blocks[0].start).toBe(1);
    expect(blocks[1].start).toBe(2);
    expect(blocks[2].start).toBe(3);
    expect(serializeNfm(blocks)).toBe(input);
    expect(serializeClipboardText(blocks)).toBe(input);
  });

  test("ordered list numbering restarts after a non-list block", () => {
    const input = "3. third\n4. fourth\nParagraph break\n1. reset";
    const blocks = parseNfm(input);

    expect(blocks.length).toBe(4);
    expect(blocks[0]?.type).toBe("numberedListItem");
    expect(blocks[1]?.type).toBe("numberedListItem");
    expect(blocks[2]?.type).toBe("paragraph");
    expect(blocks[3]?.type).toBe("numberedListItem");

    if (blocks[0]?.type !== "numberedListItem") return;
    if (blocks[1]?.type !== "numberedListItem") return;
    if (blocks[3]?.type !== "numberedListItem") return;

    expect(blocks[0].start).toBe(3);
    expect(blocks[1].start).toBe(4);
    expect(blocks[3].start).toBe(1);
    expect(serializeNfm(blocks)).toBe(input);
    expect(serializeClipboardText(blocks)).toBe(input);
  });

  test("nested ordered list numbering stays independent per sibling run", () => {
    const input = "1. parent\n\t3. child three\n\t4. child four\n2. parent two";
    const blocks = parseNfm(input);

    expect(blocks.length).toBe(2);
    expect(blocks[0]?.type).toBe("numberedListItem");
    expect(blocks[1]?.type).toBe("numberedListItem");
    if (blocks[0]?.type !== "numberedListItem") return;
    if (blocks[1]?.type !== "numberedListItem") return;

    expect(blocks[0].start).toBe(1);
    expect(blocks[1].start).toBe(2);
    expect(blocks[0].children.length).toBe(2);
    expect(blocks[0].children[0]?.type).toBe("numberedListItem");
    expect(blocks[0].children[1]?.type).toBe("numberedListItem");
    if (blocks[0].children[0]?.type !== "numberedListItem") return;
    if (blocks[0].children[1]?.type !== "numberedListItem") return;

    expect(blocks[0].children[0].start).toBe(3);
    expect(blocks[0].children[1].start).toBe(4);
    expect(serializeNfm(blocks)).toBe(input);
    expect(serializeClipboardText(blocks)).toBe(input);
  });
});
