import { describe, expect, test } from "bun:test";
import {
  hasDefaultMode,
  hasPlanMode,
  isPlanMode,
  resolveNextComposerPlanMode,
  shouldShowComposerPlanKeywordSuggestion,
} from "./composer-plan-mode";

const modes = [
  { mode: "default" },
  { mode: "plan" },
];

describe("composer plan mode helpers", () => {
  test("detects available plan and default modes", () => {
    expect(hasPlanMode(modes)).toBeTrue();
    expect(hasDefaultMode(modes)).toBeTrue();
    expect(isPlanMode("plan")).toBeTrue();
    expect(isPlanMode("default")).toBeFalse();
  });

  test("toggles between default and plan mode", () => {
    expect(resolveNextComposerPlanMode({ currentMode: "default", modes })).toBe("plan");
    expect(resolveNextComposerPlanMode({ currentMode: "plan", modes })).toBe("default");
    expect(resolveNextComposerPlanMode({ currentMode: "default", modes: [{ mode: "default" }] })).toBe(null);
  });

  test("shows keyword suggestion only for plan drafts that are not already dismissed or active", () => {
    expect(shouldShowComposerPlanKeywordSuggestion({
      prompt: "please plan this migration",
      currentMode: "default",
      modes,
      dismissed: false,
    })).toBeTrue();
    expect(shouldShowComposerPlanKeywordSuggestion({
      prompt: "please plan this migration",
      currentMode: "plan",
      modes,
      dismissed: false,
    })).toBeFalse();
    expect(shouldShowComposerPlanKeywordSuggestion({
      prompt: "please plan this migration",
      currentMode: "default",
      modes,
      dismissed: true,
    })).toBeFalse();
    expect(shouldShowComposerPlanKeywordSuggestion({
      prompt: "please explain this migration",
      currentMode: "default",
      modes,
      dismissed: false,
    })).toBeFalse();
  });
});
