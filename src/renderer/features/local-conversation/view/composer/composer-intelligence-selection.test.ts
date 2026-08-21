import { describe, expect, test } from "vitest";
import type { ThreadFooterModel } from "../../thread-stage-types";
import {
  areComposerIntelligenceSelectionsEqual,
  buildComposerIntelligenceTurnOverrides,
  deriveComposerIntelligenceSelection,
  type ComposerIntelligenceSelection,
} from "./composer-intelligence-selection";

const CODEX_SELECTION: ComposerIntelligenceSelection = {
  kind: "codex",
  model: "gpt-5.6-sol",
  reasoningEffort: "xhigh",
  serviceTier: "fast",
};

describe("composer intelligence selection", () => {
  test("derives active-thread speed ahead of the renderer default", () => {
    const selection = deriveComposerIntelligenceSelection(
      {
        selectedModel: "gpt-5.6-sol",
        selectedReasoningEffort: "xhigh",
        agentProviderCatalog: null,
        executionProfile: null,
        conversation: {
          latestThreadSettings: { serviceTier: "fast" },
        },
      } as ThreadFooterModel,
      null,
    );

    expect(selection).toEqual(CODEX_SELECTION);
  });

  test("builds exact Codex turn overrides and keeps Agent execution profile authoritative", () => {
    expect(buildComposerIntelligenceTurnOverrides(CODEX_SELECTION)).toEqual({
      model: "gpt-5.6-sol",
      reasoningEffort: "xhigh",
      serviceTier: "fast",
    });
    expect(
      buildComposerIntelligenceTurnOverrides({
        kind: "agent",
        change: "model",
        profile: {
          providerId: "anthropic",
          harnessId: "claude-code",
          modelId: "claude-opus",
          reasoningEffort: "high",
          serviceTier: null,
        },
      }),
    ).toEqual({});
  });

  test("compares semantic values instead of object identity", () => {
    expect(
      areComposerIntelligenceSelectionsEqual(CODEX_SELECTION, {
        ...CODEX_SELECTION,
      }),
    ).toBe(true);
    expect(
      areComposerIntelligenceSelectionsEqual(CODEX_SELECTION, {
        ...CODEX_SELECTION,
        serviceTier: null,
      }),
    ).toBe(false);
  });
});
