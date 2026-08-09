import type { ReactNode } from "react";
import { StatusChip } from "@/lib/status-chip";
import {
  KANBAN_PRIORITY_OPTIONS,
  KANBAN_PRIORITY_OPTIONS_BY_VALUE,
} from "@/lib/kanban-options";
import { estimateStyles } from "@/lib/types";
import {
  isWorkflowStatus,
  WORKFLOW_STATUS_LABELS,
  WORKFLOW_STATUS_ORDER,
} from "../../../shared/workflow-status";
import type { Estimate, Priority } from "../../../shared/types";
import type { DatabasePropertyOption } from "../../../shared/database-kernel";
import { cn } from "@/lib/utils";
import {
  PropertyOptionPicker,
  PropertyOptionToken,
} from "./property-option-picker";
import type { PresentedDataSourcePropertyOption } from "@/lib/data-source-property-options";
import type { DataSourcePropertyOptionRegistryState } from "./data-source-property-editor-binding";

const SEMANTIC_OPTION_ORDERS: Readonly<Record<
  "status" | "priority" | "estimate",
  readonly string[]
>> = {
  status: WORKFLOW_STATUS_ORDER,
  priority: KANBAN_PRIORITY_OPTIONS.map((option) => option.value),
  estimate: ["xs", "s", "m", "l", "xl"],
};

export const orderSemanticPropertyOptions = (
  kind: "status" | "priority" | "estimate",
  options: readonly DatabasePropertyOption[],
): readonly DatabasePropertyOption[] => {
  const rank = new Map(
    SEMANTIC_OPTION_ORDERS[kind].map((optionId, index) => [optionId, index]),
  );
  return options
    .map((option, index) => ({ option, index }))
    .sort((left, right) =>
      (rank.get(left.option.id) ?? Number.POSITIVE_INFINITY)
      - (rank.get(right.option.id) ?? Number.POSITIVE_INFINITY)
      || left.index - right.index
    )
    .map(({ option }) => option);
};

const defaultSemanticPropertyOptions = (
  kind: "status" | "priority" | "estimate",
): readonly DatabasePropertyOption[] => {
  if (kind === "status") {
    return WORKFLOW_STATUS_ORDER.map((id) => ({ id, name: WORKFLOW_STATUS_LABELS[id] }));
  }
  if (kind === "priority") {
    return KANBAN_PRIORITY_OPTIONS.map((option) => ({
      id: option.value,
      name: option.label,
    }));
  }
  return ["xs", "s", "m", "l", "xl"].map((id) => ({
    id,
    name: estimateStyles[id as Estimate].label,
  }));
};

export const presentSemanticPropertyOptions = (
  kind: "status" | "priority" | "estimate",
  options: readonly DatabasePropertyOption[],
  selectedId: string | null,
  registryState: DataSourcePropertyOptionRegistryState,
): readonly DatabasePropertyOption[] => {
  if (registryState === "ready" || !selectedId) {
    return orderSemanticPropertyOptions(kind, options);
  }
  if (options.some((option) => option.id === selectedId)) {
    return orderSemanticPropertyOptions(kind, options);
  }
  const selectedFallback = defaultSemanticPropertyOptions(kind).find(
    (option) => option.id === selectedId,
  );
  return orderSemanticPropertyOptions(
    kind,
    selectedFallback ? [...options, selectedFallback] : options,
  );
};

const semanticOption = (
  kind: "status" | "priority" | "estimate",
  option: PresentedDataSourcePropertyOption,
): ReactNode => {
  if (kind === "status" && isWorkflowStatus(option.id)) {
    return <StatusChip statusId={option.id} label={option.name} />;
  }
  if (kind === "priority") {
    const visual = KANBAN_PRIORITY_OPTIONS_BY_VALUE[option.id as Priority];
    if (visual) {
      return (
        <span className={cn(
          "inline-flex h-5.5 max-w-full items-center rounded-md px-1.5 text-sm/5",
          visual.className,
        )}>
          <span className="truncate">{option.name}</span>
        </span>
      );
    }
  }
  if (kind === "estimate") {
    const visual = estimateStyles[option.id as Estimate];
    if (visual) {
      return (
        <span className={cn(
          "inline-flex h-5.5 max-w-full items-center rounded-md px-1.5 text-sm/5",
          visual.className,
        )}>
          <span className="truncate">{option.name}</span>
        </span>
      );
    }
  }
  return <PropertyOptionToken option={option} />;
};

export function SemanticSelectPropertyEditor({
  kind,
  label,
  triggerAriaLabel,
  triggerPrefix,
  options,
  selectedId,
  disabled,
  pending = false,
  registryState = "ready",
  presentation,
  searchPlaceholder,
  searchLeading,
  contentClassName,
  emptyOptionLabel,
  onRequestOptions,
  onOpenChange,
  hasMore = false,
  loadingMore = false,
  onRequestMoreOptions,
  onChange,
}: {
  readonly kind: "status" | "priority" | "estimate";
  readonly label: string;
  readonly triggerAriaLabel?: string;
  readonly triggerPrefix?: ReactNode;
  readonly options: readonly DatabasePropertyOption[];
  readonly selectedId: string | null;
  readonly disabled: boolean;
  readonly pending?: boolean;
  readonly registryState?: DataSourcePropertyOptionRegistryState;
  readonly presentation: "compact" | "page" | "chip";
  readonly searchPlaceholder?: string;
  readonly searchLeading?: ReactNode;
  readonly contentClassName?: string;
  readonly emptyOptionLabel?: string;
  readonly onRequestOptions?: () => void;
  readonly onOpenChange?: (open: boolean) => void;
  readonly hasMore?: boolean;
  readonly loadingMore?: boolean;
  readonly onRequestMoreOptions?: () => void;
  readonly onChange: (value: string | null) => void;
}) {
  return (
    <PropertyOptionPicker
      label={label}
      triggerAriaLabel={triggerAriaLabel}
      mode="single"
      options={presentSemanticPropertyOptions(kind, options, selectedId, registryState)}
      selectedIds={selectedId ? [selectedId] : []}
      disabled={disabled}
      pending={pending}
      loading={registryState === "idle" || registryState === "loading"}
      registryError={registryState === "error"}
      onOpen={onRequestOptions}
      hasMore={hasMore}
      loadingMore={loadingMore}
      onLoadMore={onRequestMoreOptions}
      presentation={presentation}
      triggerPrefix={triggerPrefix}
      searchPlaceholder={searchPlaceholder}
      searchLeading={searchLeading}
      contentClassName={contentClassName}
      allowClear={kind !== "status"}
      emptyOptionLabel={emptyOptionLabel}
      onOpenChange={onOpenChange}
      onSelectedIdsChange={(ids) => onChange(ids[0] ?? null)}
      renderOption={(option) => semanticOption(kind, option)}
    />
  );
}
