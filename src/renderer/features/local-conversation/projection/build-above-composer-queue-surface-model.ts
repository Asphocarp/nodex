import type { CodexConversationSnapshot } from "../../../lib/types";
import type {
  AboveComposerQueueSurfaceEntryModel,
  AboveComposerQueueSurfaceModel,
  AboveComposerQueueSurfacePendingSteerModel,
  AboveComposerQueueSurfaceQueuedFollowUpModel,
} from "../thread-stage-types";

interface BuildAboveComposerQueueSurfaceModelInput {
  conversation: CodexConversationSnapshot | null;
}

export function buildAboveComposerQueueSurfaceModel(
  input: BuildAboveComposerQueueSurfaceModelInput,
): AboveComposerQueueSurfaceModel | null {
  const conversation = input.conversation;
  if (!conversation?.threadId) return null;

  const entries: AboveComposerQueueSurfaceEntryModel[] = [
    ...conversation.pendingSteers.map((steer) => ({
      kind: "pendingSteer",
      steer,
    } satisfies AboveComposerQueueSurfacePendingSteerModel)),
    ...conversation.queuedFollowUps.map((followUp) => ({
      kind: "queuedFollowUp",
      followUp,
    } satisfies AboveComposerQueueSurfaceQueuedFollowUpModel)),
  ];

  if (entries.length === 0) return null;
  return { entries };
}
