import * as Y from "yjs";
import { MAX_CARD_TITLE_LENGTH } from "../../shared/card-limits";

export interface YTextContiguousEdit {
  /** Yjs index measured in UTF-16 code units. */
  readonly index: number;
  /** Yjs length measured in UTF-16 code units. */
  readonly deleteLength: number;
  readonly insertText: string;
}

export interface YTextInputReconcileValues {
  /** Value captured when the local input gesture/composition started. */
  readonly baseValue: string;
  /** Latest value from the authoritative Y.Text, including remote edits. */
  readonly currentValue: string;
  /** Local DOM/input draft derived from baseValue. */
  readonly draftValue: string;
}

export interface YTextInputReconciliation {
  readonly value: string;
  readonly edit: YTextContiguousEdit | null;
  readonly localChanged: boolean;
  readonly remoteChanged: boolean;
}

export interface ApplyYTextInputReconciliation {
  readonly text: Y.Text;
  readonly baseValue: string;
  readonly draftValue: string;
  readonly origin: unknown;
}

export class YTextInputReconciliationError extends RangeError {
  constructor(message: string) {
    super(message);
    this.name = "YTextInputReconciliationError";
  }
}

interface CodePointEdit {
  readonly start: number;
  readonly end: number;
  readonly insert: readonly string[];
}

const MATCH = 1;
const SKIP_BASE = 2;
const SKIP_CURRENT = 3;

const assertCanonicalTitle = (value: unknown, field: string): string => {
  if (typeof value !== "string") {
    throw new YTextInputReconciliationError(`${field} must be a string`);
  }
  if (value.length > MAX_CARD_TITLE_LENGTH) {
    throw new YTextInputReconciliationError(
      `${field} exceeds ${MAX_CARD_TITLE_LENGTH} UTF-16 code units`,
    );
  }
  return value;
};

const toCodePoints = (value: string): readonly string[] => Array.from(value);

const utf16Length = (codePoints: readonly string[]): number =>
  codePoints.reduce((length, codePoint) => length + codePoint.length, 0);

const computeCodePointEdit = (
  current: readonly string[],
  next: readonly string[],
): CodePointEdit | null => {
  let prefixLength = 0;
  const sharedLength = Math.min(current.length, next.length);
  while (
    prefixLength < sharedLength &&
    current[prefixLength] === next[prefixLength]
  ) {
    prefixLength += 1;
  }

  let suffixLength = 0;
  while (
    suffixLength < current.length - prefixLength &&
    suffixLength < next.length - prefixLength &&
    current[current.length - suffixLength - 1] ===
      next[next.length - suffixLength - 1]
  ) {
    suffixLength += 1;
  }

  const currentEnd = current.length - suffixLength;
  const nextEnd = next.length - suffixLength;
  if (prefixLength === currentEnd && prefixLength === nextEnd) return null;
  return {
    start: prefixLength,
    end: currentEnd,
    insert: next.slice(prefixLength, nextEnd),
  };
};

const toYTextEdit = (
  current: readonly string[],
  edit: CodePointEdit,
): YTextContiguousEdit => ({
  index: utf16Length(current.slice(0, edit.start)),
  deleteLength: utf16Length(current.slice(edit.start, edit.end)),
  insertText: edit.insert.join(""),
});

/**
 * Computes the smallest single contiguous Y.Text edit without placing a
 * boundary inside a valid UTF-16 surrogate pair.
 */
export const computeMinimalYTextEdit = (
  currentValue: string,
  nextValue: string,
): YTextContiguousEdit | null => {
  const current = assertCanonicalTitle(currentValue, "currentValue");
  const next = assertCanonicalTitle(nextValue, "nextValue");
  const currentCodePoints = toCodePoints(current);
  const edit = computeCodePointEdit(currentCodePoints, toCodePoints(next));
  return edit ? toYTextEdit(currentCodePoints, edit) : null;
};

/**
 * Aligns current code points to their base identities. Unmatched current code
 * points are concurrent remote insertions and must survive local reconciliation.
 */
