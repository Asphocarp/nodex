import { describe, expect, test } from "bun:test";
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
    expect(isInlineCardCycle(nested, "card-a")).toBeTrue();
    expect(isInlineCardCycle(nested, "card-b")).toBeTrue();
    expect(isInlineCardCycle(nested, "card-c")).toBeFalse();
    expect(appendInlineCardAncestor(nested, "card-a") === nested).toBeTrue();
  });
});
