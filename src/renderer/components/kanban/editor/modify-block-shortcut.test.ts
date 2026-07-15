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

function makeCardRoot(
  blockId: string,
  button: HTMLButtonElement | null,
): ParentNode {
  const expectedSelector = `.bn-block[data-id="${blockId}"] [data-card-outliner-caret]`;
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

    const handled = modifyCurrentBlock(editor, {});

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

    const handled = modifyCurrentBlock(editor, {});

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

    const handled = modifyCurrentBlock(editor, {});

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

    const handled = modifyCurrentBlock(editor, {});

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
      {},
    );

    expect(handled).toBe(false);
  });

  test.each(["card", "cardRef"])(
    "toggles the current %s occurrence disclosure",
    (type) => {
      const button = document.createElement("button");
      let clickCount = 0;
      button.addEventListener("click", () => {
        clickCount += 1;
      });
      const blockId = `${type}-1`;
      const editor = makeEditor(
        {
          id: blockId,
          type,
          props: type === "cardRef"
            ? { sourceProjectId: "project-2", targetBlockId: "card-1" }
            : {},
        },
        { domElement: makeCardRoot(blockId, button) },
      );

      const handled = modifyCurrentBlock(editor, {});

      expect(handled).toBe(true);
      expect(clickCount).toBe(1);
    },
  );

  test.each(["card", "cardRef"])(
    "consumes the current unavailable %s occurrence without falling through",
    (type) => {
      const button = document.createElement("button");
      button.disabled = true;
      let clickCount = 0;
      button.addEventListener("click", () => {
        clickCount += 1;
      });
      const blockId = `${type}-unavailable`;
      const editor = makeEditor(
        { id: blockId, type, props: {} },
        { domElement: makeCardRoot(blockId, button) },
      );

      const handled = modifyCurrentBlock(editor, {});

      expect(handled).toBe(true);
      expect(clickCount).toBe(0);
    },
  );

  test("opens a bound thread section", () => {
    let openedThreadId = "";
    const editor = makeEditor({
      id: "thread-section-1",
      type: "threadSection",
      props: { threadId: "thread-1" },
    });

    const handled = modifyCurrentBlock(editor, {
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

    const handled = modifyCurrentBlock(editor, {});

    expect(handled).toBe(false);
    expect(updateCount).toBe(0);
  });
});
