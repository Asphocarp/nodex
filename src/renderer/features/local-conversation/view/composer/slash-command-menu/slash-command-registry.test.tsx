import { describe, expect, test } from "bun:test";
import type { ThreadFooterModel, ThreadStageActions } from "../../../thread-stage-types";
import { buildComposerSlashCommands } from "./slash-command-registry";

function buildModel(): ThreadFooterModel {
  return {
    threadId: "thread_1",
    conversation: {
      threadId: "thread_1",
      statusType: "idle",
      source: null,
    },
    body: {
      latestTurnId: "turn_1",
    },
    collaborationModes: [
      { mode: "default", label: "Default" },
      { mode: "plan", label: "Plan" },
    ],
    selectedCollaborationMode: "default",
    composerPlugins: [],
    isThreadRunning: false,
  } as unknown as ThreadFooterModel;
}

function buildActions(): ThreadStageActions {
  return {
    onGetThreadGoal: async () => null,
    onSetThreadGoal: async () => null,
    onClearThreadGoal: async () => undefined,
    onCollaborationModeChange: () => undefined,
  } as unknown as ThreadStageActions;
}

describe("buildComposerSlashCommands", () => {
  test("models Goal as a direct goal-mode command instead of a nested editor", async () => {
    let goalModeActivations = 0;
    let clearedInlineTrigger = false;
    const commands = buildComposerSlashCommands({
      model: buildModel(),
      actions: buildActions(),
      serviceTier: null,
      setServiceTier: () => undefined,
      insertPluginMention: () => undefined,
      openExpandedDialog: () => undefined,
      onPetToggle: () => undefined,
      activateGoalMode: () => {
        goalModeActivations += 1;
      },
    });
    const goalCommand = commands.find((command) => command.id === "goal");
    if (!goalCommand) {
      throw new Error("Expected Goal slash command.");
    }
    if (!goalCommand.onSelect || !goalCommand.onSelectFromInlineSlash) {
      throw new Error("Expected Goal slash command selection handlers.");
    }

    expect(Boolean(goalCommand.Content)).toBeFalse();
    expect(goalCommand.requiresEmptyComposer).toBe(false);
    expect(JSON.stringify(goalCommand.triggers)).toBe("[\"/\",\"@\"]");

    await goalCommand.onSelect({ source: "dialog" });
    await goalCommand.onSelectFromInlineSlash({
      source: "inline",
      trigger: {
        active: true,
        trigger: "/",
        query: "goal",
        from: 0,
        to: 5,
      },
      clearTrigger: () => {
        clearedInlineTrigger = true;
      },
      replaceTrigger: () => undefined,
    });

    expect(goalModeActivations).toBe(2);
    expect(clearedInlineTrigger).toBeTrue();
  });
});
