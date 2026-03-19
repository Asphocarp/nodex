import { resolveThreadInProgressFollowUpMode } from "@/lib/thread-composer-follow-up-mode";

export type StageThreadsBusyAction = "send" | "interrupt" | "login" | "refresh" | "logout" | null;
export type StageThreadsComposerAction = "send" | "stop";
export type StageThreadsComposerSubmitAction = "send" | "queue" | "steer";

interface ResolveComposerActionInput {
  canSendPrompt: boolean;
  isThreadRunning: boolean;
  busyAction: StageThreadsBusyAction;
  hasDraftContent: boolean;
  isQueueingEnabled: boolean;
}

interface ResolvedComposerActionState {
  action: StageThreadsComposerAction;
  submitAction: StageThreadsComposerSubmitAction | null;
  alternateInProgressSubmitAction: Exclude<StageThreadsComposerSubmitAction, "send"> | null;
  label: "Send prompt" | "Stop Codex" | "Queue follow-up" | "Steer follow-up";
  disabled: boolean;
}

export function resolveStageThreadsComposerActionState(
  input: ResolveComposerActionInput,
): ResolvedComposerActionState {
  if (input.isThreadRunning && !input.hasDraftContent) {
    return {
      action: "stop",
      submitAction: null,
      alternateInProgressSubmitAction: null,
      label: "Stop Codex",
      disabled: !input.canSendPrompt || input.busyAction === "interrupt",
    };
  }

  const submitAction = input.isThreadRunning
    ? resolveThreadInProgressFollowUpMode({ isQueueingEnabled: input.isQueueingEnabled })
    : "send";

  return {
    action: "send",
    submitAction,
    alternateInProgressSubmitAction: input.isThreadRunning
      ? resolveThreadInProgressFollowUpMode({
          invertInProgressFollowUpMode: true,
          isQueueingEnabled: input.isQueueingEnabled,
        })
      : null,
    label: submitAction === "queue"
      ? "Queue follow-up"
      : submitAction === "steer"
        ? "Steer follow-up"
        : "Send prompt",
    disabled: !input.canSendPrompt || input.busyAction !== null || !input.hasDraftContent,
  };
}
