import { appendTextTail } from "./bounded-text";

export interface TerminalTextDeltaState {
  readonly text: string;
  readonly carriageReturnPending: boolean;
  readonly didTruncate: boolean;
}

export function applyTerminalTextDelta(input: {
  readonly currentText: string;
  readonly delta: string;
  readonly carriageReturnPending?: boolean;
  readonly didTruncate?: boolean;
  readonly maxChars: number;
}): TerminalTextDeltaState {
  let text = input.currentText;
  let carriageReturnPending = input.carriageReturnPending ?? false;
  let didTruncate = input.didTruncate ?? false;
  let cursor = 0;

  const append = (delta: string) => {
    const next = appendTextTail({
      current: text,
      delta,
      maxChars: input.maxChars,
      didTruncate,
    });
    text = next.text;
    didTruncate = next.didTruncate;
  };

  while (cursor < input.delta.length) {
    const character = input.delta[cursor];
    if (carriageReturnPending) {
      carriageReturnPending = false;
      if (character === "\n") {
        append("\n");
        cursor += 1;
        continue;
      }

      const lastLineBreakIndex = text.lastIndexOf("\n");
      text = lastLineBreakIndex >= 0 ? text.slice(0, lastLineBreakIndex + 1) : "";
    }

    if (character === "\r") {
      carriageReturnPending = true;
      cursor += 1;
      continue;
    }

    if (character === "\b") {
      if (text.length > 0) text = text.slice(0, -1);
      cursor += 1;
      continue;
    }

    let runEnd = cursor + 1;
    while (runEnd < input.delta.length) {
      const nextCharacter = input.delta[runEnd];
      if (nextCharacter === "\r" || nextCharacter === "\b") break;
      runEnd += 1;
    }
    append(input.delta.slice(cursor, runEnd));
    cursor = runEnd;
  }

  return { text, carriageReturnPending, didTruncate };
}
