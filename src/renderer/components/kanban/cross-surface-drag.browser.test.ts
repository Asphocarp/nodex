import { describe, expect, test } from "vitest";
import { setupCardReferenceDrop } from "./editor/card-reference-drop";
import {
  beginLocalNativeEditorDrag,
  encodeCardReferenceDragPayload,
  endLocalNativeEditorDrag,
  NODEX_CARD_REFERENCES_DRAG_MIME,
} from "./cross-surface-drag";

describe("cross-surface drag in Chromium", () => {
  test("reads the custom MIME payload at drop and inserts a Card reference", () => {
    const container = document.createElement("div");
    const source = document.createElement("div");
    document.body.append(source, container);
    const replacements: unknown[][] = [];
    const cleanup = setupCardReferenceDrop(
      container,
      {
        document: [],
        insertBlocks: () => undefined,
        replaceBlocks: (_removed, next) => replacements.push([...next]),
      },
      {
        projectId: "project-a",
        hostCardId: "host-card",
        ancestorCardIds: [],
        allocateBlockId: () => "reference-block",
      },
    );
    const transfer = new DataTransfer();
    transfer.setData(
      NODEX_CARD_REFERENCES_DRAG_MIME,
      encodeCardReferenceDragPayload([
        { projectId: "project-a", cardId: "target-card", title: "Target" },
      ]),
    );
    beginLocalNativeEditorDrag(source);

    container.dispatchEvent(
      new DragEvent("drop", {
        bubbles: true,
        clientX: 0,
        clientY: 0,
        dataTransfer: transfer,
      }),
    );

    expect(replacements).toEqual([
      [
        {
          id: "reference-block",
          type: "cardRef",
          props: { targetBlockId: "target-card", displayHint: "Target" },
        },
      ],
    ]);
    cleanup();
    endLocalNativeEditorDrag(source);
    source.remove();
    container.remove();
  });
});
