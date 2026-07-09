import type { CSSProperties } from "react";
import { cn } from "@/lib/utils";
import "./terminal-ansi-text.css";

type TerminalAnsiDecoration =
  | "bold"
  | "dim"
  | "italic"
  | "underline"
  | "blink"
  | "reverse"
  | "hidden"
  | "strikethrough";

interface TerminalAnsiParserState {
  foregroundClass: string | null;
  backgroundClass: string | null;
  decorations: TerminalAnsiDecoration[];
}

export interface TerminalAnsiSegment {
  text: string;
  className: string;
  style: CSSProperties | undefined;
}

const STANDARD_COLOR_CLASSES = [
  "ansi-black",
  "ansi-red",
  "ansi-green",
  "ansi-yellow",
  "ansi-blue",
  "ansi-magenta",
  "ansi-cyan",
  "ansi-white",
] as const;

const BRIGHT_COLOR_CLASSES = [
  "ansi-bright-black",
  "ansi-bright-red",
  "ansi-bright-green",
  "ansi-bright-yellow",
  "ansi-bright-blue",
  "ansi-bright-magenta",
  "ansi-bright-cyan",
  "ansi-bright-white",
] as const;

const CSI_CHUNK_PATTERN = /^([!\x3c-\x3f]*)([\d;]*)([\x20-\x2c]*[\x40-\x7e])([\s\S]*)/m;
const DESTRUCTIVE_BACKSPACE_PATTERN = /[^\n]\u0008/gm;

function removeDestructiveBackspaces(value: string): string {
  let previous = value;
  let next = previous.replace(DESTRUCTIVE_BACKSPACE_PATTERN, "");
  while (next.length < previous.length) {
    previous = next;
    next = previous.replace(DESTRUCTIVE_BACKSPACE_PATTERN, "");
  }
  return next;
}

function normalizeCarriageReturns(value: string): string {
  if (!value.includes("\r")) return value;

  let normalized = value.replace(/\r+\n/gm, "\n");
  while (/\r./.test(normalized)) {
    normalized = normalized.replace(
      /^([^\r\n]*)\r+([^\r\n]+)/gm,
      (_match, previous: string, replacement: string) => (
        replacement + previous.slice(replacement.length)
      ),
    );
  }
  return normalized;
}

/** Applies the reference shell leaf's destructive-backspace pass before carriage overwrite. */
export function normalizeTerminalControlText(value: string): string {
  return normalizeCarriageReturns(removeDestructiveBackspaces(value));
}

function createParserState(): TerminalAnsiParserState {
  return {
    foregroundClass: null,
    backgroundClass: null,
    decorations: [],
  };
}

function removeDecoration(
  decorations: TerminalAnsiDecoration[],
  decoration: TerminalAnsiDecoration,
): void {
  const index = decorations.indexOf(decoration);
  if (index >= 0) decorations.splice(index, 1);
}

function indexedColorClass(index: number): string {
  if (index < 8) return STANDARD_COLOR_CLASSES[index] ?? "ansi-black";
  if (index < 16) return BRIGHT_COLOR_CLASSES[index - 8] ?? "ansi-bright-black";
  return `ansi-palette-${index}`;
}

function applyExtendedColor(
  state: TerminalAnsiParserState,
  codes: string[],
  foreground: boolean,
): void {
  const mode = codes.shift();
  if (mode === "5" && codes.length >= 1) {
    const index = Number.parseInt(codes.shift() ?? "", 10);
    if (!Number.isFinite(index) || index < 0 || index > 255) return;
    if (foreground) state.foregroundClass = indexedColorClass(index);
    else state.backgroundClass = indexedColorClass(index);
    return;
  }

  if (mode !== "2" || codes.length < 3) return;
  const red = Number.parseInt(codes.shift() ?? "", 10);
  const green = Number.parseInt(codes.shift() ?? "", 10);
  const blue = Number.parseInt(codes.shift() ?? "", 10);
  if (
    [red, green, blue].some(
      (channel) => !Number.isFinite(channel) || channel < 0 || channel > 255,
    )
  ) return;

  if (foreground) {
    state.foregroundClass = "ansi-truecolor";
    return;
  }
  state.backgroundClass = "ansi-truecolor";
}

