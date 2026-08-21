import type { ThreadGoal } from "@nodex/codex-app-server-protocol/v2";

export const THREAD_GOAL_DEFAULT_MESSAGES = {
  "composer.goalModeIndicator": "Goal",
  "composer.goalModeIndicator.clear": "Clear goal",
  "composer.goalModeIndicator.tooltip": "Clear goal",
  "composer.goalSlashCommand.setDescription": "Set a goal that Nodex will keep working towards",
  "composer.goalSlashCommand.title": "Goal",
  "composer.placeholder.goal": "Describe your goal, define measurable outcomes for best results",
  "composer.threadGoal.clear": "Clear goal",
  "composer.threadGoal.clearError": "Failed to clear goal",
  "composer.threadGoal.clearTooltip": "Clear goal",
  "composer.threadGoal.collapseObjective": "Hide full goal",
  "composer.threadGoal.collapseObjectiveTooltip": "Hide full goal",
  "composer.threadGoal.edit": "Edit goal",
  "composer.threadGoal.editDialog.ariaLabel": "Goal",
  "composer.threadGoal.editDialog.cancel": "Cancel",
  "composer.threadGoal.editDialog.save": "Save",
  "composer.threadGoal.editDialog.title": "Edit goal",
  "composer.threadGoal.editLoadError": "Failed to load goal objective",
  "composer.threadGoal.editSaveError": "Failed to save goal objective",
  "composer.threadGoal.editTooltip": "Edit goal",
  "composer.threadGoal.expandObjective": "Show full goal",
  "composer.threadGoal.expandObjectiveTooltip": "Show full goal",
  "composer.threadGoal.materializeError": "Failed to prepare goal attachments",
  "composer.threadGoal.pause": "Pause goal",
  "composer.threadGoal.pauseTooltip": "Pause goal",
  "composer.threadGoal.replaceConfirmation.cancel": "Cancel",
  "composer.threadGoal.replaceConfirmation.confirm": "Replace goal",
  "composer.threadGoal.replaceConfirmation.subtitle":
    "This will keep the thread but replace the saved goal with your current composer text",
  "composer.threadGoal.replaceConfirmation.title": "Replace current goal?",
  "composer.threadGoal.resume": "Resume goal",
  "composer.threadGoal.resumeConfirmation.dismissError": "Failed to dismiss goal prompt",
  "composer.threadGoal.resumeConfirmation.keepPaused": "Keep paused",
  "composer.threadGoal.resumeConfirmation.notNow": "Not now",
  "composer.threadGoal.resumeConfirmation.resumableTitle": "Resume goal?",
  "composer.threadGoal.resumeConfirmation.resume": "Resume goal",
  "composer.threadGoal.resumeConfirmation.subtitle":
    "Nodex will keep working toward this goal when the thread is idle",
  "composer.threadGoal.resumeConfirmation.title": "Resume paused goal?",
  "composer.threadGoal.resumeTooltip": "Resume goal",
  "composer.threadGoal.setError": "Failed to set goal",
  "composer.threadGoal.statusUpdateError": "Failed to update goal",
  "composer.threadGoal.summary.active": "Pursuing goal",
  "composer.threadGoal.summary.blocked": "Goal blocked",
  "composer.threadGoal.summary.budgetLimited": "Goal limited",
  "composer.threadGoal.summary.complete": "Goal achieved",
  "composer.threadGoal.summary.paused": "Paused goal",
  "composer.threadGoal.summary.usageLimited": "Goal usage limited",
  "composer.threadGoal.tokenProgress": "{used} / {budget}",
} as const;

export type ThreadGoalMessageId = keyof typeof THREAD_GOAL_DEFAULT_MESSAGES;

export const THREAD_GOAL_STATUS_LABELS: Record<ThreadGoal["status"], string> = {
  active: THREAD_GOAL_DEFAULT_MESSAGES["composer.threadGoal.summary.active"],
  paused: THREAD_GOAL_DEFAULT_MESSAGES["composer.threadGoal.summary.paused"],
  blocked: THREAD_GOAL_DEFAULT_MESSAGES["composer.threadGoal.summary.blocked"],
  usageLimited: THREAD_GOAL_DEFAULT_MESSAGES["composer.threadGoal.summary.usageLimited"],
  budgetLimited: THREAD_GOAL_DEFAULT_MESSAGES["composer.threadGoal.summary.budgetLimited"],
  complete: THREAD_GOAL_DEFAULT_MESSAGES["composer.threadGoal.summary.complete"],
};

const COMPACT_NUMBER_FORMATTER = new Intl.NumberFormat("en-US", {
  notation: "compact",
  maximumFractionDigits: 1,
});

export function getThreadGoalMessage(messageId: ThreadGoalMessageId): string {
  return THREAD_GOAL_DEFAULT_MESSAGES[messageId];
}

export function formatThreadGoalStatusLabel(status: ThreadGoal["status"]): string {
  return THREAD_GOAL_STATUS_LABELS[status];
}

export function formatThreadGoalTokenProgress(input: { used: number; budget: number }): string {
  return getThreadGoalMessage("composer.threadGoal.tokenProgress")
    .replace("{used}", COMPACT_NUMBER_FORMATTER.format(input.used))
    .replace("{budget}", COMPACT_NUMBER_FORMATTER.format(input.budget));
}
