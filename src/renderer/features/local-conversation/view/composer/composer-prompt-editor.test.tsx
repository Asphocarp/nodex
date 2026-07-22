import { act, fireEvent, render } from "@testing-library/react";
import { createRef } from "react";
import { describe, expect, test, vi } from "vitest";
import {
  buildPromptDoc,
  classifyComposerPaste,
  ComposerPromptEditor,
  promptTextOffsetToDocPosition,
  type ComposerPromptEditorHandle,
} from "./composer-prompt-editor";

function renderPromptEditor({
  value,
  onKeyDown = vi.fn(() => false),
  onLargeTextPaste,
}: {
  value: string;
  onKeyDown?: (event: KeyboardEvent) => boolean;
  onLargeTextPaste?: (text: string) => boolean;
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
      onLargeTextPaste={onLargeTextPaste}
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
  test("classifies the inclusive large-paste boundary", () => {
    expect(classifyComposerPaste("x".repeat(4_999))).toBe("inline");
    expect(classifyComposerPaste("x".repeat(5_000))).toBe("attachment");
  });

  test("hands an accepted large plain-text paste to its attachment owner", () => {
    const onLargeTextPaste = vi.fn(() => true);
    const { editor, editorRef, onChange } = renderPromptEditor({
      value: "existing",
      onLargeTextPaste,
    });
    const text = "x".repeat(5_000);
    const { clipboardData } = createClipboardData({ "text/plain": text });

    act(() => editorRef.current?.focusAtEnd());
    fireEvent.paste(editor, { clipboardData });

    expect(onLargeTextPaste).toHaveBeenCalledWith(text);
    expect(editorRef.current?.getText()).toBe("existing");
    expect(onChange).not.toHaveBeenCalled();
  });

  test("preserves ordinary paste when the attachment owner rejects it", () => {
    const onLargeTextPaste = vi.fn(() => false);
    const { editor, editorRef } = renderPromptEditor({ value: "", onLargeTextPaste });
    const text = "x".repeat(5_000);
    const { clipboardData } = createClipboardData({ "text/plain": text });

    act(() => editorRef.current?.focusAtEnd());
    fireEvent.paste(editor, { clipboardData });

    expect(editorRef.current?.getText()).toBe(text);
  });

  test("maps text offsets through paragraphs in one traversal", () => {
    const doc = buildPromptDoc("ab\n\n🧪Z");
    const fullText = "ab\n\n🧪Z";

    expect(promptTextOffsetToDocPosition(buildPromptDoc(""), 0)).toBe(0);
    expect(promptTextOffsetToDocPosition(doc, 0)).toBe(0);
    expect(promptTextOffsetToDocPosition(doc, 1)).toBe(2);
    expect(promptTextOffsetToDocPosition(doc, 2)).toBe(3);
    expect(promptTextOffsetToDocPosition(doc, 3)).toBe(5);
    expect(promptTextOffsetToDocPosition(doc, 4)).toBe(7);
    expect(promptTextOffsetToDocPosition(doc, 5)).toBe(8);
    expect(promptTextOffsetToDocPosition(doc, 6)).toBe(9);
    expect(promptTextOffsetToDocPosition(doc, fullText.length)).toBe(10);
    expect(promptTextOffsetToDocPosition(doc, fullText.length + 100)).toBe(doc.content.size);
  });

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
