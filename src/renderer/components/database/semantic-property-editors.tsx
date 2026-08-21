import type { ReactElement, ReactNode } from "react";
import { EstimateIcon, PriorityValueIcon } from "@/components/shared/icons";
import { StatusIcon, StatusLabel } from "@/lib/status-presentation";
import { BOARD_PRIORITY_OPTIONS } from "@/lib/board-options";
import { estimateStyles } from "@/lib/types";
import {
  isWorkflowStatus,
  WORKFLOW_STATUS_LABELS,
  WORKFLOW_STATUS_ORDER,
} from "../../../shared/workflow-status";
import { isPriority } from "../../../shared/priority";
import type { Estimate } from "../../../shared/types";
import type { DatabasePropertyOption } from "../../../shared/database-kernel";
import {
  PropertyOptionPicker,
  PropertyOptionToken,
  type PropertyOptionPickerHost,
} from "./property-option-picker";
import type { PresentedDataSourcePropertyOption } from "@/lib/data-source-property-options";
import type { DataSourcePropertyOptionRegistryState } from "./data-source-property-editor-binding";
import type { DatabasePropertyValuePresentation } from "./property-value-chip";

const SEMANTIC_OPTION_ORDERS: Readonly<
  Record<"status" | "priority" | "estimate", readonly string[]>
> = {
  status: WORKFLOW_STATUS_ORDER,
  priority: BOARD_PRIORITY_OPTIONS.map((option) => option.value),
  estimate: ["xs", "s", "m", "l", "xl"],
};