function applySgrCodes(state: TerminalAnsiParserState, rawCodes: string): void {
  const codes = rawCodes.split(";");
  while (codes.length > 0) {
    const code = Number.parseInt(codes.shift() ?? "", 10);
    if (!Number.isFinite(code) || code === 0) {
      state.foregroundClass = null;
      state.backgroundClass = null;
      state.decorations = [];
    } else if (code === 1) state.decorations.push("bold");
    else if (code === 2) state.decorations.push("dim");
    else if (code === 3) state.decorations.push("italic");
    else if (code === 4) state.decorations.push("underline");
    else if (code === 5) state.decorations.push("blink");
    else if (code === 7) state.decorations.push("reverse");
    else if (code === 8) state.decorations.push("hidden");
    else if (code === 9) state.decorations.push("strikethrough");
    else if (code === 21) removeDecoration(state.decorations, "bold");
    else if (code === 22) {
      removeDecoration(state.decorations, "bold");
      removeDecoration(state.decorations, "dim");
    } else if (code === 23) removeDecoration(state.decorations, "italic");
    else if (code === 24) removeDecoration(state.decorations, "underline");
    else if (code === 25) removeDecoration(state.decorations, "blink");
    else if (code === 27) removeDecoration(state.decorations, "reverse");
    else if (code === 28) removeDecoration(state.decorations, "hidden");
    else if (code === 29) removeDecoration(state.decorations, "strikethrough");
    else if (code === 39) state.foregroundClass = null;
    else if (code === 49) state.backgroundClass = null;
    else if (code >= 30 && code <= 37) {
      state.foregroundClass = STANDARD_COLOR_CLASSES[code - 30] ?? null;
    } else if (code >= 90 && code <= 97) {
      state.foregroundClass = BRIGHT_COLOR_CLASSES[code - 90] ?? null;
    } else if (code >= 40 && code <= 47) {
      state.backgroundClass = STANDARD_COLOR_CLASSES[code - 40] ?? null;
    } else if (code >= 100 && code <= 107) {
      state.backgroundClass = BRIGHT_COLOR_CLASSES[code - 100] ?? null;
    } else if (code === 38 || code === 48) {
      applyExtendedColor(state, codes, code === 38);
    }
  }
}

function decorationStyle(
  decoration: TerminalAnsiDecoration | null,
): CSSProperties | undefined {
  if (decoration === "bold") return { fontWeight: "bold" };
  if (decoration === "dim") return { opacity: "0.5" };
  if (decoration === "italic") return { fontStyle: "italic" };
  if (decoration === "hidden") return { visibility: "hidden" };
  if (decoration === "underline") return { textDecorationLine: "underline" };
  if (decoration === "strikethrough") return { textDecorationLine: "line-through" };
  return decoration === null ? undefined : {};
}

function styledSegment(
  text: string,
  state: TerminalAnsiParserState,
): TerminalAnsiSegment {
  let foregroundClass = state.foregroundClass;
  let backgroundClass = state.backgroundClass;
  const decoration = state.decorations.at(-1) ?? null;

  for (const activeDecoration of state.decorations) {
    if (activeDecoration !== "reverse") continue;
    foregroundClass ??= "ansi-white";
    backgroundClass ??= "ansi-black";
    [foregroundClass, backgroundClass] = [backgroundClass, foregroundClass];
  }

  return {
    text,
    className: cn(
      foregroundClass && `${foregroundClass}-fg`,
      backgroundClass && `${backgroundClass}-bg`,
    ),
    style: decorationStyle(decoration),
  };
}

function unstyledSegment(text: string): TerminalAnsiSegment {
  return { text, className: "", style: undefined };
}

export function parseTerminalAnsiSegments(value: string): TerminalAnsiSegment[] {
  const normalized = normalizeTerminalControlText(value);
  const chunks = normalized.split("\u001b[");
  const segments: TerminalAnsiSegment[] = [];
  const state = createParserState();
  const initial = chunks.shift() ?? "";
  if (initial.length > 0) segments.push(unstyledSegment(initial));

  for (const chunk of chunks) {
    const match = chunk.match(CSI_CHUNK_PATTERN);
    if (!match) {
      if (chunk.length > 0) segments.push(unstyledSegment(chunk));
      continue;
    }

    const content = match[4] ?? "";
    if ((match[1] ?? "") !== "" || match[3] !== "m") {
      if (content.length > 0) segments.push(unstyledSegment(content));
      continue;
    }

    applySgrCodes(state, match[2] ?? "");
    if (content.length > 0) segments.push(styledSegment(content, state));
  }
  return segments;
}

export function TerminalAnsiText({
  value,
  className,
}: {
  value: string;
  className?: string;
}) {
  return (
    <code className={className}>
      {parseTerminalAnsiSegments(value).map((segment, index) => (
        <span
          key={`${index}-${segment.text}`}
          className={segment.className}
          style={segment.style}
        >
          {segment.text}
        </span>
      ))}
    </code>
  );
}
