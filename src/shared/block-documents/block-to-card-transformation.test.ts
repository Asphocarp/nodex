import { describe, expect, test } from "vitest";
import type { BlockTreeNode } from "./block-document-codec";
import { BLOCK_TO_CARD_TYPE_CAPABILITIES } from "./block-semantic-content";
import { HEADLESS_BLOCK_DOCUMENT_BLOCK_TYPES } from "./headless-blocknote-schema";
import { planBlockToCardTransformation } from "./block-to-card-transformation";

const paragraph = (
  id: string,
  content: unknown,
  children: readonly BlockTreeNode[] = [],
): BlockTreeNode => ({
  id,
  type: "paragraph",
  props: {
    backgroundColor: "default",
    textColor: "default",
    textAlignment: "left",
  },
  content: content as BlockTreeNode["content"],
  children,
});

describe("BlockToCardTransformation", () => {
  test("keeps the registered Block schema capability matrix exhaustive", () => {
    expect(Object.keys(BLOCK_TO_CARD_TYPE_CAPABILITIES).sort()).toEqual(
      [...HEADLESS_BLOCK_DOCUMENT_BLOCK_TYPES].sort(),
    );
  });

  test("consumes root primary rich content and lifts only existing children", () => {
    const child = paragraph("child-a", [
      { type: "text", text: "Child", styles: {} },
    ]);
    const root = paragraph(
      "root-a",
      [
        { type: "text", text: "Rich ", styles: { bold: true } },
        {
          type: "link",
          href: "https://nodex.local",
          content: [{ type: "text", text: "title", styles: { italic: true } }],
        },
        { type: "threadMention", props: { uuid: "thread-a" } },
      ],
      [child],
    );

    const plan = planBlockToCardTransformation({
      root,
      resultRootId: root.id,
      wrapperCardId: "wrapper-unused",
      allocateEmptyBodyBlockId: () => "empty-unused",
    });

    expect(plan).toMatchObject({
      kind: "promote",
      cardId: "root-a",
      richTitle: [
        { type: "text", text: "Rich ", styles: { bold: true } },
        {
          type: "link",
          text: "title",
          href: "https://nodex.local",
          styles: { italic: true },
        },
        { type: "threadMention", uuid: "thread-a" },
      ],
      bodyRoots: [child],
      placeholderBlockId: null,
    });
    if (plan.kind === "promote") {
      expect(plan.bodyRoots.some((block) => block.id === root.id)).toBe(false);
    }
  });

  test("gives a leaf Card one new canonical empty body Block", () => {
    const plan = planBlockToCardTransformation({
      root: paragraph("leaf", [{ type: "text", text: "Leaf", styles: {} }]),
      resultRootId: "leaf",
      wrapperCardId: "wrapper-unused",
      allocateEmptyBodyBlockId: () => "empty-body",
    });
    expect(plan).toMatchObject({
      kind: "promote",
      cardId: "leaf",
      bodyRoots: [{ id: "empty-body", type: "paragraph", content: [] }],
      placeholderBlockId: "empty-body",
    });
  });

  test("wraps unsupported inline atoms and stateful Block types without loss", () => {
    const attachmentRoot = paragraph("attachment-root", [
      {
        type: "attachment",
        props: {
          kind: "file",
          mode: "materialized",
          source: "nodex://assets/demo.txt",
          name: "demo.txt",
        },
      },
    ]);
    expect(
      planBlockToCardTransformation({
        root: attachmentRoot,
        resultRootId: attachmentRoot.id,
        wrapperCardId: "wrapper-attachment",
        allocateEmptyBodyBlockId: () => "unused",
      }),
    ).toMatchObject({
      kind: "wrap",
      cardId: "wrapper-attachment",
      wrappedRoot: attachmentRoot,
      reason: "unsupported_primary_content",
    });

    const checklist: BlockTreeNode = {
      ...paragraph("check", [{ type: "text", text: "Done", styles: {} }]),
      type: "checkListItem",
      props: { checked: true },
    };
    const checklistPlan = planBlockToCardTransformation({
      root: checklist,
      resultRootId: checklist.id,
      wrapperCardId: "wrapper-check",
      allocateEmptyBodyBlockId: () => "unused",
    });
    expect(checklistPlan).toMatchObject({
      kind: "wrap",
      cardId: "wrapper-check",
      wrappedRoot: checklist,
      reason: "type_requires_wrapper",
    });
    if (checklistPlan.kind !== "wrap") return;
    expect(checklistPlan.richTitle).toEqual([
      { type: "text", text: "Done", styles: {} },
    ]);
  });
});
