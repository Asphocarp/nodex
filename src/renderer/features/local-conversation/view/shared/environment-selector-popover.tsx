import { useCallback, useMemo, useState } from "react";
import { Star } from "@/components/shared/icons/generic-icons";
import { ActivitySpinnerIcon, CheckmarkIcon, ConfigStatusIcon } from "@/components/shared/icons";
import {
  NodexDropdownButtonTrigger,
  NodexDropdownItem,
  NodexDropdownMessage,
  NodexDropdownMenu,
  NodexDropdownSection,
  NodexDropdownTitle,
} from "@/components/ui/dropdown";
import { NodexTooltip } from "@/components/ui/tooltip";
import type { WorktreeEnvironmentConfigRecord, WorktreeEnvironmentOption } from "@/lib/types";
import { cn } from "@/lib/utils";

interface EnvironmentSelectorPopoverProps {
  configs?: WorktreeEnvironmentConfigRecord[];
  options?: WorktreeEnvironmentOption[];
  selectedPath?: string | null;
  defaultPath?: string | null;
  repairConfigPath?: string | null;
  needsAttention?: boolean;
  busy: boolean;
  error?: boolean;
  onRefresh: () => Promise<unknown>;
  onSelect: (environmentPath: string | null) => Promise<boolean> | boolean;
  onOpenSettings: (configPath?: string | null) => Promise<void> | void;
  disabled?: boolean;
  triggerClassName?: string;
  repositoryName?: string | null;
  showRepositoryName?: boolean;
  defaultOpen?: boolean;
}

function pathEquals(left: string | null | undefined, right: string | null | undefined): boolean {
  if (!left || !right) return false;
  return (
    left.replaceAll("\\", "/").replace(/\/+$/, "") ===
    right.replaceAll("\\", "/").replace(/\/+$/, "")
  );
}

