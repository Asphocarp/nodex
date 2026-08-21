import { describe, expect, test } from "vite-plus/test";

import {
  hasNestedTypedOwnerBlock,
  hasTypedOwnerBlock,
  hasTypedOwnerType,
  isTypedOwnerBlockType,
  resolveTypedOwnerDocumentChanges,
  type TypedOwnerBlockLike,
} from "./typed-owner-blocks";

describe("typed owner block boundary", () => {
  test("classifies owners without treating references as ownership", () => {
    expect(isTypedOwnerBlockType("page")).toBe(true);
    expect(isTypedOwnerBlockType("database")).toBe(true);
    expect(isTypedOwnerBlockType("canvas")).toBe(true);
    expect(isTypedOwnerBlockType("pageRef")).toBe(false);
    expect(hasTypedOwnerType(["paragraph", "page"])).toBe(true);
    expect(hasTypedOwnerType(["paragraph", null])).toBe(false);
  });

  test("finds typed owners anywhere in a selected root forest", () => {
    const nestedPage = { id: "nested-page", type: "page" } as const;
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
  });

  test("allows remote structural commits and ordinary local edits", () => {
    expect(
      resolveTypedOwnerDocumentChanges([
        {
          type: "delete",
          block: { id: "page", type: "page" },
          source: { type: "yjs-remote" },
        },
      ]),
    ).toEqual({ kind: "allow" });
    expect(
      resolveTypedOwnerDocumentChanges([
        {
          type: "update",
          block: { id: "text", type: "paragraph" },
          prevBlock: { id: "text", type: "paragraph" },
          source: { type: "local" },
        },
      ]),
    ).toEqual({ kind: "allow" });
    expect(
      resolveTypedOwnerDocumentChanges([
        {
          type: "delete",
          block: { id: "reference", type: "pageRef" },
          source: { type: "local" },
        },
      ]),
    ).toEqual({ kind: "allow" });
  });

  test("rejects every local generic mutation that touches owner authority", () => {
    const page: TypedOwnerBlockLike = { id: "page", type: "page" };
    const ordinary: TypedOwnerBlockLike = { id: "text", type: "paragraph" };
    const forbidden = { kind: "forbidden", reason: "generic_typed_owner_mutation" };

    expect(
      resolveTypedOwnerDocumentChanges([
        { type: "delete", block: page, source: { type: "local" } },
      ]),
    ).toEqual(forbidden);
    expect(
      resolveTypedOwnerDocumentChanges([
        { type: "delete", block: page, source: { type: "local" } },
        { type: "delete", block: ordinary, source: { type: "local" } },
      ]),
    ).toEqual(forbidden);
    expect(
      resolveTypedOwnerDocumentChanges([
        {
          type: "move",
          block: ordinary,
          prevBlock: ordinary,
          crossedBlocks: [{ id: "database", type: "database" }],
          source: { type: "drop" },
        },
      ]),
    ).toEqual(forbidden);
    expect(
      resolveTypedOwnerDocumentChanges([
        {
          type: "insert",
          block: { id: "canvas", type: "canvas" },
          source: { type: "paste" },
        },
      ]),
    ).toEqual(forbidden);
  });

  test("allows removing an ordinary Block from an already-invalid owner child position", () => {
    const owner: TypedOwnerBlockLike = { id: "page", type: "page" };
    const child: TypedOwnerBlockLike = { id: "child", type: "paragraph" };
    expect(
      resolveTypedOwnerDocumentChanges([
        {
          type: "move",
          block: child,
          prevBlock: child,
          prevParent: owner,
          source: { type: "local" },
        },
      ]),
    ).toEqual({ kind: "allow" });
  });
});
