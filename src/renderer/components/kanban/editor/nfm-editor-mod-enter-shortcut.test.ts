import { describe, expect, test } from "bun:test";
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
      projectId: "project-1",
      sendThreadSectionByBlockId: () => {
        sendCount += 1;
        return true;
      },
      showMissingThreadSectionHint: () => undefined,
    });

    expect(handled).toBeTrue();
    expect(checked).toBe("true");
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
      projectId: "project-1",
      sendThreadSectionByBlockId: (blockId) => {
        sentBlockId = blockId;
        return true;
      },
      showMissingThreadSectionHint: () => undefined,
    });

    expect(handled).toBeTrue();
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
      projectId: "project-1",
      sendThreadSectionByBlockId: () => false,
      showMissingThreadSectionHint: () => {
        hintCount += 1;
      },
    });

    expect(handled).toBeTrue();
    expect(hintCount).toBe(1);
  });
});
