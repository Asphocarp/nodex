export function buildCodexTurnOccurrenceKey(
  turnId: string | null,
  turnIndex: number,
): string {
  return turnId ?? `turn-index-${turnIndex}`;
}
