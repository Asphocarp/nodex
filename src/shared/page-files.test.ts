import { describe, expect, test } from "vitest";

import { pageFileSource, parsePageFileSource } from "./page-files";

describe("Page File references", () => {
  test("round-trips stable identities without accepting path-shaped references", () => {
    const fileId = "019f-page-file:diagram 1";
    const source = pageFileSource(fileId);

    expect(source).toBe("nodex://files/019f-page-file:diagram 1");
    expect(parsePageFileSource(source)).toBe(fileId);
    expect(parsePageFileSource("nodex://files/../diagram")).toBeNull();
    expect(parsePageFileSource("nodex://files/%00diagram")).toBeNull();
    expect(parsePageFileSource("nodex://assets/diagram.png")).toBeNull();
  });
});
