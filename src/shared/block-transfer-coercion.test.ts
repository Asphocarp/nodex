import { describe, expect, test } from "vitest";
import { headlessBlockDocumentSchema } from "./block-documents/headless-blocknote-schema";
import {
  BLOCK_TRANSFER_COERCION_BLOCK_TYPES,
  BLOCK_TRANSFER_DATABASE_COERCION_POLICY,
  BlockTransferCoercionError,
  planDatabaseTransferCoercions,
} from "./block-transfer-coercion";

describe("Database transfer coercion", () => {
  test("classifies every Block type in the canonical headless schema", () => {
    expect(
      Object.keys(headlessBlockDocumentSchema.blockSpecs).sort(),
    ).toEqual([...BLOCK_TRANSFER_COERCION_BLOCK_TYPES].sort());
    expect(
      Object.keys(BLOCK_TRANSFER_DATABASE_COERCION_POLICY).sort(),
    ).toEqual([...BLOCK_TRANSFER_COERCION_BLOCK_TYPES].sort());
  });

  test("preserves promotable identity and wraps reference/media identities", () => {
    expect(
      planDatabaseTransferCoercions({
        roots: [
          { blockId: "paragraph-1", blockType: "paragraph", text: "  Title\nbody" },
          { blockId: "image-1", blockType: "image", text: "" },
          { blockId: "reference-1", blockType: "cardRef", text: "Linked" },
          { blockId: "card-1", blockType: "card", text: "Existing" },
        ],
        allocateWrapperCardId: (sourceBlockId) => `wrapper:${sourceBlockId}`,
      }),
    ).toEqual([
      {
        kind: "promote_in_place",
        sourceBlockId: "paragraph-1",
        cardBlockId: "paragraph-1",
        title: "Title",
      },
      {
        kind: "wrap_in_card",
        sourceBlockId: "image-1",
        cardBlockId: "wrapper:image-1",
        title: "Untitled",
      },
      {
        kind: "wrap_in_card",
        sourceBlockId: "reference-1",
        cardBlockId: "wrapper:reference-1",
        title: "Linked",
      },
      {
        kind: "already_card",
        sourceBlockId: "card-1",
        cardBlockId: "card-1",
      },
    ]);
  });

  test("fails closed for legacy projections and unknown future types", () => {
    expect(() =>
      planDatabaseTransferCoercions({
        roots: [
          { blockId: "legacy", blockType: "cardToggle", text: "Legacy" },
        ],
        allocateWrapperCardId: () => "unused",
      }),
    ).toThrow(BlockTransferCoercionError);
    expect(() =>
      planDatabaseTransferCoercions({
        roots: [
          { blockId: "future", blockType: "futureBlock", text: "Future" },
        ],
        allocateWrapperCardId: () => "unused",
      }),
    ).toThrow(/no Database transfer policy/);
  });
});
