import type {
  CodexPendingSteer,
  CodexQueuedFollowUp,
} from "../../../lib/types";
import type {
  ThreadComposerShellPendingSteerRowModel,
  ThreadComposerShellQueuedFollowUpRowModel,
} from "../thread-stage-types";

function resolveComposerFollowUpDisplayText(prompt: string): string {
  return prompt.trim();
}

export function buildComposerPendingSteerRows(
  pendingSteers: CodexPendingSteer[],
): ThreadComposerShellPendingSteerRowModel[] {
  return pendingSteers.map((entry) => ({
    steerId: entry.steerId,
    threadId: entry.threadId,
    turnId: entry.turnId,
    prompt: entry.prompt,
    displayText: resolveComposerFollowUpDisplayText(entry.prompt),
  }));
}

export function buildComposerQueuedFollowUpRows(
  queuedFollowUps: CodexQueuedFollowUp[],
): ThreadComposerShellQueuedFollowUpRowModel[] {
  return queuedFollowUps.map((entry) => ({
    followUpId: entry.followUpId,
    threadId: entry.threadId,
    prompt: entry.prompt,
    displayText: resolveComposerFollowUpDisplayText(entry.prompt),
    collaborationMode: entry.collaborationMode ?? null,
    pausedReason: entry.pausedReason ?? null,
  }));
}