const alignCurrentToBase = (
  base: readonly string[],
  current: readonly string[],
): readonly (number | null)[] => {
  const width = current.length + 1;
  const directions = new Uint8Array((base.length + 1) * width);
  let previous = new Uint16Array(width);

  for (let baseIndex = 1; baseIndex <= base.length; baseIndex += 1) {
    const row = new Uint16Array(width);
    for (
      let currentIndex = 1;
      currentIndex <= current.length;
      currentIndex += 1
    ) {
      if (base[baseIndex - 1] === current[currentIndex - 1]) {
        row[currentIndex] = (previous[currentIndex - 1] ?? 0) + 1;
        directions[baseIndex * width + currentIndex] = MATCH;
        continue;
      }
      if ((previous[currentIndex] ?? 0) >= (row[currentIndex - 1] ?? 0)) {
        row[currentIndex] = previous[currentIndex] ?? 0;
        directions[baseIndex * width + currentIndex] = SKIP_BASE;
        continue;
      }
      row[currentIndex] = row[currentIndex - 1] ?? 0;
      directions[baseIndex * width + currentIndex] = SKIP_CURRENT;
    }
    previous = row;
  }

  const currentToBase: (number | null)[] = Array.from(
    { length: current.length },
    () => null,
  );
  let baseIndex = base.length;
  let currentIndex = current.length;
  while (baseIndex > 0 && currentIndex > 0) {
    const direction = directions[baseIndex * width + currentIndex];
    if (direction === MATCH) {
      currentToBase[currentIndex - 1] = baseIndex - 1;
      baseIndex -= 1;
      currentIndex -= 1;
      continue;
    }
    if (direction === SKIP_CURRENT) {
      currentIndex -= 1;
      continue;
    }
    baseIndex -= 1;
  }
  return currentToBase;
};

const mergeLocalIntentIntoCurrent = (
  base: readonly string[],
  current: readonly string[],
  localEdit: CodePointEdit,
): readonly string[] => {
  const currentToBase = alignCurrentToBase(base, current);
  const merged: string[] = [];
  let insertedLocalText = false;

  current.forEach((codePoint, currentIndex) => {
    const baseIndex = currentToBase[currentIndex];
    if (
      !insertedLocalText &&
      baseIndex !== null &&
      baseIndex >= localEdit.start
    ) {
      merged.push(...localEdit.insert);
      insertedLocalText = true;
    }
    if (
      baseIndex === null ||
      baseIndex < localEdit.start ||
      baseIndex >= localEdit.end
    ) {
      merged.push(codePoint);
    }
  });

  if (!insertedLocalText) merged.push(...localEdit.insert);
  return merged;
};

/**
 * Pure three-way reconciliation for input/IME drafts. The local change is
 * derived from baseValue, then rebased over currentValue so remote insertions
 * are preserved. Concurrent replacements are additive, matching Yjs' intent
 * to retain both clients' inserted text.
 */
export const reconcileYTextInputValues = ({
  baseValue,
  currentValue,
  draftValue,
}: YTextInputReconcileValues): YTextInputReconciliation => {
  const base = assertCanonicalTitle(baseValue, "baseValue");
  const current = assertCanonicalTitle(currentValue, "currentValue");
  const draft = assertCanonicalTitle(draftValue, "draftValue");
  const localChanged = base !== draft;
  const remoteChanged = base !== current;
  if (!localChanged) {
    return { value: current, edit: null, localChanged, remoteChanged };
  }

  const baseCodePoints = toCodePoints(base);
  const currentCodePoints = toCodePoints(current);
  const localEdit = computeCodePointEdit(baseCodePoints, toCodePoints(draft));
  if (!localEdit) {
    return { value: current, edit: null, localChanged: false, remoteChanged };
  }
  const mergedCodePoints = remoteChanged
    ? mergeLocalIntentIntoCurrent(baseCodePoints, currentCodePoints, localEdit)
    : toCodePoints(draft);
  const value = assertCanonicalTitle(
    mergedCodePoints.join(""),
    "reconciledValue",
  );
  const mergedEdit = computeCodePointEdit(currentCodePoints, mergedCodePoints);
  return {
    value,
    edit: mergedEdit ? toYTextEdit(currentCodePoints, mergedEdit) : null,
    localChanged,
    remoteChanged,
  };
};

/** Applies one reconciled delete/insert pair in a single Yjs transaction. */
export const applyYTextInputReconciliation = ({
  text,
  baseValue,
  draftValue,
  origin,
}: ApplyYTextInputReconciliation): YTextInputReconciliation => {
  const document = text.doc;
  if (!document) {
    throw new YTextInputReconciliationError(
      "Y.Text input must be integrated into a Y.Doc",
    );
  }

  const reconciliation = reconcileYTextInputValues({
    baseValue,
    currentValue: text.toString(),
    draftValue,
  });
  const { edit } = reconciliation;
  if (!edit) return reconciliation;

  document.transact(() => {
    if (edit.deleteLength > 0) {
      text.delete(edit.index, edit.deleteLength);
    }
    if (edit.insertText.length > 0) {
      text.insert(edit.index, edit.insertText);
    }
  }, origin);
  return reconciliation;
};
