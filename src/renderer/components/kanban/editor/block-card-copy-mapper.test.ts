import { describe, expect, test } from "vitest";
import {
  mapCanonicalCardReferences,
  mapBlocksToCardCopies,
  resolveTopLevelDraggedBlocks,
  type DraggableEditorBlock,
} from "./block-card-copy-mapper";

describe("Block to Card copy mapping", () => {
  test("uses text as title and children as genesis body", () => {
    const cards = mapBlocksToCardCopies([
      {
        id: "root",
        type: "paragraph",
        content: [{ type: "text", text: "Card title" }],
        children: [
          {
            id: "child",
            type: "paragraph",
            content: [{ type: "text", text: "Card body" }],
          },
        ],
      },
    ]);

    expect(cards[0]?.title).toBe("Card title");
    expect(cards[0]?.description).toContain("Card body");
    expect(cards[0]?.description).not.toContain("Card title");
  });

  test("does not duplicate a selected descendant", () => {
    const child: DraggableEditorBlock = {
      id: "child",
      type: "paragraph",
      content: "Child",
    };
    const root: DraggableEditorBlock = {
      id: "root",
      type: "paragraph",
      content: "Root",
      children: [child],
    };
    const byId = new Map([
      [root.id, root],
      [child.id, child],
    ]);
    const roots = resolveTopLevelDraggedBlocks(
      {
        getBlock: (id) => byId.get(id),
        getParentBlock: (id) => (id === child.id ? root : undefined),
      },
      [root.id, child.id],
    );

    expect(roots.map((block) => block.id)).toEqual([root.id]);
  });

  test("keeps canonical Card references as identity intent", () => {
    expect(
      mapCanonicalCardReferences(
        [
          {
            id: "reference",
            type: "cardRef",
            props: { targetBlockId: "card-a", displayHint: "Card A" },
          },
        ],
        "project-a",
      ),
    ).toEqual([{ projectId: "project-a", cardId: "card-a", title: "Card A" }]);
  });
});
