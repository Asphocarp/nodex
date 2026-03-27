import { useCallback, useMemo, useState } from "react";
import { CheckmarkIcon, ConfigStatusIcon } from "@/components/shared/icons";
import {
  NodexDropdownButtonTrigger,
  NodexDropdownItem,
  NodexDropdownMessage,
  NodexDropdownMenu,
  NodexDropdownSection,
  NodexDropdownSeparator,
  NodexDropdownTitle,
} from "@/components/ui/dropdown";
import type { WorktreeEnvironmentOption } from "@/lib/types";
import { cn } from "@/lib/utils";

interface EnvironmentSelectorPopoverProps {
  options: WorktreeEnvironmentOption[];
  selectedPath?: string | null;
  busy: boolean;
  onRefresh: () => Promise<unknown>;
  onSelect: (environmentPath: string | null) => Promise<boolean> | boolean;
  onOpenSettings: () => Promise<void> | void;
  disabled?: boolean;
  triggerClassName?: string;
}

export function EnvironmentSelectorPopover({
  options,
  selectedPath,
  busy,
  onRefresh,
  onSelect,
  onOpenSettings,
  disabled = false,
  triggerClassName,
}: EnvironmentSelectorPopoverProps) {
  const [open, setOpen] = useState(false);
  const normalizedSelectedPath = selectedPath?.trim() || "";

  const selectedOption = useMemo(
    () => options.find((option) => option.path === normalizedSelectedPath),
    [options, normalizedSelectedPath],
  );

  const triggerLabel = selectedOption?.name ?? "No environment";
  const isDisabled = disabled || busy;

  const handleOpenChange = useCallback((nextOpen: boolean) => {
    setOpen(nextOpen);
    if (!nextOpen) return;
    void onRefresh();
  }, [onRefresh]);

  const handleSelect = useCallback(async (environmentPath: string | null) => {
    const applied = await onSelect(environmentPath);
    if (!applied) return;
    setOpen(false);
  }, [onSelect]);

  return (
    <NodexDropdownMenu
      open={open}
      onOpenChange={handleOpenChange}
      side="top"
      align="start"
      triggerButton={(
        <NodexDropdownButtonTrigger
          aria-label="Select worktree environment"
          title={triggerLabel}
          disabled={isDisabled}
          size="sm"
          chrome="transparent"
          shape="pill"
          muted
          className={cn("px-1.5", triggerClassName)}
        >
          <span className="inline-flex min-w-0 items-center gap-1">
            <ConfigStatusIcon className="size-3.5 shrink-0" />
            <span className="max-w-40 truncate text-sm">{triggerLabel}</span>
          </span>
        </NodexDropdownButtonTrigger>
      )}
      contentWidth="workspace"
    >
      <NodexDropdownTitle>Local environment</NodexDropdownTitle>

      <div className="vertical-scroll-fade-mask flex max-h-[200px] flex-col gap-0.5 overflow-y-auto pr-1">
        <NodexDropdownItem
          disabled={busy}
          onSelect={() => {
            void handleSelect(null);
          }}
          rightSlot={normalizedSelectedPath.length === 0 ? <CheckmarkIcon className="shrink-0" /> : null}
        >
          No environment
        </NodexDropdownItem>

        {options.length === 0 ? (
          <NodexDropdownMessage compact>No environments found</NodexDropdownMessage>
        ) : (
          <NodexDropdownSection className="flex flex-col">
            {options.map((option) => (
              <NodexDropdownItem
                key={option.path}
                disabled={busy}
                onSelect={() => {
                  void handleSelect(option.path);
                }}
                rightSlot={option.path === normalizedSelectedPath ? <CheckmarkIcon className="shrink-0" /> : null}
                subText={buildEnvironmentSubText(option)}
              >
                {option.name}
              </NodexDropdownItem>
            ))}
          </NodexDropdownSection>
        )}
      </div>

      <NodexDropdownSeparator />

      <NodexDropdownSection className="flex flex-col pb-1">
        <NodexDropdownItem
          onSelect={() => {
            void onOpenSettings();
            setOpen(false);
          }}
          leftSlot={<ConfigStatusIcon className="size-4 shrink-0" />}
        >
          Environment settings
        </NodexDropdownItem>
      </NodexDropdownSection>
    </NodexDropdownMenu>
  );
}

function buildEnvironmentSubText(option: WorktreeEnvironmentOption): string | null {
  const details: string[] = [];
  if (option.hasSetupScript) details.push("setup");
  if (option.hasCleanupScript) details.push("cleanup");
  if (option.actionCount > 0) {
    details.push(option.actionCount === 1 ? "1 action" : `${option.actionCount} actions`);
  }

  if (details.length === 0) return null;
  return details.join(" · ");
}
