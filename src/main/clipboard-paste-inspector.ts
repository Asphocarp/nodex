import * as fs from "node:fs";
import { createRequire } from "node:module";
import * as path from "node:path";

import { parseLocalFileLinkHref } from "../shared/file-link-openers";
import type {
  ClipboardPastePayload,
  ClipboardPasteInspectionItem,
  ClipboardPasteInspectionResult,
} from "../shared/types";

const CLIPBOARD_TEXT_FORMATS = ["text/uri-list", "public.file-url"] as const;

export const CLIPBOARD_INSPECTION_MAX_FORMAT_BYTES = 256 * 1024;
export const CLIPBOARD_INSPECTION_MAX_LINES = 128;
export const CLIPBOARD_INSPECTION_MAX_ITEMS = 64;
export const CLIPBOARD_INSPECTION_MAX_PATH_LENGTH = 16 * 1024;
export const CLIPBOARD_PASTE_FORMAT_MAX_BYTES = 8 * 1024 * 1024;
export const CLIPBOARD_PASTE_TOTAL_MAX_BYTES = 16 * 1024 * 1024;

const require = createRequire(import.meta.url);

export function truncateClipboardUtf8(value: string, maxBytes: number): string {
  if (Buffer.byteLength(value, "utf8") <= maxBytes) return value;
  const bytes = Buffer.from(value, "utf8");
  const minimumEnd = Math.max(0, maxBytes - 3);
  for (let end = maxBytes; end >= minimumEnd; end -= 1) {
    try {
      return new TextDecoder("utf-8", { fatal: true }).decode(bytes.subarray(0, end));
    } catch {
      // A UTF-8 code point may span at most four bytes; trim to its boundary.
    }
  }
  return "";
}

function normalizeClipboardLines(value: string, remainingLines: number): string[] {
  return truncateClipboardUtf8(value, CLIPBOARD_INSPECTION_MAX_FORMAT_BYTES)
    .split(/\r?\n|\0/g)
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0 && !entry.startsWith("#"))
    .slice(0, remainingLines);
}

function parseAbsoluteClipboardPath(value: string): string | null {
  const fileLink = parseLocalFileLinkHref(value);
  if (fileLink?.path) return path.resolve(fileLink.path);
  if (path.isAbsolute(value)) return path.resolve(value);
  return null;
}

export function inspectClipboardPasteItemsFromStrings(
  values: string[],
): ClipboardPasteInspectionResult {
  const seenPaths = new Set<string>();
  const items: ClipboardPasteInspectionItem[] = [];
  let remainingLines = CLIPBOARD_INSPECTION_MAX_LINES;

  for (const rawValue of values.slice(0, CLIPBOARD_TEXT_FORMATS.length)) {
    if (remainingLines <= 0 || items.length >= CLIPBOARD_INSPECTION_MAX_ITEMS) break;
    const lines = normalizeClipboardLines(rawValue, remainingLines);
    remainingLines -= lines.length;

    for (const line of lines) {
      if (items.length >= CLIPBOARD_INSPECTION_MAX_ITEMS) break;
      if (line.length > CLIPBOARD_INSPECTION_MAX_PATH_LENGTH) continue;
      const absolutePath = parseAbsoluteClipboardPath(line);
      if (!absolutePath || seenPaths.has(absolutePath)) continue;
      try {
        const stats = fs.lstatSync(absolutePath);
        if (stats.isSymbolicLink()) continue;
        if (!stats.isDirectory() && !stats.isFile()) continue;
        const kind = stats.isDirectory() ? "folder" : "file";
        items.push({
          path: absolutePath,
          kind,
          name: path.basename(absolutePath),
          ...(kind === "file" ? { bytes: stats.size } : {}),
        });
        seenPaths.add(absolutePath);
      } catch {
        // Clipboard paths are advisory and may disappear between copy and paste.
      }
    }
  }

  return { items };
}

export function inspectClipboardPasteItems(): ClipboardPasteInspectionResult {
  const electron = require("electron") as typeof import("electron");
  const clipboard = electron.clipboard;
  const values: string[] = [];
  const availableFormats = new Set(clipboard.availableFormats());

  for (const format of CLIPBOARD_TEXT_FORMATS) {
    if (!availableFormats.has(format)) continue;
    try {
      const value = clipboard.read(format);
      if (value.trim().length > 0) {
        values.push(value);
      }
    } catch {
      // Ignore unreadable clipboard formats and continue.
    }
  }

  return inspectClipboardPasteItemsFromStrings(values);
}

function readClipboardFormat(
  clipboard: typeof import("electron").clipboard,
  format: string,
): string | undefined {
  try {
    const value = clipboard.read(format);
    return value.trim().length > 0
      ? truncateClipboardUtf8(value, CLIPBOARD_PASTE_FORMAT_MAX_BYTES)
      : undefined;
  } catch {
    return undefined;
  }
}

function readClipboardHtml(clipboard: typeof import("electron").clipboard): string | undefined {
  try {
    const value = clipboard.readHTML();
    return value.trim().length > 0
      ? truncateClipboardUtf8(value, CLIPBOARD_PASTE_FORMAT_MAX_BYTES)
      : undefined;
  } catch {
    return undefined;
  }
}

function readClipboardText(clipboard: typeof import("electron").clipboard): string | undefined {
  try {
    const value = clipboard.readText();
    return value.length > 0
      ? truncateClipboardUtf8(value, CLIPBOARD_PASTE_FORMAT_MAX_BYTES)
      : undefined;
  } catch {
    return undefined;
  }
}

export function readClipboardPastePayload(): ClipboardPastePayload {
  const electron = require("electron") as typeof import("electron");
  const clipboard = electron.clipboard;
  const availableFormats = new Set(clipboard.availableFormats());
  const payload: ClipboardPastePayload = {};

  let remainingBytes = CLIPBOARD_PASTE_TOTAL_MAX_BYTES;
  const assignWithinBudget = <Key extends keyof ClipboardPastePayload>(
    key: Key,
    value: ClipboardPastePayload[Key],
  ) => {
    if (typeof value !== "string" || remainingBytes <= 0) return;
    const bounded = truncateClipboardUtf8(value, remainingBytes);
    if (!bounded) return;
    payload[key] = bounded;
    remainingBytes -= Buffer.byteLength(bounded, "utf8");
  };

  if (availableFormats.has("blocknote/html")) {
    assignWithinBudget("blocknoteHtml", readClipboardFormat(clipboard, "blocknote/html"));
  }

  if (availableFormats.has("text/markdown")) {
    assignWithinBudget("markdown", readClipboardFormat(clipboard, "text/markdown"));
  }

  assignWithinBudget("html", readClipboardHtml(clipboard));
  assignWithinBudget("text", readClipboardText(clipboard));

  return payload;
}
