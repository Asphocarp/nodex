export const LARGE_CONTENT_FIXTURE_SIZES = {
  workspaceBytes: 1_500_000,
  toolValueBytes: 5 * 1024 * 1024,
  setupLogBytes: 10 * 1024 * 1024,
  legacyUserMessageCharacters: 100_000,
  inlineDiffBytes: 256 * 1024,
  inlineDiffLines: 5_000,
} as const;

export interface LargeContentFixtures {
  readonly workspacePlainText: string;
  readonly workspaceMarkdown: string;
  readonly toolValue: unknown;
  readonly setupLogDelta: string;
  readonly legacyUserMessage: string;
  readonly inlineDiffWithinByteBudget: string;
  readonly inlineDiffOverByteBudget: string;
  readonly inlineDiffWithinLineBudget: string;
  readonly inlineDiffOverLineBudget: string;
}

export function createLargeContentFixtures(): LargeContentFixtures {
  const diffHeader = "diff --git a/fixture.txt b/fixture.txt\n--- a/fixture.txt\n+++ b/fixture.txt\n";
  return {
    workspacePlainText: repeatAsciiToLength(
      "plain workspace source\n",
      LARGE_CONTENT_FIXTURE_SIZES.workspaceBytes,
    ),
    workspaceMarkdown: repeatAsciiToLength(
      "- [fixture link](https://example.test/fixture)\n",
      LARGE_CONTENT_FIXTURE_SIZES.workspaceBytes,
    ),
    toolValue: createNestedToolValue(LARGE_CONTENT_FIXTURE_SIZES.toolValueBytes),
    setupLogDelta: repeatAsciiToLength("setup output\n", LARGE_CONTENT_FIXTURE_SIZES.setupLogBytes),
    legacyUserMessage: repeatAsciiToLength(
      "legacy user message with [a link](https://example.test)\n",
      LARGE_CONTENT_FIXTURE_SIZES.legacyUserMessageCharacters,
    ),
    inlineDiffWithinByteBudget: createDiffWithByteLength(
      diffHeader,
      LARGE_CONTENT_FIXTURE_SIZES.inlineDiffBytes,
    ),
    inlineDiffOverByteBudget: createDiffWithByteLength(
      diffHeader,
      LARGE_CONTENT_FIXTURE_SIZES.inlineDiffBytes + 1,
    ),
    inlineDiffWithinLineBudget: createDiffWithLineCount(
      diffHeader,
      LARGE_CONTENT_FIXTURE_SIZES.inlineDiffLines,
    ),
    inlineDiffOverLineBudget: createDiffWithLineCount(
      diffHeader,
      LARGE_CONTENT_FIXTURE_SIZES.inlineDiffLines + 1,
    ),
  };
}

function repeatAsciiToLength(seed: string, length: number): string {
  if (length === 0) return "";
  const repetitions = Math.ceil(length / seed.length);
  return seed.repeat(repetitions).slice(0, length);
}

function createNestedToolValue(minimumSerializedBytes: number): unknown {
  const chunk = repeatAsciiToLength("tool payload\n", 64 * 1024);
  const entries: Array<{ readonly index: number; readonly payload: string }> = [];
  let serializedBytes = 2;

  while (serializedBytes < minimumSerializedBytes) {
    const entry = { index: entries.length, payload: chunk };
    entries.push(entry);
    serializedBytes += utf8ByteLength(JSON.stringify(entry)) + 1;
  }

  return {
    fixture: {
      entries,
      metadata: { kind: "large-content-performance", version: 1 },
    },
  };
}

function createDiffWithByteLength(header: string, targetBytes: number): string {
  const headerBytes = utf8ByteLength(header);
  if (headerBytes > targetBytes) throw new RangeError("Diff target is smaller than its header");
  return header + repeatAsciiToLength("+changed fixture content\n", targetBytes - headerBytes);
}

function createDiffWithLineCount(header: string, targetLines: number): string {
  const headerLineCount = countTextLines(header);
  if (headerLineCount > targetLines) throw new RangeError("Diff target has fewer lines than its header");
  return header + "+line\n".repeat(targetLines - headerLineCount);
}

function countTextLines(value: string): number {
  let lines = 1;
  for (let index = 0; index < value.length; index += 1) {
    if (value.charCodeAt(index) === 10) lines += 1;
  }
  return lines;
}

function utf8ByteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}
