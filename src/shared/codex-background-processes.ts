const requireBackgroundProcessCoordinate = (value: string, fieldName: string): string => {
  const normalized = value.trim();
  if (normalized) return normalized;
  throw new Error(`${fieldName} is required`);
};

export const makeCodexBackgroundProcessRecordId = (input: {
  readonly threadId: string;
  readonly itemId: string;
  /** Process ids can change across observations and never participate in identity. */
  readonly processId?: string | null;
}): string => {
  const threadId = requireBackgroundProcessCoordinate(input.threadId, "Thread id");
  const itemId = requireBackgroundProcessCoordinate(input.itemId, "Process item id");
  return `${threadId}:${itemId}`;
};
