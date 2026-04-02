import { ShortcutKeycaps } from "@/components/ui/shortcut-keycaps";
import type { StageThreadsComposerSubmitAction } from "../shared/composer-action";

interface ComposerActionTooltipContentProps {
  action: "send" | "stop";
  submitAction: StageThreadsComposerSubmitAction | null;
  alternateInProgressSubmitAction: Exclude<StageThreadsComposerSubmitAction, "send"> | null;
  isThreadRunning: boolean;
  primaryShortcutKeys: readonly string[];
  alternateShortcutKeys: readonly string[];
}

export function ComposerActionTooltipContent(input: ComposerActionTooltipContentProps) {
  if (input.action === "stop") return "Stop";
  if (!input.isThreadRunning || input.submitAction === "send" || !input.alternateInProgressSubmitAction) {
    return "Send";
  }

  const primaryAction: Exclude<StageThreadsComposerSubmitAction, "send"> =
    input.submitAction === "queue" ? "queue" : "steer";

  return (
    <div className="grid grid-cols-[auto_auto] items-center gap-x-2 gap-y-1">
      <span className="text-token-foreground">
        {formatComposerSubmitActionLabel(primaryAction)}
      </span>
      <span className="justify-self-end">
        <ShortcutKeycaps keys={input.primaryShortcutKeys} />
      </span>
      <span className="text-token-foreground">
        {formatComposerSubmitActionLabel(input.alternateInProgressSubmitAction)}
      </span>
      <span className="justify-self-end">
        <ShortcutKeycaps keys={input.alternateShortcutKeys} />
      </span>
    </div>
  );
}

function formatComposerSubmitActionLabel(action: Exclude<StageThreadsComposerSubmitAction, "send">) {
  return action === "queue" ? "Queue" : "Steer";
}
