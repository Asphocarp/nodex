import { describe, expect, test } from "bun:test";
import {
  formatThreadGoalStatusLabel,
  formatThreadGoalTokenProgress,
  getThreadGoalMessage,
  THREAD_GOAL_DEFAULT_MESSAGES,
} from "./thread-goal-copy";

describe("thread-goal-copy", () => {
  test("keeps the Codex Electron goal message surface complete", () => {
    expect(Object.keys(THREAD_GOAL_DEFAULT_MESSAGES).length).toBe(46);
    expect(getThreadGoalMessage("composer.goalSlashCommand.setDescription")).toBe("Set a goal that Codex will keep working towards");
    expect(getThreadGoalMessage("composer.placeholder.goal")).toBe("Describe your goal, define measurable outcomes for best results");
    expect(getThreadGoalMessage("composer.threadGoal.replaceConfirmation.title")).toBe("Replace current goal?");
  });

  test("maps every goal status to the reference summary label", () => {
    expect(formatThreadGoalStatusLabel("active")).toBe("Pursuing goal");
    expect(formatThreadGoalStatusLabel("paused")).toBe("Paused goal");
    expect(formatThreadGoalStatusLabel("blocked")).toBe("Goal blocked");
    expect(formatThreadGoalStatusLabel("usageLimited")).toBe("Goal usage limited");
    expect(formatThreadGoalStatusLabel("budgetLimited")).toBe("Goal limited");
    expect(formatThreadGoalStatusLabel("complete")).toBe("Goal achieved");
  });

  test("formats token progress through the reference template", () => {
    expect(formatThreadGoalTokenProgress({ used: 1500, budget: 2000 })).toBe("1.5K / 2K");
  });
});
