import { describe, expect, it } from "vitest";
import {
  parseCodexReasoningSummary,
  resolveCodexReasoningSummary,
} from "./codex-reasoning-summary-policy";

describe("codex reasoning summary policy", () => {
  it("enables detailed summaries by default like Electron", () => {
    expect(resolveCodexReasoningSummary()).toBe("detailed");
    expect(resolveCodexReasoningSummary({ configuredSummary: "none" })).toBe("detailed");
  });

  it("preserves a configured mode when the capability is disabled", () => {
    expect(resolveCodexReasoningSummary({
      configuredSummary: "concise",
      concurrentReasoningSummaries: false,
    })).toBe("concise");
  });

  it("lets an explicit per-turn mode win over the feature default", () => {
    expect(resolveCodexReasoningSummary({ explicitSummary: "none" })).toBe("none");
    expect(resolveCodexReasoningSummary({ explicitSummary: "auto" })).toBe("auto");
  });

  it("rejects malformed protocol values at the boundary", () => {
    expect(parseCodexReasoningSummary("detailed")).toBe("detailed");
    expect(parseCodexReasoningSummary(null)).toBeNull();
    expect(parseCodexReasoningSummary("verbose")).toBeUndefined();
    expect(parseCodexReasoningSummary({})).toBeUndefined();
  });
});
