import { describe, expect, test } from "vitest";
import {
  beginLocalNativeEditorDrag,
  encodeCardReferenceDragPayload,
  endLocalNativeEditorDrag,
  NODEX_CARD_REFERENCES_DRAG_MIME,
} from "../cross-surface-drag";
import {
  setupCardReferenceDrop,
  type CardReferenceDropEditor,
} from "./card-reference-drop";

const makeDataTransfer = (serialized: string): DataTransfer =>
  ({
    types: [NODEX_CARD_REFERENCES_DRAG_MIME],
    dropEffect: "none",
    getData: (type: string) =>
      type === NODEX_CARD_REFERENCES_DRAG_MIME ? serialized : "",
  }) as unknown as DataTransfer;

describe("Card reference drop", () => {
  test("inserts canonical references and rejects self references", () => {
    const container = document.createElement("div");
    const source = document.createElement("div");
    document.body.append(source, container);
    const replacements: unknown[][] = [];
    const editor: CardReferenceDropEditor = {
      document: [],
      insertBlocks: () => undefined,
      replaceBlocks: (_removed, next) => replacements.push([...next]),
    };
    const cleanup = setupCardReferenceDrop(container, editor, {
      projectId: "project-a",
      hostCardId: "card-host",
      ancestorCardIds: [],
      allocateBlockId: () => "reference-1",
    });
    const dataTransfer = makeDataTransfer(
      encodeCardReferenceDragPayload([
        { projectId: "project-a", cardId: "card-host", title: "Self" },
        { projectId: "project-b", cardId: "card-foreign", title: "Foreign" },
        { projectId: "project-a", cardId: "card-target", title: "Target" },
      ]),
    );
    beginLocalNativeEditorDrag(source);

    const drop = new Event("drop", { bubbles: true });
    Object.defineProperty(drop, "dataTransfer", { value: dataTransfer });
    Object.defineProperty(drop, "clientX", { value: 0 });
    Object.defineProperty(drop, "clientY", { value: 0 });
    container.dispatchEvent(drop);

    expect(replacements).toEqual([
      [
        {
          id: "reference-1",
          type: "cardRef",
          props: { targetBlockId: "card-target", displayHint: "Target" },
        },
      ],
    ]);
    cleanup();
    endLocalNativeEditorDrag(source);
    source.remove();
    container.remove();
  });
});
