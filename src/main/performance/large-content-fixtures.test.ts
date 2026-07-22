import { describe, expect, test } from "vitest";
import {
  createLargeContentFixtures,
  LARGE_CONTENT_FIXTURE_SIZES,
} from "./large-content-fixtures";

describe("large-content performance fixtures", () => {
  test("builds deterministic fixtures on every requested boundary", () => {
    const fixtures = createLargeContentFixtures();

    expect(fixtures.notices).toHaveLength(LARGE_CONTENT_FIXTURE_SIZES.noticesCharacters);
    expect(Buffer.byteLength(fixtures.workspacePlainText, "utf8"))
      .toBe(LARGE_CONTENT_FIXTURE_SIZES.workspaceBytes);
    expect(Buffer.byteLength(fixtures.workspaceMarkdown, "utf8"))
      .toBe(LARGE_CONTENT_FIXTURE_SIZES.workspaceBytes);
    expect(Buffer.byteLength(JSON.stringify(fixtures.toolValue), "utf8"))
      .toBeGreaterThanOrEqual(LARGE_CONTENT_FIXTURE_SIZES.toolValueBytes);
    expect(Buffer.byteLength(fixtures.setupLogDelta, "utf8"))
      .toBe(LARGE_CONTENT_FIXTURE_SIZES.setupLogBytes);
    expect(fixtures.legacyUserMessage)
      .toHaveLength(LARGE_CONTENT_FIXTURE_SIZES.legacyUserMessageCharacters);
    expect(Buffer.byteLength(fixtures.inlineDiffWithinByteBudget, "utf8"))
      .toBe(LARGE_CONTENT_FIXTURE_SIZES.inlineDiffBytes);
    expect(Buffer.byteLength(fixtures.inlineDiffOverByteBudget, "utf8"))
      .toBe(LARGE_CONTENT_FIXTURE_SIZES.inlineDiffBytes + 1);
    expect(countLines(fixtures.inlineDiffWithinLineBudget))
      .toBe(LARGE_CONTENT_FIXTURE_SIZES.inlineDiffLines);
    expect(countLines(fixtures.inlineDiffOverLineBudget))
      .toBe(LARGE_CONTENT_FIXTURE_SIZES.inlineDiffLines + 1);
  });
});

function countLines(value: string): number {
  return value.split("\n").length;
}
