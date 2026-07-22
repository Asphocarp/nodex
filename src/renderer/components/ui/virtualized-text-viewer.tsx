import { Compartment, EditorSelection, EditorState } from "@codemirror/state";
import {
  EditorView,
  keymap,
  lineNumbers as codeMirrorLineNumbers,
} from "@codemirror/view";
import { searchKeymap } from "@codemirror/search";
import { useLayoutEffect, useRef } from "react";
import { cn } from "@/lib/utils";

export interface VirtualizedTextViewerProps {
  readonly value: string;
  readonly ariaLabel: string;
  readonly lineNumbers?: boolean;
  readonly wrap?: boolean;
  readonly initialSelection?: {
    readonly anchor: number;
    readonly head?: number;
  };
  readonly sourceIdentity?: string;
  readonly className?: string;
}

const virtualizedTextViewerTheme = EditorView.theme({
  "&": {
    height: "100%",
    backgroundColor: "transparent",
    color: "var(--color-text-foreground)",
    fontSize: "var(--vscode-editor-font-size, 13px)",
  },
  ".cm-scroller": {
    overflow: "auto",
    fontFamily: "var(--font-mono)",
    lineHeight: "1.5",
  },
  ".cm-content": {
    padding: "8px 0",
    caretColor: "transparent",
  },
  ".cm-line": {
    padding: "0 12px",
  },
  ".cm-gutters": {
    backgroundColor: "color-mix(in srgb, var(--color-text-foreground) 3%, transparent)",
    borderRight: "0.5px solid var(--color-border)",
    color: "var(--color-text-foreground-tertiary)",
  },
  ".cm-activeLine, .cm-activeLineGutter": {
    backgroundColor: "transparent",
  },
  ".cm-selectionBackground, &.cm-focused .cm-selectionBackground": {
    backgroundColor: "var(--color-background-accent-active)",
  },
  ".cm-panels": {
    backgroundColor: "var(--color-background-elevated-primary-opaque)",
    color: "var(--color-text-foreground)",
  },
  ".cm-search": {
    alignItems: "center",
    gap: "4px",
    padding: "4px 8px",
  },
});

function clampSelectionPosition(position: number, documentLength: number): number {
  return Math.min(documentLength, Math.max(0, position));
}

function buildSelection(
  initialSelection: VirtualizedTextViewerProps["initialSelection"],
  documentLength: number,
) {
  const anchor = clampSelectionPosition(initialSelection?.anchor ?? 0, documentLength);
  const head = clampSelectionPosition(initialSelection?.head ?? anchor, documentLength);
  return EditorSelection.single(anchor, head);
}

export function VirtualizedTextViewer({
  value,
  ariaLabel,
  lineNumbers = false,
  wrap = false,
  initialSelection,
  sourceIdentity,
  className,
}: VirtualizedTextViewerProps) {
  const mountRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const wrapCompartmentRef = useRef(new Compartment());
  const lineNumbersCompartmentRef = useRef(new Compartment());
  const accessibilityCompartmentRef = useRef(new Compartment());
  const initialPropsRef = useRef({
    value,
    ariaLabel,
    lineNumbers,
    wrap,
    initialSelection,
  });
  const sourceIdentityRef = useRef(sourceIdentity ?? value);

  useLayoutEffect(() => {
    const mount = mountRef.current;
    if (!mount || viewRef.current) return;
    const initial = initialPropsRef.current;

    const state = EditorState.create({
      doc: initial.value,
      selection: buildSelection(initial.initialSelection, initial.value.length),
      extensions: [
        EditorState.readOnly.of(true),
        EditorView.editable.of(false),
        keymap.of(searchKeymap),
        virtualizedTextViewerTheme,
        wrapCompartmentRef.current.of(initial.wrap ? EditorView.lineWrapping : []),
        lineNumbersCompartmentRef.current.of(initial.lineNumbers ? codeMirrorLineNumbers() : []),
        accessibilityCompartmentRef.current.of(EditorView.contentAttributes.of({
          "aria-label": initial.ariaLabel,
          "aria-readonly": "true",
          tabindex: "0",
        })),
      ],
    });
    const view = new EditorView({ state, parent: mount });
    viewRef.current = view;

    return () => {
      view.destroy();
      viewRef.current = null;
    };
  }, []);

  useLayoutEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    view.dispatch({
      effects: [
        wrapCompartmentRef.current.reconfigure(wrap ? EditorView.lineWrapping : []),
        lineNumbersCompartmentRef.current.reconfigure(lineNumbers ? codeMirrorLineNumbers() : []),
        accessibilityCompartmentRef.current.reconfigure(EditorView.contentAttributes.of({
          "aria-label": ariaLabel,
          "aria-readonly": "true",
          tabindex: "0",
        })),
      ],
    });
  }, [ariaLabel, lineNumbers, wrap]);

  useLayoutEffect(() => {
    const view = viewRef.current;
    const nextIdentity = sourceIdentity ?? value;
    if (!view) return;
    if (view.state.doc.toString() === value) {
      sourceIdentityRef.current = nextIdentity;
      return;
    }
    const preserveScroll = sourceIdentityRef.current === nextIdentity;
    const scrollTop = view.scrollDOM.scrollTop;
    const selection = buildSelection(initialSelection, value.length);
    view.dispatch({
      changes: { from: 0, to: view.state.doc.length, insert: value },
      selection,
      effects: preserveScroll ? [] : [EditorView.scrollIntoView(selection.main.anchor)],
    });
    sourceIdentityRef.current = nextIdentity;
    if (preserveScroll) view.scrollDOM.scrollTop = scrollTop;
  }, [initialSelection, sourceIdentity, value]);

  return (
    <div
      ref={mountRef}
      className={cn("h-full min-h-0 overflow-hidden", className)}
      data-virtualized-text-viewer="true"
    />
  );
}
