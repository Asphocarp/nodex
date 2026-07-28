import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
} from "react";
import { baseKeymap } from "@tiptap/pm/commands";
import { keymap } from "@tiptap/pm/keymap";
import { Schema, Slice, type Node as ProseMirrorNode } from "@tiptap/pm/model";
import { EditorState, Plugin, TextSelection, type Transaction } from "@tiptap/pm/state";
import { Decoration, DecorationSet, EditorView } from "@tiptap/pm/view";
import type { KeyboardEvent as ReactKeyboardEvent } from "react";
import type { ComposerSlashTriggerState } from "./slash-command-menu/slash-command-types";
import { detectComposerSlashTrigger, inactiveSlashTrigger } from "./slash-command-menu/slash-command-filter";

const promptSchema = new Schema({
  nodes: {
    doc: {
      content: "paragraph+",
    },
    paragraph: {
      content: "inline*",
      group: "block",
      parseDOM: [{ tag: "p" }],
      toDOM: () => ["p", 0],
    },
    text: {
      group: "inline",
    },
  },
  marks: {},
});

export const COMPOSER_LARGE_PASTE_CHAR_THRESHOLD = 5_000;

export function classifyComposerPaste(text: string): "inline" | "attachment" {
  return text.length >= COMPOSER_LARGE_PASTE_CHAR_THRESHOLD
    ? "attachment"
    : "inline";
}

function handleComposerLargeTextPaste(
  event: ClipboardEvent,
  onLargeTextPaste: ((text: string) => boolean) | undefined,
): boolean {
  const clipboard = event.clipboardData;
  if (!clipboard) return false;
  const hasFiles = (clipboard.files?.length ?? 0) > 0
    || Array.from(clipboard.items ?? []).some((item) => item.kind === "file");
  if (hasFiles) return false;

  const text = clipboard.getData("text/plain");
  if (classifyComposerPaste(text) !== "attachment") return false;
  if (onLargeTextPaste?.(text) !== true) return false;
  event.preventDefault();
  return true;
}

const promptEditingKeymapPlugin = keymap({
  ...baseKeymap,
  "Shift-Enter": baseKeymap.Enter,
});

const promptClipboardPlugin = new Plugin({
  props: {
    clipboardTextParser: (text) => buildPromptTextSlice(text),
    clipboardTextSerializer: (content) => (
      content.content.textBetween(0, content.content.size, "\n")
    ),
  },
});

export interface ComposerPromptEditorHandle {
  focus: () => void;
  focusAtEnd: () => void;
  setText: (text: string) => string;
  setPromptText: (text: string) => string;
  insertText: (text: string) => string;
  replaceTextRange: (range: { from: number; to: number; text: string }) => string;
  clearRange: (range: { from: number; to: number }) => string;
  getSelection: () => { from: number; to: number } | null;
  getText: () => string;
  getPersistedText: () => string;
  isCursorAtEnd: () => boolean;
}

interface ComposerPromptEditorProps {
  value: string;
  placeholder: string;
  disabled: boolean;
  singleLine?: boolean;
  onChange: (value: string) => void;
  onKeyDown: (event: KeyboardEvent) => boolean;
  onLargeTextPaste?: (text: string) => boolean;
  onSlashTriggerChange?: (state: ComposerSlashTriggerState) => void;
  "data-composer-prompt-frame"?: "true";
  className?: string;
}

function buildPromptEditorAttributes({
  placeholder,
  singleLine,
}: {
  placeholder: string;
  singleLine: boolean;
}) {
  return {
    "aria-label": placeholder,
    "data-virtualkeyboard": "true",
    "data-codex-composer": "true",
    spellcheck: "true",
    translate: "no",
    style: [
      "font-size: var(--codex-chat-font-size)",
      "height: auto",
      "resize: none",
      `min-height: ${singleLine ? "1.25rem" : "2.75rem"}`,
    ].join("; "),
  };
}

