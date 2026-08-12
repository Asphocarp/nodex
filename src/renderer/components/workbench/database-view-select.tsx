import type { ReactNode } from "react";

import {
  NodexDropdownButtonTrigger,
  NodexOptionPicker,
  type NodexOptionPickerSearchMode,
  type NodexDropdownButtonTriggerProps,
  type NodexDropdownContentWidth,
} from "@/components/ui/dropdown";
import { cn } from "@/lib/utils";

export interface DatabaseViewSelectOption {
  readonly value: string;
  readonly label: ReactNode;
  readonly searchText?: string;
  readonly disabled?: boolean;
}

interface DatabaseViewSelectProps {
  readonly ariaLabel: string;
  readonly value: string;
  readonly valueLabel: ReactNode;
  readonly options: readonly DatabaseViewSelectOption[];
  readonly onValueChange: (value: string) => void;
  readonly disabled?: boolean;
  readonly search?: NodexOptionPickerSearchMode;
  readonly searchPlaceholder?: string;
  readonly className?: string;
  readonly contentWidth?: NodexDropdownContentWidth;
  readonly chrome?: NodexDropdownButtonTriggerProps["chrome"];
  readonly size?: NodexDropdownButtonTriggerProps["size"];
}

export function DatabaseViewSelect({
  ariaLabel,
  value,
  valueLabel,
  options,
  onValueChange,
  disabled = false,
  search = "none",
  searchPlaceholder,
  className,
  contentWidth = "sm",
  chrome = "filled",
  size = "xs",
}: DatabaseViewSelectProps) {
  return (
    <NodexOptionPicker
      value={value}
      disabled={disabled}
      search={search}
      searchPlaceholder={searchPlaceholder}
      searchAriaLabel={search === "filter" ? `Search ${ariaLabel}` : undefined}
      onValueChange={onValueChange}
      contentWidth={contentWidth}
      align="end"
      options={options.map((option) => ({
        value: option.value,
        label: option.label,
        searchText: option.searchText,
        disabled: option.disabled,
      }))}
      triggerButton={(
        <NodexDropdownButtonTrigger
          aria-label={ariaLabel}
          aria-disabled={disabled}
          size={size}
          chrome={chrome}
          className={cn("min-w-0", className)}
        >
          <span className="min-w-0 flex-1 truncate text-left">{valueLabel}</span>
        </NodexDropdownButtonTrigger>
      )}
    />
  );
}
