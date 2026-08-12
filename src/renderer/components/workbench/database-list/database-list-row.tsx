import type { DragEvent, MouseEvent, ReactNode } from "react";

import { PropertyOptionPicker } from "@/components/database/property-option-picker";
import { NodexButton } from "@/components/ui/button";
import { NodexCheckbox } from "@/components/ui/settings";
import { StatusIcon } from "@/lib/status-chip";
import { usePresentedPageTitle } from "@/lib/page-title-projection-context";
import { cn } from "@/lib/utils";
import { isPriority } from "../../../../shared/priority";
import type { DatabaseListDropPosition } from "./compile-list-drop-intent";
import {
  DatabaseListDisclosureIcon,
  DatabaseListPriorityIcon,
} from "./database-list-icons";
import type { DatabaseListPageRow } from "./database-list-model";
import {
  DatabaseListNestingLines,
  DATABASE_LIST_NESTING_DEPTH_PX,
} from "./database-list-nesting-lines";
import { resolveDatabaseListRowDropPosition } from "./database-list-row-interaction";

const shortIdentifier = (pageId: string): string => {
  const normalized = pageId.replace(/^page[-_:]?/i, "").replace(/[^a-z0-9]/gi, "");
  return (normalized || pageId).slice(0, 7).toUpperCase();
};

export const DATABASE_LIST_INTERACTIVE_SELECTOR = [
  "button",
  "a",
  "input",
  "textarea",
  "select",
  "[role=checkbox]",
  "[role=combobox]",
  "[role=menu]",
  "[contenteditable=true]",
].join(",");

