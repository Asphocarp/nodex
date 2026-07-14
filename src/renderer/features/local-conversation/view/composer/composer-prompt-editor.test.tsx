import { act, fireEvent, render } from "@testing-library/react";
import { createRef } from "react";
import { describe, expect, test, vi } from "vitest";
import {
  ComposerPromptEditor,
  type ComposerPromptEditorHandle,
} from "./composer-prompt-editor";

describe("ComposerPromptEditor", () => {
  test("inserts and persists a line break for Shift+Enter", () => {
    const editorRef = createRef<ComposerPromptEditorHandle>();
    const onChange = vi.fn();
    const onKeyDown = vi.fn(() => false);
    const view = render(
      <ComposerPromptEditor
        ref={editorRef}
        value="first line"
        placeholder="Ask Codex"
        disabled={false}
        onChange={onChange}
        onKeyDown={onKeyDown}
      />,
    );

    act(() => {
      editorRef.current?.focusAtEnd();
    });
    const editor = view.container.querySelector("[contenteditable='true']");
    if (!(editor instanceof HTMLElement)) {
      throw new Error("Composer editor was not mounted");
    }

    fireEvent.keyDown(editor, { key: "Enter", shiftKey: true });

    expect(onKeyDown).toHaveBeenCalledTimes(1);
    expect(editorRef.current?.getText()).toBe("first line\n");
    expect(onChange).toHaveBeenLastCalledWith("first line\n");
  });
});
