import { BranchSelectorPopover } from "@/features/local-conversation/view/shared/branch-selector-popover";
import { EnvironmentSelectorPopover } from "@/features/local-conversation/view/shared/environment-selector-popover";
import { ThreadsIcon } from "@/components/workbench/threads-icon";
import {
  NodexDropdownButtonTrigger,
  NodexDropdownChoiceMenu,
} from "@/components/ui/dropdown";
import { SchedulePopover } from "@/components/board/schedule-popover";
import { dataSourcePropertyIcon } from "@/components/database/data-source-property-presentation";
import { ChevronDownIcon } from "@/components/shared/icons";
import { cn } from "@/lib/utils";
import type { PageRunInTarget } from "@/lib/types";
import { PageStageDataSourcePropertyControl } from "./data-source-property-control";
import {
  pageStagePropertyTriggerChrome,
  pageStagePropertyValueHoverSurface,
} from "./property-value-styles";
import type { PageStageController } from "./use-page-stage-controller";

interface PageStagePropertiesSectionProps {
  readonly controller: PageStageController;
}

function ThreadsPropertyRow({ controller }: PageStagePropertiesSectionProps) {
  const {
    runInTarget,
    runInLocalPathDisplay,
    runInWorktreePathDisplay,
    runInEnvironmentPath,
    runInBranchState,
    runInBranchBusy,
    runInEnvironmentOptions,
    runInEnvironmentBusy,
    selectedRunInBaseBranch,
    linkedCodexThreads,
    onOpenCodexThread,
    onOpenNewCodexThread,
    saving,
    handleRunInTargetChange,
    handlePickRunInLocalPath,
    handleClearRunInLocalPath,
    handleResetRunInWorktreePath,
    refreshRunInBranchState,
    handleSelectRunInBaseBranch,
    refreshRunInEnvironmentOptions,
    handleSelectRunInEnvironmentPath,
    handleOpenEnvironmentSettings,
    handleOpenCodexThread,
  } = controller;
  return (
    <div className="space-y-1.5">
      <div className="flex min-h-7.5 items-center">
        <div className="flex w-40 shrink-0 items-center gap-1.5 pl-1.5">
          <div className="flex w-5 items-center justify-center text-(--foreground-secondary)">
            <ThreadsIcon />
          </div>
          <span className="text-sm/5 text-(--foreground-secondary)">Threads</span>
        </div>
        <div className="flex min-w-0 flex-1 items-center gap-2 px-2">
          <NodexDropdownChoiceMenu
            value={runInTarget}
            onValueChange={(value) => {
              void handleRunInTargetChange(value as PageRunInTarget);
            }}
            options={[
              { value: "localProject", label: "Local project" },
              { value: "newWorktree", label: runInWorktreePathDisplay ? "Worktree" : "New worktree" },
              { value: "cloud", label: "Cloud (mock)" },
            ]}
            triggerButton={(
              <NodexDropdownButtonTrigger className={cn(
                pageStagePropertyTriggerChrome,
                pageStagePropertyValueHoverSurface,
                "gap-1 px-0",
              )}>
                <span className="inline-flex h-5 items-center rounded-sm bg-(--gray-bg) px-1.5 text-xs text-(--foreground-secondary)">
                  {runInTarget === "localProject"
                    ? "Local project"
                    : runInTarget === "newWorktree"
                      ? runInWorktreePathDisplay ? "Worktree" : "New worktree"
                      : "Cloud (mock)"}
                </span>
              </NodexDropdownButtonTrigger>
            )}
          />

          {runInTarget === "localProject" ? (
            <>
              <button
                type="button"
                onClick={() => void handlePickRunInLocalPath()}
                className="inline-flex h-5 max-w-full items-center rounded-xs border-[0.5px] border-(--border) px-1.5 text-xs text-(--foreground-secondary) hover:bg-(--background-tertiary)"
                title={runInLocalPathDisplay || "Use project workspace path"}
              >
                <span className="truncate">{runInLocalPathDisplay || "Project cwd"}</span>
              </button>
              {runInLocalPathDisplay ? (
                <button
                  type="button"
                  onClick={handleClearRunInLocalPath}
                  className="text-xs text-(--foreground-tertiary) hover:text-(--foreground-secondary)"
                >Clear</button>
              ) : null}
            </>
          ) : null}

          {runInTarget === "newWorktree" && !runInWorktreePathDisplay ? (
            <>
              <BranchSelectorPopover
                cwd={controller.projectWorkspacePath?.trim() || null}
                state={runInBranchState}
                busy={runInBranchBusy}
                selectedBranch={selectedRunInBaseBranch}
                onRefresh={async () => {
                  await refreshRunInBranchState();
                }}
                onCheckout={handleSelectRunInBaseBranch}
                triggerClassName="h-6"
              />
              <EnvironmentSelectorPopover
                options={runInEnvironmentOptions}
                selectedPath={runInEnvironmentPath}
                busy={runInEnvironmentBusy}
                onRefresh={refreshRunInEnvironmentOptions}
                onSelect={handleSelectRunInEnvironmentPath}
                onOpenSettings={handleOpenEnvironmentSettings}
                triggerClassName="h-6"
              />
            </>
          ) : null}

          {runInTarget === "newWorktree" && runInWorktreePathDisplay ? (
            <button
              type="button"
              onClick={handleResetRunInWorktreePath}
              className="inline-flex h-5 items-center rounded-xs border-[0.5px] border-(--border) px-1.5 text-xs text-(--foreground-secondary) hover:bg-(--background-tertiary)"
              title={runInWorktreePathDisplay}
            >Reset worktree</button>
          ) : null}

          {linkedCodexThreads.length > 0 ? (
            <span className="inline-flex h-5 items-center rounded-xs bg-(--blue-bg) px-1.5 text-xs text-(--blue-text)">
              {linkedCodexThreads.length} linked
            </span>
          ) : null}
          {onOpenNewCodexThread ? (
            <button
              type="button"
              onClick={onOpenNewCodexThread}
              disabled={saving}
              className="inline-flex h-5 items-center rounded-xs border-[0.5px] border-(--border) px-1.5 text-xs text-(--foreground-secondary) hover:bg-(--background-tertiary) disabled:opacity-40"
            >New</button>
          ) : null}
        </div>
      </div>

      {runInTarget === "cloud" ? (
        <p className="ml-40 px-2 text-xs text-(--foreground-tertiary)">
          Mock UI only. Starting new threads is blocked for Cloud.
        </p>
      ) : null}
      {linkedCodexThreads.length > 0 ? (
        <div className="ml-40 max-h-33 space-y-1 overflow-y-auto px-2 pr-0.5">
          {linkedCodexThreads.map((thread) => (
            <button
              key={thread.threadId}
              type="button"
              disabled={!onOpenCodexThread}
              onClick={() => void handleOpenCodexThread(thread.threadId)}
              className="w-full rounded-sm bg-(--background-tertiary) px-2 py-1.5 text-left disabled:opacity-60"
            >
              <div className="truncate text-xs/4 text-(--foreground)">{thread.title}</div>
              {thread.preview ? (
                <div className="truncate text-xs/4 text-(--foreground-tertiary)">{thread.preview}</div>
              ) : null}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

export function PageStagePropertiesSection({ controller }: PageStagePropertiesSectionProps) {
  if (!controller.page) return null;
  const { propertyControls } = controller;
  const hasSectionRows = propertyControls.sectionProperties.length > 0
    || controller.hasThreadsRow
    || propertyControls.hasScheduleCapability;
  if (!hasSectionRows) return null;

  const isCollapsed = (propertyId: string): boolean => {
    if (propertyId === "tags") return controller.collapseTagsByDefault;
    if (propertyId === "assignee") return controller.collapseAssigneeByDefault;
    return false;
  };

  return (
    <section className="border-b-[0.5px] border-(--table-border) pb-3" aria-label="Properties">
      <div className="flex items-center gap-2 py-0.75 pl-1.5">
        <h2 className="text-base/4.5 font-medium text-(--foreground-secondary)">Properties</h2>
      </div>

      <div className="flex flex-col pb-1">
        {propertyControls.sectionProperties.map((item) => {
          if (!controller.showCollapsedProperties && isCollapsed(item.property.propertyId)) {
            return null;
          }
          const Icon = dataSourcePropertyIcon(item.property);
          return (
            <div key={item.property.propertyId} className="flex min-h-7.5 items-center">
              <div className="flex w-40 shrink-0 items-center gap-1.5 pl-1.5">
                <div className="flex w-5 items-center justify-center text-(--foreground-secondary)">
                  <Icon className="size-4 shrink-0" />
                </div>
                <span className="truncate text-sm/5 text-(--foreground-secondary)">
                  {item.property.name}
                </span>
              </div>
              <PageStageDataSourcePropertyControl
                item={item}
                controls={propertyControls}
                className="min-w-0 flex-1 px-2"
              />
            </div>
          );
        })}

        {controller.hasThreadsRow
          && (controller.showCollapsedProperties || !controller.collapseThreadsByDefault)
          ? <ThreadsPropertyRow controller={controller} />
          : null}

        {propertyControls.hasScheduleCapability
          && controller.schedulePage
          && (controller.showCollapsedProperties || !controller.collapseScheduleByDefault)
          ? <SchedulePopover schedule={controller.schedule} page={controller.schedulePage} />
          : null}
      </div>

      {controller.collapsedPropertyCount > 0 ? (
        <button
          type="button"
          onClick={() => controller.setPropertiesExpanded((current) => !current)}
          className="flex h-8 items-center gap-1.5 rounded-sm px-1.5 text-sm text-(--foreground-tertiary) hover:bg-(--background-tertiary)"
        >
          <ChevronDownIcon className={cn(
            "icon-2xs shrink-0 transition-transform duration-150",
            controller.propertiesExpanded ? "rotate-180" : "-rotate-90",
          )} />
          {controller.collapsedPropertyLabel}
        </button>
      ) : null}
    </section>
  );
}
