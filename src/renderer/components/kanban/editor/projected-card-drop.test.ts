import { describe, expect, test } from "vitest";
import {
  materializeProjectedCardToggleBlock,
  resolveProjectedCardDropSource,
} from "./projected-card-drop";
import {
  PROJECTION_CARD_ID_PROP,
  PROJECTION_KIND_PROP,
  PROJECTION_OWNER_PROP,
  PROJECTION_SOURCE_PROJECT_PROP,
} from "./projection-card-toggle";
import type { DragSessionBlock } from "./external-block-drag-session";

function makeBlock(
  block: Partial<DragSessionBlock> & Pick<DragSessionBlock, "id" | "type">,
): DragSessionBlock {
  return {
    id: block.id,
    type: block.type,
    props: block.props ?? {},
    content: block.content ?? [],
    children: block.children ?? [],
  };
}

describe("projected card drop helpers", () => {
  test("resolves projected source metadata from projected card toggle props", () => {
    const projectedBlock = makeBlock({
      id: "projected-1",
      type: "cardToggle",
      props: {
        cardId: "card-123",
        sourceProjectId: "default",
        sourceStatus: "in_progress",
        [PROJECTION_OWNER_PROP]: "owner-1",
        [PROJECTION_SOURCE_PROJECT_PROP]: "default",
        [PROJECTION_CARD_ID_PROP]: "card-123",
      },
    });

    expect(
      JSON.stringify(resolveProjectedCardDropSource(projectedBlock)),
    ).toBe(JSON.stringify({
      ownerBlockId: "owner-1",
      sourceProjectId: "default",
      sourceCardId: "card-123",
      sourceStatus: "in_progress",
    }));
  });

  test("returns null for non-projected card toggles", () => {
    const nonProjected = makeBlock({
      id: "toggle-1",
      type: "cardToggle",
      props: {
        cardId: "card-123",
        sourceProjectId: "default",
      },
    });

    expect(resolveProjectedCardDropSource(nonProjected) === null).toBe(true);
  });

  test("materializes projected card toggle by stripping projection metadata", () => {
    const projectedBlock = makeBlock({
      id: "projected-1",
      type: "cardToggle",
      props: {
        cardId: "card-123",
        meta: "[P1]",
        sourceProjectId: "default",
        sourceStatus: "in_progress",
        [PROJECTION_OWNER_PROP]: "owner-1",
        [PROJECTION_SOURCE_PROJECT_PROP]: "default",
        [PROJECTION_CARD_ID_PROP]: "card-123",
        [PROJECTION_KIND_PROP]: "toggleListInlineView",
      },
      content: [{ type: "text", text: "Dragged title" }],
      children: [{ id: "child-1", type: "paragraph", content: [{ type: "text", text: "Body" }], children: [] }],
    });

    const source = resolveProjectedCardDropSource(projectedBlock);
    if (!source) throw new Error("expected projected source metadata");

    const materialized = materializeProjectedCardToggleBlock(projectedBlock, source);
    expect("id" in materialized).toBe(false);
    expect(materialized.type).toBe("cardToggle");
    expect(materialized.props?.cardId).toBe("card-123");
    expect(materialized.props?.sourceProjectId).toBe("default");
    expect(materialized.props?.sourceStatus).toBe("in_progress");
    expect(materialized.props?.[PROJECTION_OWNER_PROP] === undefined).toBe(true);
    expect(materialized.props?.[PROJECTION_SOURCE_PROJECT_PROP] === undefined).toBe(true);
    expect(materialized.props?.[PROJECTION_CARD_ID_PROP] === undefined).toBe(true);
    expect(materialized.props?.[PROJECTION_KIND_PROP] === undefined).toBe(true);
    expect(JSON.stringify(materialized.content)).toBe(
      JSON.stringify(projectedBlock.content),
    );
    expect(JSON.stringify(materialized.children)).toBe(
      JSON.stringify(projectedBlock.children),
    );
  });
});