export const orderSemanticPropertyOptions = (
  kind: "status" | "priority" | "estimate",
  options: readonly DatabasePropertyOption[],
): readonly DatabasePropertyOption[] => {
  const rank = new Map(SEMANTIC_OPTION_ORDERS[kind].map((optionId, index) => [optionId, index]));
  return options
    .map((option, index) => ({ option, index }))
    .sort(
      (left, right) =>
        (rank.get(left.option.id) ?? Number.POSITIVE_INFINITY) -
          (rank.get(right.option.id) ?? Number.POSITIVE_INFINITY) || left.index - right.index,
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
    return BOARD_PRIORITY_OPTIONS.map((option) => ({
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
  const canonicalOptions =
    kind === "priority" ? options.filter((option) => isPriority(option.id)) : options;
  const canonicalSelectedId = kind === "priority" && !isPriority(selectedId) ? null : selectedId;
  if (registryState === "ready" || !canonicalSelectedId) {
    return orderSemanticPropertyOptions(kind, canonicalOptions);
  }
  if (canonicalOptions.some((option) => option.id === canonicalSelectedId)) {
    return orderSemanticPropertyOptions(kind, canonicalOptions);
  }
  const selectedFallback = defaultSemanticPropertyOptions(kind).find(
    (option) => option.id === canonicalSelectedId,
  );
  return orderSemanticPropertyOptions(
    kind,
    selectedFallback ? [...canonicalOptions, selectedFallback] : canonicalOptions,
  );
};

const semanticOption = (
  kind: "status" | "priority" | "estimate",
  option: PresentedDataSourcePropertyOption,
): ReactNode => {
  if (kind === "status" && isWorkflowStatus(option.id)) {
    return <StatusLabel statusId={option.id} label={option.name} />;
  }
  if (kind === "priority" && isPriority(option.id)) {
    return (
      <span className="inline-flex min-w-0 max-w-full items-center gap-2 text-sm/5 text-token-text-primary">
        <PriorityValueIcon
          priority={option.id}
          className="size-4 text-token-description-foreground"
        />
        <span className="truncate">{option.name}</span>
      </span>
    );
  }
  if (kind === "estimate") {
    const visual = estimateStyles[option.id as Estimate];
    if (visual) {
      return (
        <span className="inline-flex min-w-0 max-w-full items-center gap-2 text-sm/5 text-token-text-primary">
          <EstimateIcon className="size-4 text-token-description-foreground" />
          <span className="truncate">{option.name}</span>
        </span>
      );
    }
  }
  return <PropertyOptionToken option={option} />;
};

export function SemanticSelectPropertyEditor({
  host,
  kind,
  label,
  triggerAriaLabel,
  triggerPrefix,
  triggerButton,
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
  onCommit,
  hasMore = false,
  loadingMore = false,
  onRequestMoreOptions,
  onChange,
}: {
  readonly host?: PropertyOptionPickerHost;
  readonly kind: "status" | "priority" | "estimate";
  readonly label: string;
  readonly triggerAriaLabel?: string;
  readonly triggerPrefix?: ReactNode;
  readonly triggerButton?: ReactElement;
  readonly options: readonly DatabasePropertyOption[];
  readonly selectedId: string | null;
  readonly disabled: boolean;
  readonly pending?: boolean;
  readonly registryState?: DataSourcePropertyOptionRegistryState;
  readonly presentation: DatabasePropertyValuePresentation | "chip";
  readonly searchPlaceholder?: string;
  readonly searchLeading?: ReactNode;
  readonly contentClassName?: string;
  readonly emptyOptionLabel?: string;
  readonly onRequestOptions?: () => void;
  readonly onOpenChange?: (open: boolean) => void;
  readonly onCommit?: () => void;
  readonly hasMore?: boolean;
  readonly loadingMore?: boolean;
  readonly onRequestMoreOptions?: () => void;
  readonly onChange: (value: string | null) => void;
}) {
  const canonicalSelectedId = kind === "priority" && !isPriority(selectedId) ? null : selectedId;
  const presentedOptions = presentSemanticPropertyOptions(
    kind,
    options,
    canonicalSelectedId,
    registryState,
  );
  const selectedOption = presentedOptions.find((option) => option.id === canonicalSelectedId);
  const boardPriority =
    presentation === "board" && kind === "priority" && isPriority(canonicalSelectedId);
  const boardStatus =
    presentation === "board" && kind === "status" && isWorkflowStatus(canonicalSelectedId);
  const closedTriggerPrefix = boardPriority ? (
    <PriorityValueIcon
      priority={canonicalSelectedId}
      className="size-3.5 text-[var(--database-property-chip-current-text,var(--database-property-chip-text))]"
    />
  ) : boardStatus ? (
    <StatusIcon
      statusId={canonicalSelectedId}
      className="size-3.5 text-[var(--database-property-chip-current-text,var(--database-property-chip-text))]"
    />
  ) : (
    triggerPrefix
  );
  return (
    <PropertyOptionPicker
      host={host}
      label={label}
      triggerAriaLabel={
        triggerAriaLabel ??
        (boardPriority
          ? `Edit ${label}: ${selectedOption?.name ?? canonicalSelectedId}`
          : undefined)
      }
      mode="single"
      options={presentedOptions}
      selectedIds={canonicalSelectedId ? [canonicalSelectedId] : []}
      disabled={disabled}
      pending={pending}
      loading={registryState === "idle" || registryState === "loading"}
      registryError={registryState === "error"}
      onOpen={onRequestOptions}
      hasMore={hasMore}
      loadingMore={loadingMore}
      onLoadMore={onRequestMoreOptions}
      presentation={presentation}
      triggerPrefix={closedTriggerPrefix}
      triggerIconOnly={boardPriority}
      triggerButton={triggerButton}
      searchPlaceholder={searchPlaceholder}
      searchLeading={searchLeading}
      contentClassName={contentClassName}
      allowClear={kind !== "status"}
      emptyOptionLabel={emptyOptionLabel}
      onOpenChange={onOpenChange}
      onCommit={onCommit}
      onSelectedIdsChange={(ids) => onChange(ids[0] ?? null)}
      renderOption={(option) => semanticOption(kind, option)}
    />
  );
}
