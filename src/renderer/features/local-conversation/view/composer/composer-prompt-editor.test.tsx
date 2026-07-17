import { act, fireEvent, render } from "@testing-library/react";
import { createRef } from "react";
import { describe, expect, test, vi } from "vitest";
import {
  ComposerPromptEditor,
  type ComposerPromptEditorHandle,
} from "./composer-prompt-editor";

function renderPromptEditor({
  value,
  onKeyDown = vi.fn(() => false),
}: {
  value: string;
  onKeyDown?: (event: KeyboardEvent) => boolean;
}) {
  const editorRef = createRef<ComposerPromptEditorHandle>();
  const onChange = vi.fn();
  const view = render(
    <ComposerPromptEditor
      ref={editorRef}
      value={value}
      placeholder="Ask Codex"
      disabled={false}
      onChange={onChange}
      onKeyDown={onKeyDown}
    />,
  );
  const editor = view.container.querySelector("[contenteditable='true']");
  if (!(editor instanceof HTMLElement)) {
    throw new Error("Composer editor was not mounted");
  }

  return {
    editor,
    editorRef,
    onChange,
    onKeyDown,
  };
}

function createClipboardData(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  return {
    data,
    clipboardData: {
      clearData: vi.fn(() => data.clear()),
      getData: vi.fn((format: string) => data.get(format) ?? ""),
      setData: vi.fn((format: string, value: string) => {
        data.set(format, value);
      }),
    },
  };
}

describe("ComposerPromptEditor", () => {
  test("inserts and persists a line break for Shift+Enter", () => {
    const { editor, editorRef, onChange, onKeyDown } = renderPromptEditor({
      value: "first line",
    });

    act(() => {
      editorRef.current?.focusAtEnd();
    });

    fireEvent.keyDown(editor, { key: "Enter", shiftKey: true });

    expect(onKeyDown).toHaveBeenCalledTimes(1);
    expect(editorRef.current?.getText()).toBe("first line\n");
    expect(onChange).toHaveBeenLastCalledWith("first line\n");
  });

  test("removes a trailing empty line with Backspace", () => {
    const { editor, editorRef, onChange, onKeyDown } = renderPromptEditor({
      value: "first line\n",
    });

    act(() => {
      editorRef.current?.focusAtEnd();
    });
    fireEvent.keyDown(editor, {
      key: "Backspace",
      code: "Backspace",
      keyCode: 8,
    });

    expect(onKeyDown).toHaveBeenCalledTimes(1);
    expect(editorRef.current?.getText()).toBe("first line");
    expect(onChange).toHaveBeenLastCalledWith("first line");
  });

  test("inserts a new line with Enter when the composer shortcut does not consume it", () => {
    const { editor, editorRef, onChange, onKeyDown } = renderPromptEditor({
      value: "first line\nsecond line",
    });

    act(() => {
      editorRef.current?.focusAtEnd();
    });
    fireEvent.keyDown(editor, {
      key: "Enter",
      code: "Enter",
      keyCode: 13,
    });

    expect(onKeyDown).toHaveBeenCalledTimes(1);
    expect(editorRef.current?.getText()).toBe("first line\nsecond line\n");
    expect(onChange).toHaveBeenLastCalledWith("first line\nsecond line\n");
  });

  test("keeps imperative multiline insertion structurally editable", () => {
    const { editor, editorRef } = renderPromptEditor({
      value: "first line",
    });

    act(() => {
      editorRef.current?.focusAtEnd();
      editorRef.current?.insertText("\n");
    });
    expect(editorRef.current?.getText()).toBe("first line\n");

    fireEvent.keyDown(editor, {
      key: "Backspace",
      code: "Backspace",
      keyCode: 8,
    });

    expect(editorRef.current?.getText()).toBe("first line");
  });

  test("preserves consecutive empty lines from plain-text paste", () => {
    const { editor, editorRef, onChange } = renderPromptEditor({
      value: "",
    });
    const { clipboardData } = createClipboardData({
      "text/plain": "first line\n\nthird line",
    });

    act(() => {
      editorRef.current?.focusAtEnd();
    });
    fireEvent.paste(editor, { clipboardData });

    expect(editorRef.current?.getText()).toBe("first line\n\nthird line");
    expect(onChange).toHaveBeenLastCalledWith("first line\n\nthird line");
  });

  test("copies prompt paragraphs with one newline per logical line", () => {
    const { editor, editorRef } = renderPromptEditor({
      value: "first line\n\nthird line",
    });
    const { clipboardData, data } = createClipboardData();
    const isMac = /Mac|iP(hone|[oa]d)/u.test(navigator.platform);

    act(() => {
      editorRef.current?.focusAtEnd();
    });
    fireEvent.keyDown(editor, {
      key: "a",
      code: "KeyA",
      keyCode: 65,
      ctrlKey: !isMac,
      metaKey: isMac,
    });
    fireEvent.copy(editor, { clipboardData });

    expect(data.get("text/plain")).toBe("first line\n\nthird line");
  });

  test("keeps composer shortcuts ahead of the editing keymap", () => {
    const onKeyDown = vi.fn(() => true);
    const { editor, editorRef, onChange } = renderPromptEditor({
      value: "submit this",
      onKeyDown,
    });

    act(() => {
      editorRef.current?.focusAtEnd();
    });
    fireEvent.keyDown(editor, {
      key: "Enter",
      code: "Enter",
      keyCode: 13,
    });

    expect(onKeyDown).toHaveBeenCalledTimes(1);
    expect(editorRef.current?.getText()).toBe("submit this");
    expect(onChange).not.toHaveBeenCalled();
  });
});
