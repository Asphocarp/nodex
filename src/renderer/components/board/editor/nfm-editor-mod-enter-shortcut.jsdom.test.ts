import { describe, expect, test } from "vitest";
import {
  handleNfmEditorModEnterShortcut,
} from "./nfm-editor-mod-enter-shortcut";
import type { ModifyShortcutEditor } from "./modify-block-shortcut";

describe("handleNfmEditorModEnterShortcut", () => {
  test("does not send a thread section when modify handles the current block", () => {
    let sendCount = 0;
    let checked = "";
    const editor: ModifyShortcutEditor = {
      getTextCursorPosition: () => ({
        block: {
          id: "check-1",
          type: "checkListItem",
          props: { checked: false },
        },
      }),
      updateBlock: (_block, update) => {
        checked = String(update.props?.checked);
      },
    };

    const handled = handleNfmEditorModEnterShortcut(editor, {
      sendThreadSectionByBlockId: () => {
        sendCount += 1;
        return true;
      },
      showMissingThreadSectionHint: () => undefined,
    });

    expect(handled).toBe(true);
    expect(checked).toBe("true");
    expect(sendCount).toBe(0);
  });

  test("toggles a Page occurrence before the thread-section fallback", () => {
    let clickCount = 0;
    let sendCount = 0;
    const button = document.createElement("button");
    button.addEventListener("click", () => {
      clickCount += 1;
    });
    const editor: ModifyShortcutEditor = {
      domElement: {
        querySelector: (selector: string) => (
          selector === '.bn-block[data-id="page-1"] [data-page-outliner-caret]'
            ? button
            : null
        ),
      } as unknown as ParentNode,
      getTextCursorPosition: () => ({
        block: { id: "page-1", type: "page", props: {} },
      }),
    };

    const handled = handleNfmEditorModEnterShortcut(editor, {
      sendThreadSectionByBlockId: () => {
        sendCount += 1;
        return true;
      },
      showMissingThreadSectionHint: () => undefined,
    });

    expect(handled).toBe(true);
    expect(clickCount).toBe(1);
    expect(sendCount).toBe(0);
  });

  test("sends the current block when no modify action applies", () => {
    let sentBlockId = "";
    const editor: ModifyShortcutEditor = {
      getTextCursorPosition: () => ({
        block: {
          id: "paragraph-1",
          type: "paragraph",
          props: {},
        },
      }),
    };

    const handled = handleNfmEditorModEnterShortcut(editor, {
      sendThreadSectionByBlockId: (blockId) => {
        sentBlockId = blockId;
        return true;
      },
      showMissingThreadSectionHint: () => undefined,
    });

    expect(handled).toBe(true);
    expect(sentBlockId).toBe("paragraph-1");
  });

  test("shows the missing-section hint when no block can be resolved", () => {
    let hintCount = 0;
    const editor: ModifyShortcutEditor = {
      getTextCursorPosition: () => ({
        block: {
          id: "",
          type: "paragraph",
          props: {},
        },
      }),
    };

    const handled = handleNfmEditorModEnterShortcut(editor, {
      sendThreadSectionByBlockId: () => false,
      showMissingThreadSectionHint: () => {
        hintCount += 1;
      },
    });

    expect(handled).toBe(true);
    expect(hintCount).toBe(1);
  });
});