export function EnvironmentSelectorPopover({
  configs,
  options,
  selectedPath,
  defaultPath,
  repairConfigPath,
  needsAttention = false,
  busy,
  error = false,
  onRefresh,
  onSelect,
  onOpenSettings,
  disabled = false,
  triggerClassName,
  repositoryName,
  showRepositoryName = false,
  defaultOpen = false,
}: EnvironmentSelectorPopoverProps) {
  const [open, setOpen] = useState(defaultOpen);
  const normalizedSelectedPath = selectedPath?.trim() || "";
  const resolvedConfigs = useMemo<WorktreeEnvironmentConfigRecord[]>(
    () =>
      configs ??
      options?.map((option) => ({
        configPath: option.path,
        fileName: option.path.split(/[\\/]/).at(-1) ?? option.name,
        state: "success",
        exists: true,
        name: option.name,
        hasSetupScript: option.hasSetupScript,
        hasCleanupScript: option.hasCleanupScript,
        actionCount: option.actionCount,
        parseErrorMessage: null,
        readErrorMessage: null,
        tooLargeMessage: null,
        environment: null,
      })) ??
      [],
    [configs, options],
  );
  const successfulConfigs = useMemo(
    () => resolvedConfigs.filter((config) => config.state === "success"),
    [resolvedConfigs],
  );
  const defaultConfig =
    successfulConfigs.find((config) => pathEquals(config.configPath, defaultPath)) ?? null;
  const listedConfigs = defaultConfig
    ? successfulConfigs.filter((config) => config.configPath !== defaultConfig.configPath)
    : successfulConfigs;
  const selectedConfig = successfulConfigs.find((config) =>
    pathEquals(config.configPath, normalizedSelectedPath),
  );
  const triggerLabel = busy
    ? "Loading environments…"
    : needsAttention
      ? "Needs attention"
      : (selectedConfig?.name ?? "No environment");
  const isDisabled = disabled;

  const handleOpenChange = useCallback(
    (nextOpen: boolean) => {
      setOpen(nextOpen);
      if (!nextOpen) return;
      void onRefresh();
    },
    [onRefresh],
  );

  const handleSelect = useCallback(
    async (environmentPath: string | null) => {
      const applied = await onSelect(environmentPath);
      if (!applied) return;
      setOpen(false);
    },
    [onSelect],
  );

  const title =
    showRepositoryName && repositoryName?.trim()
      ? `Environment · ${repositoryName.trim()}`
      : "Environment";

  return (
    <NodexDropdownMenu
      open={open}
      onOpenChange={handleOpenChange}
      side="top"
      align="start"
      disabled={isDisabled}
      triggerTooltipContent={triggerLabel}
      triggerButton={
        <NodexDropdownButtonTrigger
          aria-label="Select worktree environment"
          data-composer-navigation-target="environment"
          disabled={isDisabled}
          size="sm"
          chrome="transparent"
          shape="pill"
          muted
          className={cn("whitespace-nowrap px-1.5", triggerClassName)}
        >
          <span className="inline-flex min-w-0 items-center gap-1">
            <ConfigStatusIcon className="icon-xs shrink-0" />
            <span className="max-w-40 truncate text-sm">{triggerLabel}</span>
          </span>
        </NodexDropdownButtonTrigger>
      }
      contentClassName="p-0"
    >
      <div className="flex w-64 flex-col overflow-hidden">
        <NodexDropdownTitle>{title}</NodexDropdownTitle>
        <div className="vertical-scroll-fade-mask flex max-h-[220px] flex-col overflow-y-auto">
          {!busy && !error ? (
            <NodexDropdownItem
              onSelect={() => void handleSelect(null)}
              rightSlot={
                normalizedSelectedPath.length === 0 && !needsAttention ? (
                  <CheckmarkIcon className="icon-xs shrink-0" />
                ) : null
              }
            >
              Work without environment
            </NodexDropdownItem>
          ) : null}

          {defaultConfig ? (
            <NodexDropdownItem
              onSelect={() => void handleSelect(defaultConfig.configPath)}
              rightSlot={
                pathEquals(defaultConfig.configPath, normalizedSelectedPath) ? (
                  <CheckmarkIcon className="icon-xs shrink-0" />
                ) : null
              }
            >
              <span className="flex min-w-0 items-center gap-2">
                <NodexTooltip tooltipContent="Default environment">
                  <Star className="icon-xxs shrink-0 text-token-description-foreground" />
                </NodexTooltip>
                <span className="truncate">{defaultConfig.name}</span>
              </span>
            </NodexDropdownItem>
          ) : null}

          {busy ? (
            <div className="flex items-center justify-center py-4">
              <ActivitySpinnerIcon className="icon-xxs" />
            </div>
          ) : error ? (
            <NodexDropdownMessage compact tone="error">
              Error loading environments
            </NodexDropdownMessage>
          ) : listedConfigs.length > 0 ? (
            <NodexDropdownSection className="flex flex-col">
              {listedConfigs.map((config) => (
                <NodexDropdownItem
                  key={config.configPath}
                  onSelect={() => void handleSelect(config.configPath)}
                  rightSlot={
                    pathEquals(config.configPath, normalizedSelectedPath) ? (
                      <CheckmarkIcon className="icon-xs shrink-0" />
                    ) : null
                  }
                >
                  <span className="min-w-0 truncate">{config.name}</span>
                </NodexDropdownItem>
              ))}
            </NodexDropdownSection>
          ) : resolvedConfigs.length > 0 ? (
            <NodexDropdownMessage compact tone="error">
              Needs attention
            </NodexDropdownMessage>
          ) : (
            <NodexDropdownMessage compact>No environments found</NodexDropdownMessage>
          )}

          <NodexDropdownItem
            onSelect={() => {
              void onOpenSettings(repairConfigPath);
              setOpen(false);
            }}
            leftSlot={<ConfigStatusIcon className="icon-xs shrink-0" />}
          >
            Environment settings
          </NodexDropdownItem>
        </div>
      </div>
    </NodexDropdownMenu>
  );
}