export function DatabaseListRow({
  item,
  libraryId,
  selected,
  selectedBefore,
  selectedAfter,
  active,
  dragging,
  presented,
  inlineProperties,
  trailingCells,
  onSelect,
  onActivate,
  onOpen,
  onDragStart,
  onDragEnd,
  dropPosition,
  onDragTargetChange,
  onDrop,
  onToggleParent,
  statusOptions,
  priorityOptions,
  onSetStatus,
  onSetPriority,
  statusMutationDisabled,
  priorityMutationDisabled,
  showPriority,
  showStatus,
  nestingContinuations,
  ariaRowIndex,
}: {
  readonly item: DatabaseListPageRow;
  readonly libraryId: string;
  readonly selected: boolean;
  readonly selectedBefore: boolean;
  readonly selectedAfter: boolean;
  readonly active: boolean;
  readonly dragging: boolean;
  readonly presented: boolean;
  readonly inlineProperties: ReactNode;
  readonly trailingCells: ReactNode;
  readonly onSelect: (mode: "replace" | "toggle" | "range") => void;
  readonly onActivate: () => void;
  readonly onOpen: (titleSnapshot: string) => void;
  readonly onDragStart: (event: DragEvent<HTMLDivElement>) => void;
  readonly onDragEnd: () => void;
  readonly dropPosition: DatabaseListDropPosition | null;
  readonly onDragTargetChange: (position: DatabaseListDropPosition | null) => void;
  readonly onDrop: (
    event: DragEvent<HTMLDivElement>,
    position: DatabaseListDropPosition,
  ) => void;
  readonly onToggleParent: () => void;
  readonly statusOptions: readonly { readonly id: string; readonly name: string }[];
  readonly priorityOptions: readonly { readonly id: string; readonly name: string }[];
  readonly onSetStatus: (optionId: string | null) => void;
  readonly onSetPriority: (optionId: string | null) => void;
  readonly statusMutationDisabled: boolean;
  readonly priorityMutationDisabled: boolean;
  readonly showPriority: boolean;
  readonly showStatus: boolean;
  readonly nestingContinuations: readonly boolean[];
  readonly ariaRowIndex: number;
}) {
  const presentedTitle = usePresentedPageTitle(
    item.pageId,
    item.row.title,
    libraryId,
  );
  const selectionMode = (event: MouseEvent): "replace" | "toggle" | "range" => {
    if (event.shiftKey) return "range";
    if (event.metaKey || event.ctrlKey) return "toggle";
    return "replace";
  };
  const depthOffset = item.depth * DATABASE_LIST_NESTING_DEPTH_PX;
  return (
    <div
      role="row"
      aria-rowindex={ariaRowIndex}
      aria-selected={selected}
      tabIndex={active ? 0 : -1}
      draggable="true"
      data-list-row="true"
      data-list-key={item.key}
      data-database-view-page-id={item.pageId}
      data-selected={selected || undefined}
      data-previous-selected={selectedBefore || undefined}
      data-next-selected={selectedAfter || undefined}
      data-first-selected={selected && !selectedBefore ? "true" : undefined}
      data-last-selected={selected && !selectedAfter ? "true" : undefined}
      data-selection-start={selected && !selectedBefore ? "true" : undefined}
      data-selection-end={selected && !selectedAfter ? "true" : undefined}
      data-active={active || undefined}
      data-keyboard-active={active || undefined}
      data-first-in-group={item.firstInGroup || undefined}
      data-last-in-group={item.lastInGroup || undefined}
      data-apply-background="true"
      data-raise-row={active || dragging || undefined}
      data-drop-position={dropPosition ?? undefined}
      data-database-view-page-presented={presented ? "true" : undefined}
      className={cn(
        "group/list-row relative grid h-11 min-h-11 min-w-0 items-center gap-x-2 rounded-lg outline-none [grid-template-columns:subgrid] [grid-column:1/-1]",
        "before:absolute before:inset-x-2 before:inset-y-0 before:-z-0 before:rounded-lg before:content-['']",
        "hover:before:bg-[var(--database-list-row-hover)]",
        selected && "before:bg-[var(--database-list-row-selected)] hover:before:bg-[var(--database-list-row-selected)]",
        selected && selectedBefore && "before:rounded-t-none",
        selected && selectedAfter && "before:rounded-b-none",
        active && "focus-visible:before:ring-1 focus-visible:before:ring-inset focus-visible:before:ring-[var(--database-list-focus)]",
        dragging && "opacity-70",
        dropPosition === "nest" && "before:ring-1 before:ring-inset before:ring-[var(--database-list-drop-indicator)]",
      )}
      onFocus={(event) => {
        if (event.target === event.currentTarget) onActivate();
      }}
      onPointerDown={(event) => {
        if ((event.target as HTMLElement).closest(DATABASE_LIST_INTERACTIVE_SELECTOR)) return;
        onActivate();
      }}
      onClick={(event) => {
        if ((event.target as HTMLElement).closest(DATABASE_LIST_INTERACTIVE_SELECTOR)) return;
        if (event.shiftKey) {
          event.preventDefault();
          onSelect(selectionMode(event));
          return;
        }
        if (dragging) return;
        onActivate();
        onOpen(presentedTitle);
      }}
      onDragStart={(event) => {
        if ((event.target as HTMLElement).closest(DATABASE_LIST_INTERACTIVE_SELECTOR)) {
          event.preventDefault();
          return;
        }
        onDragStart(event);
      }}
      onDragEnd={onDragEnd}
      onDragOver={(event) => {
        if (!event.dataTransfer.types.includes("application/vnd.nodex.database-view-pages.v1+json")) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = "move";
        const rect = event.currentTarget.getBoundingClientRect();
        onDragTargetChange(resolveDatabaseListRowDropPosition({
          clientY: event.clientY,
          rowTop: rect.top,
          rowHeight: rect.height,
          explicitNest: event.altKey,
        }));
      }}
      onDragLeave={(event) => {
        if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
        onDragTargetChange(null);
      }}
      onDrop={(event) => {
        const rect = event.currentTarget.getBoundingClientRect();
        onDrop(event, resolveDatabaseListRowDropPosition({
          clientY: event.clientY,
          rowTop: rect.top,
          rowHeight: rect.height,
          explicitNest: event.altKey,
        }));
      }}
    >
      {dropPosition === "before" || dropPosition === "after" ? (
        <span
          aria-hidden="true"
          className={cn(
            "pointer-events-none absolute inset-x-2 z-[3] h-0.5 rounded-full bg-[var(--database-list-drop-indicator)]",
            dropPosition === "before" ? "top-0" : "bottom-0",
          )}
        />
      ) : null}
      <div role="gridcell" aria-hidden="true" data-list-grid-column="indent" className="relative z-[1] h-full min-w-0" />
      <div role="gridcell" data-list-grid-column="checkbox" className="relative z-[1] flex items-center justify-center">
        <DatabaseListNestingLines
          depth={item.depth}
          continuations={nestingContinuations}
          hasChildren={item.hasChildren}
        />
        <NodexCheckbox
          ariaLabel={`${selected ? "Deselect" : "Select"} ${presentedTitle}`}
          checked={selected}
          onCheckedChange={() => onSelect("toggle")}
          className="rounded-[3px] border-[var(--database-list-checkbox-border)] opacity-0 shadow-none transition-none group-hover/list-row:opacity-100 group-focus-within/list-row:opacity-100 data-[state=checked]:opacity-100 focus-visible:border-[var(--database-list-focus)] focus-visible:ring-[var(--database-list-focus)]"
        />
      </div>
      {showPriority ? (
        <div
          role="gridcell"
          data-list-grid-column="priority"
          className="relative z-[1] flex min-w-0 items-center justify-center text-[var(--database-list-text-muted)]"
          style={{ transform: `translateX(${depthOffset}px)` }}
        >
          <PropertyOptionPicker
            label="Priority"
            mode="single"
            options={priorityOptions}
            selectedIds={item.row.priority ? [item.row.priority] : []}
            disabled={priorityMutationDisabled}
            allowClear
            emptyOptionLabel="No priority"
            searchPlaceholder="Change priority to…"
            searchLeading={null}
            contentClassName="w-[min(220px,calc(100vw-16px))]"
            triggerButton={(
              <NodexButton
                variant="ghost"
                size="icon-xs"
                aria-label={`Change priority for ${presentedTitle}`}
                className="size-5 rounded text-[var(--database-list-text-muted)] disabled:opacity-100"
              >
                <DatabaseListPriorityIcon priority={item.row.priority ?? null} />
              </NodexButton>
            )}
            onSelectedIdsChange={(selectedIds) => onSetPriority(selectedIds[0] ?? null)}
            renderOption={(option) => (
              <span className="flex min-w-0 items-center gap-2">
                <DatabaseListPriorityIcon
                  priority={isPriority(option.id) ? option.id : null}
                />
                <span className="truncate">{option.name}</span>
              </span>
            )}
          />
        </div>
      ) : null}
      <div
        role="gridcell"
        data-list-grid-column="identifier"
        className="relative z-[1] min-w-0 truncate text-[13px] font-[450] leading-[normal] tabular-nums text-[var(--database-list-text-muted)]"
        style={{ transform: `translateX(${depthOffset}px)` }}
        title={item.pageId}
      >
        {shortIdentifier(item.pageId)}
      </div>
      {showStatus ? (
        <div
          role="gridcell"
          data-list-grid-column="status"
          className="relative z-[1] flex min-w-0 items-center justify-center text-[var(--database-list-text-muted)]"
          style={{ transform: `translateX(${depthOffset}px)` }}
        >
          <PropertyOptionPicker
            label="Status"
            mode="single"
            options={statusOptions}
            selectedIds={item.row.status ? [item.row.status] : []}
            disabled={statusMutationDisabled}
            allowClear={false}
            searchPlaceholder="Change status…"
            searchLeading={null}
            contentClassName="w-[min(220px,calc(100vw-16px))]"
            triggerButton={(
              <NodexButton
                variant="ghost"
                size="icon-xs"
                aria-label={`Change status for ${presentedTitle}`}
                className="size-5 rounded text-[var(--database-list-text-muted)] disabled:opacity-100"
              >
                {item.row.status ? (
                  <StatusIcon statusId={item.row.status} className="size-4" />
                ) : <span className="size-2 rounded-full ring-[1px] ring-[var(--database-list-icon-muted)]" />}
              </NodexButton>
            )}
            onSelectedIdsChange={(selectedIds) => onSetStatus(selectedIds[0] ?? null)}
            renderOption={(option) => (
              <span className="flex min-w-0 items-center gap-2">
                <StatusIcon
                  statusId={option.id}
                  label={option.name}
                  className="size-4"
                />
                <span className="truncate">{option.name}</span>
              </span>
            )}
          />
        </div>
      ) : null}
      <div
        role="gridcell"
        data-list-grid-column="title"
        className="relative z-[1] -mr-[5px] flex min-w-0 items-center overflow-hidden"
        style={{
          transform: `translateX(${depthOffset}px)`,
          marginRight: `${depthOffset - 5}px`,
        }}
      >
        <div className="flex min-w-0 flex-1 items-center gap-2 overflow-hidden">
          {item.hasChildren ? (
            <button
              type="button"
              aria-label={`${item.collapsed ? "Expand" : "Collapse"} sub-pages of ${presentedTitle}`}
              aria-expanded={!item.collapsed}
              className="grid size-4 shrink-0 place-items-center rounded-full text-[var(--database-list-text-muted)] outline-none hover:bg-[var(--database-list-row-hover)] focus-visible:ring-1 focus-visible:ring-[var(--database-list-focus)]"
              onPointerDown={(event) => event.stopPropagation()}
              onClick={(event) => {
                event.stopPropagation();
                onToggleParent();
              }}
            >
              <DatabaseListDisclosureIcon open={!item.collapsed} />
            </button>
          ) : null}
          <button
            type="button"
            className="min-w-0 shrink truncate text-left text-sm font-medium leading-[normal] text-[var(--database-list-text-primary)] outline-none"
            aria-label={`Open Page ${presentedTitle}`}
            onClick={() => {
              onActivate();
              onOpen(presentedTitle);
            }}
          >
            {presentedTitle}
          </button>
          {inlineProperties}
        </div>
      </div>
      {trailingCells}
      <div role="gridcell" data-list-grid-column="end-padding" className="relative z-[1]" />
    </div>
  );
}
