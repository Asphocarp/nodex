import { forwardRef, type ButtonHTMLAttributes } from "react";
import * as PopoverPrimitive from "@radix-ui/react-popover";
import { ListFilter } from "lucide-react";
import {
  CARD_STATUS_LABELS,
  CARD_STATUS_ORDER,
  type CardStatus,
} from "../../../shared/card-status";
import {
  cloneCommandPaletteCardFilters,
  getDefaultCommandPaletteCardFilters,
  hasActiveCommandPaletteCardFilters,
  summarizeCommandPaletteCardFilters,
  type CommandPaletteCardFilters,
} from "../../lib/command-palette";
import {
  TOGGLE_LIST_EMPTY_PRIORITY_LABEL,
  TOGGLE_LIST_PRIORITY_CHIP_LABELS,
  TOGGLE_LIST_PRIORITY_ORDER,
  TOGGLE_LIST_TAG_FILTER_MODE_LABELS,
  TOGGLE_LIST_TAG_FILTER_MODES,
} from "../../lib/toggle-list/types";
import { cn } from "../../lib/utils";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from "../ui/select";
import {
  SELECTOR_MENU_CONTENT_CLASS_NAME,
} from "@/features/local-conversation/view/shared/selector-popover-primitives";

const PANEL_CLASS_NAME = "min-w-96 max-w-[min(36rem,calc(100vw-2rem))] outline-none";
const SECTION_LABEL =
  "text-xs font-medium uppercase tracking-label text-token-description-foreground select-none";
const ROW_LABEL =
  "w-18 shrink-0 pt-0.75 text-xs text-token-description-foreground select-none";
const CHIP_BASE =
  "inline-flex h-6 items-center rounded-md px-2 text-xs font-medium text-token-description-foreground hover:bg-token-foreground/5 hover:text-token-foreground";
const CHIP_ACTIVE =
  "bg-[color-mix(in_srgb,var(--accent-blue)_18%,transparent)] text-(--accent-blue) hover:bg-[color-mix(in_srgb,var(--accent-blue)_22%,transparent)] hover:text-(--accent-blue)";
const TEXT_BTN = "inline-flex items-center gap-1 text-xs font-medium text-token-description-foreground hover:text-token-foreground";
const SELECT_TRIGGER = "h-6 min-w-24 rounded-md border-transparent bg-token-foreground/5 px-2 py-0! text-xs shadow-none [&_svg]:size-3";
const SUMMARY_CHIP =
  "inline-flex h-6 items-center gap-0.5 rounded-full bg-[color-mix(in_srgb,var(--accent-blue)_14%,transparent)] px-2 text-xs font-medium text-(--accent-blue) hover:bg-[color-mix(in_srgb,var(--accent-blue)_18%,transparent)]";
const ICON_BUTTON_BASE =
  "inline-flex size-7 items-center justify-center rounded-md hover:bg-[color-mix(in_srgb,var(--foreground)_5%,transparent)]";

export interface CommandPaletteProjectFilterOption {
  id: string;
  label: string;
}

function ToolbarPopoverContent({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <PopoverPrimitive.Portal>
      <PopoverPrimitive.Content
        side="bottom"
        align="end"
        sideOffset={8}
        collisionPadding={12}
        className={cn(SELECTOR_MENU_CONTENT_CLASS_NAME, PANEL_CLASS_NAME)}
      >
        <div className="flex flex-col gap-3 p-2">{children}</div>
      </PopoverPrimitive.Content>
    </PopoverPrimitive.Portal>
  );
}

function toggleString(values: string[], value: string): string[] {
  return values.includes(value)
    ? values.filter((candidate) => candidate !== value)
    : [...values, value];
}

function toggleStatus(values: CardStatus[], value: CardStatus): CardStatus[] {
  return values.includes(value)
    ? values.filter((candidate) => candidate !== value)
    : [...values, value];
}

function togglePriority(
  values: CommandPaletteCardFilters["priorities"],
  value: CommandPaletteCardFilters["priorities"][number],
): CommandPaletteCardFilters["priorities"] {
  return values.includes(value)
    ? values.filter((candidate) => candidate !== value)
    : [...values, value];
}

function FilterChip({
  active,
  label,
  onClick,
}: {
  active: boolean;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className={cn(CHIP_BASE, active && CHIP_ACTIVE)}
      onClick={onClick}
    >
      {label}
    </button>
  );
}

function FilterValueRow({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-start gap-2">
      <span className={ROW_LABEL}>{label}</span>
      <div className="flex flex-wrap items-start gap-1.5">
        {children}
      </div>
    </div>
  );
}

export const CommandPaletteCardFilterButton = forwardRef<
  HTMLButtonElement,
  ButtonHTMLAttributes<HTMLButtonElement> & {
    active: boolean;
  }
>(function CommandPaletteCardFilterButton(
  {
    active,
    disabled = false,
    className,
    type = "button",
    ...props
  },
  ref,
) {
  return (
    <button
      {...props}
      ref={ref}
      type={type}
      aria-label="Filter cards"
      title="Filter cards"
      disabled={disabled}
      className={cn(
        ICON_BUTTON_BASE,
        active
          ? "text-(--accent-blue)"
          : "text-[color-mix(in_srgb,var(--foreground)_62%,transparent)] hover:text-(--foreground)",
        disabled && "cursor-not-allowed opacity-40 hover:bg-transparent",
        className,
      )}
    >
      <ListFilter className="size-4" />
    </button>
  );
});

