import { findInlineMathInputRuleMatch } from "@blocknote/math-block";
import { describe, expect, it } from "vite-plus/test";

describe("inline Equation typing syntax", () => {
  it.each([
    ["$$x$$", "x"],
    ["before $$x + y$$", "x + y"],
    ["($$x^$$", "x^"],
    [String.raw`$$x\$y$$`, String.raw`x\$y`],
  ])("recognizes %s", (text, source) => {
    const match = findInlineMathInputRuleMatch(text);

    expect(match?.data.delimitedSource).toBe(`$$${source}$$`);
    expect(match?.data.source).toBe(source);
  });

  it.each([
    "$x$",
    "$$$$",
    "$$ x$$",
    "$$x $$",
    "$$x$",
    "before$$x$$",
    "0$$x$$",
    "_$$x$$",
    "[$$x$$",
    "{$$x$$",
    ".$$x$$",
    ",$$x$$",
    ":$$x$$",
    ";$$x$$",
    "!$$x$$",
    "?$$x$$",
    "-$$x$$",
    "+$$x$$",
    "=$$x$$",
    "‘$$x$$",
    "“$$x$$",
    "—$$x$$",
    String.raw`\$$x$$`,
  ])("keeps %s as literal text", (text) => {
    expect(findInlineMathInputRuleMatch(text)).toBeNull();
  });
});
