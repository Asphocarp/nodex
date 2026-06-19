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

  test("agent config round-trips inline", () => {
    const nfm = 'before <agent-config mode="plan" model="gpt-5.5" reasoning="high" /> after';
    const blocks = parseNfm(nfm);

    expect(blocks[0]?.type).toBe("paragraph");
    if (blocks[0]?.type !== "paragraph") return;
    expect(blocks[0].content[1]?.type).toBe("agentConfig");
    if (blocks[0].content[1]?.type !== "agentConfig") return;
    expect(blocks[0].content[1].mode).toBe("plan");
    expect(blocks[0].content[1].model).toBe("gpt-5.5");
    expect(blocks[0].content[1].reasoning).toBe("high");
    expect(serializeNfm(blocks)).toBe(nfm);
    expect(serializeClipboardText(blocks)).toBe(nfm);
  });

  test("thread mentions round-trip inline and copy as readable placeholders", () => {
    const nfm = 'before <mention-thread uuid="019abc" /> and <mention-thread uuid="thread &amp; value" /> after';
    const blocks = parseNfm(nfm);

    expect(blocks[0]?.type).toBe("paragraph");
    if (blocks[0]?.type !== "paragraph") return;

    expect(blocks[0].content[1]?.type).toBe("threadMention");
    if (blocks[0].content[1]?.type !== "threadMention") return;
    expect(blocks[0].content[1].uuid).toBe("019abc");

    expect(blocks[0].content[3]?.type).toBe("threadMention");
    if (blocks[0].content[3]?.type !== "threadMention") return;
    expect(blocks[0].content[3].uuid).toBe("thread & value");
    expect(serializeNfm(blocks)).toBe(nfm);
    expect(serializeClipboardText(blocks)).toBe("before [Thread: 019abc] and [Thread: thread & value] after");
  });

  test("missing or empty thread mention uuids remain plain text", () => {
    const blocks = parseNfm('<mention-thread /> <mention-thread uuid="" />');

    expect(blocks[0]?.type).toBe("paragraph");
    if (blocks[0]?.type !== "paragraph") return;
    expect(blocks[0].content.length).toBe(1);
    expect(blocks[0].content[0]?.type).toBe("text");
    expect(serializeNfm(blocks)).toBe("\\<mention-thread /\\> \\<mention-thread uuid=\"\" /\\>");
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
