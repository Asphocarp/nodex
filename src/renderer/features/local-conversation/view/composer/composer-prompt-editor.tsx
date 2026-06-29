import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
} from "react";
import { Schema, type Node as ProseMirrorNode } from "@tiptap/pm/model";
import { EditorState, Plugin, TextSelection } from "@tiptap/pm/state";
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
      content: "text*",
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
  onChange: (value: string) => void;
  onKeyDown: (event: KeyboardEvent) => boolean;
  onSlashTriggerChange?: (state: ComposerSlashTriggerState) => void;
  "data-composer-prompt-frame"?: "true";
  className?: string;
}

function buildPromptDoc(value: string): ProseMirrorNode {
  const lines = value.split("\n");
  const paragraphType = promptSchema.nodes.paragraph;
  const paragraphs = (lines.length > 0 ? lines : [""]).map((line) =>
    paragraphType.create(null, line.length > 0 ? promptSchema.text(line) : undefined)
  );

  return promptSchema.nodes.doc.create(null, paragraphs);
}

function readPromptDocText(doc: ProseMirrorNode): string {
  return doc.textBetween(0, doc.content.size, "\n");
}

function promptDocPositionToTextOffset(doc: ProseMirrorNode, position: number): number {
  return doc.textBetween(0, position, "\n").length;
}

function promptTextOffsetToDocPosition(doc: ProseMirrorNode, offset: number): number {
  const targetOffset = Math.max(0, offset);
  for (let position = 0; position <= doc.content.size; position += 1) {
    if (doc.textBetween(0, position, "\n").length >= targetOffset) {
      return position;
    }
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
  return EditorState.create({
    schema: promptSchema,
    doc: buildPromptDoc(value),
    plugins: [createPromptPlaceholderPlugin(placeholderRef)],
  });
}

export const ComposerPromptEditor = forwardRef<ComposerPromptEditorHandle, ComposerPromptEditorProps>(
  function ComposerPromptEditor({
    value,
    placeholder,
    disabled,
    onChange,
    onKeyDown,
    onSlashTriggerChange,
    "data-composer-prompt-frame": dataComposerPromptFrame,
    className,
  }, ref) {
    const mountRef = useRef<HTMLDivElement | null>(null);
    const viewRef = useRef<EditorView | null>(null);
    const valueRef = useRef(value);
    const onChangeRef = useRef(onChange);
    const onKeyDownRef = useRef(onKeyDown);
    const onSlashTriggerChangeRef = useRef(onSlashTriggerChange);
    const placeholderRef = useRef(placeholder);
    valueRef.current = value;
    onChangeRef.current = onChange;
    onKeyDownRef.current = onKeyDown;
    onSlashTriggerChangeRef.current = onSlashTriggerChange;
    placeholderRef.current = placeholder;

    const emitSlashTriggerState = (view: EditorView | null) => {
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
    };

    const setText = (text: string) => {
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
    };

    const replaceTextRange = (range: { from: number; to: number; text: string }) => {
      const view = viewRef.current;
      if (!view) {
        const nextValue = `${valueRef.current.slice(0, range.from)}${range.text}${valueRef.current.slice(range.to)}`;
        onChangeRef.current(nextValue);
        return nextValue;
      }

      const from = Math.max(0, Math.min(range.from, view.state.doc.content.size));
      const to = Math.max(from, Math.min(range.to, view.state.doc.content.size));
      view.dispatch(view.state.tr.insertText(range.text, from, to).scrollIntoView());
      view.focus();
      emitSlashTriggerState(view);
      return readPromptDocText(view.state.doc);
    };

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
        view.dispatch(view.state.tr.insertText(text, from, to).scrollIntoView());
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
    }), []);

    useEffect(() => {
      const mount = mountRef.current;
      if (!mount || viewRef.current) return;

      const view = new EditorView(mount, {
        state: createPromptEditorState(valueRef.current, placeholderRef),
        editable: () => !disabled,
        attributes: {
          "data-virtualkeyboard": "true",
          "data-codex-composer": "true",
          spellcheck: "true",
          translate: "no",
          style: "font-size: var(--codex-chat-font-size); height: auto; resize: none; min-height: 2.75rem;",
        },
        handleKeyDown: (_view, event) => onKeyDownRef.current(event),
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

      return () => {
        view.destroy();
        viewRef.current = null;
      };
    }, []);

    useEffect(() => {
      const view = viewRef.current;
      if (!view) return;
      view.setProps({
        editable: () => !disabled,
        handleKeyDown: (_view, event) => onKeyDownRef.current(event),
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
    }, [disabled]);

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
    }, [placeholder, value]);

    return (
      <div
        data-composer-prompt-frame={dataComposerPromptFrame}
        className={[
          "text-size-chat [&_.ProseMirror]:focus-visible:outline-none text-token-foreground h-auto max-h-[25dvh] overflow-y-auto [&_.ProseMirror]:h-auto [&_.ProseMirror]:min-h-[2rem] [&_.ProseMirror]:resize-none [&_.ProseMirror_p]:m-0 text-base [&_.ProseMirror]:leading-5",
          disabled ? "opacity-60" : null,
          className,
        ].filter(Boolean).join(" ")}
        ref={mountRef}
      />
    );
  },
);

export type ComposerPromptEditorKeyboardEvent = ReactKeyboardEvent<HTMLElement> | KeyboardEvent;
