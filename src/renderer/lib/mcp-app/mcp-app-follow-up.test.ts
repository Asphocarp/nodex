import { describe, expect, test } from "vitest";
import {
  buildMcpAppFollowUpPrompt,
  parseMcpAppFollowUpMessage,
} from "./mcp-app-follow-up";

describe("MCP App follow-up messages", () => {
  test("normalizes a valid message and appends structured context to the prompt", () => {
    const message = parseMcpAppFollowUpMessage({
      context: { selectedDate: "2026-08-11" },
      ignored: true,
      prompt: "  Book this date  ",
      title: "  Confirm booking  ",
    });

    expect(message).toEqual({
      context: { selectedDate: "2026-08-11" },
      prompt: "Book this date",
      title: "Confirm booking",
    });
    expect(buildMcpAppFollowUpPrompt(message!)).toBe(
      "Book this date\n\nCurrent widget context (JSON):\n{\n  \"selectedDate\": \"2026-08-11\"\n}",
    );
  });

  test("rejects empty prompts, oversized titles, and oversized context", () => {
    expect(parseMcpAppFollowUpMessage({ prompt: "  " })).toBeNull();
    expect(parseMcpAppFollowUpMessage({ prompt: "Continue", title: "x".repeat(251) }))
      .toBeNull();
    expect(parseMcpAppFollowUpMessage({ prompt: "Continue", context: "x".repeat(32_769) }))
      .toBeNull();
  });
});