export function buildPromptDoc(value: string): ProseMirrorNode {
  const lines = value.split(/\r\n?|\n/u);
  const paragraphType = promptSchema.nodes.paragraph;
  const paragraphs = (lines.length > 0 ? lines : [""]).map((line) =>
    paragraphType.create(null, line.length > 0 ? promptSchema.text(line) : undefined)
  );

  return promptSchema.nodes.doc.create(null, paragraphs);
}

function buildPromptTextSlice(value: string): Slice {
  return new Slice(buildPromptDoc(value).content, 1, 1);
}

function replacePromptTextRange(
  transaction: Transaction,
  range: { from: number; to: number; text: string },
): Transaction {
  if (!/[\r\n]/u.test(range.text)) {
    return transaction.insertText(range.text, range.from, range.to);
  }

  const textSelection = TextSelection.create(transaction.doc, range.from, range.to);
  return transaction
    .setSelection(textSelection)
    .replaceSelection(buildPromptTextSlice(range.text));
}

function readPromptDocText(doc: ProseMirrorNode): string {
  return doc.textBetween(0, doc.content.size, "\n");
}

function promptDocPositionToTextOffset(doc: ProseMirrorNode, position: number): number {
  return doc.textBetween(0, position, "\n").length;
}

export function promptTextOffsetToDocPosition(doc: ProseMirrorNode, offset: number): number {
  const targetOffset = Math.max(0, offset);
  if (targetOffset === 0) return 0;

  let textOffset = 0;
  let documentPosition = 0;
  for (let index = 0; index < doc.childCount; index += 1) {
    const paragraph = doc.child(index);
    if (index > 0) {
      textOffset += 1;
      if (targetOffset <= textOffset) return documentPosition + 1;
    }

    const paragraphTextLength = paragraph.textContent.length;
    if (targetOffset <= textOffset + paragraphTextLength) {
      return documentPosition + 1 + (targetOffset - textOffset);
    }

    textOffset += paragraphTextLength;
    documentPosition += paragraph.nodeSize;
  }

  return doc.content.size;
}

function isPromptDocEmpty(doc: ProseMirrorNode): boolean {
  return readPromptDocText(doc).length === 0;
}

function getPromptDocEndSelection(doc: ProseMirrorNode) {
  return TextSelection.atEnd(doc);
}

function createPromptPlaceholderPlugin(placeholderRef: { current: string }): Plugin {
  return new Plugin({
    props: {
      decorations(state) {
        if (!isPromptDocEmpty(state.doc)) return null;

        const firstParagraph = state.doc.firstChild;
        if (!firstParagraph) return null;

        return DecorationSet.create(state.doc, [
          Decoration.node(0, firstParagraph.nodeSize, {
            class: "placeholder",
            "data-placeholder": placeholderRef.current,
          }),
        ]);
      },
    },
  });
}

function createPromptEditorState(value: string, placeholderRef: { current: string }): EditorState {
  const doc = buildPromptDoc(value);
  return EditorState.create({
    schema: promptSchema,
    doc,
    selection: getPromptDocEndSelection(doc),
    // Direct EditorView handlers own composer shortcuts first. Unconsumed
    // editing keys fall through to ProseMirror's structural commands.
    plugins: [
      promptEditingKeymapPlugin,
      promptClipboardPlugin,
      createPromptPlaceholderPlugin(placeholderRef),
    ],
  });
}

