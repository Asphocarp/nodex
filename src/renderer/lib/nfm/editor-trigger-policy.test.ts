import { describe, expect, it } from "vitest";

import {
  evaluateNfmTypedSuggestionTrigger,
  getNfmSlashTriggerCharacters,
} from "./editor-trigger-policy";

function evaluate(
  kind: "slash" | "mention" | "emoji",
  trigger: string,
  textBeforeTrigger: string,
  locale = "en-US",
) {
  return evaluateNfmTypedSuggestionTrigger({
    kind,
    trigger,
    textBeforeTrigger,
    locale,
  });
}

describe("NFM typed suggestion trigger policy", () => {
  it("registers locale-appropriate slash triggers", () => {
    expect(getNfmSlashTriggerCharacters("en-US")).toEqual(["/", "／"]);
    expect(getNfmSlashTriggerCharacters("ja-JP")).toEqual(["/", "／", "；"]);
    expect(getNfmSlashTriggerCharacters("ja")).toEqual(["/", "／", "；"]);
  });

  it.each(["", "hello ", "hello\u00a0", "hello\u3000"])(
    "opens slash suggestions at a text boundary: %j",
    (textBeforeTrigger) => {
      expect(evaluate("slash", "/", textBeforeTrigger)).toEqual({ allowed: true });
    },
  );

  it.each(["abc", "7", "(", "-", "."])(
    "rejects slash suggestions inside a word or after an ASCII digit: %j",
    (textBeforeTrigger) => {
      expect(evaluate("slash", "/", textBeforeTrigger)).toMatchObject({
        allowed: false,
        reason: "invalid-left-boundary",
      });
    },
  );

  it("accepts the Japanese slash alias only in Japanese locales", () => {
    expect(evaluate("slash", "；", "", "ja-JP")).toEqual({ allowed: true });
    expect(evaluate("slash", "；", "", "en-US")).toMatchObject({
      allowed: false,
      reason: "unsupported-trigger",
    });
  });

  it.each(["http:", "http:/", "https:", "https:/"])(
    "keeps URL-like slash input literal: %j",
    (textBeforeTrigger) => {
      expect(evaluate("slash", "/", textBeforeTrigger)).toEqual({
        allowed: false,
        reason: "protected-literal",
      });
    },
  );

  it.each(["", "hello ", "hello(", "hello)", "hello[", "hello]"])(
    "opens mention suggestions at a supported boundary: %j",
    (textBeforeTrigger) => {
      expect(evaluate("mention", "@", textBeforeTrigger)).toEqual({ allowed: true });
    },
  );

  it("keeps word-adjacent mentions literal", () => {
    expect(evaluate("mention", "@", "hello")).toEqual({
      allowed: false,
      reason: "invalid-left-boundary",
    });
  });

  it.each(["hello.", "hello-"])("rejects unsupported mention punctuation: %j", (text) => {
    expect(evaluate("mention", "@", text)).toMatchObject({
      allowed: false,
      reason: "invalid-left-boundary",
    });
  });

  it.each(["hello（", "hello）", "hello［", "hello］"])(
    "normalizes fullwidth mention boundaries: %j",
    (text) => {
      expect(evaluate("mention", "@", text)).toEqual({ allowed: true });
    },
  );

  it.each(["", "hello ", "hello{", "hello[", "hello("])(
    "opens emoji suggestions at a supported boundary: %j",
    (textBeforeTrigger) => {
      expect(evaluate("emoji", ":", textBeforeTrigger)).toEqual({ allowed: true });
    },
  );

  it("keeps word-adjacent emoji colons literal", () => {
    expect(evaluate("emoji", ":", "hello")).toEqual({
      allowed: false,
      reason: "invalid-left-boundary",
    });
  });

  it.each(["hello)", "hello]", "hello}"])(
    "rejects closing delimiters for emoji search: %j",
    (text) => {
      expect(evaluate("emoji", ":", text)).toMatchObject({
        allowed: false,
        reason: "invalid-left-boundary",
      });
    },
  );

  it("rejects trigger characters that do not belong to the requested menu", () => {
    expect(evaluate("slash", "；", "", "en-US")).toEqual({
      allowed: false,
      reason: "unsupported-trigger",
    });
    expect(evaluate("mention", "／", "")).toEqual({
      allowed: false,
      reason: "unsupported-trigger",
    });
  });
});
