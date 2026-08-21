import { describe, expect, test } from "vitest";
import { resolveTopLevelDraggedBlocks, type DraggableEditorBlock } from "./dragged-block-roots";

describe("dragged Block roots", () => {
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
    expect(
      resolveTopLevelDraggedBlocks(
        {
          getBlock: (id) => byId.get(id),
          getParentBlock: (id) => (id === child.id ? root : undefined),
        },
        [root.id, child.id],
      ).map((block) => block.id),
    ).toEqual([root.id]);
  });
});
