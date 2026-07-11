import { describe, expect, test } from "vitest";
import {
  createNfmEditorExtensions,
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
    expect(JSON.stringify(createEmptyThreadSectionBlock())).toBe(JSON.stringify({
      type: "threadSection",
      props: {
        label: "",
        threadId: "",
      },
    }));
  });
});
