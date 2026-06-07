import { useMemo, useState } from "react";
import { Folder, FolderPlus } from "lucide-react";
import {
  filterNewChatProjectSelectorOptions,
  resolveSelectedNewChatProjectSelectorOption,
} from "@/lib/new-chat-project-selector";
import { cn } from "@/lib/utils";
import type { NewChatProjectSelectorModel, ThreadStageActions } from "../../thread-stage-types";
import {
  NodexDropdownButtonTrigger,
  NodexDropdownItem,
  NodexDropdownMenu,
  NodexDropdownMessage,
  NodexDropdownScrollList,
  NodexDropdownSearchInput,
  NodexDropdownSection,
  NodexDropdownSelectedIcon,
  NodexDropdownSeparator,
  NodexTooltip,
} from "./local-conversation-thread-composer-deps";

interface NewChatProjectSelectorProps {
  model: NewChatProjectSelectorModel;
  actions: ThreadStageActions;
  disabled?: boolean;
}

export function NewChatProjectSelector({
  model,
  actions,
  disabled = false,
}: NewChatProjectSelectorProps) {
  const [search, setSearch] = useState("");
  const selectedOption = resolveSelectedNewChatProjectSelectorOption(model.projects, model.selectedProjectId);
  const filteredOptions = useMemo(
    () => filterNewChatProjectSelectorOptions(model.projects, search),
    [model.projects, search],
  );
  const selectorDisabled = disabled || model.disabled || !actions.onNewThreadProjectChange;
  const triggerLabel = selectedOption?.label ?? "Work in a project";

  return (
    <NodexTooltip tooltipContent="Select project" side="bottom">
      <div className="inline-flex w-fit max-w-full">
        <NodexDropdownMenu
          disabled={selectorDisabled}
          side="bottom"
          align="start"
          contentWidth="workspace"
          contentMaxHeight="tall"
          contentClassName="w-96 max-w-[calc(100vw-2rem)]"
          triggerButton={(
            <NodexDropdownButtonTrigger
              size="sm"
              shape="pill"
              muted
              chrome="transparent"
              disabled={selectorDisabled}
              aria-label="Select project"
              data-new-chat-project-selector-trigger="true"
              className="max-w-full px-1.5 text-token-text-tertiary hover:text-token-foreground"
            >
              <Folder className="icon-xs" />
              <span className="max-w-40 truncate whitespace-nowrap text-left">{triggerLabel}</span>
            </NodexDropdownButtonTrigger>
          )}
        >
          <NodexDropdownSection className="flex min-w-0 flex-col overflow-hidden">
            <NodexDropdownSearchInput
              value={search}
              placeholder="Search projects"
              onChange={(event) => setSearch(event.currentTarget.value)}
              data-new-chat-project-search="true"
            />
            <NodexDropdownScrollList className="vertical-scroll-fade-mask max-h-[calc((1lh+var(--padding-row-y)*2)*5)]">
              {filteredOptions.length === 0 ? (
                <NodexDropdownMessage compact>No folders found</NodexDropdownMessage>
              ) : (
                filteredOptions.map((option) => {
                  const selected = option.id === model.selectedProjectId;
                  return (
                    <NodexDropdownItem
                      key={option.id}
                      leftSlot={<Folder className="icon-xs text-token-description-foreground" />}
                      rightSlot={selected ? <NodexDropdownSelectedIcon /> : null}
                      subText={option.description}
                      tooltipText={option.workspacePath ?? undefined}
                      onSelect={() => {
                        actions.onNewThreadProjectChange?.(option.id);
                      }}
                      data-new-chat-project-option={option.id}
                      data-selected={selected ? "true" : undefined}
                      className={cn(selected && "text-token-foreground")}
                    >
                      {option.label}
                    </NodexDropdownItem>
                  );
                })
              )}
            </NodexDropdownScrollList>
          </NodexDropdownSection>

          {model.canAddProject && actions.onRequestNewChatProjectCreate ? (
            <>
              <NodexDropdownSeparator />
              <NodexDropdownItem
                leftSlot={<FolderPlus className="icon-xs text-token-description-foreground" />}
                onSelect={() => {
                  actions.onRequestNewChatProjectCreate?.();
                }}
                data-new-chat-project-add="true"
              >
                Add new project
              </NodexDropdownItem>
            </>
          ) : null}
        </NodexDropdownMenu>
      </div>
    </NodexTooltip>
  );
}
