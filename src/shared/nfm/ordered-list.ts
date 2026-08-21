import type { NfmBlock } from "./types";

export function normalizeOrderedListStart(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) {
    return undefined;
  }

  return value;
}

export function resolveOrderedListStarts(blocks: NfmBlock[]): Array<number | undefined> {
  const starts: Array<number | undefined> = [];
  let nextStart = 1;

  for (const block of blocks) {
    if (block.type !== "numberedListItem") {
      starts.push(undefined);
      nextStart = 1;
      continue;
    }

    const resolvedStart = normalizeOrderedListStart(block.start) ?? nextStart;
    starts.push(resolvedStart);
    nextStart = resolvedStart + 1;
  }

  return starts;
}
