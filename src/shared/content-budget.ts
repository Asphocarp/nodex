export interface BoundedLineCount {
  readonly lineCount: number;
  readonly didExceedLimit: boolean;
}

export type ContentBudgetDecision =
  | {
      readonly kind: "withinBudget";
      readonly utf8Bytes: number;
      readonly lineCount: number;
    }
  | {
      readonly kind: "tooLarge";
      readonly reason: "bytes" | "lines" | "characters";
      readonly utf8Bytes?: number;
      readonly lineCount?: number;
    };

const textEncoder = new TextEncoder();

export function getUtf8ByteLength(value: string): number {
  return textEncoder.encode(value).byteLength;
}

export function countLinesUpTo(value: string, maxLines: number): BoundedLineCount {
  assertPositiveSafeInteger(maxLines, "maxLines");
  let lineCount = 1;

  for (let index = 0; index < value.length; index += 1) {
    if (value.charCodeAt(index) !== 10) continue;
    lineCount += 1;
    if (lineCount <= maxLines) continue;
    return { lineCount, didExceedLimit: true };
  }

  return { lineCount, didExceedLimit: false };
}

export function classifyContentBudget(input: {
  readonly value: string;
  readonly maxBytes?: number;
  readonly maxLines?: number;
  readonly maxChars?: number;
}): ContentBudgetDecision {
  const { value, maxBytes, maxLines, maxChars } = input;
  if (maxChars !== undefined) {
    assertPositiveSafeInteger(maxChars, "maxChars");
    if (value.length > maxChars) return { kind: "tooLarge", reason: "characters" };
  }

  const lineResult = maxLines === undefined ? undefined : countLinesUpTo(value, maxLines);
  if (lineResult?.didExceedLimit) {
    return {
      kind: "tooLarge",
      reason: "lines",
      lineCount: lineResult.lineCount,
    };
  }

  if (maxBytes !== undefined) {
    assertPositiveSafeInteger(maxBytes, "maxBytes");
    if (value.length > maxBytes) return { kind: "tooLarge", reason: "bytes" };
  }

  const utf8Bytes = getUtf8ByteLength(value);
  if (maxBytes !== undefined && utf8Bytes > maxBytes) {
    return { kind: "tooLarge", reason: "bytes", utf8Bytes };
  }

  return {
    kind: "withinBudget",
    utf8Bytes,
    lineCount: lineResult?.lineCount ?? countLinesUpTo(value, Number.MAX_SAFE_INTEGER).lineCount,
  };
}

function assertPositiveSafeInteger(value: number, name: string): void {
  if (Number.isSafeInteger(value) && value > 0) return;
  throw new RangeError(`${name} must be a positive safe integer`);
}
