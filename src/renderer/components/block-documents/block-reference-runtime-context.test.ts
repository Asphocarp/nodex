import { describe, expect, test } from "vitest";
import {
  appendInlineCardAncestor,
  isInlineCardCycle,
} from "./block-reference-runtime-context";

describe("inline Card reference ancestry", () => {
  test("tracks the open Document path and detects indirect cycles", () => {
    const root = appendInlineCardAncestor([], "card-a");
    const nested = appendInlineCardAncestor(root, "card-b");

    expect(root.join(",")).toBe("card-a");
    expect(nested.join(",")).toBe("card-a,card-b");
    expect(isInlineCardCycle(nested, "card-a")).toBe(true);
    expect(isInlineCardCycle(nested, "card-b")).toBe(true);
    expect(isInlineCardCycle(nested, "card-c")).toBe(false);
    expect(appendInlineCardAncestor(nested, "card-a") === nested).toBe(true);
  });
});
