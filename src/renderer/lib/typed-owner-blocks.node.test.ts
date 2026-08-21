import { describe, expect, test } from "vitest";
import {
  OWNER_OPERATION_MATRIX,
  OWNER_OPERATIONS,
  hasTypedOwnerBlock,
  hasNestedTypedOwnerBlock,
  hasTypedOwnerType,
  isTypedOwnerBlockType,
  ownerOperationRoute,
  resolveOwnerSelectionOperation,
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

  test("exhaustively assigns one route to every owner-operation cell", () => {
    for (const [kind, row] of Object.entries(OWNER_OPERATION_MATRIX)) {
      expect(Object.keys(row).sort()).toEqual([...OWNER_OPERATIONS].sort());
      expect(Object.values(row).every((route) => route.length > 0)).toBe(true);
      expect(kind.length).toBeGreaterThan(0);
    }
    expect(ownerOperationRoute("paragraph", "delete")).toBe("generic_document");
    expect(ownerOperationRoute("page", "delete")).toBe("page_lifecycle");
    expect(ownerOperationRoute("page", "move")).toBe("block_transfer");
    expect(ownerOperationRoute("canvas", "duplicate")).toBe("canvas_lifecycle");
    expect(ownerOperationRoute("database", "archive")).toBe("database_lifecycle");
    expect(ownerOperationRoute("pageRef", "unlink")).toBe("reference_unlink");
  });

  test("routes only one exact owner and rejects mixed or nested destructive selections", () => {
    expect(resolveOwnerSelectionOperation([{ id: "page", type: "page" }], "delete")).toEqual({
      kind: "typed",
      block: { id: "page", type: "page" },
      route: "page_lifecycle",
    });
    expect(
      resolveOwnerSelectionOperation([{ id: "reference", type: "pageRef" }], "delete"),
    ).toEqual({ kind: "generic" });
    expect(
      resolveOwnerSelectionOperation([{ id: "database", type: "database" }], "delete"),
    ).toEqual({ kind: "forbidden", reason: "unsupported" });
    expect(
      resolveOwnerSelectionOperation(
        [
          { id: "page", type: "page" },
          { id: "text", type: "paragraph" },
        ],
        "delete",
      ),
    ).toEqual({ kind: "forbidden", reason: "mixed_selection" });
    expect(
      resolveOwnerSelectionOperation(
        [
          {
            id: "parent",
            type: "paragraph",
            children: [{ id: "page", type: "page" }],
          },
        ],
        "delete",
      ),
    ).toEqual({ kind: "forbidden", reason: "nested_owner" });
  });
});
