import { describe, expect, test } from "vitest";

import { classifyChangedPaths } from "./classify-change";
import {
  githubOutputForClassification,
  parseClassificationDocument,
} from "./write-github-outputs";

describe("GitHub classification outputs", () => {
  test("writes one compact, typed plan output", () => {
    const document = parseClassificationDocument({
      changedPaths: ["src/renderer/app.tsx"],
      plan: classifyChangedPaths(["src/renderer/app.tsx"]),
    });
    const output = githubOutputForClassification(document);
    expect(output.split("\n")).toHaveLength(2);
    expect(JSON.parse(output.slice("plan=".length))).toMatchObject({ browser: true, rustFast: false });
  });

  test("rejects unknown document and plan fields", () => {
    const plan = classifyChangedPaths(["src/renderer/app.tsx"]);
    expect(() => parseClassificationDocument({ changedPaths: [], plan, surprise: true }))
      .toThrow("unknown fields");
    expect(() => parseClassificationDocument({ changedPaths: [], plan: { ...plan, surprise: true } }))
      .toThrow("unknown fields");
  });

  test("rejects non-string paths before they can reach a summary", () => {
    expect(() => parseClassificationDocument({
      changedPaths: ["safe", 42],
      plan: classifyChangedPaths(["README.md"]),
    })).toThrow("string array");
  });

  test("rejects newline-bearing paths independently", () => {
    expect(() => parseClassificationDocument({
      changedPaths: ["unsafe\npath"],
      plan: classifyChangedPaths(["README.md"]),
    })).toThrow("must not contain line breaks");
  });
});
