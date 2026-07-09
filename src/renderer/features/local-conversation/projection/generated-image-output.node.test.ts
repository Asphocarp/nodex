import { describe, expect, test } from "vitest";
import type { CodexConversationItem } from "../../../lib/types";
import { resolveGeneratedImageOutputState } from "./generated-image-output";

function generatedImage(
  id: string,
  src: string | null,
  status: string,
): CodexConversationItem {
  return {
    threadId: "thread-1",
    turnId: "turn-1",
    itemId: id,
    entryId: id,
    type: "imageGeneration",
    kind: "systemEvent",
    semanticKind: "generatedImage",
    generatedImage: { src, status },
    createdAt: 1,
    updatedAt: 1,
  };
}

describe("resolveGeneratedImageOutputState", () => {
  test("keeps completed sources in encounter order and pending placeholders only for an active turn", () => {
    const items = [
      generatedImage("complete-1", "data:image/png;base64,one", "completed"),
      generatedImage("pending-1", null, "inProgress"),
      generatedImage("failed-1", null, "failed"),
      generatedImage("complete-2", "/tmp/two.png", "completed"),
    ];

    const active = resolveGeneratedImageOutputState({
      items,
      endResourcePaths: [],
      isTurnInProgress: true,
    });
    const terminal = resolveGeneratedImageOutputState({
      items,
      endResourcePaths: [],
      isTurnInProgress: false,
    });

    expect(active.visibleCompletedItems.map((item) => item.itemId)).toEqual([
      "complete-1",
      "complete-2",
    ]);
    expect(active.pendingImageCount).toBe(1);
    expect(active.shouldRender).toBe(true);
    expect(terminal.pendingImageCount).toBe(0);
  });

  test("suppresses completed images for a presentation resource while retaining pending generation", () => {
    const state = resolveGeneratedImageOutputState({
      items: [
        generatedImage("complete", "data:image/png;base64,one", "completed"),
        generatedImage("pending", null, "in_progress"),
      ],
      endResourcePaths: ["slides/final.PPTX?download=1"],
      isTurnInProgress: true,
    });

    expect(state.visibleCompletedItems).toEqual([]);
    expect(state.pendingImageCount).toBe(1);
    expect(state.shouldRender).toBe(true);
  });

  test("omits failed or source-less terminal output", () => {
    const state = resolveGeneratedImageOutputState({
      items: [generatedImage("failed", null, "failed")],
      endResourcePaths: [],
      isTurnInProgress: false,
    });

    expect(state.shouldRender).toBe(false);
  });
});
