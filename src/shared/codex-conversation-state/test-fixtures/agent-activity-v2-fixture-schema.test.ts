import { describe, expect, test } from "vitest";
import {
  assertAgentActivityV2ProjectionFixture,
  type AgentActivityV2ProjectionFixture,
  validateAgentActivityV2ProjectionFixture,
} from "./agent-activity-v2-fixture-schema";
import { agentActivityV2MixedFamilyFixture } from "./agent-activity-v2-mixed-family";
import { sanitizedCommandLifecycleFixture } from "./sanitized-command-lifecycle";

function hasError(errors: readonly string[], fragment: string): boolean {
  return errors.some((error) => error.includes(fragment));
}

describe("agent activity v2 projection fixture schema", () => {
  test("accepts a mixed groupable run across a hidden reasoning source", () => {
    const errors = validateAgentActivityV2ProjectionFixture(
      agentActivityV2MixedFamilyFixture,
    );

    expect(errors.length).toBe(0);
    expect(JSON.stringify(
      agentActivityV2MixedFamilyFixture.expected.projectedItems.map((item) => item.itemType),
    )).toBe(JSON.stringify([
      "exec",
      "exec",
      "exec",
      "exec",
      "reasoning",
      "patch",
      "web-search",
      "mcp-tool-call",
      "dynamic-tool-call",
      "dynamic-tool-call",
      "turn-diff",
      "exec",
    ]));
    expect(JSON.stringify(agentActivityV2MixedFamilyFixture.expected.units)).toBe(
      JSON.stringify([
        {
          kind: "group",
          key: "agent-activity-group:command-multi:0",
          activitySourceIndexes: [0, 1, 2, 3, 5, 6, 7, 8],
        },
        {
          kind: "standalone",
          key: "agent-activity-standalone:dynamic-handoff-thread",
          activitySourceIndex: 9,
        },
      ]),
    );
    expect(
      agentActivityV2MixedFamilyFixture.expected.activitySourceItems[6]?.identity?.value,
    ).toBe("web-search:6");
  });

  test("rejects splitting one maximal groupable run by tool family", () => {
    const invalidFixture = {
      ...agentActivityV2MixedFamilyFixture,
      expected: {
        ...agentActivityV2MixedFamilyFixture.expected,
        units: [
          {
            kind: "group",
            key: "agent-activity-group:command-multi:0",
            activitySourceIndexes: [0, 1, 2, 3],
          },
          {
            kind: "group",
            key: "agent-activity-group:patch-mixed",
            activitySourceIndexes: [5, 6, 7, 8],
          },
          {
            kind: "standalone",
            key: "agent-activity-standalone:dynamic-handoff-thread",
            activitySourceIndex: 9,
          },
        ],
      },
    } satisfies AgentActivityV2ProjectionFixture;

    const errors = validateAgentActivityV2ProjectionFixture(invalidFixture);

    expect(hasError(errors, "canonical hidden/filter/barrier grouping semantics")).toBe(true);
  });

  test("validates identity precedence and cross-stage carrier types", () => {
    const [execSource, ...remainingSources] =
      agentActivityV2MixedFamilyFixture.expected.activitySourceItems;
    if (execSource === undefined) {
      throw new Error("Invalid mixed-family fixture");
    }

    const invalidFixture = {
      ...agentActivityV2MixedFamilyFixture,
      expected: {
        ...agentActivityV2MixedFamilyFixture.expected,
        activitySourceItems: [
          {
            ...execSource,
            itemType: "patch",
            identity: { field: "requestId", value: "wrong-precedence" },
          },
          ...remainingSources,
        ],
        units: [{
          kind: "group",
          key: "agent-activity-group:wrong-precedence",
          activitySourceIndexes: [0, 1, 2, 3, 5, 6, 7, 8],
        }, {
          kind: "standalone",
          key: "agent-activity-standalone:dynamic-handoff-thread",
          activitySourceIndex: 9,
        }],
      },
    } satisfies AgentActivityV2ProjectionFixture;

    const errors = validateAgentActivityV2ProjectionFixture(invalidFixture);

    expect(hasError(errors, "does not match carrier projected type exec")).toBe(true);
    expect(hasError(errors, "does not match callId:command-multi:0")).toBe(true);
  });

  test("compares unit descriptors structurally instead of by property insertion order", () => {
    const reorderedFixture = {
      ...agentActivityV2MixedFamilyFixture,
      expected: {
        ...agentActivityV2MixedFamilyFixture.expected,
        units: [
          {
            key: "agent-activity-group:command-multi:0",
            activitySourceIndexes: [0, 1, 2, 3, 5, 6, 7, 8],
            kind: "group",
          },
          {
            activitySourceIndex: 9,
            key: "agent-activity-standalone:dynamic-handoff-thread",
            kind: "standalone",
          },
        ],
      },
    } satisfies AgentActivityV2ProjectionFixture;

    expect(validateAgentActivityV2ProjectionFixture(reorderedFixture).length).toBe(0);
  });

  test("supports turn-context-derived activity sources without a projected carrier", () => {
    const derivedFixture = {
      ...agentActivityV2MixedFamilyFixture,
      expected: {
        ...agentActivityV2MixedFamilyFixture.expected,
        activitySourceItems: agentActivityV2MixedFamilyFixture.expected.activitySourceItems.map(
          (sourceItem) => sourceItem.activitySourceIndex === 4
            ? {
                ...sourceItem,
                origin: {
                  kind: "derived" as const,
                  sourceReferences: [{
                    kind: "turn-context" as const,
                    turnId: agentActivityV2MixedFamilyFixture.projectionContext.turnId,
                  }],
                },
              }
            : sourceItem,
        ),
      },
    } satisfies AgentActivityV2ProjectionFixture;

    expect(validateAgentActivityV2ProjectionFixture(derivedFixture).length).toBe(0);
  });

  test("uses fallback identity when a higher-priority request ID is numeric", () => {
    const numericRequestIdentityFixture = {
      ...agentActivityV2MixedFamilyFixture,
      expected: {
        ...agentActivityV2MixedFamilyFixture.expected,
        activitySourceItems: agentActivityV2MixedFamilyFixture.expected.activitySourceItems.map(
          (sourceItem) => sourceItem.activitySourceIndex === 6
            ? {
                ...sourceItem,
                identityCandidates: { requestId: 73 },
              }
            : sourceItem,
        ),
      },
    } satisfies AgentActivityV2ProjectionFixture;

    expect(validateAgentActivityV2ProjectionFixture(numericRequestIdentityFixture).length).toBe(0);
  });

  test("rejects server-request provenance from another thread and turn", () => {
    const foreignRequest = sanitizedCommandLifecycleFixture.events[2];
    if (foreignRequest?.type !== "request") {
      throw new Error("Invalid sanitized command lifecycle fixture");
    }

    const [firstProjectedItem, ...remainingProjectedItems] =
      agentActivityV2MixedFamilyFixture.expected.projectedItems;
    if (firstProjectedItem === undefined) {
      throw new Error("Invalid mixed-family fixture");
    }

    const foreignRequestFixture = {
      ...agentActivityV2MixedFamilyFixture,
      replay: {
        ...agentActivityV2MixedFamilyFixture.replay,
        events: [foreignRequest],
      },
      expected: {
        ...agentActivityV2MixedFamilyFixture.expected,
        projectedItems: [{
          ...firstProjectedItem,
          sourceReferences: [{
            kind: "server-request",
            id: foreignRequest.request.id,
            usage: "pending-request-projection",
          }],
        }, ...remainingProjectedItems],
      },
    } satisfies AgentActivityV2ProjectionFixture;

    const errors = validateAgentActivityV2ProjectionFixture(foreignRequestFixture);

    expect(hasError(errors, "references unavailable pending-request-projection server request 73"))
      .toBe(true);
  });

  test("assertion reports broken raw-state provenance", () => {
    const invalidFixture = {
      ...agentActivityV2MixedFamilyFixture,
      expected: {
        ...agentActivityV2MixedFamilyFixture.expected,
        projectedItems: [
          {
            ...agentActivityV2MixedFamilyFixture.expected.projectedItems[0],
            sourceReferences: [{ kind: "thread-item", id: "missing-command" }],
          },
          ...agentActivityV2MixedFamilyFixture.expected.projectedItems.slice(1),
        ],
      },
    } satisfies AgentActivityV2ProjectionFixture;

    let message = "";
    try {
      assertAgentActivityV2ProjectionFixture(invalidFixture);
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }

    expect(message.includes("references unknown thread item missing-command")).toBe(true);
  });
});
