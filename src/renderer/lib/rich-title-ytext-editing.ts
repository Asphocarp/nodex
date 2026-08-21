import * as Y from "yjs";
import { MAX_PAGE_TITLE_LENGTH } from "../../shared/page-limits";
import { PORTABLE_RICH_TEXT_ATOM_CHARACTER } from "../../shared/block-documents/portable-rich-text";

export type RichTitleFormatAttribute = "bold" | "italic" | "underline" | "code";

const TITLE_ATTRIBUTE_NAMES = new Set([
  "bold",
  "italic",
  "underline",
  "strike",
  "code",
  "textColor",
  "backgroundColor",
  "link",
]);

export const mapRichTitleCompositionIndexToBase = (
  baseValue: string,
  draftValue: string,
  draftIndex: number,
): number => {
  const boundedDraftIndex = Math.min(Math.max(draftIndex, 0), draftValue.length);
  let prefixLength = 0;
  const maximumPrefixLength = Math.min(baseValue.length, draftValue.length);
  while (
    prefixLength < maximumPrefixLength &&
    baseValue[prefixLength] === draftValue[prefixLength]
  ) {
    prefixLength += 1;
  }

  let suffixLength = 0;
  const maximumSuffixLength = Math.min(
    baseValue.length - prefixLength,
    draftValue.length - prefixLength,
  );
  while (
    suffixLength < maximumSuffixLength &&
    baseValue[baseValue.length - suffixLength - 1] ===
      draftValue[draftValue.length - suffixLength - 1]
  ) {
    suffixLength += 1;
  }

  if (boundedDraftIndex <= prefixLength) return boundedDraftIndex;
  const draftChangedEnd = draftValue.length - suffixLength;
  if (boundedDraftIndex >= draftChangedEnd) {
    return baseValue.length - (draftValue.length - boundedDraftIndex);
  }
  return baseValue.length - suffixLength;
};

const insertionAttributesAt = (title: Y.Text, index: number): Readonly<Record<string, unknown>> => {
  let offset = 0;
  let previous: Readonly<Record<string, unknown>> = {};
  for (const operation of title.toDelta()) {
    if (typeof operation.insert !== "string") continue;
    const attributes = Object.fromEntries(
      Object.entries(operation.attributes ?? {}).filter(([key]) => TITLE_ATTRIBUTE_NAMES.has(key)),
    );
    if (index <= offset + operation.insert.length) {
      return operation.insert === PORTABLE_RICH_TEXT_ATOM_CHARACTER ? {} : attributes;
    }
    previous = operation.insert === PORTABLE_RICH_TEXT_ATOM_CHARACTER ? {} : attributes;
    offset += operation.insert.length;
  }
  return previous;
};

export const previousRichTitleCodePointIndex = (value: string, index: number): number => {
  if (index <= 0) return 0;
  const trailingUnit = value.charCodeAt(index - 1);
  const leadingUnit = index > 1 ? value.charCodeAt(index - 2) : 0;
  const isSurrogatePair =
    trailingUnit >= 0xdc00 &&
    trailingUnit <= 0xdfff &&
    leadingUnit >= 0xd800 &&
    leadingUnit <= 0xdbff;
  return index - (isSurrogatePair ? 2 : 1);
};

export const nextRichTitleCodePointIndex = (value: string, index: number): number => {
  if (index >= value.length) return value.length;
  const next = value.codePointAt(index);
  return Math.min(value.length, index + (next !== undefined && next > 0xffff ? 2 : 1));
};

const insertCanonicalTitleText = (
  title: Y.Text,
  index: number,
  text: string,
  attributes: Readonly<Record<string, unknown>>,
): void => {
  let offset = index;
  for (const segment of text.split(/(\n)/u)) {
    if (segment.length === 0) continue;
    title.insert(offset, segment, segment === "\n" ? {} : attributes);
    offset += segment.length;
  }
};

export interface ApplyRichTitleTextEditInput {
  readonly title: Y.Text;
  readonly start: number;
  readonly end: number;
  readonly insertText: string;
  readonly origin: unknown;
}

export interface AppliedRichTitleTextEdit {
  readonly changed: boolean;
  readonly caret: number;
}

