import { describe, expect, test } from "vitest";
import { resolveCompletedMcpServerElicitationView } from "./mcp-server-elicitation-view";

describe("resolveCompletedMcpServerElicitationView", () => {
  test("projects exact summary, question, and terminal action labels", () => {
    const cases = [
      ["mcpToolCall", "accept", "Requested permission", "Accepted"],
      ["generic", "cancel", "Completed request", "Cancelled"],
      ["formElicitation", "decline", "Completed request", "Declined"],
      ["urlAction", null, "Completed request", "Completed"],
    ] as const;

    const actual = cases.map(([kind, action]) => resolveCompletedMcpServerElicitationView({
      completed: true,
      requestId: `request-${kind}`,
      action,
      elicitation: { kind, message: `Question for ${kind}` },
    }));

    expect(actual.map((view) => view?.summary).join(",")).toBe(cases.map((entry) => entry[2]).join(","));
    expect(actual.map((view) => view?.answer).join(",")).toBe(cases.map((entry) => entry[3]).join(","));
  });

  test("uses suggestion reason and hides incomplete or unsupported requests", () => {
    const suggestion = resolveCompletedMcpServerElicitationView({
      completed: true,
      requestId: "request-suggestion",
      action: "accept",
      elicitation: {
        kind: "toolSuggestion",
        suggestion: { suggest_reason: "Use the issue tracker connector" },
      },
    });
    const incomplete = resolveCompletedMcpServerElicitationView({
      completed: false,
      requestId: "request-incomplete",
      elicitation: { kind: "generic", message: "Pending" },
    });
    const unsupported = resolveCompletedMcpServerElicitationView({
      completed: true,
      requestId: "request-unsupported",
      elicitation: { kind: "unsupportedOpenAIForm" },
    });

    expect(suggestion?.question).toBe("Use the issue tracker connector");
    expect(incomplete).toBe(null);
    expect(unsupported).toBe(null);
  });
});