export const ComposerPromptEditor = forwardRef<ComposerPromptEditorHandle, ComposerPromptEditorProps>(
  function ComposerPromptEditor({
    value,
    placeholder,
    disabled,
    singleLine = false,
    onChange,
    onKeyDown,
    onLargeTextPaste,
    onSlashTriggerChange,
    "data-composer-prompt-frame": dataComposerPromptFrame,
    className,
  }, ref) {
    const mountRef = useRef<HTMLDivElement | null>(null);
    const viewRef = useRef<EditorView | null>(null);
    const valueRef = useRef(value);
    const onChangeRef = useRef(onChange);
    const onKeyDownRef = useRef(onKeyDown);
    const onLargeTextPasteRef = useRef(onLargeTextPaste);
    const onSlashTriggerChangeRef = useRef(onSlashTriggerChange);
    const placeholderRef = useRef(placeholder);
    const singleLineRef = useRef(singleLine);
    const disabledRef = useRef(disabled);
    valueRef.current = value;
    onChangeRef.current = onChange;
    onKeyDownRef.current = onKeyDown;
    onLargeTextPasteRef.current = onLargeTextPaste;
    onSlashTriggerChangeRef.current = onSlashTriggerChange;
    placeholderRef.current = placeholder;
    singleLineRef.current = singleLine;
    disabledRef.current = disabled;

    const emitSlashTriggerState = useCallback((view: EditorView | null) => {
      const handler = onSlashTriggerChangeRef.current;
      if (!handler) return;
      if (!view || !view.state.selection.empty) {
        handler(inactiveSlashTrigger());
        return;
      }

      const text = readPromptDocText(view.state.doc);
      const cursorOffset = promptDocPositionToTextOffset(view.state.doc, view.state.selection.from);
      const trigger = detectComposerSlashTrigger({ text, cursor: cursorOffset });
      if (!trigger.active) {
        handler(trigger);
        return;
      }

      handler({
        ...trigger,
        from: promptTextOffsetToDocPosition(view.state.doc, trigger.from),
        to: promptTextOffsetToDocPosition(view.state.doc, trigger.to),
      });
    }, []);

    const setText = useCallback((text: string) => {
      const view = viewRef.current;
      if (!view) {
        onChangeRef.current(text);
        return text;
      }

      const transaction = view.state.tr.replaceWith(0, view.state.doc.content.size, buildPromptDoc(text).content);
      transaction.setSelection(getPromptDocEndSelection(transaction.doc)).scrollIntoView();
      view.dispatch(transaction);
      emitSlashTriggerState(view);
      return readPromptDocText(view.state.doc);
    }, [emitSlashTriggerState]);

    const replaceTextRange = useCallback((range: { from: number; to: number; text: string }) => {
      const view = viewRef.current;
      if (!view) {
        const nextValue = `${valueRef.current.slice(0, range.from)}${range.text}${valueRef.current.slice(range.to)}`;
        onChangeRef.current(nextValue);
        return nextValue;
      }

      const from = Math.max(0, Math.min(range.from, view.state.doc.content.size));
      const to = Math.max(from, Math.min(range.to, view.state.doc.content.size));
      view.dispatch(replacePromptTextRange(view.state.tr, {
        from,
        to,
        text: range.text,
      }).scrollIntoView());
      view.focus();
      emitSlashTriggerState(view);
      return readPromptDocText(view.state.doc);
    }, [emitSlashTriggerState]);

    useImperativeHandle(ref, () => ({
      focus: () => {
        viewRef.current?.focus();
      },
      focusAtEnd: () => {
        const view = viewRef.current;
        if (!view) return;
        view.dispatch(view.state.tr.setSelection(getPromptDocEndSelection(view.state.doc)).scrollIntoView());
        view.focus();
      },
      setText,
      setPromptText: setText,
      insertText: (text: string) => {
        const view = viewRef.current;
        if (!view) {
          const nextValue = `${valueRef.current}${text}`;
          onChangeRef.current(nextValue);
          return nextValue;
        }

        const { from, to } = view.state.selection;
        view.dispatch(replacePromptTextRange(view.state.tr, { from, to, text }).scrollIntoView());
        view.focus();
        return readPromptDocText(view.state.doc);
      },
      replaceTextRange,
      clearRange: (range) => replaceTextRange({ ...range, text: "" }),
      getSelection: () => {
        const view = viewRef.current;
        if (!view) return null;
        return {
          from: view.state.selection.from,
          to: view.state.selection.to,
        };
      },
      getText: () => {
        const view = viewRef.current;
        return view ? readPromptDocText(view.state.doc) : valueRef.current;
      },
      getPersistedText: () => {
        const view = viewRef.current;
        return view ? readPromptDocText(view.state.doc) : valueRef.current;
      },
      isCursorAtEnd: () => {
        const view = viewRef.current;
        if (!view || !view.state.selection.empty) return false;

        const domSelection = view.dom.ownerDocument.getSelection();
        if (!domSelection || !domSelection.isCollapsed || domSelection.rangeCount === 0) return false;
        if (!domSelection.anchorNode || !view.dom.contains(domSelection.anchorNode)) return false;

        const endPosition = getPromptDocEndSelection(view.state.doc).from;
        if (view.state.selection.from !== endPosition) return false;

        try {
          return view.posAtDOM(domSelection.anchorNode, domSelection.anchorOffset) === endPosition;
        } catch {
          return true;
        }
      },
    }), [replaceTextRange, setText]);

    useEffect(() => {
      const mount = mountRef.current;
      if (!mount || viewRef.current) return;

      const view = new EditorView(mount, {
        state: createPromptEditorState(valueRef.current, placeholderRef),
        editable: () => !disabledRef.current,
        attributes: buildPromptEditorAttributes({
          placeholder: placeholderRef.current,
          singleLine: singleLineRef.current,
        }),
        handleKeyDown: (_view, event) => onKeyDownRef.current(event),
        handlePaste: (_view, event) => handleComposerLargeTextPaste(
          event,
          onLargeTextPasteRef.current,
        ),
        handleDOMEvents: {
          mouseup(view) {
            window.setTimeout(() => emitSlashTriggerState(view), 0);
            return false;
          },
          keyup(view) {
            emitSlashTriggerState(view);
            return false;
          },
        },
        dispatchTransaction(transaction) {
          const currentView = viewRef.current;
          if (!currentView) return;

          const nextState = currentView.state.apply(transaction);
          currentView.updateState(nextState);
          const nextValue = readPromptDocText(nextState.doc);

          if (nextValue !== valueRef.current) {
            onChangeRef.current(nextValue);
          }
          emitSlashTriggerState(currentView);
        },
      });

      viewRef.current = view;
      emitSlashTriggerState(view);

      return () => {
        view.destroy();
        viewRef.current = null;
      };
    }, [emitSlashTriggerState]);

    useEffect(() => {
      const view = viewRef.current;
      if (!view) return;
      view.setProps({
        editable: () => !disabled,
        attributes: buildPromptEditorAttributes({ placeholder, singleLine }),
        handleKeyDown: (_currentView, event) => onKeyDownRef.current(event),
        handlePaste: (_currentView, event) => handleComposerLargeTextPaste(
          event,
          onLargeTextPasteRef.current,
        ),
        handleDOMEvents: {
          mouseup(view) {
            window.setTimeout(() => emitSlashTriggerState(view), 0);
            return false;
          },
          keyup(view) {
            emitSlashTriggerState(view);
            return false;
          },
        },
      });
    }, [disabled, emitSlashTriggerState, placeholder, singleLine]);

    useEffect(() => {
      const view = viewRef.current;
      if (!view) return;

      const currentValue = readPromptDocText(view.state.doc);
      if (currentValue !== value) {
        view.updateState(createPromptEditorState(value, placeholderRef));
        emitSlashTriggerState(view);
        return;
      }

      view.dispatch(view.state.tr.setMeta("prompt-placeholder", placeholder));
    }, [emitSlashTriggerState, placeholder, value]);

    return (
      <div
        data-composer-prompt-frame={dataComposerPromptFrame}
        data-single-line={singleLine ? "true" : "false"}
        className={[
          "text-size-chat [&_.ProseMirror]:focus-visible:outline-none text-token-foreground h-auto [&_.ProseMirror]:h-auto [&_.ProseMirror]:resize-none [&_.ProseMirror_p]:m-0 text-base [&_.ProseMirror]:leading-5",
          singleLine
            ? "max-h-5 overflow-hidden [&_.ProseMirror]:min-h-5"
            : "max-h-[25dvh] overflow-y-auto [&_.ProseMirror]:min-h-[2rem]",
          disabled ? "opacity-60" : null,
          className,
        ].filter(Boolean).join(" ")}
        ref={mountRef}
      />
    );
  },
);

export type ComposerPromptEditorKeyboardEvent = ReactKeyboardEvent<HTMLElement> | KeyboardEvent;