export const applyRichTitleTextEdit = ({
  title,
  start,
  end,
  insertText,
  origin,
}: ApplyRichTitleTextEditInput): AppliedRichTitleTextEdit => {
  const document = title.doc;
  if (!document) return { changed: false, caret: start };
  const canonicalInsert = insertText.replaceAll(PORTABLE_RICH_TEXT_ATOM_CHARACTER, "");
  const current = title.toString();
  const nextLength = current.length - (end - start) + canonicalInsert.length;
  if (nextLength > MAX_PAGE_TITLE_LENGTH) {
    return { changed: false, caret: start };
  }
  if (end === start && canonicalInsert.length === 0) {
    return { changed: false, caret: start };
  }
  const attributes = insertionAttributesAt(title, start);
  document.transact(() => {
    if (end > start) title.delete(start, end - start);
    if (canonicalInsert.length > 0) {
      insertCanonicalTitleText(title, start, canonicalInsert, attributes);
    }
  }, origin);
  return { changed: true, caret: start + canonicalInsert.length };
};

export interface RichTitleFormatRange {
  readonly start: number;
  readonly length: number;
}

export const richTitleFormatRanges = (
  title: Y.Text,
  start: number,
  end: number,
): readonly RichTitleFormatRange[] => {
  const ranges: RichTitleFormatRange[] = [];
  let offset = 0;
  for (const operation of title.toDelta()) {
    if (typeof operation.insert !== "string") continue;
    for (const match of operation.insert.matchAll(/[^\n\uFFFC]+/gu)) {
      const text = match[0];
      const rangeStart = offset + (match.index ?? 0);
      const rangeEnd = rangeStart + text.length;
      const overlapStart = Math.max(start, rangeStart);
      const overlapEnd = Math.min(end, rangeEnd);
      if (overlapEnd > overlapStart) {
        ranges.push({ start: overlapStart, length: overlapEnd - overlapStart });
      }
    }
    offset += operation.insert.length;
  }
  return ranges;
};

export const richTitleRangeHasFormat = (
  title: Y.Text,
  start: number,
  end: number,
  attribute: RichTitleFormatAttribute,
): boolean => {
  const expected = richTitleFormatRanges(title, start, end).reduce(
    (length, range) => length + range.length,
    0,
  );
  if (expected === 0) return false;
  let offset = 0;
  let covered = 0;
  for (const operation of title.toDelta()) {
    if (typeof operation.insert !== "string") continue;
    const operationStart = offset;
    const operationEnd = offset + operation.insert.length;
    offset = operationEnd;
    const overlap = richTitleFormatRanges(
      title,
      Math.max(start, operationStart),
      Math.min(end, operationEnd),
    ).reduce((length, range) => length + range.length, 0);
    if (overlap === 0) continue;
    if (operation.attributes?.[attribute] !== true) return false;
    covered += overlap;
  }
  return covered === expected;
};

export const toggleRichTitleFormat = (input: {
  readonly title: Y.Text;
  readonly start: number;
  readonly end: number;
  readonly attribute: RichTitleFormatAttribute;
  readonly origin: unknown;
}): boolean => {
  const document = input.title.doc;
  const ranges = richTitleFormatRanges(input.title, input.start, input.end);
  if (!document || ranges.length === 0) return false;
  const enabled = richTitleRangeHasFormat(input.title, input.start, input.end, input.attribute);
  document.transact(() => {
    for (const range of ranges) {
      input.title.format(range.start, range.length, {
        [input.attribute]: enabled ? null : true,
      });
    }
  }, input.origin);
  return true;
};

export const setRichTitleLink = (input: {
  readonly title: Y.Text;
  readonly start: number;
  readonly end: number;
  readonly href: string | null;
  readonly origin: unknown;
}): boolean => {
  const document = input.title.doc;
  const ranges = richTitleFormatRanges(input.title, input.start, input.end);
  const href = input.href?.trim() ?? null;
  if (
    !document ||
    ranges.length === 0 ||
    (href !== null && (href.length === 0 || href.length > 4_096))
  ) {
    return false;
  }
  document.transact(() => {
    for (const range of ranges) {
      input.title.format(range.start, range.length, { link: href });
    }
  }, input.origin);
  return true;
};
