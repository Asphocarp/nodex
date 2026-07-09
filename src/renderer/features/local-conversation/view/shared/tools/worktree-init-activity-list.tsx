import type { ReactNode } from "react";
import {
  CodexThreadIcon,
  WorktreeStatusIcon,
} from "@/components/shared/icons";
import type { CodexWorktreeInitActivity } from "@/lib/codex-worktree-init-activity";
import { codexWorktreeInitActivityLabel } from "@/lib/codex-worktree-init-activity";
import { cn } from "@/lib/utils";
import { CodexShimmerText } from "../codex-shimmer-text";
import { ThreadCommandShellBlock } from "./thread-command-shell-block";
import { ThreadActivityDisclosure } from "./tool-primitives";

function WorktreeSetupStatusIcon({ className }: { className?: string }) {
  return (
    <svg
      aria-hidden="true"
      className={className}
      width="10"
      height="10"
      viewBox="0 0 10 10"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path
        d="M8.13037 3.71927L5.33252 5.20023V8.42289L7.89697 6.94242L7.94873 6.90775C8.06253 6.82002 8.13037 6.68363 8.13037 6.53763V3.71927ZM5.23389 1.52005C5.10743 1.44704 4.95515 1.43799 4.82227 1.49271L4.7666 1.52005L2.16309 3.0225L5.00488 4.62113L7.92383 3.07572L7.89697 3.05765L5.23389 1.52005ZM1.86963 6.53763C1.86963 6.70452 1.95852 6.85894 2.10303 6.94242L4.66748 8.4224V5.19437L1.86963 3.62015V6.53763ZM8.79541 6.53763C8.79541 6.91694 8.60593 7.26936 8.29346 7.47855L8.22949 7.5181L5.56641 9.0557C5.23795 9.24533 4.83786 9.2573 4.50049 9.09134L4.43408 9.0557L1.77051 7.5181C1.42032 7.31582 1.20459 6.94206 1.20459 6.53763V3.46244C1.20459 3.05801 1.42032 2.68425 1.77051 2.48197L4.43408 0.94437L4.50049 0.908726C4.83786 0.742764 5.23795 0.754738 5.56641 0.94437L8.22949 2.48197L8.29346 2.52152C8.60593 2.7307 8.79541 3.08313 8.79541 3.46244V6.53763Z"
        fill="currentColor"
      />
    </svg>
  );
}

function WorktreeInitActivityIcon({
  activity,
  worktreeIcon,
}: {
  activity: CodexWorktreeInitActivity;
  worktreeIcon: ReactNode;
}) {
  const className = cn(
    "icon-xs shrink-0",
    activity.status === "failed"
      ? "text-token-editor-error-foreground"
      : "text-token-conversation-body",
  );

  if (activity.kind === "worktree") {
    if (worktreeIcon !== null) return worktreeIcon;
    return <WorktreeStatusIcon className={className} />;
  }
  if (activity.kind === "setup") {
    return <WorktreeSetupStatusIcon className={className} />;
  }
  return <CodexThreadIcon className={className} />;
}

function RunningConversationActivity({ activity }: { activity: CodexWorktreeInitActivity }) {
  return (
    <div className="mt-3 min-w-0">
      <CodexShimmerText className="text-size-chat leading-[calc(var(--codex-chat-font-size)_+_8px)] truncate select-none">
        {codexWorktreeInitActivityLabel(activity)}
      </CodexShimmerText>
    </div>
  );
}

export interface WorktreeInitActivityListProps {
  activities: readonly CodexWorktreeInitActivity[];
  actions?: ReactNode;
  worktreeIcon?: ReactNode;
}

export function WorktreeInitActivityList({
  activities,
  actions = null,
  worktreeIcon = null,
}: WorktreeInitActivityListProps) {
  const actionTargetId = actions === null ? null : (activities.at(-1)?.id ?? null);

  return (
    <div className="flex w-full max-w-3xl flex-col gap-2">
      {activities.map((activity) => {
        if (activity.kind === "conversation" && activity.status === "running") {
          return <RunningConversationActivity key={activity.id} activity={activity} />;
        }

        const isActionTarget = activity.id === actionTargetId;
        const footer = isActionTarget ? (
          <div
            className={cn(
              "flex items-center justify-end gap-2",
              activity.outputText.length > 0 && "px-3 pb-3",
            )}
          >
            {actions}
          </div>
        ) : null;
        const body = activity.outputText.length > 0 ? (
          <ThreadCommandShellBlock
            command=""
            output={activity.outputText}
            isInProgress={activity.status === "running"}
            embeddedAppearance="plain"
            footer={footer}
            variant="embedded"
          />
        ) : footer;

        return (
          <ThreadActivityDisclosure
            key={`${activity.id}:${isActionTarget}`}
            bodyClassName="flex flex-col gap-2 pt-2 pb-1"
            canExpand={body !== null}
            defaultExpanded={isActionTarget}
            icon={(
              <WorktreeInitActivityIcon
                activity={activity}
                worktreeIcon={activity.kind === "worktree" ? worktreeIcon : null}
              />
            )}
            summary={(
              <CodexShimmerText active={activity.status === "running"}>
                {codexWorktreeInitActivityLabel(activity)}
              </CodexShimmerText>
            )}
          >
            {body}
          </ThreadActivityDisclosure>
        );
      })}
    </div>
  );
}
