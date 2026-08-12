import { describe, expect, test } from "vitest";
import type { CodexModelOption, CodexReasoningEffort } from "@/lib/types";
import {
  findComposerPowerChoiceIndex,
  resolveComposerPowerPolicy,
} from "./composer-intelligence-power-policy";

function model(
  id: string,
  efforts: readonly CodexReasoningEffort[],
  hidden = false,
): CodexModelOption {
  return {
    id,
    model: id,
    displayName: id === "gpt-5.6-sol" ? "GPT-5.6 Sol" : "GPT-5.6 Terra",
    description: "",
    hidden,
    isDefault: false,
    defaultReasoningEffort: efforts[0] ?? "low",
    supportedReasoningEfforts: efforts.map((reasoningEffort) => ({
      reasoningEffort,
      description: "",
    })),
  };
}

describe("composer intelligence Power policy", () => {
  test("filters the declared Terra/Sol sequence against runtime capabilities", () => {
    const policy = resolveComposerPowerPolicy([
      model("gpt-5.6-terra", ["low", "medium", "high", "xhigh"]),
      model("gpt-5.6-sol", ["low", "medium", "high", "xhigh", "ultra"]),
    ]);

    expect(policy?.source).toBe("primary");
    expect(policy?.choices.map((choice) => choice.id)).toEqual([
      "gpt-5.6-terra:low",
      "gpt-5.6-sol:low",
      "gpt-5.6-sol:medium",
      "gpt-5.6-sol:high",
      "gpt-5.6-sol:xhigh",
      "gpt-5.6-sol:ultra",
    ]);
    expect(policy?.choices.at(-1)?.isUltra).toBe(true);
  });

  test("uses the Terra fallback only when at least three choices survive", () => {
    const fallback = resolveComposerPowerPolicy([
      model("gpt-5.6-terra", ["low", "medium", "high"]),
      model("gpt-5.6-sol", ["low"]),
    ]);
    const classic = resolveComposerPowerPolicy([
      model("gpt-5.6-terra", ["low", "medium"]),
      model("gpt-5.6-sol", ["low"]),
    ]);

    expect(fallback?.source).toBe("terraFallback");
    expect(fallback?.choices.map((choice) => choice.reasoningEffort)).toEqual([
      "low",
      "medium",
      "high",
    ]);
    expect(classic).toBeNull();
  });

  test("finds only an exact model/effort pair", () => {
    const policy = resolveComposerPowerPolicy([
      model("gpt-5.6-terra", ["low", "medium", "high"]),
    ]);
    if (!policy) throw new Error("Expected fallback Power policy");

    expect(findComposerPowerChoiceIndex(policy.choices, "gpt-5.6-terra", "medium")).toBe(1);
    expect(findComposerPowerChoiceIndex(policy.choices, "gpt-5.6-sol", "medium")).toBe(-1);
  });
});
