import { describe, expect, test } from "vitest";
import {
  createNodexAgentComprehensionTemplate,
  NODEX_AGENT_COMPREHENSION_CASES,
  NodexAgentComprehensionRunSchema,
  summarizeNodexAgentComprehensionRun,
} from "./nodex-agent-comprehension-benchmark";

describe("Nodex Agent comprehension benchmark", () => {
  test("covers every planned current intent with comparable v2 and v4 selections", () => {
    expect(NODEX_AGENT_COMPREHENSION_CASES.length).toBeGreaterThanOrEqual(13);
    for (const entry of NODEX_AGENT_COMPREHENSION_CASES) {
      expect(entry.expectedTool[2], entry.id).toBeTypeOf("string");
      expect(entry.expectedTool[4], entry.id).toBeTypeOf("string");
    }
  });

  test("computes schema validity and redacts arguments and results from summaries", () => {
    const summary = summarizeNodexAgentComprehensionRun({
      revision: 2,
      samples: [{
        caseId: "fuzzy-search",
        selectedTool: "search",
        arguments: { query: "dynmic tools" },
        result: {
          data: { target: "pages", results: [] },
          page: { hasMore: false },
        },
        semanticSuccess: true,
        correctionCalls: 0,
      }],
    });

    expect(summary).toMatchObject({
      revision: 2,
      sampleCount: 1,
      correctToolSelections: 1,
      validFirstCalls: 1,
      validResults: 1,
      semanticSuccesses: 1,
      totalCorrectionCalls: 0,
    });
    expect(JSON.stringify(summary)).not.toContain("dynmic tools");
    expect(JSON.stringify(summary)).not.toContain("results");
  });

  test("flags invalid calls and rejects prose or duplicate cases", () => {
    const invalid = summarizeNodexAgentComprehensionRun({
      revision: 2,
      samples: [{
        caseId: "fuzzy-search",
        selectedTool: "search",
        arguments: {},
        semanticSuccess: false,
        correctionCalls: 1,
      }],
    });
    expect(invalid.validFirstCalls).toBe(0);

    expect(NodexAgentComprehensionRunSchema.safeParse({
      revision: 2,
      modelProse: "unbounded model response",
      samples: [],
    }).success).toBe(false);
    expect(NodexAgentComprehensionRunSchema.safeParse({
      revision: 2,
      samples: [
        { caseId: "fuzzy-search", selectedTool: "search", arguments: {}, semanticSuccess: false, correctionCalls: 0 },
        { caseId: "fuzzy-search", selectedTool: "search", arguments: {}, semanticSuccess: false, correctionCalls: 0 },
      ],
    }).success).toBe(false);
  });

  test("prints a complete current-revision template", () => {
    const template = createNodexAgentComprehensionTemplate();
    const parsed = NodexAgentComprehensionRunSchema.parse(template);
    expect(parsed.samples).toHaveLength(NODEX_AGENT_COMPREHENSION_CASES.length);
    const v4 = NodexAgentComprehensionRunSchema.parse(
      createNodexAgentComprehensionTemplate(4),
    );
    expect(v4.revision).toBe(4);
    expect(v4.samples.find((sample) => sample.caseId === "duplicate-one-card")?.selectedTool)
      .toBe("duplicate_page");
  });

  test("validates v4 selections and arguments against the current contract", () => {
    const summary = summarizeNodexAgentComprehensionRun({
      revision: 4,
      samples: [{
        caseId: "fetch-default-document",
        selectedTool: "fetch",
        arguments: { id: "page-1" },
        semanticSuccess: true,
        correctionCalls: 0,
      }],
    });

    expect(summary.correctToolSelections).toBe(1);
    expect(summary.validFirstCalls).toBe(1);
  });
});