export function CommandPaletteCardFilterPopover({
  open,
  onOpenChange,
  filters,
  availableTags,
  availableAssignees,
  availableProjects,
  disabled,
  onChange,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  filters: CommandPaletteCardFilters;
  availableTags: string[];
  availableAssignees: string[];
  availableProjects: CommandPaletteProjectFilterOption[];
  disabled: boolean;
  onChange: (update: (prev: CommandPaletteCardFilters) => CommandPaletteCardFilters) => void;
  children: React.ReactNode;
}) {
  const filterActive = hasActiveCommandPaletteCardFilters(filters);

  return (
    <PopoverPrimitive.Root open={open && !disabled} onOpenChange={onOpenChange}>
      <PopoverPrimitive.Trigger asChild>{children}</PopoverPrimitive.Trigger>
      <ToolbarPopoverContent>
        <div className="flex items-center justify-between">
          <span className={SECTION_LABEL}>Filters</span>
          <button
            type="button"
            className={TEXT_BTN}
            onClick={() => onChange(() => getDefaultCommandPaletteCardFilters())}
            disabled={!filterActive}
          >
            Reset
          </button>
        </div>

        <FilterValueRow label="Status">
          {CARD_STATUS_ORDER.map((status) => (
            <FilterChip
              key={`status:${status}`}
              active={filters.statuses.includes(status)}
              label={CARD_STATUS_LABELS[status]}
              onClick={() =>
                onChange((prev) => ({
                  ...cloneCommandPaletteCardFilters(prev),
                  statuses: toggleStatus(prev.statuses, status),
                }))}
            />
          ))}
        </FilterValueRow>

        <FilterValueRow label="Priority">
          {TOGGLE_LIST_PRIORITY_ORDER.map((priority) => (
            <FilterChip
              key={`priority:${priority}`}
              active={filters.priorities.includes(priority)}
              label={TOGGLE_LIST_PRIORITY_CHIP_LABELS[priority]}
                onClick={() =>
                  onChange((prev) => ({
                    ...cloneCommandPaletteCardFilters(prev),
                    priorities: togglePriority(prev.priorities, priority),
                  }))}
            />
          ))}
          <FilterChip
            active={filters.includeEmptyPriority}
            label={TOGGLE_LIST_EMPTY_PRIORITY_LABEL}
            onClick={() =>
              onChange((prev) => ({
                ...cloneCommandPaletteCardFilters(prev),
                includeEmptyPriority: !prev.includeEmptyPriority,
              }))}
          />
        </FilterValueRow>

        <FilterValueRow label="Tags">
          <Select
            value={filters.tagMode}
            onValueChange={(value) =>
              onChange((prev) => ({
                ...cloneCommandPaletteCardFilters(prev),
                tagMode: value as CommandPaletteCardFilters["tagMode"],
              }))}
          >
            <SelectTrigger className={cn(SELECT_TRIGGER, "w-18")}>
              {TOGGLE_LIST_TAG_FILTER_MODE_LABELS[filters.tagMode]}
            </SelectTrigger>
            <SelectContent sideOffset={4}>
              {TOGGLE_LIST_TAG_FILTER_MODES.map((mode) => (
                <SelectItem key={mode} value={mode}>
                  {TOGGLE_LIST_TAG_FILTER_MODE_LABELS[mode]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {availableTags.length === 0 ? (
            <span className="pt-1 text-xs text-token-description-foreground italic">No tags in results</span>
          ) : (
            availableTags.map((tag) => (
              <FilterChip
                key={`tag:${tag}`}
                active={filters.tags.includes(tag)}
                label={tag}
                onClick={() =>
                  onChange((prev) => ({
                    ...cloneCommandPaletteCardFilters(prev),
                    tags: toggleString(prev.tags, tag),
                  }))}
              />
            ))
          )}
        </FilterValueRow>

        <FilterValueRow label="Assignee">
          {availableAssignees.length === 0 ? (
            <span className="pt-1 text-xs text-token-description-foreground italic">No assignees in results</span>
          ) : (
            availableAssignees.map((assignee) => (
              <FilterChip
                key={`assignee:${assignee}`}
                active={filters.assignees.includes(assignee)}
                label={assignee}
                onClick={() =>
                  onChange((prev) => ({
                    ...cloneCommandPaletteCardFilters(prev),
                    assignees: toggleString(prev.assignees, assignee),
                  }))}
              />
            ))
          )}
        </FilterValueRow>

        <FilterValueRow label="Project">
          {availableProjects.length === 0 ? (
            <span className="pt-1 text-xs text-token-description-foreground italic">No projects loaded</span>
          ) : (
            availableProjects.map((project) => (
              <FilterChip
                key={`project:${project.id}`}
                active={filters.projectIds.includes(project.id)}
                label={project.label}
                onClick={() =>
                  onChange((prev) => ({
                    ...cloneCommandPaletteCardFilters(prev),
                    projectIds: toggleString(prev.projectIds, project.id),
                  }))}
              />
            ))
          )}
        </FilterValueRow>
      </ToolbarPopoverContent>
    </PopoverPrimitive.Root>
  );
}

export function CommandPaletteCardFiltersSummaryRow({
  filters,
  projectNameById,
  onOpenFilter,
}: {
  filters: CommandPaletteCardFilters;
  projectNameById: ReadonlyMap<string, string>;
  onOpenFilter: () => void;
}) {
  const summaries = summarizeCommandPaletteCardFilters(filters, projectNameById);
  if (summaries.length === 0) {
    return null;
  }

  return (
    <div className="flex items-center gap-1.5 overflow-x-auto">
      {summaries.map((summary) => (
        <button
          key={summary.key}
          type="button"
          className={SUMMARY_CHIP}
          onClick={onOpenFilter}
        >
          <span className="font-medium">{summary.label}:</span>
          <span className="max-w-56 truncate">{summary.value}</span>
        </button>
      ))}
    </div>
  );
}
