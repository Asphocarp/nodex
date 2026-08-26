import { BlockNoteEditor } from "@blocknote/core";
import { SuggestionMenu } from "@blocknote/core/extensions";
import {
  GridSuggestionMenuController,
  SuggestionMenuController,
  type GridSuggestionMenuProps,
  type SuggestionMenuProps,
} from "@blocknote/react";
import { BlockNoteView } from "@blocknote/shadcn";
import { act, render, waitFor } from "@testing-library/react";
import { describe, expect, test } from "vite-plus/test";
import { userEvent } from "vite-plus/test/browser";

import "../../../globals.css";
import { createNfmTypedSuggestionControllerConfig } from "./nfm-slash-menu";

const settleEditor = async (): Promise<void> => {
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  await Promise.resolve();
};

const getItems = async () => ["item"];
const acceptItem = () => undefined;

function SlashMenu(_props: SuggestionMenuProps<string>) {
  return <div data-testid="slash-menu" />;
}

function MentionMenu(_props: SuggestionMenuProps<string>) {
  return <div data-testid="mention-menu" />;
}

function EmojiMenu(_props: GridSuggestionMenuProps<string>) {
  return <div data-testid="emoji-menu" />;
}

describe("NFM typed suggestion sessions in Chromium", () => {
  test("connects lexical policy, live sessions, popup gates, and editor transitions", async () => {
    const editor = BlockNoteEditor.create({
      initialContent: [
        { id: "paragraph-0", type: "paragraph", content: "" },
        { id: "paragraph-1", type: "paragraph", content: "next" },
        { id: "code-0", type: "codeBlock", content: "code" },
      ],
    });
    const controllers = createNfmTypedSuggestionControllerConfig("ja-JP");
    const view = render(
      <BlockNoteView
        editor={editor}
        emojiPicker={false}
        formattingToolbar={false}
        linkToolbar={false}
        sideMenu={false}
        slashMenu={false}
        tableHandles={false}
      >
        {controllers.slash.map(({ triggerCharacter, shouldOpen }) => (
          <SuggestionMenuController
            key={triggerCharacter}
            triggerCharacter={triggerCharacter}
            getItems={getItems}
            onItemClick={acceptItem}
            shouldOpen={shouldOpen}
            suggestionMenuComponent={SlashMenu}
          />
        ))}
        <SuggestionMenuController
          triggerCharacter={controllers.mention.triggerCharacter}
          autoCloseWhenNoItems={controllers.mention.autoCloseWhenNoItems}
          getItems={getItems}
          onItemClick={acceptItem}
          shouldOpen={controllers.mention.shouldOpen}
          suggestionMenuComponent={MentionMenu}
        />
        <GridSuggestionMenuController
          triggerCharacter={controllers.emoji.triggerCharacter}
          columns={controllers.emoji.columns}
          getItems={getItems}
          gridSuggestionMenuComponent={EmojiMenu}
          minQueryLength={controllers.emoji.minQueryLength}
          onItemClick={acceptItem}
          shouldOpen={controllers.emoji.shouldOpen}
        />
      </BlockNoteView>,
    );
    const suggestionMenu = editor.getExtension(SuggestionMenu)!;

    const prepareParagraph = async (text: string) => {
      await act(async () => {
        suggestionMenu.closeMenu("programmatic");
        editor.updateBlock("paragraph-0", { content: text || [] });
        editor.setTextCursorPosition("paragraph-0", "end");
        editor.focus();
        await settleEditor();
      });
    };
    const type = async (keys: string) => {
      await act(async () => {
        await userEvent.keyboard(keys);
        await settleEditor();
      });
    };

    try {
      await act(settleEditor);

      await prepareParagraph("abc");
      await type("/");
      expect(suggestionMenu.getMenuState()).toBeUndefined();

      await prepareParagraph("abc ");
      await type("/");
      await waitFor(() => {
        expect(suggestionMenu.getMenuState()?.triggerCharacter).toBe("/");
      });
      expect(await view.findByTestId("slash-menu")).toBeTruthy();

      await prepareParagraph("abc");
      await type("@");
      expect(suggestionMenu.getMenuState()).toBeUndefined();

      await prepareParagraph("abc ");
      await type("@");
      expect(suggestionMenu.getMenuState()?.triggerCharacter).toBe("@");
      expect(await view.findByTestId("mention-menu")).toBeTruthy();

      await prepareParagraph("");
      await act(async () => {
        const editorDom = editor.prosemirrorView?.dom;
        if (!editorDom) throw new Error("Expected a mounted editor view");
        await userEvent.type(editorDom, ":", { skipClick: true });
        await settleEditor();
      });
      expect(suggestionMenu.getMenuState()?.triggerCharacter).toBe(":");
      expect(view.queryByTestId("emoji-menu")).toBeNull();
      await type("sm");
      expect(await view.findByTestId("emoji-menu")).toBeTruthy();
      await type("{Escape}");
      expect(suggestionMenu.getMenuState()).toBeUndefined();
      expect(suggestionMenu.getLastCloseReason()).toBe("escape");

      await prepareParagraph("");
      await type("/");
      await type("@");
      expect(suggestionMenu.getMenuState()).toMatchObject({
        triggerCharacter: "/",
        query: "@",
      });

      await act(async () => {
        editor.setTextCursorPosition("paragraph-1", "start");
        await settleEditor();
      });
      expect(suggestionMenu.getMenuState()).toBeUndefined();
      expect(suggestionMenu.getLastCloseReason()).toBe("cross-block");

      await prepareParagraph("");
      await type("/");
      await act(async () => {
        editor.setTextCursorPosition("code-0", "end");
        await settleEditor();
      });
      expect(suggestionMenu.getMenuState()).toBeUndefined();
      expect(suggestionMenu.getLastCloseReason()).toBe("code-block");
      await type("/");
      expect(suggestionMenu.getMenuState()).toBeUndefined();
    } finally {
      view.unmount();
      editor._tiptapEditor.destroy();
    }
  });
});
