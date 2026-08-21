import { describe, expect, test, vi } from "vite-plus/test";
import {
  createNfmEditorExtensions,
  createNfmPasteHandler,
  NFM_DISABLED_EXTENSIONS,
  THREAD_SECTION_SHORTCUT_PATTERN,
  threadSectionInputRule,
} from "./nfm-editor-extensions";
import { createEmptyThreadSectionBlock } from "./thread-section";

describe("nfm editor extensions", () => {
  test("replaces the built-in divider shortcut with the thread-section shortcut", () => {
    const extensions = createNfmEditorExtensions();

    expect(NFM_DISABLED_EXTENSIONS.includes("divider-block-shortcuts")).toBe(true);
    expect(extensions.includes(threadSectionInputRule)).toBe(true);
    expect(THREAD_SECTION_SHORTCUT_PATTERN.test("---")).toBe(true);
    expect(THREAD_SECTION_SHORTCUT_PATTERN.test("--")).toBe(false);
  });

  test("reuses the shared empty thread-section block shape", () => {
    expect(JSON.stringify(createEmptyThreadSectionBlock())).toBe(
      JSON.stringify({
        type: "threadSection",
        props: {
          label: "",
          threadId: "",
        },
      }),
    );
  });

  test("guards generic paste replacement of a typed owner", () => {
    const defaultPasteHandler = vi.fn(() => true);
    const handler = createNfmPasteHandler({
      onBeforeReplaceBlocks: (blocks) => blocks.some((block) => block.type === "page"),
    });
    const editor = {
      getSelection: () => ({ blocks: [{ id: "page-1", type: "page" }] }),
      getTextCursorPosition: () => ({ block: { id: "page-1", type: "page" } }),
    };

    const handled = handler({
      event: {
        clipboardData: {
          types: [],
          getData: () => "plain text",
        },
      } as unknown as ClipboardEvent,
      editor: editor as never,
      defaultPasteHandler,
    });

    expect(handled).toBe(true);
    expect(defaultPasteHandler).not.toHaveBeenCalled();
  });

  test("guards generic paste insertion of a typed owner", () => {
    const defaultPasteHandler = vi.fn(() => true);
    const handler = createNfmPasteHandler({
      onBeforeInsertBlocks: (blocks) => blocks.some((block) => block.type === "page"),
    });
    const editor = {
      getSelection: () => undefined,
      getTextCursorPosition: () => ({ block: { id: "paragraph-1", type: "paragraph" } }),
      tryParseHTMLToBlocks: () => [{ id: "page-1", type: "page" }],
    };

    const handled = handler({
      event: {
        clipboardData: {
          types: ["blocknote/html"],
          getData: () => "<div data-content-type=page />",
        },
      } as unknown as ClipboardEvent,
      editor: editor as never,
      defaultPasteHandler,
    });

    expect(handled).toBe(true);
    expect(defaultPasteHandler).not.toHaveBeenCalled();
  });
});
