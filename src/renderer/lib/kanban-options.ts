import { PRIORITY_VALUES, type Priority } from "../../shared/priority";
import {
  TOGGLE_LIST_STATUS_LABELS,
  TOGGLE_LIST_STATUS_ORDER,
} from "./toggle-list/types";
import {
  getPriorityClassName,
  getPriorityLabel,
  getPriorityShortLabel,
} from "./priority-presentation";

export const ARCHIVED_CARD_OPTION_ID = "archived";
export const ARCHIVED_CARD_OPTION_NAME = "Archived";
export const EMPTY_PRIORITY_OPTION_VALUE = "none";

export const KANBAN_STATUS_OPTIONS = [
  ...TOGGLE_LIST_STATUS_ORDER.map((id) => ({
    id,
    name: TOGGLE_LIST_STATUS_LABELS[id],
  })),
] as const;

export const KANBAN_STATUS_LABELS: Record<string, string> = {
  ...TOGGLE_LIST_STATUS_LABELS,
  [ARCHIVED_CARD_OPTION_ID]: ARCHIVED_CARD_OPTION_NAME,
};

export type KanbanPriorityOption = {
  value: Priority;
  label: string;
  shortLabel: string;
  className: string;
};

export type KanbanPrioritySelectOption = KanbanPriorityOption | {
  value: typeof EMPTY_PRIORITY_OPTION_VALUE;
  label: string;
  shortLabel: string;
  className: string;
};

export const KANBAN_PRIORITY_OPTIONS: KanbanPriorityOption[] = PRIORITY_VALUES.map((value) => ({
  value,
  label: getPriorityLabel(value),
  shortLabel: getPriorityShortLabel(value),
  className: getPriorityClassName(value),
}));

export const EMPTY_KANBAN_PRIORITY_OPTION: KanbanPrioritySelectOption = {
  value: EMPTY_PRIORITY_OPTION_VALUE,
  label: "No priority",
  shortLabel: "Empty",
  className: "bg-(--gray-bg) text-(--foreground-tertiary)",
};

export const KANBAN_PRIORITY_SELECT_OPTIONS: KanbanPrioritySelectOption[] = [
  EMPTY_KANBAN_PRIORITY_OPTION,
  ...KANBAN_PRIORITY_OPTIONS,
];

export const KANBAN_PRIORITY_OPTIONS_BY_VALUE = KANBAN_PRIORITY_OPTIONS.reduce<Record<Priority, KanbanPriorityOption>>(
  (result, option) => {
    result[option.value] = option;
    return result;
  },
  {} as Record<Priority, KanbanPriorityOption>,
);

export function resolveKanbanPriorityOption(priority: Priority | null | undefined): KanbanPriorityOption | null {
  if (!priority) return null;
  return KANBAN_PRIORITY_OPTIONS_BY_VALUE[priority] ?? null;
}
