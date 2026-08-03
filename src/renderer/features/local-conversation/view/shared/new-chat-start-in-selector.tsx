import { CloudOff } from "@/components/shared/icons/generic-icons";
import { type ReactElement, type ReactNode } from "react";
import {
  LocalStatusIcon,
  WorktreeStatusIcon,
} from "@/components/shared/icons";
import {
  NodexDropdownButtonTrigger,
  NodexDropdownItem,
  NodexDropdownMenu,
  NodexDropdownSelectedIcon,
  NodexDropdownTitle,
  type NodexDropdownContentWidth,
  type NodexDropdownMenuProps,
} from "@/components/ui/dropdown";
import { NodexTooltip } from "@/components/ui/tooltip";
import {
  getNewChatStartInTriggerIconKey,
  getNewChatStartInTriggerLabel,
  resolveNewChatStartInOptions,
  type NewChatStartInIconKey,
} from "@/lib/new-chat-start-in-selector";
import { cn } from "@/lib/utils";
import type { NewChatStartInSelectorModel, ThreadStageActions } from "../../thread-stage-types";

interface NewChatStartInSelectorProps {
  model: NewChatStartInSelectorModel;
  actions: Pick<ThreadStageActions, "onNewThreadStartInTargetChange">;
  disabled?: boolean;
  worktreeAvailable: boolean;
  renderTrigger?: (state: NewChatStartInTriggerRenderState) => ReactElement;
  side?: NodexDropdownMenuProps["side"];
  align?: NodexDropdownMenuProps["align"];
  sideOffset?: number;
  contentWidth?: NodexDropdownContentWidth;
  contentClassName?: string;
  menuTitle?: ReactNode;
  tooltipContent?: string;
}

export interface NewChatStartInTriggerRenderState {
  triggerLabel: string;
  iconKey: NewChatStartInIconKey;
  title: string;
  disabled: boolean;
}

export function NewChatStartInSelector({
  model,
  actions,
  disabled = false,
  worktreeAvailable,
  renderTrigger,
  side = "top",
  align = "start",
  sideOffset = 8,
  contentWidth = "workspace",
  contentClassName = "w-[320px] max-w-[calc(100vw-2rem)]",
  menuTitle = "Start in",
  tooltipContent = "Select start location",
}: NewChatStartInSelectorProps) {
  const selectorDisabled = disabled || model.disabled || !actions.onNewThreadStartInTargetChange;
  const options = resolveNewChatStartInOptions({
    selectedRunInTarget: model.target.runInTarget,
    worktreeAvailable: model.worktreeAvailable && worktreeAvailable,
    cloudAvailable: false,
  }).filter((option) => option.value !== "cloud");
  const triggerIconKey = getNewChatStartInTriggerIconKey(model.target.runInTarget);
  const triggerLabel = getNewChatStartInTriggerLabel(model.target.runInTarget);
  const triggerButton = renderTrigger
    ? renderTrigger({
        triggerLabel,
        iconKey: triggerIconKey,
        title: "Select where to run the task",
        disabled: selectorDisabled,
      })
    : (
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
          {triggerLabel}
        </span>
      </NodexDropdownButtonTrigger>
    );

  const menu = (
    <NodexDropdownMenu
      disabled={selectorDisabled}
      side={side}
      align={align}
      sideOffset={sideOffset}
      contentWidth={contentWidth}
      contentClassName={contentClassName}
      triggerButton={triggerButton}
    >
      <NodexDropdownTitle>{menuTitle}</NodexDropdownTitle>

      {options.map((option) => (
        <NodexDropdownItem
          key={option.value}
          leftSlot={<StartInIcon iconKey={option.iconKey} className="size-3.5 text-token-description-foreground" />}
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
    </NodexDropdownMenu>
  );

  if (renderTrigger) return menu;

  return (
    <NodexTooltip tooltipContent={tooltipContent} side="bottom">
      <div className="inline-flex w-fit max-w-full">
        {menu}
      </div>
    </NodexTooltip>
  );
}

export function StartInIcon({
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
