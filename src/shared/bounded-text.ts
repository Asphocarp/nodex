export interface BoundedTextTail {
  readonly text: string;
  readonly didTruncate: boolean;
}

export function appendTextTail(input: {
  readonly current: string;
  readonly delta: string;
  readonly maxChars: number;
  readonly didTruncate?: boolean;
}): BoundedTextTail {
  const { current, delta, maxChars, didTruncate = false } = input;
  assertValidCharacterLimit(maxChars);

  if (maxChars === 0) {
    return {
      text: "",
      didTruncate: didTruncate || current.length > 0 || delta.length > 0,
    };
  }

  if (delta.length >= maxChars) {
    return {
      text: delta.slice(-maxChars),
      didTruncate: didTruncate || current.length > 0 || delta.length > maxChars,
    };
  }

  const currentBudget = maxChars - delta.length;
  const boundedCurrent = current.length > currentBudget
    ? current.slice(-currentBudget)
    : current;

  return {
    text: boundedCurrent + delta,
    didTruncate: didTruncate || boundedCurrent.length < current.length,
  };
}

function assertValidCharacterLimit(maxChars: number): void {
  if (Number.isSafeInteger(maxChars) && maxChars >= 0) return;
  throw new RangeError("maxChars must be a non-negative safe integer");
}
