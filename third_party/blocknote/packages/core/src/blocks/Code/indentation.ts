export interface CodeTextSelection {
  readonly anchor: number;
  readonly head: number;
}

export interface CodeTextEdit {
  readonly from: number;
  readonly to: number;
  readonly insert: string;
}

export interface CodeIndentationTransform {
  readonly edits: readonly CodeTextEdit[];
  readonly selection: CodeTextSelection;
}

function clampOffset(offset: number, textLength: number): number {
  return Math.max(0, Math.min(offset, textLength));
}

function getIntersectedLineStarts(text: string, from: number, to: number): number[] {
  const firstLineStart = from === 0 ? 0 : text.lastIndexOf("\n", from - 1) + 1;
  const lineStarts = [firstLineStart];
  let newline = text.indexOf("\n", firstLineStart);

  while (newline !== -1 && newline + 1 <= to) {
    lineStarts.push(newline + 1);
    newline = text.indexOf("\n", newline + 1);
  }

  return lineStarts;
}

function getOutdentEdit(text: string, lineStart: number): CodeTextEdit | undefined {
  if (text.startsWith("\t", lineStart)) {
    return { from: lineStart, to: lineStart + 1, insert: "" };
  }
  if (text.startsWith("  ", lineStart)) {
    return { from: lineStart, to: lineStart + 2, insert: "" };
  }
  if (text.startsWith(" ", lineStart)) {
    return { from: lineStart, to: lineStart + 1, insert: "" };
  }
  return undefined;
}

function mapOffset(offset: number, edits: readonly CodeTextEdit[]): number {
  let mapped = offset;
  for (const edit of edits) {
    if (edit.from === edit.to) {
      if (edit.from <= offset) mapped += edit.insert.length;
      continue;
    }
    if (offset <= edit.from) continue;
    mapped -= offset <= edit.to ? offset - edit.from : edit.to - edit.from;
  }
  return mapped;
}

/** Resolves a line-level code indent without depending on ProseMirror state. */
export function resolveCodeIndentationTransform(input: {
  readonly text: string;
  readonly selection: CodeTextSelection;
  readonly direction: "indent" | "outdent";
}): CodeIndentationTransform {
  const anchor = clampOffset(input.selection.anchor, input.text.length);
  const head = clampOffset(input.selection.head, input.text.length);
  const from = Math.min(anchor, head);
  const to = Math.max(anchor, head);
  const lineStarts = getIntersectedLineStarts(input.text, from, to);
  const edits =
    input.direction === "indent"
      ? lineStarts.map((lineStart) => ({
          from: lineStart,
          to: lineStart,
          insert: "\t",
        }))
      : lineStarts.flatMap((lineStart) => {
          const edit = getOutdentEdit(input.text, lineStart);
          return edit ? [edit] : [];
        });

  return {
    edits,
    selection: {
      anchor: mapOffset(anchor, edits),
      head: mapOffset(head, edits),
    },
  };
}
