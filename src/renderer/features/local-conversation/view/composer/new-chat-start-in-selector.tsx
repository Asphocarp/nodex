import { CloudOff, ExternalLink } from "lucide-react";
import {
  LocalStatusIcon,
  WorktreeStatusIcon,
} from "@/components/shared/icons";
import {
  getNewChatStartInTriggerIconKey,
  getNewChatStartInTriggerLabel,
  resolveNewChatStartInOptions,
  type NewChatStartInIconKey,
} from "@/lib/new-chat-start-in-selector";
import { cn } from "@/lib/utils";
import type { ThreadStageActions, NewChatStartInSelectorModel } from "../../thread-stage-types";
import {
  NodexDropdownButtonTrigger,
  NodexDropdownItem,
  NodexDropdownMenu,
  NodexDropdownSelectedIcon,
  NodexDropdownSeparator,
  NodexDropdownTitle,
  NodexTooltip,
} from "./local-conversation-thread-composer-deps";

interface NewChatStartInSelectorProps {
  model: NewChatStartInSelectorModel;
  actions: ThreadStageActions;
  disabled?: boolean;
  worktreeAvailable: boolean;
}

export function NewChatStartInSelector({
  model,
  actions,
  disabled = false,
  worktreeAvailable,
}: NewChatStartInSelectorProps) {
  const selectorDisabled = disabled || model.disabled || !actions.onNewThreadStartInTargetChange;
  const options = resolveNewChatStartInOptions({
    selectedRunInTarget: model.target.runInTarget,
    worktreeAvailable: model.worktreeAvailable && worktreeAvailable,
    cloudAvailable: false,
  });
  const triggerIconKey = getNewChatStartInTriggerIconKey(model.target.runInTarget);

  return (
    <NodexTooltip tooltipContent="Select start location" side="bottom">
      <div className="inline-flex w-fit max-w-full">
        <NodexDropdownMenu
          disabled={selectorDisabled}
          side="top"
          align="start"
          sideOffset={8}
          contentWidth="workspace"
          contentClassName="w-[320px] max-w-[calc(100vw-2rem)]"
          triggerButton={(
            <NodexDropdownButtonTrigger
              size="sm"
              shape="pill"
              muted
              chrome="transparent"
              disabled={selectorDisabled}
              aria-label="Start in"
              data-new-chat-start-in-trigger="true"
              className="max-w-full px-1.5 text-token-text-tertiary hover:text-token-foreground"
            >
              <StartInIcon iconKey={triggerIconKey} />
              <span className="max-w-40 truncate whitespace-nowrap text-left">
                {getNewChatStartInTriggerLabel(model.target.runInTarget)}
              </span>
            </NodexDropdownButtonTrigger>
          )}
        >
          <NodexDropdownTitle>Start in</NodexDropdownTitle>

          {options.slice(0, 2).map((option) => (
            <NodexDropdownItem
              key={option.value}
              leftSlot={<StartInIcon iconKey={option.iconKey} className="text-token-description-foreground" />}
              rightSlot={option.selected ? <NodexDropdownSelectedIcon /> : null}
              disabled={option.disabled}
              tooltipText={option.tooltipText}
              tooltipSide="right"
              onSelect={() => {
                actions.onNewThreadStartInTargetChange?.({
                  ...model.target,
                  runInTarget: option.value,
                });
              }}
              data-new-chat-start-in-option={option.value}
              data-selected={option.selected ? "true" : undefined}
              className={cn(option.selected && "text-token-foreground")}
            >
              {option.label}
            </NodexDropdownItem>
          ))}

          <NodexDropdownItem
            leftSlot={<ExternalLink className="icon-xs text-token-description-foreground" />}
            rightSlot={<ExternalLink className="icon-2xs text-token-description-foreground" />}
            onSelect={() => {
              window.open("https://chatgpt.com/codex", "_blank", "noopener,noreferrer");
            }}
            data-new-chat-start-in-connect-web="true"
          >
            Connect Codex web
          </NodexDropdownItem>

          {options.slice(2).map((option) => (
            <NodexDropdownItem
              key={option.value}
              leftSlot={<StartInIcon iconKey={option.iconKey} className="text-token-description-foreground" />}
              rightSlot={option.selected ? <NodexDropdownSelectedIcon /> : null}
              disabled={option.disabled}
              tooltipText={option.tooltipText}
              tooltipSide="right"
              data-new-chat-start-in-option={option.value}
              data-selected={option.selected ? "true" : undefined}
            >
              {option.label}
            </NodexDropdownItem>
          ))}

          <NodexDropdownSeparator />
          <NodexDropdownItem
            rightSlot={<ExternalLink className="icon-2xs text-token-description-foreground" />}
            onSelect={() => {
              window.open("https://help.openai.com/en/articles/11369540-codex-in-chatgpt", "_blank", "noopener,noreferrer");
            }}
            data-new-chat-start-in-learn-more="true"
          >
            Learn more
          </NodexDropdownItem>
        </NodexDropdownMenu>
      </div>
    </NodexTooltip>
  );
}

function StartInIcon({
  iconKey,
  className,
}: {
  iconKey: NewChatStartInIconKey;
  className?: string;
}) {
  if (iconKey === "worktree") return <WorktreeStatusIcon className={className} />;
  if (iconKey === "cloud") return <CloudOff className={cn("icon-xs", className)} />;
  return <LocalStatusIcon className={className} />;
}
