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
import { cn } from "@/lib/utils";

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
  insertText: (text: string) => string;
}

interface ComposerPromptEditorProps {
  value: string;
  placeholder: string;
  disabled: boolean;
  onChange: (value: string) => void;
  onKeyDown: (event: KeyboardEvent) => boolean;
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

function isPromptDocEmpty(doc: ProseMirrorNode): boolean {
  return readPromptDocText(doc).length === 0;
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
    className,
  }, ref) {
    const mountRef = useRef<HTMLDivElement | null>(null);
    const viewRef = useRef<EditorView | null>(null);
    const valueRef = useRef(value);
    const onChangeRef = useRef(onChange);
    const onKeyDownRef = useRef(onKeyDown);
    const placeholderRef = useRef(placeholder);
    valueRef.current = value;
    onChangeRef.current = onChange;
    onKeyDownRef.current = onKeyDown;
    placeholderRef.current = placeholder;

    useImperativeHandle(ref, () => ({
      focus: () => {
        viewRef.current?.focus();
      },
      focusAtEnd: () => {
        const view = viewRef.current;
        if (!view) return;
        const selection = TextSelection.create(view.state.doc, view.state.doc.content.size - 1);
        view.dispatch(view.state.tr.setSelection(selection).scrollIntoView());
        view.focus();
      },
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
          style: "font-size: var(--codex-chat-font-size); height: auto; resize: none; min-height: 2.75rem;",
        },
        handleKeyDown: (_view, event) => onKeyDownRef.current(event),
        dispatchTransaction(transaction) {
          const currentView = viewRef.current;
          if (!currentView) return;

          const nextState = currentView.state.apply(transaction);
          currentView.updateState(nextState);
          const nextValue = readPromptDocText(nextState.doc);

          if (nextValue !== valueRef.current) {
            onChangeRef.current(nextValue);
          }
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
      });
    }, [disabled]);

    useEffect(() => {
      const view = viewRef.current;
      if (!view) return;

      const currentValue = readPromptDocText(view.state.doc);
      if (currentValue !== value) {
        view.updateState(createPromptEditorState(value, placeholderRef));
        return;
      }

      view.dispatch(view.state.tr.setMeta("prompt-placeholder", placeholder));
    }, [placeholder, value]);

    return (
      <div
        className={cn(
          "text-size-chat [&_.ProseMirror]:focus-visible:outline-none text-token-foreground h-auto max-h-[25dvh] overflow-y-auto [&_.ProseMirror]:h-auto [&_.ProseMirror]:min-h-[2rem] [&_.ProseMirror]:resize-none [&_.ProseMirror_p]:m-0 [&_.ProseMirror]:leading-5",
          disabled && "opacity-60",
          className,
        )}
        ref={mountRef}
      />
    );
  },
);

export type ComposerPromptEditorKeyboardEvent = ReactKeyboardEvent<HTMLElement> | KeyboardEvent;
