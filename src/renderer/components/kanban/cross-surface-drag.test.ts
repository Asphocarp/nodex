import { describe, expect, test } from "vitest";
import {
  beginLocalNativeEditorDrag,
  endLocalNativeEditorDrag,
  encodeBlockCardCopyDragPayload,
  encodeCardReferenceDragPayload,
  parseBlockCardCopyDragPayload,
  parseCardReferenceDragPayload,
  shouldHandleNativeCrossSurfaceDrag,
  NODEX_BLOCK_CARD_COPIES_DRAG_MIME,
  NODEX_CARD_REFERENCES_DRAG_MIME,
} from "./cross-surface-drag";

describe("cross-surface Block-first drag payloads", () => {
  test("round-trips Card references without serializing Card bodies", () => {
    const serialized = encodeCardReferenceDragPayload([
      { projectId: "project-a", cardId: "card-a", title: "Card A" },
    ]);
    const payload = parseCardReferenceDragPayload(serialized);

    expect(payload?.cards).toEqual([
      { projectId: "project-a", cardId: "card-a", title: "Card A" },
    ]);
    expect(serialized).not.toContain("description");
  });

  test("round-trips NFM only as new-Card genesis copy data", () => {
    const payload = parseBlockCardCopyDragPayload(
      encodeBlockCardCopyDragPayload({
        sourceProjectId: "project-a",
        cards: [{ title: "Extracted block", description: "Nested body" }],
      }),
    );

    expect(payload?.cards).toEqual([
      { title: "Extracted block", description: "Nested body" },
    ]);
  });

  test("rejects duplicate Card identities and unbounded payloads", () => {
    const duplicate = encodeCardReferenceDragPayload([
      { projectId: "project-a", cardId: "card-a", title: "One" },
      { projectId: "project-a", cardId: "card-a", title: "Two" },
    ]);
    expect(parseCardReferenceDragPayload(duplicate)).toBeNull();
    expect(parseCardReferenceDragPayload("x".repeat(1_900_001))).toBeNull();
  });

  test("accepts native payloads only while a local editor owns the drag", () => {
    const editor = document.createElement("div");
    const cardReferenceTransfer = {
      types: [NODEX_CARD_REFERENCES_DRAG_MIME],
    };
    const editorBlockTransfer = {
      types: [NODEX_BLOCK_CARD_COPIES_DRAG_MIME],
    };

    expect(shouldHandleNativeCrossSurfaceDrag(cardReferenceTransfer)).toBe(false);
    beginLocalNativeEditorDrag(editor);
    expect(shouldHandleNativeCrossSurfaceDrag(cardReferenceTransfer)).toBe(true);
    expect(shouldHandleNativeCrossSurfaceDrag(editorBlockTransfer)).toBe(true);
    endLocalNativeEditorDrag(editor);
    expect(shouldHandleNativeCrossSurfaceDrag(cardReferenceTransfer)).toBe(false);
  });
});
