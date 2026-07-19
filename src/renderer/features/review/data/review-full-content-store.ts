import { useSyncExternalStore } from "react";
import type { FileDiffMetadata } from "@pierre/diffs/react";
import type { GitReviewFileContents } from "@/lib/types";
import { recordReviewRuntimeEvent } from "@/features/review/testing/review-runtime-probe";

export interface ReviewFullContentState {
  fullDiffMetadata: FileDiffMetadata | null;
  fullContents: GitReviewFileContents | null;
  fullContentLoadFailed: boolean;
  fullContentUnavailable: boolean;
  isLoadingFullContent: boolean;
}

interface ReviewFullContentCell {
  readonly key: string;
  state: ReviewFullContentState;
  readonly listeners: Set<() => void>;
  gcTimer: ReturnType<typeof setTimeout> | null;
}

interface ReviewFullContentLoad {
  identity: string;
  promise: Promise<void>;
}

const EMPTY_REVIEW_FULL_CONTENT_STATE: ReviewFullContentState = {
  fullDiffMetadata: null,
  fullContents: null,
  fullContentLoadFailed: false,
  fullContentUnavailable: false,
  isLoadingFullContent: false,
};
const REVIEW_FULL_CONTENT_CELL_GC_MS = 30_000;
const cells = new Map<string, ReviewFullContentCell>();
const inFlightByCell = new WeakMap<ReviewFullContentCell, ReviewFullContentLoad>();

function getReviewFullContentCell(key: string): ReviewFullContentCell {
  const existing = cells.get(key);
  if (existing) return existing;

  const cell: ReviewFullContentCell = {
    key,
    state: EMPTY_REVIEW_FULL_CONTENT_STATE,
    listeners: new Set(),
    gcTimer: null,
  };
  cells.set(key, cell);
  return cell;
}

function emitCell(cell: ReviewFullContentCell): void {
  for (const listener of cell.listeners) listener();
}

function updateCell(
  cell: ReviewFullContentCell,
  state: ReviewFullContentState,
): void {
  if (cell.state === state) return;
  cell.state = state;
  emitCell(cell);
}

function scheduleCellGc(cell: ReviewFullContentCell): void {
  if (cell.gcTimer !== null || cell.listeners.size > 0) return;
  cell.gcTimer = setTimeout(() => {
    cell.gcTimer = null;
    if (cell.listeners.size > 0 || inFlightByCell.has(cell)) return;
    if (cells.get(cell.key) === cell) cells.delete(cell.key);
  }, REVIEW_FULL_CONTENT_CELL_GC_MS);
}

function subscribeCell(
  cell: ReviewFullContentCell,
  listener: () => void,
): () => void {
  if (cell.gcTimer !== null) {
    clearTimeout(cell.gcTimer);
    cell.gcTimer = null;
  }
  cell.listeners.add(listener);
  return () => {
    cell.listeners.delete(listener);
    scheduleCellGc(cell);
  };
}

export function useReviewFullContentState(
  key: string,
): ReviewFullContentState {
  const cell = getReviewFullContentCell(key);
  return useSyncExternalStore(
    (listener) => subscribeCell(cell, listener),
    () => cell.state,
    () => cell.state,
  );
}

export function readReviewFullContentState(
  key: string,
): ReviewFullContentState {
  return getReviewFullContentCell(key).state;
}

function isFullContentUnavailable(contents: GitReviewFileContents): boolean {
  return (
    contents.errorMessage !== null ||
    !contents.safety.renderable ||
    contents.oldStatus !== "loaded" ||
    contents.newStatus !== "loaded" ||
    (!contents.oldExists && !contents.newExists)
  );
}

export function loadReviewFullContent(input: {
  key: string;
  identity: string;
  load: () => Promise<GitReviewFileContents>;
  expand: (contents: GitReviewFileContents) => FileDiffMetadata | null;
}): Promise<void> {
  const cell = getReviewFullContentCell(input.key);
  if (
    cell.state.fullDiffMetadata ||
    cell.state.fullContentLoadFailed ||
    cell.state.fullContentUnavailable
  ) {
    return Promise.resolve();
  }

  const currentLoad = inFlightByCell.get(cell);
  if (currentLoad?.identity === input.identity) return currentLoad.promise;

  updateCell(cell, {
    ...cell.state,
    isLoadingFullContent: true,
  });

  const promise = input
    .load()
    .then((contents) => {
      if (inFlightByCell.get(cell)?.identity !== input.identity) {
        recordReviewRuntimeEvent({
          type: "stale-discard",
          operation: "full-content",
        });
        return;
      }
      if (isFullContentUnavailable(contents)) {
        updateCell(cell, {
          ...EMPTY_REVIEW_FULL_CONTENT_STATE,
          fullContents: contents,
          fullContentUnavailable: true,
        });
        return;
      }

      const fullDiffMetadata = input.expand(contents);
      updateCell(cell, {
        ...EMPTY_REVIEW_FULL_CONTENT_STATE,
        fullDiffMetadata,
        fullContents: contents,
        fullContentUnavailable: fullDiffMetadata === null,
      });
    })
    .catch(() => {
      if (inFlightByCell.get(cell)?.identity !== input.identity) return;
      updateCell(cell, {
        ...EMPTY_REVIEW_FULL_CONTENT_STATE,
        fullContentLoadFailed: true,
      });
    })
    .finally(() => {
      if (inFlightByCell.get(cell)?.identity !== input.identity) return;
      inFlightByCell.delete(cell);
      scheduleCellGc(cell);
    });

  inFlightByCell.set(cell, { identity: input.identity, promise });
  return promise;
}

export function __resetReviewFullContentStoreForTests(): void {
  for (const cell of cells.values()) {
    if (cell.gcTimer !== null) clearTimeout(cell.gcTimer);
  }
  cells.clear();
}
