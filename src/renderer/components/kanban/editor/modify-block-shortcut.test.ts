import { describe, expect, test } from "vitest";
import {
  modifyCurrentBlock,
  type ModifyShortcutEditor,
} from "./modify-block-shortcut";

type TestBlock = NonNullable<ReturnType<ModifyShortcutEditor["getTextCursorPosition"]>["block"]>;

function makeEditor(block: TestBlock, overrides: Partial<ModifyShortcutEditor> = {}): ModifyShortcutEditor {
  return {
    getTextCursorPosition: () => ({ block }),
    ...overrides,
  };
}

function makeToggleRoot(blockId: string, button: HTMLButtonElement): ParentNode {
  const expectedSelector = `.bn-block[data-id="${blockId}"] .bn-toggle-button`;
  return {
    querySelector: (selector: string) => (
      selector === expectedSelector ? button : null
    ),
  } as unknown as ParentNode;
}

describe("modifyCurrentBlock", () => {
  test("toggles an unchecked checklist item", () => {
    let updateJson = "";
    const block = {
      id: "check-1",
      type: "checkListItem",
      props: { checked: false },
    };
    const editor = makeEditor(block, {
      updateBlock: (target, update) => {
        updateJson = JSON.stringify({ target, update });
      },
    });

    const handled = modifyCurrentBlock(editor, { projectId: "project-1" });

    expect(handled).toBe(true);
    expect(updateJson).toBe(
      JSON.stringify({
        target: block,
        update: { props: { checked: true } },
      }),
    );
  });

  test("toggles a checked checklist item", () => {
    let updateJson = "";
    const block = {
      id: "check-1",
      type: "checkListItem",
      props: { checked: true },
    };
    const editor = makeEditor(block, {
      updateBlock: (target, update) => {
        updateJson = JSON.stringify({ target, update });
      },
    });

    const handled = modifyCurrentBlock(editor, { projectId: "project-1" });

    expect(handled).toBe(true);
    expect(updateJson).toBe(
      JSON.stringify({
        target: block,
        update: { props: { checked: false } },
      }),
    );
  });

  test("clicks the current toggle list item button", () => {
    let clicked = false;
    const button = {
      click: () => {
        clicked = true;
      },
    } as HTMLButtonElement;
    const block = { id: "toggle-1", type: "toggleListItem", props: {} };
    const editor = makeEditor(block, {
      domElement: makeToggleRoot("toggle-1", button),
    });

    const handled = modifyCurrentBlock(editor, { projectId: "project-1" });

    expect(handled).toBe(true);
    expect(clicked).toBe(true);
  });

  test("clicks the current toggle heading button", () => {
    let clicked = false;
    const button = {
      click: () => {
        clicked = true;
      },
    } as HTMLButtonElement;
    const block = { id: "heading-1", type: "heading", props: { isToggleable: true } };
    const editor = makeEditor(block, {
      domElement: makeToggleRoot("heading-1", button),
    });

    const handled = modifyCurrentBlock(editor, { projectId: "project-1" });

    expect(handled).toBe(true);
    expect(clicked).toBe(true);
  });

  test("opens image preview for an image block", () => {
    let previewKey = "";
    const editor = makeEditor({
      id: "image-1",
      type: "image",
      props: { url: "asset://image-1", caption: "Diagram" },
    });

    const handled = modifyCurrentBlock(editor, {
      projectId: "project-1",
      openImagePreview: (preview) => {
        previewKey = `${preview.source}|${preview.alt}`;
      },
    });

    expect(handled).toBe(true);
    expect(previewKey).toBe("asset://image-1|Diagram");
  });

  test("returns false for a paragraph block", () => {
    const handled = modifyCurrentBlock(
      makeEditor({ id: "paragraph-1", type: "paragraph", props: {} }),
      { projectId: "project-1" },
    );

    expect(handled).toBe(false);
  });

  test("opens a card reference target", () => {
    let opened = "";
    const editor = makeEditor({
      id: "card-ref-1",
      type: "cardRef",
      props: { sourceProjectId: "project-2", cardId: "card-1" },
    });

    const handled = modifyCurrentBlock(editor, {
      projectId: "project-1",
      openCard: (input) => {
        opened = JSON.stringify(input);
      },
    });

    expect(handled).toBe(true);
    expect(opened).toBe(JSON.stringify({
      projectId: "project-2",
      cardId: "card-1",
    }));
  });

  test("opens a card toggle target before falling back to toggle", () => {
    let opened = "";
    let clicked = false;
    const button = {
      click: () => {
        clicked = true;
      },
    } as HTMLButtonElement;
    const editor = makeEditor({
      id: "card-toggle-1",
      type: "cardToggle",
      props: { sourceProjectId: "project-2", cardId: "card-1" },
      content: [{ type: "text", text: "Card title", styles: {} }],
    }, {
      domElement: makeToggleRoot("card-toggle-1", button),
    });

    const handled = modifyCurrentBlock(editor, {
      projectId: "project-1",
      openCard: (input) => {
        opened = JSON.stringify(input);
      },
    });

    expect(handled).toBe(true);
    expect(clicked).toBe(false);
    expect(opened).toBe(JSON.stringify({
      projectId: "project-2",
      cardId: "card-1",
      titleSnapshot: "Card title",
    }));
  });

  test("falls back to toggling a card toggle without a card target", () => {
    let clicked = false;
    const button = {
      click: () => {
        clicked = true;
      },
    } as HTMLButtonElement;
    const editor = makeEditor({
      id: "card-toggle-1",
      type: "cardToggle",
      props: {},
    }, {
      domElement: makeToggleRoot("card-toggle-1", button),
    });

    const handled = modifyCurrentBlock(editor, { projectId: "project-1" });

    expect(handled).toBe(true);
    expect(clicked).toBe(true);
  });

  test("opens a bound thread section", () => {
    let openedThreadId = "";
    const editor = makeEditor({
      id: "thread-section-1",
      type: "threadSection",
      props: { threadId: "thread-1" },
    });

    const handled = modifyCurrentBlock(editor, {
      projectId: "project-1",
      openThread: (threadId) => {
        openedThreadId = threadId;
      },
    });

    expect(handled).toBe(true);
    expect(openedThreadId).toBe("thread-1");
  });

  test("leaves an unbound thread section unhandled", () => {
    const handled = modifyCurrentBlock(
      makeEditor({
        id: "thread-section-1",
        type: "threadSection",
        props: { threadId: "" },
      }),
      {
        projectId: "project-1",
        openThread: () => undefined,
      },
    );

    expect(handled).toBe(false);
  });

  test("uses a single selected modifiable block before the cursor block", () => {
    let previewKey = "";
    const cursorBlock = { id: "paragraph-1", type: "paragraph", props: {} };
    const selectedBlock = {
      id: "image-1",
      type: "image",
      props: { url: "asset://selected-image", name: "Selected" },
    };
    const editor = makeEditor(cursorBlock, {
      getSelection: () => ({ blocks: [selectedBlock] }),
      getBlock: (id) => (id === "image-1" ? selectedBlock : undefined),
    });

    const handled = modifyCurrentBlock(editor, {
      projectId: "project-1",
      openImagePreview: (preview) => {
        previewKey = `${preview.source}|${preview.alt}`;
      },
    });

    expect(handled).toBe(true);
    expect(previewKey).toBe("asset://selected-image|Selected");
  });

  test("does not modify a multi-block selection", () => {
    let updateCount = 0;
    const editor = makeEditor({
      id: "check-1",
      type: "checkListItem",
      props: { checked: false },
    }, {
      getSelection: () => ({
        blocks: [
          { id: "check-1", type: "checkListItem", props: { checked: false } },
          { id: "check-2", type: "checkListItem", props: { checked: true } },
        ],
      }),
      updateBlock: () => {
        updateCount += 1;
      },
    });

    const handled = modifyCurrentBlock(editor, { projectId: "project-1" });

    expect(handled).toBe(false);
    expect(updateCount).toBe(0);
  });
});
