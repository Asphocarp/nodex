import { describe, expect, test } from "vitest";
import { isBlockWithinOwnerTree } from "./block-tree-ancestry";

describe("Block tree ancestry", () => {
  test("finds a stable-ID ancestor without depending on mounted DOM", () => {
    const parents = new Map([
      ["leaf", { id: "nested" }],
      ["nested", { id: "owner" }],
    ]);
    expect(isBlockWithinOwnerTree((id) => parents.get(id), "owner", "leaf"))
      .toBe(true);
    expect(isBlockWithinOwnerTree((id) => parents.get(id), "other", "leaf"))
      .toBe(false);
  });

  test("fails closed for malformed ancestry cycles", () => {
    const parents = new Map([
      ["a", { id: "b" }],
      ["b", { id: "a" }],
    ]);
    expect(isBlockWithinOwnerTree((id) => parents.get(id), "owner", "a"))
      .toBe(false);
  });
});
