import { describe, expect, test } from "vitest";
import {
  hasTypedOwnerBlock,
  hasNestedTypedOwnerBlock,
  hasTypedOwnerType,
  isTypedOwnerBlockType,
  typedOwnerBlocks,
} from "./typed-owner-blocks";

describe("typed owner block boundary", () => {
  test("recognizes owners but not non-owning page references", () => {
    expect(isTypedOwnerBlockType("page")).toBe(true);
    expect(isTypedOwnerBlockType("database")).toBe(true);
    expect(isTypedOwnerBlockType("canvas")).toBe(true);
    expect(isTypedOwnerBlockType("pageRef")).toBe(false);
    expect(isTypedOwnerBlockType(undefined)).toBe(false);
  });

  test("filters typed owners without changing the caller's block objects", () => {
    const blocks = [
      { id: "text", type: "paragraph" },
      { id: "page", type: "page" },
      { id: "reference", type: "pageRef" },
    ] as const;

    expect(hasTypedOwnerBlock(blocks)).toBe(true);
    expect(typedOwnerBlocks(blocks)).toEqual([{ id: "page", type: "page" }]);
    expect(blocks).toHaveLength(3);
  });

  test("recognizes typed owners from captured target types", () => {
    expect(hasTypedOwnerType(["paragraph", "page"])).toBe(true);
    expect(hasTypedOwnerType(["paragraph", null, undefined])).toBe(false);
  });

  test("walks descendants without treating a typed root as a second owner", () => {
    const nestedPage = {
      id: "nested-page",
      type: "page",
    } as const;
    const ordinaryParent = {
      id: "ordinary-parent",
      type: "paragraph",
      children: [nestedPage],
    } as const;
    const pageWithNestedPage = {
      id: "page",
      type: "page",
      children: [nestedPage],
    } as const;

    expect(hasTypedOwnerBlock([ordinaryParent])).toBe(true);
    expect(hasNestedTypedOwnerBlock([ordinaryParent])).toBe(true);
    expect(hasNestedTypedOwnerBlock([pageWithNestedPage])).toBe(false);
    expect(typedOwnerBlocks([pageWithNestedPage])).toEqual([pageWithNestedPage]);
  });
});
