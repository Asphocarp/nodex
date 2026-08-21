import { ShortcutKeycaps } from "@/components/ui/shortcut-keycaps";
import type {
  StageThreadsComposerFollowUpAction,
  StageThreadsComposerSubmitAction,
} from "../shared/composer-action";

interface ComposerActionTooltipContentProps {
  action: "send" | "stop" | "resume";
  primarySubmitAction: StageThreadsComposerSubmitAction | null;
  alternateSubmitAction: StageThreadsComposerFollowUpAction | null;
  isThreadRunning: boolean;
  primaryShortcutKeys: readonly string[];
  alternateShortcutKeys: readonly string[];
}

export function ComposerActionTooltipContent(input: ComposerActionTooltipContentProps) {
  if (input.action === "stop") return "Stop";
  if (input.action === "resume") return "Resume";
  if (
    !input.isThreadRunning ||
    input.primarySubmitAction === "send" ||
    !input.alternateSubmitAction
  ) {
    return "Send";
  }

  const primaryAction: StageThreadsComposerFollowUpAction =
    input.primarySubmitAction === "queue" ? "queue" : "steer";

  return (
    <div className="grid grid-cols-[auto_auto] items-center gap-x-2 gap-y-1">
      <span className="text-token-foreground">
        {formatComposerSubmitActionLabel(primaryAction)}
      </span>
      <span className="justify-self-end">
        <ShortcutKeycaps keys={input.primaryShortcutKeys} />
      </span>
      <span className="text-token-foreground">
        {formatComposerSubmitActionLabel(input.alternateSubmitAction)}
      </span>
      <span className="justify-self-end">
        <ShortcutKeycaps keys={input.alternateShortcutKeys} />
      </span>
    </div>
  );
}

function formatComposerSubmitActionLabel(action: StageThreadsComposerFollowUpAction) {
  return action === "queue" ? "Queue" : "Steer";
}
