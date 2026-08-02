import { useMemo, useState } from "react";
import { FolderPlus } from "lucide-react";
import { ProjectMarker } from "@/components/workbench/project-marker";
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
  variant?: "footer" | "heading";
}

export function NewChatProjectSelector({
  model,
  actions,
  disabled = false,
  variant = "footer",
}: NewChatProjectSelectorProps) {
  const [search, setSearch] = useState("");
  const selectedOption = resolveSelectedNewChatProjectSelectorOption(model.projects, model.selectedProjectId);
  const filteredOptions = useMemo(
    () => filterNewChatProjectSelectorOptions(model.projects, search),
    [model.projects, search],
  );
  const selectorDisabled = disabled || model.disabled || !actions.onNewThreadProjectChange;
  const triggerLabel = selectedOption?.label ?? "Work in a project";
  const menuContent = (
    <ProjectSelectorMenuContent
      model={model}
      actions={actions}
      search={search}
      setSearch={setSearch}
      filteredOptions={filteredOptions}
    />
  );

  if (variant === "heading") {
    return (
      <NodexDropdownMenu
        disabled={selectorDisabled}
        side="bottom"
        align="center"
        contentWidth="workspace"
        contentMaxHeight="tall"
        contentClassName="w-96 max-w-[calc(100vw-2rem)]"
        triggerButton={(
          <button
            type="button"
            aria-label="Select project"
            data-new-chat-project-selector-trigger="true"
            className="outline-hidden cursor-interaction relative z-0 inline-block whitespace-pre after:absolute after:-inset-x-1.5 after:-inset-y-0 after:-z-10 after:rounded-xl after:content-[''] group-hover/title:after:bg-token-foreground/5 hover:after:bg-token-foreground/10 data-[state=open]:after:bg-token-foreground/5 data-[state=open]:hover:after:bg-token-foreground/10 disabled:cursor-not-allowed disabled:opacity-50"
            disabled={selectorDisabled}
          >
            {triggerLabel}
          </button>
        )}
      >
        {menuContent}
      </NodexDropdownMenu>
    );
  }

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
              {selectedOption ? (
                <ProjectMarker
                  appearance={selectedOption.appearance}
                  className="size-4"
                />
              ) : null}
              <span className="max-w-40 truncate whitespace-nowrap text-left">{triggerLabel}</span>
            </NodexDropdownButtonTrigger>
          )}
        >
          {menuContent}
        </NodexDropdownMenu>
      </div>
    </NodexTooltip>
  );
}

function ProjectSelectorMenuContent({
  model,
  actions,
  search,
  setSearch,
  filteredOptions,
}: {
  model: NewChatProjectSelectorModel;
  actions: ThreadStageActions;
  search: string;
  setSearch: (value: string) => void;
  filteredOptions: ReturnType<typeof filterNewChatProjectSelectorOptions>;
}) {
  return (
    <>
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
                  leftSlot={(
                    <ProjectMarker
                      appearance={option.appearance}
                      className="size-4 text-token-description-foreground"
                    />
                  )}
                  rightSlot={selected ? <NodexDropdownSelectedIcon /> : null}
                  subText={option.description}
                  tooltipText={option.primaryWorkspaceRoot ?? undefined}
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
    </>
  );
}
