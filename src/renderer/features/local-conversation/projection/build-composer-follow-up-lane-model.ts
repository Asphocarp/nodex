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
  void pendingSteers;
  return [];
}

export function buildComposerQueuedFollowUpRows(
  queuedFollowUps: CodexQueuedFollowUp[],
): ThreadComposerShellQueuedFollowUpRowModel[] {
  return queuedFollowUps.map((entry) => ({
    followUpId: entry.followUpId,
    threadId: entry.threadId,
    prompt: entry.prompt,
    ...(entry.promptInput ? { promptInput: entry.promptInput } : {}),
    displayText: resolveComposerFollowUpDisplayText(entry.prompt),
    collaborationMode: entry.collaborationMode ?? null,
    pausedReason: entry.pausedReason ?? null,
  }));
}
