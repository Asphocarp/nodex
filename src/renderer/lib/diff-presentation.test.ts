import { describe, expect, test } from "bun:test";
import { getNodexDiffOptions } from "./diff-presentation";

describe("getNodexDiffOptions", () => {
  test("uses wrap overflow when word wrap is enabled", () => {
    const options = getNodexDiffOptions("light", true, { wrap: true });
    expect(options.overflow).toBe("wrap");
  });

  test("keeps scroll overflow when word wrap is disabled", () => {
    const options = getNodexDiffOptions("light", true, { wrap: false });
    expect(options.overflow).toBe("scroll");
  });

  test("lets an explicit overflow override the wrap default", () => {
    const options = getNodexDiffOptions("light", true, {
      wrap: true,
      overflow: "scroll",
    });
    expect(options.overflow).toBe("scroll");
  });
});
